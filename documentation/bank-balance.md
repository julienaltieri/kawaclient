# Bank balance, to date and ahead

> **MOSTLY BUILT.** §0-§10 describe shipped behaviour. The two Roadmap sections at the bottom are the
> exception and say so in their own headers.
>
> Where a section is superseded it carries a pointer at the top rather than being deleted, because the
> argument that was wrong is usually the fastest way to understand why the replacement is shaped as it
> is. §2 is the worked case: its reasoning against the forwards walk turned out to apply to itself.
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

- **Live** — `Core.getAccountsWithBalances()`, straight off the aggregator. The one to trust for
  *now*, and — see §2f — precisely the wrong thing to anchor the past to.
- **Remembered** — `ApiCaller.getBalanceHistory()`, the stored series. It only accumulates going
  forward, so a caller must read an empty answer as "no history yet", never as "no money".

The view shipped on the live anchor alone, which is what made it correct on day one. **It no longer
does, and the reason is §2f.** The remembered series turned out not to be a nice-to-have for the drift
test: it is the only thing in the system that knows what the bank actually said on a day that has
passed, and the live anchor cannot stand in for it.

The division of labour now:

| question | source |
|---|---|
| what is the balance *now* | **live** — the only thing that knows about a cheque that posted an hour ago |
| what was the balance on a day that has passed | **remembered** — the only thing that observed it |

Both are still needed. Neither substitutes for the other.

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

So the reading is the **spending account** — the accounts `Core.accountTypeOf` calls checking, which
is Plaid's type first and the user's own override last (see `account-types.md`, which owns this rule).
`subtype` is no longer consulted anywhere in the balance path — and there are exactly **two** readings:

| entry | what it is | when it appears |
|---|---|---|
| *spending* | the spending account alone | always; the default |
| *spending net of cards* | the same, less what the cards owe | only where there is a credit account |

**Two, not a list of every account.** Enumerating the connected accounts was the first attempt and it
turned one control into a file browser for a question that has two answers. A savings balance is
neither of them: folded into the spending account it hides the trough, and on its own it is not a
runway — nothing is forecast against it and no decision is taken from it. It is simply not what this
picture is about. **There is no longer a fallback to every depository account.** It was removed deliberately: it
overruled the user, handing somebody who had marked their only current account as savings the runway
anyway. An empty chart is the better failure, because it does not contradict what the reader just
said.

Because the account and the reading are the same question — *which money am I looking at* — they are
**one control**, and the title stays two tappable words on a phone.

**Per-account forecasting follows from this.** Once the balance on screen can be one account, the
forecast has to know which account each stream lands on, or the rent gets forecast against savings.
`accountRoutingOf` therefore returns the **account a stream's money actually LEFT** — the leg matching
the stream's declared direction, and with nothing declared, the outgoing one rather than a
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

