# Balance prediction

One ledger per account, running from the transactions that have happened into the money events that
are expected, and the balance that ledger implies at every date it changes.

The module reads a portfolio and runs the stream predictions itself. The balance is a cumulative sum
over a correct ledger, so the ledger is the product and the balance is the last step.

---

## What it hands back

One entry per account.

| field | what it carries | why it is there |
|---|---|---|
| `accountId` | the account the ledger belongs to | An account is where money actually arrives, and a balance is a property of one. |
| `accountType` | `realTime` or `deferred`, from `effectiveAccountType` | A real-time account moves the day the money does; a deferred one accumulates and is settled later. |
| `asOf` | the date the posted half stops and the predicted half starts | One date divides the two halves of the ledger, and every claim in the second half is measured from it. |
| `ledger` | every entry on the account, ordered by date: `{date, amount, source, …}` | The product. Posted and predicted in one list, because a balance does not care which side of `asOf` an entry sits on. |
| `anchor` | `{balance, at}` — the balance the ledger is pinned to and the date it holds | A ledger gives displacements; one known balance turns the whole series into amounts, forward and backward. |
| `points` | `{date, balance}` at every date the balance changes | The cumulative sum of `ledger` from `anchor`. Derived, and named because it is what most questions reduce to. |
| `settlements` | `deferred` only: `{date, close, amount}` per repayment, plus the `offset` fitted for the card and the `fundedFrom` account | A deferred account is paid off rather than drawn down, and the account that pays is a property of the two accounts. |
| `calibration` | per account: `{multiplier, measured, agreement, cycles, cut, reason?}` | The forecast reproduces an account's rhythm and undershoots its size. One number says by how much, and `reason` says why it declined where it did. |

Each `ledger` entry carries `source`:

| `source` | what it is |
|---|---|
| `posted` | a transaction the ledger already holds |
| `predicted` | a money event from a stream's schedule |
| `settlement` | a card repayment this module computed, replacing the predicted one |

A `predicted` entry that the calibration scaled keeps its original figure in `uncalibrated`.

---

## What this module owns, and what it does not

It owns the per-account ledger and the balance over it: which streams are in scope, where their
events land, how a card accumulates and is settled, and how a known balance pins the series.

It does not decide what money moves or when inside a stream — it calls the stream prediction module
for that. Anything that consumes a ledger or a balance is downstream.

---

## §1 — Which streams are predicted

A prediction is worth running for a stream that is still running. A closed stream, and one that has
not moved in the current year, contribute nothing and cost a full shape reading each.

**In.** The portfolio's streams and their transactions.

**Out.** The set of streams the predictions are run over.

**Solved when.** Every stream in the set is open and carries a transaction in the current year, and
every stream outside it fails one of those.

---

## §2 — One ledger per account

A stream's schedule is a list of events each naming the account it lands on. An account's ledger is
every such event, plus every transaction already posted to that account, in one series ordered by
date.

A card repayment is not taken from the schedule. The stream that pays a card predicts an amount read
from past repayments, and the amount that will actually move is whatever the card owes — so those
events are set aside here and recomputed against the card.

**In.** The in-scope streams' schedules, the posted transactions, and `asOf`.

**Out.** `ledger` per account, every entry marked `posted` or `predicted`, with card repayments set
aside.

**Solved when.** Every posted transaction in the captured portfolio appears on exactly one account's
ledger, every predicted event appears on exactly one account's ledger, and no entry appears twice.

---

## §3 — A card accumulates, and is settled

A charge on a deferred account moves no cash on the day it is made. It adds to a balance owed, and
that balance is cleared by a repayment drawn from the account that funds the card. Two accounts move
on the repayment date and the money is one movement.

**One formula, whatever the cadence:**

    repayment(D) = every charge in (previous close, close],   where close = D - offset

A weekly autopay sweep and a monthly statement are the same rule with a different offset. A sweep
clears whatever is outstanding on the day it runs, which is this formula at offset zero; a statement
clears what was outstanding when it closed, days before the money moves, so charges made after the
close roll into the next one. Forking on cadence would be two implementations of one idea, and the
one that never runs on the captured portfolio would be the broken one.

**The dates are not computed here.** The stream that repays a card is read by the same machinery as
any other — on the captured portfolio a weekly lump on day 5 — so the schedule already says *when*.
What it cannot say is *how much*, and that is this section's only contribution.

