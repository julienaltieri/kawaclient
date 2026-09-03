# Debugging the picture

## What this is

How to find out what a drawn thing is actually doing. It was lifted out of
[`money-flow.md`](money-flow.md) because none of it is about money flow — the same instruments and the
same traps apply to any visualisation driven from a pure engine.

One sentence carries the whole document: **almost every hour lost here was lost to a measurement that
lied, not to a rule that was wrong.** The fixes, once found, were usually one line. What cost the time
was believing a number that did not mean what it appeared to mean, and then reasoning carefully from
it. The procedure below exists to make a measurement earn its trust before a change is built on it.

---

## The order to reach for things

**1. Reproduce it with the real tree, not a tree like it.** The staging build has a `Copy tree` button
on the tile (behind `AppConfig.staging`, so it cannot reach a reader). It copies the focused node's
three trees — as the adapter built it, as the gathering left it, and what is on screen — plus every
visible name's placement facts and every text actually in the DOM. One paste of it settled a question
that four rounds of inferring the shape from photographs had got wrong three times: wrong parent,
wrong depth, wrong focus. Ask for it early. It is cheaper than being clever.

**2. Match the conditions, not just the data.** The card's WIDTH is part of the bug report: at 296 css
the gathering produced a nested Other that the fault lived in, and at 326 it did not, so the picture
looked fine and the bug was "not reproducible". The THEME matters for anything about contrast or a
fade. So does the focus path — read it out of the export rather than guessing which band was tapped.

**3. Predict before changing.** Say what the measurement should show if the theory is right, and what
it should show if it is wrong. A theory that explains the symptom either way is not a theory. Three
explanations for one missing plume — too thin to see, no mass to reveal, a gradient identical to the
window's cut — each explained the symptom, and each was wrong.

**4. When two measurements disagree, stop and build the instrument.** Do not pick the one that fits.
Sampling rendered pixels could not distinguish "the mask failed to open" from "the mask opened onto
nothing"; painting the mask's own rects into the picture as visible fills answered it in one pass. The
hour spent on the instrument was less than the hour already spent arguing with the pixels, and it left
something reusable.

**5. Prefer a difference to an absolute.** Render the state, change one thing, render again, diff. An
absolute reading has to be interpreted; a difference between two renders of the same state IS the
thing you changed. It is also the only honest way to answer "did that fix it".

**6. Beware the differential that perturbs.** Removing a band to see what it contributed also moves
every band after it, so everything downstream differs for a reason that has nothing to do with the
question. In a mute-and-diff of that shape only the IDENTICAL results are trustworthy; a difference
proves nothing until the perturbation is ruled out.

---

## The four instruments

**The numbers** — `src/tests/moneyFlow.test.js`. Drives the adapter through real model objects rather
than stand-ins, so what it asserts is what production does.

**The binding** — `src/tests/moneyFlowTile.test.js`. Mounts the component against a real analysis, so
the accessors it reads are the ones the analysis has. jsdom has no layout, so the engine measures its
host at zero width and declines to paint — which is the other thing under test: a page not on screen
yet must not throw.

**The layout** — `src/tests/moneyFlowEngine.test.js`. The pure half directly: `groupTail`, `layout`,
`frame`, `compose` need no screen. It holds the invariants that decide whether the picture is
READABLE, as opposed to correct.

**The picture** — the engine imports nothing, which is what makes it drivable from outside production,
in three ways that catch different things:

- *In a VM, with no browser.* The source loads into a Node context with its `export` keywords
  stripped, and the pure functions run over a realistic tree — every focus in a portfolio-shaped
  fixture, in about a second. Reach for this first. It once found a framing fault at four focuses that
  had survived a browser sweep, then showed the fault was in the fixture rather than the engine.
- *In a headless browser over CDP.* A bench page loads the same stripped source and probes drive it
  through real navigation, reading what was actually drawn — label positions frame by frame, opacity,
  the type each name was set in. Anything about motion or text metrics can only be measured here.
  **The bench is where the label rules are tested.**
- *As a picture.* The same browser will screenshot the card, and some faults have no number to read: a
  plume breaking into stripes, a sheared edge, a word cut through. It is also how to read a bug report
  that arrives as a photograph — measuring the screenshot turns "the labels don't line up" into a
  number, and twice that number said the fault was not where the words suggested.

---

## Ways a measurement lies

Each of these cost an hour or more, and several cost a wrong fix built on top.

**Headless does not run `requestAnimationFrame`.** Not on a timer, and not when a screenshot forces a
frame. A probe that changes the tree and then reads the geometry is reading the state from BEFORE the
change, and a screenshot taken the same way shows the previous tree. Take the clock: replace `rAF`
with a queue and pump it by hand. The tween then becomes steppable frame by frame, which is better
than what the browser would have given anyway. Note that pumping in a tight loop advances no REAL
time, so anything keyed to `performance.now()` — a fade, a settle — stays frozen at its start value;
put a real pause between pumps when the thing under test is a duration.

