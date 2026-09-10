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

**Owns:** the behaviour of a single stream — its account, its rhythm, its shape, its amount, and the
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

**In:** the stream, its transactions, the account list with types, the set of account pairings
(card ↔ the account that repays it).

**Out:** a `partition` — an array of `accountAllocation`, one per connected account the stream's money
moved through.

| `accountAllocation` | what it is |
|---|---|
| `accountId` | the connected account |
| `accountType` | its type — checking, credit |
| `amountPercent` | that account's share of the absolute money the stream moved |
| `transactionPercent` | that account's share of the stream's transaction count |

Both percentages are taken over the partition, so each sums to 100 across the array.

**Two percentages, because they disagree and the disagreement is information.** A stream can be 98% of
the money on a card and half the transactions on debit — twenty small purchases against two large
ones — and which of those matters depends on the question being asked. Collapsing them into one number
picks an answer on behalf of a caller that has not asked yet.

**No primary account is named here.** Choosing one representative account is a decision that belongs to
whatever needs a single answer, and it is made from these weights. Naming a primary at this layer would
bury that choice in a stage that has no idea what it is for, and every caller that disagreed with it
would have to undo it.

**The pairing comes in; this module does not derive it.** Which checking account repays which card is a
fact about the accounts, established by the transfer legs the data model already pairs — no stream is
involved in knowing it, and every stream on that card gets the same answer. Deriving it here would
recompute one portfolio-wide fact once per stream and let two streams on the same card disagree.

**Transfer legs stay in.** A card repayment moves through two connected accounts, and both movements
are real: each one is attributed here like any other. Recognising the two as one movement seen twice,
and refusing to count it as spending, is reconciliation — it happens downstream, on the output of this
stage, and pulling it forward would make this stage depend on knowing which transfers pair.

**Direction is not tracked here.** A transaction's amount is already signed, so its direction is carried
by the number itself. Nothing at this stage branches on it, and restating it as a separate field would
be a second copy of a fact that can go stale.

**Solved when:** every stream resolves to the weighted partition of the accounts its money actually
moved through — correct for every stream in the captured portfolio, with no error budget.

---

## §2 — Determining the timing

**The question.** Determine the stream's **timing**: how often does it actually move money, and on
what schedule should the next movement be expected?

That is one question with two halves and both are needed. *How often* is a rate — twice a month, every
seven days. *On what schedule* is where in the calendar those fall, which is what makes a date
predictable rather than merely a rate. A stream can have a clean rate and no schedule at all; that is a
real answer and this stage has to be able to give it.

**In:** the stream's declared period and the history of that declaration; the transactions belonging
to the stream on the account it was mapped to.

**Out:** a frequency, and whether it came from the declaration or from the ledger.

**The default is the declaration, because it is a statement of fact by the person receiving the
money.** Transactions are noisy in ways a declaration is not — a cheque moved off a Sunday, a month
with a correction in it, a bank that posts late. Inference from a noisy signal should not overrule a
clean one.

**Yearly is the exception, and it is the whole of the difficulty.** A yearly declaration is a *budget
envelope*: it states an amount per year, and it does not state a rhythm. The stream may well **have**
one — a yearly budget charged every month has a perfectly good rhythm — but it has to be inferred
rather than read, and the arithmetic relating that yearly figure to the size of one movement is unlike
every other case. Both are worked out where yearly streams are treated as their own case, below. This
stage's only job for a yearly stream is to hand it on correctly labelled.

**The open questions.** When does the ledger get to contradict a non-yearly declaration — never, or
under some evidential threshold? What about a declaration that was true and has stopped being true?
And which window is the frequency read from, given a declaration whose amount has changed?

**Solved when:** a stream's frequency matches what its owner would say without hesitation, and the
cases where the ledger and the declaration disagree are enumerated rather than averaged.

---

## §3 — Determining what shape the money movements have during a cycle

**The question.** For a stream whose timing is known and is not yearly, determine what shape the
money movements have during a cycle.

**In:** the stream's timing, its transactions on the account it was mapped to, and the history of its
declared amount.

**Out:** one of a small set of shapes, plus the parameters of whichever it is, plus how confident.

**Three shapes are known to exist and must be told apart.**

| shape | what it looks like | worked example |
|---|---|---|
| **lump** | one event, on a day it keeps | rent, on the 1st |
| **spread** | continuous, no single event | groceries, all week |
| **multi-lump** | several distinct events, each with its own day and size | utilities: water on the 4th, electricity on the 18th |

