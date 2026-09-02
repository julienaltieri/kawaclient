# The Money Flow

> Part of [`documentation/`](context.md) — see that file for what belongs here and how it's written.

## What this is

Page two of the visualisation carousel: where the money came from and where it went over a period,
as one picture. Income streams converge into a hub on the left of centre; savings and spending fan
out to the right. Tapping a stream opens it; tapping the one you are in comes back out.

Three files, and the split is the point:

| File | What it owns |
|---|---|
| [`MoneyFlowEngine.js`](../src/components/MoneyFlowEngine.js) | the picture. **No imports at all** — it takes a value and an element and draws. |
| [`MoneyFlow.js`](../src/processors/MoneyFlow.js) | the numbers. The only file here that knows about streams and transactions. |
| [`MoneyFlowChart.js`](../src/components/MoneyFlowChart.js) | the tile: the card, the title, and the wiring between the other two. |

The engine having no imports is not tidiness. It is what lets the whole visualisation be driven from
a bench instead of from production — see [The instrument](#the-instrument) — and what lets it be
reused later by handing it a different tree.

**Section numbers below are stable addresses**: the code cites them (`§7.19`), so anything learned
later is appended to its section rather than inserted.

---

## §1 The data contract

The engine consumes one immutable value per (period, basis) and reads nothing else.

```
FlowTree = {
  hubName : string                    // what the junction is called
  in      : Stream[]                  // sources — money entering
  out     : Stream[]                  // destinations — money leaving
  inTotal : number
}
Stream = {
  id, name,
  tone     : "income" | "savings" | "expenses" | "alert",
  value    : number,                  // >= 0
  children : Stream[] | null
}
```

**1.1 Money in equals money out.** The diagram has no way to draw an imbalance and nothing honest to
say about one.

**1.2 Two synthetic streams keep 1.1 true.** What is left after spending and deliberate saving is
`Unallocated` on the out side — still savings, just without a stream yet. When the outflow is the
larger, the shortfall is not negative saving: it is money that came from somewhere these streams do
not describe, and it appears on the in side as `From reserves`, in the alert colour.

`Unallocated` carries **no label** (`label:false`, which any stream may set). It is not a stream
anyone named or budgeted - it is the width between what came in and what was accounted for - and a
caption on it competes for the rail with the streams that were. `From reserves` keeps its name: it is
the alert colour and the exceptional case, and an unexplained red band would be worse than none.

**1.3 A parent is exactly the sum of its children.** Ribbons stack edge to edge against the parent's
thickness; if the two disagree they visibly overflow or leave a gap. This is why the adapter rolls
compound streams up from their leaves instead of reading `getExpectedAmountAtDateByPeriod` — that
would be a second author for the same quantity, and the two part company the moment a child is
filtered out (`DECISION-PRINCIPLES.md` #24).

**1.4 A stream worth less than one unit of currency is not in the picture at all** - not drawn, not
counted, not a target. Below that it cannot be seen and its name cannot be read, while it still costs
a slot in the rail that a stream worth reading needs. Dropping it unbalances nothing: a parent is the
sum of what SURVIVED (1.3), and the difference lands in the residual 1.2 already carries.

**1.5 Ids are stable across period and basis.** Every animation pairs entities by id, and the value
tween pairs by position within a stable shape. A shape that changed cannot be tweened, and the engine
falls back to a rebuild rather than interpolating mismatched trees.

**1.6 Ragged depth is normal.** Branches bottom out at different levels and nothing may assume a
uniform depth.

---

## §2 Reading the numbers

`buildFlowTree(master, transactions, {from, to, periodName, basis})`.

**2.1 The window and its name come from the analysis the view already built**, not from a calendar
of this feature's own. `MasterStreamAuditView` hands the tile its `StreamAnalysis`; the observation
period is the card's "year" and that period's own subdivision is the "month". One author for the
dates.

The sub-period is read off the analysis's SCHEDULE, not off `getCurrentPeriodReport()`. That report
is subdivided by whatever the analysis was built with - and the stream view builds this one with no
override, which leaves `ReportingCore` to fall back on the *master stream's own period*. Where that
is yearly, the "current period" is a year, and both halves of the toggle showed the same twelve
months. Asking the schedule for the subdivision's boundaries is independent of how the analysis
happened to be sliced.

**2.2 Which side a stream is on is decided by its DEFINITION, not by what happened to it.** Savings
by the flag, then income or expense by the sign of the expected amount — the same three-way split
`MasterStreamAuditView` already makes when it builds the macro graph's three analyses. A month in
which an income stream saw no money still belongs on the income side; it is simply worth nothing
(1.4) rather than moving.

**2.3 A magnitude, not an absolute value.** Each side's signed amount is multiplied by +1 (in) or −1
(out) and clamped at zero. An income stream that net-refunded therefore lands on zero instead of
appearing as a blob on the wrong side.

**2.4 Actuals read the two quantities the transaction types actually distinguish** — money in, and
money put aside — and which of the two a stream is read by is decided from the side it was
classified on, *not* from `isSavings` on the leaf. The app only depends on that flag being set at the
top level; a savings tree whose leaves did not repeat it would read as exactly zero, because a
transfer into savings carries no "money in" at all. Saving is money leaving the pot, so the saved
amount is negated to point the same way as spending.

**2.5 Target reads the stream's own expected amount** for the window's period, and the two agree
about the future and differ about the past — which is the comparison the toggle exists to make.

**2.6 An interest-income compound stream is dropped unless the feature flag is on**, because
`CompoundStream.getExpectedAmountAtDateByPeriod` drops it. If the flow kept it the two would disagree
about the total.

**2.7 A single top-level income group is unwrapped and lends the hub its name.** The hub *is* the
total money in, so a lone "Income" group standing in front of it is a level that says nothing — the
picture would read Income → Income → Salary. Where the in side is several streams they stay as they
are and the hub keeps its default name.

---

## §3 Navigation

**3.1** Tap a stream to open it: its children take the wide separation, theirs take the narrow one,
its siblings step back.

**3.2** Tap the stream you are in to come back out. Tapping it does nothing useful otherwise — you
are already looking at it — so the gesture is free, and it puts the way out **on the subject** rather
than on a control beside the picture. A "Back to all" button appears in the header for the jump
straight home.

**3.3 No breadcrumbs.** A trail reading "All flows > Spending > Lifestyle" answers the same question
the diagram is already answering, and the smaller answer is the one made of words.

**3.4 The whole band is the target** — a neighbour's ribbons, its bar and its name all navigate to
it, not just the word at the end of it.

**3.5 Sideways.** The focused band's neighbours are *named* at its top and bottom edges, up to two
each side, so moving sideways is a tap on something already in front of you rather than a trip up a
level and back down. Their own bands may be anywhere, including off frame; the name comes to the
subject.

**3.6 A neighbour is the head of the nearest branch that left the line of descent** — true siblings
if there are any, otherwise the parent's, and so on up. A stream that is its parent's first child has
nothing beside it above; but a band *is* visible up there, and leaving it unnamed made the top of the
picture dead.

**3.7 Nothing steps across the hub.** Income and the out side are not siblings: there is no move from
Savings to Income, only back through the middle and out the other way. The rule lifts at a hub place
— the root, or income opened — where both sides are below you.

**3.8 The hub is a place at both ends.** The root is the hub looking at where it all goes; `__inc` is
the same view mirrored. Its frame is not the income subtree alone — that leaves the hub, the thing
you are standing on, outside the window.

---

## §4 Layout

**4.1 Spacing is indexed by depth relative to the focus**, and that is the whole rule:

| where the pair's paths diverge, relative to the focus | separation |
|---|---|
| at or above the focus | the wide one — this is the split being explained |
| one below | the narrow one — distinct, but not being distinguished |
| deeper | none |

Moving a level re-indexes every gap automatically, which is what makes levels translate rather than
needing to be re-specified. Pairs not on the focused side read as one set; pairs outside the focus
get nothing.

**4.4 Gaps are capped** at a share of the column height, scaling down together, or a wide tier of
thin streams pushes the bars out of the card.

**4.6 Pitch is fixed by the root span** — one in column, the hub, two out columns — so the root view
fills the card and every other view is a camera move over the same grid, never a re-layout at a
different scale.

**4.7 ONE GEOMETRY FOR EVERY FOCUS.** The set of entity keys must not depend on the focus.
Structurally pruning what a view does not show changes the column count, which changes the keys,
which means two diagrams get drawn on top of each other during a move — seen as a bright overlap
where the ribbons double. Everything a view does not show is present and masked to zero instead.

**4.8** The focused side runs two columns past the focus, capped at that branch's terminal; the other
side shows exactly one, because it is context rather than subject. **Two columns always**: a view one
column wide gives a frame half as tall, and the focused band then overflows it.

---

## §5 The camera

**5.1 No scrolling and no panning.** The frame always holds one whole thing, so there is nothing
outside it to reach for.

**5.3 Reach toward a neighbour, not around it.** The frame extends toward each sibling's own bar by a
fraction of its height. Taking the union with a sibling's whole subtree meant focusing Savings pulled
in Spending entire, so opening a stream did not appear to open anything.

**5.4 The rail is a share of the frame, not a slab of the world.** A constant world slab is a small
part of the card at the root and most of it once zoomed in — and paying for it in world units is what
forced the frame so wide that the aspect correction handed the height straight back and the zoom did
nothing.

**5.5 Padding is asked for in screen pixels and solved for**, not iterated: the padding is part of
the frame, so widening the frame widens the padding and the two settle at once.

**5.6 HEIGHT FOLLOWS WIDTH, never the other way round.** Letting a tall subject widen the frame moves
*both* edges of the diagram, so the same stream lands somewhere different depending on what else is
on screen. **Left and right always land at the same x.**

**5.7 A subject taller than that height is squeezed, not cropped.** Every `y` scales toward the
frame's centre until it fits; no `x` moves and no text is scaled, only where text is anchored. The
flows are stretchable — the landing is what must not move.

**5.8 The junction is snapped to the device pixel grid.** Two translucent ribbons sharing an edge
cannot join cleanly unless that edge falls *on* a device pixel: split a pixel between them and
compositing two partial coverages falls short of one full one — a sub-pixel dip the eye draws as a
line down a flat field. The nudge belongs to the viewBox and is **never written back into the
camera**: storing it and subtracting it next frame is equivalent right up until the camera object is
replaced, and settling a move swaps in a fresh box while the previous correction is still owed.

---

## §6 Emphasis and fading

**6.1** Streams outside the focus dim. **6.2 Income never does** — it is not a sibling competing for
attention, it is where every stream on the page came from. It also has to stay lit: the hub's
outflows start at the hub's own strength, so dimming the in side puts a hard opacity step across the
junction.

**6.3 The horizontal fade is one gradient carrying both ends.** Each end is either the *reveal front*
— a stream trails off past its tail because there is another level behind it — or the *window's cut*,
whichever falls further in. The left fades over a shorter run than the right, because the left is
where a stream's own name sits.

**6.5 Whether a stream trails off or stops dead is a fact about the DATA**, and the geometry carries
it as a number per side: *does any stream whose own column is the front column have children*. It
blends across a move like every other number, and it is deliberately not derived from the front's
position at render time — the front is a blended coordinate, so a move back a level sweeps it
leftwards across the tier and a ramp keyed off it draws a plume for the length of the sweep, over a
tier with nothing inside it. Only the reveal half is scaled; the window's cut keeps its full run.

**6.6 The vertical fade applies only to what is out of focus, and never at a hub place.** A hub place
frames the whole height, so nothing in it is ever cut and nothing needs the fade that exists to prevent
cutting. Fading the far side there did to the junction exactly what 6.2 says dimming income does: the
two sides meet at the hub, one faded and one not, and the step between them is a hard vertical seam.
The root never showed it, because an empty focus already took that branch. Otherwise: The camera holds the focused stream
whole, so it never meets the top or bottom of the window and never needs softening. Neighbours do run
off, and rather than dissolving the window's edge — which softens exactly what should stay crisp —
they are brought to zero *by* the time they reach it.

**6.7 Its strength is what animates, over four layers** — was in focus or not, is in focus or not.
Switching a stream between two layers at the moment the focus changed applied the whole fade on the
first frame, while the camera had not moved yet.

**6.8 The mask has its own clock.** Going deeper, neighbours are being given up: the fade waits, then
takes as long as the camera. Coming back out they are being revealed, and a fade that lingers is the
seam arriving before the camera has hidden it — so that case is the mirror, starting at once and
finishing early. **6.9 The side plumes are not on that clock**: they describe where the diagram is
cut *right now* and follow the camera frame for frame.

**6.10 Ribbon colour ramps on a smoothstep.** Two linear stops start changing at full rate from the
first pixel; where a flat stretch meets that — most visibly at the hub — the value is continuous but
its slope is not, and the eye draws a line at the kink.

**6.11 A ribbon's two ends take the strength of the streams AT them.** The in side runs child to
parent, the opposite way round from the out side; reading it off "source" and "destination" instead
puts the child's strength at the parent's end and produces a hard step in colour exactly at the hub.

---

## §7 Labels

Names exist for the focused side from the focus's depth to two below it, and for the other side only
at the root. The last named tier goes in a **rail** beyond the end of the view, on the focused side
only — the other side's names belong beside their own bars, because there is no room reserved out
there for them.

**7.5 Appearing is a fade, not a switch.** Every test that decides whether a name is drawn — is its
bar in frame, is its stream thick enough, did the rail have room — yields a *number*. They multiply
and the product is eased.

**A name is readable or absent, never half-lit.** The thickness test used to ramp over a range of
band heights, which put a name that was perfectly in focus at a quarter opacity — and opacity is the
same channel the diagram uses to say *not what you are looking at*. A thin stream's name read as
dimmed, or as missing, with no way to tell which. It is a step now: below about half a line the band
carries no name, above it the name is at full strength, and the ease is what smooths the change. What
stops two names sharing a spot is the overlap test, which is unambiguous about who wins — the thicker
stream.

**A rail name sits on the bar it names.** The rail is drawn at the end of the view and so is the bar
it belongs to, so the name takes its position from THAT column and not from the stream's own. For a
branch that bottoms out early those are different columns with different stacking; reading the wrong
one put the name beside a band it did not name, and 7.16 then saw a name that had drifted off its bar
and gave it up altogether. That is why labels went missing on a ragged tree, and why which ones went
looked arbitrary.

**7.6 The tier arrives with the camera.** An ease cannot do that: it approaches asymptotically and
has no idea when the move ends. The tier is driven by the time *left* in the move. **7.7 It leaves on
the same clock, in every direction** — holding a name visible across a move looks like the right
kindness, but its place in the rail comes from a relaxation over a set that is itself changing as the
geometry blends, so it spends the move stuttering after the camera.

**7.10 The rail is placed as a set**: each name starts on its own bar and neighbours push each *other*
apart. A one-way sweep accumulates. **7.11 Pressure is weighted by how little a name has to give** —
a thick band barely yields, a thin one absorbs the push — so the faded ends absorb a crowded tier
rather than the branch being explained. Weighting every focused name alike let four hairlines shove
the one thick stream's name off its own band, and that band is the point of the view. And **7.12 whichever end escapes is pinned** — shifting
the whole column only works while one end has slack.

**7.14 The amount is given up before any name is.** It is worth twice the room the name is, and
zoomed in nearly every end qualifies for the two-line form. **7.16 A name that has drifted off its
own bar has stopped naming it**, so faded ends are given up until the focused branch's names sit on
their bars again — and never while the camera is moving, which would be a second source of jitter.

**7.18** A name's displacement from its bar is smoothed while the bar itself is followed exactly.
A consequence worth knowing: the frame pump stops once nothing is moving appreciably, so a label's
*resting* position is within that tolerance of its solved position and depends slightly on how many
frames it took to get there. Two runs land a hundredth of a screen pixel apart — do not write a test
that demands exact reproducibility here.

**7.19 The drawn left edge is smoothed too.** A name that swaps which side of its bar it sits on
jumps by its own width, because the anchor changes in one step while its x interpolates.

**A long name folds rather than being given up.** A name inside the diagram has one pitch of room
before the next column; a rail name has whatever is left to the edge of the frame. Zoomed in a long
name is longer than that: an interior one printed straight through the rail beside it, and a rail one
was dropped outright by the window test, so a thick stream with a long name simply went unnamed. Both
fold onto two lines instead, split at the space that leaves the halves most even. Whether a name folds
is decided BEFORE the rail is swept, so the room reserved for it and the room it takes are one
decision — and a folded rail name gives up its amount, which 7.14 gives up first anyway.

**7.20 Two names may not overlap, and the one on the bigger band wins** — which is what the draw order
already arranges, placing them thickest first. Only rail-against-rail is exempt, that order having been
settled by the sweep. Exempting the rail from the test entirely let a rail name print through an
interior one: two words in the same place, and neither of them readable.

**7.22 A pinned neighbour is a control, not a caption**: exempt from the edge and thickness fades,
single line, secondary colour, drawn at full opacity even though its stream is dimmed — a way out at
a fifth of full strength is not a way out. **7.23** They sit just *outside* the focused band, so each
sits over the stream it names and does not compete with the subject's own name for the middle.

---

## §8 Motion

**One clock.** Focus, camera, dim, masks and labels are driven from the same interval and land
together. A transition lays out both states and blends per key — numeric fields interpolate,
everything else takes the destination's value. `lit` is blended too, or a sideways move between two
siblings shows as an instant swap of what is bright.

Changing period or basis tweens the values and re-derives the layout each frame. **The values are
paired by ID, not by position.** The two bases do not hold the same streams — one with no transactions
this period is absent from the actuals and present in the target — so pairing by position could not
match them at all, and the picture snapped from one state to the other instead of moving. What animates
is the UNION: a stream in both travels between its two values, one in only one of them grows out of, or
shrinks into, nothing. 1.3 survives it, because a missing stream counts as zero on its own side and
interpolation is linear, so a parent stays the sum of its children at every step. `prefers-reduced-
motion` settles immediately.

---

## §9 The tile

**The header IS the title**: one line — *"Actuals this year"* — with the two words that could be
something else made tappable. There is nothing to label and nothing to explain; the sentence already
says which of the four views this is, and changing it is changing the thing.

**A period can legitimately hold nothing.** "A period is the whole of itself", so early in a
sub-period the sub-period is nearly empty and there is no picture to draw — and the boundary is the
reporting anchor rather than midnight, so this is not only a first-of-the-month case. That is the
truth rather than a failure, but an empty card does not say it, so a line does: *"Nothing yet this
month"*. It names the data, not the interface. The engine survives an empty tree on its own; the line
is the tile's job.

**The same tree is not a change.** Opening a stream calls back to the tile, which re-renders and
hands the tree straight back. If that counted as a change, its value tween would rebuild the geometry
every frame and overwrite the focus transition running underneath it. The tile memoises, so an
unchanged tree arrives as the same reference and the engine returns early on identity.

**The hover affordance is gated on `(hover:hover) and (pointer:fine)`.** On a touch screen a hover
state has no way to end — the browser leaves it applied after the tap, sitting on the label of the
stream you just opened, at the moment it should be brightest. A renderer that rebuilt its nodes every
frame would hide this by accident; this one reuses them by key, so it does not.

---

## §10 The invariants

Checked where they are produced, by `check()` on the engine, rather than from outside — twice in this
feature's history the external probe was the thing that was wrong.

- **I1** the hub seam is zero wide: the furthest-right in-side ribbon end and the furthest-left
  out-side ribbon start are the same x. This is the check that matters; an earlier version compared
  only vertical alignment and passed the entire time the seam was visible.
- **I2/I3** no gaps in either hub stack, and the two share a top and a bottom. A gap there would be
  money entering and not leaving.
- **I4** no two bars in a column overlap.

Beyond the engine, the properties worth holding are: nothing in focus is ever cropped, two subjects
at the same level frame to the same `x` and width, the key set is identical at every focus, and no
label reverses direction during a move. The rail-name rule and the key-set rule are asserted directly
against `layout()` in [`moneyFlowEngine.test.js`](../src/tests/moneyFlowEngine.test.js), which needs
no screen.

**What the invariants are for, in one example.** A bench mock built at realistic scale was quietly
unbalanced — its residual stream had been left out — and `check()` reported a hub bottom mismatch of
38 units before anything had been looked at. That is the whole argument for checking where the
numbers are produced.

---

## The instrument

`documentation/visualisation-carousel.md` records what it cost to converge the last visualisation
without one: five rounds, four of them shipped to production and judged by eye. This one has two.

**The numbers** — [`moneyFlow.test.js`](../src/tests/moneyFlow.test.js), run with
`npx react-scripts test`. It drives `buildFlowTree` through **real** `CompoundStream`,
`TerminalStream` and `GenericTransaction` objects rather than stand-ins, so what it asserts is what
production does. It caught the sign convention on savings: a transfer into savings leaves a
*checking* account, and typed the other way round it is worth nothing at all.

**The binding** — [`moneyFlowTile.test.js`](../src/tests/moneyFlowTile.test.js) mounts the component
against a real `StreamAnalysis`, so the accessors it reads off that object are the ones the analysis
actually has — a typo there costs a blank tile in production and nothing at build time. jsdom has no
layout, so the engine measures its host at zero width and declines to paint, which is the other thing
under test: a page that is not on screen yet must not throw.

**The picture** — the engine has no imports, so a bench page can load it with its `export` keywords
stripped, drive it beside the original prototype from one mock provider, and diff every `path`,
`rect`, `text`, gradient stop and mask the two produce. That comparison is what the port was signed
off on: identical across twelve states.

---

## Boundaries

- **The container** — its geometry, who owns a drag, how a page is added — is
  [`visualisation-carousel.md`](visualisation-carousel.md). This file covers only page two.
- **Page one** is [`macro-graph.md`](macro-graph.md).
- **What a transaction is worth to a stream** — the transaction types and their masks — belongs to
  the evaluator, and the flow only consumes it. A zero-sum stream needs no special case here: it is
  a stream whose transactions cancel, so it is simply worth little, and
  [`zero-sum-streams.md`](zero-sum-streams.md) owns what that means.
