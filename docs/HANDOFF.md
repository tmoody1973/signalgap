# SignalGap — session handoff

**Last updated:** 2026-08-24, 20:35 CDT.
**Purpose:** everything a fresh Claude session needs to pick this up without re-deriving it. Read this, then `docs/hackathon-build/spec.md`.

---

## 0. START HERE

**Item 8 is done and closed. Item 9 is split into three parts; part A (the ranked feed) is mid-build — 3 of 8 tasks complete, task 4 was in flight when this was written.**

First thing to do:

```bash
cd /Users/tarikmoody/Projects/SignalGap
git log --oneline -5          # did task 4 land? look for "feat(feed): the lead card"
git status --short            # anything uncommitted is a task that stalled mid-flight
cat .superpowers/sdd/2026-08-24-signalgap-ranked-feed/progress.md
```

**The ledger is the memory.** It holds the pre-flight scan, every ruling with what it costs if wrong, and a completion line per task. Trust it and `git log` over anything you think you remember.

Then resume at the first task with no `complete` line, using `superpowers:subagent-driven-development` against `docs/superpowers/plans/2026-08-24-signalgap-ranked-feed.md`.

**Nothing is blocked. Nothing is waiting on Tarik.**

---

## 1. What SignalGap is

An editorial lead-discovery workspace for small Milwaukee newsrooms. It searches the public web through SerpApi, uses AI to connect and explain related signals, applies **deterministic rules** to decide what qualifies, and hands a human editor a source-linked reporting brief. Built for the SerpApi "Best AI Use Case" hackathon.

The central claim, which every decision defends: **SerpApi gives it live eyes. AI connects and interprets. Transparent rules and a journalist decide what is credible.** AI may never set eligibility, a score, or the `Coverage gap` label.

---

## 2. Where the work lives

| Thing | Where |
| --- | --- |
| Repo (public) | https://github.com/tmoody1973/signalgap |
| Linear project | https://linear.app/moodyco/project/signalgap-hackathon-mvp-bb9da1e41e47 |
| Spec / PRD / scope / checklist | `docs/hackathon-build/` |
| Decision log | `docs/decisions/` (001–007) |
| Learning log | `docs/LEARNING-LOG.md` |
| Plans | `docs/superpowers/plans/` |
| Convex dev deployment | `dev:handsome-lapwing-832` |

**Linear issues map 1:1 to the 12 checklist items.** MOO-727 … MOO-738.

---

## 3. Status

| Item | Linear | State |
| --- | --- | --- |
| 1–7 | MOO-727…733 | **Done** |
| 8. Durable scan workflow | MOO-734 | **Done** — 20 commits, CI green, closed with evidence |
| 9. Feed + controls + history | MOO-735 | **Split into three. Part A (feed) is 3/8 tasks in.** |
| 10–12 | MOO-736…738 | Not started |

`main` is at `f5c1125`, pushed, CI green. **437 unit/integration tests, 30 Playwright tests.**

### Item 9 is three plans, not one

Tarik's call, 2026-08-24. It is really three subsystems and the feed is the missing front door — until it exists, nothing links the workspace to a lead and you would have to know the URL.

- **Part A — the ranked feed.** `docs/superpowers/plans/2026-08-24-signalgap-ranked-feed.md`. In progress.
- **Part B — editorial controls.** Reject/Monitor/Assign, notes, corrections, immutable brief regeneration. Not planned yet. **`Outdated` still has no schema home** and belongs here — it is brief-scoped, so it must NOT go into `vProductLabel`.
- **Part C — histories and scan comparison.** Not planned yet.

Only tick the feed bullets on checklist item 9. A checklist that overstates is worse than one that lags.

---

## 4. How the work is being done

**Process:** `superpowers:subagent-driven-development`. Per task: a fresh implementer works from an extracted brief; an independent reviewer runs against the diff; findings go into a fix loop; each fix round ends with a scoped re-review; the task ends with a commit. Then a whole-branch review on the strongest model, and one fix wave.

