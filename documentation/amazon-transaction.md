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

### 6. Item-level prices in the UI

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

- **`TransactionView`** — the item carousel, each picture carrying its post-tax price bottom-right
  (`AmazonItemImage`, shared by both views).
- **`AmazonItemAllocationView`** ([`ModalManager.js:354`](../src/ModalManager.js#L354)) — Split, for
  an Amazon order, asks *which stream* rather than *how much*. One row per item — picture, "Goes to",
  stream — emitting the same `{streamId, amount, type:"value"}` array as the amount-based view, with
  several items in one stream collapsed into a single allocation. Streams already picked on this
  transaction float to the top of the dropdown under an "Already in this order" `optgroup`.

`canSplitAmazonByItem` decides which view opens, and requires the prices to actually sum to the
transaction being split.

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
