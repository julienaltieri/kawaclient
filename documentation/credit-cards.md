# Credit cards, and the account they are paid from

> **What this file owns:** the relationship between a credit card account and the current account
> that pays it — why a card cannot be modelled as a stream, how its payments are identified, how a
> statement is reconstructed, and the ways real portfolios break each of those.
>
> It does **not** own the balance chart, the stream forecast, or the accuracy bench. Those are
> [`bank-balance.md`](bank-balance.md). This file is the half about cards.

---

## Why a card is not a stream

Every other flow in Kawa moves money on the day it happens. A card does not.

A purchase on a credit card **does not touch the current account**. It accumulates on the card. Some
days or weeks later a single payment leaves the current account and clears a batch of those
purchases at once. The bank shows both sides — the purchases on the card account, the payment on the
current account — and nothing in the data says which purchases the payment cleared.

So a card is an **account with its own accumulation and its own discharge**, and every difficulty in
this file follows from that one lag. A stream model has no way to express "these forty small things
became one large thing, later".

---

## Vocabulary

Used consistently across the code, the bench and this file. Where the code says something different
it is a bug in the code, not a synonym.

| Term | Meaning |
|---|---|
| **card account** | A connected account of type `credit`. One account may back several physical cards. |
| **purchase** | A transaction *on the card account*, money going out. |
| **refund** | A transaction on the card account, money coming back, that is **not** a payment. It undoes a purchase. |
| **payment** (or **settlement**) | A transaction *on the current account*, money leaving to pay the card down. The only card money that ever touches the current account. |
| **statement** | The set of purchases that one payment clears. |
| **close date** | The last day a purchase can join a statement. Purchases after it roll to the next one. |
| **offset** | Days between close date and payment date. |
| **interval** | Days between one payment and the next. |
| **pass-through** | payment ÷ that statement's purchases. 1.0 for a card paid in full. |
| **rate** | Average purchases per day, used *only* to estimate purchases that have not happened yet. |

---

## The five things that are always true

These hold for any card, any bank, any country. Everything else in this file is inference on top of
them.

1. **A purchase does not move the current account.** Any reading of the current account must
   therefore exclude every stream whose money leaves via a card — otherwise the spending is counted
   on the day it was charged *and* again inside the payment.
2. **A payment does move it,** and it is the only card money that does.
3. **A statement closes before it is paid.** The gap is small (days) but it is never zero, and
   ignoring it loads the imminent bill with spending that has not been billed yet while starving the
   next one.
4. **Once the statement has closed, the bill is arithmetic, not a forecast.** Every transaction on it
   is already in the ledger. A card forecast made after the close and before the payment should be
   near exact; if it is not, the fault is in the mapping or the offset, not in any estimator.
5. **A card account carries three kinds of transaction, not two.** Purchases out, payments in,
   refunds in. Treating refunds as purchases makes a returned item a permanent charge and inflates
   every statement window it falls in.

---

## Identifying a payment

Nothing in bank data is labelled "this is a credit card payment". It has to be inferred, and the
inference has four rungs, strongest first. See `cardPaymentStreams` and `inferSettlements` in
[`BankBalance.js`](../src/processors/BankBalance.js).

### 1. The stream that straddles the boundary

A card payment is the one transaction visible from both sides: a leg leaving the current account and
a leg arriving on the card, categorised to the same stream. Nothing else in a portfolio does that.

**Touching both sides is not sufficient**, and assuming it was is the single most expensive mistake
made here. Groceries get bought on a card some weeks and on a debit card others; childcare is paid by
card one month and by transfer the next. Those streams straddle the boundary too, and treating them
as card payments excludes them from the forecast entirely — real outflow silently deleted.

What makes a card payment different is that it **cancels**: the current-account legs are negative,
the card legs are **positive**, and they roughly sum to nothing. A grocery stream is negative on both
sides however it is split, and a refund does not rescue it — refunds are small beside the spending
they come from.

