# How Julien Decides

Decision principles for this project. **Read before starting work** — the point is to make the same
call Julien would without having to be corrected into it.

This is not documentation of the system; that lives in [`documentation/`](documentation/context.md)
and answers *how things work*. This file answers *how decisions get made*.

Every principle was extracted from a decision actually made, and carries the example it came from.
The examples are written to stand alone: you should be able to take the point without knowing the
feature they happened in.

The numbers are stable addresses — code comments cite them (`DECISION-PRINCIPLES.md #9`) — so anything
learned later is appended to its section rather than inserted. Read by section, not by number.

Nearly all of these are arguments about **risk** — what breaks, what misleads, what has to be
re-litigated later. Read them that way and they stop being taste and start being reasons. Where two
of them pull against each other, and several do, the tie-breaker is the same question: **what does
this cost if I am wrong?**

---

## Scope and change

### 1. Retrofit before you build, because new code is new risk

Find the seam that already exists and change what it decides. This is not about saving effort — it
is about blast radius. Every new construct is a place existing behaviour can break.

> *In practice:* asked to add navigation between related records, the instruction was explicit —
> "do not rebuild something already built, instead retrofit and piggy back on existing logic and
> frameworks as much as possible. this limits the risk of breaking something else." Reading the
> existing component first showed the prop for it was already threaded end to end, and one of the
> two rules being requested was already the current behaviour. A fifth of the planned work did not
> exist.

### 2. Fix the cause, not the symptom — and take the bigger diff to do it

A change that relieves a condition without removing it is not the cheap option, it is the one that
comes back.

> *In practice:* a card was about 70px too wide on a phone. One option shrank fonts and images to
> claw back 60px; another moved a whole block out of the crowded row. The trimming option was the
> smallest possible change and was never in contention, because it left the condition intact.

### 3. Stay inside the ask; extra is regression surface

Additions that were not requested get reverted even when they are defensible.

> *In practice:* asked to make sibling records navigable, I also added a label naming which one you
> were on, and listed records that had been announced but had not yet arrived. Both were reverted —
> "keep the content structure as we had before, the navigation elements are enough to solve this
> feature." The second addition was also wrong: those announced records never arrive as real rows,
> so they inflated a count. Scope discipline caught a defect that thoroughness introduced.

### 4. Remove affordances to shrink the state space

If permitting an interaction multiplies the states everything else must be correct in, removing it
is a design decision, not a limitation.

> *In practice:* navigation between sibling records worked fine. It was removed from one view
> anyway — not because it misbehaved, but because allowing it there creates combinations (one
> record edited and the other not, one split and the other not) that the rest of the flow would
> have to handle. Checking that rule against the code then found a dialog handler that assumed it
> was always about the record it opened with; navigating inside it would have written data to the
> wrong record.

### 5. Preserve familiarity where it is free

Between options that solve the problem equally, prefer the one that moves the fewest things the eye
already knows where to find.

> *In practice:* of two layouts that both fixed the crowding, the winner kept the amount on the
> right where every other card in the app puts it.

---

## Correctness and inference

### 6. A property of a thing must not depend on where you look at it from

If a value changes with the view, it was never a property of the thing — it is a property of the
view, and the model is wrong.

> *In practice:* an order billed as two separate charges. Item prices were computed by spreading
> each charge's amount across the items on screen, so the same item showed a different price
> depending on which charge you had open. The objection was not cosmetic: prices belong to items,
> so they had to be computed once per order and read from there.

### 7. Consistency is a requirement, not a finish

Incoherence within one object usually means the logic is scoped to the wrong object. Fix the scope,
not the symptom.

> *In practice:* within a single order, one charge could be matched to its items and its sibling
> could not, so moving between them changed how many pictures appeared for no visible reason. The
> verdict was not "untidy" — it was that matching belonged to the order, not to a charge on its
> own.

### 8. Preserve what is known; isolate what is not

All-or-nothing is usually the lazy reading. Settle the part the evidence supports, and confine the
uncertainty to the remainder.

> *In practice:* a gift card reduced one shipment's charge, so that charge no longer matched any
> set of items at their full prices. The proposal on the table was all-or-nothing: if one charge
> cannot be matched, match none. The better call was to settle the charges that *do* match at full
> price and let only the leftover items absorb the discount — which kept two prices correct that
> were never in question.

### 9. Refuse rather than guess, when a wrong answer is indistinguishable from a right one

The test is not whether a guess would usually be right. It is whether the reader could tell a wrong
one from a correct one. If they could not, the guess is a fabrication with a plausible face.

