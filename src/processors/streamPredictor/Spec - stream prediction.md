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
| `modes` | what §3 determined: a **list**, one entry per payee-direction-account pile of money, each a `lump` with days or a `spread` with none, each with its share of the stream's money | One shape per stream was the wrong shape of answer. Utilities is two bills on the same day; Wages Julien is a payroll plus three disability deposits; Gas is eight petrol stations and no rhythm. A single verdict describes none of them, and the money share is what tells a reader which mode is worth being right about. |
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

**In:** the stream's declared period; the transactions belonging to the stream, the analysis anchor,
and the capture date.

**The declaration always decides for a non-yearly stream.** It is a statement of fact by the person
receiving the money, and transactions are noisy in ways a declaration is not — a cheque moved off a
Sunday, a month with a correction in it, a bank that posts late. A noisy signal never overrules a clean
one.

**But the ledger is read on every stream and reported alongside.** The detector used to run only where
the declaration was useless. Running it everywhere costs one pass and buys the thing a prediction
experiment needs: the declared answer and the inferred answer, on the same object, for every stream —
so a future predictor can be tried against either without re-deriving which streams had an inference
available. On a declared rhythm the inference is **reported and never consulted**; a disagreement is a
finding for a person to look at, not an override.

**Out**, from `determineCycle(stream, evidence)`:

```
{
  declared:    Period        // always. null only for a malformed declaration.
  inferred?:   Period        // whatever the ledger read, when it read anything.
  confidence?: 0.5 .. 1      // travels with `inferred`, never alone.
}
```

**Three keys, two of them optional, and nothing else.** `inferred` is what the **ledger read**, present
whenever the detector measured anything at all; `confidence` travels beside it.

**Reporting an inference is not the same as acting on it.** On a declared rhythm the declaration still
decides and the reading is reported anyway, because *"the ledger agrees"* and *"the ledger was never
asked"* are different facts. Utilities reads monthly off 18 legs — 96.2% merged, 99.1% split — and that
corroboration is worth keeping even though monthly was never in doubt; a prediction experiment needs
to tell a confirmed declaration from an unexamined one. Which of the two is the **answer** is
`cycleOf(decision)`, and that rule lives in exactly one place:

```
yearly or biyearly declaration   ->  inferred, when there is one; otherwise declared
every other declaration          ->  declared, whatever the ledger read
```

An absent `inferred` is not an empty one: every gate — `atypical`, `stale`, `capped` — and every
one-sided claim resolves to "nothing measured", so a refused reading leaves no trace at all.

`evidence` is `{legs, anchor, now, config}` and is **required**. Pass the legs you have; an empty array
is a fact about the stream and falls back to the declaration, while a missing argument is a wiring bug
and throws. When it was optional a caller who simply forgot it got a confident-looking `{declared}`
back instead of a failure. To read the declaration alone — which is what the §2 audit page wants —
call `declaredCycleOf(stream.period)`.

**The working is a separate call.** `explainCycle(stream, legs, anchor, now)` returns both readings,
every candidate's score, the merchant groups, the route, how long the stream has been quiet, and what
a gate refused. That is what the audit page draws and what a prediction experiment should read. It is
deliberately not part of the answer: a debug surface that rides along inside the contract becomes part
of the contract the first time someone reads it.

On the captured portfolio, over all 60 open streams carrying transactions: **18 carry an `inferred`**
— 12 corroborating a declared rhythm at 100% confidence, 6 deciding a yearly stream's cycle — and 42
carry none, because the detector declined or a gate refused.

**Yearly is the exception, and this stage now answers for it.** A yearly declaration is an envelope —
an amount per year, silent about timing — so the ledger decides where it has earned it, under the
gates below. What a yearly figure means for the SIZE of one movement is a different question and is
worked out entirely in Special case: yearly streams.

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

**Three layers, each knowing less than the next.** `cycleFit.js` is an **observer**: it scores every
candidate against the legs, groups them by merchant and counts how long the stream has been quiet. It
chooses nothing, knows no threshold and has never heard of a yearly stream. `cycleDecision.js` reads
those observations — picks, breaks a merged/split disagreement, applies the gates — and **absorbs the
refusals in full**, so a blocked reading is simply not an inference by the time it leaves.
`cycleDetermination.js` puts the declaration next to the inference and answers. The settings are in
`fitConfig.js`.

