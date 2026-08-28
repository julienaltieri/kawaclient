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
([`core.js:43`](../src/core.js#L43)). It filters on the prefix, guards re-entry with
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
([`core.js:112`](../src/core.js#L112)).

### 4. Matching orders to bank transactions

`reconcileAmazonTransactions` ([`transactionMatching.js:145`](../src/transactionMatching.js#L145))
attaches a matched order onto a bank transaction as `transaction.amazonOrderDetails`. Everything
downstream keys off the presence of that property.

A transaction is a candidate if its description matches `/amz|amazon/i` and does *not* match the
exclusion list (`amazon web services`, `amazon.fr`, `amazon prime`, …) — `amazonConfig` in
[`core.js:16`](../src/core.js#L16).

Four passes run in descending order of confidence, each only on what the previous ones left:

| Pass | Method | `algo` tag |
|---|---|---|
| 0 | Amazon's own payments page gave the order a `transactions[]` list — match a bank line to one of those entries by `bankTxn.amount + txn.amount ≈ 0`, nearest date within 2 days | `transactionLevelMatch` |
| 1 | One bank transaction equals one order total | `directMatch` |
| 2 | Several transactions on the *same date* summing to one order total | `sameDate` |
| 3 | Pairs spread across up to 15 days summing to one order total, widening the window a day at a time | `multipleDaysAppart` |

**Sign conventions are opposite on the two sides and this is the single easiest thing to get wrong.**
A bank charge is **negative**; the `amount` on an `order.transactions[]` entry is **positive** for a
charge and negative for a refund. That is why pass 0 tests a *sum* against zero rather than an
equality — it makes charges and refunds symmetrical in one expression. Order-level `orderAmount` is
always positive.

Pass 3 is combinatorial, so it is skipped entirely once more than 20 transactions remain unmatched.

Reconciliation is re-entrant: `_performAmazonReconciliation` ([`core.js:516`](../src/core.js#L516))
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
its amount, and beneath that the order's other bank transactions as `and $12.06 on 7/23/26`. Those
sibling lines are the navigation: tapping one closes the dialog and reopens it on that charge.
Nothing else was added — the tile is crowded already, and navigation turned out to be the whole of
what was needed.

**Tappable is signalled by underlining the amount and nothing else**, and the cue is derived from the
same flag as the click handler, so a row cannot look openable while being inert. An earlier version
put a dotted underline on the row's base style, which meant every sibling wore the cue whether or not
it could be opened — the fix was to move the cue onto the amount, not to abandon the underline.

Where tapping is allowed depends on where you are:

| | sibling is uncategorized | sibling is already categorized |
|---|---|---|
| **in the queue** | inert | opens its dialog |
| **inside a dialog** | opens the split view | opens its dialog |

In the queue you are categorizing one transaction at a time, and jumping to a sibling mid-flow is
what creates the awkward states — one charge split and the other not, one categorized while its
sibling is still queued. An already categorized sibling is the exception because there is nothing in
progress to disturb. Inside a dialog the restriction lifts: by then you are looking at one charge
rather than working through a queue.

**Where you land follows the target, not where you came from.** A categorized charge opens its own
dialog; an uncategorized one opens the split view. That is what makes the round trip work in both
directions, and it means the dialog can end up on a different transaction than the one it opened on —
so it writes its allocations to the transaction it ended on, and only concludes the queue card's
action when that is the card's own transaction.

That navigation is the only practical way to move between the charges of one order: finding the
sibling in the transaction feed runs straight back into the problem of telling them apart.

**Only *posted* charges are listed.** Amazon's payments-page ledger also contains entries that never
become bank transactions at all — the gift-card portion of a split payment, for one — so listing it
would show lines that stay "pending" forever and inflate what looks like the order's transaction
count. The ledger is still *read*, but for resolution rather than display: see §7.

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
([`CategorizeAction.js:23`](../src/components/CategorizeAction.js#L23)) re-spreads a target total
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

  The item carousel shows the items *this charge* paid for when they can be determined and the whole
  order otherwise. Two independent rules govern it: the carousel appears
  only when the charge covers more than one item, and the per-item price tags appear only when the
  carousel does. A charge covering a single item already has that item's price on display — it is the
  transaction amount beside the picture — so a tag would only repeat it. Tying the tag to the
  carousel rather than to whether a price happens to be known is what keeps the two from drifting
  apart. (`AmazonItemImage` is shared with the split view, which always prices its rows: you cannot
  assign an item to a stream without knowing what it cost.) The headline amount is **the
  transaction's own**, with the order's other charges beneath it (§6). It used to be their sum, which
  read as "what the order cost" only for as long as they were all charges — once refunds started carrying the same
  order number the sum became the order's net after returns, matching neither the allocations shown
  below it nor any real transaction.
- **`AmazonItemAllocationView`** ([`ModalManager.js:354`](../src/ModalManager.js#L354)) — Split, for
  an Amazon order, asks *which stream* rather than *how much*. One row per item — picture, "Goes to",
  stream — emitting the same `{streamId, amount, type:"value"}` array as the amount-based view, with
  several items in one stream collapsed into a single allocation. Streams already picked on this
  transaction float to the top of the dropdown under an "Already in this order" `optgroup`.

`canSplitAmazonByItem` decides which view opens, and requires the charge's items to be known and to
number more than one — see §7.

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

**Splitting by item is the initial allocation only.** `streamAllocation` records stream and amount
and nothing about items, so once two items have been summed into one allocation there is nothing to
map back — editing an existing split therefore falls back to the amount-based view. Changing this
means teaching the model which items went where, which is a backend change and was deliberately
deferred.

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
