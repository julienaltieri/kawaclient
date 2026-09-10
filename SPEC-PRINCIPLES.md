# How Julien Specs

How a specification gets written here. **Read before writing or editing one.**

Its siblings answer different questions. [`DECISION-PRINCIPLES.md`](DECISION-PRINCIPLES.md) answers
*how decisions get made*. [`documentation/`](documentation/context.md) answers *how things work*, for
systems that already exist. This file answers *how a problem gets written down before it is solved* —
the document that states a goal, carves it into sub-problems, and records what has been settled.

A spec here is not a plan and not a design doc. It is the durable record of a problem: what is being
solved, what the answer must look like, what is decided, and what is still open. It is written before
the code and it outlives it.

Every principle below was extracted from a correction actually made to a spec in progress, and carries
the example it came from. The examples stand alone — you should be able to take the point without
knowing the module they happened in.

The numbers are stable addresses. Anything learned later is appended to its section rather than
inserted.

---

## What a spec is

### 1. A spec states constraints. It does not address a reader

No "make sure to", no "say so", no "note that". Those are instructions to someone, and a spec has no
someone: it describes a system, and the description is either true of the system or it is not. The
imperative voice also hides the constraint, because "say which account it maps to" and "the mapping is
explicit" look alike but only the second can be checked against an implementation.

> *In practice:* a line read "where the stream moves money through two accounts, say so." The
> correction: *"'say so' is irrelevant. This file is not an instruction to an llm, it's a spec to track
> a problem goal and implementation. The prose should state the constraints."*

### 2. Cut every trace of the document's own production

How the document came to be written, what it will grow into, what process it is part of, how to read
it — all of it is bureaucracy that ages badly and helps nobody. Open with the scope and go.

> *In practice:* an opening paragraph gave the scope in its first sentence and then spent three more
> describing the process by which the sections would be filled in. *"The first sentence is scope
> (good) the rest is meta comments. Remove the meta comments about the process of coming up with this
> doc. This is useless bureaucracy."*

### 3. Do not mingle the what with the how

A sub-problem is a statement of what must be true, and it stays that way until its approach is
actually decided. Slipping mechanism into the problem statement pre-commits the solution and, worse,
reads as settled when it never was.

> *In practice:* a line described the stages as carrying "status" and shared state, which is a design
> for how they would be run. *"I didn't decide that. I wouldn't mingle the what with the how. The only
> thing we can say is each of these are sub problems to solve for that will carry their own logic and
> output contract."*

---

## What a spec must not contain

### 4. A spec must not bind a module to its consumers

Name what the module owns and what it hands back. Naming who will consume it, and what they will do
with it, ties the spec to features that may not exist next year and invites the module to be designed
around one of them. The boundary is stated once, in the direction that holds: anything that takes the
output as input is downstream, and out of scope.

> *In practice:* a section closed by explaining how the balance view would use the output. *"It
> mentions a downstream implication that violates hygiene: we may use this module for other use cases
> and features than the balance so its spec shouldn't bind it to downstream customers."*

### 5. Do not lock scope on a question that has not been asked yet

Writing "it does not do X" forecloses X. If nothing has been decided about X and nothing depends on
the answer, the spec says nothing about X.

> *In practice:* the purpose section said the module "predicts, and only predicts — it does not
> explain itself." *"Leave out the 'does not explain itself', no need to lock scope on this as it may
> change if we need."* The line became a statement of what a prediction carries today, with the
> question of how much further it should account for itself moved to Still open.

### 6. Name a decision only once it is made

An unmade decision written as prose reads exactly like a made one six months later. Where a choice is
genuinely open, the spec says the choice is open — in the same sentence, not in a footnote.

> *In practice:* a field was described as carrying its source data "by id, not by copy", with a
> paragraph arguing for identifiers over copies. *"Drop the choice of making it by id. This could be
> an array of pointers and we haven't decided the exact format yet."*

### 7. A caveat that will need deleting later is a liability

If removing a temporary qualifier leaves the sentence true, the qualifier was never carrying meaning —
it was carrying a chore. Someone has to find it and delete it at exactly the right moment, and nobody
will.

> *In practice:* a field read "the method that produced that amount, from an enum whose members are
> not yet defined." *"Remove this. It is a liability when we define the enum, while removing it still
> stays accurate."*

### 8. A heuristic offered as a test must actually decide the cases

"The test is direction: if it takes X as input, it is not here" sounds rigorous and settles nothing —
it names one obvious case and gives false confidence about the hard ones. A rule of thumb that does
not adjudicate the difficult examples is worse than no rule, because it stops the thinking.

> *In practice:* a scope boundary was stated, then followed by an enumeration of five excluded
> activities and a one-line "test" for deciding new ones. *"The test is inefficient. Remove, to avoid
> a false confidence. 'Anything that consumes a prediction' is enough."*

---

## Language

### 9. State what a thing is, not what it is not

"Not a distribution, not money per day — a list of events" spends two clauses on things nobody
proposed. Counter-directives dilute the sentence they defend and quietly imply someone was arguing the
other way.

> *In practice:* *"These counter-directives dilute the context. Remove."*

### 10. No cryptic references — a section carries its own meaning

Never "as described in §2", never "the previous stage". Say the thing: "the movements already placed".
A positional reference is hard to follow on first read and becomes false the moment a section is
inserted, and the failure is silent.

