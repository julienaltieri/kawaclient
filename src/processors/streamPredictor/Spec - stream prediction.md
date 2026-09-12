# Stream prediction v2

> **THE SPECIFICATION FOR v2. Nothing here is built.** No consumer adopts it until the exit criteria
> are met, by Julien's judgment; whatever predicts today keeps doing so, unchanged, until then.

---

## Purpose

**The module that owns the prediction algorithm and the logic for predicting the transactions of a
given stream.**

Given a stream and its transactions, it says what that stream will do next — on which account, how
often, in what shape, and for how much — and how sure it is of each.

**Everything it needs comes in as arguments and everything it decides comes out as a value.** It holds
no opinion about balances, no reference to a chart, and no knowledge of which reading it is being asked
for. That is what makes it testable on its own and replaceable without touching what draws.

**It answers per account, and accounts are plural.** A user may connect several checking accounts and
several cards. A stream relates to one of them — sometimes to two — and a balance is drawn for each. A
prediction that says only "$1,700 on the 6th" is not usable; it must say *out of which account*.

**It predicts, and every prediction carries what is needed to judge it.** A stream the module is
unsure of is distinguishable from one it is sure of through the **confidence**, and each prediction
carries a **record of how it was arrived at**. How much further it should account for itself is not
settled here — a fuller explanation is a debugging need, and gets built when there is something to
debug.

Each of the six below is a sub-problem to solve for, and each will carry its own logic and its own
output contract.

---

## What it hands back

**One prediction per stream, carrying a schedule of the events expected from it.** A list of things
expected to happen answers "when is the next one" without the caller reconstructing it.

**The answer sits at two levels.** The decisions are taken once per stream and the occurrences are many,
so flattening them into one row would repeat each decision on every event and imply it could differ
between them.

**The prediction** — one per stream:

| field | what it is | why it is there |
|---|---|---|
| `stream` | which stream this is about | — |
| `cycleDetermination` | where the cycle came from: **the declaration**, or **inferred from the transactions** | For most streams the cycle matches the declaration. Yearly streams are where it comes apart: a stream is often declared yearly out of uncertainty, and the pattern inside it only shows up in the transactions later — so an inferred cycle can legitimately disagree with what was declared, and which of the two produced it has to be visible. |
| `inferredCycle` | a `Period` (`src/Time.js`) — monthly, semi-monthly, every seven days | The declared period and the cycle used are two different facts, and for an overridden yearly stream they disagree. Without this field the cycle that produced the events is named nowhere, and re-deriving it from the events is guesswork. |
| `inferredShape` | which shape was determined | Some streams behave like a spread, some like one big transaction, some like a few medium ones. This field characterises which of those to expect, as the logic determined it. |
| `inferredAmount` | the expected amount for one `inferredCycle` — −$157 a month, −$1,700 a semi-month | The number the schedule is generated from. Stating it separately makes an event list checkable against what it was meant to add up to, instead of leaving the intended total to be recovered by summing the events. |
| `amountDetermination` | the method that produced that amount | A label rather than the reasoning: "the trailing mean". It sits on the prediction rather than on the event because it does not differ between them — the method that produced the amount is the same method for every event it produced. |
| `transactionBase` | the transactions this prediction was derived from — the reference format is not yet decided | What makes a prediction auditable. The common disagreement is not "is this rule right" but "did it look at what I think it looked at" — a shape read from four transactions when the stream has two hundred is a different problem from a wrong rule, and the two are indistinguishable without this. |
| `predictedEvents` | the schedule — an array of future events, of the shape below | The module's output is this array. Everything else on the prediction describes how the array was produced. |

**An event** — one per expected movement:

| field | what it is | why it is there |
|---|---|---|
| `date` | when the event is expected | — |
| `amount` | how much moves | — |
| `account` | which account it moves through | — |
| `confidence.date` | how sure the module is about *when* | Confidence is attached to each event because it varies from one event to the next, even under the same model: the next movement of a drifting stream is more certain than the fifth. |
| `confidence.amount` | how sure the module is about *how much* | Kept separate from `confidence.date` because date and amount fail independently: a card statement is sure to land on time but not for how much, and an erratic yearly envelope can be the opposite. |

## What this module owns, and what it does not

**Owns:** the behaviour of a single stream — its account, its cycle, its shape, its amount, and the
uncertainty on each.

**Does not own: anything that consumes a prediction.** That belongs to whatever feature needs it.

**Takes as given:** the account list with types, the transaction ledger, the stream's declaration
(amount and period, with its history), and an **as-of date**. Nothing else.

