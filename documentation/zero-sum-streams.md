# Zero-Sum Streams

> Part of [`documentation/`](context.md) — see that file for what belongs here and how it's written.

## What this is

Most streams are budgets: an expected amount per period, and reporting on how close you came. A
**zero-sum stream** is not that. It is a stream where every debit is expected to be cancelled by a
credit later on — money fronted and paid back, an expense shared with someone, a purchase that gets
returned. Its correct state is not "under budget", it is **empty**.

That changes what the software has to do. A budget stream only needs to add transactions up. A
zero-sum stream needs to *pair them off*, so it can answer the only question that matters: which
debits are still waiting to be reimbursed?

`stream.isZeroSumStream` is a per-stream flag, toggled in the stream audit sentence
([`StreamAuditView.js:251`](../src/components/StreamAuditView.js#L251)) and stored on the stream
model ([`model.js:58`](../src/model.js#L58)). Turning it on switches the stream's transaction feed
into a reconciliation view and makes the stream eligible for the refund reconciliation below.

## Who owns which half

This file and [`amazon-transaction.md`](amazon-transaction.md) meet at exactly one property:
`transaction.amazonOrderDetails`.

| Concern | Owner |
|---|---|
| Scraping, ingestion, storage, and **matching any bank transaction to an Amazon order** — charges *and* refund credits alike, the four passes, the opposing sign conventions | [`amazon-transaction.md`](amazon-transaction.md) |
| Netting debits against credits inside a zero-sum stream, finding the charge a refund belongs to (**both** rails, Amazon and generic), applying the move or split, and the reconciliation UI — **this file** | this file |

The rule of thumb: attaching an order to a transaction is Amazon's half and stops at
`amazonOrderDetails`. Deciding what that annotation *means* for the budget is this half. Both halves
happen to live in [`transactionMatching.js`](../src/transactionMatching.js) — one file, two systems,
split at the section comment.

---

## How it works

### 1. Pairing transactions inside the stream

`reconcileZeroSumStreamTransactions(txnArr, stream)`
([`transactionMatching.js:14`](../src/transactionMatching.js#L14)) returns
`{ matches: [{debit: [...], credit: [...]}], unmatched: [...] }`.

Transactions are split into debits and credits by `moneyInForStream(stream)` — **not** by
`transaction.amount`. That distinction is load-bearing: a transaction can be split across several
streams, and what counts here is the portion allocated to *this* stream. A transaction allocated
entirely elsewhere reports `0` and is neither.

Matching then runs sum-to-zero: a group is a match when the amounts of its members, evaluated
against this stream, cancel to within a tenth of a cent. Three shapes are tried, in this order, each
only on what the previous ones left:

| Shape | Meaning |
|---|---|
| one credit ↔ one debit | the ordinary reimbursement |
| one credit ↔ *n* debits | one repayment covering several fronted expenses |
| one debit ↔ *n* credits | one expense paid back in instalments |

`utils.combine(pool, 2)` enumerates every subset of two or more, so "*n*" is genuinely any size, not
just pairs. Where several groups would cancel, the earliest by summed date wins.

The whole thing runs four times with a widening date window — 1, 5, 8 then 16 weeks — first
requiring the credit to fall *after* its debit, then a second time reversed for the case where the
money came back before the expense posted. Tightest window first, so a coincidence far away never
steals a match from the obvious one nearby.

Savings and interest-income streams are skipped outright: their transactions are transfers, and
"cancelling out" means something different there.

### 2. The Amazon-aware pass

After the sum-to-zero passes, one more pass runs
([`transactionMatching.js:59`](../src/transactionMatching.js#L59)): any leftover credit and leftover
debit carrying the **same `orderNumber`** are paired, whatever their amounts.

This exists because an Amazon order can be paid partly by card and partly by gift card. The bank sees
only the card portion, so a refund for the whole item does not cancel the debit it belongs to — the
sum-to-zero test can never fire, and yet the two transactions unquestionably belong together. The
order linkage is stronger evidence than the arithmetic, so it gets the last word.

### 3. Finding the charge a stranded refund belongs to

The common failure mode is behavioural, not technical: you buy something, categorise it to
Groceries, return it a month later, drop the refund credit into the zero-sum stream — and never go
back to revisit the original charge. The credit now sits in the stream with nothing to cancel it,
and the stream will not net out until the charge, or the refunded portion of it, moves in beside it.

Two rails find that charge, in descending order of confidence. Both emit the same candidate —
`{credits, debit, amount, mode}` — so that one writer applies either.

A candidate debit must satisfy the same guards on both rails:

- `amount < 0` — it is the charge, not another refund;
- `moneyInForStream(stream) === 0` — it is **not already in this stream**, i.e. it really is the
  un-revisited charge;
- one of its allocations is large enough to have funded the refund — see below.

#### What inside the charge funds the refund

A charge is frequently *already* split across streams before any refund arrives. `getRefundFunding`
([`transactionMatching.js`](../src/transactionMatching.js)) decides what pays for the return, and
there are two answers:

**The whole transaction**, when the refund equals the charge. Everything came back, so every share
of it moves to the refund stream regardless of how many streams it was split across — a $12.06
Amazon charge booked as $8.00 of Repair/replacements and $4.06 of Medical, refunded in full, comes
back in full. Nothing here reasons about shares at all, which matters because *no* individual share
of that charge is large enough to fund a $12.06 refund.

**One share**, when the refund is partial: the **smallest share still large enough to contain it**.
A $122.03 Columbia charge booked as $87.03 of Repair/replacements and $35.00 of Emile, refunded
$54.95, comes out of the $87.03 — the $35.00 share could not have produced it. Smallest-that-fits
rather than largest or first, because it is the least disruptive reading: it leaves the bigger
shares alone, and in practice it is usually the only share that fits at all.

When neither applies the charge is disqualified. In particular a charge whose *total* covers the
refund but whose every share is smaller is left alone: the refund came from one part of the
purchase, and spreading it back across several is a guess with nothing behind it.

This replaced an earlier `streamAllocation.length === 1` guard that skipped any already-split charge
outright. That was wrong rather than merely narrow: a split charge is the *normal* state of a
partly-refunded purchase, so the guard rejected exactly the cases the feature exists to handle.

#### The Amazon rail — order number

`suggestAmazonReturnSplits` ([`transactionMatching.js:139`](../src/transactionMatching.js#L139))
groups stranded credits by the `orderNumber` on their `amazonOrderDetails` and looks for the charge
carrying the same one. `amount` is the sum of *all* that order's stranded credits, so several refunds
against one charge resolve in a single write rather than one at a time.

**An order billed as several charges is the ordinary case, not an ambiguous one.** Two shipments, or
a card-plus-gift-card split, produce two bank debits carrying the same order number, and only one of
them may be refunded. So the candidates are narrowed by amount before ambiguity is declared:

1. discard any charge with no share large enough to have funded the refund;
2. if exactly one of the rest matches the refund **exactly**, that is the source;
3. otherwise, if exactly one charge remains feasible at all, that is the source;
4. otherwise refuse.

Only step 4 is a real ambiguity — two charges that could equally have funded the refund. Counting
candidates before looking at amounts, as this originally did, called every multi-charge order
ambiguous and left those refunds stranded for good.

#### The generic rail — merchant, amount and proximity

`suggestRefundMatches` ([`transactionMatching.js:187`](../src/transactionMatching.js#L187)) handles
everything that is not Amazon: a Lululemon charge and a "Refund: Lululemon" credit that arrives
three weeks later. It runs **only on the designated refund stream** (see below) and only on credits
the Amazon rail did not claim. Its tunables live in `refundMatchingConfig` at the top of the file.

A credit matches a charge when the **merchant keys** match, the credit is not older than the charge,
and the gap is within `maxDaysBetweenChargeAndRefund` (90 days; the longest gap in real data is 37).

A merchant key is the description lowercased down to its alphanumerics with every separator removed
— `Carter's` and `Carters` both become `carters` — and with tokens that mix letters and digits
dropped, since those are reference codes rather than names. Two keys match when **one is a prefix of
the other**, not when they are equal: banks truncate (`Amazon Reta*` for `Amazon Retail`) and append
store numbers. Three characters is the floor, because `CVS` is a real merchant.

Where several charges qualify, an **exact-amount** one wins over a merely recent one — amount
equality is much stronger evidence than proximity. Failing that, the most recent wins. A charge
claimed by one refund is not offered to the next.

Three things are excluded outright:

- **Amazon, matched or not.** Order numbers are the only trustworthy link for it, and "Amazon"
  appears on so many charges in any 90-day window that matching on the name would mispair. An
  unmatched Amazon refund stays stranded rather than being fitted to the nearest Amazon charge.
- **Any merchant seen on a zero-sum stream that is not the refund stream.** A credit card tracked on
  its own zero-sum stream produces credits that look exactly like refunds — a credit cancelling an
  earlier debit of the same name — and are not. `Core.getMerchantKeysOnOtherZeroSumStreams`
  ([`core.js:486`](../src/core.js#L486)) collects those keys once per run.
- **Credits already tagged as transfers** (`pairedTransferTransactionId`).

There is deliberately **no requirement for a "Refund:" prefix**, and no same-account rule. Both look
like free safety and neither survives contact with the data: two of the real non-Amazon refunds
arrive described simply `Carter's`, and a Target charge on one household card was refunded to the
other. The credit already being categorised into the refund stream is the assertion that it is a
refund; that is what the rail trusts.

#### Designating the refund stream

The generic rail needs to know which zero-sum stream is *the* refund stream, since its whole
exclusion rule is "seen on a different one". That is `userPreferences.refundStreamId`, set from the
stream-audit sentence ([`StreamAuditView.js:254`](../src/components/StreamAuditView.js#L254)) and
resolved by `Core.getRefundStream` ([`core.js:478`](../src/core.js#L478)).

It is a user preference rather than a stream property because it is single-valued — designating a
stream clears whichever held it before — and because `userPreferences` is a free-form object on the
server, so no backend change was needed. **With nothing designated the generic rail is inert.** That
is the interlock: no refund stream, no non-Amazon writes.

### 4. Applying the move or the split

`Core.applyRefundReconciliationIfNeeded` ([`core.js`](../src/core.js)) is the only caller that acts
on either rail's suggestions. It walks the stream tree for every `isZeroSumStream`, runs step 1 over
the stream's categorised transactions, feeds what is left over to the Amazon rail and then the
generic one, and rewrites the charge's allocations.

When the whole transaction funds the refund, the charge is replaced by a single allocation to the
zero-sum stream and its previous split is discarded — all of it came back.

Otherwise the rewrite touches **only the funding share**. Every other share of the charge is copied
across untouched, the refunded amount is moved out of the funding share into the zero-sum stream,
and whatever is left of that share stays where it was:

| | Before | After |
|---|---|---|
| Repair/replacements | −87.03 | −32.08 |
| Emile | −35.00 | −35.00 |
| Returns | — | −54.95 |

`mode` is descriptive rather than structural: `move` when the refund consumes its funding share
whole, `split` when it takes only part. The one thing it changes is that a fully consumed share is
**dropped rather than written as zero**. That matters more than it looks — a zero-amount allocation
is junk in the data, and before `getFundingAllocation` existed it also left the charge looking
already-split, which the old guard then treated as permanently ineligible.

The remainder is derived by subtracting the rounded refund from the share rather than being rounded
independently, so the allocations always sum back to the transaction amount — the server rejects a
categorisation whose allocations do not
([`Categorization.js:33`](../../src/model/Categorization.js#L33)).

**The write is self-terminating, and that is the design.** Once made, the charge's
`moneyInForStream(stream)` is no longer zero, so on the next run step 1 pairs it against the refund
credit and step 3 no longer considers it. The stream nets out, and repeated runs are inert.

It is driven by `Core.refreshTransactionReconciliation` ([`core.js`](../src/core.js)), which fires
after an Amazon order refresh and after any transaction fetch — so it runs unprompted, in the
background, whenever new data lands. `MissionControl` listens for the result and forces a full
re-render rather than a state bump when something was actually written
([`MissionControl.js:41`](../src/components/MissionControl.js#L41)), because money has moved between
streams and the cached reports are stale.

When a refund is *not* reconciled, `appGlobals.explainRefundReconciliation()` prints, for every
stranded credit, each plausible charge and either `ELIGIBLE` or the specific guard that rejected it.
It reports the guards rather than re-deciding, so what it prints is what the rails actually saw.

### 5. What the user sees

`StreamObservationPeriodView` ([`StreamObservationPeriodAnalysisView.js:23`](../src/components/StreamObservationPeriodAnalysisView.js#L23))
runs step 1 again, independently of `Core`, purely for display — over the analysis period's
transactions rather than the whole categorised set. The two runs share no state; each computes what
it needs.

The presence of a reconciliation result changes the feed
([`AnalysisView.js:380`](../src/components/AnalysisView.js#L380)):

- **Matched credits are hidden.** A closed loop is not news; the debit stands for the pair.
- **Every remaining line gets a status dot**, whose colour and tooltip say where it stands: green
  *Refund complete*, amber *Refund pending* (a debit still waiting), grey *Unmatched refund* (a
  credit with nothing to cancel).
- **The period aggregate is shown with an explicit sign**, unlike a budget stream — the number is a
  net balance, and the direction is the whole point.

Clicking a line stamps its matches onto `txn.reconciliation`, which `TransactionView` renders under
the transaction tile: one "Refunded on …" row per credit, or a single placeholder — *Awaiting refund*
on a debit, *Missing matching debit* on a credit.

**On an Amazon charge split by item, the refund is shown on the item instead of on the charge.** An
item allocated to a zero-sum stream is one that went back, and that is the whole of what records it —
so the amber "expected" state needs no reconciliation data and appears everywhere, the queue's dialog
included. The green "arrived" state does need it, and a credit is attributed to an item only when
exactly one item's price matches its amount; two items priced alike are not distinguishable, and
naming the wrong one would put *Refunded* under a picture of something still owned. Where the items
cannot be told apart — or where no reconciliation has been computed — the charge-level strip above is
what shows, which is the older and less specific statement rather than a wrong one. See
[`amazon-transaction.md`](amazon-transaction.md) §8.

**On any other split charge, the refund is shown on the allocation line that carries it.** Same three
states, same fallback, an amount where the picture was — but the rule joining a credit to a line is far
stricter, because nothing joins them for us:

- An Amazon credit is tied to its charge by the order number, which is what licenses matching it against
  *combinations* of items: a shipment really is a set.
- Nothing ties a credit to an ordinary debit. The date cannot — a refund posts days or weeks later, by
  construction. The merchant name cannot — it is truncated, prefixed and shared across unrelated
  purchases. And the automated pairing above is deliberately fenced off from exactly these cases.

So **the reader makes the association and the app only confirms it.** Putting a share of the charge on a
zero-sum stream *is* the claim that this much is coming back; a credit settles that line when its amount
equals the line's **to the cent**, and nothing else does. There is no subset matching here: a line is one
number somebody typed, not a set, and combining lines to reach a credit's total would invent the very
association the rule refuses. Where two lines could take the same credit the first does — they are worth
identical money, so there is no wrong answer to protect against, only a refund that refusing would hide.

A credit matching no line produces **nothing at all** on the charge, not even the strip: saying a refund
arrived would be the association just declined. It stays visible as its own transaction in the feed, which
is where an unassociated credit belongs.

Two consequences follow from the amount being the reader's own input rather than a fact from an order:

- The match re-runs against the amounts **currently in the fields**, not the saved allocation, so a line
  comes apart from its credit as the amount is typed away from it and settles again when it returns.
- A settled line keeps **both** of its controls, where a settled Amazon item row gives up its label and
  dropdown. The rule is the same — what gives way is what is no longer a choice — but an item's price came
  from the order and a line's amount did not. A read-only settled line would trap a mistyped amount that
  happened to match, with no way back.

One line is enough, and that is the point rather than an edge case: a bill you expect back in full — a
medical charge on a reimbursement stream — is a single allocation, and it is the commonest shape this
serves. A marker there says something the headline does not, because the headline says what the charge
cost and the marker says the money is coming back. As with items, the charge-level strip stands down
wherever the rows carry the refund, and the headline nets what has arrived. `RA-1` … `RA-7` cover the
rule.

### 6. Tests

`RA-1` … `RA-7` cover refunds on allocation lines: the exact-amount rule and the cent that breaks it,
an ordinary stream carrying no refund state, two identical lines against one credit, a credit equal to two
lines combined settling neither, and a transaction with no reconciliation reading as expected.

`ZS-1` … `ZS-24` in [`transactionMatchingTest.js`](../src/tests/transactionMatchingTest.js) are
fully mocked and run in the browser console from `clientTestRoutine.js`.

`ZS-1`…`ZS-5`, `ZS-16`…`ZS-19` and `ZS-23` cover the Amazon rail: the 1:1 match, the gift-card case, the
stranded refund, several refunds against one charge, the refund whose charge predates the loaded
window, the full refund that must move rather than split, and the three multi-charge outcomes —
resolved by exact amount, resolved by feasibility, and genuinely ambiguous, plus the real order that
needs both the multi-charge narrowing and the whole-transaction rule at once. `ZS-6`…`ZS-15`,
`ZS-20`…`ZS-22` and `ZS-24` cover the generic rail: key normalisation, the move and split outcomes, exact-amount-beats-recency,
the window boundary, both exclusions, the missing marker, the guards, one charge not being claimed
twice, and the funding outcomes — the already-split charge, the smallest sufficient share winning, a
share consumed whole, and a fully refunded split charge moving whole.

Every generic-rail scenario is taken from a real row of the user's refund-stream history rather than
invented, and `ZS-3` is a real production Amazon order kept verbatim.

---

## Key decisions

**Pairing is by `moneyInForStream`, never by `amount`.** A split transaction belongs to several
streams at once, and only its share of *this* stream may take part in the arithmetic. Using `amount`
would work until the first split transaction and then be quietly wrong forever.

**Order linkage outranks arithmetic, but only as a last pass.** The Amazon-aware pass can pair
transactions whose amounts do not cancel, which is exactly the licence a matcher should not be given
lightly. It runs last, on leftovers only, so it can never pre-empt a match the arithmetic would have
found on its own.

**The two rails are held to different standards, on purpose.** An order number is proof; a merchant
name and a date are an inference. So the Amazon rail refuses whenever two charges of the same order
could equally have funded the refund, while the generic rail falls back to the most recent — a
weaker bar, accepted because non-Amazon refunds are rare, because the money stays inside the budget
and is correctable, and because two charges alike enough to be confused are usually alike in amount
too, which makes the choice between them moot.

**Ambiguity is decided on amounts, not on counts.** Having several candidate charges is not the same
as being unable to tell them apart, and conflating the two is what made multi-charge Amazon orders
unfixable in the first version. Both rails narrow by amount first and only then ask whether what is
left is still ambiguous.

**Ambiguity is still a reason to stop where it can mislead.** A refund with no charge in range, or
one whose merchant appears on another zero-sum stream, produces no suggestion at all. The cost of
skipping is a stream that does not net out and a grey dot; the cost of guessing is real money
silently allocated to the wrong stream, discovered months later if ever.

**The split is applied automatically, without asking.** It is the one place in the app that
re-categorises money with no user in the loop, and it is justified by the guards above being narrow
enough that a candidate is effectively unambiguous. Loosening any of those guards changes that
bargain, and should not be done without putting a confirmation in front of it.

**A charge can only be reconciled once.** `moneyInForStream(stream) === 0` disqualifies a charge that
has already funded a refund, so a second refund arriving later against the same charge is not
handled automatically — several refunds arriving together resolve in one pass, arriving apart they
do not. Lifting this means deciding how much of the charge is still unrefunded, which needs a record
of what an earlier pass already took, and there is nowhere to put one.

**A partial refund comes out of one share of a purchase, never out of the purchase in aggregate.**
That is the assumption behind picking a single funding allocation and refusing when none fits. It is
what makes the arithmetic safe on a charge that was split for reasons unrelated to the return, and
it is why a charge whose total covers a partial refund but whose every share is smaller is left
alone. A refund for the *whole* charge is exempt: there is nothing to attribute, so it takes
everything.

**Heuristics were chosen against real history, not from first principles.** Requiring a "Refund:"
prefix, requiring the same account, and comparing merchant names word-for-word all look like obvious
safeguards and all three were rejected because replaying two years of real refunds showed each one
losing correct matches while preventing none. The 90-day window, the three-character key floor and
the prefix comparison are calibrated the same way. Re-tune them against data, not intuition.

---

## Boundaries

- **The auto-split only ever sees refunds that are already categorised into a zero-sum stream.** An
  uncategorised refund, or one filed anywhere else, is invisible to it. The user's part of the
  workflow is unchanged: file the refund, and the charge follows.
- **The generic rail runs only on the designated refund stream.** Other zero-sum streams get
  sum-to-zero pairing and the Amazon rail, nothing more. Without `refundStreamId` set, it does not
  run at all.
- **Skips are silent.** An ambiguous or out-of-window candidate produces no log, no banner and no
  suggestion — only the grey dot in the feed, which the user has to go and look at.
- **There is no undo.** The split is written straight to the server and does not go through
  `HistoryManager`; the only trace of the decision is a `console.log`.
- **The stream is not made to net out — it is only helped along.** Nothing forces a zero-sum stream
  to balance, and nothing prevents an unbalanced one from being reported. Reconciliation is
  bookkeeping assistance, not an invariant the app enforces.
