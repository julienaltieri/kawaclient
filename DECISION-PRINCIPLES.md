# How Julien Decides

Decision principles for this project. **Read before starting work** — the point is to make the same
call Julien would without having to be corrected into it.

This is not documentation of the system; that lives in [`documentation/`](documentation/context.md)
and answers *how things work*. This file answers *how decisions get made*.

Every principle was extracted from a decision actually made, and carries the example it came from.
The examples are written to stand alone: you should be able to take the point without knowing the
feature they happened in.

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

### 11. Degrade honestly

When you cannot be sure, show less. Never show something invented that happens to be well-formed.

> *In practice:* every approved fallback shows less rather than more — the whole order instead of a
> guessed subset; real prices that do not add up to the charge instead of adjusted ones that do; an
> unstyled row instead of an affordance that does nothing.

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

### 20. Build the instrument that makes the case visible

Not to check work that is already done — to surface cases nobody thought to ask about.

> *In practice:* a heuristic was validated by replaying two years of real history through it before
> any of it was written; then a prototype with configurable scenarios; then a working simulation of
> the flow. Between them they found a rounding drift, an inconsistency between sibling records, a
> visual cue that lied, and an edge case that reshaped the algorithm twice — none of which code
> review had found. And such tools are for operating, not reading: "strip all the explanations
> (I don't read them)."

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
