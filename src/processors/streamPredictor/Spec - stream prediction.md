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
| `inferredAmount` | the expected amount for one cycle, **per mode** — §4 answers a list, not a single number | One figure per stream cannot describe a stream that is a $9.99 subscription on a card and a reimbursement into checking. The stream's amount is the sum of its modes, and the modes are what a forecast places. |
| `amountDetermination` | how each mode's amount was reached: the **weighted median** of the cycles a lump landed in, or the **total over the stream's cycles** for a rate | The two are different estimators answering different questions, and which one produced a number changes how much to trust it. A median resists a one-off; a rate must not, because the lumpy months ARE the spread. |
| `transactionBase` | the transactions this prediction was derived from — the reference format is not yet decided | What makes a prediction auditable. The common disagreement is not "is this rule right" but "did it look at what I think it looked at" — a shape read from four transactions when the stream has two hundred is a different problem from a wrong rule, and the two are indistinguishable without this. |
| `predictedEvents` | the schedule — an array of future events, of the shape below | The module's output is this array. Everything else on the prediction describes how the array was produced. |

**An event** — one per expected movement:

| field | what it is | why it is there |
|---|---|---|
| `date` | when the event is expected | — |
| `amount` | how much moves | — |
| `account` | which account it moves through | — |
| `confidence.date` | how sure the module is about *when* — for a lump this is `confidence.day` from §3 | Confidence is attached to each event because it varies from one event to the next, even under the same model: the next movement of a drifting stream is more certain than the fifth. |
| `confidence.amount` | how sure the module is about *how much* — carrying §3's `confidence.arrival`, which asks whether the money comes at all | Kept separate from `confidence.date` because date and amount fail independently: a card statement is sure to land on time but not for how much, and an erratic yearly envelope can be the opposite. §3 already answers these as two numbers. |

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
2. **Two percentages per account**, each taken over the partition so each sums to 100:

   ```
   amountPercent      = 100 x  sum |leg.amount| on this account  /  sum |leg.amount| over all legs
   transactionPercent = 100 x  count of legs on this account     /  count of all legs
   ```

3. **Account kind** comes from `effectiveAccountType`, which lets the user's own override win over the
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
4. **A one-sided claim is not a claim.** If only one reading cleared the bar, the rule declines to
   measure and the declaration stands. This is why `declared` is the most common route, and it is the
   intended shape: inference overrides a declaration only when the ledger says so twice.
5. **A yearly declaration adds two more gates, and nothing else does.** A yearly stream is an
   envelope, so every cycle read off it is an inference about how the envelope happened to be spent
   rather than a rhythm anyone set up. Before that inference replaces the declaration it has to be a
   rhythm someone would actually run — no longer than `maxYearlyInferredPeriod`, route `atypical` —
   and it has to still be running — no more than `maxEmptyCyclesToStayActive` complete empty cycles between the
   last movement and the capture date, route `stale`. Both land back on yearly and neither counts as
   a measurement. **`atypical` is tested first**, so a stream failing both is reported by the more
   basic reason.
6. **The declaration is a ceiling.** A fit may **shorten** the declared cycle, never lengthen it.
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

### Three answers, and two of them are promises

| shape | the promise | what comes with it | worked example |
|---|---|---|---|
| **lump** | money lands on these days of the cycle | `days`, `wobble`, `confidence`, sometimes `rail` | rent, day 12 · the card payment, day 5 · the reimbursement, day 18 |
| **spread** | money is spent at a rate, placed as whole movements | nothing further | groceries, twice a week · Social, three times a month |
| **unknown** | nothing yet | nothing | one option exercise · a payee seen twice |

**`unknown` is the default and the other two are EARNED.** A spread is a real finding — groceries
genuinely arrive at a rate — but used as the answer of last resort it turned the weakest evidence in
the portfolio into its most confident claim: one option exercise last December became a promise of
−$10,582 every month, because a single movement in a single cycle was too thin for a lump, fell
through to spread, and was then divided by its own lattice.

**It is not the old null**, which meant "the observer could not read this" and leaked into an answer by
accident. This is a positive statement with a consequence a caller can act on. It is also not "a
spread of zero" — that says the mode spends nothing, and this says we do not know yet.

**There is no "multi-lump".** A mode landing on three days is a lump whose `days` has three entries.
The count was never a different kind of answer, only a different length of one.

### The rule

1. **Lay every cycle on top of every other.** `cycleBuckets` cuts the legs into cycles phased on the
   module's anchor, and `dayHistogram` counts how many movements ever landed on day 0, day 1, and so
   on. Day 0 is the seam.

2. **Weight each cycle by how recent it is.** The newest `taperShoulderCycles` sit at full weight;
   after that the weight halves every `taperHalfLifeCycles`. Cycles, not days, so a weekly stream and
   a monthly one fade at the same rate against their own rhythm. The weights ride on the buckets, so
   the histogram carries fractional counts and everything downstream sums over them unchanged.

3. **Try every reading of the movements and let the mode pick one.** For a real-time account the
   bank's closures are undone two ways — every movement pulled back to the previous business day, or
   pushed on to the next — and whichever of the three readings explains the mode best wins, with the
   plain reading of the ledger competing on the same terms as the other two. A card is never
   adjusted: it posts when the merchant presents it, so only one reading is even built.

   There were once five. A theory could also propose reading one payee and setting the rest aside,
   which is how a stream-level answer pulled Utilities apart. **The stage now splits by payee before
   any theory is built**, so those two were generated on every mode and discarded by every caller.

4. **Ask for as many clusters as the cycle carries movements.** A cycle that typically carries one
   movement is measured against **one** day; one that carries three is measured against three. The
   count is pinned, not searched for: a shape that names more days than the forecast will use has not
   decided anything.

5. **In focus at that count? Then it is a lump, however many days it uses.** `concentration` at k
   clusters clears `minConcentration` and the movements land on their days. Focus is asked FIRST for a
   reason: two bills a fortnight apart are two dates, not a flow, and Utilities' pair read as one mode
   is two movements a cycle — counting before looking would call perfectly dated bills a rate.