**The as-of date bounds every other input.** Only transactions strictly before it are visible, to any
stage, for any purpose — so the module is a pure function of that instant, and can be run against a
past date to see what it would have predicted then.

---

## §1 — Mapping accounts to streams

**The question.** This is a **classification**: mapping accounts to streams. Given a stream and its
transactions, **which connected accounts did its money move through, and in what proportion?**

**The answer is always a partition, never a single account.** A stream with one home is a partition of
one; a stream paid two ways is a partition of two. There is no separate exceptional shape, so nothing
downstream has to handle two.

**In:** the stream, its transactions, the account list with types.

**Out:** a `partition` — an array of `accountAllocation`, one per connected account the stream's money
moved through.

| `accountAllocation` | what it is | why it is there |
|---|---|---|
| `accountId` | the connected account | **No primary account is named here.** Choosing one representative account is a decision that belongs to whatever needs a single answer, and it is made from these weights. Naming a primary at this layer would bury that choice in a stage that has no idea what it is for, and every caller that disagreed with it would have to undo it. |
| `accountType` | **`realTime`** or **`deferred`** — checking and savings are `realTime`; credit is `deferred` | — |
| `amountPercent` | that account's share of the absolute money the stream moved | **Two percentages, because they disagree and the disagreement is information.** A stream can be 98% of the money on a card and half the transactions on debit — twenty small purchases against two large ones — and which of those matters depends on the question being asked. Collapsing them into one number picks an answer on behalf of a caller that has not asked yet. **Transfer legs stay in:** a card repayment moves through two connected accounts, and both movements are real — each is attributed here like any other, and counted toward this total. Recognising the two as one movement seen twice is reconciliation, and happens downstream. |
| `transactionPercent` | that account's share of the stream's transaction count | **Direction is not tracked separately.** A transaction's amount is already signed, so a transfer's two legs are counted like any other pair of transactions rather than cancelled or flagged — restating direction as its own field would be a second copy of a fact that can go stale. |

Both percentages are taken over the partition, so each sums to 100 across the array.

### How it is done

Implemented in `accountMapping.js`. Five steps, no thresholds and no tuning:

1. **Terminal streams.** Walk the stream tree; a node carrying `expAmountHistory` is terminal, a node
   carrying children is not. 87 of the captured portfolio's 114 nodes are terminal.
2. **Legs.** A transaction carries no stream id. The link is its `streamAllocation` array, so one leg
   is produced per (transaction, allocation) pair, carrying the **allocation's** amount rather than
   the transaction's total — one transaction can split across several streams. 1,214 transactions
   yield 1,392 legs.
3. **Group by account**, on the leg's `userInstitutionAccountId`.
4. **Two percentages per account**, each taken over the partition so each sums to 100:

   ```
   amountPercent      = 100 x  sum |leg.amount| on this account  /  sum |leg.amount| over all legs
   transactionPercent = 100 x  count of legs on this account     /  count of all legs
   ```

5. **Account kind** comes from `effectiveAccountType`, which lets the user's own override win over the
   institution's subtype. `credit` becomes `deferred`; `checking` and `savings` both become
   `realTime`.

**Every account that appears gets an entry.** No share is too small to record: a 0.1% allocation from
one stray transaction is a real leg and stays. The old 25% gate is gone, and with it the idea that this
stage decides which account matters.

**A stream with no transactions returns an empty partition, and that is the answer.** It is not a
failure and not an unknown to be filled in: with no legs there is nothing to apportion, so the stage
says so and stops. 26 of the 87 come out this way.

**An account id with no matching account is still emitted**, with a null kind, rather than dropped.
A missing account is a finding worth seeing.

Worked example, from the captured portfolio:

```
Groceries & Hygiene          weekly     233 legs
  Robinhood Credit Card      deferred   89.4% of the money   90.6% of the transactions
  X1 Credit Card ..2168      deferred    7.5%                 7.3%
  Spending Account ..4759    realTime    3.0%                 1.7%
  X1 Credit Card ..0441      deferred    0.1%                 0.4%   <- one stray transaction

Credit Card Payments         yearly     116 legs
  Spending Account ..4759    realTime   50.0%                50.0%   <- both legs of every
  Robinhood Credit Card      deferred   43.8%                39.7%      repayment are counted,
  X1 Credit Card ..2168      deferred    5.7%                 5.2%      so checking is exactly
  X1 Credit Card ..0441      deferred    0.5%                 5.2%      half by construction
```

**Solved when:** every stream resolves to the weighted partition of the accounts its money actually
moved through — correct for every stream in the captured portfolio, judged by Julien against the
portfolio he audited, with no error budget.

