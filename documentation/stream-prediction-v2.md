# Stream prediction v2

> **THE SPECIFICATION FOR v2. It grows as decisions are made; nothing here is built yet.**
>
> This is where v2 is specified, and it is written to be added to. Today it carries the goal and the
> decomposition — for each stage, what the problem *is*, what it takes in, what it must hand back, what
> makes it hard, and how we will know it is solved.
>
> **Each stage then gains its approach, its constraints and its acceptance criteria as those are
> agreed**, and the stage's status line says which of those it has. Methods are argued one stage at a
> time and written down here when settled: the sequencing is deliberate, the absence of methods today
> is a consequence of it, and neither is a limit on what this document covers.
>
> **It is not wired to the balance view until the exit criteria are met, by Julien's judgment.** The
> existing model keeps running until then.

### How to read a stage

| line | what it means |
|---|---|
| **status** | how far this stage has got: *problem stated* → *approach agreed* → *built* → *audited* |
| **the question** | what the stage decides, in one sentence |
| **in / out** | its interface. Stable once agreed, because the stage after it depends on this |
| the body | what makes it hard, and the evidence behind that |
| **approach** | the method, once chosen. Absent until then rather than guessed |
| **solved when** | the acceptance criterion. Written before the method, on purpose |

---

## The goal

Several features of Kawa rely on predicting future transactions. **This is the module that owns that
prediction for a given stream.**

Given a stream and its transactions, it says what that stream will do next — on which account, how
often, in what shape, and for how much — and how sure it is of each.

Owning it in one place is the point. Prediction is currently spread through whatever needs it, so every
consumer has its own opinion and none of them can be improved without moving the others.

Three things define the scope.

**A module that owns prediction for one stream.** Everything it needs comes in as arguments and
everything it decides comes out as a value. It holds no opinion about balances, no reference to a
chart, and no knowledge of which reading it is being asked for. That is what makes it testable on its
own and replaceable without touching what draws.

**It answers per account, and accounts are plural.** A user may connect several checking accounts and
several cards. A stream lives on one of them — sometimes on two — and a balance is drawn for each. A
prediction that says only "$1,700 on the 6th" is not usable; it must say *out of which account*.

**It predicts, and only predicts.** It does not explain itself. A stream the module is unsure of is
distinguishable from one it is sure of through the **confidence on the prediction**, not through an
account of how the decision was reached. Where a decision needs arguing with, that is a debugging
need, and a debugging surface is built when there is something to debug — not carried by the module
as a standing cost in shape and speed.

### What it hands back

**A schedule of the next predicted events.** Not money per day, and not a distribution — a list of
things expected to happen, which is the form that can answer "when is the next one" without the caller
reconstructing it.

| field | what it is |
|---|---|
| `date` | when the event is expected |
| `amount` | how much moves |
| `account` | which account it moves out of |
| `confidence.date` | how sure the module is about *when* |
| `confidence.amount` | how sure the module is about *how much* |

**Confidence is per dimension, because the two fail independently.** Rent is certain in both. A card
statement is certain in its date and uncertain in its amount. An erratic yearly envelope may be
confident about size and have no idea when. Collapsing those into one number throws away the half the
consumer needs.

**The horizon is a module setting, not a caller's argument.** How far ahead a schedule stays meaningful
is a property of the model — a weekly stream and a yearly one do not become unpredictable at the same
distance — so the module owns it rather than answering whatever it is asked.

**A spread stream still produces events.** "Continuous" is a shape, not an absence of events; how a
spread is expressed in a schedule is a §3 question and is deliberately left open here.

## What this module owns, and what it does not

**Owns:** the behaviour of a single stream — its account, its rhythm, its shape, its amount, and the
uncertainty on each.

**Does not own:** the balance walk, the reconstruction, observed balances, the chart, the accuracy
bench, or the card's *settlement* arithmetic. A card statement is a fact about an account, assembled
from the streams charged to it; this module supplies those streams and does not compute the statement.

**Takes as given:** the account list with types, the transaction ledger, the stream's declaration
(amount and period, with its history), and an as-of date. Nothing else.

**The as-of law is inherited, not re-litigated.** Everything reads only transactions strictly before
the as-of date, and the module must be provably a pure function of that instant.

---

## §1 — Mapping accounts to streams

**Status:** problem stated. Approach not yet chosen.

**The question.** This is a **classification**: mapping accounts to streams. Given a stream and its
transactions, which account is that stream related to?