**The bench must enter the engine the way the app does.** `setTree(raw, replace)` takes an early
return when `replace` is true — it snaps, with no tween — and a bench whose loader always passed
`true` had never once exercised the value tween. Three fixes in a row were aimed at transition
behaviour the instrument could not see. When a bug is about a transition, check FIRST that the bench
makes that transition rather than jumping to its result.

**Sub-pixel bands read as their neighbours.** A band half a pixel tall does not occupy a pixel row of
its own, and a 3px band sits one row away from a 900px one. Sampling "the band's centre row" then
reports the neighbour, at full confidence. Two wrong explanations came from exactly this. Restrict
the rows to the band's own and check the arithmetic of which rows those are.

**A reference pixel must be inside the thing.** A "background" sample taken outside the tile is
constant by construction, so every comparison against it yields the same difference and that
difference reads as a real, stable signal. One such reading produced a confident "lift 56" for a
feature that was not being drawn at all.

**A mask that opens onto nothing looks exactly like a mask that failed to open.** Both render as
background. The plume was set, its rect was built with correct geometry, its gradient was correct —
and there was no ink underneath. Distinguishing these needs the mask made visible, not more sampling.

**Options fail OPEN, not loudly.** The engine reads its options one key at a time and never defaults
them, so a fixture missing a key does not throw: `tail.length < undefined` is false, a guard is
skipped, and the crash lands ten lines later in a function that is not at fault. Give a fixture the
full `TUNE`. (This one was hit five times before the floor was defended; the class of trap is still
open.)

**A `const` used above its declaration throws on every paint and passes every test.** jsdom declines
to paint at zero width and never reaches the line. The bench catches it on the first frame.

**A depth difference is not a relationship.** `dep(id) - fDep` subtracts two ABSOLUTE depths, so it
counts any stream in any branch that happens to sit at that depth — not "below the node you opened".
Twice this put treatment on bands in branches the reader had never opened. When you mean "under THIS
focus", test that the node's path starts with the focus's path.

**A build stamp must be computed per build.** Baked in as a literal it freezes, and then reports
confidently that nothing changed — worse than no stamp at all, since it was added to answer exactly
that question. Same for the runner: **rebuild from the source on disk every run**, or a before/after
comparison silently runs the same build twice and reports a real fix as inert.

**A local build proves nothing to someone reading a deployed page.** Rebuild AND republish before
describing what they should see. Two rounds were spent on a fix that existed only on disk.

**A boot script that clicks before the handlers are bound is a silent no-op.** Nothing throws; the
page simply comes up in the wrong state, and every measurement after it is of the wrong tree. The
same goes for driving the engine before its tree is loaded: the move animates over a tree that is
about to be replaced.

**A fixture must have unique ids.** Boxes are keyed by id, so two nodes sharing one union into a box
spanning both halves of the picture — which propagates through every ancestor and reads exactly like a
broken fit. Generators that restart an id counter per subtree will do this to you.

**A probe needs a deadline per step**, or one unanswerable question — asking to open a node with no
children, which is not a view — hangs the whole sweep.

**A clean result is only as wide as what the probe read.** The sweep that declared every window change
clean read the tree's VALUES and the sum invariant, and never once read a position. Both were correct
throughout — the fault was entirely in where the bands were drawn, so the instrument was incapable of
seeing it and said so in the language of a pass. Before trusting a green sweep, write down what it
actually measured, and check that the symptom would have had to show up in that quantity.

**A sweep at the root view is not a sweep.** The same fault was invisible with nothing opened and up to
36% of the card at a focus: the world is re-scaled per focus, so a discrepancy that is a rounding error
in the whole picture is a lurch inside one stream. Any sweep over a visual rule has to visit a focus,
and preferably two levels down.

**Measure in the space the reader is in.** A world-space reading said one change of window still jumped
28 units; in screen pixels the same frame moved 12, because the camera is solved from the geometry and
partly cancels it. Two quantities that are both "the position of the band" answered the question
differently, and only one of them was the question.

---

## Rules of thumb

- The engine imports nothing. Keep it that way; it is what makes all of the above possible.
- Reach for the VM first, the browser when text or motion is involved, the picture when the fault has
  no number.
- A photograph from a phone is evidence of a symptom, never of a mechanism.
- If a fix cannot be stated as "this measurement was X and is now Y", it is not finished.
- Record what was MEASURED, separately from what it was taken to mean. The measurements in this
  codebase's history outlived three of the explanations built on them.
