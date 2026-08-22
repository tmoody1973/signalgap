# Learning log

Running retro of real learnings from building SignalGap. Dated, three questions each: what did we expect, what happened, what do we now believe.

---

## 2026-08-22 — Renaming product labels touches more files than the labels themselves

**Expected:** Renaming ten label strings (see [[003-newsroom-label-language]]) would mostly be a find-and-replace inside one file, `src/lib/source-labels.ts`.

**Happened:** The same label strings were also hard-coded as literal values in the Convex schema validator (`convex/lib/validators.ts`, the code that tells the database which exact values a field is allowed to hold), in a unit test, in an end-to-end browser test, and repeated across five separate planning and product documents — including inside example code blocks in the original planning doc. One label ("Partial") also collided in a plain-text search with an unrelated TypeScript built-in type, `Partial<...>` (a utility type meaning "all these fields are optional"), which meant a blind find-and-replace across the codebase would have silently broken type signatures in the planning doc's code samples.

**Now believe:** A user-facing string that appears in more than one file should be traced with a full-repository search before editing, not assumed to live in a single source of truth — especially once it has also been typed as a literal value in a schema validator, which is easy to miss because it does not look like UI copy.
