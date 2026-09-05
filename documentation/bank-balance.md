# Bank balance, to date and ahead

> **EXPLORATORY. Nothing here is built.** This is a spec being reasoned about, not a description of a
> system, and it is the roadmap case that `context.md`'s rule 6 admits: the decisions live here as they
> are made, so the reasoning sits next to the mechanism it will become. Every section is a proposal
> until it ships, and each one is deleted from this framing and rewritten as fact when it does.
>
> It was anticipated before it was specified: `ChartCarousel.js` names "a balance-to-date and its
> forecast" as a page that would follow the macro graph.

## What it is for

Two goals, in the user's own words, and they are not the same view of the same number.

**1. "When is my balance lowest, so I can anticipate a large expense — can I buy the plane tickets?"**
Account-wise. This is a decision about a lump sum, taken today, against a future the account has
already committed to.

**2. "How much money do I really have, behind the credit-card nonsense?"** A card defers the payment
but not the spending, so between the purchase and the statement the current account flatters you. This
goal asks for the number that is not flattered.

Neither is "what did I spend" — the macro graph answers that, and money flow answers where it went.
This is the only view that is about a MOMENT rather than a period, and the only one whose interesting
part is in the future.

**Goal 1 makes the TROUGH the headline, not the crossing.** An earlier draft of this spec said the
headline was the first date the line goes under zero. That is the wrong reading of the wrong question.
Someone deciding whether to buy a plane ticket is not asking "will I ever be broke", they are asking
"how much room is there between now and the tightest point, and does this purchase fit in it". So the
figures the view leads with are **the minimum, the date it falls on, and the headroom above it** —
and zero is only special because it is one floor among several a person might set.

It follows that the view has to answer the question in the form it is asked, which is conditional:
**what does the trough become if I spend X today?** A picture that can only show the trough as it
stands makes the reader do the arithmetic the picture exists to do. See §8.

A view that merely plots a balance is a bank statement with a line through it, and the bank has one.

---

## §0 The dependency that WAS blocking, and how it was resolved

**The balance was not stored anywhere.** Plaid returns it — `ac.balances` was right there in the
response — and [`PlaidConnector.js`](../../src/bankConnectors/PlaidConnector.js) kept
`iso_currency_code` off it and **dropped the rest**. Nothing downstream had ever seen a balance, which
is why this view had never been possible rather than merely never been built.

It is resolved at the level the problem actually sits at, which is the **connector contract**, not
Plaid. [`BankConnector.js`](../../src/bankConnectors/BankConnector.js) documents the account response
every aggregator owes, so a balance added only to the Plaid implementation would have been a field
that silently vanishes the day an account arrives through Powens. The contract now names
`balance: {current, available, limit}`, and both connectors supply it.

Three decisions inside that are worth keeping:

- **A missing reading is `undefined`, never `0`.** Zero is a real balance. A fabricated one is a cliff
  in the chart that no reader can tell from a genuine one, and it would poison the reconstruction for
  every day before it.
- **`available` is reported, not derived.** It is `current` less pending holds, and on a credit account
  it means remaining credit — a different quantity entirely. Powens states `balance` and `coming`
  separately; filling `available` with their sum would produce a number no one could later tell from a
  reported one, so it is left undefined there.
- **Signs are left exactly as the aggregator states them.** Plaid signs a card's `current` positive for
  money owed. Normalising that in the connector would bury the one fact the true reading needs, so it
  is interpreted where the account type is known ([`BalanceChart.js`](../src/components/BalanceChart.js)).

### Where a balance is stored, and why it is its own table

A balance is **an observation with a date on it**, not a property of an account: the same account has a
different one every day, and the entire point of storing it is to look back. That is a growing time
series keyed by user and date — exactly what `Bundlable` is for, and exactly the reasoning that moved
the Amazon order history out of the user document.
[`BalanceSnapshot.js`](../../src/model/BalanceSnapshot.js) is therefore a `Bundlable` in its own table,
not a field on the account. Kept on the account it would be a single number overwriting itself, and the
history this view exists to draw would never accumulate.

**One per account per day.** The dedup hash is the account hash and the calendar day, so a second poll
in the same day updates that day rather than appending to it — the refresh schedule is allowed to
change, a user can force a refresh, and a series with two Tuesdays in it is not a series.

**The capture point costs nothing.** `refreshTransactionsForUserItems` already calls `getAccounts` on
every scheduled run to build its account hashmap; every one of those responses was carrying a balance
that was thrown away. Recording it there needs no new API call, no new schedule and no new rate limit.
It is deliberately fire-and-forget: a balance that fails to save must never take the transaction
refresh down with it.

**The same account through two logins is one account.** The account hash is item-independent precisely
so a joint account reached by two connections can be spotted, and the writer de-duplicates on it — the
transaction path already does the same thing a few lines above.

### Live versus remembered

There are now two sources, and they answer different questions:

- **Live** — `Core.getAccountsWithBalances()`, straight off the aggregator. This is the anchor the
  reconstruction hangs from, and for *now* it is the one to trust.
- **Remembered** — `ApiCaller.getBalanceHistory()`, the stored series. It only accumulates going
  forward, so a caller must read an empty answer as "no history yet", never as "no money".

The view ships on the live anchor alone, which is what makes it correct on day one. The stored series
makes §2a's drift test possible, and it gets better every day without anyone doing anything.

---

## §1 One reconstruction, per account. TWO readings of it.

The reconstruction is always **per account**, filtering transactions by `accountId` rather than by
stream. Everything below is a different way of summing the same per-account curves, which is what lets
one mechanism serve two goals that pull in opposite directions.

### §1a THE ACCOUNT — goal 1

The current account everything runs through, on its own. A card purchase carries the CARD's account id
so it never enters this curve; the monthly payment carries the current account's, so it does — as one
lump, on the day it actually leaves. Nothing is special-cased, and the `isZeroSumStream` machinery is
not needed: the account id already separates them.

This is the operational number. It is what a direct debit will be tested against, and its trough is
what decides whether a lump purchase clears.

### §1b THE TRUE POSITION — goal 2

Cash, **less what is already spent and not yet paid**:

```
true(t) = Σ current accounts (t) − Σ outstanding card balances (t)
```

The "nonsense" is a timing difference, and this removes it by arithmetic rather than by rule. Follow
the two events through:

- **a card purchase**: the current account does not move, the card's outstanding rises by X, so the
  true position falls by X — *on the day you actually spent it*;
- **the card payment**: the current account falls by X, the card's outstanding falls by X, so the true
  position **does not move at all** — because nothing was spent, it was only settled.

That is the whole feature, and it needs no new machinery: an account-wise reconstruction plus a sign.
It also means the cashback is simply earned, with none of the accounting reaching the reader.

An earlier draft of this spec said flatly that "this view is not net worth and does not try to be", and
anchored on one account for both goals. That was wrong — it answered goal 1 and made goal 2
unreachable. It is still not net worth: no assets, no savings, no investments. It is **spendable cash,
honestly dated**, which is a different and more useful thing than either.

### §1c WHICH ACCOUNT, and why combining them was wrong

The first version summed every depository account for the "in the bank" reading. That is wrong, and
wrong in the direction that matters: **a savings balance sitting behind a checking one hides exactly
the trough goal 1 is about.** With $12,000 in savings behind $3,200 in checking, the runway never goes
near its floor, the rent is drawn against money that is not there to pay it, and the tile answers "can
I buy the plane tickets" with a confident yes it has no basis for.

So the reading is the **spending account** — the depository accounts whose `subtype` says they are for
spending — and there are exactly **two** readings:

| entry | what it is | when it appears |
|---|---|---|
| *spending* | the spending account alone | always; the default |
| *spending net of cards* | the same, less what the cards owe | only where there is a credit account |

**Two, not a list of every account.** Enumerating the connected accounts was the first attempt and it
turned one control into a file browser for a question that has two answers. A savings balance is
neither of them: folded into the spending account it hides the trough, and on its own it is not a
runway — nothing is forecast against it and no decision is taken from it. It is simply not what this
picture is about. Where no `subtype` names a spending account, every depository account counts, so a
reader with one account never gets an empty chart over a taxonomy detail.

