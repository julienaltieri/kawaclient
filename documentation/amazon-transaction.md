# Amazon Transactions

> Part of [`documentation/`](context.md) — see that file for what belongs here and how it's written.

## What this is

Bank statements describe an Amazon purchase as `AMAZON MARKETPLACE` and a number. That is useless for
budgeting: one charge can cover four unrelated things, and the categoriser has nothing to work with.

This system closes that gap. A Chrome extension reads the user's own Amazon order pages and ships
what it finds to Kawabudget, which matches those orders back onto real bank transactions and uses the
items — pictures, descriptions, per-item prices — to make categorisation possible.

## Who owns which half

This file covers **the Kawabudget side**: ingestion, persistence, matching, and everything the user
sees. It deliberately says nothing about how Amazon's pages are parsed.

| Concern | Owner |
|---|---|
| DOM scraping, the three Amazon page types, retry ladders, the merge/enrich logic, the `chrome.storage.local` schema (`kawaAmazonOrders`, `accountMetadata`), the popup, image-asset-id reconciliation | [kawaAmazonParser](https://github.com/julienaltieri/kawaAmazonParser) → `context.md` |
| Driving Chrome unattended, switching household accounts, the nightly schedule, the order-detail deep-dive that backfills prices | [AI-workflows-Julien-Altieri](https://github.com/julienaltieri/AI-workflows-Julien-Altieri) → `kawa-amz-refresh-automation/context.md` |
| Ingestion, storage, matching, UI — **this file** | [kawaclient](https://github.com/julienaltieri/kawaclient) and [kawa](https://github.com/julienaltieri/kawa) |
| What a matched order *means* for the budget: zero-sum reconciliation and the return auto-split | [`zero-sum-streams.md`](zero-sum-streams.md) |

Read the parser's `context.md` before changing anything that touches the incoming payload shape. Do
not restate it here; it changes on its own schedule.

This file stops at `transaction.amazonOrderDetails`: producing that annotation is its subject,
consuming it is not.

---

## How it works

### 1. The contract

Two constants are the entire interface between the extension and this app:

- the browser tab must be **titled exactly `Kawa`**,
- the message is a string prefixed **`kawaAmazonOrders-`**, posted into that page.

Neither is discoverable from the other side's code, and both repos must change together. How the
extension decides to send and what it sends is the parser's half — see its `context.md`,
*How it reaches Kawabudget*.

### 2. Ingestion

`Core` registers `amazonHistoryHandler` as a `window` message listener at construction
([`core.js`](../src/core.js)). It filters on the prefix, guards re-entry with
`globalState.amzHistorySaving`, stamps each order with `id = orderNumber`, and posts the set to
`ApiCaller.saveAmazonOrderHistory`.

### 3. Persistence

`POST /api/saveAmazonOrderHistory` → `routes/index.js` → `model.saveAmazonOrderHistory` → an
`AmazonOrderSet` of `AmazonOrder` bundles, in the **`kawa` repo**.

Orders live in their own DynamoDB table, **not** inside the main user-data blob — they are bulky,
they change on a different cadence than budget data, and they are re-derivable by re-scraping.
`AmazonOrder.CheckIntegrity` requires `accountName`, `orderNumber`, `id`, `date`, a numeric
`orderAmount` and an `items` array; `items` is otherwise **stored verbatim**, which is why fields the
scraper adds arrive intact without a schema change on this side.

On load, `Core` fetches the last two years into `globalState.amzOrderHistory`
([`core.js`](../src/core.js)).

### 4. Matching orders to bank transactions

`reconcileAmazonTransactions` ([`transactionMatching.js`](../src/transactionMatching.js))
attaches a matched order onto a bank transaction as `transaction.amazonOrderDetails`. Everything
downstream keys off the presence of that property.

A transaction is a candidate if its description matches `/amz|amazon/i` and does *not* match the
exclusion list (`amazon web services`, `amazon.fr`, `amazon prime`, …) — `amazonConfig` in
[`core.js`](../src/core.js).

Four passes run in descending order of confidence, each only on what the previous ones left:

| Pass | Method | `algo` tag |
|---|---|---|
| 0 | Amazon's own payments page gave the order a `transactions[]` list — match a bank line to one of those entries by `bankTxn.amount + txn.amount ≈ 0`, nearest date within 2 days | `transactionLevelMatch` |
| 1 | One bank transaction equals one order total | `directMatch` |
| 2 | Several transactions on the *same date* summing to one order total | `sameDate` |
| 3 | Pairs spread across up to 14 days summing to one order total, widening the window a day at a time | `multipleDaysAppart` |

**Sign conventions are opposite on the two sides and this is the single easiest thing to get wrong.**
A bank charge is **negative**; the `amount` on an `order.transactions[]` entry is **positive** for a
charge and negative for a refund. That is why pass 0 tests a *sum* against zero rather than an
equality — it makes charges and refunds symmetrical in one expression. Order-level `orderAmount` is
always positive.

Pass 3 is combinatorial, so it is skipped entirely once 20 or more transactions remain unmatched.

Reconciliation is re-entrant: `_performAmazonReconciliation` ([`core.js`](../src/core.js))
bails unless the unmatched count actually dropped, so repeated calls are cheap. Matches found on
already-categorised transactions are persisted back.

### 5. Refunds

Refund credits are matched by the same four passes as charges, but **only pass 0 can ever match
one** — passes 1 to 3 consider negative bank amounts only, so a credit with no `transactions[]` entry
to match against stays unmatched rather than being fitted to an order total. A matched refund carries
the same `amazonOrderDetails` as the charge it belongs to, which is what lets the two be recognised
as one order downstream.

What happens *after* that — pairing a refund against its charge inside a zero-sum stream, and moving
or splitting the original charge to fund a refund that has nothing to cancel it — is a different
system and is owned by [`zero-sum-streams.md`](zero-sum-streams.md). Non-Amazon refunds are
reconciled there too, by a separate rail that deliberately never touches Amazon transactions.

### 6. Which charge am I looking at

An order billed as several charges produces several bank transactions that are *identical* on screen:
same order number, same picture, same item list. Deciding how to categorise one of them means knowing
which one it is.

The tile names the order once across the top — `Fanny's Amazon order #818 from Aug 24`, both halves
cut to what distinguishes one order from another, with the full order number on the `title` — and
then describes **one charge**: its item, its date,
its amount, and beneath that the order's other bank transactions as `and $12.06 on 7/23/26`.

Those sibling lines are **inert, and appear only on a queue card**. In the queue you answer one charge
at a time, and jumping to a sibling mid-flow is what creates the states nothing downstream handles —
one charge split and the other not, one categorized while its sibling is still queued. The lines are
still worth their row: without them nothing on the card says this order has other charges at all.
Nothing is underlined, because nothing opens — with one condition instead of two, the cue and the
behaviour cannot drift apart.

**Inside a dialog there are no sibling lines, because the siblings are pages.** Every charge of the
order is a page of a deck you flick between (§9), so moving between them neither closes the dialog nor
reopens anything, and the order is named once above the deck rather than on each page. The defect that
the old close-and-reopen navigation had to guard against — a dialog writing its allocations to the
transaction it *opened* on rather than the one it ended on — is gone rather than fixed: the dialog now
holds every charge and writes each one explicitly.

**The sibling lines list only *posted* charges.** Amazon's payments-page ledger also contains entries
that never become bank transactions at all — the gift-card portion of a split payment, for one — so
listing it here would show lines that stay "pending" forever and inflate what looks like the order's
transaction count. The ledger is still *read*, but for resolution rather than display: see §7.

The deck does show what has not posted, but on a different rule and with a different treatment — a
shipment that has not arrived, not a payment that will never appear as one. See §9.

### 7. Which items did *this* charge pay for

Amazon bills per shipment, so one order can arrive as several charges — while every one of them
carries the whole order's item list. "The order's items" and "the items on this transaction" are not
the same set, and nothing in the payload says which shipment an item went in.

**Both the item mapping and the item prices are resolved for the whole order at once**, never for one
charge on its own. Resolving charges independently produced two faults: one charge could scope to its
items while its sibling could not, so moving between them changed the picture count for no visible
reason; and the same item was priced differently depending on which charge was open — which means the
price was never a property of the item.

The order it reasons over is the **live** one from `globalState.amzOrderHistory`, not the copy on the
transaction. `amazonOrderDetails` is persisted with the categorization and never re-attached once set
(`getUnmatchedAmazonTransactions` skips transactions that already have it), so each transaction keeps
the order as it looked when *that* transaction was first matched — and the scraper backfills item
prices afterwards. Two charges of one order could therefore disagree about whether their own items
have prices, showing one charge as a single item and its sibling as the whole carousel with no price
tags. `getAmazonOrderData` layers the live order over the stored copy, which still supplies the match
metadata (`algo`, `matchedTxnDate`, `matchedTxnLast4`) the order itself does not carry, and remains
the only source for an order older than the fetched window.

#### The charge inventory, and whether it is complete

Resolution runs over every charge the **order** has, not every charge the bank has posted. A charge
still in transit is part of what the order was billed as, and leaving it out makes the items fail to
account for the order — which would cost the charge that *did* post its own items, for no reason a
reader could see.

`transactions[]` (Amazon's payments page) is the only source that can be trusted to be exhaustive. If
an order has none — it was matched by amount before the payments page was read — the fallback is what
the bank posted, and that list **is not known to be complete**. The distinction is load-bearing: with
an incomplete list, an item left unaccounted for might belong to a charge nobody can see, so the
inferences that would read a leftover as a discount are switched off rather than guessed at.

#### The two passes

1. **At full price.** Price each item at its share of the order total, then find charges that match a
   subset of them exactly. Those charges are settled as if no discount existed, and whatever is left
   unclaimed absorbs the gap between the order and the bill. This is a gift card taken off a single
   shipment: that slice gets re-priced and every other item keeps the price it really had.
2. **Rescaled.** If pass 1 cannot account for every charge, re-price every item against what was
   actually *billed* and match again. A discount spread across all the shipments lands here.

Whichever pass accounts for every charge wins, pass 1 first; failing that pass 1's partial result
stands, then pass 2's. Pass 2 and the absorption both require a complete charge inventory, so an
order matched before its payments page was read stops at pass 1's exact matches.

#### Refusing

Item subsets are handed out **disjointly** — no item may be claimed by two charges — and the answer
must be unique. **More than one equally good reading means we do not know**, and the caller falls back
to the amount-based split. Ambiguity has to decline rather than pick, because the consequence of
picking is a real product picture with someone else's price under it.

Some orders are ambiguous combinatorially rather than incidentally: fourteen interchangeable refills
billed as six shipments has more equally good readings than can be enumerated. The search carries a
step budget and **running out is treated as ambiguity**, because that is what it means. The resolution
is memoised per order — the key covers the item prices and the ledger, so the scraper backfilling
prices invalidates it on its own.

This is what `canSplitAmazonByItem` rests on. It used to compare the item prices against the
transaction amount — but those prices come from `allocateProportionally(prices, transactionAmount)`,
which sums to that amount *by construction*, so the check was a tautology that could never fail. The
result was that splitting one charge of a two-charge order listed both items at prices that were
fiction: on order #112-7078452-6127462, the $12.06 charge offered its two items at roughly $3.05 and
$9.01, when in fact it paid for exactly one of them, in full.

### 8. Item-level prices in the UI

The scraper supplies a nominal `itemPrice` per item and its own `postTaxPrice` estimate. **The client
uses neither directly.** `getAmazonItemPrices(amz, total)`
([`CategorizeAction.js`](../src/components/CategorizeAction.js)) re-spreads a target total
across the nominal prices with `utils.allocateProportionally`, a largest-remainder split in cents.

Two reasons, and both matter:

- The scraper rounds each `postTaxPrice` independently, so on a multi-item order they drift a cent or
  two from the order total.
- `total` is not always the same number. The **carousel labels** pass `orderAmount`; the **split
  view** passes the transaction amount, because one order can be billed as several charges and the
  allocations have to sum to the one being split.

Where it surfaces:

- **`TransactionView`** — an Amazon charge reads as a **column**: the order named once across the
  top, then the picture beside everything that belongs to this one charge. The row it replaced put a
  fixed-height info column between the picture and the amount, with the description clamped so it
  would fit; on a phone that left the description in a gutter and the amount crowded against it. Both
  of those widths went away with the row that needed them, and what replaces them comes from the
  design system rather than from numbers chosen to make one layout work.

  The item name is capped at **two lines** and opens to its full height on tap. Names vary in length,
  so letting one run to a third line moved the amount and the sibling charges as the carousel was
  stepped through — the tile shifted under the reader's thumb between one item and the next. It is cut
  where the line ends, with an ellipsis; an earlier version cut it to its first five words, which
  truncates by a count that knows nothing about the width it has. The ellipsis is also the affordance:
  it appears only when something is actually hidden. Opening animates to the name's measured height
  rather than to a cap, because everything under it moves too and a cap the text never reaches would
  keep pushing the amount down after the words had stopped.

  The item carousel shows the items *this charge* paid for when they can be determined and the whole
  order otherwise. The carousel appears only when the charge covers more than one item. Its per-item
  price tags appear only **inside a dialog, and only where the rows below are not already item-wise** —
  a price earns its place when it could change what you do next, and nothing else. On a queue card you
  answer the whole charge, so no decision turns on what one item cost. In the deck the allocation rows
  carry every price already, so a tag would say the same number twice; the one case that keeps it is the
  fallback to amount-based rows, where the tag is the only place an item's own price appears.
  (`AmazonItemImage` is shared with the split view, which always prices its rows: you cannot assign an
  item to a stream without knowing what it cost.) The headline amount is **the transaction's own**. It
  used to be the order's sum, which read as "what the order cost" only for as long as they were all
  charges — once refunds started carrying the same order number the sum became the order's net after
  returns, matching neither the allocations shown below it nor any real transaction.
- **`AmazonItemAllocationView`** — Split, for an Amazon order, asks *which stream* rather than *how
  much*. One row per item — picture, "Goes to", stream — emitting the same
  `{streamId, amount, type:"value"}` array as the amount-based view, with several items in one stream
  collapsed into a single allocation. Streams already picked float to the top of the dropdown under an
  "Already in this order" `optgroup`. One item is enough: a single-item charge dropping to the
  amount-based view would be the one charge in an order whose rows looked unlike its siblings'.

  An item allocated to a **zero-sum stream** is one that went back, and the row says so without being
  told: an amber dot in the price chip while the credit is expected, a green dot with the price struck
  and "Refunded on …" in place of the field once it has arrived. Which items a credit landed on is inferred by
  matching its amount against **subsets** of what is still awaiting — a
  credit pays for a set, not an item, so two socks returned together are resolved by the one credit that
  covers both. Several matching subsets are not automatically several readings: where every one of them
  settles the **same** prices the choice cannot come out wrong, so the first is taken (principle 10 over 9,
  and the pick is deterministic so it cannot differ between renders). Where they settle different prices —
  a $20 item against a $10+$10 pair — it refuses.

  What is left over is two different facts and is not reported as one. A credit that matched several
  subsets worth different amounts demonstrably arrived and cannot be placed: those items claim nothing per
  item, and the charge falls back to the **charge-level strip**, which says a refund arrived without naming
  an item it cannot name. A credit that matched *no* subset at all is a different shape — a fee, a partial
  adjustment, a match on the wrong order — and the items stay **amber**, so it surfaces to the reader
  instead of resolving quietly. An earlier pass accepted a charge whose own total happened to equal the
  leftover credits; it was deleted rather than narrowed, because agreement in aggregate while no part
  agrees is not evidence (principle 22). The
  arrived half needs the zero-sum reconciliation for that stream, which is computed in the analysis
  view and attached to the transaction there; everywhere else — the queue's dialog included — a
  returned item reads as still expected, which is less than the truth rather than different from it.

`canSplitAmazonByItem` requires only that the charge's items be known — see §7.

### 9. The charge deck

Every charge of one order, as pages you flick between, inside the Split and Edit dialogs
([`Deck.js`](../src/components/Deck.js)). `Deck` is generic — it knows nothing about charges, `pages` is
just an array of nodes — and the stream view's visualisation carousel uses the same component. It was
named `ChargeDeck` while this was its only caller. One page is a charge tile *and* its allocation
rows, so the two travel together — swapping the rows underneath a moving deck is what made the content
jump. The deck owns the track's position, the gesture, the spring and its own height; it knows nothing
about what a page contains.

The gesture locks direction after 6px, so a vertical drag still scrolls. A release projects its
velocity, snaps to the nearest page and settles on a spring, which is what makes a throw feel like one
movement rather than a drag followed by an animation. Velocity is sampled from the **track**, not the
finger: past either end the track follows only `rubber` of the hand, and measuring the hand there hands
the spring a speed the deck never had. The constants sit together in `deckPhysics`, tuned on a device
against a live prototype. Page pitch is measured off the DOM rather than computed, because the page is a
flex child of a track inside a modal whose padding is not the deck's to know.

The pager is dots up to seven charges and a `3 / 9` count beyond, where dots stop being countable. A dot
says **position and nothing else**: filled and larger for the one you are on. It briefly also said
whether a charge had posted and whether it was categorized, which is three meanings on a half-rem circle
and two more than it carries — the tile says all of them already.

**A shipment that has not arrived is still a page.** The order was billed for it, and the item
resolution already assigns it items — the completeness rule in §7 exists precisely so a charge still in
transit is not left out and does not cost the charges that *did* post their own items. Such a page shows
its items and its amount, outlined rather than filled and at half opacity, with the date slot held but
blank because there is no date yet, and *Not posted yet* where the allocation rows would be. It carries
no rows, cannot be categorised, and is structurally incapable of being written: the deck renders it from
a display-only stand-in, and the real charges live in their own array, so nothing pending can reach the
commit path or the confirm gate.

**What makes a pending page is unshipped items, not unexplained money.** A ledger entry with no bank
debit against it is only a candidate; it becomes a page only if the resolution assigns it items. An
entry that resolves to no items is how the order was *paid* — a gift card portion, a discount — not
something still coming, and a page saying "not posted yet" about it would be false. Nothing in the
payload labels those entries, so the items are the only honest discriminator available.

**One confirmation answers the order.** The dialog writes each charge its own allocations, and only the
ones actually changed. Because `categorizeTransactions` consumes the queue action of every transaction
it categorizes, the sibling cards leave with it — the same path a stream chip already took for an order.
A deck can hold charges in both states at once, one being split for the first time and another being
edited; the commit rail already keys each transaction on `transactionId` or `id` depending on which, so
no branch is needed for the mixed case.

Confirm asks a different question depending on why the dialog is open. Clearing queued work (Split from
a card): every charge that has never been categorized must be fully allocated, because leaving one
behind recreates exactly the half-answered order the deck exists to prevent. Correcting an existing
categorization (Edit): something must actually have changed since it opened.

---

## Key decisions

**Orders live outside the user-data blob.** They are large, re-derivable, and written by a different
actor on a different cadence. Keeping them separate stops an Amazon refresh from rewriting budget
data.

**`items[]` is persisted verbatim.** The scraper can add a field and the client can start using it
without a backend deploy. The cost is that nothing validates item shape — a scraper regression
reaches the UI unchecked.

**`itemPrice` is load-bearing, not just `postTaxPrice`.** It looks redundant and is not: the client
needs the *nominal* prices as weights in order to re-spread them onto a total that isn't the order
total. Dropping it from the payload would break the split view.

**An item split is read back by inverting it, not by storing it.** `streamAllocation` still records
stream and amount and nothing about items — the server's `assignStream` rebuilds allocations as
`{streamId, amount}` and `consolidate()` merges same-stream value allocations, so item identity has
nowhere to live. But if a split was *made* item by item then every allocation is exactly the sum of some
subset of the charge's item prices, and that assignment can be recovered: `mapAllocationsToItems`
inverts the sum, and editing an existing split therefore opens in the view it was created in. **Unique
or refuse**, like every other inference here — two items priced alike on two streams have two equally
good readings, and the fallback to the amount-based rows knows less and says so. A single allocation
covering the whole charge needs no arithmetic at all and never falls back, which matters because that is
what a stream chip writes. This replaced a deliberate deferral to a backend change; the backend change
is still the only way to make it a *fact* rather than an inference.

**Item mapping and item prices belong to the order, not to a charge.** Nothing in Amazon's payload
maps items to shipments, so a disjoint assignment of subsets to the order's charges is the best
available evidence — and it has to be computed over all of them at once, or the same item ends up
with a different price depending on which charge is open. The rule is deliberately all-or-nothing:
one unique reading is used, anything else falls back to amounts. A guessed subset would be
indistinguishable from a known one on screen, which is what makes guessing unacceptable here rather
than merely imprecise. If the scraper ever exposes shipment grouping, this inference should be
retired in favour of it — `items[]` is stored verbatim, so that needs no backend change.

**Matching is heuristic and ordered by confidence, never by convenience.** Each pass is narrower and
more certain than the one after it, and no pass may overwrite an earlier pass's match. Loosening an
early pass silently poisons the later ones.

---

## Boundaries

- **Nothing here logs into anything.** Both the extension and the automation assume an already
  authenticated browser session. There is no Amazon API and no credential flow.
- **Scraping is best-effort.** Amazon Fresh and digital orders never get per-item prices; those
  orders keep the amount-based split. Unmatched transactions stay unmatched rather than being
  force-fitted.
- **The client cannot trigger a scrape.** Data arrives only when a `Kawa`-titled tab is open in a
  browser with the extension installed. Everything is one-directional: extension → client → server.
- **Order data is not authoritative for money.** Bank transactions are. Orders only ever *annotate*
  them.