**Settled.** Julien audited all 87 partitions against the captured portfolio and accepted every one.
The 26 streams with no transactions were accepted as correct by definition: no transactions means the
account cannot be determined, and an empty partition is the honest answer rather than a gap.

---

## §2 — Determining the cycle

**The question.** Determine the stream's **cycle**: how often its pattern resets — twice a month,
every seven days, once a year — not how often money moves within it. Utilities billed to two services
twice a month is a monthly cycle carrying two events, not a semi-monthly one; how many events land
inside a cycle is what shape determines, not this stage.

**In:** the stream's declared period and the history of that declaration; the transactions belonging
to the stream on the account it was mapped to.

**Out:** a `Period` (`src/Time.js`), and whether it came from the declaration or from the ledger.

**The declaration always wins for a non-yearly stream.** It is a statement of fact by the person
receiving the money, and transactions are noisy in ways a declaration is not — a cheque moved off a
Sunday, a month with a correction in it, a bank that posts late. A noisy signal never overrules a clean
one; the ledger is not consulted at all once a non-yearly declaration exists.

**Yearly is the exception.** It behaves differently from every other cycle — the arithmetic connecting
a yearly figure to the size of one movement is unlike every other case — and how is worked out
entirely in Special case: yearly streams. This stage's only job for a yearly stream is to hand it on
correctly labelled.

**A cycle change is read from its most recent chunk.** If a stream's declared cycle changes, the
determination is made from the most recent coherent chunk of that cycle, not blended across the
change. Nothing captures a cycle-change event on the stream today, so in practice this case does not
yet arise — when it does, this is the rule.

### Inferring the cycle from the ledger

**Why it exists.** The declaration wins for a non-yearly stream, so for those the detector is only a
*check* — and a check that can be scored, because those declarations have been validated by hand. For
the 35 open yearly streams there is nothing to win with: a yearly declaration states an amount per
year and is silent about rhythm, so the rhythm has to be read off the movements. The detector is built
and tuned against the cohort that has an answer, then pointed at the cohort that does not.

Implemented in `cycleFit.js` (the score), `cycleDecision.js` (the rule) and `fitConfig.js` (the four
numbers). Audited by `buildFitAuditPage.js`, which re-runs the rule in the browser from the same
source string production runs, so the page and the code cannot drift.

**The score: how far off one candidate period is.** Fold the stream's legs onto a lattice of that
period — the production lattice from `cycleBuckets`, phased on the analysis anchor — and sum three
terms, each already bounded to `[0,1]`, then divide by three. There is no weighting constant and no
threshold inside the score.

| term | what it catches | how |
|---|---|---|
| `emptyRate` | the period is **too short** | `empties / buckets` — fold a monthly stream onto weeks and three weeks in four are empty |
| `occupancySpread` | the period is **uneven** | mean absolute deviation of the per-bucket counts from their median, over that median, clipped at 1 |
| `phaseSpread` | the period is **too long**, or is not a rhythm | each leg's position inside its bucket is an angle; `1 - R` of the mean resultant, so 0 is a perfect phase lock |

`phaseSpread` reads the **k-th harmonic**, where `k` is the median legs per non-empty bucket. A stream
paying on the 1st and the 15th is monthly with two lumps; the first harmonic would read those two
opposed angles as perfect scatter and punish the very shape §3 exists to describe.

**Seven candidates, always all seven, always in ascending order:** weekly, biweekly, semimonthly,
monthly, bimonthly, quarterly, yearly. A candidate with fewer than two buckets or two placed legs is
reported **unscorable** — `misfit: null` — never as a number computed from one bucket.

#### The rule

1. **Window.** Only this reporting year's transactions are evidence — everything on or after the
   analysis anchor (2025-12-21 for the capture). A stream's arrangement is a thing its owner changes
   between years; what it did under last year's plan is evidence about a rhythm that has been retired.
   Fewer than `minLegsToClaim` legs in the window and the ledger is not asked at all.
2. **Two readings.** `merged` scores the stream's legs as one series. `split` scores each merchant
   group on its own lattice and combines them leg-count-weighted. Utilities is a gas bill and an
   electricity bill: merged it looks semimonthly, split it is two monthly series.
3. **Each reading answers the SHORTEST candidate over `fitThreshold`** — never the best-scoring one.
   An integer multiple of the true period scores the same by construction: Rent reads monthly 0.020
   and quarterly 0.018, and a plain minimum answers "quarterly" for a rent paid on the 2nd.
4. **Both readings naming the same period is the strong case** — route `both`, two independent
   measurements of one answer.