Money may **leave** that account — an expense — or **enter** it — income, a refund, a
reimbursement. Both are the stream related to that account, and the association is the answer, not the
direction.

Where the stream genuinely moves money through two accounts, say so — but treat that as the exception
it is, not as the general case.

**In:** the stream, its transactions, the account list with types, the set of account pairings
(card ↔ the account that repays it).

**Out:** one account per stream, or — for the exceptional case — a partition with a share each. Plus
the direction the stream moves money in, and how much of the money and how many of the transactions
are on each side.

**Direction is reported, not used to choose.** A wage and a rent both belong wholly to the checking
account they pass through; that they pass in opposite directions is a fact about the stream, and it
matters to the consumer drawing a balance. It is not what decides which account is the stream's.

**Two things make it hard.**

*Transfers between a user's own accounts are neither spending nor income.* A card repayment leaves
checking and arrives on the card; it is one movement seen twice, and counting it as either an outflow
or an inflow is wrong. These pairs must be identified and removed before anything else is measured, and
identifying them is itself uncertain — the two legs are described differently by different banks, and a
refund looks like an arrival too.

*Direction is where a transfer is caught, which is the one place it does work.* Both legs of a transfer
carry the same stream and point opposite ways; that is the signature. Outside that, a stream's direction
describes it rather than places it.

*"Which account" and "how much of it" are different questions.* A stream 98% on a card and 2% on
debit has one home and a rounding error. A stream 68/32 has two bills under one name — water by
transfer, electricity by card — with different counterparties and different dates. The first must not
be split; the second must not be averaged. Where the boundary sits is an open question, not a settled
one.

**Solved when:** every stream is assigned to the account it moves money through, whichever way it
moves; no transfer leg is counted as spending or as income; and a stream the rule split can be shown to
be two real bills rather than one noisy one.

---

## §2 — Interpreting the timing

**Status:** problem stated. Approach not yet chosen.

**The question.** Interpret the stream's **timing**: how often does it actually move money, and on
what schedule should the next movement be expected?

That is one question with two halves and both are needed. *How often* is a rate — twice a month, every
seven days. *On what schedule* is where in the calendar those fall, which is what makes a date
predictable rather than merely a rate. A stream can have a clean rate and no schedule at all; that is a
real answer and this stage has to be able to give it.

**In:** the stream's declared period and the history of that declaration; the transactions assigned in
§1.

**Out:** a frequency, and whether it came from the declaration or from the ledger.

**The default is the declaration, because it is a statement of fact by the person receiving the
money.** Transactions are noisy in ways a declaration is not — a cheque moved off a Sunday, a month
with a correction in it, a bank that posts late. Inference from a noisy signal should not overrule a
clean one.

**Yearly is the exception, and it is the whole of the difficulty.** A yearly declaration is a *budget
envelope*: it states an amount per year, and it does not state a rhythm. The stream may well **have**
one — a yearly budget charged every month has a perfectly good rhythm — but it has to be inferred
rather than read, and the arithmetic relating that yearly figure to the size of one movement is unlike
every other case. §5 is where both are worked out. This stage's only job for a yearly stream is to
hand it on correctly labelled.

**The open questions.** When does the ledger get to contradict a non-yearly declaration — never, or
under some evidential threshold? What about a declaration that was true and has stopped being true?
And which window is the frequency read from, given a declaration whose amount has changed?

**Solved when:** a stream's frequency matches what its owner would say without hesitation, and the
cases where the ledger and the declaration disagree are enumerated rather than averaged.

---

## §3 — What shape does money movement have within the cycle

**Status:** problem stated. Approach not yet chosen.

**The question.** Given a known, non-yearly frequency, what shape does the money movement have
within the cycle?

**In:** the frequency from §2, the transactions from §1, the declaration history.

**Out:** one of a small set of shapes, plus the parameters of whichever it is, plus how confident.

**Three shapes are known to exist and must be told apart.**

| shape | what it looks like | worked example |
|---|---|---|
| **lump** | one event, on a day it keeps | rent, on the 1st |
| **spread** | continuous, no single event | groceries, all week |
| **multi-lump** | several distinct events, each with its own day and size | utilities: water on the 4th, electricity on the 18th |

**Multi-lump is the one that is currently missing**, and it is not the same thing as a split across
accounts (§6). Two bills on the *same* account, on different days, are one stream with two lumps.