> *In practice:* three items priced identically and a charge covering two of them. Which two is
> unknowable from the amounts, and an arbitrary pair would look exactly as convincing as the real
> one. Showing all three was correct.

### 10. But calibrate rigour to consequence

The counterweight to 9, and the reason it is judgement rather than dogma.

> *In practice:* two identical charges from the same merchant and one refund. Told the matching
> might attribute it to the wrong one: "if they are the same amount, it doesn't matter that you
> picked the wrong one." Same amount, same outcome, no ambiguity that matters.

The licence comes with a condition: an arbitrary choice must still be a **stable** one. A pick that
falls out of iteration order gives the same data two different answers on two different renders, and
"it does not matter which" stops being true the moment the reader can watch it change.

### 11. Degrade honestly

When you cannot be sure, show less. Never show something invented that happens to be well-formed.

> *In practice:* every approved fallback shows less rather than more — the whole order instead of a
> guessed subset; real prices that do not add up to the charge instead of adjusted ones that do; an
> unstyled row instead of an affordance that does nothing.

### 21. An unknown is not a negative answer

A state that already asserts something cannot double as the absence of knowledge. Reuse it that way and
the interface states a fact it does not have — and it will be the confident-looking one, because it was
designed to be.

> *In practice:* items sent back showed amber for "refund expected". When a refund arrived that could not
> be tied to a particular item, those items stayed amber — which told the reader no money had come back,
> when some had. The answer was not a better guess but a third outcome: expected, arrived, and cannot-tell.
> Two of those are claims; the third exists so the absence of one has somewhere to go. It shows the
> charge-level statement instead of the per-item one, which says what is known without naming what is not.

### 22. Agreement in aggregate is not agreement

A total that matches while none of its parts do is the signature of something else going on — a fee, an
adjustment, a bad match. Reading it as confirmation launders a coincidence into a fact.

> *In practice:* refunds of $15 and $5 against two items priced $10 and $10. The totals agree at $20, and
> a rule read that as both items having come back. Nothing about the parts supports it, and the shape is
> exactly what a mis-matched refund looks like — so the case now surfaces to the reader instead of
> resolving silently. The rule was deleted rather than narrowed: once equal-amount candidates could be
> broken by a tie-break, everything it caught legitimately was already covered elsewhere, and all it had
> left was the case it got wrong.

---

## Interface

### 12. Structure should carry the meaning before a label does

A label that describes what the layout already shows is a sign the layout is not working.

> *In practice:* list rows read "Also in this order: −$39.50 on 7/21". Rather than keep the phrase,
> it was deleted and the amounts right-aligned directly beneath the headline figure — "the visual
> grouping should already speak to its meaning."

### 13. Delete what the reader can already see, and what is said elsewhere

> *In practice:* a heading reading "3 Transactions:" above a list of three, and an order date that
> the first charge date already implied. Both cut — "don't show 'x transactions', I can see that
> myself." Together with merging two lines into one, five metadata lines became one; more than any
> layout change achieved.

### 14. Group with space, not with proximity to something loud

> *In practice:* a small two-column table sat immediately beside a large amount and read as one
> crowded mass. The fix was to let the table size to its own content instead of stretching, so the
> gap could do the separating.

### 15. The visual cue must be the semantic truth, derived from the same condition

Two things that must always agree should be computed once, not twice.

> *In practice:* a row carried a dotted underline suggesting it could be tapped while the handler
> correctly refused to open it. The objection was not "fix the CSS" — it was that the cue and the
> behaviour were driven by different conditions and had drifted. One flag now feeds both.

### 16. Name things by what they do for the reader

Not by the mechanism, and not by the algorithm's conclusion.

> *In practice:* a setting called "Items map" was renamed "Only show item charged". The rename also
> exposed something the old name hid: it is a request, not a guarantee — it still falls back when
> the matching cannot be done.

---

## Values and the design system

### 17. No magic numbers — and precedent tells you which token

Knowing to use the scale is the easy half. Knowing *which* step means reading how comparable
elements already use it.

> *In practice:* "make it 30% smaller" produced 4.2rem, which sits on no scale; the scale-derived
> neighbour was used instead. And reading how similar elements used the system revealed the
> existing 6rem picture was already exactly `spacing.xl` — on the scale all along, just written as
> a literal. Guidance: "no magical numbers, but use design system values even for spacing. to
> understand when to use what, check the semantic value of other implementations."

### 24. One dimension, one author