**Multi-lump is the one that is currently missing**, and it is not the same thing as a split across
accounts, which is treated separately below. Two bills on the *same* account, on different days, are
one stream with two lumps.

**Two things make it hard.** *Drift is not multiplicity* — an event that moves a few days is one lump,
not several, and telling those apart is the difference between one step of $7,837 and two steps of
$6,887 and $950. And *the window pollutes the shape*: a stream whose arrangement changed is two shapes
overlaid, and averaging them describes neither.

**Solved when:** each of the three is identified on real streams that are unambiguously that shape,
and drift is never read as multiplicity.

---

## §4 — Predicting the amount that moves

**The question.** For a stream whose timing and shape are already known, **predict** how much money
moves at each movement those two have placed.

It is a prediction and not a lookup, which is why it carries a confidence: the amount that will move
next is being forecast from a declaration and a history that disagree, not read off a record.

**Timing is not predicted here.** The stream's timing and its shape together have already settled
*when* the money moves; this stage predicts only *how much* moves then. Keeping that boundary is what
stops a good amount rule quietly moving a date.

**In:** the stream's account, timing and shape, plus its declared amount and its transaction
history.

**Out:** an amount for each movement the shape placed, per account, with a confidence on the
amount.

**Which source owns the amount is DELIBERATELY LEFT OPEN, and will be decided case by case.** The
declaration is what the user *intends*; the ledger is what actually happened. They disagree constantly
and neither is reliably right — a declaration goes stale, and a ledger mean is dragged by one unusual
month. Today the declaration always wins and the ledger is used only where the declaration is silent.

This is not an omission to be resolved before starting. It is a decision that belongs to each case, and
committing to one source up front would force the wrong answer onto whichever cases disagree with it.
What this stage must do is make the choice **visible and per-case** rather than global, so that a
stream taking its amount from the ledger and one taking it from the declaration are both legible.

**Outliers are their own problem.** A stream with one $9,625 month among eight $7,600 months is
telling you something, and it is not obvious what: a genuine one-off to exclude, a step change to
adopt, or ordinary variance to keep. Discarding and keeping are both wrong some of the time.

**Solved when:** the amount is right for streams whose amount is knowable, and for the rest the module
says how wide the range is instead of asserting a number.

---

> **At this point the module should predict every non-yearly stream well, on the account it belongs
> to.** That is the first real checkpoint. The two cases below should not begin before it is met.

---

## §5 — Special case: yearly streams

**It is a special case because a yearly stream carries more uncertainty than the rest.** Everything
that follows is why, and what to do about it.

**The question.** A yearly declaration states an amount per year. What rhythm does the stream
actually have, and how does that yearly figure become the size of one movement?

**Why it is genuinely different — and it is not that the rhythm is missing.** A yearly stream can
be as regular as any other; a yearly budget charged every month is a monthly rhythm wearing a yearly
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

**Solved when:** each named scenario is recognised from its history, the rhythm is found where the
stream has one, and a budget that is not being spent stops being forecast.

---

## §6 — Special case: streams split across two accounts

**The question.** One stream that genuinely moves money through two accounts — a card and a checking
account — rather than one. How is it predicted?

**Why it is last.** It is a *composition* of everything above — each side has its own timing, its own
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
have made. That is the measure, and it is deliberately not a percentage: mapping, timing and shape are
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
| Does the declaration or the ledger own the amount? | **Left open on purpose.** Decided case by case as each is reached. |
| What does the module hand back? | **A schedule of predicted events** — date, amount, account, and a confidence on each of date and amount, over a horizon the module sets. |
| How is "as good as possible" measured? | **By Julien's judgment**, auditing each stream of the captured portfolio against the decision he would have made. |
| Who owns card ↔ checking pairing? | **Not this module.** It is a fact about accounts, not about streams, and arrives as an input. `accountLinks()` derives it today from the paired transfer legs. |
| Does it predict, or also explain? | **Predicts, plus a confidence and how it was determined.** How much further it should explain itself is deliberately not settled — see below. |

## Still open

1. **How a spread stream appears in an event schedule.** A question about shape, and the one place the
   output
   contract and the shape taxonomy have to meet.
2. **What the horizon actually is**, and whether one horizon serves a weekly stream and a yearly one.
3. **Whether confidence is a number, a band, or a label.** It has to be usable by a consumer that is
   not a person, and comparable between streams.
4. **How much a prediction should account for itself.** Today: a confidence and a determination label. Whether
   that is enough, and what a fuller explanation would cost in shape and speed, is open — deliberately,
   because it may need to change.