**It works.** Item 8 shipped six real defects caught before merge, three of them by implementers escalating instead of guessing.

**Tracking:** `linear-build` skill. Post evidence as a comment before moving an issue to Done. Commits end with the issue id.

### Process notes that cost real time to learn

- **Reviewers must write their report to a file AND reply.** One went idle without reporting and its whole review was lost. Every review prompt now says so.
- **Implementers go idle mid-task without reporting, often.** Check `git log` and `git status`, not silence. Twice a task was complete and committed while the agent said nothing.
- **A report is a claim, not evidence.** One report asserted an import that did not exist. Reviewers are told to verify claims against the code, and implementers are now told plainly that "I could not do this" is always an acceptable answer.
- **UI cannot be verified by reading.** Seed a record and open it in a browser. Item 7 found five defects this way that 352 green tests never would.
- **Never let an implementer run `/simplify`.** One did and it edited a shared module outside its task.
- **Weigh the model by verification burden, not writing burden.** A cheap model on a "just transcribe this" task produced correct-ish code and an overclaiming report.

---

## 5. Environment

`.env.local` (git-ignored, never commit) holds: Clerk publishable + secret keys, `E2E_CLERK_EMAIL` / `E2E_CLERK_PASSWORD`, `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_APP_URL`, `SERPAPI_API_KEY`, `ANTHROPIC_API_KEY`.

Convex deployment env holds: `CLERK_JWT_ISSUER_DOMAIN`, `SERPAPI_API_KEY`, `ANTHROPIC_API_KEY`, `AI_PRIMARY_MODEL=claude-sonnet-5`, `AI_FALLBACK_MODEL=gpt-5.6-terra`, `AI_FALLBACK_ENABLED=false`.

**No `OPENAI_API_KEY`** — `docs/model-evaluation.md` is a measurement of Sonnet, not a head-to-head, and says so.

**SerpApi: Starter, ~983 searches left this month.** A single live scan may use up to 120.

**Model spend to date: about $1.62.**

### Gotchas

- `npx convex codegen` does **not** deploy. Also run `npx convex dev --once`.
- Convex CLI needs the env sourced: `set -a; . ./.env.local; set +a`.
- `.env.local` has twice been clobbered when keys were added. If Convex commands suddenly fail, check that file first.
- **`vitest` runs with module-scope fake timers**, so `Date.now()` is frozen inside a test. Any assertion comparing two timestamps within one test compares a value to itself. This made one test vacuous for days.
- **Do not add a global `SERPAPI_API_KEY` stub.** `tests/integration/helpers.ts` carries a comment explaining why: the drained workflow handler runs without a `fetchImpl`, so the missing key is the only thing stopping a leaked continuation from firing **real paid searches from a unit test run**.

---

## 6. Rulings a new session must honor

The full list with costs-if-wrong is in each plan's ledger. The load-bearing ones:

### Product

- **Labels are newsroom language, not spec-speak** (Tarik). Decision 003.
- **Google Events is enrichment, not discovery** (Tarik). The fixed opening set is **13 searches, not 16**. `SEARCH_BUDGET.discovery` stays at 16 as a *ceiling*. Decision 005.
- **The two-independent-category gate stays** (Tarik, 2026-08-23). Three newsrooms covering something means an editor is late, not early; loosening it turns the feed into a clip service. The screen explains the failed rule instead. Decision 007.
- **A lead the AI could not read is shown, not hidden** (Tarik, 2026-08-24). New exclusion reason `unreadable_evidence`, and the verdict comes from the rules engine so "transparent rules decide" stays true.

### Correctness

