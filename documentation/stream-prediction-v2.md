# Stream prediction v2

> **A SPECIFICATION UNDER REVIEW. Nothing here is built, and nothing here is a solution.**
>
> This document states the goal and decomposes it into sub-problems. Each section says what the
> problem *is*, what it takes in, what it must hand back, what makes it hard, and how we will know it
> is solved. It deliberately does **not** say how. Methods are argued one stage at a time, after the
> problem each is meant to solve has been agreed.
>
> **It is not wired to the balance view until the exit criteria are met, by Julien's judgment.** The
> existing model keeps running until then.

---

## The goal

**Given a stream and its transactions, say what that stream will do next — on which account, how
often, in what shape, and for how much — and be honest about how sure that is.**

Three properties make this different from what exists today.

**It is a module, not a layer of the balance view.** Everything it needs comes in as arguments and
everything it decides comes out as a value. It holds no opinion about balances, no reference to a
chart, and no knowledge of which reading it is being asked for. That is what makes it testable on its
own and replaceable without touching what draws.

**It answers per account, and accounts are plural.** A user may connect several checking accounts and
several cards. A stream lives on one of them — sometimes on two — and a balance is drawn for each. A
prediction that says only "$1,700 on the 6th" is not usable; it must say *out of which account*.

**It reports its own confidence.** Every stage below produces a decision AND the evidence that
produced it. A stream the module is guessing about must be distinguishable from one it is sure of,
because the consumer's right response to those is different, and today they are indistinguishable.

### Why v2 rather than repair

The current model reaches the right answer often enough to be useful and cannot say *why* often
enough to be improved. Each rule was added against a case that was visibly wrong; the rules now
interact, and a change that fixes one row moves four others for reasons nobody can trace in advance.
Recent worked examples, kept here as evidence of the failure mode rather than as problems to fix:

| what happened | what it cost |
|---|---|
| a shape read from 6 debit purchases while 229 were on a card | a weekly stream forecast as one monthly lump |
| "movements per turn" counted per calendar month regardless of the stream | every semimonthly stream forecast with two steps instead of one |
| a shape averaged across a change in the declared amount | the old arrangement's day predicted for the new arrangement's money |
| card-routed streams claiming 30% more than the card was charged | the residual pinned at zero, so the card cannot vary |

None of these were detected by a test. All were found by reading one row at a time.

---

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

## §1 — Which account is this stream's

**The question.** For a stream and its transactions, name the account its money leaves. Where the
stream genuinely lives on two, say so — but treat that as the exception it is, not as the general
case.

**In:** the stream, its transactions, the account list with types, the set of account pairings
(card ↔ the account that repays it).

**Out:** one account per stream, or — for the exceptional case — a partition with a share each.
Plus the evidence: how much of the money and how many of the transactions are on each side.

**Two things make it hard.**

*Transfers between a user's own accounts are not spending.* A card repayment leaves checking and
arrives on the card; it is one movement seen twice, and counting it as either an outflow or an inflow
is wrong. These pairs must be identified and removed before anything else is measured, and identifying
them is itself uncertain — the two legs are described differently by different banks, and a refund
looks like an arrival too.

*"Which account" and "how much of it" are different questions.* A stream 98% on a card and 2% on
debit has one home and a rounding error. A stream 68/32 has two bills under one name — water by
transfer, electricity by card — with different counterparties and different dates. The first must not
be split; the second must not be averaged. Where the boundary sits is an open question, not a settled
one.

**Solved when:** every stream is assigned, no repayment leg is counted as spending, and a stream the
rule split can be shown to be two real bills rather than one noisy one.

---

## §2 — How often does it happen

**The question.** Establish the stream's natural frequency.

**In:** the stream's declared period and the history of that declaration; the transactions assigned in
§1.

**Out:** a frequency, and whether it came from the declaration or from the ledger.

**The default is the declaration, because it is a statement of fact by the person receiving the
money.** Transactions are noisy in ways a declaration is not — a cheque moved off a Sunday, a month
with a correction in it, a bank that posts late. Inference from a noisy signal should not overrule a
clean one.