5. **On disagreement, split wins only if the split is real.** Splitting either separates two
   interleaved series or fragments one. A group carrying fewer than `minGroupLegs` legs fits any
   period trivially and is not evidence, so one small group discards the whole split reading and
   merged stands.
6. **A one-sided claim is not a claim.** If only one reading cleared the bar, the rule declines to
   measure and the declaration stands. This is why `declared` is the most common route, and it is the
   intended shape: inference overrides a declaration only when the ledger says so twice.
7. **The declaration is a ceiling.** A fit may **shorten** the declared cycle, never lengthen it.
   Finding a shorter pattern than the one declared is a discovery; finding a longer one is the
   detector failing to see the declared rhythm. Route `capped`.
8. **A yearly declaration adds two more gates, and nothing else does.** A yearly stream is an
   envelope, so every cycle read off it is an inference about how the envelope happened to be spent
   rather than a rhythm anyone set up. Before that inference replaces the declaration it has to be a
   rhythm someone would actually run — `yearlyAllowedPeriods`, route `atypical` — and it has to
   still be running — no more than `maxEmptyCyclesToStayActive` complete empty cycles between the
   last movement and the capture date, route `stale`. Both land back on yearly and neither counts as
   a measurement. **`atypical` is tested first**, so a stream failing both is reported by the more
   basic reason.

**Worked example — Renter's insurance.** One payee billing $10 on the 12th for eight months, which the
bank writes "Lemonade.Com" six times and "Lemonade Insurance Compan" twice. The keys diverge at the
ninth character, so they do not group:

```
window legs        8          merchant groups  6 / 2
merged  monthly    99.9%  ->  shortest over 75%: monthly
split   monthly    79.5%  ->  shortest over 75%: bimonthly     (the 2-leg fragment drags it)
                              disagreement, and group 2 < minGroupLegs 3
                              -> split discarded, route via merged
decision           monthly    declared monthly  ✓
```

#### The answer, and how it was reached

Every resolution carries a **route** as well as a period, because anything that is not `both` is a
weaker claim than the period alone makes it look, and a bare period name cannot be argued with. The
routes are exhaustive and mutually exclusive, and they are evaluated in this order:

| route | what happened | counts as measured? |
|---|---|---|
| `both` | merged and split cleared the bar and named the same period | yes |
| `split` | they disagreed, every merchant group carried `minGroupLegs`, so the split won | yes |
| `merged` | they disagreed and the split had a group too small to trust | yes |
| `atypical` | *yearly only.* A period was found but it is not one a budget runs on | no |
| `stale` | *yearly only.* A period was found and it is allowed, but the pattern has gone quiet | no |
| `capped` | the period found is **longer** than the declaration, so the declaration wins | no |
| `declared` | fewer than `minLegsToClaim` legs, or only one reading cleared the bar | no |
| `declined` | no reading, and no declaration to fall back to | no |

**`measured` is reported next to agreement, always.** A rule that reaches 25/25 by declining to claim
anything 25 times has established nothing, and a single agreement number cannot tell those two apart.
This is why the tuning sweep that chose the numbers below ranked candidates by `measured`, not by
agreement: 276 of 1,024 knob combinations reached 25/25, almost all of them by refusing to measure.

#### The seven numbers

They live in `fitConfig.js`, never inline in the scorer, because each was chosen by sweeping it across
its range on the audit page and reading what the validated cohort did. The audit page still moves the
threshold and the two leg gates live; `trimBuckets` and `minSplitLegShare` are part of the definition
of the score rather than gates on it.

| name | value | why this value |
|---|---|---|
| `fitThreshold` | `0.75` | at 0.85 the rule claims 7 and gets 7 right; at 0.75 it claims 12 and gets 12 right; below 0.60 the wrong claims arrive in a block and are all **too short** — Rent, Phone, Utilities, Internet and Plaid all go semimonthly |
| `trimBuckets` | `2` | drop the 2 buckets deviating most from the median and rescore what is left, phase included, so a stream that kept its rhythm except for one doubled month reads as the rhythm it kept. It cannot invent a fit: a flat candidate has nothing to drop and scores identically at every trim — Earnin bimonthly is 79.6% at 0, 1 and 2 |
| `minLegsToClaim` | `3` | the window is already only one reporting year; raising it silences streams that genuinely moved a handful of times |
| `minGroupLegs` | `3` | a 2-leg fragment fits any period trivially, so a split containing one is not evidence |
| `yearlyAllowedPeriods` | `weekly, biweekly, monthly` | *yearly declarations only.* Monthly is the typical arrangement and the two faster ones are really lived; semimonthly, bimonthly and quarterly on a budget envelope describe an accident of when the money was spent. A stream **declared** monthly that reads quarterly is still a disagreement worth seeing — this gate is never applied to a declared rhythm |
| `maxEmptyCyclesToStayActive` | `2` | *yearly declarations only.* Complete cycles of the detected period between the last transaction and the capture date. One empty cycle is a late payment; three is a habit that stopped. Medical read biweekly off four legs that all landed early in the year and nothing since — 10 empty biweekly cycles by the capture date |
| `minSplitLegShare` | `0.24` | the split reading combines only the groups that were **scorable** and skips the rest, which degenerates when nearly every group is skipped. Below this share of the window's legs the split is reported **unscorable** rather than as a number. Just under a quarter, because a stream that is genuinely four subscriptions is plausible and one scorable group of four is still worth reporting |

