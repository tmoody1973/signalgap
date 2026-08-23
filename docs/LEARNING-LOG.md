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

---

## 2026-08-23 — The test that finally proves something is the one that costs money to skip

**Expected:** The 120-search budget cap was covered by a twenty-way concurrency test, so checklist item 5's acceptance line — "the 121st reservation cannot occur, including under concurrency" — was already satisfied.

**Happened:** A reviewer read the test runner's own source (`node_modules/convex-test/dist/index.js`) and found it takes a lock around every top-level transaction. The twenty reservations never actually overlapped. The test proved the code orders operations correctly and proved nothing whatsoever about what happens in production, where transactions really do collide. Closing the gap meant running the same reservation against the real deployment from twenty separate operating-system processes — twenty independent clients, twenty independent transactions. Result: exactly five granted out of twenty, counter landing on 120. Zero SerpApi calls, because it only exercises database writes. The plan's own suggested approach for this test was impossible as written: it assumed a browser-style client could call an internal function, which needs administrator credentials we do not have.

**Now believe:** A test framework that makes concurrency convenient is usually simulating it, and a simulated race proves ordering rather than safety. When an acceptance criterion contains the word "concurrent", read the test runner's source before believing the test. Also: the cheapest honest move is to write down that the evidence is missing. That note survived a context reset, three sessions, and a handoff document, and it is why the gap got closed instead of quietly shipping.

---

## 2026-08-23 — Our own guard called the model a liar, and the model was telling the truth

**Expected:** Running eighteen evaluation packets against Claude Sonnet 5 would mostly measure the model: does it invent sources, does it invent quotations, does it resolve contradictions it should preserve.

**Happened:** Four of eighteen packets failed the source-binding check, which is the guard that rejects fabricated citations. Every failure looked like the model inventing a quotation. It was not. The rule demanded that a quotation equal the **entire** stored snippet, and the model had quoted one true sentence out of a two-sentence snippet — word for word, nothing added, nothing changed. Checking each failure against the saved raw output showed all of them were verbatim substrings. The guard was wrong, not the model. Corrected to "a word-for-word run of at least 20 characters found inside a cited source", the same eighteen packets scored 39 of 39 with zero invalid outputs.

**Now believe:** A validation rule that has never been run against real output is a hypothesis, not a guarantee — and a strict-looking rule can be strict in the wrong dimension. Whole-field equality is not stricter about fabrication than verbatim-substring matching; both make invention impossible, and only one of them permits normal quoting. The practical fix that made this cheap to discover: save every raw model answer to disk during an evaluation run. It turned "pay again to find out why" into "read the file", and it is how the corrected rule was verified for free.

---

## 2026-08-23 — Idempotency keys stop duplicate records, not duplicate spending

**Expected:** The specification's model-idempotency key (scan, candidate, operation, input fingerprint, schema version, prompt version, model) would prevent paying twice for the same answer, because a repeat request would find the existing record.

**Happened:** It found the existing record and then called the model anyway. The key was doing exactly what it was written to do — avoid a duplicate row — while the expensive part, the network call, happened before anything consulted it. A test that simply asked for the same brief twice exposed it. The same shape of bug had already been found and fixed one layer down, in the paid-search budget, where re-running a finished search would have spent a second SerpApi call.

**Now believe:** An idempotency key protects whatever comes after the lookup. If the costly action sits before the check, or the check does not gate it, the key is a bookkeeping convenience and nothing more. The question to ask of any key is not "does this prevent a duplicate record" but "what, specifically, does this stop from happening twice" — and then write the test that does the thing twice.

---

## 2026-08-23 — Four bugs that only appear when you run the thing

**Expected:** With 352 unit and integration tests green and a design canvas drawn from the real tokens, building the evidence page would be assembly. The tests already covered the query, the rules and the pipeline; the components were rendering data that was known-correct.

**Happened:** The page did not load at all on first run — a Convex query fired before Clerk had attached its token, threw once, and never retried. Behind that were three more: evidence classified as `existing_coverage` rendered nowhere, because it matched none of the four kind-sections and its source was not a coverage-role source, so the official agenda citation was silently missing from a page whose entire job is showing citations. `formFromCluster` filed r/milwaukee as a corroborating source, which both inflated the independence count and let a dead Reddit link exclude a lead the rules should have kept. And `Why this surfaced` came out in database index order, putting the primary record third. None of the four could have been found by reading the code or the tests. All four took minutes to find once the page was on screen.

**Now believe:** For UI, "the data is correct" and "the page is right" are different claims with different evidence. A passing integration test proves a query returns a field; it cannot notice that no component renders it. The cheap habit that found all four was building a seeder that produces one finished record and then actually opening it — worth doing before the components are finished, not after.

---

## 2026-08-23 — A design that shows an impossible state teaches the wrong thing

**Expected:** Drawing the evidence page from the real tokens and the real fixture — every number computed by the actual rules engine — would make the design a faithful preview.

**Happened:** Two things in it were states the system cannot produce. The label read `Coverage gap` on a lead with a dead link; the rules give that lead `Needs a recheck`, because a reverification flag outranks the gap label. And every source's "found by" line showed one `site:city.milwaukee.gov` search — including a Journal Sentinel story, which that search can never return. Both were caught the same way: by running the manual backward trace the plan required, one link at a time, asking of each step "could this actually have happened?"

**Now believe:** A mockup drawn from real values is still a claim about behaviour, and it needs checking against the behaviour, not just the palette. The specific check that works is tracing one fact backwards through every hop and refusing to accept a hop you cannot justify — the same discipline the product is asking its users to apply to a lead. If a fixture cannot survive that trace, no amount of visual fidelity saves it.
