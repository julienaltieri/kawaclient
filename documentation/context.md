# Documentation — Context

> **Purpose of this file:** the map of this folder. It states what belongs here, the rules for
> writing it, and the process to follow. It holds no subject matter itself — every system is
> described in its own file, listed under [What's in here](#whats-in-here).
>
> **Audience:** hybrid — a human collaborator and an AI agent arriving cold, in one pass.

---

## What this folder is

Technical documentation for Kawabudget: **how things actually work**, and why they were built that
way. One file per *system* — a coherent capability that a person would name out loud ("the Amazon
transaction pipeline"), regardless of how many folders or repos it happens to span.

It is not a README. A README covers setup and usage — how to install and run. These files answer
*what is this, why does it exist, and how does it actually work*, for someone who has never seen the
code.

## What this folder is not

- **Not per-folder context files.** The convention these rules come from puts a `context.md` inside
  every meaningful folder. Kawabudget was not built that way and is not being restructured, so the
  documentation is centralised here instead and organised by subject rather than by folder.
- **Not standing instructions for the agent.** No `CLAUDE.md` here; that is a separate concern.
- **Not a work log.** No status, no todos, no "currently investigating". See Rule 5.
- **Not a place for anything the code already says clearly.** If a reader can get it faster from the
  source, link the source.

## Where these rules come from

Absorbed from [claude-code-starter-kit](https://github.com/julienaltieri/claude-code-starter-kit)
(`03-project-kickoff.md`, §2), and **adapted** — that kit describes shaping a repo from scratch,
which is not what is happening here. The adaptations are noted inline under each rule. We took the
hygiene, not the folder structure.

---

## The hygiene rules

### Rule 1 — Every system that is a real thing has a file here

One file per system, named after the system. A system is real if it can break, and if someone would
have to go read several files to understand it. If a subject needs three sentences, it is a section
in an existing file, not a new file.

> *Adapted:* the original rule is "every folder that is a real thing has a `context.md`". Here the
> unit is the **system**, not the folder, because the repo layout does not follow the systems — the
> Amazon pipeline alone spans a Chrome extension, a React client and a Lambda backend in three
> separate repos.

### Rule 2 — Human and agent readable

Plain markdown. No unexplained jargon, no shorthand only the author understands. A cold reader should
understand the system from that one file plus the links it points at.

### Rule 3 — Never redundant, across repos as well as within

A file here never restates what another file already covers — not another file in this folder, and
**not a context file in another repo**. Link instead, by full repo URL when the target lives
elsewhere, and say plainly which side owns which half of the subject.

This matters more across a repo boundary than within one: two repos evolve on their own schedules,
and a copied paragraph will be silently wrong the first time the other side changes. If the same
explanation appears in two places, one of them is wrong and it is usually the copy.

> *Adapted:* the original rule is about parent/child folder nesting. Here the hierarchy is by
> subject and it crosses repo boundaries, so "link upward to the parent" becomes "link outward to
> whoever owns that half, by address".

### Rule 4 — The map is not the territory

**This file is the map.** It holds the rules, the process and the index — never mechanism. Each
system file is the territory and is allowed to be as detailed as the system demands.

**The test:** if you can answer "how does X work?" from this file, that detail is in the wrong place.
Move it into the system's own file.

### Rule 5 — No volatile information

Status, current metrics, todo counts, in-progress notes, "as of this week", "currently broken" —
none of it belongs here. It goes stale silently, and stale documentation is worse than none, because
it gets acted on with confidence.

Point at the source of truth instead: the code, the git history, the deploy log. A fact that will be
wrong in three weeks either gets cut or gets replaced by a pointer to wherever it stays true.

### Rule 6 — Anything added here must be allowlisted, or it is invisible

`client/.gitignore` is an **allowlist**: it ignores `*` and then re-includes named paths. Anything
not explicitly re-included is silently untracked — it will look fine locally, never reach GitHub, and
never reach a deploy. `documentation/` is allowlisted; if this folder ever gains a subfolder that
needs committing, check `git status` actually sees it.

> *Adapted:* the original Rule 6 mandates a gitignored `.local/` scratch folder in every project
> folder. That rule is unnecessary here and its inverse is the real hazard — this repo ignores
> everything by default, so the risk is not committing junk, it is failing to commit the real thing.
> There is no `.local/` here: this folder holds no scratch, only finished documentation.

---

## The documentation process

**Standing instructions. This section is where instructions about how documentation gets done are
recorded.** When Julien gives an instruction about the documentation process — naming, structure,
what to include or leave out, when to write it — add it here in his terms, rather than only acting
on it once. That is what keeps the process from having to be re-explained every session.

Recorded so far:

1. **Documentation lives in `client/documentation/`.** Not scattered as per-folder context files.
   The project was not built to that convention and is not being restructured to fit it.
2. **Absorb good hygiene, do not import structure.** Take the conventions from the starter kit;
   do not reshape the repo around them.
3. **Never state what another repo's context file already states.** Point at that repo by address
   and let it own its half. The two evolve independently, so a copy will drift.
4. **Name a file after the system it describes**, in lowercase with hyphens.
5. **Update a system's file in the same session as the change it describes** — not "later". It takes
   two minutes then and thirty afterwards, and a file that describes a version of the system that no
   longer exists is worse than an absent one.

**A useful standing review prompt:**

> Read every file in `client/documentation/`. Tell me what is now inaccurate, what duplicates
> something owned by another repo, what is volatile and should be cut, and which systems have no
> file yet.

---

## What's in here

| File | System it describes |
|---|---|
| [`amazon-transaction.md`](amazon-transaction.md) | How Amazon order data is scraped, ingested, matched to bank transactions, and split by item. |
| [`zero-sum-streams.md`](zero-sum-streams.md) | Streams whose transactions are expected to cancel out: how debits and credits are paired, and how an Amazon return auto-splits the charge that funds it. |

---

## Where the live truth lives

Nothing in this folder is a source of truth about current state. For that:

- **What the code does right now** — the code, and `git log`.
- **The Amazon scraper's internals and data schema** —
  [kawaAmazonParser](https://github.com/julienaltieri/kawaAmazonParser) `context.md`.
- **The unattended scrape schedule and its run reports** —
  [AI-workflows-Julien-Altieri](https://github.com/julienaltieri/AI-workflows-Julien-Altieri),
  `kawa-amz-refresh-automation/context.md`.
- **Build and deploy status** — Netlify, for the client.