**The algorithm itself is no longer a setting.** Four scoring variants, a tolerance-based pick rule and
four disagreement policies were all carried on the audit page while the choice was being made. The
choice was made from the cohort, and they are gone with it. What stayed adjustable is arithmetic a
different portfolio could argue with.

**Worked example — why `minSplitLegShare` exists.** Medical HSA, 38 legs in the window, nine
merchant groups. Its split table read quarterly 99.7%, and that number was two drugstore runs:

```
group                      legs   quarterly
altierijulienumbbankhsatra   17   unscorable
amazon                       10   unscorable
cvs                           3   unscorable
target                        2   100.0%
walgreens                     2    99.3%
+ 4 groups of 1 leg           4   unscorable
                             --
scorable weight               4 / 38 = 11%   ->  below 24%, withheld
```

**The trim is why the big groups vanished, and that is a separate defect still open.** `trimBuckets`
is an absolute count applied to every lattice. A quarterly lattice over one reporting year is 2-3
buckets, so dropping 2 leaves fewer than the 2-bucket floor and the group goes unscorable — while a
2-leg group whose counts are `1 1` has nothing deviating, drops nothing, and survives. The trim
removes the best-evidenced groups and spares the thinnest ones. It is bounded by buckets and never by
what share of the legs it discards; the same mechanism lets merged quarterly on Exceptional Expense
score 77.1% after the trim threw away the bucket holding 14 of its 20 legs.

#### What it reads today

**Validated cohort — 25 open non-yearly streams with transactions.** Every claim the rule makes is
correct, and the count it actually measured is reported next to it, because a rule that agrees 25/25
by declining 25 times has established nothing:

```
agree 25/25 · measured 12 · both 11 · via split 1 · declared 13
```

**Yearly cohort — 35 open yearly streams with transactions.** No declared ground truth exists here;
the declaration says "yearly" and means an amount. Agreement is therefore not reported at all — the
headline counts what was read off the ledger:

```
read off the ledger 6/35 · both 4 · via merged 2
                        · not a rhythm a budget runs on 6 · pattern went quiet 1 · declared 22
```

The six it keeps are all monthly or weekly and all still moving: Gembah, Hobby mdm, Shopping, Tolls,
Credit Card Payments, Business Expenses. The seven it blocks divide cleanly by *which* condition
fails — three had gone quiet (Medical 10 empty biweekly cycles, DMV fee 10, Sport 8) and four are
still active but on a period a budget does not run on (Returns and both Cadeaux bimonthly,
Exceptional Expense quarterly). The route counts read 6 `atypical` / 1 `stale` rather than 4 / 3
because `atypical` is tested first and two of the quiet ones were also semimonthly.

**The ground truth for this cohort is Julien's**, recorded per stream id in
`src/tests/fixtures/cycleGroundTruth.json` — beside the portfolio capture, under the same ignore rule
because it names real streams, and in its own file so a recapture does not erase a judgement that took
a person to make. `basis` separates a rhythm the stream really has from behaviour that merely happens
to be regular: Returns reads bimonthly because of how the refunds arrive, not because the stream runs
on that cycle. Both are accepted detections; only one should ever carry structural weight.

`Medical HSA -> quarterly` and `Exceptional Expense -> quarterly` were both claimed before these
gates existed, and both were wrong in the same way: a yearly envelope drawn down often is regular in
the only sense the score can see. The share gate withdrew the first and the period gate the second.

**The trim defect above is still open and still material**, because it is what let Exceptional Expense
score quarterly at 77.1% in the first place — the period gate now blocks that answer, but only by
refusing the period, not by fixing the score.

**Bimonthly and quarterly are deliberately not in the allowed list**, and the reason is evidence
rather than taste. Julien: they are extremely rare in this portfolio — quarterly would be tax,
bimonthly would be certain bills — and over a single reporting year they carry too few cycles to be
confident about. Four quarterly cycles is not enough to overrule a declaration, so a reading at those
periods is noise being promoted to a prediction. `Returns`, `Cadeaux famille Mdm` and
`Cadeau famille Mr` all read bimonthly and are all still active; all three stay yearly.

