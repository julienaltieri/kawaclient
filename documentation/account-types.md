# Account types: what the bank says, and what the user says

> **What this file owns:** the two notions of "what kind of account is this" — the one the aggregator
> reports and the one the user sets in Settings — how the second overrides the first, where each is
> stored, and which parts of the app read which.
>
> It does **not** own how a credit card is modelled — that is
> [`credit-cards.md`](credit-cards.md) — nor the balance forecast, which is
> [`bank-balance.md`](bank-balance.md).

---

## There are two account types, and they are not the same thing

**The aggregator's type** comes from the bank via Plaid or Powens. It is a fact about the account:
what the institution says this thing is.

**The user's type** is a setting in Settings — *checking*, *savings* or *credit card*. It is a fact
about how they treat it, which is a different question and sometimes has a different answer.

The second **overrides** the first, and is pre-populated from it. The aggregator's answer is the
default and never a constraint, because someone who routes savings onto a credit card is right about
their own money and Plaid is right about the account, at the same time.

Only one of the two is a fact about the world. Most of the confusion in this area comes from assuming
there is one type rather than two.

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

## The account hash is a uniqueness key, not a type

`BankAPI.getAccountHashFromData` builds:

```
hash = institutionId + "::" + signature + "::" + type
```

The type appears in it, but **the hash is not how account type is identified**. Its job is to
identify one account uniquely and stably across refreshes, logins and joint access, and the type is
in there as part of what makes it unique. Nothing reads a type back out of a hash, and nothing
should.

It stays exactly as it is. The user-set type is a **separate property keyed by that hash**, which is
what lets someone change how an account is treated without changing what the account *is* — every
transaction ever recorded still resolves.

---

## What the user sets, and where it lives

Three values — **checking**, **savings**, **credit card** — chosen per account in Settings.

**The dropdown is pre-populated from the aggregator**, so the common case needs no decision from
anyone. What is stored is only what the user has actually chosen: an account nobody has touched has
no entry at all, and answers to whatever the bank says.

**The user's choice overrides the bank's, and is not required to agree with it.** The choice is
about *treatment*, not taxonomy: a credit card someone routes savings into is a savings account to
its owner, whatever Plaid calls it, and the app has no business arguing. This was a real decision
with a defensible alternative — letting the user only *refine* the aggregator, never contradict it —
and it was decided in favour of the user.

**Client** — `AccountTypes` in [`Bank.js`](../src/Bank.js) is the enum, and that file also holds the
only two functions that answer "what kind of account is this": `inferAccountType` (the bank's answer,
narrowed to the three) and `effectiveAccountType` (the user's, falling back to the bank's). Nothing
else in the client decides an account's type. `BCSettingItem` in
[`SettingPage.js`](../src/components/SettingPage.js) renders the dropdown.

**Storage** — a map of account hash to chosen type, on the user record as `accountTypes`.

**Server** — `UserData.updateAccountTypes` validates it, and `updateBankAccountSettings` dispatches
on the body's shape so the one route takes either the map or the original savings array. That is what
makes the client and server deployable in either order: an older client keeps sending the array, and
a newer client against an older server degrades to savings-only rather than losing the setting
entirely.

### savingAccounts still exists, and is still the answer to one question

`savingAccounts` is the original list and remains the source of truth for the **saving-versus-spending
distinction** — whether an outflow was an act of saving or an act of spending. That is the only thing
the rest of the app asks a type for, and it is a boolean, so a list is the right shape for it.

The server keeps it in step with the map on **every write**, in both directions, so nothing that
reads it needs to know the map exists. A user whose settings predate the map is migrated on read.

**Checking and credit are indistinguishable to that question, deliberately.** Money spent on a card
is spending. Only the balance forecast needs to know it is a card, because only it has to model money
leaving the checking account later and in a lump.

---

## Who reads which

| Consumer | Reads | Notes |
|---|---|---|
| `TransactionEvaluator` | **effective type** | via `Core.isSavingAccount`; only asks "is this savings" |
| Balance forecast — `creditHashes` | **effective type** | the only consumer that needs the third value |
| Balance forecast — `spendable` | **effective type** | anything not credit, with a balance |
| Balance forecast — `spendingHashes` | **effective type** | the accounts the user calls checking |
| Balance anchor | **effective type** | credit balances are subtracted, since Plaid signs money owed positive |

All of them go through `Core.accountTypeOf`, which is `effectiveAccountType` with the user's
overrides applied. There is one resolver and no second opinion.

`Core.getAccountsWithBalances` carries the aggregator's `type` and `subtype` to the client, and the
resolver reads them together with the overrides — so the forecast sees the user's answer without the
account list having to be pre-resolved.

---

## Two things this fixed

**The forecast used to ignore the user entirely.** It decided what a spending account was by
substring-matching `"check"` against the aggregator's nullable `subtype`. Someone who had told Kawa
an account was savings had told the forecast nothing.

**The dropdown offered checking or savings for every account, including credit cards** — so a card
displayed as "checking" and could be set to "savings", which made every purchase on it look like a
transfer into savings.

### And one fallback that was removed rather than kept

`spendingHashes` used to fall back to *every* depository account when no subtype matched `"check"`.
That existed because the old rule required the subtype to contain the word, so an account with no
subtype matched nothing and the chart came out empty. `inferAccountType` now defaults anything that
is neither credit nor savings to checking, so that case cannot arise — and keeping the fallback would
have turned it into something worse: it would have handed back an account the user had just marked as
savings, contradicting them. An empty runway is the honest answer when someone says they have no
current account.

---

## What is left open

- **The map is written whole.** Every save sends every override. That is fine at a handful of
  accounts and would not be at a hundred.
- **The legacy fallback in `Core.saveBankAccountSettings`** retries as a savings-only array if the
  map is rejected. It exists only so the two sides can be deployed in either order, and should be
  deleted once the deployed backend is known to accept the map.
- **Nothing validates a type against the aggregator's.** By design — the user may contradict the
  bank. But there is no way for them to see that they have, and a contradiction is far more likely to
  be a mistake than an intention.
- **The three types are the three the app needs, not the ones Plaid has.** `loan`, `investment` and
  the rest collapse to `other` at the connector and then to *checking* at the resolver, which is
  wrong for a mortgage and harmless only because such accounts carry no spending. A fourth value
  would be the fix if those are ever connected.