> **Superseded in part by [§2f](#2f-an-observed-balance-is-not-a-reconstructed-one-and-it-wins).**
> Everything below is still how the walk works and still how most of a long window is drawn — but the
> walk is now the FALLBACK. Where the bank has told us what a day closed at, that observation is the
> day's value and the walk only fills the gaps between observations. Read §2f before changing anything
> here: the argument in this section turned out to apply to itself.

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

**And that is the whole of the improvement.** "Bounded by the transaction record" sounds like a small
error and is not: it is bounded by the record's COMPLETENESS, and an incomplete record does not produce
a small error but a constant one, carried into every value — the same shape of failure this section
rejects the forwards walk for. The anchor is a fact about *now*; the ledger is a fact about *the last
refresh*. Where those two moments differ, so does every point. §2f is what fixes it.

**It must use EVERY transaction on that account, not the categorized ones.** This is the trap, and a
real one, because the money-flow adapter does the opposite — it deliberately reads only what is
categorized, and §1.4 there drops anything under a unit. Money leaves an account whether or not anyone
has told the app what it was for.

### §2f AN OBSERVED BALANCE IS NOT A RECONSTRUCTED ONE, AND IT WINS

§2 rejects the forwards walk in these words: *the opening figure is a guess, and the guess is carried in
every value from then to now, so the line is offset by an unknown constant while looking perfectly
plausible. Every value is wrong and nothing about the picture says so.*

**That is also what happened to the backwards walk**, for a different reason, and it took a user
noticing that the chart showed a negative balance on a day he had thousands in the account.

#### What happened

A $1,699.50 cheque cleared at the bank. The next read of the account came back reduced by it. The
transaction itself had not yet reached our store, because balances are fetched on demand and
transactions arrive on a scheduled tick.

So the two inputs to the walk were **as of different moments**, and the arithmetic has no way to know:

```
anchor  = live balance          knows about the cheque
ledger  = transaction store     does not
```

Subtracting a ledger that is missing one transaction shifts every day before it by that transaction's
amount — all of them, by the same amount, for as far back as the picture is drawn:

```
Aug 5, reported by the bank     $8,147.50
Aug 5, drawn                    $6,448.00
                                ---------
                                $1,699.50   the cheque, on every single day
```

The curve remained perfectly self-consistent throughout. It agreed with itself, every step matched a
transaction, and every value was wrong. **A reconstruction is exactly as good as the transaction record
and no better, and it cannot report its own incompleteness.**

#### The rule

A closing balance is **observed**. The bank states it; it cannot drift; it does not care whether we
have every transaction. So where one exists for a day, **it is that day's value** — not a candidate to
be averaged with the walk, not a check on it. The walk's job shrinks to filling the gaps between
observations, which is the one thing it is good at over a short span.

`observedSeries()` in [`BankBalance.js`](../src/processors/BankBalance.js) takes **two anchors**, each
correct for its own segment:

| segment | anchored to | why |
|---|---|---|
| days at or before the newest observation | the **observations** | the bank said so |
| days after it | the **live balance** | it is the only thing that knows about money moved since the last tick |

**Each gap is walked backwards from the observation to its RIGHT.** This is the part that matters: an
ingestion gap can then only distort the days *inside that gap*, never all of history. The failure above
becomes structurally impossible rather than merely fixed.

#### The discontinuity is real, and stays visible

Where the live segment and the observations disagree at the join, that difference is **money the bank
has seen and we have not**. It is reported as `unreconciled` and drawn as it falls.

Smoothing it would put the error back into every historical point, which is the bug this exists to
prevent. It heals by itself at the next refresh.

#### Falls back completely

With no observations this is `reconstruct()` point for point. History older than the first stored
snapshot, and any provider that carries no balances at all, keep working exactly as before. **This is
not a nicety** — the remembered series only accumulates forward from the day capture shipped, so most of
any long window is still walked, and it must be right.

Every point carries its source — `observed`, `walked between observations`, `walked from the live
balance` — because "the bank said so" and "we inferred it" are different claims, and a reader auditing a
surprising number needs to know which one they are looking at.

#### Why there is no backfill, and never will be

The obvious next move is to reconstruct observed balances for history from the aggregator. It is not
available:

- **Plaid carries no per-transaction balance.** Not on `Transaction`, not on `AssetReportTransaction`.
- **Plaid's one historical balance product is our own walk.** Asset Reports' `historical_balances.current`
  is defined as *"calculated from the `current` balance in the `balance` object by subtracting inflows
  and adding back outflows"* — the same arithmetic with the same failure mode, requiring every Item to be
  re-linked (Assets cannot be added after Link) and billed as Additional History.
- **Powens carries no per-transaction balance either.** Their own documentation says to compute it from
  an opening balance and the ordered transaction values.
- **Powens does have a real daily series** — `GET /users/me/accounts/{id}/balances` with `min_date` and
  `max_date` returns `daily_balances[].balance`, *"Balance of the account at the end of the day"*, which
  is bank-stated rather than derived. It is Powens-only, its enablement per domain is unconfirmed, and
  bank history depth floors at three months. **Worth wiring when a Powens account exists; it backfills
  nothing on a Plaid-only portfolio.**

So pre-snapshot history is walked, permanently. The honest response is the source label, not a
fabricated observation.

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

`histogramOf` (over `AmountHistogram.js`) bins every transaction of a stream by where it fell
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

- at `t = now`, the curve equals **the freshest thing that observed it** — the stored balance for
  today where one exists, and the live reported figure otherwise (§2f). It was "the reported balance"
  and the change is deliberate;
- the past series changes at transaction dates by exactly that transaction's amount, **and at one
  other place**: the newest observation, where it may step by `unreconciled` — money the bank has seen
  and the ledger has not (§2f). A test asserting no such step asserts the bug;
- the future series changes only at expectation dates, by exactly that expectation, **plus
  `extraFlow`** — the card repayment, which is arithmetic on posted charges rather than an
  expectation;
- past and future meet at `now` **with a discontinuity of exactly `unreconciled`, and no other**. The
  past ends observation-anchored; the future starts from the live anchor. Zero is the normal case and
  the seam is only open while the bank knows something we do not;
- with no expectations at all the future is flat **for a portfolio with no linked card**. One linked
  card gives a stepped future from posted charges alone;
- **a card payment moves §1a and does not move §1b** — the one invariant that says the credit-card
  timing has actually been removed rather than merely hidden;
- **a card purchase moves §1b on its own date, and §1a not at all**, which is the same statement read
  the other way;
- the reported trough is the minimum of the series actually drawn, and its date is a date in it —
  trivial, and worth asserting, because a trough computed off a different array than the one on screen
  is the kind of thing that stays right until the day it does not;
- **every predicted movement comes from a TERMINAL stream or a PARTITION of one, and the card
  repayment is the only exception** — see below.

### §7a Every prediction comes from a terminal stream

`CompoundStream.getExpectedAmountAtDateByPeriod` is **defined** as the sum of its active children, so a
parent has no amount of its own: asking a compound and asking its leaves is the same question, and
reading both double-counts. `forecast()` therefore walks the **leaves** and never once looks upward.
This is the same rule the money-flow adapter follows for the same reason, where it is written as "a
second author for the same quantity".

**It walks `opts.terminals`, not `getAllTerminalStreams()` directly**, and since the partition those
are not the same list. `buildModel` hands it the terminals *after* `partitionStreams`, so a stream paid
two ways appears as two virtual leaves — `"util@chk"` and `"util@visa"` — that are not members of
`getAllTerminalStreams()` at all. The no-double-counting rule survives intact, because the partition
DIVIDES the declared budget between the halves rather than giving it to both.

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

**The single exception is the card repayment**, and it is no longer a re-timing. The `settles`
mechanism this paragraph described is dead — `buildModel` sets `const settles = null` and never
populates it, so both branches that read it are unreachable. What ships is `extraFlow`: per linked
card, `observed + planned + residual` scaled by pass-through, which is *arithmetic on posted card
transactions* rather than a redistribution of forecast streams. See `credit-cards.md`.

The paragraph below is kept because the argument still holds for why a card's money cannot be left on
its purchase dates — only the mechanism changed.

The superseded description: it was a *re-timing* of streams that were already forecast at their own
dates, moved to the day the
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
stream's own transactions actually left, and routes it where the majority of that money went. A
hand-kept list would be a second author for a fact the ledger already states, and it goes stale the
first time a subscription moves to a different card. A stream with no history is treated as direct —
the safer error, since it then lands on its own day rather than a fortnight later, and the trough it
contributes to arrives early rather than not at all.

### A SHAPE IS READ FROM THE ACCOUNT THE MONEY LEAVES

Routing decides where a stream lives. Its **shape** — which days of the month it lands on — used to be
read from a different set: the transactions on the accounts the current reading covers. For a stream
that lives on a covered account those are the same set. For one that does not, they are the leftovers.

Groceries is charged to the card almost every time, with the occasional purchase on the debit card.
The shape was built from the occasional ones:

| | transactions | what the shape was read from |
|---|---|---|
| card | 78 | — |
| checking | 6 | all of it |

Six debit purchases outvoted seventy-eight card ones, and a stream declared weekly came out as a
single monthly lump. Not a cycle-detection failure: the detector was handed six points and did the
right thing with them.

Routing already answers this, and it needed nothing new — it follows the leg that **leaves**. It is now
computed **first**, from the windowed legs and the stream's direction, both of which exist before any
shape does, and each shape is read from the account routing named. The covered-account set remains the
fallback, so a stream with nothing on its routed account keeps a shape rather than going blank.

### A STREAM PAID TWO WAYS IS TWO STREAMS

Utilities is water and electricity. Water is paid by transfer from checking on the 4th; electricity is
charged to the card on the 18th. They are one stream because they are one **category**, and routing has
to pick a side — so half the stream was described by the other half's rhythm, and the forecast put one
charge on the 2nd against a real payment on the 4th.

Neither side was wrong. They are different bills with different counterparties on different accounts,
and averaging them produces a date **neither of them keeps**. So they are separated, and each partition
is an ordinary stream from that point on: same shape, same cycle test, same classification, same
tiering. Nothing downstream is a special case, because the partitioning happens before any of it and
everything after sees a longer list of terminals.

**The declared budget is divided, which is what stops it counting twice.** One stream declares $225 a
month; after the split the partitions declare $153 and $72 — never $225 each. The shares are the
observed division of the money and sum to 1 by construction. The bench audits the partitions as
separate rows for the same reason: a row for a stream the model no longer has would be scored against
a forecast nothing produced.

Three gates, because a split is only worth having when both sides can carry a forecast of their own:

| gate | rule | what it protects against |
|---|---|---|
| **share** | the smallest partition holds ≥ 25% of the money | a shape built out of scraps |
| **count** | ≥ 3 transactions on each side | one stray card payment of a checking bill |
| **recency** | shares weighted towards recent cycles, half-life 2 | last spring deciding this month's bill |

The recency weight moves in both directions, which is the point of doing it as a weight rather than a
rule: a stream that has just moved onto the card crosses 25% within two cycles instead of waiting for
the year to average out, and one that has just moved off it falls below as fast.

**And one override.** If every transaction in the last complete cycle went to one account, that account
takes the whole stream regardless of what the window says — a payment method that has changed *has
changed*, and the history is describing an arrangement that no longer exists. It needs two transactions
to speak, and it does not apply to long-period streams, where one cycle is one event and proves nothing
either way.

Accounts qualifying on neither gate are **folded into the largest partition rather than dropped**, so
the money still adds up and no leg goes missing. `partitionKey(streamId, accountHash)` is the single
assignment used by both the forecast and the scoring — handed out, never reimplemented, because the
moment the bench decides for itself which leg belongs to which partition there are two answers to that
question and they drift apart.

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

### §2d THE BENCH, on real data — in the staging Sandbox

The tile's unit tests prove the model is **self-consistent**, not that it is **right**. Whether a
classification matches this portfolio is a question about real transactions, and a fixture cannot
answer it — nor can it answer the one that actually matters: *which streams have exhausted their
potential, and which are still carrying a fixable mistake.*

So the bench lives inside the app, on the staging-only Sandbox route
([`BalanceBench.js`](../src/components/BalanceBench.js)), where the real ledger and the real forecast
already meet. It runs the last settled month out of sample and attributes the error **one stream at a
time**, splitting every error in two, because the two have different cures:

| | what it is | what it means |
|---|---|---|
| **level** | `\|Σpredicted − Σactual\|` | the stream moved a different **total** than expected — the budgeted amount is stale, which is a fact about the master stream, not about the code |
| **timing** | `Σ\|predicted[d] − actual[d]\| − level` | the same money on the **wrong days** — a shape or cycle that does not match reality |

Crossing that split with the predictable/erratic class is what turns a number into a verdict:

- **predictable + timing error → MODEL BUG.** The stream is regular and we are drawing it in the wrong
  place. This is the only category that is worth engineering time.
- **any + level error → budget stale.** Not a code problem; the expected amount needs editing.
- **erratic + timing error → irreducible.** No amount of modelling fixes an irregular stream, and
  pretending otherwise is precisely how a chart loses trust.
- **no error → exhausted.** Already exact; nothing left to win.

**The residual row is the point of the whole exercise.** Everything the account did that *no stream
accounts for* — uncategorised transactions, unlinked transfers, the card settlement — is money the
master stream cannot see. If the residual is large, no improvement to any stream will make the picture
accurate, and the work is categorisation rather than modelling.

That row also forced a change in the Sandbox itself: it had been filtering to categorised transactions
before handing them on, which would have zeroed the residual while leaving it looking computed. The
page now keeps everything and the header rows filter for themselves.

### §2e WHAT COUNTS AS A STREAM'S OWN TRANSACTIONS

Before any threshold is worth arguing about, the classifier has to be scoring the right numbers. Two
things it was fed were wrong, and both corrupt the *classification* while leaving every *total* in the
app correct — which is exactly why they survived this long.

**The allocated amount, not the transaction's.** A $200 order split $150/$50 across two streams is not
evidence that either stream moves $200. Feeding the whole transaction to both inflated their histogram
weights and destroyed `steadiness`, which measures how alike the amounts are.
`TransactionEvaluator` has always used `Math.abs(allocation.amount)`; the balance view now agrees with
it. The **sign** still comes from the transaction, because that is the direction the money moved on
the account, and every part of a split moves the same way.

**A paired transfer is one event.** A monthly move to savings is stored as two legs carrying the same
allocation, so counting both made a $4,000 transfer look like **$8,000 of activity every month** — and
`steadiness` then measured a quantity that never existed. `TransactionEvaluator` skips the second leg
for precisely this reason.

Direction decides *which* leg is kept, never *whether* to collapse: a pair is one event whatever its
signs. That serves routing too — a savings transfer expects money out, so the outgoing leg is kept and
`accountRoutingOf` sees the account the money actually left. Where the expected direction says
nothing, the outgoing leg wins; picking by ledger order there would reintroduce the order-dependence
that routing had already had to fix once.

Allocations name their stream directly, so this also stopped asking every stream about every
transaction — the grouping is now one pass instead of fifty-odd.

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

### §10e-a A badge is an AMOUNT, marks the RISER, and grows instead of being covered

**Which days get a badge: movements over $1,000.** The floor was a fraction of the window's range,
which sounds adaptive and is not: a quiet month promotes its own noise to a badge, and a busy one
hides a four-figure payment because something larger happened nearby. A badge means "this is worth
noticing", and that is an absolute claim about an amount, so it is an absolute number. It also means
the marks do not move when the window changes — the same day carries the same badge in a month and in
a quarter, which is what lets the two windows be read as the same picture at two scales.

**It sits halfway up the riser, not on the landing point.** A step chart's vertical segment *is* the
movement; putting the icon at the top of it marked only where the balance ended up, which the curve
already says on its own. Centred on the riser the badge sits inside the jump it names, and a large
step stops crowding the flat run beside it.

**It is filled with `modalBackground`, DesignSystem's own opaque token for a control sitting on top
of content, not `pageBackground`.** The two read differently: a badge filled with the app's own page
colour is a hole punched back through the tile to whatever is behind it; filled with the token meant
for exactly this — a thing that sits on top and must not let what is under it show through — it reads
as a mark resting on the chart.

**Holding one grows it, rather than drawing a separate marker on top of it.** A focal dot used to mark
whichever day the cursor was on, and it sat directly under the finger, covering the very step it was
there to explain. The badge is already where the movement is, so under the cursor it grows instead —
`GROW_HELD` at rest, eased a share of the remaining distance every frame so taking hold is a movement
and letting go is that movement backwards, never a switch — and it is drawn last, on top of its
neighbours rather than under them. A day with no badge shows only the cursor line: there is nothing to
grow, and nothing was covering it either.

Nothing else in the picture carries a name. That is deliberate: a chart where every mark is labelled
has no marks, only labels.

### §10e-b The caption is EVERY movement that day, not the single largest one

The readout used to look the cursor's day up in the event list that places the beads — thresholded to
significant movements — so on most days, which clear no badge, the cursor could say nothing about what
moved: the one thing worth knowing about a day someone is pointing at.

**It now reads `dayAudit()`**, the same call that answers the parent's own audit table: for a past day,
every ledger entry that landed; for a projected one, the forecast's own named rows. Nothing here is
re-derived — a second reading of "what moved" would drift from the one the table shows. The result is
memoised per day, because `draw()` repaints on every frame of the grow animation and `dayAudit()`
filters the whole ledger.

**Every stream that moved gets its own line, grouped and summed — never packed onto one line because
two names happened to fit.** Two movements sharing a line read as one caption, and the reader had to
notice a middle dot to learn there were two things to know. SVG text does not wrap on its own, so the
lines are laid out as `tspan`s, three at most: a caption taller than that would cover the picture it
is explaining, and whatever is left over is counted (`+N`) rather than silently dropped.

**The value is bold, signed, and reads in the DS's own semantic colour where the movement is one of the
two things that colour already means elsewhere — savings (blue, the runway's own token above the
ceiling, and the same rule the "save" badge icon already uses to spot a savings, investment or
transfer stream by name) or income (green, the runway's positive band).** An ordinary expense keeps
the ink colour: most days are ordinary expenses, and colouring all of them would colour nothing. The
value is also never the part that gets cut when a line is too long for the room there is — the name
gives up its own space first, because a badge nobody can attach a name to still names its size.

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
the dashed projection, so they read on both halves. Held under the cursor a badge grows to `GROW_HELD`
of that — see §10e-a — rather than a second, separate dot needing its own ratio; every mark is ringed
in the ink colour so it stays a mark ON the line rather than a thickening OF it.

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

## A second forecaster, and which half each one owns

Everything above describes the forecaster page three ships: `BankBalance.js`, assembled by
`buildModel` and run by `forecast`. A second one now exists beside it —
[`Spec - balance prediction.md`](<../src/processors/balancePrediction/Spec - balance prediction.md>),
built on the stream predictor, which reads a captured portfolio as plain JSON and hands back one
ledger per account.

**They are not layered and neither calls the other.** The split is by ownership: this file describes
what a user sees on page three; that spec describes the module, its stages, and what it has been
measured at. Nothing here restates its mechanism.

**Where they meet is the sandbox.** A switch at the top of that page chooses which forecaster draws
the tile's two lines, fills the day table, and feeds the accuracy bench — one switch for all three,
because a reader comparing two models is comparing three views of each. `BalanceChart` takes an
`algo` prop for it. Production renders that same component without the prop, so the module never
runs outside the sandbox: no portfolio is captured and no prediction is made.

**The bench is the referee.** It owns the window, the reconstructed balance, the dollar-day integral
and the denominator, and hands all of them to whichever forecaster is selected — so a difference in
the score is a difference between the models and not between two measurements. The comparison, month
by month across the captured year, lives in the balance prediction spec; it is a measurement of a
moment and does not belong in this folder (Rule 5).

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

## Roadmap: getting to a forecast that can be trusted

Parked hypotheses, not decisions. Each is written with the trap it has to avoid, because most of them
have one, and several are traps this file has already paid for once.

### The cascade

A per-stream ladder: use the most confident method a stream's own history supports, and fall to the
next when it does not hold up.

**Tier 1 — revise the expectation from the actuals.** The predictable streams give a baseline from the
master stream; compare it with what actually happened and form a revised estimate; forecast the next
cycle from the revised picture rather than the declared one.

> *This is the highest-value idea on the list, and the one with the sharpest trap.* The master stream
> is the user's **intent**, and page two treats it as authoritative. If page three quietly substitutes
> an empirical estimate, the two tiles disagree about the same stream and the reader cannot tell which
> is lying. That is a trust failure of exactly the kind this whole effort is trying to avoid.
>
> The fix is to make the revision **visible rather than silent**: forecast from the revised figure and
> surface the divergence as a prompt — *"Rent has been $1,850 for three months; budgeted $1,700"*. The
> modelling improvement then arrives as a feature rather than as a discrepancy.
>
> Statistically the right shape is **shrinkage**, not replacement: blend the declared amount with the
> observed mean, weighted by how many observations there are. One month of data barely moves it; a
> year of data dominates it. That degrades gracefully at n=1, where a pure empirical estimate is
> reckless and a pure declared one is stale, and it needs no threshold.

**Tier 2 — date variable, amount consistent.** Rent, bills, day-care cheques: a handful of
transactions of very similar size, on a date that moves. Do **not** spread them. Take the centre of the
histogram as the predicted date, and a robust recent amount as the predicted size.

> *Right instinct, and it follows from what the tile is for:* a balance chart is read for its steps, so
> a spread that is "less wrong" in absolute terms is more wrong in the only way that matters — it
> removes the event. Concentrating is correct even when it costs L1 error.
>
> **Trap: the centre of a circular histogram is not its mean.** A payment landing on the 30th and the
> 2nd has a mean day of 16, which is the one day of the month it never happens. The month is a cycle
> (this file has already paid for that lesson once, in `consolidate`), so the centre must be a
> **circular mean** — or, more robustly, the peak of the consolidated cluster, which is what
> `consolidate` already computes.
>
> **On "median of the last 2":** the median of two numbers is their mean, so that phrasing buys no
> robustness — and two observations is too thin a base to throw the rest away for. What is wanted is a
> **robust recent** estimate: the median of the last k occurrences, with k around 3–6, so one strange
> month cannot move it and a genuine step change is still picked up within a cycle or two.
>
> **The honest cost:** placing rent on the 3rd when it lands on the 6th makes the balance wrong by the
> full rent for three days. That is an argument for drawing the **uncertainty of the date** — a shaded
> band around the predicted day rather than a hard step — not for going back to spreading.

**Tier 3 — no clear cluster: spread over the period.** Groceries and the like. This is what the model
does today, and it is right for genuinely diffuse streams.

**Falling between tiers.** The proposal is to cascade when the deviation is too big. That works, and it
can be made to need no hand-set threshold: run every tier a stream qualifies for **out of sample** and
keep whichever actually predicted best. That is cross-validation, it is exactly what the bench already
computes, and it replaces an argument about thresholds with a measurement.

### On Fourier, clustering and ML

**A Fourier transform is the wrong instrument here**, for a domain reason rather than a mathematical
one. Money is calendar-driven, not sinusoidal: "the first of the month" and "every other Friday" are
not frequencies. Months are unequal in length, so a fixed-frequency basis smears precisely the events
that are most regular — a monthly spike needs many harmonics to represent and comes back as a ripple.
The candidate-set periodogram already in `detectCycle` is the same idea with the right basis: try the
periods money actually uses, and score the fit.

**Clustering is a real improvement, and a narrow one.** `consolidate` currently decides what counts as
one event with hand-set numbers — runs spanning five days or fewer, bridged across gaps of two.
Weighted **DBSCAN on the circular day axis** would find clusters of arbitrary width and shape, handle
the wrap natively, and replace two tuned constants with one interpretable parameter. Worth doing when
tier 2 is built, since tier 2 needs a cluster centre anyway.

**Learned models are a poor fit at this data size.** Fifty-odd streams with twelve to thirty-six
observations each is very little data, and any model with more than a few parameters will fit noise
and report it as skill. The right family is **robust statistics with strong priors** — shrinkage,
medians, circular means — not learning. The one place machine-learning *thinking* earns its keep is
model selection by out-of-sample error, which is the cascade above.

### What has to be measured before any of this is worth building

The bench answers "how wrong, and whose fault" but not yet "wrong in a way that matters":

- **Trough error, separately from total error.** Goal 1 is *can I cover what is coming*, so the depth
  of the low point and the date it falls on are the numbers the decision actually rests on. A forecast
  with worse L1 but the right trough is the better forecast, and today nothing says so.
- **Error as a function of horizon.** Accuracy at three days out and at fifteen are different claims,
  and only one of them is load-bearing for a decision taken now.
- **Per-tier out-of-sample comparison**, which is what makes the cascade selectable rather than
  guessed.

### The change that may matter more than any of them

The three principles — usefulness hinges on accuracy, accuracy cannot be perfect, so what is
predictable must be very accurate — have a conclusion this roadmap keeps circling without stating:
**the chart should stop claiming more than it knows.** Draw the predictable streams as a line and the
erratic remainder as a **band**. A reader trusts a picture that is visibly uncertain about the part
that genuinely is uncertain; the same picture drawn as one confident line is wrong in a way that costs
trust in *everything* on it, including the parts that were right.

That is a design change rather than a modelling one, it needs no new statistics, and it may buy more
trust than every tier above put together.

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
- ~~**The stored series is not read yet.**~~ **Done** — see §2f. The view anchors the past on the
  stored observations and walks only to fill the gaps; the live figure now answers "what is it now"
  and nothing else. What remains open is that history predating the first snapshot can only ever be
  walked. The drift comparison it made possible is the best evidence the
  categorisation is complete.
- **Posted versus available** is unresolved: both are now stored, and the view uses `current`.
- **The parked streams** (`Option Exercise` at 0.01 against $10,582 of real movement, `Investments` at
  −0.1 against a history of −7,550) make the forecast's composition wrong even where its total is
  right to within 1%. That is a data problem this view has now made visible, which is §2a working.
- **The settlement day is measured from one signal** — the largest recurring payment into a card. With
  two cards settling on different days it will pick one. Splitting it per card is the fix.

---

## Roadmap — predict ACCOUNTS, not one blended set of streams

> **This section is the scoped exception to Rule 5** (see [`context.md`](context.md), process note 6).
> It records decisions taken in conversation for work built in phases. Each phase's entry is deleted
> as it lands, its mechanism moving up into the body above and leaving one line in the log at the
> bottom of this file.
>
> **Phases 0, 3, 4 and 5 have since SHIPPED** and are described as fact in the sections above — the
> link from paired transactions (`accountLinks`), both repayment legs leaving the stream ledger, the
> per-card schedule (`cardSchedule`) and the repayment as an event on checking (`cardRepaymentForecast`
> into `extraFlow`). Read them for what the code does. What follows is kept for the reasoning, and for
> Phases 1 and 2, which have not.

### Why the current shape is wrong

Everything above forecasts **one flat set of streams** and patches the credit card in as a special
case — a synthetic pseudo-stream, an `extraFlow` of explicit events, an exclusion list so the
repayment is not counted twice. Those patches all compensate for the same thing: a card is an
account, and it is being modelled as a stream.

A stream's money leaves an account. A card's money leaves **two** accounts, at two different times,
and one of those movements is a batch of the other. No amount of care inside a stream model expresses
that.

So the revision inverts the structure: **describe each account on its own terms, then connect them.**

---

### Phase 0 — Establish the link, and branch on it

Everything else depends on this, and it is cheap.

For each account typed `credit` (which is declared in Settings and inferred nowhere — see
[`account-types.md`](account-types.md)), look for **paired transactions with one leg on that account
and the other on a checking account**. The data model already carries the pairing.

- **A pair is found** → the card is linked to that checking account, and both sides are visible.
- **No pair is found** → the card is unlinked as far as this forecast is concerned.

**An unlinked card is an ordinary expected outflow.** Its repayment is a transaction on the checking
account like any other: predict an amount and a timing, and stop. There is no statement to
reconstruct because the charges are not visible, and nothing downstream of this phase applies to it.
This is not a degraded path, it is the correct description of that situation — and it is probably the
common one.

**Only a linked card continues into Phases 2, 4 and 5.**

Two constraints that fall out of the link being between accounts rather than institutions: a card and
its funding account may be at **different institutions**, so nothing may group by institution; and a
checking account with no linked card must never be given a synthetic repayment.

---

### Phase 1 — Classify every stream, and say which account it lives on

Today classification answers "how does this stream behave in time". It has to answer two more.

**1a — Behaviour, revised.** The current three tiers predate the event rules and no longer describe
what the forecast does. The classes to settle on, for review:

| Class | Meaning | Evidence |
|---|---|---|
| **Event, dated** | One movement per turn, on a settled day | one live day in the shape, one movement per turn |
| **Event, drifting** | One movement per turn, day wanders | two to four live days |
| **Instalment** | A long-period budget being spent in repeating equal charges | two or more, consistent amount *and* interval matching the cycle |
| **Flow** | Many movements per turn; an average is the honest description | more than four live days, or several movements per turn |
| **Budget** | A long-period amount with no rhythm; the remainder is spread | long period, no instalment evidence |
| **Not forecast** | Declared but unpredictable in the dangerous direction | long-period **income** — no date, no obligation, no rhythm |
| **Dormant** | Declared, but nothing has moved for long enough that the arrangement has ended | to be defined |

Two are new and both came from failures rather than theory: **Instalment**, because a long-period
budget stops being a budget once two equal charges land a cycle apart; and **Not forecast**, because
predicting income you cannot time is the same optimism as putting it on a specific day.

**1b — Direction.** An inflow clears a higher bar than an outflow before it is drawn as a step,
because over-predicting income and under-predicting spending are the same error and both are the
expensive one.

**1c — Which account.** Routing is treated as a filter today. It becomes a first-class output of
classification: every stream is assigned to the account its money actually leaves, read from the
declared account type.

**Open question:** whether `Dormant` applies to streams as well as cards, and what "long enough" is
for a stream whose cycle is a year.

---

### Phase 2 — A credit card is an account, not a stream

The largest change, and the one that removes the most code rather than adding it.

> **DO NOT FOLLOW THIS PARAGRAPH LITERALLY.** It was written before Phase 5 shipped, and `extraFlow`
> turned out to be the right carrier rather than the thing to remove: the repayment IS delivered as an
> `extraFlow` entry today. Deleting it deletes the card repayment.

Delete the synthetic settlement pseudo-stream and the stream exclusion list. `extraFlow` stays, and is
now what carries the repayment. A card account is described in its own right, and its repayment appears
in the checking account's forecast as a **connection between two accounts**.

*(As shipped: the pseudo-stream is gone — `settles` is permanently `null`. `excludeIds` survives as an
always-empty object threaded into `forecast` and `contributionsOn`, because a repayment now leaves the
ledger as a TRANSACTION rather than as an excluded stream.)*

**Repayment identification collapses into the pairing.** The present implementation reconstructs the
link with four rungs of inference — a stream whose legs straddle the two accounts, exact-amount
receipt matching, same-day attachment, and an amount-window search gated by an established rhythm.
All four exist to rediscover a relationship the data model already records. Phase 0 replaces the lot.

What that removes, and it is the point of the phase: every failure mode of that inference —
a card whose issuer returns no receipt, two cards indistinguishable by amount, an outflow that merely
resembles a repayment, a stream that touches both accounts without being a card payment at all.

---

### Phase 3 — Describe each account independently

**3a — The checking account.** Every stream routed to it, **minus the checking-side legs of
checking↔credit pairs**. Those are not spending; they are the discharge of another account's balance,
and they are reintroduced in Phase 5.

**3b — The card account.** Every stream routed to it, **minus the credit-side legs of the same
pairs**. The output is the card's **balance**, which is what a statement is a snapshot of.

The same pair, excluded from both sides, and read back with the sign it has on each — see
[`credit-cards.md`](credit-cards.md).

**3c — The per-stream sub-problem, documented properly.** Predicting one stream is its own problem
and is described only in scattered sections above. It needs one place, covering:

- **Clustering and outliers.** A drifting payment is one event recorded on several days; a genuinely
  diffuse stream is not. The current rule collapses runs within a fixed radius in days, which is a
  constant standing in for a cluster. What replaces it, and how an outlier — a payment moved by a
  holiday, a double month — is excluded rather than averaged in.
- **Expected versus actual, and how actuals inform expected.** The declaration is intent; the ledger
  is what happened. They interact today in three ad-hoc places: the zero-sum override (ledger wins
  where the declaration is silent), the remaining-budget rule (declaration wins, ledger subtracts),
  and instalment promotion (ledger overrides the period). Those should be one rule with a stated
  principle, not three exceptions.
- **What a stream's own transactions are.** Which account, which leg of a pair, which window.

---

### Phase 4 — Schedule and behaviour, per linked card

Per card account, and the two kinds of quantity stay separate because they are read differently.

**Parameters of the account** — interval and offset. Fitted from history.

**Derived from behaviour** — pass-through and rate. Empirical summaries, applying only to the part of
a statement that has not been observed yet.

**Neither is fixed for the life of the account.** Repayment schedules are usually held steady by
autopay, but the holder can change them — weekly to monthly to smooth a cash-flow mismatch is a
normal thing to do. So the schedule is re-derived from recent history rather than fitted once and
held, and a change in it has to be detectable rather than averaged away.

Multiple cards must be supported even where a portfolio has one, because the failure of assuming one
is silent: parameters from the busiest card get applied to all of them. The interleaved case from
[`credit-cards.md`](credit-cards.md) — several cards on one account repaid on different days — is
where a single interval and offset describe neither, and Phase 4 is where it is either modelled or
declared out of scope.

---

### Phase 5 — Reconnect, for linked cards only

The card's forecast balance becomes a scheduled outflow on the checking account, on the card's
repayment schedule.

The connection is not assumed here — Phase 0 established it, or established its absence. A checking
account with no linked card gets no synthetic repayment, because inventing an outflow that never
happens is the same class of error as missing one that does.

---

### What this buys, and how it will be judged

- The recurring class of bug disappears by construction: there is no second place for the card to be
  counted, because it is not a stream anywhere.
- Four rungs of inference are replaced by one fact the data model already carries.
- The unlinked case gets the simple, correct treatment instead of a statement model with nothing to
  reconstruct from.
- Each account can be scored on its own, so a card error and a checking error stop being one number.
- The seven-day rolling accuracy is the measure that matters, because that is the horizon at which a
  correction can still be made.
- Every phase lands with the ablation used throughout: disable the mechanism, and a test must go red.
  A phase whose removal changes nothing did not need building.

---

## Change log

> **This section is a holding pen, not a home.** §10e-a, §10e-b and §10h above are already rewritten
> to describe the tile as it now behaves — this log exists for everything a future reconsolidation
> pass should fold into a proper section rather than leave as a dated list. Each entry names the file
> that actually carries the change; nothing here is the source of truth for the mechanism.

**2026-09-16 — badges shrink, the drag gesture is restored, and an observed/ledger lag surfaces**

- **Badge resting size halved** (`BADGE_R`, `BalanceChart.js`). Now that holding a badge grows it
  (§10e-a), the resting size no longer has to be found AND read at once — growth carries the "read"
  half. `BADGE_R = (DOT_R + 3)/2`, replacing the flat `DOT_R + 3`; `GROW_HELD` is unchanged, so a held
  badge is still a clear pop against its smaller neighbours.
- **Dragging is restored.** `ChartHost` never set `touch-action`, so a touch that moved was a
  candidate gesture the browser was free to read as its own pan before `wireOnce`'s `pointermove`
  ever saw it — the sequence ended in a `pointercancel` partway through, which reads as "the cursor
  moved once and then stopped following the finger": a tap survives because it never moves far enough
  to trigger the browser's own gesture, a drag never survives long enough to scrub. `touch-action:
  none` on the host and its svg is the fix — not a `preventDefault`, which is the wrong tool against a
  gesture the browser may claim before a handler runs at all.
- **A badge with no name ("dot" icon) on a day the ledger shows nothing — it is a TIME-OF-DAY bug,
  not a missing balance update.** My first reading of this blamed the bank for reporting a balance
  the ledger had not caught up with. That reading is wrong, and the data says so. A posted
  transaction cannot exist without a balance movement behind it; what is actually misaligned is which
  DAY a balance snapshot is filed under.

  The field is not in question: `anchor()` and `observedByDay()` both read `current`
  (`BalanceChart.js:521`, `:505`), which is correct and stays.

  Every snapshot in the captured portfolio is stamped at **15:05 UTC** — 08:05 local. That is a
  morning reading, so it carries the state of the PREVIOUS day's close, not of the day it is stamped
  with. `observedByDay()` keys it with `dayKey(x.date)`, i.e. its own UTC day, and `observedSeries()`
  then reads it as that day's CLOSING balance. Every observed point is therefore one day late:

      txn   2026-09-08            Check Paid #1050              -1700.00
      snap  2026-09-08T15:05:07Z  current =  2392.13   <- morning of the 8th: not yet cleared
      snap  2026-09-09T15:05:07Z  current =   692.13   <- morning of the 9th: cleared overnight
                                            ---------
                                             -1700.00   step filed under 09-09

      observedByDay()  ->  {"2026-09-08": 2392.13, "2026-09-09": 692.13}
      the -1700 step lands on 09-09; the transaction that explains it is dated 09-08
      eventsIn() finds nothing on 09-09, so the badge has no name and falls back to ICONS.dot

  The same off-by-one applies to the ANCHOR, and there it matters more: `account.current` was captured
  at `2026-09-09T15:25Z` and is pinned to `ledgerToday()`, so the whole reconstructed past is shifted
  a day against the ledger, not just one badge.

  **Not fixed — the fix is a decision about what a snapshot means.** The rule that matches the data is
  that a balance read at instant T is the closing balance of the last day that had fully elapsed
  before T *in the user's own timezone*: for an 08:05 local reading, that is T minus one day. Keying
  snapshots that way (and anchoring `current` the same way) fixes the badge and the shift together.
  The alternative — reaching a day either side when naming a badge — treats the symptom and leaves the
  curve shifted.

**2026-09-16 — the badge midpoint, several marks on one riser, and two lines removed**

- **Badge resting size to the midpoint** (`BADGE_R`, `BalanceChart.js`). Half was too far: at 3.5 the
  icon inside had no silhouette left. `BADGE_R = (DOT_R + 3)*0.75` — 5.25, between the original 7 and
  the halved 3.5.
- **A day is not one movement** (`eventsIn`, `BankBalance.js`; `bead()`, `BalanceChart.js`). `eventsIn`
  now returns `parts` beside `stream`: the day's own movements that each clear `BADGE_FLOOR` in their
  own right, biggest first. A leg has to clear the floor itself, or a $1,200 step made of twelve
  $100s would sprout twelve badges. The renderer stacks them along the riser at `2r + BADGE_GAP`
  pitch, centred, walking in the direction the balance moved, and keeps `floor((len + GAP)/pitch)` of
  them — so the count is set by the size of the step, which is the right constraint: a big jump has
  the height to explain itself in pieces, a small one is one mark and a caption. The trim drops the
  smallest first. Projected days have one attribution and so always draw one mark.
- **The balance readout under the title is gone** (`subtitle()`). It printed the balance under the
  cursor, which was the whole answer while the cursor's caption could not carry a value; the caption
  now names every movement of the day with its amount, at the mark. The line keeps the low point in
  every state. `balanceTile.test.js` asserts the subtitle is unchanged by the cursor.
- **The `all streams` / `regular only` control is off the title sentence.** Stale. `state.basis`
  stays at `"all"` and `terminalsFor()` is untouched, so the machinery the tests exercise is intact —
  only the button is removed.

**2026-09-16 — the reading is filed by the day it closes, and the cursor stops rebuilding the picture**

- **`closeDayOf()` replaces `dayKey()` in `observedByDay()`** (`BalanceChart.js`). The nameless badge
  was NOT the ledger lagging the bank, and the earlier entry above is corrected. A snapshot is an
  *instant*; a series point is a *day's close*. The daily refresh runs in the morning — every reading
  in the capture is stamped 08:05 local — so what it reports is the state the PREVIOUS day closed at.
  Filed under its own day it put the step one day after the transaction that caused it, and the badge
  on that step had nothing to name. A reading is now filed under the last day that had fully elapsed
  when it was taken, **in the reader's own timezone**, because a day closes at the reader's midnight
  and not at UTC's. A value stamped exactly at midnight UTC is exempt: that is what a bare date parses
  to — it is how every transaction here is dated — and it means the day it names.
- **The cursor is real time, and it is a layer, not a redraw** (`paint()`, `drawLive()`,
  `BalanceChart.js`). Three things were rebuilt on every frame of the grow animation to produce
  answers identical to the last frame's. Measured on the real 1,214-transaction ledger:

      eventsIn() over the whole ledger, per frame        1.406 ms
      movementAt() sweeping the ledger with dayKey()      1.179 ms
      ledger() rebuilt twice per draw()                   0.316 ms  (2 x 0.158)
                                                        ---------
      per frame, before                                   3.054 ms
      per frame, after                                    0.001 ms

  Four changes, in the order they matter. `ledger()` is memoised on `(transactions, covered)` and
  indexes itself by day in the same pass. The day bucket is `floor(ms/DAY)` (`dayIdx`), not
  `toISOString().slice(0,10)` — the same UTC cut, a division instead of a string; a key shown to a
  reader stays `dayKey`, a key that only indexes a bucket is `dayIdx`. `badges()` memoises the event
  list on the two series arrays, because the badges do not depend on the cursor at all. And the svg is
  split: everything the cursor can change — axis ticks, badges, cursor line, caption — lives in a
  `<g id="bal-live">` that is rewritten on its own, while the area, lines, guides and zero line stay
  as the browser already laid them out. The static layer is keyed on the two series arrays and the
  measured size; anything else that changes the picture changes one of those by construction. The axis
  is in the live layer *because* its ticks give way to the cursor's own date label — a rule that is
  only correct if it is re-evaluated when the cursor moves.
- **The cursor no longer vanishes between days.** It matched the day key exactly and drew nothing when
  there was no match. It now takes the day it is on, and the nearest drawn day when that day is not in
  the series — the reader is over a day either way, and the picture has to say which one.
- **The line under the title is gone** (`subtitle()` and `Subtitle` both deleted). It restated the
  window's low point in prose; the guide line draws that low with its own value printed on it, and the
  cursor names any day's movements with their amounts at the mark. The top area is the title.
- **The caption names two movements, then counts** (`CAPTION_LINES`). The overflow used to ride on the
  end of the last named line as a bare "+2", where it read as part of that movement's own figure. It
  is a different kind of fact, so it gets its own line, says "more" in words, and takes the secondary
  ink — nothing on it is a value, so nothing on it carries a value's weight or colour.

**Still open:** the cursor day is React state, so a `pointermove` that crosses a day still costs a
render. With the layer split the render is a title and a host div, and the repaint is one `<g>`, so
this is no longer the bottleneck — but it is the last structural piece if the drag ever needs to be
cheaper than it now is.

**2026-09-16 — a repayment is one fact either side of today, and the scale gets a gutter**

- **`nameOf()`: the tile names a card repayment, and names it once** (`BalanceChart.js`). The projected
  repayment carried the module's internal label — the literal `"repayment"` written by
  `accountLedger.js` on both legs of a settlement — which matched no icon rule and drew the bland
  fallback dot. So a four-figure movement the reader recognised on the past side of the line became an
  anonymous mark the instant it crossed into the forecast. Both sides are now normalised at the point
  the tile names things: `/^repayment$|credit card payment/i` → `"Card repayment"`, applied to the
  ledger's own rows, the projection's `top`, and both branches of `dayAudit`. The module keeps its own
  label; this is only what a reader is shown. `ICON_FOR` gains `/card repayment/i → card`, kept
  deliberately specific — a CAR repayment is not a card one and must keep its own icon, which
  `balanceTile.test.js` now asserts alongside the rest.
- **The high and low values move into a right gutter** (`PAD.r`, 10 → 48). They were printed inside
  the plot at its right edge, floated above the guide line and over whatever the balance was doing
  there — a label sitting on the picture it annotates. Given a column of their own they read as what
  they are: the scale, beside the drawing rather than on it. They now sit on the guide's own baseline
  (`Y(v) + 2.9`, `text-anchor="start"`), and the cursor caption's right-hand room shrinks with the
  plot by construction, so it cannot run into the gutter.

**2026-09-16 — the forecast gets a point per day, the gutter gets a third value, the edges fade**

- **One point per day on the prediction line** (`computeSeries`, `BalanceChart.js`). `seriesFrom` hands
  back the days the balance *changes* — all a step path needs to be drawn, and the reason the cursor
  could not be read on every forecast day: on a quiet day there was no point under the finger, so the
  cursor snapped to the nearest movement and reported someone else's date. The tile now walks day by
  day from today to the window's end, applying `liveRun.flow` as it goes and holding the balance
  across quiet days. Flow dated before the window opens is applied first, so the opening value is the
  one `seriesFrom` would have produced. `balanceTile.test.js` asserts no day is missing, none is
  repeated, and `dayAudit` answers for every one of them.
- **The cursor's balance is the third value in the gutter.** The high and the low are fixed facts about
  the window and are drawn quiet; this one answers the finger, so it takes full ink and a weight, and
  it *travels* — the reader watches it climb and fall between the two guides as they drag, which is
  the runway question asked and answered in one gesture. A faint dashed lead runs from the cursor to
  it, because a figure at the far right of the tile is otherwise a number floating at a height.
- **The edges fade** (`FADE_ID`, `FADE_W = 26`). A line that stops at the frame says the money stopped
  there. The drawing is wrapped in a `<g mask="url(#bal-fade)">` whose mask is white everywhere except
  a 26px gradient at the left edge of the plot — and at the right edge too when the window is `last`,
  because a past window has a future beyond it the reader can travel to. **A mask, not a wash:**
  painting a background-coloured gradient over the edge only works if the tile's background is opaque,
  and it is not — it is a translucent pane over the page, so a wash would fade the line into the app
  behind it rather than into the tile. **The gutter is outside the mask** by construction: the fade
  rects stop at `W - PAD.r`, and the high, low and cursor values are drawn past it. They are the
  scale, not the record, and a scale that faded would be unreadable exactly where it matters.
- **`DayAudit` is deleted**, with the `onDay` prop and the Sandbox state that fed it. The tile answers
  a day in place now — the cursor names every movement with its amount, and the balance it reaches —
  so the table was a second, older reading of the same question kept alive beside the one being
  worked on. `dayAudit()` itself stays: it is what the caption is built from, and the audit suite
  still holds it to the arithmetic of the line above it.

**2026-09-16 — the cursor's balance travels without a lead line, and the fade mask survives a travel**

- **No lead line.** The dashed horizontal line that used to run from the cursor to its own balance
  figure is gone (`drawLive()`, `BalanceChart.js`). It repeated what the figure's own height already
  says; the number is enough.
- **The number never jumps.** `_curVal` is an eased position on the same RAF loop that grows a badge —
  see `startGrow()`, which now also eases the cursor's value and the two guide labels every frame it
  runs, since all three answer the same event (the cursor landing on a new day) and stopping one
  before the others would read as three separate mechanisms rather than one motion. The mutation
  happens once, inside `drawLive()`, and `startGrow()`'s loop reads it back through `_liveMoving` — a
  flag `drawLive()` sets when it performed an incomplete step, checked once per RAF frame so the loop
  keeps running exactly as long as something is still moving. First appearance snaps (nothing to ease
  *from*); a day change afterwards eases at the same rate a badge grows.
- **A guide label gives way to the cursor's own reading, not the other way round.** When the eased
  cursor value's own gutter line would sit within `LABEL_GAP` (11px) of the high or low guide's own
  value, that guide's opacity eases toward 0 instead of snapping; it eases back the moment the two are
  no longer contesting the same line. The guide's own dashed line across the chart is unaffected —
  only its printed value, which is what actually collides. Moving these two labels out of the static
  masked layer and into the live one (`guideLabel()`) is what makes animating their opacity possible
  without repainting the whole picture every frame.
- **The fade mask no longer disappears mid-travel.** Both fade gradient ids and the mask's own id now
  carry a counter that increments on every `draw()` call (`this._paintSeq`). A full animation frame
  replaces the entire `<svg>` via `innerHTML` — mask and its `url(#id)` reference together — and some
  browsers cache the resolution of that reference across such a replacement; when they do, the picture
  reads as though the mask were never applied, going fully opaque, for exactly the span it is `<svg>`
  elements are being swapped fastest — mid-travel. A fresh id every paint is never a stale reference
  to begin with. `balanceTile.test.js` matches the id by shape (`bal-fade-\d+`) rather than the old
  literal name, and the travel-equivalence test strips the counter before comparing two paints.
- **The fade rect now covers the stroke's own overhang** (`STROKE_OVERHANG = 2`). A stroke is centred
  on its path, so a line ending exactly at the plot's edge still paints a couple of pixels past it —
  and the fade rect used to stop exactly at that edge, leaving that sliver outside the mask entirely:
  not faded, not covered, just the base rect's plain white showing through, a small bright fragment of
  line sitting just past the point the gradient had already gone fully transparent. The rect's OUTER
  edge (the one nearer full transparency) now extends by that same margin; the inner edge, where the
  gradient reaches full opacity, is untouched.

**2026-09-16 — the drag maps 1:1 with the drawing, gutter included**

- **The pointer's fraction was taken over the whole host box; the plot only fills part of it**
  (`dateAt()`, `wireOnce()`, `BalanceChart.js`). `X()` maps a date into `[PAD.l, W-PAD.r]`, never into
  `[0, W]` — the right inset is the gutter the high/low/cursor values print in, 48px of a 334px tile.
  The pointer handler read `(clientX - left)/width` as if the plot ran edge to edge, so the rightmost
  day — drawn at 85% across — only registered as "reached" at 100% of the drag: pulling the last day
  under the finger meant dragging past where the line actually ends, into the value labels themselves.
  Fixed by taking the pointer's fraction over the same inset the drawing uses:
  `f = (px - PAD.l)/(W - PAD.l - PAD.r)`, `px` the pointer's position in the svg's own local units
  (`(clientX - left)/width * this.W`, since `measure()` keeps `this.W` equal to the host's real
  measured width). A day drawn at a given screen pixel is now the day the cursor lands on at that same
  pixel, everywhere in the plot, not only near its centre.
- **`PAD` is exported** so the test can compute the same `X()` the drawing uses rather than asserting
  against a duplicated formula. Two tests in `balanceTile.test.js` stub `getBoundingClientRect` to the
  tile's own measured size (what a real one reports once painted) and dispatch a pointer event at the
  exact pixel `X()` draws a chosen day at, first, middle and last; the regression is confirmed against
  the pre-fix code (fails on the first day only, edge case) before being left in place.

**2026-09-16 — the snapshot keying is REVERTED, and the entry above it is wrong**

**Reverted:** `observedByDay()` files a reading under `dayKey(x.date)` again, as it always did.
`closeDayOf()` is deleted. Two entries above this one describe that shift — first as a fix, then as
a correction of an earlier diagnosis — and **both are wrong**; this entry supersedes them.

What the shift actually did, reported from the live app within the hour: a paycheque dated the 14th
drew its riser on the 13th, and the 14th was flat. It moved the entire observed curve back one day.

The captured portfolio settles it, and it settles it against me. I had read one transaction and one
pair of readings. The day in question carries **two** transactions, and the readings split them:

    txn   2026-09-08            Activehours Expensify            +7.50
    txn   2026-09-08            Check Paid #1050              -1700.00
    snap  2026-09-08T15:05:07Z  current =  2392.13   <- holds the +7.50, the same day it is stamped
    snap  2026-09-09T15:05:07Z  current =   692.13   <- holds the cheque, which cleared overnight

A reading stamped D holds day D's money. The `+7.50` proves it and I never looked at it — I took the
cheque alone, generalised from it, and wrote the generalisation into the spec as though it were
established.

**What the cheque actually is.** Not a keying fault at all: a paper cheque's `date` is the date
written on it, and the bank moved the money the following night. The two dates genuinely differ, so
no rule about which day a snapshot belongs to can reconcile them — and a rule that shifts everything
to line that one case up moves every correctly-dated transaction in the ledger out of line to do it.

**The nameless badge is therefore open again, and it is worth less than it looked.** It marks a real
thing — a step in the observed balance with no transaction dated to that day — and the honest fix is
to name it for what it is ("cleared overnight", or the neighbouring day's transaction) rather than to
move the curve. `driftVsRemembered()` in `BalanceBench.js` already measures this class of gap.

**The process failure is the part worth keeping.** A single example is not evidence for a rule about
timing; it was consistent with at least two rules, and I checked neither against the rest of the data
before changing a keying that everything downstream depends on. The measurement that would have
caught it costs one query: for every snapshot pair in the capture, does the delta match the
transactions dated to the stamped day, or to the day before? Four pairs were available and I looked
at one.

**2026-09-16 — one anchor, walked back over posting dates; the stored per-day snapshots are dropped**

**The decision, in the reader's words:** *at any given time the displayed balance needs to be correct,
and it should match the transaction posting dates. Anchor on the balance of the last closed day and
rebuild walking backwards from the posted transactions — and this issue would never happen.*

**Why the snapshots had to go.** A snapshot is a fact about **the instant it was taken**, and it is
written once and never revised. The bank restates a past day as late postings land on it — the reader
confirmed this in their banking app: *even backdated, the balance was updated to make sense from
there* — and our copy of that day does not get restated, because we never fetch a past day again.
So a day whose snapshot predates a cheque clearing stays frozen at the pre-cheque figure forever, and
the step the cheque makes lands on whichever later day first had a snapshot taken after it. That is a
riser on a day nothing happened, with the real transaction's own day drawn flat beside it. Both
keyings of that snapshot — its own day, or the day before — produce it; only the snapshot's own
staleness is to blame, so no keying rule was ever going to fix it.

**The model now.** `computeSeries()` calls `reconstruct(txns, now, anchor, from)` and nothing else.
Today's point IS the live balance; every earlier day is that figure minus what posted since, by
posting date. The curve agrees with the transaction dates by construction, and the freshest part of
it — the part actually read — is right by definition. No mid-curve value can contradict a date the
reader can check against their bank.

**What is given up, stated plainly.** A transaction the bank has taken and our store has not received
displaces every point before it by that amount. That is real, and it is the failure the snapshots were
introduced to fix. It is the better of the two failures: uniform rather than local, so it reads as a
level rather than as an event that never happened; it heals itself the moment the transaction arrives;
and it never puts a movement on a day that had none. The size of that gap is still measured per
account by `driftVsRemembered()` in the bench, which is where it can be argued about with numbers.

**Removed from the tile:** `observedByDay()`, the `getBalanceHistory` fetch on mount (400 days
requested per mount, answer now unread), `state.remembered` and its entry in the series cache key,
and `_unreconciled`/`_observedCount`. The bench fetches its own history and is untouched.

**Left in place, and now called by nothing in the app:** `observedSeries()` and `BALANCE_SOURCES` in
`BankBalance.js`, with their unit tests. They are correct and well covered; deleting them is a
separate decision that belongs with whatever the bench concludes about `driftVsRemembered()`. Flagged
here rather than left to be discovered.

**Tests** (`balanceTile.test.js`): today equals the anchor exactly; each earlier day equals the day
after it minus that later day's postings; a snapshot wildly disagreeing with the walk changes the
drawn line not at all; and the tile issues no balance-history call.

**2026-09-16 — the anchor is the last closed day; the mask stops being thrown away; two labels simplify**

- **The anchor moves from today to the last closed day** (`computeSeries`). Today is still being
  written — an authorisation settles, a pending charge posts or is dropped — and the live figure moves
  under a reader who has not spent anything. Yesterday is finished: what the bank says about it now is
  what it will say tomorrow. So the picture is pinned there, and today is derived **forward** by adding
  back what has posted today:

      anchorValue = current - (postings dated today)
      past        = reconstruct(txns, yesterday, anchorValue, from)
      today       = anchorValue + (postings dated today)      // = current, by construction

  **Said plainly: with `current` as the only balance we hold, this is arithmetically the same curve.**
  Yesterday was already `current` minus today's postings either way. What changes is which day is the
  FACT and which is the derivation — and that is the seam every future decision about today's
  volatility hangs on: whether today is drawn as settled at all, whether a pending figure is ever
  admitted, whether the record line should stop at the close. It is written down so that decision has
  somewhere to live other than an implicit assumption.

- **The fade mask survives a travel** (`paintInto()`, and `MASK_DEFS`/`RAMP_DEFS`/`BODY_G`/`LIVE_G`).
  Every animation frame replaced the whole `<svg>` through `innerHTML`, throwing away the `<mask>` and
  the `<g mask="url(#…)">` that points at it *together*, sixty times a second. A reference is resolved
  when the group is inserted; asked to re-resolve it that often the renderer stops, and the picture
  goes flatly opaque for the length of the motion. **The per-paint unique id added two entries above
  made it strictly worse** — then every frame genuinely is a new resource — and it is reverted; the id
  is `bal-fade` again. The svg is now built once and a paint rewrites only three nodes: the ramp defs
  (pinned to the value axis, so it does move with the frame), the masked drawing, and the live layer.
  The mask defs and the group that references it are never touched, so the reference is resolved once
  and stays resolved. `rampDefs()` now emits the bare `<linearGradient>` — `draw()` supplies the
  `<defs>` that carries the id — so there is one element per paint to rewrite rather than a `<defs>`
  nested inside a `<defs>`. Resting paints, cursor paints and animation frames all go through the one
  path. A test asserts DOM *identity* of the mask node and the body group across a whole travel, and
  it fails against the old full-replace path.

- **No halo behind text.** Every label was stroked in a background colour under `paint-order:stroke`
  so it could be read wherever it landed. On a translucent tile that stroke is not invisible — it is a
  fattened, slightly-wrong-coloured slab around each glyph, which is the "weird backdrop". The labels
  sit in the gutter or the top padding, clear of the drawing, so they never needed it.

- **The high and low are just their numbers.** "high"/"low" named what the reader can already see —
  the higher figure is higher up the gutter, on the guide it belongs to — and spent half of each label
  saying it.

**2026-09-16 — the mask is the clip; nothing is drawn outside the plot**

Reported from the phone, with a screenshot: a bright stub of line pinned to the left edge. It was read
as the fade failing, and it is not — it is content that should never have been visible at all, and the
entry above's diagnosis of "the mask disappearing mid-travel" was very likely always this.

**The fault.** The mask's white base spanned the whole viewBox, so anything drawn OUTSIDE the plot was
not merely unfaded — it was fully opaque. And nothing clipped the left edge at all: only the right was
ever held back, by filtering data (`clipTo`), which is a different job with a different purpose (the
forecast retracting tip-first during a travel). A travel draws the **union** of both windows while the
frame interpolates between them, so union days earlier than the frame's own `x0` map to negative x,
are clipped by the svg viewport at x=0 rather than by the plot at `PAD.l`, and surface in the strip
between the two. Measured in the test: mid-travel the drawing runs from `x = -132.6` to `x = 428.6`
while the plot is `10 … 286`.

**The fix.** The mask's white is the PLOT RECT, not the viewBox, so outside it is black — hidden. The
fade bands sit inside that, and one element does both jobs: a drawing cannot be visible where it has
no business being drawn. Both edges carry `STROKE_OVERHANG`, for the same reason the fade bands do —
a stroke is centred on its path.

**The beads take the same mask.** They are part of the record, so they now clip to the plot and fade
at its edges exactly as the line they sit on; unmasked they stayed fully opaque over a line fading out
from under them, and a travel could strand one off the left edge. Only the beads: the gutter values
are the scale and live outside the plot, and the axis labels sit below it, so a plot-shaped mask over
the whole live layer would erase both.

**Tested** by asserting the mask's base rect starts at the plot rather than at 0 and stops at the
gutter, and that mid-travel — where negative coordinates demonstrably are drawn — nothing carrying one
sits outside a masked group. Confirmed to fail against the whole-viewBox base before being restored.

**2026-09-16 — both edges fade for the whole of a travel, whichever way it runs**

**The fault.** `fadeR` was `state.when === "last"`, and `state.when` is set BEFORE the motion runs —
so for every frame of a travel it is the DESTINATION, not what is on screen. A trip from last month to
this one therefore had the right-hand fade switched off on the very first frame. For the whole motion
the line was cut dead at the plot edge with a hard vertical stop, and content slid in against that
stop instead of emerging through a fade. Reported as two things — the mask vanishing for a moment, and
then the hidden half of the graph being drawn in as it slid — which are one fault seen twice.

**The rule now:** `fadeR = state.when === "last" || this.travelling`. A travel cuts content at both
edges the whole way across, so it fades at both; the resting answer is restored by the paint that ends
the motion. `travelling` is set only by `zoomTo()` (a window travel pans; a source morph does not, so
it keeps the resting fades) and cleared by `run()` alongside `animating`. A side benefit: `fadeR` is
now CONSTANT for the length of any travel, so `_maskSig` never changes mid-motion and `paintInto()`
reuses its nodes from the first frame to the last — no full replace, so nothing can flicker.

**And `staticStale()` had to learn about the mask.** It compared the two series arrays and the size,
which is everything the *drawing* depends on but not everything the STATIC LAYER does. Without the
mask in it, the paint that ends a travel took the live-only path and left the travelling mask — both
edges faded — on a window at rest that should fade one. `maskSig()` is now one expression, read by
`draw()` when it writes the mask and by `staticStale()` when it decides whether the mask on screen is
still the right one. The test caught this; I had not thought of it.

**Known and accepted:** at the instant a last→this travel ends, the right fade turns off in one step.
That is semantically right — you have arrived at the newest window and there is nothing further to
travel to — but it is a step, not a fade. Left as is; raise it if it reads badly.

**2026-09-16 — the right edge always fades; the cursor arrives and leaves**

- **Both edges fade, unconditionally.** The right one was keyed off the window, then off whether a
  travel was running, and every version was wrong in its own way — because the question it was trying
  to answer is not about the window at all. The record runs off the LEFT because the past is longer
  than the frame. It runs off the RIGHT because **the future is yet to be written**: the forecast does
  not stop at the horizon this tile draws, it is simply not claimed past it. Fading says exactly that,
  and it says it in every window, at rest and mid-travel alike. `travelling` is deleted — it existed
  only to paper over the conditional. The mask is now constant for a given size: written once and
  never again, which is one fewer thing that can flicker. `maskSig()` stays as the seam (it is how
  `staticStale()` knows the static layer includes the mask), now just `W × H`.

- **The cursor fades in and out** (`CURSOR_EASE = 0.45`, `_cursorFade`, `_lastDay`). Everything it
  draws — the line, the caption, the day under the axis, its own value in the gutter — shares one
  eased opacity on the same loop that grows a badge and moves that value. **A faster rate than
  `GROW_EASE`**: a cursor that took as long to appear as a badge takes to grow reads as lag between
  the tap and the answer, and the answer is the thing being waited for.

  **The fade-OUT is the half that needs machinery.** `state.at` going null is the *release*, not the
  disappearance — so the day it was on is kept in `_lastDay` and keeps being drawn at a falling
  opacity until there is nothing left. Without that there is nothing to fade: the thing being faded is
  already gone by the first frame of the fade. `held` is still tied to `state.at` alone, so nothing
  downstream thinks a released cursor is still held. When the fade reaches zero, `_lastDay` and
  `_curVal` are dropped, so the next arrival snaps to its own value rather than sliding in from the
  last one. The guide-label collision test now applies only while the cursor is *held*, so on release
  the guides come back over the same frames the cursor leaves in, rather than waiting for it to go.

- **A date-dependent test, found on the way and fixed** (`balanceChartAudit.test.js`). It took the
  LAST forecast day and assumed the run had predicted rows on it. Since the forecast gained a point
  per day — quiet days included — whether that holds depends on where today falls against the fixture,
  so it passed or failed by the calendar. It now asserts the invariant over *every* drawn future day,
  treating "nothing predicted here" as a real answer, plus one check that the run claimed something
  somewhere so the assertion cannot go vacuous.

**2026-09-16 — the right edge stops falling short of the plot during a travel**

**The fault.** `clipTo` sweeps continuously through time; the series carries one point per calendar
day. The last point that survives the `<= clipTo` filter is therefore always rounded down to a whole
day - often noticeably earlier than `clipTo` itself, by up to a full day's worth of pixels. `X()` maps
`frame.x1` (which equals `clipTo` exactly, by construction - `lerpFrame`'s `x1` and the `clipTo` passed
alongside it are both `e0*(1-k) + e1*k`) to the plot's true right edge regardless of whether any point
actually reaches that time. So the drawn curve fell short of the edge for the length of every travel.
It was invisible until the right edge started fading unconditionally: the fade assumes the record
reaches the edge it fades from, so the shortfall read as an early clip rather than a graceful one -
reported from the phone as "the right side gets clipped a little bit."

**The fix** (`paintFrame`). The frame's right edge is set to the actual last surviving point's own
date whenever that is earlier than the requested `frame.x1` - exactly what `frameOf()` already does at
rest, so a travelling frame and a resting one now agree on what "the edge" means: wherever the drawing
actually stops, never a point past it. `x0`/`y0`/`y1`/`lo`/`hi` are untouched; only `x1` is corrected,
and only when clipping is in effect.

**A pre-existing test had to change**, and it is worth recording why rather than just fixing it
quietly: `"the forecast retracts..."` held `frame` artificially fixed while only sweeping `clipTo`, to
isolate the content-retraction logic from frame geometry - a pairing `zoomTo()` itself never produces
(it always lerps both together). Its final assertion compared a `paintFrame` call using `clipTo` against
a hand-pre-filtered call with no `clipTo` at all, expecting byte-identical output; that equivalence
held only because clipping used to do nothing but drop points. It now also tightens the frame, so a
call that skips `clipTo` skips the tightening too, and the two are no longer the same question. Changed
to assert what the test actually means - that painting the same `(frame, clipTo)` pair twice is stable
- and a new test reproduces a REAL travel via `lerpFrame`/`zoomTo`'s own formula and asserts the drawn
line's rightmost x lands on `W - PAD.r` at every step, confirmed to fail against the pre-fix code.

**2026-09-16 — content is never trimmed for a travel; the mask does the whole job**

**Reported:** the previous fix closed the gap, but introduced a visible resize - the chart "resizes
itself back and forth" for the length of a travel. Both symptoms trace to the same root, and the
reader's question cut straight to it: *why do we need to remove the point? Can't we just assume it's
always there and masked off screen?*

**Why removing the point was never necessary.** `lerpFrame`'s own `x1` and the travelling clock
`clipTo` were computed from the identical formula over the identical numbers -
`e0*(1-k) + e1*k` - so `frame.x1` already equalled `clipTo`, exactly, at every k. Nothing needed
deriving. And the series is a STEP chart: `stepPath` draws each point's horizontal run out to the
NEXT point's own x before it turns, so the point just past the visible edge still draws its segment
past that edge on its own - the overshoot the mask needs already exists in the geometry, for free, as
long as that point is never removed from the array.

**What was wrong with both earlier attempts, now clear in hindsight.** Filtering content by
`date <= clipTo` removed exactly that overshoot point - the series is daily, `clipTo` is continuous,
so the filter always rounds down, and the line fell up to a day's pixels short of the true edge (the
gap). Then tightening `frame.x1` to match whatever survived the filter closed the gap by construction,
but that survivor is discrete - it changes only when a whole day drops out of the filtered set - while
the frame had been smoothly interpolated until then, so the picture's own domain jumped in visible
steps once per day boundary crossed (the resize).

**The fix removes code rather than adding it.** `paintFrame(content, now, frame)` drops the `clipTo`
parameter entirely and never filters `content` - the full `union()` of both windows is passed straight
through, unconditionally, every frame. `zoomTo()` drops its `edgeOf()` calls and the `clipTo` argument
it used to compute; `this.lerpFrame(f0, f1, k)` is the only per-frame work left. What retracts is
purely which part of the (always-whole) content falls inside the smoothly-lerped `[x0, x1]` domain;
the mask - already anchored to wherever `x1` maps in pixels, since the earlier fix in this same file -
hides the rest. Nothing about the frame or the content ever takes a discrete step.

**`edgeOf()` is kept**, though nothing in the component calls it any more: it is a small, correctly
named utility (`frameOf(a).x1` is the identical number by construction) that the tests use to build
the same `(f0, f1, k)` a real travel runs on, without duplicating that derivation inline.

**Tests.** The equivalence test that used to compare a `clipTo`-filtered call against a hand-pre-
filtered one is gone with the parameter it exercised. `"the forecast retracts..."` now measures
retraction the way the mask actually decides it - by counting, at each `k`, how many future points'
own dates fall within the current frame's `x1` - rather than counting SVG path commands, which no
longer shrink at all (the full path is always in the markup; only what is masked changes). A new test,
`"nothing is ever trimmed... the overshoot reaches the edge"`, asserts that at every step of a real
travel at least one drawn coordinate reaches to or past the plot's true right edge, and that the
frame's own `x0` moves in one direction only, never snapping back and forth - confirmed to fail against
the reinstated filter-based `paintFrame` before being restored.

**2026-09-16 — the balance readout: a live instrument on the sandbox**

`BalanceReadout.js`, on the sandbox above the bench. "The bank balances went rogue" has been answered
three times now by dumping a fixture and reasoning about it in a terminal, and every one of those
answers was about a day that had already passed — the capture is stale the moment it is written. This
is the same arithmetic against LIVE data, on the page, so the question can be asked when it is noticed.

**It is not a second model, and that is the whole discipline of it.** Every figure comes from the
function the tile itself uses — `Core.accountTypeOf` for what counts as spending, `reconstruct` for
the walk, the same UTC day boundary — so a disagreement between the panel and the tile is a bug in one
of them, not two readings of the same fact. The moment it re-derives something it stops being able to
answer the question it was built for.

**What it shows**, in the order the question is actually asked:

1. every account, its effective type, `current` and `available`
2. **balance today** — the anchor, spending accounts only
3. **postings today**, named and dated, with their sum
4. **balance at the last closed day** — (2) less (3)
5. netted, today (spending less cards)
6. what moved on the closed day itself, to reach that figure
7. **stored snapshot vs the walk**, per day, for three weeks — with the gap

**(7) is the rogue detector.** A snapshot is a reading taken at an instant and never revised; the walk
is derived from postings. A non-zero gap means they disagree about that same day, which has been the
whole argument every time. The tile stopped reading the stored series (see the entry on anchoring),
so this is now the only place that comparison is visible.

**It also flags the dates that disagree with each other.** `getDisplayDate()` prefers `frontendDate`
(a user backdating a categorised transaction); the walk uses `date`. Where the two differ, a reader
sees a posting on one day and the line step on another — which is exactly what a rogue balance looks
like from the outside — so the panel names it in red rather than averaging over it. `authDate` is
flagged the same way where it differs.

**Tested** (`balanceReadout.test.js`, 6 tests): today is the anchor and excludes savings and cards;
the closed day is today less today's postings, over two postings of opposite sign so a lost sign
cannot survive; the panel's ledger is the tile's ledger; a backdated transaction is flagged; and a day
only some accounts reported is not treated as an observation — otherwise the instrument built to find
invented gaps would invent one on the day an account started reporting.

**2026-09-16 — Plaid's own response, cached against a forced fresh read, live in the sandbox**

Requested to test a specific suspicion: is a rogue balance Plaid's own answer, or something the
mapping step between Plaid and this app did to it. New surface, server and client both:

- **`Connector.getRawAccounts(itemData)`** (`src/bankConnectors/BankConnector.js`) — a base method any
  aggregator can override to hand back its own response untranslated; the default says `unsupported`
  rather than being asked to invent a shape it doesn't have.
- **`PlaidConnector.getRawAccounts`** calls **both** balance-bearing Plaid endpoints and returns them
  side by side as `{cached, fresh}`. `/accounts/get` is the endpoint every balance in this app —
  including everything else in this same panel — is built from; Plaid serves it from its own cache,
  and their docs are explicit that it can run minutes to hours stale. `/accounts/balance/get` is a
  different, slower, rate-limited endpoint that forces Plaid to call the institution again before
  answering. **If the two disagree, the cached one is what has been on screen the whole time.** Wired
  through `BankAPI.getRawAccounts` → `model.getRawAccountsForUser` (per connection, one connector
  question, no different authorization than the existing `getAccountsForUser`) → the route
  `bankGetRawAccountsForUser` (`routes/index.js`, registered in `server.js`) → `ApiCaller` →
  `BalanceReadout`.
- **On the sandbox**, per connection: a table matching each account by Plaid's own `account_id` (not
  our hash — this is upstream of the step that computes it), `cached current` beside `fresh current`
  with the gap flagged, then both full raw JSON payloads for anything the table doesn't surface.

**A deploy is required for this to reach the sandbox as actually run** — `AppConfig.serverURL` points
at the deployed API by default, and the new route only exists once `sls deploy` ships it. Not run yet;
the code is written and the module-load check passes, but ship is an explicit gate.

**Tested** (`balanceReadout.test.js`, +2): the cached/fresh table renders both figures and flags their
gap; a connector with no raw response (Powens) says so rather than crashing on a shape it doesn't have.

**2026-09-16 — "which accounts count" and "current vs available, per account" — findings from live data**

Live numbers reported from the sandbox (six consecutive days, one account, summed across the reading's
own accounts):

    day         bank said    walk says    gap
    2026-09-16  $7,959.22    $5,959.22    $2,000.00
    2026-09-15  $8,459.22    $5,959.22    $2,500.00
    2026-09-14  $8,459.22    $6,459.22    $2,000.00
    2026-09-13  $4.62       -$1,995.19    $1,999.81
    2026-09-12  $4.62       -$1,995.38    $2,000.00
    2026-09-11  $692.13     -$1,995.38    $2,687.51

**This is two faults, not one, and the summed total was hiding the seam between them.** A roughly
constant ~$2,000 sits on every single day, six days running, never closing — that shape is not a
transaction the walk hasn't seen yet (which resolves the moment it posts); it is a constant OFFSET,
consistent with either an account that should not be in the spending sum being counted, or a specific
account's stored reading being stuck while the live one moves. Layered on top of that flat $2,000,
09-11 and 09-15 each carry an EXTRA few hundred dollars that the other days don't — that shape IS the
familiar one-transaction-posted-a-day-late pattern from earlier in this document, superimposed.

**Ruled out by reading the code rather than guessing:** the server never swaps `current` for
`available` — `BalanceSnapshot.MakeSnapshotFromAccount` stores `account.balance.current` verbatim, the
identical field `Core.getAccountsWithBalances()` reads live, both ultimately `ac.balances.current`
from the same Plaid response shape. No field-mapping bug exists in this codebase to explain the gap.
`observedByDay()` and `anchor()` also share the exact same `this.spending()` account list at render
time, by construction, so a "different accounts on each side" theory doesn't fit either — which is
what makes a STUCK PER-ACCOUNT SNAPSHOT (rather than a selection mismatch) the leading remaining theory.

**What was missing to actually find it: the sum couldn't be taken apart.** `observedByDay()` only ever
produced one number per day, across every spending account. Added:

- **the accounts table gained a `counted in anchor as` column** and an explicit `anchor = sum of every
  row marked "+ spending" (N accounts): $X` line — so an account nobody was thinking about, if that is
  the cause, is named next to its own balance rather than inferred from a bare type string.
- **`rawSnapshots()` and its table, "stored snapshots — current vs available, per account"** — every
  stored reading, one row each, unsummed, with `current − available` computed and flagged where
  non-zero (a pending hold, or the two fields disagreeing for any other reason). This is where the
  $2,000 lives if it lives on one account: the SAME account's row repeating an unchanging figure across
  many days, beside a DIFFERENT account whose numbers move normally, would say so directly.

**Not yet resolved** — this needs the live tables read against each other (which specific account's
row is flat at ~$2,000 across the six days, and whether its `current − available` is non-zero) to go
from "two faults, this shape" to a name and a fix.

**Tested** (`balanceReadout.test.js`, +1): the per-account snapshot table renders current beside
available with the held-back amount computed and flagged.

**2026-09-16 — "today" is read in the account's stored timezone, never the machine's**

**The decision:** *the last closing day anchor should be done on in the user account timezone.*

**What was wrong, precisely.** `ledgerToday()` read `new Date().getUTCFullYear/Month/Date()` — the
true UTC calendar day, which is deterministic and machine-independent, but is not the same day the
reader is living in. For anyone west of Greenwich, UTC crosses midnight several hours before the
reader's own evening does — at UTC−7 (Pacific), from about 5pm local onward, UTC has already rolled
into tomorrow. Reported live at 19:36 Pacific: the tile's own "today" already read the 17th while the
reader's evening was still the 16th. That is not a today-only edge case — it is true every single
evening, for as many hours as the offset, for every reader west of UTC. And it directly undid the
"anchor on the last CLOSED day, not today" decision made earlier the same session: "closed" was being
computed in the wrong calendar, so the anchor landed on the reader's own still-open day, not yesterday.

**The fix reuses an existing, already-correct pattern rather than inventing a new one.**
`businessCalendar.js` solved exactly this for the stream predictor's own calendar-day reads, and its
own header states the principle plainly: *"a prediction must not change because it was computed on a
laptop in a different timezone"* — the offset has to come from the account, never the machine.
`calendarDay(date, offsetHours)` shifts an instant by the account's own offset before reading its UTC
calendar fields, giving back the day the reader would see on their own statement wherever this code
happens to run. `ledgerToday()` (`BalanceChart.js`) and `utcMidnight()` (`BalanceReadout.js`, the
panel this exact bug was found through) both now call it, reading `Core.getUserData().timeZoneOffset`
— defaulting to 0 (pure UTC) when the account has not stated one, the same default `calendarDay`'s
other caller already uses, so every existing reading is unchanged until an account sets its own.

**Not touched:** the UTC-midnight convention for transaction DATES themselves. A bank date is a date,
not an instant, and is already stored correctly as UTC midnight regardless of timezone (see
`ledgerToday()`'s own long-standing comment on why day keys must stay in UTC). This fix is specifically
about which of those fixed days the CURRENT INSTANT falls into - a question with a different answer in
every timezone at once, and the one place the machine's clock had been standing in for the account's.

**Tested**, in both files, by installing a fake `Date` whose "now" is fixed at exactly the boundary
reported live (2026-09-17T02:36Z, Pacific evening of the 16th) and asserting `ledgerToday()` /
`utcMidnight()` return the 16th at offset −7 and the 17th at the default (unset) offset — confirmed to
fail against the pre-fix UTC-only computation in both files before being restored.

**2026-09-16 — the production tile now sees uncategorized transactions; the sandbox always did**

**Reported from two screenshots of the same account, at the same moment: visibly different shapes.**
The sandbox's own instrument was right; `StreamAuditView.js`'s copy was not.

**The cause.** `MasterAuditView.render()` filters `auditedTransactions` to `.filter(t => t.categorized)`
before ever handing anything to `MasterStreamAuditView` - a real requirement for the projection graph,
the money-flow page, and every per-stream analysis, all of which read a stream *off* a transaction and
have nothing to read where `streamAllocation` is empty. `MasterStreamAuditView` then passed that SAME
already-filtered array straight through to `<BalanceChart transactions={...}/>`. `BalanceChart` itself
never filters by `categorized` - `ledger()` only checks the account hash, and `reconstruct()` just sums
`t.amount` by day for whatever it is handed - so the walk was faithful to a ledger that was quietly
missing every uncategorized transaction on the covered accounts. Any day the walk crossed one, the
production tile's reconstructed past parted from the truth by that amount, and stayed parted from
there on. The sandbox never had this fault: its own comment already states the reasoning that applies
here word for word - *"ALL of them, categorised or not... the balance bench needs the others, because
money that no stream claims is exactly what its residual row exists to measure."* The balance WALK
needs exactly the same thing, for exactly the same reason - it is not a stream question at all.

**The fix carries a second, unfiltered prop rather than widening `auditedTransactions` itself.**
Silently handing the analysis machinery uncategorized rows was the more dangerous failure mode -
`groupByStream()` and friends already guard on `t.categorized` explicitly, which would have masked a
mistake here rather than surfacing one. `MasterAuditView` now passes `allTransactions={this.props.
auditedTransactions}` (its OWN unfiltered input) alongside the existing filtered `auditedTransactions`
prop; `MasterStreamAuditView`'s `<BalanceChart>` reads `this.props.allTransactions` instead. Every
other consumer of `auditedTransactions` - the projection graph, `MoneyFlowChart`, the per-stream
analyses - is byte-for-byte unchanged.

**Not tested with a new mount test.** `StreamAuditView.js` has no existing test file and no fixture
support for its dependency graph (`ReportingCore`'s config, `Core.getMasterStream()`, the projection
and money-flow pages) in this suite; standing one up from nothing for a two-line prop-wiring change
would be a heavier, more fragile addition than the fix it is meant to guard. The arithmetic this
actually depends on - that `BalanceChart.ledger()`/`reconstruct()` include every transaction they are
handed regardless of `categorized` - is already exhaustively covered in `balanceTile.test.js`; the only
new risk surface here is which array reaches the component, and that is visible directly in the diff.
Flagged rather than silently skipped.

**2026-09-16 — six UI tweaks: filled forecast, no dotted guides, a live intersect line, a rail label,
a resting default, full month gridlines**

- **The forecast is filled too, at half the record's own opacity.** One fill used to run under the
  whole curve, record and claim treated alike, so a reader could not tell where the known ends and the
  guess begins without finding the dashed line first. `areaActual`/`areaFuture` are two fills now,
  split at the same seam the line already splits at, closed to zero on both ends so they share one
  seam pixel rather than gapping or doubling there. `PLANE.projectedFill = PLANE.planned*0.55` is
  defined as a fraction of the record's own fill rather than a second number to keep in step by hand.
- **The high/low guide lines are gone.** The two horizontal dashes said "here is where this sits" for
  a fact the curve's own shape already says; only their VALUES remain, in the gutter, as before.
- **A dynamic dotted line to whatever reading is showing, ending on a small dot where it meets the
  curve.** Reintroduces the "lead line" removed earlier this session, deliberately: a reader following
  the line down from the gutter needs somewhere to land. Drawn at the SAME eased height (`vy`) as the
  number beside it, so the dot and the number settle onto the curve together.
- **"Balance" labels the top of the right rail**, unconditional, in the live layer beside the gutter
  values it names.
- **The current day's balance is shown by default, at rest.** `drawLive()`'s day resolution gained a
  third branch: interactive (held, or fading via `_lastDay`) still wins when there is one; at true
  rest it now defaults to TODAY's own point, if today is in the window at all. Everything that answers
  a day - the dotted line, the intersect dot, the gutter value, the date under the axis - is on screen
  whenever a day resolves, held or default alike; ONLY the vertical cursor line and the movement
  caption are truly interactive, and only those two still fade with `_cursorFade` (the now-line already
  marks today's own x at rest, so a second vertical line there would be redundant). Releasing the
  cursor no longer leaves `_curVal`/the reading at nothing - it settles back to today's own value.
- **Full vertical lines for the 1st and the 15th**, semi-transparent (0.22), replacing the 3px tick
  nub that used to mark them only at the very bottom - kept fainter than the now-line's own 0.55 so
  today stays the one line that reads as an event rather than a ruling.
- **The date under the axis is now shown at rest too** - a direct consequence of the resting default:
  once a day resolves (held or default), its date label draws regardless of which reason resolved it.

**Tests updated** (`balanceTile.test.js`) to match the new resting behaviour rather than testing
against it: the "no lead line" test is now "a dotted line to a dot on the curve, on by default"; the
fade-out test asserts `_curVal` settles back to today's own reading rather than to `null`; the easing
test asserts against the resting value it now eases FROM rather than assuming nothing was showing
before the first touch. All three updated assertions read the DOM markup as jsdom actually serializes
it (`></line>`, not the self-closing `/>` the source string writes) rather than the literal source.

**2026-09-16 — two follow-ups from the UI tweaks: the axis label suppression, and the dash that stayed**

**1. Axis suppression only ever keyed off `this.state.at`.** The 1st/15th tick label suppression
("a tick under the cursor's own date gives way to it") was written before the resting default existed,
so it only cleared space for an ACTIVELY held cursor's date. Once the resting default started showing
today's own date label unconditionally, a 1st/15th tick close to today collided with it at rest - which
is what the screenshot showed as "Se[15][p16]" garbled text. `axis` now builds AFTER the day resolves
(held, fading, or resting-default alike) and suppresses against `dateX` - whichever date label is
actually on screen - rather than against `this.state.at` specifically. `"the 1st and the 15th are
always marked"` updated to exclude a 1st/15th within the SAME pixel clearance of today, computed the
same way the component computes it (pixels-per-day off the real frame) rather than a re-guessed day
count; confirmed the "gives way" test still catches the suppression being disabled.

**2. The forecast line was still dashed.** The fill split (`areaActual`/`areaFuture`, previous entry)
was the right idea but not the whole of what was asked: "the prediction line should be filled, but
semitransparent" meant the STROKE too, and `lineFuture` was left with `stroke-dasharray` untouched.
It is solid now - `STROKE.dash` is unused and left as a stale record of what it replaced. What still
marks it as the claim rather than the record: the fill split above, the stroke's own lower opacity
(`PLANE.projected`, unchanged at 0.5 against the record's implicit 1), and a thinner stroke width
(`STROKE.projected` = 2 against `STROKE.actual` = 3) - three quiet devices instead of one loud one.
Two tests keyed on the dash pattern directly (`"a settled month draws no ... dashed projection"`,
`"... a travel still draws it dotted"`) - both retitled and rewritten against what actually
distinguishes the line now: a stroke count of exactly one `stroke="url(#bal-ramp)"` for a settled
month (no future to draw a second one from), and the future line's own thinner, fainter signature for
the travel case.

**2026-09-16 — weekend bands tried and reverted; the resting reading freezes for a travel; "Today (date)"**

- **Weekend bands: built, then reverted the same turn.** Replacing the 1st/15th vertical lines with
  low-opacity Saturday/Sunday bands was implemented and tested (`weekendBands` in `draw()`'s masked
  body), then the request changed to dropping the idea entirely. The 1st/15th's full-height lines stay
  removed either way - only the short tick + date label under the axis marks them now, as before this
  UI-tweaks round started.
- **The resting reading now freezes during any animation, rather than sliding under it.** Reported as
  the dotted balance line "catching" the animation when travelling back to last month. The cause: the
  resting default resolves today's own point out of `all`, which during a travel is the UNION of both
  windows, positioned through `X()`, which is built from a FRAME being interpolated frame to frame -
  today's own x under that moving frame is not the fixed point it is at rest, so the dotted line and
  its dot visibly slid and snapped as the frame moved. The resting-default branch is now skipped
  outright while `this.animating` is true (set by both `zoomTo()` and `morphWith()`) - nothing it draws
  answers a question worth asking mid-motion anyway, since the reader is watching the curve travel, not
  pointing at a day. It reappears, settled, the instant the travel's own final `paint()` runs.
- **The resting default reads "Today (date)"; dragging still reads the date alone**, even where the
  finger lands on today's own day - "Today" is a claim about WHY that day is being shown (nothing was
  touched) rather than about which day it is, so it is wrong the moment a finger is actually on it,
  however coincidentally it agrees. `dayLabel` is built from the existing `interactive` flag already
  used to gate the caption and the vertical cursor line, so this needed no new state.

Both fixes verified against the pre-fix code (disabled, watched the new test fail, restored) before
being left in place.

**2026-09-16 — less contrast-stealing forecast line; the held badge paints in front of the cursor**

- **`PLANE.projected` 0.5 → 0.4.** More contrast between the forecast's stroke and the record's
  (implicitly full-opacity) one, on top of the thinner width and the lighter fill already
  distinguishing them.
- **The badge the cursor is actively on now paints after the cursor's own line and caption, not
  before.** Every badge used to live in one masked group, painted early in the svg's own document
  order - so the cursor's vertical line and caption, drawn later, ran straight over whichever badge
  had just grown under the finger. It is pulled out of that group (`beadsHeld`, split from `beads` by
  the same `heldKey` the grow-order already used) and painted in a second masked group at the very end
  of the live layer - after `passive` and `shown` both - so holding a badge now puts it in front of
  the cursor rather than leaving the cursor drawn over it. Scoped to `this.state.at` (active drag)
  specifically, matching "when the cursor ACTIVATES a badge" - the resting default and the release fade
  do not reorder anything.

**2026-09-16 — "Today (date)" whenever the day shown is today, not only at rest**

Reversed the previous entry's own decision, on request. `dayLabel` no longer keys off `interactive` -
it keys off whether the day actually being answered for IS today (`dayIdx(day.date) === dayIdx(now)`),
regardless of how that day came to be shown. Dragging onto today now reads the identical "Today (date)"
resting already showed; dragged anywhere else it is dropped, honestly, because that day is not today
either way. Confirmed by first reproducing the reported gap directly (a throwaway probe mounting the
real component and touching today via the same path a finger would) before writing the fix, then
verified the updated test fails against the reverted code before being restored.

**2026-09-16 — the title reads "{account} balance {when}"**

Was "Balance {source}, {when}" ("Balance spending, this month"). `sources()` now names the words for
the sentence itself, not as a generic label: `"Checking"` / `"Checking+ cards"`, leading with the
account being read rather than with the word "spending". The template moved with it:
`{sourceButton} balance {whenButton}` - "Checking balance this month" / "Checking+ cards balance this
month". Nothing downstream keyed on the old strings for anything but display - `source()`'s own
comparisons run on `SPENDING`/`NETTED` (the constant keys, first element of each pair), never on the
label text - so this was a wording change with no logic behind it to keep in step.

**2026-09-16 — "After-cards", hyphenated**

Unhyphenated ("After cards balance this month") misreads as a pause after "After" rather than a
compound modifier on "balance". Hyphenated it reads as intended: "After-cards balance this month".