**The offset is fitted, not declared.** Which purchases a repayment cleared is not stated by any
aggregator. So every offset from zero to a fortnight is tried against the repayments that actually
happened and the one that reproduces them best is kept: on the captured card that is 3 days, with a
mean miss of $139 over 45 repayments. An offset is only identifiable to the nearest charge — every
day between the last charge a close takes and the first it leaves partitions the charges identically
— so the answer is the earliest close consistent with the evidence, and the settlements are the same
across that band.

**One pass over the ledger answers three questions at once.** Every credit on a card is offered to
every real-time account: where that account shows a debit of the same size within five days, the two
are one movement. That single match says the accounts are linked, says both legs are repayments
rather than spending, and names the stream that does the repaying. A refund is a card credit with no
debit to answer for it, which is the whole of the difference — the captured card carries 78 credits,
of which 46 pair and the rest are refunds.

`GenericTransaction.pairedTransferTransactionId` is honoured where it exists and cannot be relied on:
the capture carries eighteen paired transactions and **not one of them is a card repayment**.

**Five days, not three.** At three the portfolio loses five repayments worth $12,661, every one of
them exactly four days apart.

**The predictor labels the modes.** A stream is split by payee, account and direction, so a transfer
always becomes two modes with two separately estimated amounts — on the full ledger +1,355 against
−1,355, rewound to June +763 against −1,300. Recognising a predicted repayment by comparing those
amounts fails whenever they disagree, and recognising it by the mode's account fails when one leg
clears the evidence gate and the other does not. The label travels with the mode instead.

**A repayment is funded by charges that are part posted and part predicted, and the mix moves with
the calendar.** Near a close most of the charges have already happened and the repayment is nearly
exact; early in a period most are still predictions. Predicted charges are scaled by the amplitude
correction before a repayment is computed from them, so a settlement clears what the account is
expected to spend rather than the raw forecast.

**Running this stage twice over the same ledger must not repay its own output.** A settlement is not
a charge; read back as one it would be repaid again, each pass feeding the next.

**In.** The charges on a deferred account, posted and predicted, the account it is funded by, the
statement close date and the offset between that close and the day the repayment is drawn.

**Out.** `settlements`, and the matching entries on both accounts' ledgers.

**Solved when.** Each `settlement.amount` equals the charges outstanding in the window its close
ends, the same amount appears on the funding account's ledger with the opposite sign on the same
date, no predicted repayment event survives alongside it, and consecutive settlements partition the
charges with none cleared twice.

---

## §4 — How much the forecast under-reads an account

The forecast reproduces an account's rhythm and undershoots its size: the card's sawtooth is the
right shape and too small, because the predictable part of an account is not all of it. One number
per account corrects the amplitude without pretending to know what the missing charges were.

**Measured against the account's own past, in one pass.** The question is about an ACCOUNT, never
about any one stream: how much of what lands here does the module's rhythm account for. The numerator
is what each past cycle actually spent; the denominator is one whole cycle of what the module claims
for that account, pro-rated to each cycle's own length. Both sides are linear in the ledger, so this
can run every time a balance is drawn.

It used to rewind the whole capture once per cycle and re-read all sixty-four streams each time:
eight full rebuilds, 2.4 of the 4 seconds a forecast cost, growing with the history asked for. The
linear measure reproduces it — **×1.95 against the rewind's ×1.92 on the captured card, in 2 ms
instead of 2,404 ms.**

**What is given up, said plainly:** the denominator is the module as it reads today, applied to every
past cycle, rather than the module as it would have read at the start of each one. That is the right
question for an amplitude — "what share of this account does my rhythm cover" is a property of the
account and the reading, not of any one month — but it is **not out of sample and must never be used
to score a forecast**. Scoring is the bench's job, and the bench rewinds.

Two windows have to be whole or the number is a calendar rather than a measurement:

| | why |
|---|---|
| the claim is the first whole cycle **after** the capture | the cycle the capture landed in is part spent, and reads as a quiet month |
| a cycle starting before the account's first transaction is dropped | a fraction of a month against a whole one reads as an over-forecast — the card's twelfth cycle back came in at 0.66 against a run near 1.9 |

**Large charges come out of the actual side.** A holiday is not an under-read, it is an event nobody
could forecast, and leaving it in would teach the multiplier to expect a trip every month. The cut is
a percentile of the account's own charge sizes, so a card whose ordinary charge is $40 and one whose
ordinary charge is $4,000 are each judged against themselves. Measured on the captured card:

| percentile | cut | money kept | multiplier | share of spending reproduced |
|---|---|---|---|---|
| 90% | $141 | 46% | ×1.36 | 47% |
| 95% | $200 | 56% | ×1.54 | 54% |
| **99%** | **$1,000** | **72%** | **×1.92** | **67%** |
| 100% | $4,000 | 100% | ×2.50 (clamped) | 87% |