Because the account and the reading are the same question — *which money am I looking at* — they are
**one control**, and the title stays two tappable words on a phone.

**Per-account forecasting follows from this.** Once the balance on screen can be one account, the
forecast has to know which account each stream lands on, or the rent gets forecast against savings.
`accountRoutingOf` therefore returns the **account a stream's money actually landed on** rather than a
card/not-card boolean, and the forecast takes a `covers(accountHash)` predicate so one rule serves all
three cases — a single account, several combined, or the netted position.

### Which is on screen

They are two readings and both are wanted, so this is a control rather than a decision to be taken
once. §1a is what you look at to ask "will this clear"; §1b is what you look at to ask "how am I
actually doing". Drawing both at once is the obvious idea and probably wrong — the gap between them is
just the card float, which is a third quantity nobody asked for. Left as an open decision.

Savings stays out of both. It is a different account and a different reconstruction, and a later phase.

---

## §2 The past is reconstructed BACKWARDS from today

```
balance(t) = balance(now) − Σ { transactions in (t, now] }
```

This is the single most important decision in the spec, and it is the one most likely to be got wrong
by doing the obvious thing.

The obvious thing is to start at some historical date with an assumed opening balance and add
transactions forwards. That is wrong in a way that never heals: the opening figure is a guess, and the
guess is carried in every value from then to now, so the line is *offset by an unknown constant* while
looking perfectly plausible. Every value is wrong and nothing about the picture says so.

Anchored at a balance that is actually known, the arithmetic runs the other way and the error is
bounded by the transaction record instead of by a guess. It also gives a free invariant worth
asserting: **at `t = now` the curve equals the reported balance by construction.**

**It must use EVERY transaction on that account, not the categorized ones.** This is the trap, and a
real one, because the money-flow adapter does the opposite — it deliberately reads only what is
categorized, and §1.4 there drops anything under a unit. Money leaves an account whether or not anyone
has told the app what it was for.

### §2a THE DRIFT IS THE TEST, and it is the best reason to build this first

The obvious reading of the paragraph above is that drift is a risk to be minimised. It is close to the
opposite.

Every money stream runs through this one account. So if the balance reconstructed from what the app
knows disagrees with the balance the bank reports, **the app is missing something that matters** — an
uncategorised backlog, a disconnected account, a stream nobody modelled, a double count. No other view
can notice that, because every other view is built from what the app already believes and is therefore
self-consistent by construction. This one closes the loop against a fact from outside.

So the residual is not an error bar to be hidden, it is **a first-class reading**: reconstructed against
reported, with the gap named. A drift of zero is a strong statement that the model is complete. A drift
that appears on a particular date points straight at what to go and look at.

---

## §3 The future is the master stream's own arithmetic

```
balance(t) = balance(now) + Σ { expected(s, u) : every stream s, every period u of s in (now, t] }
```

