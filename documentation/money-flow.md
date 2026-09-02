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

**1.10 The tail is gathered into an "Other", and HOW MUCH tail is decided by the display.** The
question is not what share of the money the small streams are — it is how many of a set of siblings
can carry a name at once. A stream with a dozen children otherwise spends most of its height on the
two or three that matter and the rest on a fringe of hairlines: unreadable, unnameable, and in the way
of the ones worth reading.

It is answerable from the values alone because 5.3 makes the room a constant: whichever stream you
open, its children fill the frame less one strip at each end, so every set of siblings gets the SAME
height when it is exploded. A label is centred on its band (7.16), so two neighbours can both be named
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
does this stream's own column end at the front, and does it have children. Two bands can sit side by
side at the same front and answer differently — one continues inside, its neighbour is terminal — so a
single gradient across the whole picture, giving them one edge, made a terminal stream trail off
because a sibling had something behind it. Everything is cut hard at the front and the softened edge is
laid over only the bands that continue, one extra rect each in the mask, at both ends. A stream that
bottomed out earlier and slid out to the end column is not one of them: it has nothing behind it
however far the view runs.

It is deliberately not derived from the front's POSITION at render time. The front is a blended
coordinate, so moving back a level sweeps it leftwards across the tier, and a ramp keyed off it draws a
plume for the length of that sweep over a tier with nothing inside it.

**Each rect is clipped to its own side.** A full-width one covers that band's rows across the whole
picture, so a stream continuing on the out side also softened the IN edge at that height — and because
the two sides stack independently, an income band's rect landed over whatever out-side band shared its
rows and gave that one a plume it had no claim to. On screen that read as the plume breaking into
stripes of different strength, and as the leftover band trailing off for no reason. A band's edge is a
statement about its own end.

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
being explained. **A macro category is never a tier entry**: one with no streams inside it bottoms out
at its own column and its band slides to the end like any other (9.3), but its NAME belongs with its
siblings, in the column the categories occupy. Sending it down the tier put Recurring Expenses on the
right-hand edge between two leaf names, which reads as a demotion rather than as a category that
happens to be empty.

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

**7.13 The room a name reserves is measured, not assumed.** The sweep has to know each entry's height
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
the focused branch's names sit on their bars again — and never while the camera is moving, which would
be a second source of jitter. Alignment is the inviolable half of the rule and MEMBERSHIP is what
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
where the move leaves off — which also absorbs the small error for a name that will land in the rail,
whose relaxation is not solved for the destination in advance.

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

**8.6 A fade still in flight keeps its own pump running.** Once a move has settled, nothing else is
driving the clock — so a label part-way through appearing would freeze at whatever opacity it had
reached. Anything still easing asks for another frame on its own behalf, and the loop stops only when
nothing is moving appreciably. A consequence worth knowing: a label's *resting* position is therefore
within that tolerance of its solved position, and depends slightly on how many frames it took to get
there. Two runs land a hundredth of a screen pixel apart — do not write a test that demands exact
reproducibility of a resting label.

---

## §9 The tile

**9.1 The header IS the title**: one line — *"Actuals this year"* — with the two words that could be
something else made tappable. There is nothing to label and nothing to explain; the sentence already
says which of the four views this is, and changing it is changing the thing.

**9.2 A period can legitimately hold nothing.** "A period is the whole of itself", so early in a
sub-period the sub-period is nearly empty and there is no picture to draw — and the boundary is the
reporting anchor rather than midnight, so this is not only a first-of-the-month case. That is the
truth rather than a failure, but an empty card does not say it, so a line does: *"Nothing yet this
month"*. It names the data, not the interface. The engine survives an empty tree on its own; the line
is the tile's job.

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

Three habits, each bought with a wasted hour. A bench runner must **rebuild from the engine on disk
every run**, or a before/after comparison silently runs the same build twice and reports a real fix as
inert. A probe must have a **deadline per step**, or one unanswerable question — asking to open a node
with no children, which is not a view — hangs the whole sweep. And a fixture must have **unique ids**:
boxes are keyed by id, so two nodes sharing one union into a box spanning both halves of the picture,
which propagates through every ancestor and reads exactly like a broken fit.

The bench and its probes are scratch, rebuilt per session rather than committed. What is durable is
the property that allows them: **the engine imports nothing**. Keep it that way.

Historically, this same diffing rig is what the port was signed off on — the shipped engine and the
prototype it came from were driven side by side from one mock provider and compared node by node,
identical across twelve states.

---

## Boundaries

- **The container** — its geometry, who owns a drag, how a page is added — is
  [`visualisation-carousel.md`](visualisation-carousel.md). This file covers only page two.
- **Page one** is [`macro-graph.md`](macro-graph.md).
- **What a transaction is worth to a stream** — the transaction types and their masks — belongs to
  the evaluator, and the flow only consumes it. A zero-sum stream needs no special case here: it is
  a stream whose transactions cancel, so it is simply worth little, and
  [`zero-sum-streams.md`](zero-sum-streams.md) owns what that means.
