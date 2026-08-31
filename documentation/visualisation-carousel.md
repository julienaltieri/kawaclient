# The Visualisation Carousel

> Part of [`documentation/`](context.md) — see that file for what belongs here and how it's written.

## What this is

The top of the stream view is a carousel: several ways of reading the same year, one at a time, swiped
between with a pager underneath. The [macro graph](macro-graph.md) is page one; a flow breakdown and a
balance-to-date forecast are meant to follow, and the container exists because of them rather than because
one chart needed a frame.

`ChartCarousel` ([`ChartCarousel.js`](../src/components/ChartCarousel.js)) is the caller.
`Deck` ([`Deck.js`](../src/components/Deck.js)) is the mechanism, shared with the Amazon charge deck —
see [`amazon-transaction.md`](amazon-transaction.md) for that side.

## One deck, two callers

`Deck` knows nothing about what a page holds: `pages` is an array of nodes. A second carousel would have
meant a second set of spring constants and a second copy of the three release guards to keep in step with
the first, which is the argument in `DECISION-PRINCIPLES.md` #18.

It was named `ChargeDeck` while the modal was its only caller. The rename came with the second caller, not
after it — a component reused under a name that describes one of its callers is a lie that gets harder to
correct the longer it stands.

What the two callers do differently is expressed as props, all defaulting to the modal's behaviour so that
adding a caller never changes the existing one:

| prop | modal | carousel |
|---|---|---|
| `bleedRem` | the sheet's own padding | the page body's inset |
| `padRem` | (defaults to the bleed) | the same inset, re-applied |
| `gapRem` | (defaults to the bleed) | twice the inset |
| `fadeEdgesRem` | none | the inset |
| `pagerGapRem` | `DS.spacing.s` | half of it |
| `stretchPages` | off | on |
| `pageLabel` | "Charge" | "View" |

## The geometry

**Every dimension derives from one number**, and that number is the inset the page body already applies to
its content. Three attempts set the inset in one place and the gutter in another, and each time the two
disagreed — see [What it cost](#what-it-cost).

```
edgeInsetRem   what the page body inset its content by, and what a resting page keeps
bleedRem       the same, as a negative margin — how the deck escapes that padding
padRem         the same again, re-applied inside, so a resting page sits where it always did
gapRem         twice it — one page's right inset plus the next page's left one
fadeEdgesRem   the same again — see the mask below
```

**A swipe is the one thing that should not obey the page's padding.** A page has to be able to travel all
the way out of view, so the deck steps out of that padding with a negative margin and re-applies it as its
own. The clip then sits at the screen's edge instead of a rem inside it.

`padRem` and `bleedRem` are separate props because they do different jobs, and conflating them produced two
different bugs in succession: padding holds a page off the container's edge, bleed is the negative margin
that lets a page reach past it. As one number they gave first a doubled inset, then a clip a rem short of
the screen.

**The tiles fill their page** rather than carrying an inset of their own. An inset tile inside an inset page
counts the same space twice.

**A page tile must be `border-box`.** This codebase sets `box-sizing` per component and has no global rule,
so `height:100%` plus padding made a tile 2rem taller than the page holding it, and the clip took that 2rem
off the bottom. The tile is the one place it matters, being the only thing asked to be exactly its parent's
height.

### The clip, and the mask that softens it

`overflow:hidden` stays. Removing it was tried and is only safe where every page is exactly the container's
width — a modal's sheet is narrower than its track, so a neighbouring page would be painted across it.

What stops the clip reading as a cut is a mask: transparent for the first and last `fadeEdgesRem`, opaque
between. That strip is exactly the region outside a resting page, so **nothing visible is faded at rest**
and only a page in motion dissolves into the edge.

### Height

`stretchPages` makes the track stretch its pages to the tallest, so no page carries a height of its own —
swap the first page for a taller one and the rest follow. That is what keeps every visualisation the same
height without any of them knowing the others' dimensions.

**Under `stretchPages` the deck's height must be `auto`.** `fit()` otherwise sets the deck to the active
page's measured height, and that measurement is circular once pages stretch: a page's height then comes
*from* the deck, so the deck fixes a guess, every page adopts it, and content taller than the guess is
clipped. There is nothing to animate in that mode anyway — every page is already the same height.

## Who owns a drag

**The chart is marked `[data-no-drag]`; the tile around it is not.** `Deck` ignores any gesture starting
inside that marker, so a drag beginning on the chart belongs to the chart and a drag beginning on the tile's
padding pages the carousel. The marker sits on the chart's own wrapper rather than on the tile, which is
what keeps the distinction available — marking the tile would make the whole page undraggable.

The first attempt left the chart draggable, reasoning that its hover is a mouse-move with no button held and
so can never become a drag. True of the hover, and beside the point: the chart has pointer interactions of
its own and a swipe starting on it was taking them.

The gesture sits on the **whole component** rather than on the track, so the band between the page and the
pager drags too — it is where a thumb lands and it used to be dead. The pager opts out with the same marker,
since its dots are tap targets.

## Where the page index lives

In `ChartCarousel`, not in `MasterStreamAuditView`. That parent rebuilds three full `MultiStreamAnalysis`
trees on every render and is not memoised, so paging from its state would recompute the entire portfolio's
analysis in order to move a carousel. One level down, a page change re-renders only the carousel and
reconciles the page elements the parent already built.

## Adding a visualisation

Build the page as a `DS.component.ContentTile` with `width:100%`, `height:100%`, `boxSizing:"border-box"`,
`margin:0` — no inset and no bottom margin, both of which belong to the carousel — and add it to the array
`MasterStreamAuditView` passes to `ChartCarousel`. Nothing else needs changing: the height follows the
tallest page, the geometry is the deck's, and the pager counts what it is given.

Mark anything inside the page that answers its own pointer gestures with `data-no-drag`.

## What it cost

Recorded because the shape of the mistake is more useful than the fix.

Five rounds, four of them shipped to production and judged by eye, because **the carousel was built without
an instrument**. The header row's layout was converged in a bench that reproduced its box model exactly and
took one round; this was reasoned about instead, and every wrong guess cost a deploy and a screenshot.

The recurring fault was one quantity with two authors: an inset on the tile *and* padding on the deck, then
a gutter derived from tile margins *and* a gap on the track, then padding on the deck *and* padding on the
page body. Each looked right in the file being edited. The fix in every case was to delete one of the two
authors rather than to reconcile the numbers, which is now `DECISION-PRINCIPLES.md` #24.

Compounding it: five layout properties across three files landed in a single commit, on code whose only
test was production, so no single symptom could be traced to a single change. That is #25.

## Boundaries

- **`Deck`'s physics are documented with the charge deck**, in
  [`amazon-transaction.md`](amazon-transaction.md) — the spring, the release guards, the direction lock.
  They are unchanged by this caller and a copy here would drift.
- **The macro graph's own behaviour** — what it plots, its projection, its hover — is in
  [`macro-graph.md`](macro-graph.md). This file covers only the container.
- `contain: inline-size` remains on the deck from its modal origins. Harmless here, and the first thing to
  remove if the full-width geometry ever misbehaves at a breakpoint.