6. **Out of focus, the RATE decides.** A spread is when so many movements happen that precision is not
   worth trying for and a daily amount is the better approximation. At or below `minSpreadEventsPerCycle`
   a month the money arrives all at once, and that is a **lump whose date wanders**: it keeps its
   median day and reports the doubt rather than being smeared or silenced.

   The rate is measured **per month**, because a weekly lattice makes every rate look small — groceries
   at 3.5 shops a month read 0.81 a cycle and would pass for one payment. As a **mean**, because
   `commonest` answered a different question badly: cycles running 1, 1, 1, 2, 5, 8 have a modal count
   of one and carry three. **Weighted by recency**, like everything else. And it says nothing about how
   BUSY the mode is — that asks about arrival, which has its own confidence.

7. **Let a pattern keep its own exceptions.** The movement furthest from the claimed day is set aside
   while that improves the fit, up to `maxExceptionShare` of the mode. What is set aside is the mode's
   own noise — counted and reported, not discarded. The result still has to be a lump: trimming always
   improves a score that rewards landing on a day, so a flow would otherwise shed a third of itself
   chasing one.

8. **Name the day with half the weight on either side of it.** The claimed day is the weighted middle
   of the winning cluster, so a movement from January moves it less than one from last week.

7. **Charge for the claim.** `minLumpConfidence` guards ARRIVAL, not the day: below it we do not know
   whether money is coming at all, and the answer is `unknown`. A date we are unsure of is still a date
   worth naming, and that doubt is reported as `confidence.day`.

### Two confidences, because one number answered two questions

    confidence.arrival    the weighted share of cycles that carried anything    will it come?
    confidence.day        1 − scatter / (cycleDays / 4k)                        do we know when?

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

**They move together on an ordinary bill and come apart on a date that wanders.** Rent is 100% and
92%. Earnin's internet reimbursement arrives in every single cycle and lands anywhere in it: arrival
100%, day 0%. Multiplied into one number that is zero, and a payment we are certain about would be
thrown away for a date nobody asked it to keep — which is exactly what happened while there was one
number.

**The product survives internally as `fit`**, because the collapse test wants both halves at once:
"did absorbing this stray make the host better or worse" is a question about arrival and day together.

**The wobble travels in the answer.** It was dropped while confidence was a single number that already
carried it; with a wandering date it is the only field describing how far it wanders, and a caller
placing money needs it.

### The answer

    {
      cycle: Period,
      modes: [{
        label,        the payee name a person recognises
        accountId,    where it lands
        accountType,  deferred | realTime - decides when the cash actually moves
        direction,    in | out
        shape,        lump | spread | unknown
        days?,        lump only - the days of the cycle it lands on
        wobble?,      lump only - how far each day wanders, in days
        confidence?,  lump only - {arrival, day}, each 0 to 1
        rail?,        lump only - {closures: early | late | ignored, tests: n}
        repayment?,   this mode is one half of a card repayment -
                      {side: card | funding, card, fundedFrom}
        overdue?,     lump only - how far past its own worst wait it is
        quiet,        cycles since this mode last moved - 0 means the newest cycle
        moneyShare    how much of the stream rides on this mode
      }]
    }

**An undetermined field is ABSENT, never a placeholder** — the same contract §2 answers on. A spread
and an unknown have no `days`, no `wobble` and no `confidence`: a spread has no day to name, which is
what makes it a spread, and neither can say how sure it is about one it never claimed.

**A CARD REPAYMENT IS TWO MODES AND ONE MOVEMENT, and the answer says which.** A stream is split by
payee, account and direction, so a transfer always becomes two modes — correct by those rules, and it
leaves nobody holding the fact that the two legs answer for each other. They are estimated
separately and can disagree: on the full ledger the Robinhood card reads +1,355 against −1,355 out of
Spending, and rewound to June the same pair reads +763 against −1,300.

The pairing is read from the ledger once, by `cardRepayments`: a credit on a card with a debit of the
same size on a real-time account within five days is one movement seen twice, and that single match
names the funding account, the repayment legs and the stream that does the repaying. A refund is a
card credit with nothing to answer for it, which is the whole of the difference.

**The label exists because an amount is the wrong answer here.** A repayment is worth what the card
owes on the day, not the middle of its own history — so a caller that cannot tell which mode is the
repayment has to guess, and the guess it would make is to trust the amount.

**`unknown` is an answer, not an absent one.** The observer used to report `shape: null` and this
stage translated it, so half the module tested truthiness and half tested a name — and a reader had
to know which half they were in. There is one vocabulary now, `lump | spread | unknown` all the way
down, and `readable(m)` is the one predicate that asks the question.

### How long since it last moved

**`quiet` is always there**, because a caller cannot tell a rhythm from a memory without it, and zero
is a real answer meaning "it moved in the newest cycle".

**Measured on the STREAM's lattice, never the mode's own.** A mode's buckets stop at its own last
movement, so asked about itself every mode has been quiet for zero cycles and the question answers
itself. Cut against every leg the stream has, a mode that stopped in February is visibly twelve cycles
behind one that moved last week.

**Counted after the collapse**, because a mode that absorbed a stray or gathered a tail is a different
set of movements from the one that went into it.

**It is an observation and not a decision.** §3 says how long the silence is. Whether a silence that
long means the money has stopped coming is §4's call, and §4 has its own setting for it — see
`maxQuietCycles` below.

### What the banks do to the day

**A payment that slid is not a payment that moved**, and which way it slides belongs to the rail the
money travels on rather than to the account it lands in. Three rules sit side by side in the captured
portfolio:

    ACTIVEHOURS INC PAYROLL   due on a shut day 6 times, arrived EARLY every time
    Comcast                   due on a shut day 4 times, collected LATE every time
    Music for Focus           due on a shut day twice, posted ON the shut day both times

A payroll credit is funded the Friday before; a direct debit is taken the Monday after; a card does
not care. All three can sit on one account, so it is learned per MODE.

**Only where every observed closure agreed**, over at least `minClosureTests` of them. A monthly bill
meets a weekend three or four times a year, so one disagreement is a third of the evidence and a rule
drawn from that would move a forecast off a day it has no business leaving. Six modes qualify today;
four more have three observations each and disagree with themselves, and get no rule at all.