**Yearly is the exception, and it is the whole of the difficulty.** A yearly declaration is a *budget
envelope*, not a rhythm: it says how much per year and nothing about when. Something must be inferred,
and §5 is where that is worked out. This stage's only job for a yearly stream is to hand it on
correctly labelled.

**The open questions.** When does the ledger get to contradict a non-yearly declaration — never, or
under some evidential threshold? What about a declaration that was true and has stopped being true?
And which window is the frequency read from, given a declaration whose amount has changed?

**Solved when:** a stream's frequency matches what its owner would say without hesitation, and the
cases where the ledger and the declaration disagree are enumerated rather than averaged.

---

## §3 — What shape does it take within a cycle

**The question.** Given a known, non-yearly frequency, say how the money is distributed inside one
cycle.

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

## §4 — How much, and when exactly

**The question.** For a stream with a known frequency and shape, produce the amounts and the days.

**In:** everything decided in §1–§3, plus the declaration and the transaction history.

**Out:** the money the stream places on each day of the cycle ahead, per account, with a confidence.

**The unresolved tension is which source owns the amount.** The declaration is what the user
*intends*; the ledger is what actually happened. They disagree constantly, and neither is reliably
right: a declaration goes stale, and a ledger mean is dragged by one unusual month. Today the
declaration always wins and the ledger is used only where the declaration is silent. Whether that is
correct is an open question and probably the highest-value one in this document.

**Outliers are their own problem.** A stream with one $9,625 month among eight $7,600 months is
telling you something, and it is not obvious what: a genuine one-off to exclude, a step change to
adopt, or ordinary variance to keep. Discarding and keeping are both wrong some of the time.

**Solved when:** the amount is right for streams whose amount is knowable, and for the rest the module
says how wide the range is instead of asserting a number.

---

> **At this point the module should predict every non-yearly stream well, on the account it belongs
> to.** That is the first real checkpoint, and §5 and §6 should not begin before it is met.

---

## §5 — Yearly streams

**The question.** A yearly declaration gives an amount per year and no rhythm. Infer the rest.

**Why it is genuinely different.** Every other stream has a declaration that constrains it. A yearly
one has a budget and a year, and everything between is inference. And the streams involved are large:
a $10,000 yearly budget contributes over $1,800 a month to a forecast whether or not a dollar of it
moves.

**The scenarios are not one problem.** They will need enumerating and naming before any rule is
written — a yearly bill paid once on a date, a budget drawn down in instalments, an envelope spent
erratically, an envelope that will not be spent at all, and a yearly *income*, which is a hope rather
than a schedule and may deserve no forecast whatever. These behave differently enough that one rule
covering all of them is unlikely to be the answer.

**The known trap.** A budget that never draws down contributes the same amount every month for ever.
Whether draw-down is measured, and against which transactions, is unresolved — a card-routed stream's
spending is not on the account being predicted.

**Solved when:** each named scenario is recognised from its history, and a budget that is not being
spent stops being forecast.

---

## §6 — Streams split between a card and checking

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

**The module is self-contained.** It can be handed a portfolio and an as-of date and will answer
without reaching for anything else. It has no dependency on the chart, the bench, or the balance walk.

**It is trusted, and trust is demonstrated rather than asserted:**

- every decision it makes carries the evidence that produced it, in a form a person can read;
- it is measured against the real portfolio, not only against fixtures built to test each rule;
- each stage can be turned off independently so its contribution can be priced;
- a stage that fires can be shown to fire for the right reason, and a rule that changes nothing is
  removed rather than kept.

**It is not connected to the bank balance prediction until Julien judges these met.** The current
model stays in place, unchanged, throughout.

---

## Open questions, carried forward

These are not rhetorical. Each one changes the shape of the work.

1. **Does the declaration or the ledger own the amount?** §4 cannot be specified until this is
   decided, and §5 depends on it too.
2. **What is the module's output unit** — money per day per account, or a list of dated events with
   sizes? Events carry more information and are harder to consume; days are the opposite.
3. **How is "as good as possible given known variability" measured per stage?** A stage-level metric is
   needed, or the exit criteria cannot be evaluated except by eye.
4. **Does the module predict, or does it also explain?** Carrying the evidence for every decision has a
   real cost in shape and in speed; it is also the thing that was missing from v1.
