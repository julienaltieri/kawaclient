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

A stream header row holds a ring, a name, an amount and a sparkline. The sparkline's container is
`10.5rem`, but the Victory chart inside it is intrinsically **16.5rem** — so the chart hangs past its own
box on both sides, always, on every row. The left overhang is hidden by the container's `mask-image`; the
right one normally still falls inside the card, so nothing shows.

A long stream name pushes the container far enough right that the overhang crosses the card's edge, and
the card clips it. What gets cut is the value pill, because the pill is the rightmost thing *inside the
chart*.

**The name is the trigger, not the cause.** Two earlier fixes failed on exactly that distinction, and both
look correct until measured:

- Clamping the pill inside the SVG's viewBox. Correct in itself, and it changed nothing here: the pill was
  never outside the SVG — the SVG was outside the card. (That clamp is still in
  [`MiniGraph.js`](../src/components/MiniGraph.js), because a genuinely wide value *can* overrun the
  chart's own viewport. Different bug, same symptom.)
- Pinning the chart's box and truncating the name. The overhang measures 34px past the card whatever the
  name does, so this fixed nothing while appearing to address the obvious culprit.

Removing the ring is what actually returns the width, and the ring is the row's least-consulted element —
which is why it is the thing that moves rather than the chart or the name.

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
| open width | ring `DS.spacing.l` plus a gap either side, the gap being twice the row's own ring margin |
| ring inset | `(openWidth − ringWidth) / 2` — centred by construction |
| separator | `1px solid DS.getStyle().borderColor`, the rule the hamburger menu draws between its links |
| separator height | `top:25% / bottom:25%` — half the row, centred, and still proportional when a long name wraps to two lines |

The ring carries no `marginLeft` inside the drawer. Production gives it one because there it is an item in
a flex row; in the drawer the padding already places it, and both together push it against the drawer's
right edge while looking centred in the code.

### What the drawer holds

The ring, and underneath it the number the ring was always about: the period's value and its word —
*left*, *over*, *saved*, *received*, *paid*. Those come from `TerminalStreamCurrentReportPeriodView`'s
`getPrimaryValue()` and `getSubtext()` rather than being re-derived; the branches differ for savings,
income and fully-paid streams, and a second copy would eventually disagree with the rest of the app about
the same stream. Both methods read only `props.analysis` and hold no state, so borrowing them costs an
object.

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
- **The drawer does not fix the chart's overhang**, it removes the condition that exposes it. The chart is
  still intrinsically wider than its container on every row, including on desktop. If a row ever regains a
  left-hand element, the clipping returns.