**Read off the raw ledger, never off the adjusted lattice.** The buckets a mode is SHAPED on may hold
dates the closure theories already moved, and asking those which way the bank pushed them is asking
the adjustment about itself — it answered "posts anyway" for a payroll that is six for six early,
because by then the six had been snapped back onto their due day.

**Absent means not enough closures have been met to know**, which is not the same as "nothing
happens" and must not be read as it. Four modes in the predicted cycle land on a shut day with no
rail; they are left where they are, because guessing would put the money on a day nothing has ever
landed on.

**Everything else is the working, and the working has its own surface.** `explainShape` returns the
same modes carrying the movements they were read from, the histogram, the cycles observed, which
closure theory won, what was set aside as exceptions, which payees were merged in, the wobble, and the
reason where there is no lump. The bench page is drawn from it. Nothing downstream of this module
reads it.

### The settings

| setting | value | what it decides | measured on |
|---|---|---|---|
| `minConcentration` | 0.75 | how sharply movements must cluster to be a lump at all | the portfolio's bills all clear it; groceries read 0.11 |
| `minClosureTests` | 2 | how many shut due-days before a rail is a rule | at 2 the portfolio learns six rails; the four modes with three disagreeing observations correctly learn none |
| `minLumpConfidence` | 0.60 | the ARRIVAL a mode needs before it may name a day at all | below it we do not know whether money is coming; every mode that clears it arrives in at least two cycles of three |
| `minSpreadEventsPerCycle` | 2 | movements a MONTH before smearing beats dating | nothing sits between 1.5 and 2.7: above are groceries at 6.8, Costco 3.5, Social 2.9; below are Laundry 1.5, Gas 1.3, every ordinary bill 1.0 |
| `taperShoulderCycles` | 3 | how many recent cycles are never faded | a rhythm needs a few cycles at full weight to be a rhythm; without this the card payment dips from 94% to 85% at one half-life and recovers at the next |
| `taperHalfLifeCycles` | 3 | how fast older cycles fade | short enough to follow a habit that moved, long enough that moving is what it takes |
| `pinLumpsToEventsPerCycle` | true | clusters are the cycle's event count, not a search | Earnin read 74% as three clusters while naming one day |
| `maxLumps` | 4 | the most days a mode may ever claim | no stream in the portfolio needs more |
| `maxExceptionShare` | 0.34 | how much of a mode may be set aside as its own noise | two of six is a late month; twenty of sixty is a different stream |
| `minDominantAccountShare` | 0.75 | when a merge may cross accounts | never fires on the captured portfolio; it is a guard on future data |
| `minMovements` | 4 | the weighted movements needed before a day may be claimed | Whole Foods, nothing since 16 May, falls under it once the old ones fade |
| `minCyclesObserved` | 3 | cycles needed before a rhythm is a rhythm | two payments make a line, not a habit |

**Twelve settings, and every one of them decides something.** Four more were declared here and read
nowhere, which is worse than a wrong value because it reads as a control a future editor could turn:

| removed | what it used to do | why it stopped mattering |
|---|---|---|
| `minTheoryShare` | how much of a stream a reading had to explain to be eligible | theories no longer split by payee — the stage does that first, so every theory covers every leg and every share is 1 |
| `minSteadyShare` | how consistent the per-cycle count had to be to read as steady | focus replaced counting: whether the days cluster is a different question from how many there are |
| `minBusyShare` | how often a cycle had to carry anything for a flow to be a flow | the same question is now ARRIVAL, which has its own confidence and reaches the answer |
| `splitByDirection` | money out never completes money in | still true, and structural: `streamModes` builds one mode per payee **per direction**, so there was never a path in which turning it off meant anything |

### What it reads today

29 streams reach this stage with a non-yearly cycle and at least one movement. **23 modes name a day**,
seven of them with a learned closure rail; **7 are rates**; the rest are `unknown` and promise nothing.

**The seam is a calendar day, not an instant.** The lattice is walked with `Time.js`, which builds
LOCAL dates, and a ledger date is UTC midnight. West of Greenwich local midnight is later in the day,
so a payment on the 27th sat 5 days and 16 hours after a seam on the 21st and `dayInCycle` floored it
to 5 — every claimed day was one lower than the calendar offset it describes. It only mattered once a
day became a date: §3 labels a cluster and a label one off is still a label, but §4 emits a date, and
the closure rule made it worse than wrong by asking "was the due day a Saturday" about the Friday.
Every bucket edge is now pinned to UTC midnight of the day it means, and the walk compares seams too.
Seventeen of the eighteen claimed days moved by exactly one with identical confidence; §2's validated
cohort is unchanged.

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

**Worked example — the payroll and the banks.** `ACTIVEHOURS INC PAYROLL` claims day 9 of a
semimonthly cycle. Six times in seventeen cycles that day was a Saturday, a Sunday or a holiday, and
six times out of six the money arrived two days early — the employer funds it before the weekend. The
answer carries `rail: {closures: 'early', tests: 6}`, and §4 moves the claim to the previous business
day whenever the due day is shut.

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
        // the Claude subscription has met only two shut days and disagreed with itself,
        // so it carries no rail
      ]
    }

**Solved when:** every stream in the captured portfolio is shaped correctly, validated by Julien.

---

## §4 — Predicting the amount that moves — **BUILT**

> **This section was rewritten.** What follows replaced an earlier per-allocation design
> that predicted one amount for a whole stream; it was carried as "Appendix A" while it
> was proved out against the captured portfolio, and is now the section itself.

---

### The inversion this started from

**§3 used "not enough evidence for a lump" as positive evidence for a spread.** `minCyclesObserved`
blocked the lump, the mode fell through to `spread`, and §4 divided its total by the lattice. The
weakest evidence in the portfolio produced its most confident claim:

    Option Exercise / Carta      1 movement,  1 cycle   ->  -$10,582 EVERY MONTH
    Day Care Eleonore / Check    2 movements, 2 cycles  ->   -$2,400 every month
    6 of 45 modes rested on a single movement and claimed $10,604 a cycle between them