**Validated by Julien on 2026-09-12**, against both cohorts on the audit page, at the numbers above.

**This is the detector's known limit and it is not calibrated away.** The score measures *regularity*,
and a yearly envelope that is drawn down frequently is regular in the only sense the score can see.
Separating "this yearly stream has a hidden monthly rhythm" from "this yearly stream is a pot of money
spent whenever" is the open part of §5, not a threshold to be moved here.

**A yearly declaration is never ticked against.** It states an amount and says nothing about rhythm,
so a verdict against it would mark a real finding as a failure and a non-answer as correct. On the
yearly cohort the audit page reports what the predictor **chose** and where it came from, and nothing
else: `chose weekly · 97.7% fit · read off the ledger` against `chose yearly · no rhythm in the
ledger, the declaration stands`.

---

**The open question.** What about a declaration that was true and has stopped being true, with no
formal change recorded?

**Solved when:** every non-yearly stream's cycle matches its declaration exactly — yearly streams are
excepted, and solved where they are specified — validated by Julien against the captured portfolio.

**Status: solved, and the detector below with it.** The declaration path was validated first; the
inference path was validated on 2026-09-12 against both cohorts.

---

## §3 — Determining what shape the money movements have during a cycle

**The question.** For a stream whose cycle is known and is not yearly, determine what shape the
money movements have during a cycle.

**In:** the stream's cycle, its `accountAllocation` partition, and the history of its declared
amount.

**Out:** for each `accountAllocation`, one of a small set of shapes, the pattern that shape returns, and
a confidence. A stream split across two accounts can have a different shape on each side, and each
side's confidence is its own — a partition does not inherit a single verdict.

**Three shapes are known to exist and must be told apart.**

| shape | what it looks like | pattern returned | worked example |
|---|---|---|---|
| **lump** | one event, on a day it keeps | day *X* of the cycle | rent, on the 1st — day 1 |
| **spread** | continuous, no single event | none; the shape itself is the pattern | groceries, all week |
| **multi-lump** | several distinct events, each with its own day and size | days *X, Y…* of the cycle | utilities: water on the 4th, electricity on the 18th — days 4, 18 |

**The open questions.** How a lump or a multi-lump determines which day, or days, of the cycle it
falls on. And which shape a fractional median names: an even number of observed cycles produces
medians of 1.5 and 2.5, which fall between the counts the three shapes are defined on.

**Solved when:** every stream in the captured portfolio is shaped correctly, validated by Julien.

---

## §4 — Predicting the amount that moves

**The question.** For a stream whose cycle and shape are already known, **predict** how much money
moves per cycle.

It is a prediction and not a lookup, which is why it carries a confidence: the amount that will move
next is being forecast from a declaration and a history that disagree, not read off a record.

**In:** the stream's `accountAllocation` partition, cycle and shape, plus its declared amount and its
transaction history.

**Out:** an amount per cycle, for each `accountAllocation`, with a confidence.

**Only the latest chunk of expectation-change history is read.** The window starts at the most recent
change to the declared amount and everything before it is ignored, the same rule the cycle follows.
An arrangement that has changed is two amounts overlaid, and a figure drawn across the change
describes neither.

**The declared amount is the base.** It is what the user intends, and it stands until the ledger has
enough history to say otherwise.

**The median replaces it once three consecutive cycles have transactions.** Counting from the latest
change, three consecutive cycles with transactions make the median of those cycles the base. With
fewer than three, the declaration stays.

**A calibration correction moves the amount, but only in the direction the ledger actually shows.** A
stream whose transactions sit more than 70% on one side of the expected value is out of calibration,
and the amount moves to the median — provided the median agrees with that side.

| declared | share above | median | predicted | why |
|---|---|---|---|---|
| $100 a month | 80% above | $120 | **$120** | the median agrees with the skew |
| $100 a month | 80% above | $90 | **$100** | the median contradicts the skew, so nothing moves |

A median that disagrees with its own skew is noise rather than a correction, and the declaration holds.

**The direction test compares a transaction against a cycle, and against real data it does not work.**
The test counts *transactions*; the base and the median are per *cycle*. One transaction is almost
always smaller than the whole cycle it sits in, so for any stream with several transactions to a cycle
every transaction reads as sitting on the same side of the base. The test returns 100% on 40 of the
portfolio's 111 allocations — it is measuring the difference in unit, not any drift in the stream, and
the median-agreement check is the only thing still deciding those cases.

