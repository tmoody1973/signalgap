# Learning log

Running retro of real learnings from building SignalGap. Dated, three questions each: what did we expect, what happened, what do we now believe.

---

## 2026-08-22 — Renaming product labels touches more files than the labels themselves

**Expected:** Renaming ten label strings (see [[003-newsroom-label-language]]) would mostly be a find-and-replace inside one file, `src/lib/source-labels.ts`.

**Happened:** The same label strings were also hard-coded as literal values in the Convex schema validator (`convex/lib/validators.ts`, the code that tells the database which exact values a field is allowed to hold), in a unit test, in an end-to-end browser test, and repeated across five separate planning and product documents — including inside example code blocks in the original planning doc. One label ("Partial") also collided in a plain-text search with an unrelated TypeScript built-in type, `Partial<...>` (a utility type meaning "all these fields are optional"), which meant a blind find-and-replace across the codebase would have silently broken type signatures in the planning doc's code samples.

**Now believe:** A user-facing string that appears in more than one file should be traced with a full-repository search before editing, not assumed to live in a single source of truth — especially once it has also been typed as a literal value in a schema validator, which is easy to miss because it does not look like UI copy.

---

## 2026-08-22 — Closing out checklist items 1–4: foundation, editorial rules, auth shell, workspace UI

**Expected:** Items 1–4 of the build checklist (project setup, the pure-function editorial rules engine — see [[002-rules-engine-pure-functions]], Clerk sign-in plus Convex schema, and the authenticated workspace shell) would take roughly the planned time and close cleanly, since each task had a written brief before work started.

**Happened:** Clerk (the login/authentication service) needed three manual setup steps outside the code — steps a coding agent cannot do by itself because they require clicking through an external dashboard, not editing files. Two defects were caught by review before they shipped: a test-runner config gap (the `vitest` "projects" setup that separates fast pure-function tests from slower Convex-backed tests wasn't wired for both groups at first) and a one-word logic-direction bug in `eligibilityTransition` — a function meant to flag only leads moving from eligible to excluded, which the first version had backwards. The ten product-facing labels also needed a full rewrite mid-plan after Tarik reviewed them and found the wording read like a requirements document instead of newsroom language (see [[003-newsroom-label-language]]).

**Now believe:** A written brief before a task starts catches scope questions, but it doesn't catch direction bugs (this rule fires on X→Y, not Y→X) or tone-of-voice problems (technically correct wording that doesn't sound like the people who'll read it) — those need a human read of the actual output, not just a review of the plan. Budget review passes as real time in the plan, not as a buffer for if something goes wrong.