Nothing new has to be invented to forecast, which is the reason to do it this way. The master stream
already answers "what does this stream expect, at this date, over this period"
(`getExpectedAmountAtDateByPeriod`), and it is the same source the money flow's **target** basis reads.
One author for what is expected (DECISION-PRINCIPLES.md #24), and a forecast that cannot disagree with
the rest of the app about what a stream is worth.

Two consequences fall out and both are features:

- a stream with an `endDate` stops contributing after it, for free;
- editing an expected amount moves this line, so the view doubles as the place to see what a change to
  the plan would do.

---

### §3a THE FORECAST IS ONLY AS GOOD AS THE MASTER, and that is a feature

The first question the prototype was asked was "why does it climb, when I offload to savings
regularly?" — and the answer was in the master, not the drawing. It expected +$4,266 a month, for two
reasons neither of which the reader knew (+$3,766 once a transcription slip in the fixture was
corrected — the savings stream had been stepped up from -3,500 to -4,000 and the prototype had read
the earlier entry):

- `Investments` had been set to **-0.10 a month** on a date some months back, down from -7,550. The
  master had stopped expecting the investing that was still happening;
- expected wages ran about a third ahead of actual — $15,674 a month against $11,670 measured.

Both are real facts about the model that no other view surfaces, because every other view either shows
what happened (and so cannot see a stale expectation) or shows what is expected (and so agrees with
itself). A forecast is the only thing that turns a stale expectation into a visible, wrong slope.

So the rule: **when the line does something the reader does not believe, that is a finding about the
model and the view should help them get to it.** The breakdown that answered the question — every
stream's expected contribution per month, biggest first — is not a debugging aid, it is the second
screen of this feature.

A note on how the slip was found, because it generalises. The reader spotted it by knowing his own
number — "I move 4k, where is 3.5k from" — which is the same move as §2a: an outside fact disagreeing
with the model. A view whose figures are checkable against what someone already knows gets audited for
free, which is an argument for showing the per-stream breakdown rather than only the curve.

A note on a convention that made it worse. Several streams carry amounts like `0.01`, `-0.1`, `1` and
`-1`, which are evidently "park this stream" rather than estimates. That is fine for the money — they
contribute nothing — but it means **parking a stream silently deletes a real flow from the forecast**,
and nothing anywhere says so. Whether the model should distinguish "expected to be nothing" from
"parked" is a question for the master, not for this view, but this view is where the cost shows up.

---

## §4 Measured and predicted are different KINDS of line, and must look it

They meet at `now` and must meet exactly — no step, no gap — because a discontinuity there would be
read as an event rather than as the seam it is.

But they must not be one continuous stroke. One half is a record and the other is arithmetic about
things that have not happened, and a single unbroken line claims the same standing for both. The macro
graph already separates a measured series from a projected one and this should read as the same
distinction, said the same way.

---

## §5 The shape of a period's spending is MEASURED, not assumed

The first draft of this rule said "a staircase, not a slope", reasoning that money arrives on dates and
a ramp is false on every day between them. That is right about rent and wrong about groceries — and the
app already knows which is which, so neither assumption is needed.

`ReportingCore.getFrequencyHistogramAtDate(date)` bins every transaction of a stream by where it fell
within its sub-period, **weighted by amount rather than by count**, aggregated across every period in
the observation window, normalised, and rotated so the calendar's start sits at index zero. It is
already the answer to "when in a month does this stream's money actually move", measured rather than
assumed.

So the forecast spreads each period's expected amount across that period's subdivisions **in the
proportions the histogram gives**, and the shape then tells the truth about both kinds of stream
without being told which is which:

- rent, salary, a subscription — one spike, so the forecast is a cliff on that day, precise to the day,
  because the transaction is programmed and always has been;
- groceries, fuel, small spending — a broad shape, so the forecast is a genuine ramp, which is now a
  measured fact about how that money leaves rather than a smoothing artifact.

Two cautions for whoever implements it. The histogram is normalised **by its maximum, not its sum**, so
it is a shape and not a distribution: it must be re-normalised to sum to one before being used as
weights, or every stream is forecast several times over. And it is amount-weighted, which is exactly
right here — a balance cares where the money goes, not where the transactions go.

The past is a staircase for the same reason and comes out as one for free: a transaction is a step.

---

## §6 What the picture cannot say, said out loud

- **Accounts the app cannot see.** A balance is only the balance of what is connected. If a
  disconnected account is where the rent comes from, the line is wrong and nothing in it will say so.
- **Pending transactions.** They move the available balance and not the posted one, and the two answer
  different questions. Which of them anchors §2 is an open decision below.
- **Timing within a period.** A monthly stream expects an amount over a month; it does not say which
  day. §5 needs a date to draw a step on, and the master does not hold one — see the open decisions.

---

## §7 The invariants, for whenever the tests come

- at `t = now`, the curve equals the reported balance (§2);
- the past series changes only at transaction dates, by exactly that transaction's amount;
- the future series changes only at expectation dates, by exactly that expectation;
- past and future meet at `now` with no discontinuity (§4);
- with no expectations at all, the future is flat — never drifting, never trending;
- **a card payment moves §1a and does not move §1b** — the one invariant that says the credit-card
  timing has actually been removed rather than merely hidden;
- **a card purchase moves §1b on its own date, and §1a not at all**, which is the same statement read
  the other way;
- the reported trough is the minimum of the series actually drawn, and its date is a date in it —
  trivial, and worth asserting, because a trough computed off a different array than the one on screen
  is the kind of thing that stays right until the day it does not;
- **every predicted movement comes from a TERMINAL stream, and the settlement is the only exception**
  — see below.

### §7a Every prediction comes from a terminal stream

`CompoundStream.getExpectedAmountAtDateByPeriod` is **defined** as the sum of its active children, so a
parent has no amount of its own: asking a compound and asking its leaves is the same question, and
reading both double-counts. `forecast()` therefore walks `getAllTerminalStreams()` and never once looks
upward. This is the same rule the money-flow adapter follows for the same reason, where it is written
as "a second author for the same quantity".

The stronger reason is specific to this view: **the shape only exists at the leaves.** Measured on the
real portfolio, as the number of days carrying 80% of a stream's money:

| stream | days for 80% | biggest single day |
|---|---|---|
| Rent (terminal) | 1 | 83.3% |
| Groceries & Hygiene (terminal) | 31 | 0.0% |
| Utilities (terminal) | 2 | 50.0% |
| **Home (the compound: all five pooled)** | **2** | **72.9%** |

Rent is a cliff, groceries a flat ramp, utilities has its own two-day signature. Pooling them does not
produce a blur — it produces **rent wearing the compound's name**. The other four are still in there
and are now 27% of a distribution whose peak says "rent", so the bead on the line would sit on the 1st
and be labelled *Home*, and the reader loses the one thing they came for: *which* of those moved, and
when. Per terminal, three distinguishable events survive; at the compound, one.

### WHICH CYCLE IS THE STREAM ON — detected, not assumed

Everything here began by assuming a **month**. That assumption is invisible when it holds and destroys
the picture when it does not: a weekly payment lands on roughly thirty different days-of-month over a
year, so binned by day-of-month it looks **perfectly diffuse**. The forecast then spreads a large
recurring expense into a flat drizzle, it has no step, it earns no badge, and it vanishes from a chart
that is read for its steps. That is how a day-care bill the size of rent can be invisible while every
total that mentions it is correct.

**Not a Fourier transform**, and the reason is the domain rather than the maths. Money is calendar
driven, not sinusoidal: "the first of the month" and "every other Friday" are not frequencies, and
months are not equal in length, so a fixed-frequency basis smears exactly the events that are most
regular. The candidate set is small, known, and made of real calendars — so the honest method is a
cascade: try each, measure which fits. A periodogram over the periods money actually uses.

Three candidates: **weekly** (7 bins), **biweekly** (14, phased from a fixed epoch), **monthly** (31).
Monthly also covers semimonthly, which appears as two spikes in a month of bins — a true description
needing no candidate of its own.

**The statistic must be comparable across bin counts**, which is the easy thing to get wrong. Raw
concentration rises with the number of bins for free: two transactions over 31 bins look more
concentrated than two over 7, purely because there is more room to be apart in. So each candidate is
scored against what randomness would produce for the *same* number of observations
(`H − E) / (1 − E)`, where `H` is the sum of squared shares and `E = 1/k + (1−1/k)/n`), and a
candidate wins only by beating its own null.

**The longest cycle goes first, and a shorter one must earn the swap.** A shorter cycle is trivially
satisfied by a longer one: money moving every *other* Friday lands on a Friday every time, so "weekly"
fits it perfectly and scores exactly as well as "biweekly". Scored on a tie the shorter one wins by
accident, and the forecast draws four half-sized payments where two full ones belong — the same
disappearing-step fault, arrived at from the other direction. The reverse is not symmetric, which is
what makes the ordering sound: a genuinely weekly stream binned into a fortnight spreads across both
Fridays and scores about half. Measured:

| fixture | detected | biggest daily step |
|---|---|---|
| day care, $400 every Monday | weekly | −$391 |
| day care, $1,733 on the 3rd | monthly | −$1,733 |
| pay, $800 every other Friday | biweekly | −$783 *(was −$391 before the tie-break)* |
| groceries, $25 daily | monthly | −$25 |

**The weights then describe one turn of the stream's own cycle**, and the monthly figure is divided
into the turns that fit in the month before being placed inside one:
`part = (monthly / cyclesPerMonth) × weight[phase]`. For a monthly stream `cyclesPerMonth` is 1 and
this is exactly what it was. A consequence worth knowing: a month with four Mondays forecasts four
payments, not 4.33 — so a weekly stream's month total varies with the calendar, which is truthful for
that month and averages out exactly over a year.

**Two observations are enough, if they agree.** A minimum sample size was the wrong instrument, and
demanding six rejected a clean monthly signal from a stream that had only just started — a day-care
bill enrolled in September has two payments by November and is not therefore mysterious. The evidence
is not *how much data is there* but *do the phases match a cycle we already know about*: the same
day-of-month twice is a one-in-thirty-one coincidence, which is stronger than six scattered payments.

**Confidence then scales with the count**, which is what the sample size was clumsily standing in for.
Perfect agreement of `k` observations across `n` bins happens by chance with probability `n^(1−k)`, and
that figure is the bar — applied per candidate, so it automatically asks for more evidence exactly
where a cycle is easier to match by accident:

| history | detected | biggest step |
|---|---|---|
| one payment only | monthly | full month on that day |
| two, same day-of-month | monthly | full month on that day |
| two, drifted 5th and 7th | monthly | full month (consolidated) |
| two, unrelated days | monthly | split in two — an honest read of two disagreeing observations |
| two, same weekday | monthly | 1-in-7 is not evidence |
| three, same weekday | **weekly** | 1-in-49 is |

**Monthly is the default and needs no evidence; everything else must earn the swap.** Treating all
three as equal candidates and taking the first that had been observed for a full turn put a stream with
a single week of history straight onto *weekly* — the only cycle a week can possibly have watched a
turn of — without it ever facing the confidence test. A short history must fall back, not commit.

**A single payment still places the whole month on its day.** Nothing else is known, and spreading it
flat would make a brand-new bill invisible, which is the fault this whole section exists to remove.

### A DRIFTING EVENT IS STILL ONE EVENT

A paycheck lands on the 15th — except when the 15th is a Sunday, and except in February, where "the
30th" is the 2nd of March. Binned by day, one event becomes four small ones, and the forecast then
draws four small steps where the reader is looking for one big one. This was reported from the phone as
"the expected bump is less than half the actual value", and it is exactly that.

Measured on a fixture with **only** weekend drift:

| payday | days the histogram spreads over | biggest forecast bump | month total |
|---|---|---|---|
| fixed 15th & 30th | 3 | $3,650 (100%) | $7,300 |
| drifting | 6 | $2,433 (**67%**) | $7,300 |
| drifting, consolidated | 2 | $3,650 (100%) | $7,300 |

**The month total was right the whole time.** No money was ever lost — it was *spread*, and the step is
what a balance chart is read for. That is why the fault is invisible in every total and glaring on the
picture.

`consolidate()` collapses near-adjacent bins onto the heaviest day of their run. Two things make it
safe to do at all:

- **The guard is a measurement, not a judgement.** A run collapses only if it *spans* a few days.
  Groceries fill the whole month, so their run spans 31 and is left untouched — that spreading is a
  true fact about groceries. The question asked is never "is this stream programmed" but "is this run
  narrow enough to be one event that moved".
- **The month is a cycle.** Day 31 is adjacent to day 1. A payday sliding off the end of a short month
  lands at the start of the next one, and bins treated as a line would leave those two halves as
  distant strangers. The runs wrap.

Mass is preserved exactly, so the weights still sum to 1 and the forecast's totals do not move. Only
*where* the money sits changes.

**The histogram itself is shared with the macro graph.** Both charts needed amount-weighted bins over
a period and each had written it out. They agree on everything except what to divide by, and that
disagreement is the whole reason they looked like different functions — so
[`AmountHistogram.js`](../src/processors/AmountHistogram.js) owns the binning and both normalisations,
and makes the distinction explicit rather than papering over it:

- `asShape` divides by the **maximum** — the tallest bin is 1. Right for **drawing**, because it fills
  the height whatever the amounts are.
- `asWeights` divides by the **sum** — the bins add to 1. Right for **forecasting**, and the only thing
  that is: a shape used as weights multiplies the period's total by however many bins are non-trivial,
  which is exactly the fault that put a nine-month ending balance at $324k.

What is deliberately **not** shared is where a bin index comes from. The macro graph derives it from
the period machinery and rotates the result; this view bins by day-of-month across a fixed 31, because
its window is days centred on today rather than an analysis period. Forcing one to answer the other's
calendar question would be a worse duplication than the one removed.

**The single exception is the card settlement.** It is not a stream and no `expAmountHistory` backs it:
it is a *re-timing* of streams that were already forecast at their own dates, moved to the day the
money actually leaves the current account. That is precisely why it exists only in the account reading
and is absent from the true one — and why the §7 conservation check means anything, since the two
readings can only sum alike if the settlement moves money rather than creating it.

### A TRANSFER IS ROUTED BY THE LEG THAT LEAVES

A monthly transfer to savings is recorded as a **pair** — money out of the current account and the same
money into the savings one — and both legs carry the same stream allocation, because they are one act.
Routed by weight of money alone the two legs tie **exactly**, so the winner was whichever the ledger
happened to list first. When that was the savings side, the stream was routed to an account the
spending reading does not cover and **disappeared from the forecast entirely**.

It still appeared in the reconstructed past, because that is read straight off the account. A recurring
event visible to the left of the today line and absent to the right reads as a drawing fault, which is
what made this expensive to find:

| routing | checking leg listed first | savings leg listed first |
|---|---|---|
| by magnitude alone | checking | **savings — dropped** |
| by the stream's direction | checking | checking |

The stream's own expected amount says which leg matters: a savings transfer is money **out**, so it
belongs to the account the money left. Where no leg matches the expected direction, every leg counts,
so a stream with a surprising sign is still placed somewhere rather than nowhere.

**Which streams are on the card is MEASURED, not declared.** `accountRoutingOf()` looks at where each
stream's own transactions actually landed and routes it where the majority of its money went. A
hand-kept list would be a second author for a fact the ledger already states, and it goes stale the
first time a subscription moves to a different card. A stream with no history is treated as direct —
the safer error, since it then lands on its own day rather than a fortnight later, and the trough it
contributes to arrives early rather than not at all.

---

## §8 "Can I buy the plane tickets?" is the question, so the view must take X

Goal 1 is conditional and the picture has to be too. A field for a lump sum, spent today, that shifts
the whole forecast down by X and re-reports the trough — the minimum, its date, and the headroom left.

It is nearly free, which is the argument for it: the forecast already starts from a balance, so the
whole feature is starting it from `balance − X`. What it buys is that the reader stops doing the
arithmetic in their head against a number they have to read off a curve, which is exactly the
arithmetic the view exists to do for them.

Two things it must not do. It must not pretend the money leaves gradually — a ticket is bought on a
day. And it must not quietly move the floor: if the answer is "yes but it takes you to $180", that is
the answer, and it should be said rather than shown as a line that merely stays above zero.

---

## §9 One period at a time, CENTRED on today

The window is a period chosen from a list — a month by default — and today sits in the **middle** of
it, not at the join between a long past and a long future. A month means the fifteen days behind and
the fifteen ahead.

**One scale — a month — and the choice is WHICH month:** *this month*, centred on today and half
forecast, or *last month*, the previous calendar month, entirely settled.

The list has been wrong in both directions and every wrong answer is worth keeping.

*Too long.* A **year** was offered first. At 365 days every recurring stream repeats until the line is
a texture and the trough is a pixel, and "can I cover what is coming" is not a question anyone asks
twelve months out — the picture stops answering the thing it exists for.

*Too short.* A **week** and a **fortnight** replaced it, on the reasoning that every window should be
one turn of a period the streams actually run on. That reasoning was tidy and the result was useless:
at 7 and 15 days almost nothing recurring falls inside the window, so the line is nearly flat and the
"low point" is whatever today happens to be. A window has to be long enough to contain the events that
make the shape, and the shortest thing that does is a month.

*Beside the point.* A **quarter** survived a while and earned nothing. The decisions this tile exists
for all sit inside a month, so a wider frame only made the part that mattered smaller.

So the scale stopped moving and the axis of choice moved instead. **Last month is not a smaller version
of the same question, it is a different one.** This month asks *can I cover what is coming*; last month
asks *what actually happened* — every point in it is a record rather than a projection, which is why it
draws as one solid line with no dashes anywhere, no today marker, and a low that is a fact rather than
a forecast. Going back slides the frame to the right, because what changed is which stretch of time is
under the glass.

**Last month is THIS window, moved back exactly one month.** It was the previous *calendar* month
first, on the reasoning that the question is about a month with a name. That reasoning ignored the
gesture: the reader is looking at a window centred on today, and asking for last month is asking to see
*the same window* a month ago. A calendar month is a different width **and** a different offset, so the
picture jumped to a stretch of time with no fixed relationship to the one being left — it landed, as
reported from the phone, somewhere in the middle.

Moved by exactly a month the two windows are the same width, so the motion is a **pure translation**:
every mark travels the same distance in the same direction, which is what makes a pan read as "the same
thing, earlier" rather than as a new picture. The day-of-month is clamped when it has to be — the 31st
of a thirty-day month is that month's last day, not the 1st of the month after, because a shift that
silently lands in the wrong month is worse than one that rounds.

The reconstruction still runs back from today whatever is on screen, so a past window is a slice of that
one anchored walk rather than a separate calculation from a guessed opening figure.

**Both months are built at once, and the toggle only chooses between them.** Every switch used to
rebuild a month from scratch — walk the whole ledger backwards, then run fifty-odd terminals across
thirty days — and that work landed on the *first frame of the animation*, which is precisely where a
stall is most visible: the picture holds still for a moment and then catches up, so a motion designed
to make the change legible instead makes it look broken.

The cost of holding both is one extra walk of a ledger that is already in memory, and last month
forecasts nothing at all, so it is cheaper than the month beside it. The cache is keyed on the three
things a series actually depends on — the reading, the transactions, the accounts — so it is dropped
exactly when it is wrong and never merely because the component re-rendered.

It also removes a double computation that had been there from the start: the caption and the picture
each asked for the series independently on every render, including on every day the cursor passed
over.

### §2c PREDICTABLE vs ERRATIC — because they need different fixes

Three things are true at once, and together they set what "done" means for this view:

1. its usefulness hinges on its accuracy;
2. its accuracy cannot be perfect;
3. therefore **what is predictable has to be very accurate**, and what is not has to be visibly
   separated rather than quietly averaged in with it.

Success is when the graph can be **trusted** — which is not the same as being right about everything.
A regular payment drawn on the wrong day is a modelling bug and should be fixed; a genuinely erratic
one is not a bug at all and never will be. Averaging them together hides both, and leaves no way to
tell an improvable error from an irreducible one.

**A balance chart is read for its STEPS**, so a stream is predictable exactly when you can say two
things about it — *when* the money moves, and *how much* moves. Both are measured:

| | what it measures | how |
|---|---|---|
| `timing` | how concentrated the money is inside one turn of the stream's own cycle | the cycle detector's own statistic, corrected for the concentration that more bins and fewer observations hand out free |
| `steadiness` | how alike the turns are in size | one minus the coefficient of variation of the per-turn totals |

**The silent turns count.** A stream that fires in three months out of twelve looks perfectly steady if
you only measure the three it fired in — so every turn between the first and last observation is
included, and the quiet ones are zeros. Without that, *sporadic* reads as *regular*, which is the one
mistake this classification exists to prevent.

**"Not enough data" is its own answer** and must never be dressed as either of the other two. Fewer
than three observed turns cannot tell a rhythm from a coincidence.

The rows are sorted by the money each stream carries, because a stream that is erratic and tiny is not
a problem, and one that is erratic and large is the only thing worth looking at.

**`regular only` forecasts the predictable streams alone.** Read against the benchmark it answers the
question directly: if the benchmark tracks the record closely once the erratic streams are removed,
then what is left to fix is *noise*, and the model is sound. If it still diverges, the fault is in the
model and the erratic streams were never the problem. The reconstruction is untouched by the choice —
what happened, happened.

### §2b THE BENCHMARK: the same forecast, run over what already happened

Over the settled part of the window, a **dotted line** shows what the forecast would have predicted
had it been run on the day the window opened. Where it parts company with the reconstruction is a
discrepancy worth chasing — a stream mis-timed, an amount out of date, or money moving that the master
stream does not know about. It is the drift test of §2a made continuous and visible, rather than a
number someone has to go and compute.

**It must be run OUT OF SAMPLE or it is not a benchmark.** The histograms and the account routing are
built only from transactions dated *before* the window opens, so the forecast makes the prediction it
would have made on the day, knowing what it knew on the day. Fitted to the period it is predicting, it
would reproduce that period rather than test it, and the agreement it showed would be its own
reflection. This is the whole reason `shapesAsOf(cutoff)` exists rather than reusing the cached shapes.

Two things are deliberately *not* held back:

- **The expected amounts.** These come from the master's own step function evaluated at each date,
  which is the plan as it stood then — not the outcome. Withholding it would be testing something
  nobody is claiming.
- **The opening balance.** The benchmark starts on the reconstruction's first point, which is a known
  figure rather than a guess. Starting it anywhere else would measure the anchor instead of the model.

**Drawn dotted, not dashed**, so it cannot be read as the forecast, and under the record so that where
the two touch the truth is on top. It takes the same runway colour, because it is a balance and that
colour means what it always means. It is included in the frame's *vertical* range but not its
horizontal one — a divergence that runs off the top is not a divergence anyone can see, and it covers
no days the record does not.

### §10d-b A PERMANENT DATE AXIS, on the 1st and the 15th

A step chart with no axis is a shape with no scale: the reader can see that something happened and not
when, and the cursor's own date only helps once they are already pointing at something.

The marks are the **1st and the 15th** because those are the days the money itself uses — rent, and the
mid-month paycheck — so they are anchors rather than an arbitrary grid. Each carries its **month**
(`Aug 1`, `Aug 15`), because a thirty-day window straddles two of them and a bare "15" would be
ambiguous exactly where the window is most useful.

A tick label gives way to the cursor's own date when the two would collide, so the one the reader asked
for is the one that survives.

### ONE PAINTER, and an animation is that painter with a moving frame

The animations had a painter of their own that drew a *subset* — the area and the two lines, and none
of the beads, guides, labels or cursor. Everything it left out therefore **appeared** at the instant
the motion stopped. Reported from the phone as "the graph appears abruptly after the travel", and that
is exactly right: the travel was real, and then the picture arrived.

`draw()` now takes an optional **frame** — the x and y domains plus the high and low the guides are
drawn at — and an animation is that same routine called with an interpolated one. The last frame of a
motion is therefore identical to the resting frame that replaces it *by construction*, so there is
nothing left to pop and no second painter to keep in step.

**And the content is the UNION of both windows, not the wider of the two.** That distinction did not
matter while the windows were concentric: a month inside a quarter is a *zoom*, and the wider one
covers the whole journey. Two months that merely **overlap** are a **pan**, and neither covers it —
travelling from this month to last, this month's data stops fifteen days ago, so the left of the frame
swept across empty space for the whole animation and the curve only existed once the real picture
replaced it at the end.

The union is every day either window holds, once, in date order. Where the two disagree about a day
they both contain, a **record wins over a projection** — the same day is settled history in last
month's series and, near the boundary, could be a forecast in this month's.

Centring is the whole of the rule, and it follows from what the view is for. Goal 1 is a decision
being taken *now*: the relevant past is the few days that explain where the balance currently is, and
the relevant future is the few days the decision has to survive. A year of history compresses that
into a smudge at the right-hand edge, and the eye starts in the middle of a picture — so the middle is
where today belongs.

It also puts the two halves in honest proportion. §4 says the record and the arithmetic are different
kinds of line; drawing twelve months of one against nine of the other quietly says the forecast is the
smaller claim. Equal halves say they are equally about now.

**The window is a lens, not a filter on the data.** The histogram (§5) still measures across every
period available, and the reconstruction is still anchored at today (§2) whatever is on screen —
otherwise a shorter window would change the shape it forecasts with, and zooming would alter the
answer rather than the view of it.

At a month, the trough is a question about the next fortnight, which is the operational reading goal 1
wants. The period picker is therefore not a zoom control — it changes what is being asked, which is the
argument for keeping the list short and for every entry on it being a period the model already knows.

---

## §10 The tile, on a phone

It is page three of the carousel, so it inherits page two's discipline rather than inventing its own.

**The heading IS the title, and it is a sentence (9.1).** "Balance **in the bank**, **this month**",
with the two words that could be something else made tappable — they cycle. That is the entire control
surface. What it replaced was six form fields: period, reading, spend, leak, a stream picker and a
theme button, which between them explained an interface instead of being one.

**The words are named for the reader, not the model (#16).** "in the bank" and "after cards", not
"the account" and "true position". The second pair names the arithmetic; the first names what the
reader wanted to know.

**Delete what the reader can already see (#13).** A first version wrote the answer out — "lowest
$10,705 on Sep 13" — while the curve carried that same figure on that same dot. One thing said twice,
and it wrapped to three lines on a phone to do it. The picture keeps the answer; the sentence says only
what is being looked at. The trough is marked on the curve with its own amount, which is 7.33's move
for the node in focus.

**And the question is asked by touch.** §8 is "can I buy the plane tickets", which is a thing you do to
the picture rather than a number typed into a field beside it. Press and drag DOWN and the forecast
falls under the thumb, the trough re-marking itself as it goes; press and move ACROSS and it reads a
day instead. Vertical against horizontal is how a deck already tells a drag from a swipe, so the two
gestures need no modes and no labels.

There is deliberately **no "tap to put it back" hint**. A drag is undone by the gesture that made it,
and an interface that has to say so has already failed to be obvious.

**Restraint with the alert tone.** Zero gets a line only when it is within the frame, and the trough
turns red only when it is actually below. Drawn always, both are a permanent alarm that stops meaning
anything — the same reason the flow chart spends that tone on money from outside rather than on every
expense.

**The type is in CSS PIXELS, because that is the only unit the reader has.** This was got wrong twice
in a row, both times the same way money-flow's 9.8a was got wrong: sizes were authored in the drawing's
own units, which are not a size until multiplied by the scale the drawing renders at. A 450-unit
viewBox on a 334px phone put the tick labels on screen at **5.2px** and the amounts at **6.7px**.

The first correction converted between the two spaces and was still wrong — the divisor came from the
container, 366px, while the svg inside it rendered at 334. **Two spaces means two chances to pick the
wrong one.** So there is one: the viewBox is set to the element's own pixel size and every number in
the drawing is CSS pixels, at page two's phone sizes — small 10, body 12 — so one carousel has one type
scale (#18).

That leaves the measurement itself, which was also wrong: taken during the first render, before the
page had settled, and never taken again. **A measurement taken before the thing is on screen is a guess
about the thing.** It draws, measures what was actually drawn, and draws once more if the two disagree
— converging in one step, and incidentally making a rotation correct rather than stale.

### §10a Colour has three jobs, read off BOTH existing charts

Not "colour is a classification and nothing else", which is what a first reading of page two alone
suggested. Page one uses it quite differently, and between them the rules are these.

**1. IT MAKES THE FOCAL POINT — and it does it by SUBTRACTION.** Neither chart gives the subject a
colour nobody else has. Page two dims everything outside the focus to 0.20; page one lifts the hovered
bar from 0.5 to 1. The subject keeps its own colour and simply becomes the only thing at full strength.
Emphasis is a matter of what is taken away from the rest.

**2. IT CARRIES SEMANTICS, in TWO vocabularies that never mix.**
*Identity* — green income, blue savings, red spending — assigned from the stream's definition and
worn by the data marks. *Verdict* — `positive` / `warning` / `alert` — chosen by `getMainColor()` and
worn only by the figure a reader looks at first, the ring and the headline number. The separation is
what keeps red unambiguous: on a band it means spending, on a verdict it means bad, and the two never
meet on the same mark.

Worth knowing: `alert` and `expenses` are the SAME hex. There is no dedicated alarm colour. What makes
`From reserves` exceptional is its placement — red on the income side, where income should be — not
its hue. The colour is quiet; the position shouts.

**3. IT TEACHES THE GRAMMAR OF THE PICTURE.** Page one draws the same hue at three opacities, and they
mean three different degrees of certainty: **0.15** for what is only planned (the target area), **0.5**
for what is projected (trends, the bar at rest), **1** for what actually happened. A reader learns that
scale once and can then read any part of either chart. Page two's ribbon is the same idea in a
gradient: each end takes the colour of the stream AT it, so the eye can see that a ribbon joins two
things and which way it runs — 6.11 exists because reading it off "source and destination" put a hard
step in colour exactly at the hub, and a step says "different thing" where nothing was different.

**And a fourth, which is a duty rather than a job: red owes the reader a name.** `Unallocated` is
deliberately unlabelled; `From reserves` keeps its name precisely BECAUSE it is red — "an unexplained
red band would be worse than none."

### §10b What that gives this tile

**The three planes are page one's, unchanged.** The past is the record and sits at 1; the forecast is a
projection and sits at **0.5**, which is exactly where page one puts a projection. The dash says what
kind of line it is and the opacity says how certain it is — two channels, two facts, and neither one
doing the other's job.

**The trough is the focal point, and it is made by subtraction.** It is the one thing on the projected
plane drawn at full strength, so the eye lands where the question is without anything having to shout.

**And it takes the VERDICT colour, because it is the figure read first.** `positive` when there is more
than a month of outflow beneath it, `warning` when there is less, `alert` when it goes under. On this
portfolio a month costs $12,659, so the threshold is a fact about the master rather than a taste.

**The curve itself stays ink, because a level is not a flow.** Identity hues classify money as income,
savings or spending; a balance is none of those, and giving it one would invent a classification that
is not true. When the savings series arrives (§1) it takes blue, because that IS a classification.

**Zero is drawn only when it is crossed.** The first version tested `y0 < 0`, and y0 is the padded
minimum, so the alarm was permanent — the one thing that stops an alarm meaning anything. Forcing zero
into the range also squashed the curve into the top third of the tile, which is 5.3 broken for the sake
of a line that said nothing.

### §10c The runway ramp is anchored to MONEY, and it has THREE bands

A vertical gradient in USER SPACE, so the anchors are values rather than screen positions.

Anchored to the frame instead, which is how it was built first, every window ran green at the top and
red at the bottom whatever the numbers were: a comfortable month and a desperate one looked identical,
because the colour was only ever saying "this is the top of the picture". Pinned to money, the same
balance is the same colour in every window, and the ramp simply moves up the tile as things improve.

**Red below $1,000 · green through the working range · blue above $4,000.**

*Why a third band.* "More than enough" is a **different fact** from "enough", not a stronger version of
it. A balance above the ceiling is money sitting in checking that belongs in savings — and blue is
already the savings identity everywhere else in the app, so it says exactly that. Two bands could only
have said it as "very green", which reads as *better* rather than as *misplaced*.

*Why the floor is $1,000 and not zero.* It was $100 first, and that was correct and unreadable. The
frame scales to the whole window, so the strip between 0 and 100 was a couple of pixels — measured at
**8.6px** in a week-long window on a 148px-tall frame — and the warning only arrived once the balance
was already negative, which is too late to be a warning. At $1,000 the same strip measures **31.2px**,
and it means "there is not enough room here for anything unexpected", which is the question the tile
exists to answer.

*The blend.* How many dollars a crossing takes is a real design question, not a constant. At **0** the
bands are hard edges and the balance has three named states — $999 and $1,001 are visibly different
things. Wide, it is a continuous temperature and the anchors are only where the midpoints sit. The
first is legible at a glance and lies about the precision of a forecast; the second is honest about it.
**Shipped at $3,000**, the full span between the anchors, which is the softest three bands can hold:
the balance reads as a temperature, and nothing anywhere switches.

`spreadMethod` defaults to `pad`, which gives the flat blue above and flat red below for free — the
ramp exists only between the outer anchors.

**The line takes the same ramp, at full opacity.** A stroke carries a gradient exactly as a fill does,
so the line reddens as it descends without anything having to decide where a boundary is. The area is
that colour at 0.15 and the line is the affirmed version of it; two weights of one statement.

**One builder, three call sites.** The gradient is constructed in `rampDefs()` and used by the resting
draw and both animation frames. It was written out three times first, and the anchors then had three
authors — the kind of duplication that stays correct exactly until one of them is edited.

### §10d The curve is a STAIRCASE, because the money is transactions

A straight segment between two days says the balance slid gradually from one to the other, and it never
did — it sat still and then moved. Hold the value to the next date, then step. Verified: 15 horizontal
holds across a month, and the same treatment on both halves, because a forecast of transactions is
still a forecast of steps.

### §10e The high and the low of the viewed period, as two quiet rules

Dotted, dim, labelled, and lower emphasis than the line they measure. They give the curve a scale
without an axis: every other value is read as sitting between them.

They are NOT the same thing as the trough. These are the bounds of what is on screen, past included;
the trough is the lowest point of the FUTURE, which is what goal 1 actually asks about. Both are drawn
— the rules for scale, the trough dot for the decision — and where they coincide the dot sits on the
rule, which is the truth about that window rather than a collision.

### §10e-a A badge is an AMOUNT, and the name belongs to the badge

**Which days get a badge: movements over $1,000.** The floor was a fraction of the window's range,
which sounds adaptive and is not: a quiet month promotes its own noise to a badge, and a busy one
hides a four-figure payment because something larger happened nearby. A badge means "this is worth
noticing", and that is an absolute claim about an amount, so it is an absolute number. It also means
the marks do not move when the window changes — the same day carries the same badge in a month and in
a quarter, which is what lets the two windows be read as the same picture at two scales.

**The stream name appears beside the badge, and only while the cursor is on it.** It had been in the
subtitle, which is the wrong place twice over: the name changes on every day the cursor passes, and on
most days it names nothing, so the line flickers with a caption that is usually empty. A badge asks a
question — *what is that one* — and the answer belongs next to the thing that asked it. So the label
is drawn at the badge, it flips to the other side rather than run off the frame, and it is haloed in
the tile colour (`paint-order: stroke`) so it stays legible over the line and the area beneath.

Nothing else in the picture carries a name. That is deliberate: a chart where every mark is labelled
has no marks, only labels.

### §10e-b The cursor reads the STEP, not a filtered event list

The readout was looking the cursor's day up in the event list that places the beads — which is
thresholded to significant movements and capped at fourteen marks. Most days are not in it, so on most
days the cursor could say nothing about what moved, which is the one thing worth knowing about a day
you are pointing at.

It now reads the **drawn series** directly. The curve is a step function, so the step at a day *is*
that day's movement, and the contributors are exactly that day's transactions — or, in the forecast,
the expectations the forecast already attributed. A transaction split across streams reports its
largest allocation, which is the honest answer to "what was this"; an uncategorised one has no stream
and says so rather than borrowing a neighbour's name.

### §10f One gesture, and it is page one's

A cursor that follows the finger and writes what is under it into the heading — the day, what it is
worth, and, when that day is one of the marked events, the stream behind the movement.

This replaced a vertical drag that spent money. On a phone that gesture changed the picture under the
finger, which reads as an accidental zoom rather than as an answer, and it made the ordinary act of
pointing at a day impossible without first not moving vertically. Page one answers a hovering finger by
rewriting its own labels rather than by zooming or opening anything, so this does the same, and a
reader who has used page one already knows how.

**§8 therefore has no home at the moment.** "What if I spend X today" is still the question goal 1 is
asking, and the gesture that answered it has been taken away for good reasons. Noted rather than faked
— it needs an affordance that does not fight the cursor.

### §10g No amber, and the cursor snaps to a choice

**The third band is blue, not amber** — see §10c. An amber waypoint was tried and made the ramp read as
a traffic light, which puts the extra state in the wrong place: between "fine" and "not fine", where
the balance has no third condition to report. Green to red passes through a muted olive on its own,
which says "less" without announcing a category that is not there. The band the balance *does* have
another state for is at the top, and blue is where it went.

**What the cursor snaps to is a real choice, so it is a control rather than a default nobody sees.**

*Every day* is the even-handed reading: every date is reachable and a quiet stretch is as inspectable as
a busy one. *Expected transactions only* is the useful one when the question is "what moved" — it steps
between the days money actually changes hands and skips the flat ground between them, so a thumb cannot
land somewhere that has nothing to say.

Measured on a sweep across the tile: eleven presses gave **11 distinct days** on the first and **6** on
the second, out of 8 events in the window. That difference IS the feature — the second refuses to stop
where nothing happens.

Neither is better; they answer different questions, which is why both exist and why the choice is not
mine to make quietly.

### §10h A dot is a RADIUS, and that is the ratio to keep

Page one sets `scatterDotSize` **4** on a phone against a line of `strokeWidth` **3** — and Victory
reads that size as a RADIUS. So its dots are **8 across on a 3-wide line**: a diameter about **2.7
times** the stroke. On desktop it is 2 against 1, so **4 times**. That ratio is the thing to carry
over, not the number.

Read as a diameter — which is what a bare `4` looks like — the dots came out 4 across on the same
line, a ratio of 1.3. That is a bump in the line rather than a mark on it, and against a DASHED line it
disappears entirely, because a dash segment is already about that size.

Taken as the radius it is: beads at radius 4, ratio **2.67** against the solid line and **4.0** against
the dashed projection, so they read on both halves. The trough and the cursor take 1.25× that, since
they have to win against the beads as well as the line, and every dot is ringed in the tile colour so
it stays a mark ON the line rather than a thickening OF it.

The general form, worth remembering next time a number is borrowed from another chart: **a size is not
a size until you know what it measures.** Radius or diameter, world units or css pixels — the same
class of mistake as 9.8a, one dimension down.

### §10i Drag state cannot live on the thing being redrawn

The cursor appeared to snap only to the end of the graph and a few points along it, and that was never
a snapping fault. Every render replaces the tile's inner HTML, so the svg the finger went down on is
destroyed by the first move it causes — taking its pointer capture and its `down` flag with it. The
next move lands on a brand new element whose flag is `false`, so it is ignored. The cursor could only
update on a fresh tap, which is exactly what a few scattered stops look like.

The listeners are attached **once**, to the container, which is never replaced. The drag state lives
beside them, and the date range the pointer is mapped through is PUBLISHED by the draw rather than
captured in a closure that goes stale a frame later.

The probe missed it because it dispatched a series of taps rather than one press and many moves — the
instrument was not making the gesture the bug lived in. Measured properly: one press and 34 moves gives
**26 distinct days** on "every day" and **7 events** on "expected transactions only".

### §10j The transformation is animated, because a cut between two windows is not readable

Changing the period or the reading changes the frame, the shape and the dates at once. Dropped in one
step the reader has to work out what moved; page two has the same problem and the same answer — one
clock, and the state interpolates while the picture is re-derived from it every frame.

A cheaper version of that here. Both curves are RESAMPLED to a fixed number of points along their own
window, which makes two series of different lengths and different date ranges directly interpolable;
the frame and the today-split are lerped alongside. 340ms, on the same ease page two uses. Measured: 22
frames, progress running 0 to 1, settling into the full picture.

What is drawn during the move is the area and the two lines ONLY. The beads, the rules, the cursor and
the labels are details of a settled picture, and carrying them through the move would assert they are
facts about a state that never existed. They arrive when it lands.

### §10k A change of PERIOD is a zoom; a change of AMOUNTS is a morph

Two different things can change, so they are shown as two different motions.

**Period zooms the x axis.** Resampling both windows to a common 0..1 span — which is right for a
change of amounts — makes a month and a quarter the same width and then morphs one curve into the
other, so the reader watches the picture DEFORM when nothing about the money moved at all. What
actually happened is that the frame got wider.

So the DOMAIN interpolates and the curve is drawn from its real dates through it. The wider of the two
windows supplies the content, because it is the only one that covers the whole journey: zooming out it
is the destination, zooming in it is the origin, and either way there is curve wherever the animating
frame is looking. The svg clips to its own viewBox, so what is outside the frame at any moment simply
is not drawn — no clip path needed.

**Today stays put**, which is what makes it read as a zoom about a fixed point rather than a pan.
Measured on this month → this quarter: today's x moves 167 → 165.3 across 23 frames while the span
triples, and one content series of 189 segments is drawn throughout.

It is not perfectly still at every setting, and that is honest rather than a fault: the window is
centred with an integer split, so a week is 3 days back and 4 forward and puts today at 3/7 of the
width where a year puts it at almost exactly a half. The drift IS the difference between those two
windows.

**Reading morphs the amounts.** Switching "in the bank" to "after cards" changes what is being counted
over the same dates, so the frame holds still and the values travel — which is the resampled morph
of 10j, now used only where it is the true description.

### §10l The title holds still; the SUBTITLE carries what changes — and says ONE thing

It shipped at body size carrying three facts — the balance, the date and the stream — which made it a
second heading competing with the title rather than a caption under it, and a sentence long enough to
be read rather than glanced at. It is now `little` in the secondary colour, and says exactly one thing:

- **at rest**, the low point, which is the entire question the tile exists to answer;
- **under the cursor**, the exact balance on that day — and nothing else.

The cursor line reported *what moved* for a while, which put two different kinds of fact through one
line: a **position** and a **change**. They are not interchangeable and the reader cannot tell which
they are looking at without reading the words. The balance is the position, it is what the cursor is
pointing at, and it is the number you cannot get any other way — the line shows roughly where it is,
never exactly. What moved is a different question, it belongs to a specific mark rather than to every
day, and §10e-a puts it there.

Its height stays reserved, so going from one to the other moves nothing below it.

**And the heading is left-aligned, which it was not.** `DS.component.ContentTile` is a `FlexColumn`,
and `FlexColumn` sets `align-items:center` — so any child that does not stretch is centred. Page two's
header opts out with `width:100%; align-self:stretch; text-align:left`; this one had not, and inherited
the centring silently. Worth recording as a shape of bug rather than a typo: nothing here *asked* to be
centred, and the tile looked deliberate enough that it took a photograph from a phone to notice.

**The cursor names its day, under the axis.** The cursor line says *here* and the caption says *how
much*; neither says *when*, and on a step chart with no x-axis labels that leaves the reader counting
squares out from the today line. The date sits in the bottom padding below the plot, so it never
overlaps the picture, and it is clamped inside the frame so the first and last days do not print half
off the edge.

Page one's arrangement: the year at title size, the date range under it at body size, both at FIXED
offsets inside the plot — so a hovering finger rewrites the words and nothing moves.

The readout was in the title here, and the title is HTML. A longer sentence rewrapped the heading, the
chart shifted down, and pointing at a day made the picture flinch under the finger — the interaction
disturbing the thing it was meant to inspect.

Now the title says only what is being looked at, plus the two words that change it, and never varies.
The subtitle says what is under the cursor; at rest it is the window's date range, which is what page
one's subtitle shows at rest too, and it turns to "short on ..." in the alert colour when there is
something to say.

**Its box is pinned, not merely reserved.** `min-height` in `em` left a one-pixel shift when the text
changed weight — measured, the chart top moved 82.5 to 83.5 on the first move and then held. A fixed
`height` and `line-height` in rem, one line, clipped, holds it at 83.3 through the whole drag. One
pixel is not much, and it is the difference between a picture that is being read and a picture that
twitches.

### §10m Two motions, two clocks — and they are page two's own

A change of extent is a CAMERA move and takes **620ms** (`moveMs`). A change of amounts is a VALUE
tween and takes **380ms** (`dataMs`). The zoom had been running at 340 — faster than page two moves its
camera for a much smaller change — and read as a jump rather than a journey.

Borrowing both numbers rather than choosing new ones means the carousel moves at one speed whichever
page you are on, and it means the two motions here are distinguishable by their pace as well as by
what they do: extent takes longer than amount, everywhere.

### §10n Naming what moves the line — four treatments, and what each is FOR

The two options are not alternatives; they answer different questions.

**Hover EXPLAINS** a step the reader is already looking at. They pointed, so they asked, and the answer
can be as long as it needs to be. It cannot crowd, and it says nothing until asked.

**Standing labels make the picture legible AT A GLANCE.** That matters more here, because a hover
cannot help someone who does not yet know there is anything to hover over — and goal 1 is deciding
about a purchase, where seeing what is coming BEFORE touching anything is the whole point.

Both were built, plus icon badges and a control, and the choice is open. Where I would land is standing
names on the two or three that carry the story, hover for the rest: names are precise, and #12 says
structure should carry meaning before a label does — an icon is a label that is harder to read.

Standing names follow page two's rule and MEASURE the fit: capped at three, skipped where they would
collide, and **one name per stream**, since two paydays in a window are two events but one fact and
spending the room twice leaves nothing for what is beside it.

**A fault that had to be fixed before any of it worked: forecast movements had no stream at all.** The
event list looked each day up in the transaction record, and the future has no transactions — so every
badge in the forecast fell back to a generic glyph and hover named nothing. The forecast now carries
its dominant contributor out with each day's value. Without that, none of these treatments works on the
half of the chart that the view exists for.

### §10o A pattern that silently matches nothing is worse than one that over-matches

Two lessons from the icon mapping, both general.

**A backslash escape can arrive as the character it names.** Three rules were written with a word
boundary and reached the file as a literal BACKSPACE, so `/rent<bs>/` matched nothing and Rent fell to
the fallback. It printed back as `/rent/`, because JSON escapes backspace exactly the same way — the
diagnostic and the fault were indistinguishable. There are no word boundaries in that table now;
ORDER does the work and every pattern is a plain substring.

**Each rule can be defensible while the LIST is wrong.** "care" contains "car", so childcare became a
garage; "Cadeaux Mr & Mdm & Emile" is a gift, not a child. Neither is visible in any single rule — the
only way to see it is to print what every stream in the portfolio actually maps to, which is how both
were found. A mapping is a whole, and it has to be reviewed as one: 56 streams, zero fallbacks, and
every glyph confirmed to resolve at its stated size rather than render as its own name.

### §10q "I cannot reconcile a plausible story" is a testable complaint

The reader named the five things he expected to see — rent, day care, food, savings around the 13th,
wages in — and could not find them. Dumping every daily movement over $150 in the visible month
answered it in one pass, and the answer was three separate faults, none of them in the model:

**The fixture stopped a month early.** Transactions were generated by stepping month by month from the
window's start and halting at `m < to`, which walks the 4th of each month and stops one whole month
short — twelve months of history with a four-day hole at the end, exactly where the reader is looking.
So the visible past held no September at all: no rent on the 1st, no day care, no food. Generated from
the first of every month the range touches, and filtered afterwards, the month reads:

```
Aug 31   +$7,837   Wages
Sep 1    -$2,341   Rent
Sep 4    -$1,317   Day care
Sep 12   -$1,104   Savings
Sep 13   -$2,446   Savings
Sep 14   +$1,508   Wages
Sep 15   +$3,085   Wages
Sep 19     -$490   Gembah
```

**Savings was on the wrong day.** The fixture put it on the 2nd; he does it around the 13th. An invented
day produces a month that cannot be read back as the life it is modelling, which is the whole test.

**Food will never appear as a step, and should not.** At about $914 a month spread across thirty days it
is $30 a day — below any sensible threshold for a mark. That is 5 working: food is diffuse, so it is a
RAMP, and the ramp is already in the line. Its absence from the event list is the model being right.

**And the one real discrepancy is not a missing stream.** The tile nets **+$3,766** a month where the
reader expects roughly break-even. The whole of that gap is 3a's stale expectation: the master expects
wages of $15,674 a month against $11,670 actually received. At the actual figure the month nets
**−$238**, which is the story he was looking for.

The lesson for the view, not the fixture: **a reader who knows their own life is the sharpest instrument
available, and "this does not look like my month" is a bug report.** It found a generator fault, a wrong
assumption and a stale expectation in a single question — and the thing that made it answerable in one
pass was being able to print what every day actually did, which is the same breakdown 3a argued should
be on screen rather than in a probe.

**One shape (9.3).** A time series like page one, so it takes page one's geometry — 450 x 200 at phone
height — rather than a third aspect ratio in one carousel. The grip sits at the foot, as on every page.

---

## Open decisions

These change what gets built and are not mine to settle.

0. **Which reading is the default**, and whether the other is a toggle, a second series, or a second
   page (§1). Both are wanted; only one can be the thing you land on.
1. **Posted or available balance** as the anchor. Available includes pending and is closer to "what can
   I spend"; posted is what reconciles with the transaction record. They disagree by exactly the
   pending set, and §2's invariant only holds cleanly for one of them.
2. **Which accounts are spendable.** All non-savings, or a chosen subset? A credit card is neither
   spendable nor savings, and its balance is a debt — including it as a negative may be right, or may
   be a different view entirely.
3. ~~**When in a period does a stream's money move?**~~ Answered by §5 — the histogram already knows,
   per stream, from what happened. What remains is the fallback: **a stream with no history has no
   shape.** A new stream, or one whose first period has not closed, has nothing to spread by. Flat
   across the period, all on the first day, or borrowed from its parent are the candidates, and they
   differ most for exactly the streams a forecast is least sure of anyway.
4. **The horizon.** To the end of the observation period, keeping one calendar with the rest of the app
   — or a rolling twelve months, which is what the question "when do I run out" actually wants when the
   answer is more than a year away.
5. **One line or per-account.** A total answers the question; per-account answers "which pot", which is
   a different question and may not belong on the same picture.

---

## Design explorations, parked

- **Predicted and actual on the same picture, over the same window.** *Promoted by §3a: this is how a
  stale expectation is caught without having to ask why the line looks wrong.* Not the past-then-future seam of
  §4 — both series across the SAME dates, so the gap between what was expected and what happened is a
  visible distance rather than something to work out. It is the natural next question once §2a's
  residual exists, and it is a different picture rather than an option on this one. Parked
  deliberately: worth designing properly rather than bolting on.

---

## What shipped, and what is still open

1. ~~**Persist balances** (§0)~~ — **done.** Connector contract, both connectors, `BalanceSnapshot`
   store, capture inside the existing refresh, read route and client call.
2. ~~**Balance to date** (§1, §2, §5)~~ — **done.** Reconstructed backwards from the live anchor.
3. ~~**The forecast** (§3, §4)~~ — **done.** Terminals, measured shapes, measured card routing.
4. ~~**The tile** (§10)~~ — **done.** Page three of the carousel.

Still open, in the order they are worth doing:

- **§8 "what if I spend X today"** has no gesture. The drag that would have carried it became the
  cursor (§10f), so the input needs somewhere else to live. This is the largest gap against goal 1.
- **The stored series is not read yet.** `getBalanceHistory` exists end to end and the view still
  anchors on the live figure alone, because on day one there is no history to read. Once a few weeks
  have accumulated, §2a's drift test becomes possible — and that comparison is the best evidence the
  categorisation is complete.
- **Posted versus available** is unresolved: both are now stored, and the view uses `current`.
- **The parked streams** (`Option Exercise` at 0.01 against $10,582 of real movement, `Investments` at
  −0.1 against a history of −7,550) make the forecast's composition wrong even where its total is
  right to within 1%. That is a data problem this view has now made visible, which is §2a working.
- **The settlement day is measured from one signal** — the largest recurring payment into a card. With
  two cards settling on different days it will pick one. Splitting it per card is the fix.
