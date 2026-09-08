# Account types: what the bank says, and what the user says

> **What this file owns:** the two independent notions of "what kind of account is this" — the one
> the aggregator reports and the one the user sets in Settings — where each is stored, which parts of
> the app read which, and how to extend the user-set one without breaking transaction history.
>
> It does **not** own how a credit card is modelled — that is
> [`credit-cards.md`](credit-cards.md) — nor the balance forecast, which is
> [`bank-balance.md`](bank-balance.md).

---

## There are two account types, and they are not the same thing

**The aggregator's type** comes from the bank via Plaid or Powens. It is a fact about the account and
the user cannot change it.

**The user's type** is a setting in the Settings page. Today it has exactly two values — *checking*
or *savings* — and it exists because the aggregator's subtype is not always right, not always
present, and not always meaningful to the person who owns the account.

They are stored separately, read by different parts of the app, and neither is derived from the
other. Most of the confusion in this area comes from assuming there is one.

---

## What the aggregator reports

### Plaid

Plaid returns `type` and `subtype` on every account
([Plaid — Accounts](https://plaid.com/docs/api/accounts/)).

| `type` | Meaning | `subtype` values (not exhaustive) |
|---|---|---|
| `depository` | Cash accounts | `checking`, `savings`, `money market`, `cd`, `cash management`, `hsa`, `prepaid`, `ebt`, `limited purpose checking`, `paypal` |
| **`credit`** | **Borrowing accounts** | **`credit card`**, `charge card`, `bank-issued credit card`, `paypal` |
| `loan` | Amortising debt | student loans, mortgages |
| `investment` | Brokerage and retirement | — |
| `other` | Everything else | — |
| `brokerage` | Deprecated in favour of `investment` | — |

**`subtype` is nullable.** Any logic that keys off it must have an answer for a missing one.

**The credit card type already exists**, at both levels: `type: "credit"` with
`subtype: "credit card"`. Nothing needs to be added to the aggregator side — the data is already
arriving.

### How Kawa narrows it

`PlaidConnector.getAccountType` maps Plaid's `type` onto a smaller enum and passes `subtype` through
untouched. See `AccountType` in [`BankConnector.js`](../../src/bankConnectors/BankConnector.js):

```
depository | credit | other
```

`loan` and `investment` both collapse to `other`. Powens does its own mapping onto the same three, so
the contract is connector-independent.

---

## The account hash embeds the aggregator's type

This is the single most important fact in this file, and every extension has to respect it.

`BankAPI.getAccountHashFromData` builds:

```
hash = institutionId + "::" + signature + "::" + type
```

so a Plaid credit card's hash literally ends in `::credit`. That hash is the account identity used
everywhere — it is what every transaction's `userInstitutionAccountId` points at, what
`savingAccounts` stores, and what the balance view groups by.

**Consequence:** the type inside a hash can never be user-editable. Changing it would change the
hash, and every transaction ever recorded against that account would stop resolving. Any user-set
type must therefore be a **separate property keyed by hash**, never an edit to the hash itself.

The existing `savingAccounts` setting already works this way, which is the precedent to follow.

---

## What the user sets, and where it lives

**Client** — `AccountTypes` in [`Bank.js`](../src/Bank.js) is the two-value enum, and
`BCSettingItem` in [`SettingPage.js`](../src/components/SettingPage.js) renders the dropdown.
Selection is not stored as a type at all: it is stored as **membership of a list**. An account is
savings if its hash appears in `savingAccounts`; otherwise it is checking.

**Server** — `UserData.updateSavingsAccounts` validates and stores it as an array of strings on the
user record. The route is `saveBankAccountSettings`, and the client calls it through
`ApiCaller.saveBankAccountSettings`.

**What it currently drives:** one thing. `TransactionEvaluator` uses `Core.isSavingAccount` to decide
whether a transaction came from a savings account, which feeds transaction typing. There is a
commented-out second use in `ReportingCore`.

---

## Who reads which — and the split that matters

| Consumer | Reads | Notes |
|---|---|---|
| `TransactionEvaluator` | **user setting** | via `Core.isSavingAccount` |
| Balance forecast — `creditHashes` | **aggregator `type`** | `type === "credit"` |
| Balance forecast — `spendable` | **aggregator `type`** | `type === "depository"` |
| Balance forecast — `spendingHashes` | **aggregator `subtype`** | substring match on `"check"`, falling back to all depository accounts when no subtype names one |
| Balance anchor | **aggregator `type`** | credit balances are subtracted, since Plaid signs money owed positive |

**The balance forecast never consults the user's setting.** It decides what is a spending account
from the aggregator's `subtype` alone. `Core.getAccountsWithBalances` does not even pass the user
setting through to the client's account list, so the forecast has no access to it.

That is the gap. A user who has told Kawa "this account is savings" has not told the balance
forecast anything, and the forecast's own guess is a substring match on a nullable field.

---

## Two problems visible today

**1. The dropdown is offered for every account, including credit cards.** `BCSettingItem` renders it
for every account in the item without filtering on the aggregator's type, and
`getTypeForAccount` returns *checking* for anything not in `savingAccounts` — so a credit card
displays as "checking" and can be set to "savings". Neither value means anything for a card, and
marking one as savings makes `isTransactionFromSavingAccount` true for every purchase on it.

**2. The forecast and the settings disagree by construction.** They answer the same question from
different data with no reconciliation, and only one of them is visible to the user.

---

## The extension: a third user-set type

Adding *credit card* to the user-set type would let the balance model stop inferring what it can be
told. The findings above constrain how.

**What already supports it**

- The aggregator side needs nothing: `type: "credit"` and `subtype: "credit card"` already arrive,
  are already mapped, and are already in the hash.
- The persistence shape is proven — a list of hashes on the user record, one route, one validator.
- The UI is a dropdown driven off an enum, so a third option costs one entry.

**What does not, and must change**

- **`savingAccounts` cannot hold it.** A single list expresses one boolean. Three types need either
  a second list or — better — a map from hash to type. A map is the shape the feature actually has
  and would let the fourth type cost nothing.
- **The server validator is list-shaped.** `updateSavingsAccounts` checks "array of strings". A map
  needs its own validation, and the migration has to keep reading the old array so an existing user
  is not silently reset.
- **`getAccountsWithBalances` must carry the setting through**, or the forecast still cannot see it.
  This is the change that actually delivers the benefit; the rest is plumbing.
- **The dropdown must be filtered by the aggregator's type.** Offering *credit card* for a depository
  account, or *savings* for a card, invites a setting that contradicts the bank.

**The open design question:** what happens when the user's type contradicts the aggregator's. Two
defensible answers, and it needs deciding rather than falling out of the code:

- *The user always wins* — simple, and lets someone correct a bank that reports a cash-management
  account as `other`.
- *The user may only refine, not contradict* — a `depository` account may be marked checking or
  savings; a `credit` account may only be marked credit card. Safer, and it keeps the hash honest,
  since the hash already carries the aggregator's answer.

**What it would buy the forecast**, in the order the value lands:

1. `spendingHashes` stops being a substring match on a nullable field and becomes a user statement.
2. Multiple cards, multiple checking accounts and joint accounts stop depending on how a particular
   institution words its subtypes.
3. The "is this current account connected to that card" question in
   [`credit-cards.md`](credit-cards.md) gains a declared answer to fall back on when no payment has
   been observed yet.