At 95% the cut was $200, which on that card is an ordinary shop rather than an event. At 99% what
falls outside is the holiday and the one-off invoice, which is what the cut is for.

### The correction is two numbers, `a` x `b`

They answer different questions over different windows.

**`a` is the baseline** — the share of an account that never earns a shape. A property of the
arrangement, steady month to month. Read from completed cycles at the **25th percentile**, not the
median: a median mixes the quiet months with the bursts. Measured on the card with the Tahiti trip
removed by hand, the baseline is **1.84**; the quarter reads 1.85, the median reads 1.95 because one
month in ten is a holiday. At one month in three the median would be useless and the quarter would
not move.

**`b` is what is happening now** — read from spend-to-date in the cycle **currently open**, never
from completed ones. A trip is inside the cycle you are standing in. Measured over six mornings
through Tahiti, a `b` built from the last completed cycle was blind to it and bought 1.1 points; read
from the open cycle it bought 10.4. Ground-truth premium for that month was 1.81; this reads 1.58 to
2.00 as the trip becomes visible. It expires at the seam. See `inCycle.js`.

**`b` only acts where the account is a rate, not a diary of bills.** Pro-rating a claim through a
cycle assumes money accrues evenly — true of scatter, false of rent. The first version cut the
current account's rent by two thirds for want of evidence it was never going to have.

Measured, six mornings, 21 days ahead each:

| | card | checking |
|---|---|---|
| no correction | 62.0% | 23.5% |
| `a` alone (median of 12 — the old rule) | 67.0% | 30.7% |
| `a` alone (quiet cycle) | 66.7% | 30.2% |
| **`a` x `b`** | **67.3%** | **39.8%** |

**The cut applies to both sides of the ratio, and to what the multiplier is later applied to.** It
came off the actual side only, so a month of ordinary spending was measured against a forecast that
included a $2,626 instalment - the ratio then measured the size of the lump rather than the size of
the under-read. And the multiplier was applied to that instalment too: a charge the module already
predicts correctly, scaled by a factor measured on groceries. Rewound to 25 July it forecast Gembah
at $6,565 and repaid the card for it three days later.

| | before | after |
|---|---|---|
| Gembah, 28 July | -$6,565 | **-$2,626** (actual -$2,626) |
| first settlement, 31 July | -$7,531 | **-$3,592** (actual -$3,498) |
| measured ratio | 1.92 | 2.66, clamped to 2.50 |

The multiplier rises because the denominator was padded: removing the lumps from the forecast side
shows the small-charge coverage for what it is. Below the cut is the only place this correction was
ever measured and the only place it may act.

**It engages only where the bias is one-sided**, and says so when it declines:

| it declines when | on the captured portfolio |
|---|---|
| the ratios straddle 1.0 | the current account — 0.47, 0.99, 1.20, 1.79 — its forecast is already unbiased and scaling would add noise |
| fewer than four usable cycles | the savings account |
| a cycle the ledger only partly covers | before the account's first transaction, or the part-spent cycle the capture landed in |

**In.** An account's posted charges, and what the module would have forecast for each past cycle.

**Out.** `calibration` per account.

**Solved when.** The multiplier is the median ratio over the usable cycles, is 1 wherever the bias is
not one-sided, and scaling by it leaves the settlements clearing the scaled charges rather than the
raw forecast.

---

## §5 — Pinning the ledger to a balance

A ledger gives displacements. One balance that is true on one date turns the series into amounts:
later balances are the anchor plus what follows it, earlier ones the anchor less what preceded it.

**The anchor should be the most recent closing balance that agrees with the ledger.** A reported
balance can be stale, and it can disagree with the ledger because a transaction posted the same day
and one of the two sources carries it while the other does not. The rule against that is: where a
day's closing balance does not reconcile against the ledger, use the previous day's and carry it
forward through the transactions since.

**That rule cannot run on what the capture holds.** An account carries `current` and `available` and
nothing else - one number, no date, no history - so there is no previous day's balance to fall back
to and no second reading to reconcile against. The anchor is therefore the reported balance taken as
true on `asOf`, and the ambiguity it cannot rule out is reported rather than hidden: `sameDay` counts
the transactions posted on the anchor's own date, which is exactly the case where a reported balance
may or may not include them. On the captured portfolio that count is zero for every account, so the
question does not bite here - it will on a live capture, and the rule above is what to implement when
the connector contract carries dated balances.