Audited by `buildFitAuditPage.js`, which re-runs the rule in the browser from the same source string
production runs, so the page and the code cannot drift. The summary tab renders `decidedFields` — the
same projection `determineCycle` uses — so the page cannot show a field the module would not return.

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
   An integer multiple of the true period scores the same by construction: Rent reads **monthly
   99.4% and quarterly 99.6%**, so a plain best-score would answer "quarterly" for a rent paid on the
   2nd of every month. The shortest candidate over the bar is the answer; the best one is never
   consulted.
4. **Both readings naming the same period is the strong case** — route `both`, two independent
   measurements of one answer.
5. **On disagreement, split wins only if the split is real.** Splitting either separates two
   interleaved series or fragments one. A group carrying fewer than `minGroupLegs` legs fits any
   period trivially and is not evidence, so one small group discards the whole split reading and
   merged stands.
6. **A one-sided claim is not a claim.** If only one reading cleared the bar, the rule declines to
   measure and the declaration stands. This is why `declared` is the most common route, and it is the
   intended shape: inference overrides a declaration only when the ledger says so twice.
7. **A yearly declaration adds two more gates, and nothing else does.** A yearly stream is an
   envelope, so every cycle read off it is an inference about how the envelope happened to be spent
   rather than a rhythm anyone set up. Before that inference replaces the declaration it has to be a
   rhythm someone would actually run — no longer than `maxYearlyInferredPeriod`, route `atypical` —
   and it has to still be running — no more than `maxEmptyCyclesToStayActive` complete empty cycles between the
   last movement and the capture date, route `stale`. Both land back on yearly and neither counts as
   a measurement. **`atypical` is tested first**, so a stream failing both is reported by the more
   basic reason.
8. **The declaration is a ceiling.** A fit may **shorten** the declared cycle, never lengthen it.
   Finding a shorter pattern than the one declared is a discovery; finding a longer one is the
   detector failing to see the declared rhythm. Route `capped`. Applied after the yearly gates, which
   makes it unreachable for a yearly stream — those have already landed back on the declaration — so
   in practice it only ever fires on a declared rhythm.

**Worked example — Hobby mdm**, the weakest inference the rule currently makes, and the one that
exercises the group gate. Declared yearly, 7 legs in the window, four merchants:

```
groups   claudebyanthropic x4 | amazon x1 | cline x1 | deepai x1

period        merged   split
weekly         11.9%   13.0%
biweekly       23.0%   64.6%
semimonthly    35.3%   86.6%   <- split: shortest over 75%
monthly        76.2%   99.99%  <- merged: shortest over 75%
bimonthly      86.8%   99.96%       (better, and never consulted - shortest wins)
quarterly         -    75.7%
yearly            -       -

merged monthly, split semimonthly -> they disagree
three groups carry 1 leg, below minGroupLegs 3 -> the split is not evidence
  -> route `merged`, monthly at 76.2%
monthly is no longer than maxYearlyInferredPeriod  -> not `atypical`
0 empty monthly cycles since the last leg          -> not `stale`

determineCycle -> {declared: Period.yearly, inferred: Period.monthly, confidence: 0.524}
                  50% + (76.2 - 75) / 25 x 50%  =  52%
```

The split says semimonthly only because splitting turns a 4-leg subscription into one clean series and
three single legs; that is fragmentation, not two interleaved rhythms, and the gate is what tells them
apart.

#### The answer, and how it was reached

Every resolution carries a **route** as well as a period, because anything that is not `both` is a
weaker claim than the period alone makes it look, and a bare period name cannot be argued with. The
routes are exhaustive and mutually exclusive, and they are evaluated in this order:

| route | what happened | counts as measured? |
|---|---|---|
| `both` | merged and split cleared the bar and named the same period | yes |
| `split` | they disagreed, every merchant group carried `minGroupLegs`, so the split won | yes |
| `merged` | they disagreed and the split had a group too small to trust | yes |
| `atypical` | *yearly only.* A period was found but it is longer than `maxYearlyInferredPeriod` | no |
| `stale` | *yearly only.* A period was found and it is allowed, but the pattern has gone quiet | no |
| `capped` | the period found is **longer** than the declaration, so the declaration wins | no |
| `declared` | fewer than `minLegsToClaim` legs, or only one reading cleared the bar | no |
| `declined` | no reading, and no declaration to fall back to | no |