A spacing that is set in two places will disagree, and the version you are reading will always look
right. The fix is to delete one of the authors, not to reconcile the numbers.

> *In practice:* a carousel's resting inset was set on the tile *and* as padding on the deck; then its
> gutter came from tile margins *and* from a gap on the track; then padding was applied by the deck *and*
> by the page body. Three rounds, three wrong results, each obvious in the file being edited and invisible
> from it. It ended when one constant became the source and everything else was derived from it — inset,
> bleed, gutter and edge fade all being the same number times a small integer.
>
> A measurement can be the second author too. `fit()` sized a deck from its active page, and stretching the
> pages made a page's height come *from* the deck: the deck fixed a guess, every page adopted it, and
> anything taller was clipped. A measurement that feeds what it measures is not a measurement.

### 18. One implementation, every screen

Both sizes must be right, preferably from the same code. A second branch is a second thing to keep
correct.

> *In practice:* this codebase's `isMobile()` is `window.innerHeight > window.innerWidth` —
> orientation, not width. A phone in landscape reports desktop. It is right for choosing a bottom
> sheet over a popover, which is what it was written for, and wrong for anything that depends on
> available width.

---

## Process

### 19. Gate on a plan, then let it run

Approval is asked for before work starts, and once given it is not revisited step by step. The gate
is on direction.

> *In practice:* "First, plan your approach on how to solve the subproblems and let me approve it."
> Related: offered a multiple-choice question to resolve an ambiguity, he declined it and wrote a
> prose spec instead — one containing exclusions and edge cases that no pre-written option would
> have contained. **Ask open questions in prose; do not offer pickers.**

### 25. When production is the only instrument, land one change at a time

Bundling is efficient when you can test. When the deploy *is* the test, a commit carrying five changes
buys one observation and cannot attribute it, so the next round starts from a guess.

> *In practice:* five layout properties across three files went out in one commit, on a screen whose owner
> had said production was the only place it could be judged. The reply — "you broke the layout in multiple
> ways" — was accurate and unattributable, and cost two further rounds to take apart. Note the tell: the
> commit before it had already promised to stop doing this.

### 20. Build the instrument that makes the case visible

Not to check work that is already done — to surface cases nobody thought to ask about.

> *In practice:* a heuristic was validated by replaying two years of real history through it before
> any of it was written; then a prototype with configurable scenarios; then a working simulation of
> the flow. Between them they found a rounding drift, an inconsistency between sibling records, a
> visual cue that lied, and an edge case that reshaped the algorithm twice — none of which code
> review had found. And such tools are for operating, not reading: "strip all the explanations
> (I don't read them)."
>
> The failure is not only skipping the instrument, it is **owning one and not using it**. A header
> row's layout was converged in a bench that reproduced its box model exactly, in one round. The
> carousel above it was reasoned about instead and took five, every wrong guess costing a deploy and
> a screenshot — which is to say the user was made the instrument.

### 23. A test that cannot fail the way production fails proves nothing

The risk is not a missing test. It is a passing one, because it licenses a belief that nothing else will
go back and check.

> *In practice:* a tap handler was verified in a DOM stub, which reports whatever the code says and knows
> nothing about how a browser delivers a tap. It passed while the feature was dead on a phone — a finger
> drifts a few pixels, the browser suppresses the click, and no handler runs. Driving a real browser over
> the DevTools protocol with touch events found it in one run, and the same harness then measured the two
> layout bugs that reading the CSS had not settled. The trap has a second form once work is delegated: an
> agent reporting "tests pass" is making a claim, and it is worth exactly the command output quoted beside
> it. And a third, which caught the instrument built under 20: a bench reproducing a row box for box
> converged its layout correctly and was blind to the one element it had mocked — the progress ring, drawn
> there as a fixed-width div and in production as an SVG that fills whatever contains it. Widening that
> container for the caption's sake therefore drew a ring twice its size, in a case the bench could not
> express. A mock is a claim that the real thing has no behaviour you are not modelling.

---

## The rule that generates most of the others

When something can be inferred but not verified, **make the failure visible rather than invisible**.
Refusing to scope, showing the whole set instead of a guessed subset, leaving a row unstyled,
printing an explicit "unresolved" — all the same move.

---

## Testing

Cover every **scenario configuration**; assert every **decision** once.

A configuration is an axis the world varies along — with or without a discount, one record or two,
all arrived or some pending. Those get combinatorial coverage. A decision is settled behaviour —
"only the relevant items are shown", "ambiguity refuses" — and gets one assertion, not an axis.

---