A spread is a real finding — groceries genuinely arrive at a rate — but it is EARNED, and it cannot
be the answer of last resort.

---

### Four gates, and none may raise a claim

    0. EVIDENCE    has enough happened to say anything at all?
    1. SHAPE       a date, a rate, or nothing?
    2. LIVENESS    is it still running?
    3. BUDGET      does the claim fit the envelope the user drew?

Gates 0-2 read the stream's own behaviour; gate 3 reads the user's intent, which is why it is last —
it is the only one that can veto a healthy rhythm. **Every gate may only narrow what came in.** That
invariant is what makes the order safe to reason about, and the suite asserts it across the portfolio.

---

### Gate 0 — Evidence

**`unknown` is the default.** A mode below the evidence bar promises nothing. The bar is §3's own:
`minCyclesObserved` cycles and `minMovements` WEIGHTED movements, so a handful of stale movements
cannot carry a mode once the taper has faded them.

**A declaration can stand in for evidence the ledger has not had time to produce.** A declaration is
written BEFORE the money moves, so a first movement matching it exactly is two independent sources
agreeing, and the second could not have been fitted to the first. Four conditions, and the last two
are what make it safe:

    1. the declaration came first      otherwise it describes the ledger and proves nothing
    2. the first movement after it matches the amount, inside plannedAmountBand
    3. they are adjacent in time       within plannedWithinPeriods of each other
    4. the declared period IS the cycle §2 answered with

Ten streams match on amount alone; only five have the declaration next to the money. Earnin's $50 was
declared in 2021 and first paid in 2025 — a dormant stream resuming, not a plan starting. Of the five,
only **Day Care Eleonore** needed the rule; the other four already read as lumps from their own ledger.

**It grants evidence, not immunity** — a planned mode still passes through liveness and budget.

---

### Gate 1 — Shape

    lump      lands on named days, one or more
    spread    arrives at a rate, placed as whole movements
    unknown   promises nothing yet - the default

**`unknown` is not the old null.** That null meant "the observer could not read this" and leaked into
an answer by accident. This is a positive statement a caller can act on. It is also not "a spread of
zero", which says the mode spends nothing.

#### Focus decides first, then how often

**Two bills a fortnight apart are two dates, not a flow.** Utilities pays Conservice and the city on
the same day; as one mode that is two movements a cycle, and counting first would call a pair of
perfectly dated bills a rate. So concentration is asked first: if the movements land on their days,
how many of them there are is not the question.

**Out of focus, the rate decides.** A spread is when so many movements happen that precision is not
worth trying for and a daily amount is the better approximation. One a month is the opposite — the
money arrives all at once, and smearing $50 across thirty days as $1.67 a day describes nothing that
happens. That is a **lump whose date wanders**, and its median day with the doubt attached is the
honest answer.

**Measured per month, as a weighted mean.**

- **Per month, not per cycle**, because a weekly lattice makes every rate look small: groceries at 3.5
  shops a month read 0.81 a cycle and would pass for one payment.
- **A mean, not a mode.** `commonest` answered a different question badly — cycles running 1, 1, 1, 2,
  5, 8 have a modal count of one and carry three, which left Social's 24 movements in 8 cycles unread.
- **Weighted by recency**, like everything else. Laundry ran 3, 3, 0, 1, 2, 2, 1, 1, 1 and the recent
  cycles are the ones that describe it.
- **And nothing about how busy it is.** The old test also demanded most cycles be filled, which asks
  about ARRIVAL and now has its own confidence; keeping it here cost the portfolio its only genuine
  flow — Loki's Grocery Outlet at 1.88 a cycle, refused for being 75% busy against a bar of 80%.

**The line sits at two a month**, with room on both sides:

    above:  groceries 6.8 . remainder 6.1 . Costco 3.5 . Amazon 3.2 . Social 2.9 . Loki 2.7
    below:  Laundry 1.5 . Gas 1.3 . the Expensify reimbursement 1.3 . every ordinary bill 1.0

#### Two confidences, because one number answered two questions

    confidence.arrival    the weighted share of cycles that carried anything    will it come?
    confidence.day        how tightly those landed on the claimed day           do we know when?

They move together on an ordinary bill — Rent is 100% and 92% — and **come apart on a date that
wanders**: Earnin's internet reimbursement arrives in every cycle and lands anywhere, so arrival is
100% and the day is 0%. Multiplied into one number that is zero, and a payment we are certain about
would be thrown away for a date nobody asked it to keep.

**`minLumpConfidence` guards ARRIVAL.** Below it we do not know whether money is coming at all, which
is the `unknown` case. A date we are unsure of is still a date worth naming; that doubt is reported.

**The product survives internally as `fit`**, because the collapse test genuinely wants both halves at
once — "did absorbing this stray make the host better or worse" is a question about arrival and day
together.

**The wobble is back in the answer.** It was dropped when confidence was one number and already
carried it; with a wandering date it is the only field describing how far it wanders.

#### What the banks do to the day

**A payment that slid is not a payment that moved**, and which way it slides belongs to the RAIL the
money travels on, not the account it lands in:

    ACTIVEHOURS INC PAYROLL   due on a shut day 6 times, arrived EARLY every time
    Comcast                   due on a shut day 4 times, collected LATE every time
    Music for Focus           due on a shut day twice, posted ON the shut day both times

Learned per mode, from the RAW ledger, and only where every observed closure agreed over at least
`minClosureTests`. Reading the adjusted lattice instead asked the adjustment about itself and answered
"posts anyway" for a payroll that is six for six early. Absent means not enough closures have been met
to know — never "nothing happens".

---

### Gate 2 — Liveness

#### A rate: silence

**The taper models decay of relevance and cannot model cessation.** Old cycles are worth less every
half-life and never worth nothing, so a mode that has ended keeps claiming a fraction of what it used
to move. The disability deposits went from $830.59 a cycle to $191.46 and still to nothing real.

Past `maxQuietCycles` a rate predicts zero. **`quiet` is counted against the ANALYSIS DATE**, not the
stream's newest leg: `cycleBuckets` stops its walk at the last movement, so a stream that stopped
entirely read as perfectly current — Gembah reported quiet 0 having not paid in 43 days.

