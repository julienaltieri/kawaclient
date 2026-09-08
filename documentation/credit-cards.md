# Credit cards

> **What this file owns:** how a credit card account behaves, how it is linked to the checking
> account that funds it, and what can be described about it in each of the two situations — when the
> card's own transactions are visible, and when they are not.
>
> It does **not** own the balance forecast, which is [`bank-balance.md`](bank-balance.md), nor how an
> account comes to be typed as a card, which is [`account-types.md`](account-types.md).

---

## Scope of what is stated here

These are **observations of US cards**, seen through Plaid and Powens. They hold as a general rule
and are a reasonable starting assumption elsewhere, but other countries and other issuers have not
been researched and exceptions should be expected rather than treated as faults.

---

## Two situations, and they are not the same problem

A credit card usually has a bank account linked to it, from which its repayments are drawn. What can
be said about the card depends entirely on how much of that is connected.

**Only the funding side is connected.** The repayment is visible leaving the checking account; the
purchases on the card are not visible at all. The card is then an ordinary expected outflow, and it
is treated as one: predict an amount and a timing, and nothing more. There is no second side to
reconcile against.

**Both sides are connected.** Purchases are visible on the card account and repayments on the
checking account. Only here is reconciliation possible: the charges that accumulate on one side can
be related to the amount that leaves the other.

Everything below the vocabulary applies to the second situation.

---

## What declares an account a card

The account type set in Settings. An account declares itself `credit` there, and **that is the only
source of truth** — it is not inferred from the institution, the account name, or anything else. See
[`account-types.md`](account-types.md).

Two consequences worth stating plainly:

- **A card account is not a checking account.** A view of a checking account does not formally
  contain card transactions, because that money has not moved through it.
- **A card and the checking account that funds it need not be at the same institution.** Robinhood
  cards funded from an Ally checking account are one real example.

---

## Vocabulary

| Term | Meaning |
|---|---|
| **card account** | An account typed `credit`. One account may back several physical cards. |
| **checking account** | An account typed `checking`, from which repayments are drawn. |
| **purchase** | A charge on the card account. |
| **repayment** | A transaction on the checking account that pays the card down. |
| **statement** | The set of purchases one repayment covers. |
| **close date** | The last day a purchase can join a statement. |
| **offset** | Days between the close date and the repayment date. |
| **interval** | Days between one repayment and the next. |

---

## What is observed

1. **A card accumulates charges until a repayment falls due**, and the repayment reaches the checking
   account on the repayment day. The charges themselves do not move the checking balance as they
   happen.

2. **A repayment is expected on a due date.** Autopay is typically available and commonly used, so a
   card usually follows a set schedule — but the schedule is at the account holder's discretion and
   can be changed. Switching autopay from weekly to monthly to smooth a cash-flow mismatch is a
   normal thing to do, and the schedule observed last month is not a guarantee about this one.

3. **There can be a gap between the last charge a repayment covers and the day it is paid.** That gap
   is the offset. Its size varies by issuer and it is measured rather than assumed.

4. **Which purchases a given repayment cleared is not stated** in the data currently available from
   these aggregators. It has to be reconstructed from dates and amounts. This is a statement about
   the APIs as they are today, not a permanent property of the problem — they change.

---

## Linking a card to the checking account that funds it

**Through paired transactions.** The data model already pairs the two legs of a transfer:
`GenericTransaction` carries `pairedTransferTransactionId`.

When a pair has **one leg on a checking account and the other on a credit account**, that pair is a
repayment — and it establishes that this card is funded by that checking account.

That is the whole mechanism, and it deliberately does not involve streams or categorisation. A
stream is a budgeting concept and the link between two accounts is a fact about the accounts.

Once the link is established, paired checking↔credit transactions are handled by **intentional
arithmetic** in whichever balance is being described:

- **Describing the checking balance** — the repayment is an outflow on the day it leaves.
- **Describing the card balance** — the same transaction clears the accumulated charges.

The same pair, read from each side, with the sign it has on that side.

---

## Describing a card's rhythm

Two of these belong to the account. Two do not, and the distinction matters when reading them.

### Parameters of the card account

| | |
|---|---|
| **interval** | Days between repayments. A property of the account's schedule. |
| **offset** | Days between close and repayment. A property of the issuer's statement cycle. |

### Derived from behaviour

| | |
|---|---|
| **pass-through** | Repayment ÷ the charges in its statement window. Describes whether the balance is cleared in full. |
| **rate** | Average daily charges. Describes how the card is used. |

These two are **empirical summaries, not settings**. Nothing about the account fixes them; they are
what the last few statements happened to look like, and they exist for one purpose only — to say
something about charges that have not been observed yet.

---

## Estimating the next repayment

```
close        = repayment date − offset
observed     = charges already recorded in (previous close, close]
unobserved   = rate × days between today and close        → zero once close has passed
repayment    ≈ (observed + unobserved) × pass-through
```

**`observed` is arithmetic on transactions already in hand.** The derived quantities apply only to
`unobserved` — the part of the statement that has not happened yet. Once the close date has passed
there is no unobserved part, and the estimate is a sum rather than an estimate.

Where a charge that has not yet happened is nonetheless *known* — a recurring charge on the card with
an established amount and date — it belongs in `unobserved` by name, and the rate then describes only
what is left over. A rate is an average and cannot represent a single large charge at any smoothing.

---

## Edge cases

| Case | What happens |
|---|---|
| **Several physical cards on one account, repaid on the same day** | Several repayments, one statement. They belong together; the interval between them is not a cycle. |
| **Several cards on one account, repaid on different days** | Two schedules interleave on one account. A single interval and offset describe neither. |
| **A card that returns no repayment leg on the card side** | Only the checking-side transaction exists, so the pair is incomplete and the link cannot be established from it alone. |
| **A card that stops being used** | History remains complete and a schedule projected from the last repayment keeps producing repayments that will not happen. |
| **A card carrying a balance** | Pass-through below 1: the repayment covers only part of the statement. Normal, and not an error to correct. |
| **A purchase feed that is incomplete** | Charges are under-counted, so pass-through rises to compensate and can exceed 1. A pass-through above 1 is a statement about the data, not about the card. |
| **One statement dominated by a single large charge** | Statement totals vary severalfold, and no rate describes them. |
| **A card repaid from an account that is not connected** | Purchases accumulate with no repayment ever visible. |
| **One repayment covering several card accounts** | A single checking transaction against more than one card. |
| **An irregular repayment** — one skipped, or two close together | The interval measured across it is not the schedule. |
| **Refunds** | Money returning to the card. Not specific to cards — debit accounts have them too — and small enough to be accepted variance rather than modelled. |
| **Foreign currency and travel** | Charge volume unrelated to the card's usual level, often spanning a close date. |

---

## A worked example

One connected portfolio, as an illustration of the shapes above rather than a definition of what is
normal.

- **Three card accounts, one in use.** The live one is repaid weekly with an offset of three days and
  clears its statement in full. The other two have complete history and no activity for close to a
  year.
- **Two physical cards on the live account**, one per person, repaid by a single transaction per
  statement.
- **Statements ranged $537 to $3,629** across twelve weeks. Three charges over $500 — a supplier
  invoice twice, an airline once — accounted for $7,665 of the $12,345 repaid over that period.
- **Repayment ÷ charges had a median of 0.99** across those statements.
- The card is issued by Robinhood and funded from an Ally checking account: the link is between two
  institutions, not within one.