**Two things make it hard.** *Drift is not multiplicity* — an event that moves a few days is one lump,
not several, and telling those apart is the difference between one step of $7,837 and two steps of
$6,887 and $950. And *the window pollutes the shape*: a stream whose arrangement changed is two shapes
overlaid, and averaging them describes neither.

**Solved when:** each of the three is identified on real streams that are unambiguously that shape,
and drift is never read as multiplicity.

---

## §4 — Predicting the amount that moves

**Status:** problem stated. Approach not yet chosen.

**The question.** For a stream whose timing and shape are already known, **predict** how much money
moves at each movement those two have placed.

It is a prediction and not a lookup, which is why it carries a confidence: the amount that will move
next is being forecast from a declaration and a history that disagree, not read off a record.

**Timing is not predicted here.** §2 interpreted the timing; §3 said where inside the cycle the
movement falls. Between them the *when* is settled, and this stage predicts only the amount that lands
there. Keeping that boundary is what stops a good amount rule quietly moving a date, which is how v1's
stages grew into each other.

**In:** everything decided in §1–§3, plus the declaration and the transaction history.

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
> to.** That is the first real checkpoint, and §5 and §6 should not begin before it is met.

---

## §5 — Special case: yearly streams

**Status:** problem stated. Approach not yet chosen.

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

**The scenarios are not one problem**, and each has its own arithmetic. They will need enumerating and naming before any rule is
written — a yearly bill paid once on a date, a budget drawn down in instalments, an envelope spent
erratically, an envelope that will not be spent at all, and a yearly *income*, which is a hope rather
than a schedule and may deserve no forecast whatever. These behave differently enough that one rule
covering all of them is unlikely to be the answer.

**The known trap.** A budget that never draws down contributes the same amount every month for ever.
Whether draw-down is measured, and against which transactions, is unresolved — a card-routed stream's
spending is not on the account being predicted.

**Solved when:** each named scenario is recognised from its history, the rhythm is found where the
stream has one, and a budget that is not being spent stops being forecast.

---

## §6 — Streams split between a card and checking

**Status:** problem stated. Approach not yet chosen.

**The question.** Handle the exception §1 identified: one stream, genuinely two accounts.

**Why it is last.** It is a *composition* of everything above — each side has its own frequency, its
own shape and its own amount — so it cannot be specified before those are settled, and it is rare
enough that getting it wrong is cheap compared with getting §1–§4 wrong.

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
have made. That is the measure, and it is deliberately not a percentage: stages 1 to 3 are
classifications with no dollar error, so an accuracy score cannot price them at all, and a model that
agrees with its owner about every stream is the thing actually being built.

Two consequences worth stating, because they are easy to lose:

- **A disagreement is a finding, not a failure.** Where the module and the judgment differ, one of the
  two is wrong and which one is the interesting question. Several of v1's rules exist because the
  ledger turned out to be right.
- **The audit needs the module's decisions to be readable at the moment of judging.** That is a
  debugging surface, built for the audit, and it is not the same as the module explaining itself in
  production — see "It predicts, and only predicts".

**The module is self-contained.** It can be handed a portfolio and an as-of date and will answer
without reaching for anything else. It has no dependency on the chart, the bench, or the balance walk.

**It is trusted, and trust is demonstrated rather than asserted:**

- it is audited against the real portfolio stream by stream, not only against fixtures built to test
  each rule;
- each stage can be turned off independently so its contribution can be priced;
- a stage that fires can be shown to fire for the right reason, and a rule that changes nothing is
  removed rather than kept.

**It is not connected to the bank balance prediction until Julien judges these met.** The current
model stays in place, unchanged, throughout.

---

## Decided

Four questions were open when this was first written. They are settled, and recorded here so they are
not re-opened by accident.

| question | answer |
|---|---|
| Does the declaration or the ledger own the amount? | **Left open on purpose.** Decided case by case as each is reached — see §4. |
| What does the module hand back? | **A schedule of predicted events** — date, amount, account, and a confidence on each of date and amount, over a horizon the module sets. |
| How is "as good as possible" measured? | **By Julien's judgment**, auditing each stream of the captured portfolio against the decision he would have made. |
| Does it predict, or also explain? | **Predict only.** Explanation is a debugging need and gets built when there is something to debug. |

## Still open

1. **How a spread stream appears in an event schedule.** A §3 question, and the one place the output
   contract and the shape taxonomy have to meet.
2. **What the horizon actually is**, and whether one horizon serves a weekly stream and a yearly one.
3. **Whether confidence is a number, a band, or a label.** It has to be usable by a consumer that is
   not a person, and comparable between streams.
