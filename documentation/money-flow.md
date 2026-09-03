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
later is appended to its section rather than inserted. Every citation in the three files resolves to a
numbered statement here; if you add one, add the address too.

**Every constant is a named decision**, and they live together in `TUNE` at the top of the engine —
the two separations, the plume's length and the amount things dim by, the label timings and
tolerances, the two type sizes, the card's proportion, where the tail is gathered. The sections below
say what each one decides; the values themselves are in the code, which is the only place they stay
true. `TUNE` is exported, so a caller may override any of it without touching the engine.

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
  id, name,                           // id unique across the whole tree — see below
  tone     : "income" | "savings" | "expenses" | "alert",
  value    : number,                  // >= 0
  children : Stream[] | null,
  top?     : boolean,                 // one of the macro categories (9.6)
  label?   : boolean                  // false to draw the band but never name it (1.2)
}
```

**Ids must be unique across the whole tree**, not merely among siblings. The geometry keys a stream's
bounding box by id, so two streams sharing one union into a single box spanning both of them — and
since a box rolls up into its ancestors, the damage propagates to the root and presents as a broken
fit rather than as a duplicate. Nothing checks this at runtime; production ids come from stream ids
and are unique by construction.

**1.1 Money in equals money out.** The diagram has no way to draw an imbalance and nothing honest to
say about one.

**1.2 Two synthetic streams keep 1.1 true.** What is left after spending and deliberate saving is
`Unallocated` on the out side — still savings, just without a stream yet. When the outflow is the
larger, the shortfall is not negative saving: it is money that came from somewhere these streams do
not describe, and it appears on the in side as `From reserves`, in the alert colour.

`From reserves` also carries `outside:true`, which says there is more behind it than the picture
models — see 6.5 for what that does to its edge.

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

**1.2b Both leftovers are NAMED, and "Unallocated" sits at the top of the savings.** The unallocated
band went unlabelled at first, on the reasoning that it is not a stream anyone named or budgeted and a
caption on it competes for the rail with the streams that were. That is the worse trade: money that came
in and went nowhere is one of the more useful things the picture can say, and saying it with a blank band
left the reader to work out what the gap meant. Money from reserves was named from the start, for the
same reason read the other way round.

It reads as what it is, too: a band with nothing inside it, which means the tier treatment — out on the
rail with its amount beside it, like every other end of a branch (7.2). It sits at depth one, where the
tier is defined as depth two, so being terminal has to be enough on its own. It was drawn as a CATEGORY
before that — named inside its own band, with no amount — which is the one thing it is not.

Its place is an exception to size, and the mirror of the "Other" rule (3.2): a remainder goes last, but
what the month did not spend is the FIRST thing true about the savings side rather than an appendix to
it. Sorted by size it wandered up and down the stack from one window to the next, and a band that moves
for no reason the reader can see is a band they have to find again every time.

**1.5 Ids are stable across period and basis.** Every animation pairs entities by id, and the value
tween pairs by position within a stable shape. A shape that changed cannot be tweened, and the engine
falls back to a rebuild rather than interpolating mismatched trees.

**1.10 The tail is gathered into an "Other", and HOW MUCH tail is decided by the display.** The
question is not what share of the money the small streams are — it is how many of a set of siblings
can carry a name at once. A stream with a dozen children otherwise spends most of its height on the
two or three that matter and the rest on a fringe of hairlines: unreadable, unnameable, and in the way
of the ones worth reading.

It is answerable from the values alone because 5.3 makes the room a constant: whichever stream you
open, its children fill the frame less one strip at each end, so every set of siblings gets the SAME
height when it is exploded. **But that room is measured in real pixels, so it depends on the card's
width** — the bands scale with the card and a line of type does not, so a wider card holds more names
and gathers less. It therefore cannot be settled once when the tree arrives: `setTree` runs before the
host has been measured, and a grouping made there is made against a fallback width and never revisited.
It is redone whenever the width it was computed for stops being the width on screen, which also covers
a rotation or a resize. A label is centred on its band (7.16), so two neighbours can both be named
when the distance between their band centres covers a line of type — half of each band, plus the
separations between them. Gathering the smallest few buys room twice over, removing their labels and
merging their heights into one thicker band, so the tail grows by one until every surviving neighbour
clears that distance, and no further.

Only labelled streams are counted. The leftover declines a name (1.2), so it needs no room for one —
and it pushes its labelled neighbours further apart rather than crowding them. Counting it as another
label to place is what made the macro categories at the root look unnameable.

**The macro categories are never gathered**, whatever the arithmetic says. They are the spine the app
is organised around, the type reads its levels off them (9.6), and an "Other" standing where Savings
used to be says something false about the portfolio rather than something true about the room.

This is a VISUALISATION ARTIFACT, computed in the engine and nowhere else. No such stream exists in
the portfolio, nothing is categorised into it, and the reporting core has never heard of it — which is
why it does not live in the adapter: it is a decision about what is worth drawing, not about what the
money did.

**An Other sits at the bottom of its set, whatever it comes to.** It is not a stream competing for
position, it is the remainder — "and the rest" reads as the last line of a list — and a gathered band
that sorted above real ones by weight of numbers claimed a standing it does not have. Its own members
are still ordered by size inside it.

**And its members are gathered in turn.** Opening an Other is a view like any other and gets the same
rule: if its members cannot all be named at that level, the smallest of them gather into a further
Other inside it. Exempting it — on the grounds that "Other inside Other" says nothing — meant the one
view guaranteed to hold the thinnest streams in the tree was the one view where nothing was gathered,
and it showed bands with no name at all.

Two guards. The tail has to be at least two streams, or the group replaces one name with another and
hides a stream for nothing. And something has to be left outside it — a set that is entirely tail is
not a tail.

**Where this rule is weak, and it is worth knowing.** Gathering a TAIL only helps when there is one.
Where every stream is the same size, removing the smallest few leaves the rest exactly as crowded, so
the rule gathers until a single stream stands beside the Other — two labels where the reader might
have hoped for several. Real portfolios are heavy-tailed and this does not fire; a uniform one is
told, bluntly, that its streams cannot all be named. The alternative would be to keep as many as fit
and let the rest go unnamed (7.16), which trades a true statement for a quieter one.

Measured against the share-of-money rule it replaced, over eighteen exploded views of randomly
generated portfolios: 96 names shown of 120 offered, against 89 of 281. Much the same number of names,
against a third as many nameless bands.


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
and its siblings step back. Both have come down a long way from their first values, in three steps:
the wide one halved, because a gap that is easily read is still too much room to spend when the
subject's own children are what the view is for, and the narrow one quartered, because next to the
wide one it kept reading as the same gap rather than as a lesser one. What a separation has to do is
make the division visible, and past that it is height taken from the bands — which is the whole
budget the view is competing for.

**3.2** Tap the stream you are in to come back out. Tapping it does nothing useful otherwise — you
are already looking at it — so the gesture is free, and it puts the way out **on the subject** rather
than on a control beside the picture. A "Back to all" button appears in the header for the jump
straight home.

**3.3 No breadcrumbs.** A trail reading "All flows > Spending > Lifestyle" answers the same question
the diagram is already answering, and the smaller answer is the one made of words.

**3.4 The whole band is the target** — a neighbour's ribbons, its bar and its name all navigate to
it, not just the word at the end of it.

**3.5 Sideways.** The focused band's neighbours are *named* at its top and bottom edges, one each
side (two of them cost a second strip of the frame's height at both ends, and that height is the
subject's), so moving sideways is a tap on something already in front of you rather than a trip up a
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

**3.10 A tap that cannot go deeper still answers.** A stream with nothing inside it carried no handler
at all, so the last level of every branch was a place where tapping did nothing — and a control that does
nothing reads as broken rather than as the end of the road. The name is now a tap target like any other,
and the view springs a little toward the reader and settles: 3% in, back out through neutral, and to
rest, in 260ms. Enough to say the tap was heard; too little to be taken for a move.

It is a spring, not a shake. A shake is what a refusal looks like, and this is not a refusal — the reader
asked a reasonable question ("is there more inside this?") and the picture is answering it.

Names only, which is not a shortcut: within the focus the name IS the tap target (3.1), and it is only a
neighbour whose whole band navigates (3.4). Anything across the hub stays silent, because that is not an
end but somewhere the picture declines to go (3.7). The nudge is refused mid-move, where it would fight
the camera for the same frames, and under reduced motion, where the whole point is that nothing springs.

**3.9 `__inc` is a place you can stand, not a path prefix.** It is a focus value in its own right, and
the first element of the focus is what says which side you are on. Treating it as a prefix on the
income paths would make "standing on income" unrepresentable — there would be a focus for every income
stream and none for the group they belong to — and it is precisely the view 3.8 exists to describe.

---

## §4 Layout

**4.1 Spacing is indexed by depth relative to the focus**, and that is the whole rule:

| where the pair's paths diverge, relative to the focus | separation |
|---|---|
| at or above the focus | the wide one — this is the split being explained |
| one below | the narrow one — distinct, but not being distinguished |
| deeper | none |

Moving a level re-indexes every gap automatically, which is what makes levels translate rather than
needing to be re-specified.

**4.2 The other side is one set.** A pair that is not on the focused side takes a single separation
between them whatever their paths do, because the other side is context: its internal structure is
not the thing being explained, and spacing it as if it were competes with the side that is.

**4.3 A pair outside the focus gets nothing.** Two streams that are not under the focus at all are not
being distinguished from each other, so no space is spent saying that they differ.

**A separation is a number of SCREEN pixels**, converted with the scale the view will actually be
drawn at. It used to be converted once against the world and then carried through the vertical fit
like any other length — so zooming into a small stream multiplied the separations by the same
factor as the streams, and a seven-pixel gap arrived on screen at seventy, eating the room 5.3 had
just been arranged to give the subject. The rules of the picture are fixed; what stretches is the
money.

**4.4 Gaps are capped** at a share of the budgeted height, scaling down together, or a wide tier of
thin streams pushes the bars out of the card.

**4.5 The value scale is solved for last, against a budget.** The budget is a height and a value:
left to itself it is the whole portfolio filling the card; given one it is a stream's subtree filling
the frame (5.3). Either way the separations are settled first and the scale is whatever makes the two
together come to exactly the budget — so the subject fills its room, gaps included.

This is why the placement runs in two passes (`compose`). The frame's WIDTH comes from the columns
alone, so it — and therefore its height, and therefore the scale the view will be drawn at — can be
settled before anything vertical is decided. Only then is the layout run for real, told how much room
the subject has and what a pixel is worth. Fitting afterwards, by scaling a finished layout, is what
magnified the separations.

**4.6 Pitch is fixed by the root span** — one in column, the hub, two out columns — so the root view
fills the card and every other view is a camera move over the same grid, never a re-layout at a
different scale.

**4.7 ONE GEOMETRY FOR EVERY FOCUS.** The set of entity keys must not depend on the focus.
Structurally pruning what a view does not show changes the column count, which changes the keys,
which means two diagrams get drawn on top of each other during a move — seen as a bright overlap
where the ribbons double. Everything a view does not show is present and masked to zero instead.

**4.8** The focused side runs two columns past the focus, capped at the deepest column the tree has.
**Two columns always**: a view one column wide gives a frame half as tall, and the focused band then
overflows it. The cap is the tree's depth and not the subject's, so two subjects side by side frame to
the same width even when one branch bottoms out earlier than the other (5.6).

**4.9 The other side shows exactly one column**, because it is context rather than subject. It is
there to say where the money came from, which one column does; a second would spend the frame's width
on structure nobody asked to see.

---

## §5 The camera

**5.1 No scrolling and no panning.** The frame always holds one whole thing, so there is nothing
outside it to reach for.

**5.2 What the frame is drawn around** depends on where you are standing. An ordinary subject is framed
from its own box out to the end of the view. A hub place is framed from the far end of the focused side
to the far end of the other, because at the hub both sides are below you and the subject is the whole
picture rather than any one band in it.

**5.3 THE SUBJECT FILLS THE FRAME.** What is left is one strip at each end, holding one neighbour's
name above and one below — and, because the picture is continuous, the top of the band above and
the bottom of the band below, which is what makes them tappable.

Framing a subject at whatever height its own share of the money happened to give it is what made a
small stream unreadable. A stream holding a tenth of the frame gave everything downstream of it a
tenth of that again: its leaves came out as hairlines and their names went with them, while the frame
was mostly filled by neighbours nobody was looking at. The subject is the thing being explained; it
gets the room. Scaling to fit also standardises the view — every subject is framed the same way,
whatever it happens to be worth.

**A focus that names no subject is the root.** A path can go stale — a stream that has vanished under
a change of basis, or a caller's own bookkeeping — and there is then nothing to give the height TO.
`compose` resolves the path first and falls back to the root outright when it resolves to nothing.
That cannot be patched further downstream: the placement uses the path to find where the view begins,
and a path resolving to nothing puts NaN through every column, which draws nothing at all rather than
falling back to anything. `frame` frames such a path as a hub place, so the two agree if it is ever
called on its own.

This replaced an earlier rule that extended the frame TOWARD each sibling's bar by a fraction of its
height. That rule existed so neighbours could be seen and tapped, which the strips now do directly
— and it is the rule that let a small subject stay small.

**5.4 The rail is a share of the frame, not a slab of the world.** A constant world slab is a small
part of the card at the root and most of it once zoomed in — and paying for it in world units is what
forced the frame so wide that the aspect correction handed the height straight back and the zoom did
nothing.

That share came down once the names in the rail were set smaller (9.6) and no longer needed the width
they had. It paid twice: measured across nine focuses, the tier went from naming two streams to naming
five on the widest of them, every name still within a few pixels of its own bar.

**5.5 Padding is asked for in screen pixels and solved for**, not iterated: the padding is part of
the frame, so widening the frame widens the padding and the two settle at once.

**5.6 HEIGHT FOLLOWS WIDTH, never the other way round.** Letting a tall subject widen the frame moves
*both* edges of the diagram, so the same stream lands somewhere different depending on what else is
on screen. **Left and right always land at the same x.**

**5.7 The fit is done by the LAYOUT, not by scaling a finished picture.** 5.3 is made true by
choosing the value scale (4.5), which is the only place that can give the subject its room while
leaving the separations the size they are meant to be. No `x` moves and no text is scaled, only where
text is anchored. The flows are stretchable — the landing, and the rules, are what must not move. A
hub place is the exception: nothing stands beside it (3.7), so the whole picture is fitted to the card
as it always was.

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

**6.4 How far a stream steps back, and how long the plume runs, are each one constant.** `dim` is the
opacity everything out of focus falls to; `softFrac` is the plume's length as a fraction of the column
pitch, so it scales with the grid rather than with the zoom; `leftShare` is how much of that run the
left end gets, which is shorter because the left is where a stream's own name sits (6.3).

**6.5 Whether a stream trails off or stops dead is a fact about the DATA, and it is asked PER BAND**:
does this stream's own column end at the front, and does it have children — **or does it say of itself
that there is more behind it**. `From reserves` (1.2) has no children and never will: it is money drawn
from savings the flow does not model. Cut hard among neighbours that trail off, it left a notch in the
edge of the picture exactly where it sat. What is behind it is real, just not drawn, which is precisely
what the plume says, so the adapter marks it `outside` and it trails off like the rest. Two bands can sit side by
side at the same front and answer differently — one continues inside, its neighbour is terminal — so a
single gradient across the whole picture, giving them one edge, made a terminal stream trail off
because a sibling had something behind it. Everything is cut hard at the front and the softened edge is
laid over only the bands that continue, one extra rect each in the mask, at both ends. A stream that
bottomed out earlier and slid out to the end column is not one of them: it has nothing behind it
however far the view runs.

It is deliberately not derived from the front's POSITION at render time. The front is a blended
coordinate, so moving back a level sweeps it leftwards across the tier, and a ramp keyed off it draws a
plume for the length of that sweep over a tier with nothing inside it.

**Each rect covers only the region BEYOND the front, on its own side.** A mask paints its shapes over
one another, and two semi-transparent whites composite to something brighter than either — so a rect
laid over the background across a whole side doubled the mask wherever both were partly open, which is
exactly the window's fade. Where the mask was already 1 it saturated and nothing showed; in the fade,
at about a fifth, it doubled, and the cut edge gained a brighter strip on every band that had a plume.
There is nothing to lay over until past the front anyway: up to it the two gradients say the same
thing, and past it the background is cut to zero, so the plume adds to nothing and lands as drawn.

**And each is clipped to its own side.** A full-width one covers that band's rows across the whole
picture, so a stream continuing on the out side also softened the IN edge at that height — and because
the two sides stack independently, an income band's rect landed over whatever out-side band shared its
rows and gave that one a plume it had no claim to. On screen that read as the plume breaking into
stripes of different strength, and as the leftover band trailing off for no reason. A band's edge is a
statement about its own end.

**The two ends of the gradient are independent.** Taking the minimum of "where the left ramp ends" and
"where the right ramp starts" truncated the LEFT ramp whenever the right one began earlier — and the
right ramp is the plume, whose length is the band's own business, so each band's left edge faded over a
different distance. They meet only if the two ramps overlap, and then they meet in the middle.

**The window's cut keeps its full run** whatever the band answers. "The view stops here" is true
whether or not there is more inside, so only the reveal ramp is the band's business. Building the
hard-cut gradient with no ramp at either end took the window's feather with it, and the picture gained
a sheared edge wherever the camera cuts through it — which, once you are zoomed in, is most of the time.

**The ramp is the band's number, not a threshold on it.** The answer blends like every other number
across a move, so a band losing the level behind it shortens its plume as that level goes away and one
gaining a level grows the plume as it arrives. Testing it against a half instead made a band jump out
of the plumed set at the midpoint — the plume vanished in a single frame, which is what a threshold
does to a quantity. The band's own VISIBILITY scales it for the same reason rather than gating it: a
bar arriving at the front fades in, and admitting it only once it passed half meant the plume appeared
already a third of the way out. Both numbers multiply, so the plume grows and shrinks with its band.
Measured on one band, in and out: 0, 0, 0.04, 0.24, 0.64, 0.90, 0.99, 1 — and the reverse.

Asking it per band retired a per-SIDE flag that carried the same fact for a whole side, together with
the rule that made it hold at the value both states agreed on and then arrive with the camera. None of
that is needed here: a stream terminal in both states answers zero in both, so it cannot plume at any
point of a move, which is the whole of what the flag was protecting.

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

**6.12 A ribbon is a cubic, filled flat.** Its control points sit at a fixed fraction (`curve`) of the
horizontal span, so every ribbon in the picture has the same shape of bend regardless of how far it
travels, and the fill is one base opacity (`baseOp`) rather than a gradient along its length — the
gradient it does carry is the horizontal fade of 6.3, which is a different statement. Ribbons overlap
constantly, so the base opacity is chosen for how the overlaps read, not for how one ribbon reads.

---

## §7 Labels

**7.1 Which names exist.** On the focused side, from the focus's depth to two below it; on the other
side, only at the root. Anywhere else the other side is context, and naming it competes with the side
being explained.

**The tier is a LEVEL, not a leftover.** A name belongs in the column its own level occupies, and only
the level the view ends on is written down the tier. A stream that bottoms out early has its band slid
out to the end column like any other (9.3), and its name used to follow the band there — so a gathered
Other, or a category with nothing inside it, was written on the right-hand edge among the leaf names
while its own siblings were named a column to the left. It reads as a demotion, and it jumps a whole
column when you open it, which is the one moment the eye is following it. The band still slides; only
the name stays put, and it is still on its own band, because that band runs the width of the view.
Where the view ends at the level below the focus — an exploded last level, with no column in between —
that level IS the tier and its names are written there with their amounts (7.2).

**7.30 A parent and its only child are ONE band.** Nothing separates them — the parent's value IS the
child's — so they are drawn on the same pixels, and two names cannot sit there. The one that belongs is
the PARENT's: it is the way in, and the child is what the way leads to.

It also takes the tier slot the child would have had, which is what gets it past the thickness test
(7.16). That test exempts a rail entry and not a caption, and a pass-through band is often thin — so
drawn as a caption the parent was dropped for thinness while the child kept its name on the very same
band. The reader was shown the end of a road, with the road itself hidden and untappable, and no way to
see why the thing in front of them carried no amount: it was two levels down behind a level that was
never drawn.

Not when the parent IS the focus: the subject is a caption, and its only child is what you opened it to
see. Standing in for the child is something a parent does from a distance.

**And the band trails off like the parent would.** The plume (6.5) is read from the band, and the band's
own stream has nothing inside it — so a label the reader can open sat against a bar cut hard, looking
like the end of the branch and then opening anyway when tapped. Where a parent stands in, the name on
the band is not the band's own, and that name has something inside it. The plume says "you can go
further here", and here you can.

The alternative was to unwrap single-child groups outright, as 2.7 does for the income group at the top
of the tree. That was rejected: the structure is the household's own, they navigate by it, and a
category name earned by organising the portfolio should not vanish in the periods where it happens to
hold one stream.

**7.2a A stream with nothing inside it is a terminal band wherever it sits.** The tier was defined by
depth alone — two levels below the focus — which reads the layout as a statement about distance, when
what it actually says is *this one opens, that one does not*: a caption inside the band for a stream you
can go into, an entry on the rail for one you cannot. A childless stream one level below the focus took
the caption, so it looked like a way in and was not.

"Unallocated" is where that showed every time, because it can never have anything inside it — it sat
between the two treatments and read as neither. But it was never only about that band: any terminal
stream standing beside a compound one had the same problem, and fixing it for one id would have left the
rest. Depth is the usual way to be terminal, not the only one. Macro categories keep the caption
regardless — they are the spine, not entries in a list.

Cheaper than it looks: the phone drew MORE of its names, not fewer — 6 undrawn of 78 offered against 8
of 77, because a caption inside a band competes for the same room the bands need.

**7.2b The amount goes on a dead end at the level you opened, and levels are counted after the
grouping.** A name fans out — against the inside of its bar, its amount beyond — when it is a stream
one level below the focus with nothing inside it. That is the level you asked to see, and the end of
it. Anything deeper is on the page for context, and numbering it has the picture answering a question
you have not put yet: go one level in and it will.

Deciding it once for the whole view (7.2) was the first attempt and took the amount off a terminal band
because a SIBLING still had children. Deciding it from the band alone — every dead end numbered,
wherever it sits — was the second, and put numbers two levels down on branches the reader had not
opened.

**An "Other" counts as a level, like any other parent.** Discounting it was tried and is wrong twice
over: it is a band the reader opens and stands inside, so its members really are one level in — and when
the Other IS the focus it cancels from both sides of the subtraction anyway, so the idea cannot even
reach the case it was invented for.

**And "one level below the focus" means below THIS focus**, not merely at the same distance from the
hub. Read as a difference of depths, it counted any stream in any branch that happened to sit at that
depth: opening a category put amounts on the leaves of the category BESIDE it, and opening an Other put
one on a leaf in an unrelated branch of the same parent. The path has to start with the focus's own.

Money from outside (6.5) is excluded: it trails off rather than stopping, so it is not an end.

Measured across six trees at two card widths, none of this moved the undrawn count (6 of 78 on the
phone, 14 of 87 on the desktop).

**7.2 At the last level of a branch the tier fans out**: the name against the inside of its bar, the
amount beyond it. A name belongs to its band, so it goes on the side the band is and reads as a caption
on the thing it names; the amounts then line up in a column of their own out at the edge, which is what
a column of numbers wants. It also puts the two on ONE line — the amount used to be a second line
beneath the name, which cost the tier more than twice the height per entry and made it the first thing
given up when the tier ran short (7.14).

**Only when nothing stands between the focus and the tier**, decided once for the whole view. When the
tier IS the focus's children, the run inside each bar is empty and the names can have it. As soon as
there is a column of names in between, that run is shared — and those two are not strangers: a tier
entry's parent IS the name it would meet, and its band contains the entry's band, so they arrive on
nearly the same row and want the same place as a rule rather than by accident. There is often not room
for both: at the root, "Spending" alone is over half the pitch, and a single word cannot be folded to
fit. Whichever entries lose then **fall back outside the bar**, giving up their amounts for the place
the amounts were in — and the tier ends up holding two spellings, one name against its bar wearing its
amount beside a sibling out past the bar with none. That reads as the labels being inconsistent rather
than as the data differing, which is why the question is asked of the view and not of each entry: the
view is either at the end of the branch or it is not.

Two ways of asking it were wrong before this one. "Is anything behind the front" is the plume's fact
(6.5), not this one — the income side bottoms out at two levels, so its view can have nothing behind
the front AND a column of names in the middle, which is exactly where the mixed spelling came back.
And the question has to be asked of the FOCUSED branch: a stream in another branch at the same depth is
not standing between this focus and its tier, and letting one veto the fan-out answers a question about
the whole tree instead of about the view.

**7.31 A name folds into as many lines as the room needs, up to four.** Folded in two and no
further, a name whose longer half still overran the rail was dropped outright by the window clause of
7.20 — so the widest band of a set could be the one that went unnamed, purely because its name
happened to be the longest. Measured at three levels into a real tree, where the rail has 160 world
units to give:

```
Loki Groceries & Hygiene   in two: "Loki Groceries" / "& Hygiene"   needs 179   dropped
                           in three: "Loki" / "Groceries" / "& Hygiene"   needs 121   drawn