Measured on the captured portfolio: the direction test passed on 70 of 111 allocations; 49 moved the
base, 5 were already at the median, and **16 were blocked by a disagreeing median**. Of the 21
allocations that carry one transaction per cycle, 14 passed the direction test and **none** was
blocked. The guard only ever does work on multi-transaction cycles.

Whether the direction test should count transactions or cycles is not settled. Counting cycles compares
like with like, which is the obvious repair — but it also makes the guard unreachable, because a median
cannot disagree with a direction that more than 70% of its own population agrees on.

**Calibration does not honour the three-cycle floor.** Step 2 requires three consecutive cycles before
a median may replace the declaration; step 3 requires none, and reaches the same median by another
route. In the captured portfolio that moves yearly streams off a single cycle: Credit Card Payments,
declared 0, is calibrated to a one-cycle median of −$70,686. Either the floor belongs to both steps or
it belongs to neither.

**Nothing exempts a yearly stream from this stage.** The cycle stage hands yearly on labelled, and the
shape stage returns nothing for it, but the amount stage predicts all 44 of them from a single bucket.
Whether the yearly case is answered here or only where yearly streams are specified is not settled.

**Outliers are their own problem.** A stream with one $9,625 month among eight $7,600 months is
telling you something, and it is not obvious what: a genuine one-off to exclude, a step change to
adopt, or ordinary variance to keep. Discarding and keeping are both wrong some of the time.

**Solved when:** every stream's amount comes out of these three steps, and Julien agrees with every
single one of them.

---

> **At this point the module should predict every non-yearly stream well, on the account it belongs
> to.** That is the first real checkpoint. The two cases below should not begin before it is met.

---

## §5 — Special case: yearly streams

**It is a special case because a yearly stream carries more uncertainty than the rest.** Everything
that follows is why, and what to do about it.

**The question.** A yearly declaration states an amount per year. What cycle does the stream
actually have, and how does that yearly figure become the size of one movement?

**Why it is genuinely different — and it is not that the cycle is missing.** A yearly stream can
be as regular as any other; a yearly budget charged every month is a monthly cycle wearing a yearly
declaration. What differs is **the arithmetic between the declaration and a movement**. Everywhere else
the declared figure IS roughly what moves each time, so the amount is read. Here it is an envelope over
a year, and the size of one movement has to be derived from it — divided, drawn down, or ignored
entirely — and which of those applies depends on how the envelope is actually being spent.

The stakes are high because the streams are large: a $10,000 yearly budget contributes over $1,800 a
month to a forecast whether or not a dollar of it moves.

**The scenarios are not one problem**, and each has its own arithmetic. Each is named and distinguished
before any rule is written — a yearly bill paid once on a date, a budget drawn down in instalments, an envelope spent
erratically, an envelope that will not be spent at all, and a yearly *income*, which is a hope rather
than a schedule and may deserve no forecast whatever. These behave differently enough that one rule
covering all of them is unlikely to be the answer.

**The known trap.** A budget that never draws down contributes the same amount every month for ever.
Whether draw-down is measured, and against which transactions, is unresolved — a card-routed stream's
spending is not on the account being predicted.

**The cycle half is already measurable.** The detector specified under §2 runs on this cohort and
reads 14 of the 35 as carrying a shorter rhythm than yearly. It cannot tell a hidden monthly rhythm
from an envelope that is simply spent often - `Credit Card Payments -> weekly` on 75 legs is the
clearest case - so its answer is evidence for the scenario question, not the scenario answer.

**Solved when:** each named scenario is recognised from its history, the cycle is found where the
stream has one, and a budget that is not being spent stops being forecast.

---

## §6 — Special case: streams split across two accounts

**The question.** One stream that genuinely moves money through two accounts — a card and a checking
account — rather than one. How is it predicted?

**Why it is last.** It is a *composition* of everything above — each side has its own cycle, its own
shape and its own amount — so it cannot be specified before those are settled, and it is rare enough
that getting it wrong is cheap compared with getting the ordinary case wrong.

**What it must guarantee.** That the two halves sum to one stream and never to two. The declared
amount is one number; a split that gives each side the whole of it doubles the stream, which is worse
than not splitting at all.

**The open question.** Whether a split is a property of the stream or of the period. A stream that
paid by card last month and by transfer this month may have *moved* rather than split, and those want
opposite treatment.

**Solved when:** a genuinely split stream is forecast on both accounts with no double counting, and a
stream that merely moved is recognised as having moved.

---

## Exit criteria

