# The Macro Graph

> Part of [`documentation/`](context.md) — see that file for what belongs here and how it's written.

## What this is

The chart at the top of the stream view: the whole portfolio's year, budget against reality, with a
projection to the end of it. In code it is `EndOfPeriodProjectionGraph` in
[`AnalysisView.js`](../src/components/AnalysisView.js), extending `GenericChartView` in the same file.

It is rendered **once for the entire app**, by `MasterStreamAuditView` in
[`StreamAuditView.js`](../src/components/StreamAuditView.js) — the level-0 view. It is not a per-stream
component and has no per-stream equivalent; the small sparkline on a header row is a different component,
[`MiniGraph.js`](../src/components/MiniGraph.js), which shares the same base class and almost nothing else.

Three props, all `MultiStreamAnalysis` objects, split by sign and kind: `incomeAnalysis`,
`expenseAnalysis`, `savingsAnalysis`. **There is no `analysis` prop** — which is why this class must
override every base-class method that reads one.

It renders only when at least one categorized transaction exists; the guard is in `MasterAuditView`, one
level up, not in the chart.

## It is page one of a carousel

The graph does not sit in the stream view directly. `MasterStreamAuditView` renders a `ChartCarousel`
([`ChartCarousel.js`](../src/components/ChartCarousel.js)) and hands it an array of pages, of which the
macro graph is the first — the container exists because more ways of reading the same year are meant to
follow it.

The carousel does not carry a gesture of its own. It reuses `Deck`
([`Deck.js`](../src/components/Deck.js)), the same paged, swipeable container the Amazon charge deck uses:
`pages` is an array of nodes and `Deck` knows nothing about what is in them. A second implementation would
be a second set of spring constants and a second copy of the three release guards to keep in step with the
first.

Three things differ from the modal caller.

**`bleedRem` is `DS.spacing.xs`.** `Deck`'s default bleed reaches back into a modal's side padding so a page
slides in from under the sheet's frame; here it reaches into the inset the page tiles used to carry, and the
tiles are full width instead. Without it a swiped page stopped about a rem short of the screen edge, which
reads as the page being clamped rather than as it sliding away — the same defect the bleed was invented for
in the modal.

**Every page is the same height, and the macro graph sets it.** `stretchPages` makes the track stretch its
pages to the tallest, so no page carries a height of its own — swap the first page for a taller one and the
rest follow. The alternative, a typed page height, would be a second place to keep in step with a chart that
sizes itself from its own viewBox.

**`pagerGapRem` is half `DS.spacing.s`.** The pager's distance from the page is the caller's, because the two
sit in different rooms: inside a modal sheet the full gap clears the content, and on the page the same gap
read as a hole.

And **the index lives in `ChartCarousel`, not in `MasterStreamAuditView`.** That parent rebuilds three full
`MultiStreamAnalysis` trees on every render and is not memoised, so paging from its state would recompute
the entire portfolio's analysis in order to move a carousel. One level down, a page change re-renders only
the carousel and reconciles the page elements the parent already built.

### Who owns a drag on the chart

**The chart is marked `[data-no-drag]`; the tile around it is not.** `Deck` ignores any gesture starting
inside that marker, so a drag beginning on the chart belongs to the chart and a drag beginning on the tile's
padding pages the carousel. The marker sits on the chart's own wrapper rather than on the tile, which is what
keeps that distinction available at all — marking the tile would have made the whole page undraggable.

This reverses the first attempt, which left the chart draggable on the reasoning that its hover is a
mouse-move with no button held and so could never become a drag. That is true of the hover and beside the
point: the chart has pointer interactions of its own, and a swipe starting on it was taking them.

`Deck`'s gesture also sits on the **whole component** rather than on its track, so the band between the page
and the pager drags too — it is where a thumb naturally lands and it used to be dead. The pager itself opts
out with the same marker, since its dots are tap targets.

## What it shows

Three series are built. **Two are drawn.**

| series | the area behind | the line and dots | what it means |
|---|---|---|---|
| savings | running sum of expected monthly savings, sign-flipped positive | savings' `savedToDate` **plus income's** `savedToDate` | money actually put aside, from savings streams and from income streams both |
| expenses | the same running sum, left negative | expenses' `netToDate` | cumulative net spend |
| income | income plus expenses expected | income's `netToDate` plus expenses' | surplus. `render:false` — never drawn |

So the chart has two visual bands: savings above zero, expenses below. Income has no band of its own — it
is folded into savings, on the reasoning that income you did not spend is money you saved.

Per drawn series, three layers, painted in this order:

```
VictoryArea      the target: what the budget said, cumulative, at DS.backgroundOpacity
VictoryLine      the trend, dashed, at midgroundOpacity
VictoryLine      the actual, cumulative to date
VictoryScatter   one dot per month
VictoryBar       the projection, one bar at the right edge, with three labels
```