The cancellation test is deliberately **one-sided**: the card may not receive more than the account
paid out, but the account may legitimately pay out *more* than the cards receive, because a card
whose connector returns no payment receipts contributes outflows and no receipts at all.

### 2. Receipt matching — proof

A payment of amount *X* on the current account, and a positive transaction of the same *X* arriving
on a named card within a few days, is that card's payment. This is the only rung that is proof rather
than inference, and it is what makes the weaker rungs safe: everything provable is settled first, and
the rest is attributed only afterwards, against the rhythm the proven ones established.

### 3. Same-day attachment — the other card on one account

A payment on the same day as an already-proven settlement, on the same payment stream, is another
card on that account. There is nothing else it could be.

This rung exists because rung 4 **cannot** work for it: the amount test compares a payment against a
window of the *account's* purchases, pooled across all its cards, and the purchase feed carries no
card identifier to split by. One person's share of a joint account is a fraction of a week of joint
spending, so no window of any length matches it at any offset.

### 4. Amount-window matching — weakest, and gated

For a payment with no receipt and no same-day anchor: attribute it to the card whose recent purchases
it is the size of. Only for transactions the user has already categorised to a card payment stream,
and only to a card whose established rhythm the date fits — otherwise every outflow in the account is
offered to the card model and one of them is always the closest size.

---

## Reconstructing the statement

Once the payments are known, four parameters describe the card. They are fitted once from all
available history and then held, because they are properties of the account rather than of the window
being forecast. See `cardCycles`.

**Interval** — the median gap between payments, snapped to exactly 7 or 14 days, or pinned to a day
of the month. A raw median drifts: 30.4 walks a monthly card backwards through the month, and one
missed payment shifts every date after it.

**Offset** — found by sliding the statement window until its purchases add up to the payment. That is
the question asked directly: a window aligned with the real statement period contains exactly the
purchases that bill on it. The comparison is made *after* the best single pass-through, so a card
that revolves is not mistaken for a misaligned one — paying a consistent fraction is a level, not an
alignment, and scoring the raw difference chases the level with the offset and lands on neither.

**Pass-through** — the median of payment ÷ window purchases, clamped to a sane band.

**Rate** — average daily purchases over a trailing window, used only for days that have not happened
yet.

### The prediction

```
close   = payment date − offset
posted  = purchases in (previous close, close] already in the ledger    ← known, not forecast
ahead   = max(0, close − today)                                         ← 0 once the statement shuts
bill    = (posted + named lumps + rate × ahead) × pass-through
```

The three components of the estimate partition the statement: what has posted, what a named stream
says is still coming, and a residual rate for everything else. They must partition it — naming a
stream while leaving its history in the rate bills it twice, and adding every card stream while
removing only the named ones does the same to the diffuse majority.

### Why rate and pass-through are not double counting

They look like two multiplications of the same quantity. They are not, and the reason is worth
holding onto:

Pass-through is fitted as payment ÷ the purchases the model **can see**. If it can see only half of
them, pass-through comes out twice as large, and the product of the two is unchanged. **The pair is
self-correcting against an incomplete purchase feed** — up to the clamp, and only up to it.

So a pass-through sitting *at* the clamp is not a revolver. It is a purchase feed with a hole in it,
and it is the first number to read when a card's bills come out short.

---

## Where a rate stops helping

A daily rate describes a trickle well and cannot represent a single large charge at all. On a real
portfolio, three charges over $500 in twelve weeks were $7,665 of $12,345 paid, and statements ranged
sevenfold. Backtested one step ahead, every rate method — flat, recency-weighted, robust trend,
quantile, mean of recent statements — landed within a small margin of *the best possible constant*.
No smoothing recovers a lump.

Lumps have names, though. A card-routed stream the model already forecasts as an event can be folded
into its card's next bill by name, with its history taken out of the rate. That is the only way the
projected half of a bill improves; the rest is the closing offset, which converts guesswork into
arithmetic a few days early.

---

## Edge cases