#### A lump: it has waited longer than it has ever waited

**Wobble is the wrong yardstick** and was the first thing tried: it measures deviation around the day
INSIDE a cycle, and the question is the gap BETWEEN cycles.

**Scaled by the day confidence, which removes the need for a second number.** A metronome 40% late has
stopped; a payment that never kept a day is being itself. Gembah keeps its day to 90% and must pass
1.11 to be called stopped; the reimbursement keeps its to 65% and must pass 1.54 — without the scaling
it was declared dead at 1.06, on noise.

**It is a suspicion, not a conclusion.** The mode keeps its history, its money share and its identity;
it stops promising.

**And only a plan can run out.** That is the whole of the difference between the two cases this gate
has to tell apart, and it is a distinction Gate 3 already draws. Gembah is a fixed sum being paid
down: a payment that does not arrive is evidence the sum is finished, because there was always going
to be a last one. Julien's savings transfer has nothing to finish — money moved into savings is not
spent — so a month it skipped is a month it skipped.

So the strict bar applies to a **plan** (a yearly declaration). An open-ended stream is judged by the
standard a rate is judged by: one missed cycle is an ordinary late payment, two is a habit that
stopped. At `lateMultipleOpenEnded` a monthly lump keeping its day to 0.9 survives to 1.78 of its
worst wait — about two missed dates — which is `maxQuietCycles` said in the units a lump is measured
in.

| | declared | envelope | bar | on 1 Aug 2026 |
|---|---|---|---|---|
| Gembah | yearly | plan | 1.11 | overdue 1.39 → **stopped** |
| Savings transfer | monthly | refilling | 1.91 | overdue 1.47 → **predicts** |

Measured: the savings transfer had been silenced from roughly 16 July to 13 August, and the module
now forecasts it on **14 August at −$6,000** — the day and the amount that happened. Nothing else in
the portfolio changes: at today's as-of Gembah is still the only late mode, and the DNA bench is
unmoved at cycle 91%, shape 83%, day 99%, rail 85%.

---

### Gate 3 — Budget

**One rule: the DECLARED period decides whether a budget can constrain a forecast at all.**

#### A yearly declaration is a finite plan

Many movements share one envelope, so it can be spent. A movement is predicted only if the stream
stays within `budgetBand` of target AFTER it — spend-to-date is not enough:

    Gembah    spent -$11,299 of -$10,000            113%   passes a 115% bar
              + a 5th payment of -$2,626    ->      139%   refused

**At STREAM level**, because a yearly declaration is a plan for the whole stream and no mode carries
it alone. **A refused movement predicts ZERO**, never the remaining envelope: capping Gembah at the
$1,299 left would invent a payment of a size that never occurs, and the remainder would then be
compressed into the cycles left in the year, inflating every later prediction until it was used up.

**On this ledger gate 3 refuses nothing**, and the suite pins that rather than hiding it: every stream
past its plan was already silenced by an earlier gate. Gembah would have been refused on 28 August,
weeks before its silence was visible.

#### A cycle declaration is an envelope that refills

It is restored every cycle, so it cannot constrain anything — it can only be compared. Consistent
overshoot means the budget is miscalibrated, not that the spending will stop, so the observed trend is
projected and the gap reported. **Rebaselining requires a cycle that repeats**: Hobby mr and Sport
overshoot by 367% and have no rhythm to project onto, so they are alert-only by the rule and by
necessity.

**The comparison is RATE against BUDGET, never spend-to-date against budget** — for a weekly envelope
"spent so far this week" is meaningless at any instant.

#### And it is asked PER ACCOUNT

**A transfer between two of your own accounts nets to nothing at the stream and moves both balances.**
Savings summed to $0 a month and reported "0% of a -$4,000 budget", hiding the $6,000 that leaves
Spending every month behind its own mirror. So every account carries its own position, rate and
rebaseline:

    Savings Account  ..1721    +$6,000 a cycle here
    Spending Account ..4759    -$6,000 a cycle here . 150% of the -$4,000 budget

**The budget's sign says which side it describes.** A declaration of -$4,000 a month is about money
LEAVING, so it is compared with the account that loses money; the other side reports its rate and no
ratio. The PLAN gate stays at stream level.

---

### Two windows, not one

**An amount change is evidence about the amount and says nothing about the rhythm.**

    the rhythm     the whole analysis year          legsInWindow cuts at the anchor, nowhere else
    the amount     from the latest declaration      two amounts overlaid describe neither

Day care Emile is the case: its budget was revised on 17 August 2026 and cutting the rhythm there
leaves ONE leg of nine, discarding 214 days of a cheque that has arrived monthly all year. Measured:
15 streams have a declaration change inside the window and 59 legs sit before one; cutting costs
exactly one stream its rhythm and weakens two more.

---

### What §4 predicts

**A lump** predicts its amount on its days, moved by its rail where the banks are shut.

- **The amount is the weighted MEDIAN of the cycles it landed in.** A lump is a repeated thing and a
  one-off must not move it: the savings transfer is four months at exactly $6,000 and two larger ones,
  and $6,000 is the habit.
- **The day is `settleDate(due, rail)`** — forwards, from a date that is due to the date money will
  move. `snapDate` runs backwards, from a recorded date to when it was due; two different journeys and
  only one of them predicts anything.

**A spread** predicts whole movements, placed.

- **The count is the recency-weighted average, rounded**, never fewer than one. A rate is a true
  description and a poor instruction: "-$116 a week" tells a balance nothing about when money leaves.
- **The amount is the total over the STREAM's cycles, never the mode's own** — a mode that appeared in
  three cycles of nine is a rate over nine; over its own three it reads -$73.82 against a real -$24.61.
  Divided equally between the events.
- **The days come from the CLUSTERS, not from a ruler.** `lumpDays` finds n groups and takes each
  one's recency-weighted middle — the same function that gives a lump its day, asked for n. Grocery
  Outlet's week runs 12, 4, 4, 9, 7, 10, 14 and its two shops land on days 0 and 4, where the money
  goes; a ruler would have said 2 and 5. **Even spacing is the fallback** where the days cannot be cut
  into n groups, and the event records which it got.