Series paint in ascending order of their projection, so expenses (negative) go down first and savings
land on top.

**There is no y axis.** The only `VictoryAxis` is the time axis, and even that has `ticks.size: 0` and
`axis.strokeWidth: 0` — the line and the tick marks are invisible and only the month labels show, pulled
back over the plot area by a negative label padding. What orients the reader vertically is the two bands
and the projection labels, not a scale.

## How it works

### The time axis, and the month that is deliberately empty

`timeAxis` is the savings analysis's full reporting schedule. `timeAxisBoundIndex` is
`timeAxis.length - 2` — one short of the end — and everything plotted is truncated to it.

The x domain still runs to the *last* entry. That trailing month is not padding: it is a real domain
month left empty so the projection bar and its labels have somewhere to sit.

`dateToTickDate` snaps every date to the **1st of its month**, while the reporting period actually starts
on the 21st. So every plotted point sits about twenty days left of the boundary it represents. This is
consistent within the chart and invisible in use, but it means an x value taken off this chart is a tick
date, never a reporting date — `getReportForDate` exists to map back.

### The projection

Computed once, in `SeriesDescriptor`'s constructor, and stored rather than recomputed —
*"why do this rather than a method? to avoid having to recalculate it everytime"*.

The rule: **if the actual series already covers the whole plotted year, use the real value; otherwise
extrapolate.** The extrapolation is an ordinary least-squares fit in raw epoch milliseconds, with two
adjustments that matter more than the fit itself:

- **A zero is prepended** to the series before fitting, anchoring the line at nothing at the start of the
  observation period.
- **Only the slope survives.** `trendLine` returns a slope and a y-intercept; the intercept is
  destructured and then discarded, and the line is re-anchored to pass exactly through the *last actual
  point*. So the dashed line always meets the solid one, which a least-squares line would generally not
  do.

Unlike `MiniGraph`, which gates its projection on `shouldDisplayProjection()`, **this chart always draws
one**. There is no condition and no "too early to say" state.

### The y domain is derived from two numbers per series

```
my, My  =  chartYScaleFactor × min/max over rendered series of ( last target point , projection )
```

The actual line is **not consulted**. The bounds come from where the budget ends up and where the
projection lands, which is normally the widest pair — but an overspend running past both would be drawn
outside the domain. Nothing guards it.

`chartYScaleFactor` (1.1 on mobile, 1 on desktop) multiplies both bounds, so it inflates the view
symmetrically **about zero**, not about the data.

This is the third different domain rule among charts sharing one base class: `GenericChartView` defaults
to a fixed ±100 marked *"must override"*, `MiniGraph` is symmetric about zero with a floor of 1, and this
one is asymmetric and data-driven.

### Hover updates the chart without React state

This is the central design decision, and the reason the code looks the way it does:

> *since the graph is expensive to render, we use internal eventing to update it instead of state*

`onEnter` and `onExit` are overridden so they never call `setState`. Instead the chart keeps two arrays of
refs — `listeners` and `mouseMoveListeners` — rebuilt on every render, and pushes new values into them
imperatively. Each label, bar and tooltip is wrapped in a `FocusReportWrapper` that re-applies its
`mutations(focusReport)` and short-circuits when the focus report has not changed.

A **focus report** is one entry of `reportSchedule`: one month, with its index into the series. `undefined`
is meaningful — it is the state the chart is in when you hover past the last completed month, and it is
what every label branches on to switch from *"Saved to date"* to *"Annual savings"*.

At rest the chart is **not** in the projected state: `onExit` restores the last mature month, so the bar
reads "Saved to date" at full opacity until you hover the projection region.

### Two hover paths, for two different questions

**Column activation** answers *which month am I on*. The voronoi container is one-dimensional in x, so a
hover activates every series at that month at once. Victory fires the callback once per activated child,
so `voronoiCount` counts them and collapses N callbacks into one enter and one exit.

**Point proximity** answers *am I near this specific dot*, which one-dimensional voronoi cannot tell you —
and the annotation tooltip needs exactly that. `CustomVoronoiContainer` exists for it: it overrides the
parent's `onMouseMove` handler to add a euclidean radius test in SVG space, then calls
`super.defaultEvents(props)` a **second time** to get a pristine copy of the original handler and delegate
to it. That second call is what keeps it from recursing into itself.

It overrides `onMouseMove` only. Victory routes touch through a separate `onTouchMove`, so **the proximity
path is mouse-only** — consistent with the tooltip, which is not rendered on mobile at all.

### Annotations are read-only here

An annotation is `{date, streamId, body}` hanging off a `Stream`. There is no annotation endpoint: saving
one writes the whole stream tree through `Core.saveStreams()`. An empty body deletes.