- **`convex/candidates/evaluate.ts` is the ONLY writer** of `status`, `primaryLabel`, `scoreTotal`, `scoreComponents`, `independentCategoryCount`, `coverageOriginalCount`, `coveragePassStatus`, `exclusionReasons`. This invariant has been defended four times. Do not add a second writer.
- **`startAsync: true` on the workflow start is load-bearing.** Without it `start()` runs the entire handler inline inside the `startScan` mutation — 13 searches and several model calls while the user's click hangs, past the mutation time limit.
- **`cancel` finalizes the scan itself.** A cancelled workflow never reaches its own `finalize`, and `startScan` refuses a new scan while one is queued or running — so without this, one cancel locks the user out permanently.
- **A terminal scan is a snapshot.** `setStage`, `recordFailure`, `setCandidateCounts` and the counter writes in `searchRuns.complete`/`fail` all refuse to move a scan that has ended.
- **`searchRuns.complete`/`fail` are the only writers of the scan's search counters.** A bulk `recordSearchOutcome` used to exist and double-counted every search; it is deleted. Do not reintroduce it.
- **Both coverage partitions must succeed** for `coveragePassStatus = "complete"`. A failed partition blocks `Coverage gap` but must not bin the lead. This is the equity rule: searching only the general outlets and finding nothing is not "nobody covered this."
- **Entity terms from a model go through an allowlist, not a denylist.** A denylist was demonstrably bypassable six ways.
- **The logged query must equal the executed query.**

### Evidence honesty

- **`convex-test` cannot execute the Convex Workflow component.** Integration tests prove the steps and their order by driving them directly. **Only a live scan proves the workflow replays.** That is item 10.
- **The in-process budget tests prove arithmetic, not concurrency.** The concurrency proof is `tests/live/reserve-concurrency.test.ts` (20 separate processes; granted=5, rejected=15, reserved=120, zero SerpApi calls). Do not quote one as the other.
- **Fixtures must not rot.** `seedSliceFixture`'s `now` is anchored to `Date.UTC(2026, 7, 20)`, not `Date.now()`, because the captured articles are dated 17–18 August and the gap widened daily until the reviewed lead aged out of the discovery window and silently changed verdict. **Never "modernise" that back.**
- **Every fixture source carries the search that could really have found it.**
- **Never introduce a fabricated result to improve a demo.** This session shipped an invented lead once and Tarik caught it.

---

## 7. Carried forward

| For | What |
| --- | --- |
| **Item 10** | **The live scan has never been run.** Nothing has spent real search budget. Only it proves the workflow replays in order. Up to 120 of ~983 searches. **Tarik's call to authorise.** |
| **Item 10** | Google Events is still unverified against a real payload — the engine returns nothing. Re-check whether SerpApi fixed it. |
| **Part A, task 5** | `scan.processingCount` starts at 0 and only moves once the **finalize** stage begins. A running scan can genuinely have candidates in flight during discovery/clustering/coverage while the count reads 0. The UI must not render it as "nothing is happening." |
| **Part B** | `selectForCoverage` computes real per-candidate reasons for why a lead was never coverage-checked. Nothing surfaces them. A coverage-skipped lead currently reads `coverage_pass_incomplete`, which is true but does not say *we ran out of budget before reaching you*. |
| **Part B** | `Outdated` has no schema home. Brief-scoped — must not enter `vProductLabel`. |
| **Anywhere** | **At most ten leads per scan can ever qualify**, because coverage affords two searches each out of twenty. The didn't-qualify list is where most of a scan lives. Honest, not broken — but check it against the live scan. |

---

## 8. Working agreements with Tarik

- **Plain English**, short sentences, one idea per sentence. When a decision is needed: two options, the context to choose fast, and a recommendation.
- **Decision log entries are a portfolio deliverable.** Written so a smart non-engineer can follow them, jargon defined inline on first use. Claude drafts the decision; **"What actually happened" is left blank for Tarik to fill in his own voice.** That split is what makes them credible.
- Read primary sources before building. A summary of a source is not the source.
- **Never weaken an evidence, locality, independence, coverage, or citation rule to make the feed look fuller.**
- Tell him what you did, whether it worked, and what he does now. If he has to decide: two options max.