**An unknown** predicts nothing.

---

### The settings

    minSpreadEventsPerCycle   2       per MONTH, weighted mean. Below it, one movement at a time.
    minLumpConfidence         0.60    guards ARRIVAL, not the day.
    minClosureTests           2       shut due-days before a rail is a rule.
    maxQuietCycles            2       silence before a rate claims nothing.
    lateMultiple              1.0     multiples of a mode's worst gap, DIVIDED by its day confidence.
                                      A PLAN only - a yearly declaration, which can be finished.
    lateMultipleOpenEnded     1.6     the same for a stream with nothing to finish: about two missed
                                      dates, which is maxQuietCycles in a lump's units.
    plannedAmountBand         0.02    how close a first payment must be to its declaration.
    plannedWithinPeriods      1       how near in time the two must be.
    budgetBand                0.15    UNTUNED - Gembah projects to 139%, which clears 10% to 30%
                                      alike, so the portfolio cannot tell them apart. Pick it when a
                                      near case appears.

---

### What this does not solve

1. **A yearly stream with no data predicts nothing**, which is intended — but only because one year of
   transactions is loaded. A yearly envelope repeated across years is a real pattern. **Out of scope.**
2. **The overshoot alert.** Machinery only; the module reports the position and stops there.
3. **A cluster that wraps the seam.** `lumpDays` cuts a linear list, so Grocery Outlet's real peak —
   days 6 and 0, one weekend hump split by the cycle boundary — is found as 0 and 4. The concentration
   maths treats the cycle as a circle; this placement does not yet.
4. **Day Care Eleonore stays `unknown` in §3.** Two cycles cannot clear `minCyclesObserved`, and
   lowering that has a wide blast radius. §4 borrows the declaration instead, which keeps §3 honest.
5. **A rate on very little history.** `minCyclesForRate` was proposed and not built: the evidence gate
   catches today's cases, but nothing yet says a rate needs as many cycles as a lump.


---

### The last function: a list of dated money events

**Everything above describes ONE cycle.** §3 says a mode is a lump on day 11; the gates above say
that lump is −$62.33 and put it on the next cycle. Neither answers the question the rest of the app
actually asks, which is *what moves, on what date, between now and the 30th of June*.

    predictor.scheduleOf(streamId, until, stream?, opts?, cfg?)
      -> {streamId, name, declared, cycle, asOf, from, until, cycles, events[], total, reason?}

    predictor.scheduleAll(until, opts?, cfg?)
      -> every stream's events, merged and ordered by date

Each event:

    {
      date,         when the money actually moves - the rail already applied
      dueDate,      the claimed day before the rail moved it, or null if it did not
      amount,       signed; 0 when a gate refused it
      refused,      'plan' where a gate refused it, else null
      claimed,      what it would have been, kept only on a refusal
      accountId, accountType, accountName, label, direction,
      kind,         lump | rate | planned
      cycle,        1-based index of the cycle this came from; 1 is the cycle containing asOf
      cycleStart, day, wobble, confidence, rail, moneyShare
    }

**Stitching cycles together is not a loop around the single-cycle call**, because three things change
as the horizon extends.

1. **The plan drains as it is spent.** Gate 3 asks whether a claim would break a finite envelope, and
   a projection spends that envelope as it goes. Asked once with today's position and then repeated,
   a stream could overspend its plan for as many cycles as the caller asked for.

2. **And the plan refills on its own boundary.** A yearly envelope ends and the next starts empty. A
   horizon crossing that boundary must roll over, or a stream that overspent once reads as spent for
   the rest of time. The rollover compares a cycle seam against an envelope edge — one pinned to UTC
   midnight, the other off the local `Period` walk — so both are reduced to a calendar day first. Cut
   naively, the refusals ran exactly one cycle past the refill.

3. **The cycle containing the evaluation date is in scope, and the ledger is the guard.** The
   lattice runs to the first seam after a stream's newest movement, so for a live stream its last
   bucket ends in the FUTURE — it is the current, partly-elapsed cycle rather than a finished one.
   Starting the walk after it skipped every claim still to come inside it: on the captured portfolio
   that hid a $6,000 transfer due five days out, and between the capture date and the next seam every
   monthly stream was silent by construction. How much it hides depends only on where the evaluation
   date falls in the cycle.

   The guard against predicting the same money twice is the ledger itself: a mode that has already
   moved inside a cycle does not claim again in it. Rent paid early on the 2nd against a claimed day
   of the 11th would otherwise be predicted a second time. Legs exist only in the past, so the test
   costs nothing in later cycles and needs no special case for the first.

**A claim whose day has passed is not a forecast**, it is a question about the ledger — did it
arrive? — which §3 answers as `quiet` and `overdue`. A balance projection starts from a balance that
already contains everything that has happened, and re-applying a payment sitting in it counts the
money twice, so the floor is the evaluation date. `includePast` is there for a caller that wants to
ask it anyway.

**`asOf` is the capture's date, never the wall clock.** A ledger is a photograph: it stops on the day
it was taken, and every day the clock runs past that is a day of transactions the capture cannot
contain. Read against today, a capture taken last week shows a week of claims that look missing and
are only unphotographed. It defaults to the portfolio's own `today` and the caller may name another —
which moves the FLOOR and not the lattice, because the cycles walked are anchored on the evidence.

**A refused movement is reported as zero, not omitted.** The money was expected and a gate stopped
it, which is a different fact from nothing being due — and a caller summing amounts gets the same
total either way, so saying so costs nothing. A mode that is merely dead emits nothing at all: there
is no claim there to refuse.

**Four ways to get no events, and each says which:** no rhythm at all, a yearly rhythm — which is a
decision rather than a failure, and the yearly section holds it — a rhythm with no mode past the
evidence gate, and a horizon that ends before the next cycle.

**What it reads today.** 156 events from 22 streams over 90 days of the captured portfolio, as of the
capture date.


---

## §5 — Special case: yearly streams — **they predict nothing, unless the envelope is spent steadily**

### The last rescue