The chart **shows** them — a dot whose month carries an annotation is filled with a radial gradient
instead of the flat series colour, and hovering it opens a tooltip — but it cannot **create or edit** one.
`GenericChartView.handleClick` opens the editor; this chart overrides it to `return false` and passes no
click events at all. The editor is reached from `MiniGraph` instead.

Which annotations a dot consults is decided by a config object built at two separate call sites, one for
the dot's fill and one for the tooltip. Both deliberately map income onto the **savings** series, so
income-stream annotations surface on the savings dot. The two agree.

## Mobile and desktop

The chart is a fixed 450-unit-wide viewBox scaled to its container, so everything below is in SVG user
units rather than rem, and none of it can come from the design system's rem tokens.

| | mobile | desktop |
|---|---|---|
| annotation tooltip | **not rendered** | rendered |
| height | 200 | 170 |
| padding right | 120 | 60 |
| title / header / body font | 30 / 28 / 14 | 20 / 14 / 7 |
| projection bar width | 8 | 4 |
| dot size, hit radius | 4, 30 | 2, 15 |
| y scale factor | 1.1 | 1 |

`Core.isMobile()` is `window.innerHeight > window.innerWidth` and is read **in the constructor**, so
rotating a device does not restyle the chart until it remounts.

## Key decisions

**Imperative eventing instead of state.** Stated in the code and load-bearing everywhere: the wrappers,
the ref arrays, the `invalidate` flag and the manual `updateState` pokes all exist to avoid re-rendering a
chart that is expensive to draw. It is the reason this component does not read like the rest of the app.

**The projection is a field, not a method** — same motive, recorded in the same place.

**Income has no band.** It is built as a full series, kept configured, and switched off with
`render:false` and a comment reading *"optional - not rendered"*. Income folds into savings instead. The
series is left in place rather than deleted, so the decision is reversible by flipping one flag.

**The trend line is re-anchored to the last actual point.** Discarding the fitted intercept is not a bug;
it is what makes the dashed line continue the solid one instead of stepping away from it.

## Traps and known defects

Recorded because they are not visible from reading any single function.

- **The focus line and the bar it points at use different x values.** The line's projection anchor is the
  *snapped* 1st of the month; the bar sits at the *unsnapped* schedule date offset by a few days. Given a
  reporting day of the 21st, that is roughly seventeen days of domain apart.
- **The voronoi blacklist is asymmetric**: it excludes the expenses area but not the savings area, so the
  two bands do not behave identically under the cursor.
- **`utils.max` seeds with `Number.MIN_VALUE`**, which is `5e-324` — a *positive* number. Over an
  all-negative array it returns approximately zero rather than the true maximum. It does not bite today
  because the savings projection is normally positive, but it is a floor at zero on `My`.
- **`liveRenderComponents` never shrinks.** The base constructor pushes every chart instance into a
  module-level array and nothing removes on unmount; `componentWillUnmount` only clears an `_isMounted`
  flag that the refresh function then checks. The array grows for the life of the page.
- **`render()` mutates before it returns** — clearing the cached data and flagging every listener — and
  `.sort()` on the plot list sorts the *cached* array in place.
- **No `key`s** on the per-series arrays.
- **`getReportForDate` walks the whole schedule twice per call**, and `getReportSchedule()` rebuilds that
  schedule each time. It is called once per dot per render and on every qualifying mouse move, on the one
  chart whose stated constraint is that it is expensive.
- **Nothing defends an empty savings analysis.** The time axis comes from the savings schedule, so with no
  savings streams the axis is empty, the bound index goes negative and the domain resolves to `NaN`.
- **The three analyses are never checked against each other.** The time axis comes from savings, maturity
  and the plotted maximum come from expenses, and the savings series indexes the income array by the
  savings index.

### Dead code, confirmed

- `EndOfPeriodProjectionSummary` is exported and imported by `StreamAuditView.js` but **rendered nowhere**.
- `this.style.secondaryLabelsOffset` (100 on mobile) is read only into a `labelHeight` that is then never
  used, so the key has no effect.
- `summaryBarLabelYOffset`, marked *"not implemented"*, is never read.
- The `noTarget` and `noBar` branches are unreachable — only the income series sets them, and income is
  already filtered out by `render:false`.
- `getDomain()` exists in the base class and is used by `MiniGraph`; this chart inlines the identical
  expression instead.

### The class tree at the top of `AnalysisView.js` is stale

That comment block lists `GenericMultiAnalysisView` and `PeriodReportView`, **neither of which exists**,
and omits both `GenericChartView` and `EndOfPeriodProjectionGraph` — the two classes this file is
mostly about. Read it as history, not as a map.

## Boundaries

- **This file covers the chart, not the analysis.** How `netToDate`, `savedToDate` and the reporting
  schedule are produced belongs to the reporting core; the chart only consumes them.
- **`MiniGraph` is not a small version of this.** They share `GenericChartView` and diverge on domain,
  projection gating, click behaviour and annotation editing. A change to the base class touches both.