**`measured` is reported next to agreement, always.** A rule that reaches 25/25 by declining to claim
anything 25 times has established nothing, and a single agreement number cannot tell those two apart.
This is why the tuning sweep that chose the numbers below ranked candidates by `measured`, not by
agreement: 276 of 1,024 knob combinations reached 25/25, almost all of them by refusing to measure.

#### Confidence

**A score, and only where there is an inference to be confident about.** A stream the detector
declined to measure carries no confidence figure: the declaration standing is not a prediction that
could be wrong, and scoring it would invite comparing it with one that could.

```
landed on the declaration      ->  100%
disagreed with it              ->  50% + (fit - threshold) / (1 - threshold) x 50%
nothing measured               ->  no score
```

**Agreeing with the declaration is 100%** because the declaration is a statement of fact by the person
receiving the money; a reading that lands on it is corroborated by the one source that cannot be noisy.

**A disagreement is the fit, rescaled onto a floor of 50%,** and the floor is the point of the formula.
The threshold is the lowest fit that counts as a match at all, so a reading sitting exactly on it is a
coin flip and must read as one — but it also *cleared* the bar, so it is never "low": clearing by a
hair is a real chance of being wrong, not evidence of being wrong. The number is meant to map to how
often the answer holds up, deliberately hedged against false positives rather than centred.

**Both ends are written in terms of the threshold**, so the score follows that knob rather than
assuming 0.75. At a threshold of 0.90 a fit of 0.95 scores 75%, exactly as 0.875 does at 0.75.

On the captured portfolio every score below 100% is a yearly stream, which is by construction — an
inference on a yearly declaration always disagrees with it:

```
Credit Card Payments  weekly    fit 97.7%   95%
Shopping              monthly   fit 93.3%   87%
Gembah                monthly   fit 86.2%   72%
Tolls                 monthly   fit 80.2%   60%
Business Expenses     monthly   fit 78.6%   57%
Hobby mdm             monthly   fit 76.2%   52%
```

#### The eight settings

They live in `fitConfig.js`, never inline in the scorer, because each was chosen by sweeping it across
its range on the audit page and reading what the validated cohort did. Seven are numbers; the eighth
is a list of patterns. The audit page still moves the
threshold and the two leg gates live; `trimBuckets` and `minSplitLegShare` are part of the definition
of the score rather than gates on it.

| name | value | why this value |
|---|---|---|
| `fitThreshold` | `0.75` | at 0.85 the rule claims 7 and gets 7 right; at 0.75 it claims 12 and gets 12 right; below 0.60 the wrong claims arrive in a block and are all **too short** — Rent, Phone, Utilities, Internet and Plaid all go semimonthly |
| `trimBuckets` | `2` | drop the 2 buckets deviating most from the median and rescore what is left, phase included, so a stream that kept its rhythm except for one doubled month reads as the rhythm it kept. It cannot invent a fit: a flat candidate has nothing to drop and scores identically at every trim — Earnin bimonthly is 79.6% at 0, 1 and 2 |
| `minLegsToClaim` | `3` | the window is already only one reporting year; raising it silences streams that genuinely moved a handful of times |
| `minGroupLegs` | `3` | a 2-leg fragment fits any period trivially, so a split containing one is not evidence |
| `maxYearlyInferredPeriod` | `monthly` | *yearly declarations only.* **A boundary, not a list**: a candidate is admitted when it is no longer than this, so a new shorter candidate period needs no edit and an enumeration would silently exclude it. Bimonthly and quarterly are dropped because they are extremely rare — quarterly would be tax, bimonthly certain bills — and one reporting year carries too few of their cycles to overrule a declaration. A stream **declared** monthly that reads quarterly is still a disagreement worth seeing; this gate is never applied to a declared rhythm |
| `digitsAreSerialWhen` | `[/che(ck\|que)s?/i]` | descriptions whose digit runs are a serial rather than an identity, stripped before the merchant key is taken. `getMerchantKey` drops tokens mixing letters and digits but keeps a pure-digit token, so "Check paid 1035" and "Check paid 1039" were nine merchants and one chequebook. **An array because it will grow** — every bank writes these differently. Narrow on purpose: elsewhere a trailing number is the identity, a store number or an order |
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
                        · longer than a budget rhythm 4 · pattern went quiet 3 · declared 22