**A yearly envelope spent in nearly every month is a flow.** Eléonore is 56 movements across ten
months of the window with no month carrying more than 40% of it — that is a rate whose lattice
happens to be monthly, denied one only because the declaration says yearly.

**The cycle detector cannot answer this.** It scores candidate periods for periodicity, and a flow is
defined by having none; no threshold there can rescue a stream that has no rhythm to find. It is the
wrong question rather than a tight one.

**Nor can the mode machinery.** Read on a monthly lattice these streams come back as confident dated
bills — Amazon on day 17 in one stream, day 8 in another, day 20 in a third, California DMV on day 16
from eight movements in three months. A payee with roughly one purchase a month passes focus
trivially, so splitting by payee and fitting days manufactures precision out of scattered spending.
Eléonore comes back **100% lump**, which is worse than silence.

**So the rescue measures the stream and answers a rate with no days in it**, and it runs last: only a
stream that reached the end of the normal path with no cycle and no events is offered it, so nothing
that already predicts is disturbed.

**What separates a flow from a burst is months touched, not movements.** Voyages has *more*
movements than Eléonore — 78 against 69 — in a third of the months, with 48% of the year in its
biggest one. It is a holiday, and it stays unpredicted.

| setting | value | what it decides |
|---|---|---|
| `rescueMinMonthShare` | 0.75 | the share of the window's months that must carry money — a share, because the window is the anchor to the capture and its length changes with every capture |
| `rescueMinMovements` | 12 | enough movements to be a habit rather than a handful |
| `rescueMaxMonthShare` | 0.50 | no single month may carry most of the year. A stream that nets to nothing scores above 100% here and is refused by the same test, which is right: there is no rate in a year that sums to zero |

**What it reads today.** Five streams rescued — Eléonore, Emile, Hobby mr, Equipment, Exceptional
Expense — at −$852 a month between them. Voyages, Voyages Famille, Ahsoka, DMV fee and seventeen
others stay silent.

**Gate 3 still applies.** A rate spent against a finite envelope stops when the envelope does, which
is the whole point of a yearly declaration.

---

### Everything else about a yearly stream

> **A yearly stream forecasts no movements, deliberately.** Half the portfolio sits here — 32 of the
> 64 reviewable streams — and §3 shapes **zero** modes across all of them. That is not a failure to
> read: a yearly lattice cuts a one-year window into one cycle and `minCyclesObserved` is 3, so there
> is nothing to be steady about. Eléonore has 69 legs across 28 payees and every one is `unknown`.
>
> The envelope is still computed — `budgetPosition` knows Sport is at 367% of its plan and
> Exceptional Expense at 23%, both against 72% of the year elapsed — and Gate 3 still uses it to
> REFUSE a movement that would break a plan. What is deliberately not built is the other direction:
> turning a remaining envelope into predicted movements. **We let them happen instead of predicting
> them.** Finding the pattern in a yearly stream needs several years of ledger, and multi-year
> pattern detection is out of scope for v2.
>
> What follows is the original analysis, kept because it is what the decision was made against.



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

> **Partly answered by §4's gates.** A yearly
> declaration is now treated as a **finite plan**: the envelope can be spent, a movement that would
> break it is refused, and a stream with no data predicts nothing rather than a twelfth of its budget
> a month. What remains open below is how a yearly figure becomes the SIZE of one movement when the
> stream does move — Gate 3 constrains the total and does not derive the instalment.

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

> **Partly answered.** §3 already partitions a stream by account, direction and payee, so the two
> halves are separate modes of one list and cannot double-count by construction. §4's budget
> comparison is asked per account for the same reason — a transfer between two of your own accounts
> nets to nothing at the stream and moves both balances. What remains open is the question below.

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

## Validating against generated truth

Everything above was built against one real ledger and one person's knowledge of what it means, which
is the only evidence that matters and is also 64 streams wide. **The synthetic bench writes the truth
down first**: a thousand streams are generated from explicit parameters, grown into twelve months of
transactions, handed to the real predictor through its front door, and every answer scored against the
parameters that produced it. `syntheticDna.js` generates, `dnaBench.js` scores, `dnaSamples.js` and
`buildDnaAuditPage.js` draw one stream at a time for a human to argue with.

**It proves the detector inverts its own generative assumptions, and nothing more.** The DNA is the
model's own vocabulary, so behaviour the DNA cannot express — a stream that changes rhythm mid-year,
two payees that are really one, a bank that changes its rail — will not appear in the thousand. It is
a regression harness and a disagreement-finder, not evidence about the world.

### What it scores (seed 20260913, 1000 streams, 1490 modes, 12 months)

| question | agrees | where the misses are |
|---|---|---|
| rhythm | 91% | every miss is a real rhythm read as **yearly**; nothing is ever confused for anything else |
| shape | 83% | lump 88%, sparse 89%, wandering 77%, flow 70% |
| day | 99% | within the wobble it was grown with; exactly right 51% of the time, median error 0 days |
| bank rule | 87% | where a rail was learnable at all; saying nothing when no closure was met counts as correct |

**A wrong rhythm is not one error, it is all of them.** Every question below the first is asked inside
a cycle, so a stream that loses its rhythm carries its modes down with it. Shape agreement is 88%
among streams whose rhythm is right.

### What it caught first was itself

Three of the first four findings were bugs in the instrument, each of which looked exactly like
detector error. They are recorded because they are the argument for building one of these carefully:

- **A month is not thirty days.** The generator strode a fixed 30 days where the detector cuts real
  calendar months. Weekly streams came back exact 93% of the time and monthly ones 1%.
- **Local midnight is not UTC midnight.** The lattice was anchored at `Date.UTC(...)`, which west of
  Greenwich is the previous calendar day, so every seam sat one day early: 58 metronome modes out of
  58 came back at exactly −1.
- **Twelve cycles of a weekly stream is twelve weeks.** With a monthly stream in the same portfolio
  the clock ran nine months past the weekly stream's last payment, and the staleness gate correctly
  called it dead. That alone was 77 of the rhythm misses.
- **A mode's account type is a fact about its account.** The generator rolled one independently, so
  modes labelled `deferred` sat in the checking account while the detector read the type off the
  account — the DNA and the portfolio were describing two different worlds.

