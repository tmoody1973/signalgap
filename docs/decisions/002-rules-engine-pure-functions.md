# 002: Editorial rules engine as pure functions

## Decision

Write every editorial rule — deciding whether a lead is eligible, what score it gets, and what label it shows — as a plain TypeScript function in `convex/editorial/` with no import from Convex (the backend/database platform this project runs on). AI never sets eligibility, a score, or a label directly; it only supplies raw signals that these functions read.

## Why this came up

SignalGap uses AI to help find and describe news leads, but the product's core promise is that editorial judgment — is this lead real, how strong is it, what should it be called — is decided by rules a person can read and trust, not by an AI's guess. The project's `CLAUDE.md` build rule states this directly: "AI suggests; deterministic code in `convex/editorial/` decides eligibility, labels, scores." A "pure function" here means a function whose answer depends only on the values you hand it — same input always gives the same output, no hidden reads from a database or the AI, no side effects. That property is what makes a rule provable and fast to test.

## Options

1. **Put the rules inside Convex mutations** (the functions that read and write the database). Simplest to wire up — one file, one place — but every test then needs a running Convex backend, and it becomes easy to accidentally let a rule quietly read extra database state it shouldn't depend on.
2. **Put the rules in the AI prompt** (ask the AI to also decide eligibility/score/label as part of its answer). Fastest to build and adapts easily to new cases, but it breaks the core promise: the exact reasoning becomes whatever the AI produced that run, unreadable and not guaranteed to repeat the same way twice, and it directly violates the non-negotiable rule in `CLAUDE.md`.
3. **Pure functions with zero Convex imports**, called by a thin Convex layer. Slightly more setup — an explicit "input" object has to be built and handed to the function — but every rule can be unit-tested in milliseconds with plain data, with no server, no database, and no network involved.

## What we chose and why

Option 3, pure functions — the shape Tarik approved via the spec, with Claude implementing the actual function boundaries. `convex/editorial/eligibility.ts`, `scoring.ts`, `coverage.ts`, `independence.ts`, and `status.ts` all take a typed input object and return a typed result; none of them import anything from `convex/_generated` or the Convex runtime. That is checkable by search: `grep -rl "from \"convex` convex/editorial/` returns nothing.

## What we gave up

- **An extra assembly step.** Something else (a Convex query or mutation) has to gather the real data — sources, coverage state, timestamps — into the plain input object these functions expect. That's more code than letting a mutation reach into the database directly mid-calculation.
- **Speed of adding one-off exceptions.** Because these functions are the single source of truth for eligibility/score/label, a special case can't be quietly patched into one Convex mutation — it has to go through the shared function, which is slower for edge-case fixes but is exactly what prevents the rules from drifting apart across call sites.
- **A small amount of type duplication.** The pure functions define their own input/output types (`CandidateInput`, `EngineSource`, `ScoreComponents`, and so on), which have to be kept lined up with the Convex schema validators (`vScoreComponents` in `convex/lib/validators.ts`) that shape what actually gets stored — checked by hand rather than shared automatically.

In exchange, the six rule files run today under `tests/unit/editorial/` with no server needed — `scoring.test.ts`, `status.test.ts`, `coverage.test.ts`, `independence.test.ts`, `eligibility.test.ts`, `config.test.ts` — and every one runs in the fast unit-test project, not the slower Convex-backed one.

## How we'll know if this was right

If a bug in eligibility, scoring, or labeling can always be reproduced with a small hand-written input object and a unit test — no database, no AI call, no live scan needed — and if `grep -rl "from \"convex" convex/editorial/` keeps returning nothing as the project grows.

## What actually happened

<!-- Tarik fills this in. -->