**Every stage above is as good as it can be given the variability actually present in the data** — not
perfect, because some of the variance is irreducible, but at the point where the remaining error is
demonstrably the data's and not the model's.

**And "as good as possible" is judged by agreement, stream by stream, against the captured portfolio.**
Julien audits each stream in the fixture and asks whether the module's decision is the one he would
have made. That is the measure, and it is deliberately not a percentage: mapping, cycle and shape are
classifications with no dollar error, so an accuracy score cannot price them at all, and a model that
agrees with its owner about every stream is the thing actually being built.

Two consequences worth stating, because they are easy to lose:

- **A disagreement is a finding, not a failure.** Where the module and the judgment differ, one of the
  two is wrong and which one is the interesting question. Several of v1's rules exist because the
  ledger turned out to be right.
- **The audit needs the module's decisions to be readable at the moment of judging.** That is a
  debugging surface, built for the audit. It is a larger thing than the confidence and the
  determination labels a prediction carries, and it does not have to ship with them.

**The module is self-contained.** It can be handed a portfolio and an as-of date and will answer
without reaching for anything else. It has no dependency on the chart, the bench, or the balance walk.

**It is trusted, and trust is demonstrated rather than asserted:**

- it is audited against the real portfolio stream by stream, not only against fixtures built to test
  each rule;
- each stage can be turned off independently so its contribution can be priced;
- a stage that fires can be shown to fire for the right reason, and a rule that changes nothing is
  removed rather than kept.

**No consumer adopts it until Julien judges these met.** Whatever predicts today keeps doing so,
unchanged, throughout.

---

## Decided

These were open while this was written. They are settled, and recorded here so they are not re-opened
by accident.

| question | answer |
|---|---|
| Does the declaration or the ledger own the amount? | **The declaration, until the ledger earns it.** Three consecutive cycles of transactions since the last change put the median in charge, and a calibration correction moves it only where the median agrees with the direction the transactions skew. |
| What does the module hand back? | **A schedule of predicted events** — date, amount, account, and a confidence on each of date and amount, over a horizon the module sets. |
| How is "as good as possible" measured? | **By Julien's judgment**, auditing each stream of the captured portfolio against the decision he would have made. |
| Is a stream with no transactions a failure? | **No, it is the answer.** With no transactions the account cannot be determined, and an empty partition says exactly that. Settled while validating §1. |
| Who owns card ↔ checking pairing? | **Not this module.** It is a fact about accounts, not about streams. No stage here consumes it; `accountLinks()` derives it today for whatever does. |
| May a ledger reading overrule a declaration? | **Only when the ledger says so twice.** Both readings have to clear the bar and name the same period, or disagree in a way the merchant split can justify. One reading alone falls back to the declaration. |
| May it lengthen a declared cycle? | **No.** A fit may shorten the declaration, never lengthen it. Finding a shorter pattern is a discovery; finding a longer one is the detector failing to see the declared rhythm. |
| What may a yearly stream be re-read as? | **Weekly, biweekly or monthly, and only while the pattern is still running.** Bimonthly and quarterly are extremely rare and carry too few cycles in one reporting year to be confident about, so a reading at those periods is noise. Silence of more than two complete cycles ends the claim. Settled 2026-09-12. |
| Does it predict, or also explain? | **Predicts, plus a confidence and how it was determined.** How much further it should explain itself is deliberately not settled — see below. |

## Still open

1. **How a spread stream appears in an event schedule.** A question about shape, and the one place the
   output
   contract and the shape taxonomy have to meet.
2. **What the horizon actually is**, and whether one horizon serves a weekly stream and a yearly one.
3. **Whether confidence is a number, a band, or a label.** It has to be usable by a consumer that is
   not a person, and comparable between streams.
4. **The trim is bounded by buckets, never by legs.** `trimBuckets` drops a fixed number of buckets
   whatever the lattice looks like. On a long weekly lattice that is two of thirty-three; on a
   quarterly lattice over one reporting year it is two of three, which drops the group below the
   two-bucket floor and makes it unscorable. The effect is backwards: it destroys the best-evidenced
   merchant groups and spares the thinnest ones — Medical HSA's 17-leg and 10-leg groups went
   unscorable at quarterly while its two 2-leg groups survived and produced a 99.7%. It also let
   Exceptional Expense score quarterly at 77.1% after the trim discarded the bucket holding 14 of its
   20 legs. Capping the trim by the **share of legs** it discards, rather than by a count of buckets,
   is the proposed fix and is not implemented.
5. **How much a prediction should account for itself.** Today: a confidence and a determination label. Whether
   that is enough, and what a fuller explanation would cost in shape and speed, is open — deliberately,
   because it may need to change.