### The one real check

The refactor that followed was verified by generating §4's page against the real ledger twice, once
with the change stashed and once with it applied: **140,445 bytes, byte for byte identical**. The
synthetic bench says the same thing statistically; the real ledger says it exactly.

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
- **What the banks do to a day is learned per mode, from the raw ledger, and only on unanimous
  evidence.** A payroll pays early, a direct debit collects late, a card does not move; the rule
  belongs to the rail, not the account. Absent means not yet known, never "nothing happens".
- **Three answers, and two of them are promises.** `unknown` is the default; `lump` and `spread` are
  earned. A spread used as the answer of last resort turned one option exercise into a promise of
  −$10,582 every month.
- **Focus decides the shape before the rate does**, because two bills a fortnight apart are two dates
  and not a flow.
- **The rate is measured per MONTH, as a recency-weighted mean**, and says nothing about how busy the
  mode is — that asks about arrival, which has its own confidence.
- **Two confidences: arrival and day.** One number was answering two questions, and their product
  threw away a payment that arrives in every cycle and lands anywhere.
- **A declaration is evidence, not only a constraint**, where it preceded the money, matched the first
  movement and sat next to it in time.
- **A spread is placed, not smeared**: whole movements, counted by the weighted average, put on the
  centres of its own clusters.
- **The budget comparison is asked per ACCOUNT**; only the plan gate is asked per stream.
- **A card repayment is labelled, not inferred downstream.** The two legs are named from the ledger
  once and the label travels with the mode, through the amount stage and onto every scheduled event.
- **The evaluation date is the capture's own, and it is an input.** A ledger stops on the day it was
  taken; read against the wall clock it shows claims that look missing and are only unphotographed.
- **The cycle containing the evaluation date is predicted, not assumed spent.** The lattice's last
  bucket ends in the future for a live stream, and a mode that already moved inside a cycle is what
  stops the same money being claimed twice.
- **One list, ordered by the date the money moves.** A stream's modes sit on up to two accounts and
  the caller wants them interleaved, not filed — every event carries its own `accountId`, so a caller
  that wants them apart can split a sorted list and one that wants a balance never has to merge.
- **The horizon is the caller's question, not the module's.** `scheduleOf` is handed a stop date and
  walks to it; a balance projection to the end of the month and one to the end of the year are the
  same call with a different date. The only ceiling is a cycle count, so a careless caller cannot ask
  for ten thousand weeks.
- **A yearly stream predicts nothing unless its envelope is spent steadily**, in which case it
  earns a rate and never a date. Months touched is what separates a flow from a holiday; the test
  runs last, on streams that produced nothing, so its blast radius is the set that was silent anyway.
- **Multi-year pattern detection is a later question.**
- **A setting that gates nothing is deleted, not documented.** Four lived here reading as controls.
- **Silence is observed in §3 and judged in §4.** How long since a mode last moved is a fact about the
  ledger; whether that means the money has stopped is a forecasting decision, and it lives in §4's own
  settings file.

## Still open

1. **The trim is bounded by buckets, never by legs.** `trimBuckets` drops a fixed number of buckets
   whatever the lattice looks like. On a long weekly lattice that is two of thirty-three; on a
   quarterly lattice over one reporting year it is two of three, which drops the group below the
   two-bucket floor and makes it unscorable. The effect is backwards: it destroys the best-evidenced
   merchant groups and spares the thinnest ones — Medical HSA's 17-leg and 10-leg groups went
   unscorable at quarterly while its two 2-leg groups survived and produced a 99.7%. It also let
   Exceptional Expense score quarterly at 77.1% after the trim discarded the bucket holding 14 of its
   20 legs. Capping the trim by the **share of legs** it discards, rather than by a count of buckets,
   is the proposed fix and is not implemented.
2. **How much a prediction should account for itself.** Today: two confidences and a determination
   label. Whether that is enough, and what a fuller explanation would cost in shape and speed, is open
   — deliberately, because it may need to change.
3. **A cluster that wraps the seam is not seen.** `lumpDays` cuts a linear list of days, so Grocery
   Outlet's real peak — days 6 and 0, one weekend hump split by the cycle boundary — is found as 0 and
   4. The concentration maths already treats the cycle as a circle; the placement does not.
4. **A rate has no evidence floor of its own.** `minCyclesForRate` was proposed and not built. The
   evidence gate catches every case in this portfolio, but nothing yet says a rate needs as many cycles
   as a lump, and the two disagreeing is what produced the inversion §4's gates were written to fix.
5. **The overshoot alert is machinery only.** The module reports where a stream stands against its
   envelope and stops at its own boundary; telling the user is a product decision that has not been
   taken.
6. **`budgetBand` is untuned.** Gembah projects to 139%, which clears any value from 10% to 30% alike,
   so the portfolio cannot distinguish them. It wants a near case before it is settled.
7. **§2 does not rescue a yearly declaration when no candidate clears the fit bar.** Of the synthetic
   bench's 94 rhythm misses, 74 carry a dated mode and **every one of them is declared yearly**: the
   ledger runs monthly or weekly, the fit table scores nothing over the bar, and the declaration
   stands. This is the largest single source of error in the round trip, and it is a §2 question, not
   a §3 one. The other 20 are streams whose every mode is a flow — payments scattered at random carry
   no trace of the lattice they were laid on, so their rhythm is unobservable in principle and
   scoring it measures the generator's bookkeeping rather than the detector.
8. **A lump whose date wanders is the weakest shape**, at 77% against 88% for an ordinary lump. It
   leaks into flow. That is the branch the one-movement-a-cycle rule was written to hold, so which
   side it loses on is worth knowing.
9. **`predictionRows` still dates a dormant stream's cycle from when it went quiet.** Its predicted
   cycle is built from the end of the bucket walk, and the walk stops at the last movement, so a
   subscription that stopped in May is drawn with a predicted cycle dated May. The schedule no longer
   inherits this — its floor is the evaluation date and a dormant stream's modes are silenced before
   they reach it — so what remains is the single-cycle call and the bench drawn from it.