Every one of these was met in real data or is a direct consequence of the five facts. Where the
current code handles it, the handling is named; where it does not, that is stated.

| Case | Consequence | Status |
|---|---|---|
| **Two cards, one account, paid the same day** | Two payments, one statement. Left unmerged the gap between them is zero, which drags the median interval toward nothing and every parameter fitted against it. | Merged into one statement before anything is measured. |
| **Two cards, one account, paid on different days** | The rhythms interleave; gaps alternate (3, 4, 3, 4) and a median reports 3.5. That is a different model, not a worse fit of this one. | **Detected and reported, not modelled.** |
| **A card that returns no payment receipts** | Rung 2 finds nothing. Half the payments — or all of them — go missing, and the card is modelled at a fraction of its size. | Rungs 1, 3 and 4 cover it. |
| **A closed card** | Its history is intact, so a schedule chained off the last payment forecasts money leaving an account that no longer exists, for ever. | Dormant after three intervals of silence, floored at two months so a late card is not written off. |
| **A card that revolves** | Pass-through below 1. Genuine, and must not be corrected away. | Fitted, and the offset search is made scale-invariant so the two are not confused. |
| **A purchase feed with a hole** | Pass-through rises to compensate and pins at the clamp; bills come out short. | Detectable — the clamp is the tell. Not automatically corrected. |
| **Refunds** | Read as purchases, they make returned items permanent charges and inflate statement windows. | Netted; a positive transaction is a payment receipt only if a settlement of that amount cleared the card nearby. |
| **A dominant single charge** | Sevenfold statement variation. Unpredictable from any rate. | Addressed only where the charge belongs to a stream that has become predictable. |
| **A card paid from an account Kawa cannot see** | Purchases accumulate with no payment ever found. The card looks dormant or unpayable. | **Not handled.** A current account with no connected card must not be given synthetic settlements. |
| **A payment covering several cards at once** | One current-account transaction clearing two card accounts. Rungs 2–4 attribute it to one. | **Not handled.** |
| **An irregular payment** — a skipped week, two in one week | Distorts the median interval and inserts a short window into the offset fit. | Tolerated by medians; a single irregular gap is absorbed. |
| **Foreign currency and travel** | Bursty spending, unrelated to the card's usual rate, often across a statement boundary. | Not special-cased; shows up as rate error. |
| **A stream split across card and current account** | Looks like a payment stream to a naive test. | Excluded by the cancellation test. |

---

## A worked example

One real portfolio, as an illustration of the shapes above — **not** as a definition of what is
normal. Every number here is a property of that account.

- **Three connected card accounts.** One live (weekly payments, offset 3 days, pass-through 96%), two
  closed for nearly a year with intact history — the case the dormancy rule exists for.
- **Two physical cards on the live account**, one per person, but **one payment per statement**. The
  two-payments-per-statement case was assumed for a while on the strength of a settlement count and
  turned out not to apply; the export settled it.
- **Statements ranged $537 to $3,629** in twelve weeks. Three charges over $500 — a supplier invoice
  twice, an airline once — were $7,665 of the $12,345 paid.
- **Payment ÷ purchases had a median of 0.99** across those statements, which is what "the feed is
  complete" looks like, and is what ruled out a missing-data explanation for the card's error.

---

## How to find out what a card is actually doing

The bench's **card export** prints the evidence rather than the conclusions: every statement with its
payments and the purchases that made it up side by side, the fitted parameters, the rate under
several bases, and the raw purchases underneath. See `cardExport` in
[`BalanceBench.js`](../src/components/BalanceBench.js).

Read it in this order:

1. **Payment ÷ purchases per statement.** Near 1.00 every row means the feed is complete and any
   remaining error is in the rate. Around 0.5 means spending is missing and no modelling recovers it.
2. **Pass-through against its clamp.** At the clamp means a feed hole, not a revolver.
3. **Payments per statement.** Greater than one means several cards on the account.
4. **The named streams line.** Which lumps, if any, are being forecast by name rather than averaged.