Loki Medical               one line   needs 156   drawn
Loki Repairs               one line   needs 152   drawn
```

Fewest lines that fit, and four is the cap: past that a label is a paragraph, and the band it names has
not grown to hold it. The split is exact rather than greedy — the words are few, and a greedy pass gets
this very name wrong. Minimising the longest line and minimising the difference between two are the
same thing, so the two-line case is unchanged, and the reservation (7.13) keeps its measured asymmetry
there; only the third and fourth lines are reserved either side of the baseline, because the block of
lines is centred on the row.

It cost nothing in names: measured across six trees at two card widths, the undrawn count did not move
(6 of 78 on the phone, 14 of 87 on the desktop).

**7.32 The run inside the bar is shared by what the two names TAKE, not half each.** A fanned tier
name (7.2) runs back toward the previous column and meets the caption there, which is its own parent
(7.3) — so half the pitch was the safe division to make without measuring. Measured, the halves are
rarely fair. At the last level of a branch there are only two labels in play: the node's name, left
aligned, and the leaf's, right aligned against its bar. "Loki" wants a fifth of the run; "Loki
Groceries & Hygiene" wanted two-fifths, so it folded to four lines with an ampersand alone on the third
while most of the other half went unused:

```
half the pitch        room 111   needs 313   four lines
measured to "Loki"    room 578   needs 313   one line, with its $388 beside it
```

The tier name now has the run up to where its parent's caption actually ends, floored at the half it
had and capped by the window — wider than the card would trade a folded name for no name at all, since
7.20 drops what runs off it. Where the parent is not on screen there is nothing to measure against and
the half stands, which is what it was for.

This only reaches the FANNED case, and that is the point: 7.2 fans out only when nothing stands between
the focus and the tier, so the caption being measured against is the only one in that run. A tier name
written outside its bar keeps the rail, which is its own and competes with nothing.

**7.3 A name sits on the side its own sub-structure is on** — the side the view extends towards — and
the room it has is one column pitch. A tier entry is the exception and 7.2 has it: written inside its
bar it gets half that run, because the other half belongs to the name at the previous column; written
outside it gets the rail, which is its own. Zoomed in, a long name is longer than that and reaches into the
rail beyond, which is how two names came to be printed in the same place; a name too long for its room
folds onto two lines rather than being given up (7.17).

**7.4 Only the focused side has a rail.** The other side's names belong beside their own bars, because
there is no room reserved out there for them.

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

**7.6 ANYTHING that arrives lands with the camera, and not before it.** An ease cannot do that: it
approaches asymptotically and has no idea when the move ends. What arrives is driven by the time
*left* in the move instead. A name already being read is never pulled down (7.8), so this only holds
back the ones that were not there.

This used to apply to the tier alone. A neighbour's name coming into a view therefore ramped up on
its own ease — about 135ms — and then sat at full strength while the camera was still travelling,
which reads as appearing from nowhere rather than arriving. Measured after: every arriving name ramps
over about 220ms and reaches full between 610 and 660ms, against a move of 620. **7.7 It leaves on
the same clock, in every direction** — holding a name visible across a move looks like the right
kindness, but its place in the rail comes from a relaxation over a set that is itself changing as the
geometry blends, so it spends the move stuttering after the camera.

**7.9 The tier follows that clock exactly; everything else eases.** Across a move the tier's opacity is
the clock's value outright, because the whole point of 7.6 and 7.7 is that it lands with the camera.
Every other name eases from whatever opacity it currently has — never from zero — so a name that was
already partly drawn continues from there instead of restarting.

**7.10 The rail is placed as a set**: each name starts on its own bar and neighbours push each *other*
apart. A one-way sweep accumulates. **7.11 Pressure is weighted by how little a name has to give** —
a thick band barely yields, a thin one absorbs the push — so the faded ends absorb a crowded tier
rather than the branch being explained. Weighting every focused name alike let four hairlines shove
the one thick stream's name off its own band, and that band is the point of the view. And **7.12 whichever end escapes is pinned** — shifting
the whole column only works while one end has slack.

**7.17 A pinned name folds against the run it will have when it is the SUBJECT**, not against the whole
card. It is the same name in the same place a moment later — stepping sideways makes a neighbour the
subject — so measuring it against the width of the card while pinned and against one pitch on arrival
made it change shape at the moment the eye was following it. Two subjects at one level frame identically
(5.6), so the same name at the same level now folds the same way whether it is pinned or focused.

**7.13 The room a name reserves is what it MEASURES, plus a lead.** The extents here were once
constants calibrated at body size, from the layout that stacked the amount beneath the name, and they
reserved half again what a line of type occupies: at ten pixels a tier name inks twelve and was given
sixteen and a half. The tier then pushed names off bands they would have fitted on, and the gathering
(1.10) asked for more room than it needed and gathered streams that could have kept their names. One
measurement replaces the guess, and the gathering asks for the same number, so the two cannot drift
apart. The split between above and below the baseline is kept, because the baseline does not sit in
the middle of the ink.

**The room a name reserves is measured, not assumed.** The sweep has to know each entry's height
before it places anything, so whether a name folds onto two lines and whether its amount is shown are
settled first, and the extents are then read from the type it will actually be set in — which is why a
small name reserves proportionally less and the tier gains stacking room (9.6).

**7.15 What gets dropped is decided by focus first, size second.** When the tier cannot hold every
entry, anything outside the focused branch goes before anything inside it, and within a group the
smallest band goes first. A name's importance here is the branch it belongs to, then the money it
stands for.

**7.14 The amount costs width, not height.** It sits beside its name on one line (7.2), so it takes
nothing from the tier's budget and is never what gets given up when the tier runs short. It was a
second line beneath the name once, worth twice the room the name was, and it WAS the first thing given
up — that rule is gone with the stacking that made it necessary.

**7.16 A name that has drifted off its own bar has stopped naming it**, so names are given up until
the focused branch's names sit on their bars again. **How far is too far depends on the BAND**: a flat
tolerance says nothing about whether the name still points at anything, and eight pixels is comfortably
inside a fat band and completely outside a seven-pixel one — which is where names were landing, clear
of the hairline they named. The tolerance is half the band, never more than `driftPx`.

This runs DURING a move as well as at rest. Held back until the camera stopped, every name that could
not keep its bar was given up in the single frame after it landed, and the survivors shifted two or
three pixels as the tier re-solved around the gap — a shuffle at exactly the moment the eye has settled
and is reading. Run continuously, a name losing its bar fades out over the move instead, and nothing
changes on arrival. The jitter the old guard protected against does not appear: the set only shrinks as
the geometry blends toward a view that holds fewer names, so it moves one way. Alignment is the inviolable half of the rule and MEMBERSHIP is what
gives: a name that cannot sit on its bar is not shown at all. Out-of-focus names go first and the
smallest band next, never the subject's own — the biggest-first ordering of §1 again, the largest
bands being what the view is for.

That second clause was missing for a while and the rule could not fire at all: the rail is built
from in-focus names only, so the search for something out-of-focus to give up found nobody and gave
up instead. It was dead in exactly the case it was written for — a subject whose own children crowd
their own rail, the ordinary case at five children or more — and five names packed into room for
four, with the top of the stack clamped to the frame and the largest band's name pushed fifteen
pixels off it.

Measured on the bench at nine focuses, the worst offset of any rail name from the band it names is
ten screen pixels, about half of which is the text baseline sitting below the centre. Note this is
not reachable from jest: the relaxation needs real text metrics and a real width, and jsdom has
neither, so the engine declines to paint. The bench IS the test for anything in 7.10–7.17.

**7.18** A name's displacement from its bar is smoothed while the bar itself is followed exactly, so
the name never lags the thing it names. This is why the at-rest rule cannot simply smooth the absolute
position the way a move does (7.28): bars move at rest too — a change of basis tweens them over its own
clock with no move running — and a name smoothing its absolute position would lag its own bar. What a
resting position is reproducible to is a property of the pump; see 8.6.

**7.25 A name that changes place stays VISIBLE while it moves.** Fading it out and back in was tried
and rejected: it keeps the motion short, but the eye loses the word entirely for a moment and with it
any sense that the thing it names is the thing that just moved. Keeping it visible is only affordable
because of the three rules below, which between them cut a sideways move from 174px of travel with a
53px jump to 62px, monotone, at full opacity.

**7.24 Membership is decided by where the move is GOING, not by how lit a name is now.** Which names
belong to the focused branch is read from the destination, once. Reading it from the blend instead
makes it a coin toss on the first frames, when the two states nearly coincide — and a name that
flickers in and out of the set bounces between the slot it would take and the bar it sits on.

**A pin takes the focused name's ANCHOR as well as its x.** It is placed in a slot of the camera's, in
a column shared with the subject — but it keeps whatever form its own name had, and a name that was a
tier entry is anchored at its END. Given the subject's x and its own anchor, it drew right-aligned to
that x: hanging off the left of the column while its neighbour ran to the right of it, which looks
exactly like one label having come loose. Same slot, same edge.

**7.23 The neighbour slots belong to the CAMERA, not to the geometry.** By 5.3 the subject lands
filling the frame less one strip at each end, so at rest these are the same two lines. During a move
they are not: the geometry is a blend, and the subject's band starts wherever it sat in the view you
came from and grows into place. Anchored to it, the pins' target swept the height of the card and the
names chased it.

**7.26 WHICH names are pinned is settled once, from the destination.** During a move the subject's
band starts where it was in the view you came from, so "is this neighbour above or below it" is a coin
toss on the first frames and the answer flickers — pinning and unpinning a name frame by frame and
sending it bouncing between the slot and its own band. Decided from where the move is going, it holds.

**7.26b A pinned name smooths its ABSOLUTE position.** 7.18 smooths a caption's displacement from its
bar, which is right for a caption. A pinned name is attached to the frame instead, and smoothing a
displacement from a bar it is not on made it inherit that bar's motion: leaving focus, a stream's band
swings from filling the frame to far outside it, and the name rode that swing with a lagging
correction on top. Either store seeds itself from where the name was last drawn, so switching between
the two is continuous.

**7.27 All of this is in SCREEN pixels.** The world is not a fixed scale: opening a stream re-scales
it so the subject fills the frame, by a factor that can be ten. Smoothing a world coordinate toward a
world target while the world is being re-scaled leaves a name apparently still in a space that is
moving underneath it, which was most of the flying. In screen pixels, where the reader's eye is,
"barely moved" means what it says.

**7.28 Across a move a name travels on the MOVE's clock, not on a per-frame fraction.** Both stores
above close the gap to their target by a constant share of it each frame. That is right at rest —
the gap is small and its cause is jitter — and wrong on a move, where the gap can be the height of
the card and the *bar* is travelling too, on the camera's eased clock over `moveMs`. At 13% a frame
the displacement is all but gone in 150ms while the bar still has 470ms to run, so the name lands on
its bar early and then rides it the rest of the way.

Invisible while the name was already near its bar, and glaring in the one case it matters: a pinned
neighbour tapped into focus. A pin sits in a camera slot, on screen by construction (7.23), while the
bar it names is the one just off the top of the frame — so the name jumped to the off-screen bar
within a few frames and sailed back down into place, which reads as arriving from off screen rather
than as moving from where it was. Measured on a bench shaped like the real portfolio, tapping the
neighbour above from the last of three categories:

    before   10 → −16 → −30 → −32 → −22 → 4 → 37 → 58 → 69 → 73
    after    10 →  10 →  11 →  12 →  17 → 30 → 48 → 62 → 70 → 72

with the card 145px tall, so the "before" row spends its first 250ms above the top edge. 148px of
travel with two reversals becomes 62px with none. Swept over every move between siblings in the
bench — up, down, and back out to the parent — no name leaves the card and none reverses.

**And it is aimed at where the name LANDS, not at where its bar is that instant.** Decaying a
displacement on the clock was the first answer here, and it is only right while the bar's *screen*
path is close to linear in the clock. Re-scaling bends it badly: opening a small stream can leave a
sibling's bar 656px above a 145px card, and that bar then covers most of its journey in the second
half of the move while the offset falls at a constant rate — 324px of offset against 135px of bar in
the first half, so the name sailed off the top of the card and came back. Exactly the fault this
section exists to prevent, surviving in the one case where the arithmetic was extreme enough.
Interpolating between the two ENDS cannot do that: it is monotone by construction and exact at both.

The destination is read from the geometry the move is going to, which is held for the duration
(`moveTo`). A pinned name needs no such lookup: its slot belongs to the camera (7.23), so its target
is already still.

The seed is taken once, at whatever progress the name first appears, and the remaining travel is what
is left of the move — so a name appearing midway is not asked to cover the whole distance in the time
that is left. Both at-rest stores are kept current underneath, so the exponential smoother picks up
where the move leaves off.

**The landing place is the destination's bar PLUS what the tier's relaxation owes it there.** Aiming at
the bare bar meant a name arrived a couple of pixels off its resting place and then eased the rest of
the way once the camera had stopped — the same shuffle 7.16 is about, seen from the other direction.
The relaxation is solved on the blend and converges to the destination's as the move completes, so by
the time it matters it is the right number.

This is also why the at-rest rule cannot simply smooth the absolute position the way the move does:
bars move at rest too — a change of basis tweens them over `dataMs` with no move running — and a name
smoothing its absolute position would lag the very bar it is naming, which is what 7.18 exists to
prevent.

**7.21 The label constants.** `leadMs` is how long a name has to leave or arrive inside a move;
`driftPx` is how far a name may sit from its own bar before it has stopped naming it (7.16); `edgePx`
is the distance over which a name fades as its bar reaches the edge of the frame. They are named
because each is a decision, not a magic number, and they live together in `TUNE`.

**7.29 A name that runs past the edge of the card fades out** rather than being chopped by the
viewport. Most names cannot get there: one that leaves the frame sideways is dropped outright (7.20),
and one whose bar approaches the top or bottom fades on its own (7.5). A PINNED name is exempt from
both — it is a control, placed against the edge by the camera rather than by its bar (7.23) — so a
folded one reaches past the bottom of the card and was cut clean through its second line. The fade is
a few pixels at each edge, which costs a name that fits nothing at all and turns a sheared word into
one that visibly runs out of room. It cannot be prevented at placement instead: whether a name folds
is settled after the pins are placed, because folding depends on the room the camera gives it.

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

**8.1 One clock.** Focus, camera, dim, masks and labels are driven from the same interval and land
together. The state is what interpolates and the geometry is re-derived from it each frame, rather
than each part animating itself — which is the only way the picture can be internally consistent
mid-move: a ribbon, the bar it lands on and the name beside it are all read from one geometry.

**8.2 A transition blends per KEY.** It lays out both states and pairs entities by their key — numeric
fields interpolate, everything else takes the destination's value. **Some numbers are not quantities**,
though: they are facts that happen to be written as a number, and interpolating one produces a state
that never existed. A name's level relative to the focus is 1 or 0 and never 0.4, and the type rule
that reads it compares it against a level — so a lerped value tested false for the whole move and
became true on the last frame, which is a snap at the end rather than a change travelling with the
move. Those fields are listed and taken from the destination. This is exactly why 4.7 insists the
key set never depends on the focus: if the two sides hold different keys, the pairing fails and two
diagrams draw at once. `lit` is blended too, or a sideways move between two siblings shows as an
instant swap of what is bright.

**8.3 The move's own progress is eased**, and everything keyed to it — camera, geometry, the distance a
name has left to travel (7.28) — reads that same eased value, so nothing arrives early or late relative
to the picture it belongs to.

**8.4 The value tween is a separate clock from the move.** Changing period or basis tweens the values
and re-derives the layout each frame, over its own duration: it is a change of *what is being shown*
rather than of *where you are standing*, the two can overlap, and giving them one duration would make
a basis change feel like navigation. **The values are
paired by ID, not by position.** The two bases do not hold the same streams — one with no transactions
this period is absent from the actuals and present in the target — so pairing by position could not
match them at all, and the picture snapped from one state to the other instead of moving. What animates
is the UNION: a stream in both travels between its two values, one in only one of them grows out of, or
shrinks into, nothing. 1.3 survives it, because a missing stream counts as zero on its own side and
interpolation is linear, so a parent stays the sum of its children at every step. `prefers-reduced-
motion` settles immediately.

**8.5 The two sides of a tween must share a SHAPE.** It animates the union, pairing by id, and that is
only a tree while every stream sits under the same parent on both sides. The gathering is decided from
the values (1.10), so a different window gathers differently — and then a stream is a child of its
category on one side and a member of that category's Other on the other. The union holds it in BOTH
places, counts its value twice, and what comes out is not a Sankey of anything: ribbons crossing,
parents smaller than their children. Switching period back and forth was enough to see it.

**Refusing to animate was the first answer, and it was worse than the fault.** The picture jumped on
every change of window — which is the one moment when all the streams are still there and only their
sizes have changed, exactly what an animation is for. Instead, the state the tween starts FROM is
rebuilt on the DESTINATION's shape, carrying the values that are on screen now: every id lands under
one parent, every parent is the sum of its children (1.3), and the tween is a pure change of size from
there.

**Rebuilding on the destination's shape must not lose what is LEAVING.** Built from the destination's
nodes alone, a stream the destination does not hold was dropped outright: it never entered the union,
so it could not travel to zero, and it blinked out on the first frame instead. Money from reserves
(6.5) is what made it visible — an extra band on the in side is itself enough to change how the tail
gathers (1.10), so gaining or losing one is precisely the transition that takes the rebuilt path — but
it was never about reserves: on any change of basis that regroups, a fifth of the in side could
disappear in a single frame. A stream the destination does not place has no conflict to resolve, so it
is carried into the from-state under the parent it had, and leaves by shrinking like anything else.

It is carried only where the destination still holds that parent AND that parent is compound there — a
stream cannot hang off a leaf without breaking 1.3 on the way in — and only when nothing in its own
subtree lives on in the destination, since that id would then sit in the union twice and be counted
twice, which is the fault this section exists to prevent.

**And it keeps its PLACE on the way out.** Appended to the end of its sibling list, a stream that is
leaving jumps a slot on the first frame: From reserves, sitting between two income streams, dropped
below both the instant the window changed, and the eye reads that as the band moving when all it is
doing is going away. It goes back after the neighbour it followed on screen, and since it ends at
nothing, where it sits by then costs nothing.

What is not animated is a stream moving into or out of an Other. That happens on the first frame —
and that is the right frame for it: nothing has moved yet, and it is not a journey the eye could
follow in any case. Where the two shapes already agree, which is most changes, nothing is rebuilt and
the tween runs exactly as before.

**8.6 A fade still in flight keeps its own pump running.** Once a move has settled, nothing else is
driving the clock — so a label part-way through appearing would freeze at whatever opacity it had
reached. Anything still easing asks for another frame on its own behalf, and the loop stops only when
nothing is moving appreciably. A consequence worth knowing: a label's *resting* position is therefore
within that tolerance of its solved position, and depends slightly on how many frames it took to get
there. Two runs land a hundredth of a screen pixel apart — do not write a test that demands exact
reproducibility of a resting label.

---

## §9 The tile

**9.1 The header IS the title, set like page one's**: one line — *"Actuals this year"* — with the two words that could be
something else made tappable. There is nothing to label and nothing to explain; the sentence already
says which of the four views this is, and changing it is changing the thing.

**9.7 The sub-period is the last one that CLOSED, not the one running.** A month three days old is
not a month of spending, and a picture of it says the household has stopped buying food. The
observation period is different and stays as it is: "this year" is the thing being tracked, and its
being unfinished is the whole point. The word in front of the unit says which it is — "this" for the
period in progress, "last" for the one that closed — and it is not a control: only the two underlined
words are.

**The slot does not clip.** An inline-block whose overflow is not visible takes its baseline from its
bottom margin edge rather than from the text inside it, so a clipped slot sits the word a few pixels
high against the ones beside it. There is nothing to clip anyway: the word travels less than its own
height, is transparent by the time it arrives, and the title is a single line with nothing to bleed
into.

**It swaps like a digit on a counter.** It changes when the unit beside it does, and a word that
simply replaces itself between two frames reads as a glitch rather than as an answer changing. The one
leaving fades and slides out of the way, the one arriving fades in from the other side, and the
direction follows the toggle so that going to the closed period and coming back are opposites. Keeping
the outgoing word mounted is what makes that possible — React would otherwise replace the text in
place and leave nothing to animate — so it is taken out of flow, hidden from anything that reads
rather than looks, and dropped once it has gone.

**The title is laid out as a SENTENCE, not a row of boxes.** Spacing the three words with a flex gap
left no actual space between them, so the heading's text came out as "Actualsthisyear" to a screen
reader. Ordinary inline text with real spaces also gets the baseline alignment the flex row was there
to provide.

**9.2 A period can legitimately hold nothing.** "A period is the whole of itself", so early in a
sub-period the sub-period is nearly empty and there is no picture to draw — and the boundary is the
reporting anchor rather than midnight, so this is not only a first-of-the-month case. That is the
truth rather than a failure, but an empty card does not say it, so a line does: *"Nothing yet this
month"*. It names the data, not the interface. The engine survives an empty tree on its own; the line
is the tile's job.

**It is set the way page one sets its own.** The macro graph draws its title inside the plot — the
year, at its title size, in the body colour at normal weight — and the two tiles sit in one carousel a
thumb-flick apart, so a heavier or quieter heading on the second reads as a different kind of thing
rather than as the same thing about a different picture. The dashed rule under the two changeable
words is then the only thing marking them, which is enough: it is what said so before, and the colour
it used to lean on was never the affordance.

Page one's is 30 units on a 450-unit chart, so what it comes to on screen depends on how wide the tile
is — about `title` at the width one gets on a phone. Deriving it from a wider card put it a step too
large.

**And the title is left-aligned, always.** The tile is a flex column that centres what it holds, so a
header row only as wide as its contents is centred with them — and the title slid right by half the
width of the "Back to all" button the moment that button appeared, which reads as the heading moving
when you open a stream. The row takes the tile's full width instead.

Not copied: page one also carries a second, smaller line under its title with the period spelled out.
This tile says the period in the title itself, so the line would repeat it.

**9.3 The card's proportion is fixed, and the tail slides.** The aspect ratio is a constant, not a
measurement of whatever box the tile happens to get: the frame's height follows its width (5.6), so
letting the proportion vary would make where a view lands depend on the container. `tail` chooses what
a stream that has bottomed out does with the columns beyond it — it slides its bar out to the end of
the view, so the tier is a straight edge rather than a ragged one.

**9.5 The same tree is not a change.** Opening a stream calls back to the tile, which re-renders and
hands the tree straight back. If that counted as a change, its value tween would rebuild the geometry
every frame and overwrite the focus transition running underneath it. The tile memoises, so an
unchanged tree arrives as the same reference and the engine returns early on identity.

**9.6 One face, one channel: SIZE, and it says which level you are standing on.** There is a single
typeface for every name, at one of two sizes. The level in focus — the subject and the siblings beside
it, which are the same level — is body; both levels the view reaches below it are small. That puts the
weight of the type on the row you are reading, and lets the two levels of detail underneath stack in
less height, which is what the tier is always short of. Small names reserve proportionally less room
in the sweep (7.13), so the extra stacking space is real rather than cosmetic; every size, extent and
baseline is measured against `bodyPx`, so they travel together.

At the root the level you are standing on is the macro categories, and **which streams those are is
read from the DATA, not from a count**. Depth cannot tell: the income streams stand one column from the
hub exactly as the categories do and their depth says the same thing, but they are a level *below*
them — the single income group above them was unwrapped into the hub itself (2.7). Counting made
Activity Income a category, which is the same mistake the face used to make before it was removed.
`top` marks the master's children and nothing else, and it is the only thing that knows. Away from the
root there is a real subject to count from and the depth is right; the hub carries the name of the
thing you are standing on, so it is body wherever it is drawn. This is also why the rule counts from
the FOCUS and not from the column, or from being in the tier: the same column means a different level
in a root view and in a focused one. A pinned neighbour
is body whatever level it came from: by 3.6 a stream that is its parent's first child borrows the
parent's neighbour, so one member of that row can be a level up — but it is the same control, and
setting it smaller says the two are different kinds of thing.

**Nothing is bold, and there is no second face.** Both were tried. A condensed face for the macro
categories was a third thing for the type to say; weight then said what was in focus while size said
what level it was at, and two channels for two facts read as four unrelated treatments. The framing
already says what is in focus, far louder than a weight can — the subject fills the frame (5.3). What
is left is one face, two sizes, one meaning.

**A name changes size by GROWING**, on the move's own clock (7.28). The size says which level you are
standing on, so it changes the instant the focus does — and a name that is also travelling across the
card at full opacity, snapping between two sizes on the way, is the same loss of visual contact 7.25
is about. What everything is MEASURED from stays the settled size: whether a name folds, and the room
it reserves in the sweep (7.13), are decided once for the view being moved to, or a name would fold
and unfold mid-flight and the tier would re-solve under it every frame.

The amount under a name is set in the numeric face and follows its name's size — it is a number, and
that is what numbers are set in throughout the app. A pinned neighbour keeps the quieter colour that
marks it as a control rather than a caption (7.22). Which streams are the macro categories still comes
from the DATA rather than the column (the adapter marks the master's children), because the root needs
to know where its own level is — the income streams stand one column from the hub exactly as the
categories do, but they are a level below them (2.7).

**9.8 The type sizes come from the DESIGN SYSTEM, where the card is wide enough to carry them.** They
never did: the engine held its own 12 and 10 and the tile passed nothing, so the app's type scale had no
bearing on the one picture whose geometry grows with the card. That is what made a desktop card read as
under-set — the same 12px is 3.7% of a phone card's width and 1.6% of a desktop one's, so the labels were
less than half the size, relative to the picture, that a phone shows them at.

Simply adopting the design system's sizes everywhere is not the answer, because 1.10 measures the gathering
in type: at phone width 16px/12.8px costs two names and leaves a third undrawn. So the authored sizes are
the NARROW end and the design system's are the WIDE one, reached across the widths between. Measured, one
tree, three cards:

```
phone    326px card    12 / 10 / 12       names / small / amount
tablet   756px card    16 / 16 / 19.2
desktop  768px card    16 / 16 / 19.2
```

**On a wide card the small size is retired and the amounts take the title size.** There is room for
every name to be set at the body size, so 9.6's channel — size says which level you are standing on —
is spent: it is a phone's economy, and a card with room does not need it. The amounts are then set one
step up, at the design system's title size, which is what makes a column of numbers scannable rather
than something to squint at.

Two things had to follow it. A rail entry reserves the height of the TALLER of its name and its amount,
not the name alone; and the gathering (1.10) measures the same way, or a wide card offers more names
than it can then draw and the sweep drops the difference — bands with nothing on them, which is the one
thing the gathering exists to prevent.

What this does not fix: a name that WRAPS takes two lines, and the gathering predicts one. Larger type
wraps more names, so on a wide card the sweep still drops a few the gathering thought would fit —
measured across six trees, 14 of 85 offered names against 9 of 88 at the smaller size. The drop rule
(7.16) catches them, which is what it is for, but the honest reading is that the prediction is
optimistic and grows more so as the type does. Widening the rail on a wide card would attack the cause
rather than the symptom.

The engine has no design system of its own and does not acquire one here: with no wide size passed it keeps
the sizes it was given, which is what the tests and the bench rely on. The root font size is read rather
than assumed, so a reader who has set a larger one gets a larger chart with it.

**9.4 The hover affordance is gated on `(hover:hover) and (pointer:fine)`.** On a touch screen a hover
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
label reverses direction during a move. Two more earned their place by regressing repeatedly, and both
are cheap to sweep on the bench: **a terminal band never plumes**, at rest or at any frame of a move
(6.5) — count the frames in which one could, and the answer must be zero — and **no label leaves the
card** on any move between siblings, in either direction or back out to the parent. The rail-name rule and the key-set rule are asserted directly
against `layout()` in [`moneyFlowEngine.test.js`](../src/tests/moneyFlowEngine.test.js), which needs
no screen.

**What the invariants are for, in one example.** A bench mock built at realistic scale was quietly
unbalanced — its residual stream had been left out — and `check()` reported a hub bottom mismatch of
38 units before anything had been looked at. That is the whole argument for checking where the
numbers are produced.

---

## The instrument

`documentation/visualisation-carousel.md` records what it cost to converge the last visualisation
without one: five rounds, four of them shipped to production and judged by eye. This one is built
against instruments instead, at four levels.

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

**The layout** — [`moneyFlowEngine.test.js`](../src/tests/moneyFlowEngine.test.js) asserts the pure
half directly, because `groupTail`, `layout`, `frame` and `compose` need no screen. It holds the
invariants that decide whether the picture is *readable* as opposed to *correct*: the subject fills
the frame at every focus, two subjects at the same level land at the same x, a separation measures the
same number of screen pixels wherever you stand, a name sits on the bar it names, and no number in any
scene is ever NaN. That last one exists because a unit conversion missed one branch and turned the
whole income side into NaN while every other invariant kept passing — NaN compares false with
everything.

**The picture** — the engine has no imports, which is what makes it drivable from outside production,
in two ways that catch different things:

- *In a VM, with no browser at all.* The engine's source loads into a Node context with its `export`
  keywords stripped, and the pure functions can then be run over a realistic tree — every focus in a
  portfolio-shaped fixture, checked in about a second. This is the first thing to reach for: it found
  a framing fault at four focuses that had survived a browser sweep, and then showed the fault was in
  the fixture rather than the engine.
- *In a headless browser, over CDP.* A bench page loads the same stripped source, and probes drive it
  through real navigation and read what was actually drawn — label positions frame by frame, opacity,
  the type each name was set in. Anything about motion or text metrics can only be measured here:
  jsdom has no layout and no text measurement, so the engine declines to paint and every label rule
  (7.10–7.17, 7.23–7.29) is invisible to jest. **The bench is where the label rules are tested.**
- *As a picture.* The same browser will screenshot the card, and some faults have no number to read:
  the plume breaking into stripes, an edge going sheared, a word cut through. Render the state, look
  at it, then render it again with the change reverted — a before/after pair of the SAME state is what
  distinguishes "I fixed it" from "I changed something". It is also how to read a bug report that
  arrives as a photograph: measuring the screenshot itself (the left edge of each label, the spacing
  between columns) turns "the labels don't line up" into a number, and twice that number said the
  fault was not where the words suggested.

Six habits, each bought with a wasted hour or more.

A bench runner must **rebuild from the engine on disk every run**, or a before/after comparison
silently runs the same build twice and reports a real fix as inert.

A probe must have a **deadline per step**, or one unanswerable question — asking to open a node with no
children, which is not a view — hangs the whole sweep.

A fixture must have **unique ids**: boxes are keyed by id, so two nodes sharing one union into a box
spanning both halves of the picture, which propagates through every ancestor and reads exactly like a
broken fit.

**Headless does not run `requestAnimationFrame`.** Not on a timer, and not when a frame is forced by a
screenshot. A probe that changes the tree and then reads `eng.G` is reading the geometry from *before*
the change, and a screenshot taken the same way shows the previous tree — which is how a reproduction
was measured, believed, and acted on before it turned out to be of a state nobody was looking at. Take
the clock: replace `requestAnimationFrame` with a queue, pump it by hand, and the tween becomes
steppable frame by frame, which is better than what the browser would have given anyway.

**The bench must enter the engine the way the app does.** `setTree(raw, replace)` takes an early return
when `replace` is true — it snaps, with no tween — and a bench whose loader always passed `true` had
never once exercised the value tween. Three fixes in a row were aimed at transition behaviour the
instrument could not see. Whenever a bug is about a transition, check first that the bench *makes* that
transition rather than jumping to its result.

**A `const` used above its declaration throws on every paint and passes every test.** jsdom has no
layout, so the engine declines to paint at zero width and never reaches the line; the bench catches it
on the first frame. When adding a helper near the top of `layout`, put it after the things it reads.

One more, about fixtures rather than instruments: the engine's options are read individually and not
defaulted, so a test `opt` missing a key does not fail loudly — it fails *open*. `gather` reads its
floor from `opt.otherMin`, and where that is undefined `tail.length < undefined` is false, the guard
that should have returned is skipped, and the crash lands ten lines later on an unrelated
line. Give a gathering fixture the full `TUNE`, or expect to debug the wrong function.

The bench and its probes are scratch, rebuilt per session rather than committed. What is durable is
the property that allows them: **the engine imports nothing**. Keep it that way.

Historically, this same diffing rig is what the port was signed off on — the shipped engine and the
prototype it came from were driven side by side from one mock provider and compared node by node,
identical across twelve states.

---

## Still open

Known and not yet done, as of the last session. Nothing here is started.

**Bugs**

- **The line goes discontinuous when switching mode.** Seen on the year/month toggle. The two causes
  found before are both verified intact — `onto` still carries the streams the destination does not
  hold (8.5), and money from outside still trails off rather than stopping (6.5) — and every window
  toggle measures clean on the bench: nothing vanishes, `check()` is empty mid-tween and at rest. So
  this is a third cause, not a regression of either. The strongest candidate found while looking: the
  gathering re-decides which streams fall into an Other when the window changes, and a stream moving
  into or out of an Other is not animated (8.5) — one to three bands blink in or out on the first
  frame of every window change. That was deliberate when the alternative was refusing to animate at
  all, and 7.2a/7.2b have since made it far louder, because a band crossing that line now changes its
  position, its alignment and whether it carries a number, all in one frame.
- ~~**A long name disappears once it is two levels down.**~~ Fixed by 7.31, and it was the width: the
  fold split near the middle, the long half still overran the rail, and the window clause of 7.20 then
  dropped the name outright. It folds into as many lines as the room needs now, up to four.

- **Income cannot represent a negative**, such as tax withheld. The picture has no shape for money that
  arrives negative on the in side; 1.2 turns a shortfall into "From reserves", which is not the same
  statement. Part bug, part unanswered design question.

- **A stand-in band shows no plume at rest** (7.30). Reproduced in the bench, which boots on the tree
  it happens in: focus `Savings > Other`, at rest, "Investments & Interests". Measured, and the facts
  do not yet add up — recorded so the next attempt starts from them rather than from a theory:

  ```
  more = 1 and the mask rect exists      x 1292 w 954 y 166 h 8, matching the bar exactly
  its gradient is correct                opaque at the front (1292), ramping to 0 by 1394
  muting the plume                       changes nothing
  sweeping more from 1 down to 0.25      changes nothing
  forcing the gradient fully opaque      changes nothing
  the plume rect alone in the mask       reveals nothing
  removing the hull's mask entirely      DOES reveal ink (lift 56) on those same rows
  ```

  The last line cannot sit with the rest: if the mask is what hides that ink, a rect covering those
  rows with an opaque fill must show it. One of these measurements is wrong, and pixel sampling has
  already misled twice here — `ally` spans world y 166..174 and `rent` begins at 173, so any sample
  wide by one row reads a neighbour. The next step is an instrument, not another theory: paint the
  mask's own rects into the picture as visible fills so their coverage can be SEEN, one band at a
  time. Note also that during a move the plume does appear, which is what makes it look like a
  landing bug rather than a coverage one.

**Features**

- **Value labels on the nodes in focus**, except at the root.
- **A wider rail for names written OUTSIDE the bar.** 7.32 fixed the fanned case by measuring; the
  rail case is untouched, and at three levels in it has 160 world units, which folds a four-word name
  into three lines. Widening `railFrac` globally is not free — it trades interior captions for tier
  line-count, and nothing past 0.26 buys anything:

  ```
  railFrac   Loki Groceries & Hygiene   phone names undrawn
  0.22       3 lines                    6 of 78     (today)
  0.26       2 lines                    8 of 78
  0.30       2 lines                    8 of 78
  ```

  The same answer as 7.32 probably applies: measure rather than fix a fraction. The rail's competitor
  is the card's edge rather than another name, so what it would measure against is the widest amount
  in the column beside it.

**Found in passing, not asked for**

- The wrap gap on a wide card: a name that wraps takes two lines and the gathering predicts one, so a
  wide card offers more names than it can draw and the sweep drops the difference — 14 undrawn of 85
  offered against 9 of 88 at the smaller size. 9.8 has the cause; the lever is the rail's width.
- ~~`gather` reads its floor from `opt.otherMin` and fails open when it is missing.~~ Floored at two,
  which is what the rule says anyway. The instrument's last paragraph keeps the lesson: the options are
  read one key at a time and never defaulted, so a missing one fails open rather than loudly.
- `1.6` and `7.8` are cited in code and defined nowhere in this document.
- `src/App.test.js` does not run at all: a Jest transform error reached through `core.js`. Pre-existing
  and unrelated to this work, but it means `npx react-scripts test` is never green.

---

## Boundaries

- **The container** — its geometry, who owns a drag, how a page is added — is
  [`visualisation-carousel.md`](visualisation-carousel.md). This file covers only page two.
- **Page one** is [`macro-graph.md`](macro-graph.md).
- **What a transaction is worth to a stream** — the transaction types and their masks — belongs to
  the evaluator, and the flow only consumes it. A zero-sum stream needs no special case here: it is
  a stream whose transactions cancel, so it is simply worth little, and
  [`zero-sum-streams.md`](zero-sum-streams.md) owns what that means.