```

The six it keeps are all monthly or weekly and all still moving: Gembah, Hobby mdm, Shopping, Tolls,
Credit Card Payments, Business Expenses. The seven it blocks divide cleanly by *which* condition
fails — three had gone quiet (Medical 10 empty biweekly cycles, DMV fee 10, Sport 8) and four are
still active but on a period longer than a month (Returns and both Cadeaux bimonthly, Exceptional
Expense quarterly).

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

**Bimonthly and quarterly fall outside the boundary**, and the reason is evidence rather than taste.
Julien: they are extremely rare in this portfolio — quarterly would be tax, bimonthly would be certain
bills — and over a single reporting year they carry too few cycles to be confident about. Four
quarterly cycles is not enough to overrule a declaration, so a reading at those periods is noise being
promoted to a prediction. `Returns`, `Cadeaux famille Mdm` and `Cadeau famille Mr` all read bimonthly
and are all still active; all three stay yearly. Semimonthly **is** inside the boundary — `Sport` and
`DMV fee` read semimonthly and are blocked by the quiet gate instead, which is the accurate reason.

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

**Status: SOLVED, and the detector below with it.** The declaration path was validated first; the
inference path was validated on 2026-09-12 against both cohorts, stream by stream, on the audit page.
The yearly decisions Julien accepted are recorded per stream id in
`src/tests/fixtures/cycleGroundTruth.json` and a test holds the detector to them.

---

## §3 — Determining what shape the money movements have during a cycle — **SOLVED**

**The question.** For a stream whose cycle is not yearly, determine what shape the money movements
have during a cycle.

**Not yearly means the cycle it ENDED UP WITH**, not what it declared. §2 hands back a declared cycle
and, where the ledger earned it, an inferred one; this stage runs on whichever of the two §2 answered
with. Six streams in the captured portfolio declare yearly and come out of §2 as weekly or monthly —
they are shaped here like any other. A stream still yearly after §2 gets an answer too, and that
answer is that every mode of it is a rate: there is no day inside a year worth naming.

**In:** the cycle §2 answered with, the stream's `accountAllocation` partition, and the stream's legs
inside the analysis window.

**The analysis anchor is NOT an input to this stage.** It is the one seam the whole module is cut on,
settled once from the module's own inputs — the portfolio and the as-of date — and every stage reads
that same one. Handing it to a stage as an argument would let a caller give §3 a different seam from
the one §2 used, and the two would then disagree about where a cycle begins while both looking
correct. Same for every other stage: the seam is the module's, not the stage's.

**Out:** a list of **modes**. Not one shape per stream, and not one shape per account.

### A stream is a list of modes

**One shape per stream was the wrong shape of answer, and the portfolio kept saying so.** Utilities is
a Conservice bill and a City of Palo Alto bill, both on the 11th, two thirds and one third of the
money. Wages Julien is a payroll plus three California disability deposits. Gas is twelve fill-ups at
eight stations with no rhythm at all — which is itself an answer, and a useful one. Forcing any of
those into a single verdict describes none of them.

**A mode is one promise about one pile of money.** A stream may be several things at once, and the
money share is what makes the list readable: an unpredictable 1% costs nothing to get wrong, an
unpredictable 60% is the forecast.

**A mode starts as a payee, in one direction, on one account.** Three things split it before anything
is measured:

- **The payee**, because a stream's merchants keep their own rhythms and merging them describes
  neither.
- **The direction**, because money out cannot complete a rhythm of money in. Julien's savings
  transfer goes out on the 15th and occasionally comes back to fund something large; absorbing a
  pull-back would let a withdrawal fill a cycle the deposit missed and count as the deposit having
  happened.
- **The account**, because a date on a card is not a date in a current account. A card settles once a
  month whatever day the purchase happened; a current account moves the day the money does.

**Then what was cut too finely is put back.** A payee with no pattern of its own is offered to every
patterned mode in the same direction, and absorbed when the merged mode fits **at least as well as
the host did alone** — a comparison, not a bar. Wages Julien's payroll is written two ways,
`ACTIVEHOURS INC PAYROLL` sixteen times and `ACTIVEHOURS D B PAYROLL` once; put back it is 17
movements in 17 cycles. Day care Emile is eight cheques and one Zelle transfer, and August has no
cheque because the transfer **is** August's payment. Whatever is still loose afterwards is gathered
into one "everything else" mode per account and direction: twenty-one grocery payees are not
twenty-one facts about a forecast.

**A merge may cross accounts only when the result is plainly one account's habit** — at least
`minDominantAccountShare` of the merged movements on one account, counted in transactions rather than
money, because one large payment from the wrong account does not relocate a habit and a majority of
small ones does. The merged mode is then reported on, and measured with the posting behaviour of,
that account.

### Two shapes, and they are two promises

| shape | the promise | what comes with it | worked example |
|---|---|---|---|
| **lump** | money lands on these days of the cycle | `days`, `confidence` | rent, day 11 · utilities, day 11 · the card payment, day 4 |
| **spread** | money is spent at a rate, on no particular day | nothing further | groceries, all week · eight petrol stations · a payee too sparse to read |

**There is no third value and no null.** A forecast can do exactly two things with money — put it on a
date or spend it across the cycle — so an observer that could not read a mode at all still produces a
spread, because undated money is spent at a rate whether that is a finding or a shrug. What the
observer actually saw survives in `explainShape` under `reason`.

**There is no "multi-lump" either.** A mode landing on three days is a lump whose `days` has three
entries. The count was never a different kind of answer, only a different length of one.

### The rule

1. **Lay every cycle on top of every other.** `cycleBuckets` cuts the legs into cycles phased on the
   module's anchor, and `dayHistogram` counts how many movements ever landed on day 0, day 1, and so
   on. Day 0 is the seam.

2. **Weight each cycle by how recent it is.** The newest `taperShoulderCycles` sit at full weight;
   after that the weight halves every `taperHalfLifeCycles`. Cycles, not days, so a weekly stream and
   a monthly one fade at the same rate against their own rhythm. The weights ride on the buckets, so
   the histogram carries fractional counts and everything downstream sums over them unchanged.

3. **Try every reading of the movements and let the stream pick one.** For a real-time account the
   bank's closures are undone two ways — every movement pulled back to the previous business day, or
   pushed on to the next — and whichever reading explains the stream best wins. A card is never
   adjusted: it posts when the merchant presents it.

4. **Ask for as many clusters as the cycle carries movements.** A cycle that typically carries one
   movement is measured against **one** day; one that carries three is measured against three. The
   count is pinned, not searched for: a shape that names more days than the forecast will use has not
   decided anything.

5. **In focus at that count, or not.** `concentration` at k clusters clears `minConcentration` and it
   is a lump; otherwise it is a spread — a busy one if the cycle is genuinely full, and a shrug if it
   is not, but a spread either way.

6. **Let a pattern keep its own exceptions.** The movement furthest from the claimed day is set aside
   while that improves the fit, up to `maxExceptionShare` of the mode. What is set aside is the mode's
   own noise — counted and reported, not discarded. The result still has to be a lump: trimming always
   improves a score that rewards landing on a day, so a flow would otherwise shed a third of itself
   chasing one.

7. **Name the day with half the weight on either side of it.** The claimed day is the weighted middle
   of the winning cluster, so a movement from January moves it less than one from last week.

8. **Charge for the claim.** A lump under `minLumpConfidence` keeps its money, loses its day, and is
   answered as a spread.

### Confidence

**How often it turns up, times how tightly it lands.**

    confidence = share of cycles carrying anything  ×  1 − scatter / (cycleDays / 4k)

**Both halves are the pattern.** A bill always on the 6th that skipped August is not a tight monthly
bill — it is a monthly bill that missed a month, and a forecast built on tightness alone invents a
payment that never came. Tightness only looks at where movements landed, never at the cycles where
none did.

**The yardstick is a quarter of the cycle, divided by the cluster count.** Movements landing anywhere
sit a quarter of the cycle from any given day on average, so that is the zero point; landing on the
claimed day every time is 1. With k clusters the cycle is effectively k times shorter, which is why k
divides it — a weekly stream paid on the same weekday scores like a monthly one paid on the same date.

**Both halves are weighted by recency**, the same weights as the histogram: a cycle missed last month
costs more than one missed in January.

**There is no separate wobble in the answer.** How far the movements scatter around the day is not a
second number for a caller to combine with the first — it is already inside the confidence. A caller
reading both would be reading the same evidence twice.

### The answer

    {
      cycle: Period,
      modes: [{
        label,        the payee name a person recognises
        accountId,    where it lands
        accountType,  deferred | realTime - decides when the cash actually moves
        direction,    in | out
        shape,        lump | spread
        days?,        lump only - the days of the cycle it lands on
        confidence?,  lump only - 0 to 1
        moneyShare    how much of the stream rides on this mode
      }]
    }

**An undetermined field is ABSENT, never a placeholder** — the same contract §2 answers on. A spread
has no `days` because it has no day to name, which is what makes it a spread, and no `confidence`
about a day it never claimed.

**Everything else is the working, and the working has its own surface.** `explainShape` returns the
same modes carrying the movements they were read from, the histogram, the cycles observed, which
closure theory won, what was set aside as exceptions, which payees were merged in, the wobble, and the
reason where there is no lump. The bench page is drawn from it. Nothing downstream of this module
reads it.

### The settings

| setting | value | what it decides | measured on |
|---|---|---|---|
| `minConcentration` | 0.75 | how sharply movements must cluster to be a lump at all | the portfolio's bills all clear it; groceries read 0.11 |
| `minLumpConfidence` | 0.60 | what a claim on a date costs | Earnin's phone reimbursement reads 56% across a fortnight and names no day; every real bill clears it with room |
| `taperShoulderCycles` | 3 | how many recent cycles are never faded | a rhythm needs a few cycles at full weight to be a rhythm; without this the card payment dips from 94% to 85% at one half-life and recovers at the next |
| `taperHalfLifeCycles` | 3 | how fast older cycles fade | short enough to follow a habit that moved, long enough that moving is what it takes |
| `pinLumpsToEventsPerCycle` | true | clusters are the cycle's event count, not a search | Earnin read 74% as three clusters while naming one day |
| `maxLumps` | 4 | the most days a mode may ever claim | no stream in the portfolio needs more |
| `maxExceptionShare` | 0.34 | how much of a mode may be set aside as its own noise | two of six is a late month; twenty of sixty is a different stream |
| `minDominantAccountShare` | 0.75 | when a merge may cross accounts | never fires on the captured portfolio; it is a guard on future data |
| `minTheoryShare` | 0.60 | how much of the stream a reading must explain to be eligible | the payroll theory reads 0.71 of Wages Julien |
| `minMovements` | 4 | the weighted movements needed before a day may be claimed | Whole Foods, nothing since 16 May, falls under it once the old ones fade |
| `minCyclesObserved` | 3 | cycles needed before a rhythm is a rhythm | two payments make a line, not a habit |
| `minSteadyShare` | 0.65 | how consistent the per-cycle count must be to read as steady | reported, not gating |
| `minBusyShare` | 0.8 | how many cycles must carry movement for a spread to be a flow | groceries fill every week |
| `minSpreadEventsPerCycle` | 2 | events per cycle before a flow is a flow rather than a shrug | one wandering payment a month is not a flow |
| `splitByDirection` | true | money out never completes money in | the savings transfer and its pull-backs |

### What it reads today

29 streams reach this stage with a non-yearly cycle and at least one movement. 17 modes name a day;
every other mode is a rate.

**Worked example — the credit card payment.** 38 movements over 37 weekly cycles, almost exactly one a
week, in two clusters:

    d0   22 Dec .. 2 Mar    12 movements
    d4   6 Mar .. 4 Sep     26 movements, every week

Read freely that is two clusters and a 91% claim on a model with two payment days a week in it.
Pinned to the one movement the cycle carries, the 26 are the rhythm and the 12 are the habit it
replaced, leaving as exceptions: **lump, day 4, 100%, 11 off-pattern**.

**Worked example — the savings transfer.** A calendar reminder on the 15th, sometimes paid late, and
occasionally a transfer back out to fund something large. Made to account for all six movements the
model read two lumps half a cycle apart, because March's stray sits opposite the real cluster and
wrapping the circle twice lands them on top of each other. Allowed one exception it reads **lump, day
23 — the 14th — at 73%**, with the pull-backs kept apart by direction and answered as a rate.

**Worked example — Hobby mdm.**

    {
      cycle: Period(monthly),
      modes: [
        {label: "Claude by Anthropic", accountId: "ins_54::9869::credit",
         accountType: "deferred", direction: "out",
         shape: "lump", days: [25], confidence: 0.935, moneyShare: 0.571},
        {label: "everything else (3 payees)", accountId: "ins_54::9869::credit",
         accountType: "deferred", direction: "out",
         shape: "spread", moneyShare: 0.429}
      ]
    }

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
| Where does the ledger reading appear? | **On every stream that has one, decided or not.** `inferred` is present whenever the detector measured something, because "the ledger agrees" and "the ledger was never asked" are different facts. Which of the two is the answer is `cycleOf()`, and that rule lives in exactly one place. Settled 2026-09-12. |
| How does a caller see the working? | **`explainCycle()`, a separate call.** Both readings, every candidate's score, the merchant groups, the route, the quiet count, what a gate refused. Deliberately not part of the answer: a debug surface that rides along inside a contract becomes part of it the first time someone reads it. |
| Which shape does a fractional count name? | **The range it falls in, never a rounded value.** An even number of observed cycles produces a middle count of 1.5 or 2.5, between the counts the shapes are defined on. Rounding makes 1.5 flip between one shape and another on whether the stream happened to be observed for an even number of cycles, which is not a fact about the stream. |
| Is confidence a number, a band, or a label? | **A number, in [0.5, 1], and only where something was measured.** 100% when the reading lands on the declaration; otherwise the fit rescaled from the threshold onto a floor of 50%, so sitting on the threshold reads 50%. It is meant to map to how often the answer holds up, hedged against false positives. Settled 2026-09-12. |
| Does it predict, or also explain? | **Predicts, plus a confidence and how it was determined.** How much further it should explain itself is deliberately not settled — see below. |

### §3, decided

- **A stream is a list of modes, not one shape.** A mode is a payee, in one direction, on one account.
- **Two shapes: `lump` names days, `spread` names a rate.** No third value, no null, no "multi-lump" —
  a mode landing on three days is a lump whose `days` has three entries.
- **Money out never completes money in.** Direction partitions a mode before anything is measured.
- **A pattern may keep its own exceptions**, up to a third of the mode, and what is set aside is the
  mode's own noise rather than something discarded.
- **Recent cycles count for more than old ones**, with the newest three never faded — a half-life from
  the newest cycle lets one movement outvote a year, and a rhythm needs a few cycles at full weight to
  be a rhythm.
- **As many clusters as the cycle carries movements.** A shape that names more days than the forecast
  will use has not decided anything.
- **The confidence bar is a decision, not a display.** A lump under it is answered as a spread.
- **The answer carries no wobble, no histogram, no leg counts and no legs.** Those are the working, and
  the working has its own surface in `explainShape`.

## Still open

1. **How a spread mode appears in an event schedule.** A spread promises a rate, an event schedule
   promises dates, and the one place the output contract and the shape taxonomy have to meet is still
   open. §3 now hands §4 a list of modes rather than one shape per stream, so the question is also
   how several modes of one stream combine into one schedule.
2. **What the horizon actually is**, and whether one horizon serves a weekly stream and a yearly one.
3. **The trim is bounded by buckets, never by legs.** `trimBuckets` drops a fixed number of buckets
   whatever the lattice looks like. On a long weekly lattice that is two of thirty-three; on a
   quarterly lattice over one reporting year it is two of three, which drops the group below the
   two-bucket floor and makes it unscorable. The effect is backwards: it destroys the best-evidenced
   merchant groups and spares the thinnest ones — Medical HSA's 17-leg and 10-leg groups went
   unscorable at quarterly while its two 2-leg groups survived and produced a 99.7%. It also let
   Exceptional Expense score quarterly at 77.1% after the trim discarded the bucket holding 14 of its
   20 legs. Capping the trim by the **share of legs** it discards, rather than by a count of buckets,
   is the proposed fix and is not implemented.
4. **How much a prediction should account for itself.** Today: a confidence and a determination label. Whether
   that is enough, and what a fuller explanation would cost in shape and speed, is open — deliberately,
   because it may need to change.