> *In practice:* a heading's subtitle referred to "2) and 3)". *"Don't use 2) 3) as references. This
> is hard to follow and becomes obsolete the moment we add a paragraph in between. Each of these
> sections must carry their own relevance in meaning."* The same edit later left a table of contents
> still citing a sentence that had been cut — exactly the rot the rule describes.

### 11. Say it once

A heading that restates itself in its first sentence, a paragraph that makes the same point in three
constructions, a two-column table with the second column paraphrasing the first — all the same waste.

> *In practice:* a paragraph headed "Two levels, because the facts sit at two levels" then spent four
> sentences arriving at the same claim. *"Simplify or delete. If you keep, no repetitions please."* It
> became one sentence.

### 12. One concept, one word — everywhere in the document

A concept gets a name and keeps it. Synonyms dilute the meaning: each near-miss word carries a
slightly different connotation, so a reader cannot tell whether two passages are describing the same
thing or two related things, and an implementer has to guess. The consistent word is also the shorter
read, because nothing has to be re-identified.

Prose synonyms are the ones that slip through, because varying the word feels like good writing. It
is not; a spec is not prose. Where the concept already has a field name in the output contract, that
name is the word.

> *In practice:* one concept — how often a stream moves money — was being called *rhythm*, *frequency*
> and *cycle* in different sections, while the field it corresponds to was named `inferredCycle`.
> *"Replace all in the document: rhythm by cycle. Rule: keeping specific vocabulary consistent avoids
> dilution of meaning, reduces room for errors and makes it more readable."* Ten replacements, none of
> which changed a claim.

A word is exempt only when the document defines it as covering something the other word does not, and
that claim gets checked, not assumed. *Timing* was first kept as an umbrella over *cycle* plus
*schedule* — until the schedule half turned out not to be a real output of that stage at all, just an
example carried over from an earlier draft. *"Confirming that what we care about is the cycle — more
precise than timing."* Once the exemption was checked, it did not hold, and *timing* was replaced too.

An earned exemption still has to be re-earned every time the document changes under it.

### 13. Simplify until the sentence carries the idea and nothing else

Long, hedged, self-qualifying prose is the default failure mode of a spec, and it does not read as
careful — it reads as unclear.

> *In practice:* *"Confusing language. Simplify."* on a sentence that took three clauses to say
> confidence differs between events.

---

## Structure

### 14. An explanation belongs with the thing it explains

Field tables followed by paragraphs arguing for individual fields rot immediately: the field gets
renamed, the paragraph does not, and now two places disagree. Put the argument in a column on the
field's own row. It also forces the argument to be short enough to be worth having.

> *In practice:* a two-column output contract was followed by eleven paragraphs, each naming a field
> and arguing for it. *"Migrate all the prose about the field explanation to a third column."* Nothing
> was cut; every argument moved onto the row it belonged to.

### 15. Every stage carries In, Out, and Solved when

Three fixed slots, in that order. In and Out make the stage's contract checkable without reading the
prose. **Solved when** is the acceptance criterion, and it is what stops a stage being declared done
by feel.

### 16. Solved when must be falsifiable against a fixed set

"Works well" is not a criterion. Name the data it is judged against and the standard it has to meet on
that data, so passing and failing are distinguishable.

> *In practice:* a criterion listed three qualitative properties. It became: *"every stream resolves
> to the weighted partition of the accounts its money actually moved through — correct for every
> stream in the captured portfolio, with no error budget."* A fixed corpus, and a bar that can be
> missed.

### 17. Record what is decided and what is still open, in the document

Two standing sections. **Decided** exists so a settled question is not re-opened by accident, and each
row states the answer, not the debate. **Still open** exists so an unanswered question is visibly
unanswered rather than quietly assumed.

### 18. The output contract's field names are decisions, and they are made in the spec

Not "some kind of cycle field" — the name, spelled the way the code will spell it. Cross-references
between fields use those names too, so a rename is a search-and-replace rather than an interpretation.
Namespaces earn their keep or go: a `basis.` prefix on six of eight fields grouped things that had no
reason to be grouped, and flattening it made the shared suffixes (`…Determination`) carry the meaning
instead.

> *In practice:* the contract's fields were renamed across eight rounds — `basis.timing` →
> `timingDetermination` → `cycleDetermination`, `basis.shape` → `inferredShape`, `basedOn` →
> `transactionBase`. Each rename was cheap because the names lived in one table; each would have been
> expensive after the code existed.

### 19. Name the concrete type wherever one already exists

Describing a value only by example leaves the reader to guess whether it is a string, an enum, or an
object. If the codebase already has the type, cite it.

> *In practice:* a field was described as "monthly, semi-monthly, every seven days". *"This I can say
> confidently that the return type should be a `Period` object as defined in `Time.js`."*

---

## Process

### 20. One correction, one edit, one commit

A spec under review changes many times in a session. Landing each correction as its own commit keeps
the reasoning attached to the change, and means a decision can be found later by reading the log
rather than by remembering the conversation.

### 21. The review surface is not the document

Reviewing a spec somewhere convenient — a rendered page, a shared view — is fine, and the edits still
land in the file. The reviewed copy is a vessel; the document in the repository is the artefact, and
it is updated in the same breath, never afterwards from memory.

> *In practice:* mid-review: *"All the comments I make to the artifacts and the changes you are
> making: are you transporting them to the documentation file? The artifact is only the vessel to
> enable my iterations."*
