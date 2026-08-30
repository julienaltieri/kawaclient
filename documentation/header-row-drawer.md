# The Ring Drawer

> Part of [`documentation/`](context.md) — see that file for what belongs here and how it's written.

## What this is

On a phone, the progress ring leaves the stream header row and waits under its left edge. Dragging the
row to the right brings it back. What the row gains is width, which is the only thing it was short of.

Desktop is not touched: same row, ring in place, no gesture. That restriction is the point of the change
rather than a limitation of it — see [Mobile only](#mobile-only).

Lives in [`HeaderRowDrawer.js`](../src/components/HeaderRowDrawer.js), used by
`CompoundStreamAuditView` in [`StreamAuditView.js`](../src/components/StreamAuditView.js) and by the
staging-only sandbox page.

## The problem it solves

A stream header row holds a ring, a name, an amount and a sparkline, and on a phone there is not enough
width for all four. The name wraps, and the sparkline is squeezed.

*Squeezed*, specifically — not merely narrowed. Victory emits its chart as
`<svg viewBox="0 0 280 100" style="width:100%">`, and the container is a flex item with the default
`flex-shrink: 1`. So the box gives way to a long name, and an svg with a viewBox and `width:100%`
**scales to whatever box it is given**. Measured on a 390px screen, same nominal `10.5rem` container:

| stream name | graph box | chart drawn at |
|---|---|---|
| `Fun` | 168px | x0.600 |
| `Investments & Interests` | 136px | x0.487 |

The chart's size has always depended on the length of the stream name. Nothing was pinned; it simply was
not visible until a row got tight enough.

Removing the ring is what returns the width, and the ring is the row's least-consulted element — which is
why it is the thing that moves rather than the chart or the name.

### A wrong cause, recorded

This file previously stated that the Victory chart is *intrinsically 16.5rem* and *hangs past its own box
on both sides on every row*, and that a long name pushes that overhang past the card's edge where it gets
clipped. **That is wrong, and measurement disproves it**: the svg is `width:100%` of its container, so it
never exceeds it, and the graph box did not cross the card's edge in any tested configuration — long name
or short, drawer open or closed.

It is recorded rather than quietly deleted because a plausible mechanism written down with confidence is
worse than no explanation: the next person measures against it instead of against the row. What survives
is the narrower claim — the pill clamp in [`MiniGraph.js`](../src/components/MiniGraph.js) is still there
and still earns its place, because a genuinely wide value *can* overrun the chart's own viewport. That is
a different bug that happened to share a symptom.

### Narrowing the chart means cropping it

Because the svg scales to its box, handing width back to the name by shrinking the container **resizes the
chart** — axis labels, value pill and all. Doing exactly that shipped once, and cost every mobile chart
about a fifth of its size.

So `MiniGraphContainer` is a window rather than a box. It sets `overflow:hidden` and
`justify-content:flex-end`, and the chart sits inside a `ChartWindowContent` holder pinned at the design
width with `flex-shrink:0`. The container shows a right-anchored window onto a chart that never changes
size: narrowing hides the chart's *left*, which is the only part safe to lose, because the container's
`mask-image` has already faded it to nothing.

The mask stays on the container, i.e. **outside** the crop, so it always spans the leftmost 40% of what is
visible. The fade therefore cannot itself be cut off — the leftmost surviving column is fully transparent
by construction, and no amount of cropping produces a hard edge.

| graph box | crop (now) | scale (before) |
|---|---|---|
| 136px | x0.600 | x0.487 |
| 122px | x0.600 | x0.434 |
| 109px | x0.600 | x0.388 |

A side effect worth knowing: the chart's drawn scale is now a **constant** rather than a function of the
name's length, so long-name rows draw their chart larger than they used to.

## How it works

The ring is **not covered** by the sliding content. It lives outside the window and slides in.

```
window   the ContentTile.  position:relative; overflow:hidden.  One background, painted once.
drawer   absolute, left:0, width openWidth,   translateX(x - openWidth)
content  name, amount and chart,              translateX(x)     no background, no reserved space
```

At `x = 0` the drawer's whole box sits left of the clip, so the ring is invisible because it is *clipped*,
not hidden beneath something. The content starts flush at the tile's ordinary content edge, which is what
returns the width.

**The drawer's right edge is always exactly `x`, and the content's left edge is always exactly `x`.** They
cannot overlap at any point in the gesture. That is why the content needs no background of its own — and
with nothing painted over anything, three defects that sank the first attempt are impossible rather than
fixed: the ring showing through a translucent panel, two stacked backgrounds reading as a different
colour, and the text being pushed right by a panel reserving its own box.

### Measurements

All derived; none typed.

| | |
|---|---|
| drawer content width | `DS.spacing.xl + DS.spacing.xxs` — 6.5rem, what the longest real caption needs |
| drawer padding | `DS.spacing.xxs` either side |
| open width | that content plus that padding either side — 7.5rem |
| centring | `justifyContent:center`, not padding — see below |
| separator | `1px solid DS.getStyle().borderColor`, the rule the hamburger menu draws between its links |
| separator height | `top:25% / bottom:25%` — half the row, centred, and still proportional when a long name wraps to two lines |

**The drawer is sized from its content, not from the ring.** It used to be `ring + gap + gap`, which made
the caption's width a hostage of the ring's: the caption lives *inside* the ring's box, so widening the
drawer bought padding rather than text width. Widening the gap from 2rem to 3rem moved the caption's box by
exactly zero pixels — it stayed 48px while the drawer went from 112px to 144px. Sizing from the content
instead makes the open drawer *narrower* than it was, 7.5rem against 9rem, while the caption's box more
than doubles. The room was there the whole time, spent on padding.

**Centred by `justifyContent`, never by padding.** This codebase sets `box-sizing` per component and has no
global `border-box` rule, so a padded box here is a content box: the padding adds to the width the spring
translates by. The old `paddingLeft` only looked centred because a 3rem pad and a 9rem content-box width
happened to leave 3rem either side of a 3rem ring — arithmetic that came apart the moment the box inside
stopped being exactly the ring's width. Flex centring cannot drift.

The ring carries no `marginLeft` inside the drawer. It has one in the row, where it is an item among
others; in the drawer the centring places it, and both together pushed it off-centre toward the drawer's
right edge.

### What the drawer holds

The ring, and underneath it the number the ring was always about: the period's value and its word —
*left*, *over*, *saved*, *received*, *paid*. Those come from `TerminalStreamCurrentReportPeriodView`'s
`getPrimaryValue()` and `getSubtext()` rather than being re-derived; the branches differ for savings,
income and fully-paid streams, and a second copy would eventually disagree with the rest of the app about
the same stream. Both methods read only `props.analysis` and hold no state, so borrowing them costs an
object.

The caption wraps at the drawer's content width, because `ringBoxStyle` is the box it lives in, and that
box takes the drawer's content width in the drawer and the ring's own 3rem in the row. Binding both
placements to the ring's width is what confined the caption to 48px, where it did not so much wrap as
overflow: centred on a box narrower than its own longest word, `$8,200 received this year` went to three
lines and spilled past its box on all of them.

The caption renders **only on mobile**. It is not a screen inconsistency: it belongs to the drawer, and
only mobile has one. It exists because a drawer gives the ring vertical room the row never had, and
because a ring pushed out of sight should say what it was comparing.

## The gesture

| | |
|---|---|
| stiffness | 320, damping **derived** as `2√k` — critically damped, so tuning speed cannot reintroduce ringing |
| rubber | 0.3 past either end. The charge deck's 0.8 is for something that can keep going; a drawer has a stop |
| lock | 6px, releasing to vertical scroll when the movement is more vertical than horizontal |
| flick | commits above 0.30 px/ms; otherwise past 22% of the travel, mirrored when already open |

Three guards, each fixing something that was measured:

1. A release velocity pointing **away** from the target is dropped to zero. Without it a fast flick reached
   107px against a 56px stop before the spring hauled it back — critical damping stops a spring *ringing*,
   not one handed a speed in the wrong direction.
2. The step stops the instant it reaches or passes the target, so the approach is monotonic.
3. It also stops within 0.5px at low velocity. A critically damped spring approaches without ever crossing,
   so without this it runs for seconds on floating-point crumbs after the drawer has visibly arrived.

**Do not additionally clamp the position into `[0, openWidth]`.** It was tried: a release beyond the stop
then snapped back in a single frame, which is a jump rather than a settle.

### Who owns the drag

The handlers sit on the **window**, not on the sliding content, so the ring's side of an open row is
grabbable — that is where a thumb lands to push it back. Anything inside `[data-no-drag]` keeps its own
gesture, which marks the chart.

**Quieting the chart requires a shield, not `pointer-events: none`.** Victory's voronoi container sets
`pointer-events: all` on its own capture layer, and an explicit value on a descendant beats an inherited
one — so making the wrapper quiet never stopped the chart from answering. A transparent shield covers it
while the drawer is open, and because the shield sits *outside* the `[data-no-drag]` box, the drag it
swallows becomes the drawer's: with the drawer out, dragging across the chart closes it.

**One row open at a time**, through a module-level registry — the rows are rendered by different parents
and cannot coordinate through props. A visible ring is then never ambiguous about which stream it belongs
to.

## Mobile only

Gated on `Core.isMobile()`. On desktop the component renders the row exactly as it always was: ring in the
flex row, no drawer, no gesture, no caption.

Desktop has the width and does not have the bug. Extending the drawer there would be redesigning a row
that works, which is the one thing this change must not do.

Note the shape of `isMobile()` — it is `window.innerHeight > window.innerWidth`, i.e. orientation rather
than width. A phone in landscape reports desktop and will render the plain row. That is acceptable here
because a landscape phone genuinely has the width this change exists to recover.

## Out of scope

- The **top-level header row** (`MacroCompoundStreamAuditView`) has no ring, so there is nothing to put in
  a drawer, and no ring competing for width means it does not have the bug.
- `TerminalStreamCard` is a different component — the small cards below the header row — and is untouched.
  The name matters: the row this feature changes is a *compound stream header row*, never "the terminal
  card".

## Key decisions

**Nothing marks the drawer at rest.** No sliver of the ring, no seam, no one-time nudge. A resting row is
indistinguishable from what it was minus the ring. That is deliberate, and it is also the cost: the drawer
is discoverable only by trying it. A permanent cue was prototyped and rejected as reintroducing exactly the
visual weight the row was trying to shed.

**The ring slides in; it is never covered.** Covering it forces a second painted surface, and the tile's
background is translucent — two of them stack into a different colour and let the ring show through. The
structure removes the possibility rather than compensating for it.

**One implementation, two callers.** The staging-only sandbox uses the same component as production. A copy
kept for experimentation drifts from the shipped one within days.

## Boundaries

- **Android's back gesture does not conflict**, checked on a device. That gesture is claimed from the
  screen's very edge, and the drag that opens a drawer starts inside the row's own content, which the
  card's margin and padding hold clear of it. Worth knowing that the clearance is what protects it: a row
  redrawn flush to the screen edge would put the two gestures in the same place.
- **The drawer does not make the chart bigger**, it stops the name from making it smaller. The chart is
  cropped rather than resized now, so its drawn size no longer depends on the row at all; what the drawer
  returns is room for the *name*. If a row ever regains a left-hand element the name loses that room again
  — but the chart keeps its size, which is the part that used to fail silently.
