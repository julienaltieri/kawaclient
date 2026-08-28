# CLAUDE.md

Working instructions for the Kawa client.

## Read first

**[DECISION-PRINCIPLES.md](DECISION-PRINCIPLES.md) — how decisions get made here.** Read it before
starting work. It covers scope, correctness under uncertainty, interface judgement, design-system
values, process and test coverage. When a call is not obvious, that file is the tie-breaker.

**[documentation/](documentation/context.md) — how the systems work.** One file per system, with the
rules for writing them in `context.md`. Update a system's file in the same session as the change it
describes.

## House notes

- **`.gitignore` here is an allowlist.** It ignores `*` and re-includes named paths. Anything not
  explicitly re-included is silently untracked: it looks fine locally, never reaches GitHub, never
  reaches a deploy. If you add a file at this level, check `git status` actually sees it.
- **Local dev toggles live in the working tree.** `src/AppConfig.js` (`staging`) and `package.json`
  (`proxy`) are routinely modified and must not be committed. Stage files explicitly; never
  `git add -A`.
- **Netlify builds `master`.** A branch is not deployed.