**A card's balance is the other way up.** `current` counts what is OWED, so it reads positive while
the account is in debt, while every charge in this ledger is negative and every repayment positive.
The two conventions are reconciled once, in the anchor: a deferred account's anchor is minus its
reported balance. The captured card reports 609.86 and anchors at -609.86.

**In.** An account's reported balance, its ledger, and `asOf`.

**Out.** `anchor`, `points` (one per date the balance moves, not one per entry), `opening`,
`closing`, `sameDay`.

**This runs last, over the finished ledger.** Settlements included - pin before them and the card's
curve never comes back up.

**Solved when.** For every account in the captured portfolio, the last point at or before `asOf`
equals `anchor.balance`, and `points` is the running sum of `ledger` carried in both directions from
it. Measured:

| account | opening | anchor on 9 Sep | closing on 8 Dec |
|---|---|---|---|
| Robinhood Credit Card | -223.87 | -609.86 | -570.46 |
| Spending Account | 10,581.77 | 692.13 | 773.20 |
| Savings Account | 0.25 | 36,347.69 | 54,347.69 |

---

## Exit criteria

For every account in the captured portfolio: the ledger holds every posted transaction and every
predicted event exactly once, card repayments are computed rather than predicted, and `points`
reconciles to a reported closing balance at `asOf`.

---

## Decided

- **The ledger is the product; the balance is a cumulative sum over it.** A correct ledger makes the
  balance trivial, and no amount of balance arithmetic rescues a wrong one.
- **The module runs the stream predictions itself.** Events are an intermediary, not an input.
- **`asOf` is the present.** A fixture pins it because a fixture is a photograph; a connected
  portfolio is read as it stands.
- **The anchor is a balance at a date, and that date is chosen by reconciliation** rather than
  assumed to be today.
- **A card repayment is computed from what the card owes**, and the predicted repayment event is
  discarded rather than reconciled against it.
- **Predicted charges are what fund a settlement, and the shortfall shrinks as the close
  approaches.** The alternative is inventing charges for streams that were deliberately left
  unpredicted.
- **A refused movement changes no balance.** It carries a zero amount and the reason it was refused.
- **One rule finds the repayments**, and it answers the link, the legs and the repaying stream in the
  same pass. Three overlapping heuristics disagreed at the edges.
- **One formula sizes them**, at whatever cadence, with the offset fitted from the account's history
  rather than assumed.
- **The amplitude is corrected per account and only where the bias is one-sided.** A calibration that
  fires on noise is worse than none.
- **The correction is `a` x `b`: a baseline from quiet completed cycles, a premium from the cycle
  currently open.** A burst is inside the cycle you are standing in, so no window of completed cycles
  can see it.
- **And only below the cut it was measured with.** A charge excluded from the measurement for being
  an event rather than a rate must not be scaled by a factor measured on rates.
- **The anchor is a single undated number, and says so.** The capture carries no balance history, so
  the reconcile-and-fall-back rule is specified and not implemented; `sameDay` reports the one
  ambiguity it would have resolved.
- **A card's reported balance is flipped once, in the anchor**, not in each caller.
- **A forecast is judged against the same month, rewound.** Comparing it to a different month
  measures the difference between two months. That is SCORING, and it stays in the bench.
- **The amplitude is measured linearly and per account**, from the build it corrects. It runs on
  every page load, so it cannot cost eight rebuilds.
- **Scope is a stream that is open and has moved this year.**

---

## Still open

1. **Where the close date and the offset come from.** Which purchases a repayment cleared is not
   stated by the aggregators and is reconstructed from dates and amounts. Whether that reconstruction
   belongs here or is taken as input is not settled.
2. **A card with no paired repayment in the ledger.** The link needs a pair with one leg on each
   account; a card repaid from an account that is not connected, or never repaid inside the captured
   window, has none. The captured portfolio carries eighteen paired transactions across three credit
   accounts.
3. **Whether a reported card balance is the current balance or the statement balance.** It decides
   nothing about a funding account's ledger, which is what a forecast is read for, and everything
   about drawing the card's own balance. Detecting which one an account reports, and declining to
   draw the card balance at all, are both live.
4. **What a balance claims about certainty.** Every predicted event carries how sure the prediction
   is that money arrives and how sure it is of the day. What those two confidences mean for a balance
   — a band, a set of curves, or nothing — is not settled.
5. **Transfers between two projected accounts.** A movement out of one account and into another is
   one movement and two entries, and whether the ledgers are built independently or together decides
   whether it can be double-counted.
6. **An account whose reported balance is older than its ledger.** The reconciliation walks back a
   day at a time; how far back it is worth walking before the balance is treated as absent is not
   settled.
