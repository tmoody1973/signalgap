# SignalGap — session handoff

**Last updated:** 2026-08-22, late afternoon CDT.
**Purpose:** everything a fresh Claude session needs to pick this up without re-deriving it. Read this, then `docs/hackathon-build/spec.md`.

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
| Approved spec / PRD / scope / checklist | `docs/hackathon-build/` |
| Decision log | `docs/decisions/` (001–005 so far) |
| Learning log | `docs/LEARNING-LOG.md` |
| Plans | `docs/superpowers/plans/` |
| Convex dev deployment | `dev:handsome-lapwing-832` |

**Linear issues map 1:1 to the 12 checklist items.** MOO-727 … MOO-738.

---

## 3. Status

| Item | Linear | State |
| --- | --- | --- |
| 1. Repo + CI foundation | MOO-727 | **Done** |
| 2. Design system + shell | MOO-728 | **Done** — Review Pause 1 approved by Tarik |
| 3. Clerk–Convex auth + data model | MOO-729 | **Done** |
| 4. Deterministic rules engine | MOO-730 | **Done** |
| 5. SerpApi adapter | MOO-731 | **In progress** — Tasks 1–7 of the plan complete, Task 8 remaining |
| 6. AI contracts | MOO-732 | Planned, not started |
| 7–12 | MOO-733…738 | Not planned yet |

Roughly 155 unit/integration tests plus 7 Playwright tests, all green. CI runs typecheck + lint + tests + build on every push.

---

## 4. How the work is being done

**Process:** the `superpowers:subagent-driven-development` skill. For each task: a fresh implementer subagent works from an extracted task brief; the controller (main session) then dispatches an independent reviewer against the diff; findings go into a fix loop; each task ends with a commit.

**The ledger is the memory.** `.superpowers/sdd/<plan-name>/progress.md` holds the pre-flight scan, every ruling, and per-task completion lines. It is git-ignored scratch — **if you are resuming, read it first.** Rulings are numbered and each states what it costs if wrong.

**Tracking:** `linear-build` skill. Each issue carries Intent / Acceptance criteria / Verification checklist. Post evidence as a comment before moving an issue to Done. Commits end with the issue id, e.g. `(MOO-731)`.

**Two hard-won process notes:**
- Implementer subagents go idle mid-task without reporting, fairly often. **Check `git log` and `git status` rather than trusting silence.**
- Do not let an implementer run `/simplify` or any refactor pass. One did, and it edited a shared module outside its task.

---

## 5. Environment — all configured, nothing pending

`.env.local` (git-ignored, never commit) holds: Clerk publishable + secret keys, `E2E_CLERK_EMAIL` / `E2E_CLERK_PASSWORD`, `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_APP_URL`, `SERPAPI_API_KEY`, `ANTHROPIC_API_KEY`.

Convex deployment env holds: `CLERK_JWT_ISSUER_DOMAIN`, `SERPAPI_API_KEY`, `ANTHROPIC_API_KEY`, `AI_PRIMARY_MODEL=claude-sonnet-5`, `AI_FALLBACK_MODEL=gpt-5.6-terra`, `AI_FALLBACK_ENABLED=false`.

Clerk is fully set up: app created, a JWT template named `convex` exists, and a test user exists with a strong password (the first one was rejected by Clerk's breach check).

**No `OPENAI_API_KEY`** — so the model challenger comparison in item 6 Task 14 is single-model unless Tarik adds one.

**SerpApi: Starter plan, 1000 searches/month.** ~985 remaining. About 10 have been spent on fixture capture and diagnostics. A single live scan may use up to 120.

**Gotchas that cost real time:**
- `npx convex codegen` does **not** deploy. After adding or changing a Convex function that a CLI or e2e run will call, also run `npx convex dev --once`.
- Convex CLI commands need the env sourced: `set -a; . ./.env.local; set +a`.
- `.env.local` has twice been clobbered when keys were added — `CONVEX_DEPLOYMENT` disappeared and `NEXT_PUBLIC_CONVEX_URL` reverted to the `example.convex.cloud` placeholder. If Convex commands suddenly fail, check that file first.

---

## 6. Rulings a new session must honor

These are decisions taken on Tarik's behalf during execution. Each is in the ledger with its cost-if-wrong. The load-bearing ones:

**Product**
- **Labels are newsroom language, not spec-speak** (Tarik's call). `Worth a look`, `Unverified tip`, `Coverage gap`, `Conflicting reports`, `Needs a recheck`, `No longer qualifies`, `Incomplete scan`, `Stopped early`, `Outdated`, `Saved copy`. Decision 003.
- **Google Events moved from discovery to enrichment** (Tarik's call). The engine returns zero results for everything including SerpApi's own documented example. The fixed opening set is **13 searches, not 16**. Connector kept and tested. Decision 005.
- **`No longer qualifies` is directional** — it fires only when a lead falls from eligible to excluded, never the reverse. The plan had this backwards.

**Correctness**
- **Eligibility follows the spec's wording, not a stricter reading.** Only an inaccessible `initiating` or `corroborating` source excludes a candidate; a dead enrichment link still shows `Needs a recheck` but does not kill the lead. An earlier stricter version would have thinned the live feed.
- **The logged query must equal the executed query.** Google News carries its time filter inside the query text (`when:7d`), so the template renders it — `buildParams` must never mutate `spec.query`.
- **Entity terms from a model go through an allowlist, not a denylist.** Plain words only; anything else is rejected, not sanitised. A denylist was demonstrably bypassable six ways.
- **`searchesReserved` means authorized paid attempts** and never exceeds 120. Re-opening a failed run counts as a new authorized attempt: it increments `searchesReserved`, decrements `searchesFailed`, and is refused at the cap.

**Evidence honesty**
- **The 120-cap concurrency test does not yet prove anything.** `convex-test` takes a mutex per top-level transaction, so its 20-way test never actually interleaves. Item 5's "including under concurrency" acceptance and demo gate 5 are **not satisfied** until Task 8's real-deployment check passes. Do not claim otherwise.
- **Two of seven normalizer branches (Events, Maps at the time) were tested against hand-written fixtures.** Maps has since been re-captured live. Events remains hand-written because the engine returns nothing.

---

## 7. Carried forward — do not lose these

Each is written into the relevant Linear issue as well.

| For | What |
| --- | --- |
| **MOO-732** (item 6) | **Decision 004.** The rules engine's judgment inputs (`localityBand`, `relevanceBand`, `beat`, and four flags) are worth 40 of 100 points and gate exclusions, but nothing records who set them. Each needs `basis: "deterministic" \| "ai_suggested" \| "editor"`, and `localityBand` needs a deterministic path via the already-written, currently-unused `isOfficialDomain`. Without this, "rules decide" is not honest. |
| **MOO-735** (item 9) | `Outdated` is brief-scoped and has no schema home. It must **not** be added to `vProductLabel` (the candidate label union) — it needs a field on `briefVersions` or `candidates`. |
| **Item 10** | The Events normalizer branch is unverified against a real payload. Re-check whether SerpApi has fixed the engine. |
| Deferred minors | Listed in each plan's ledger under `minor (deferred)`. None block. |

---

## 8. Immediate next steps

1. **Finish item 5.** Plan `docs/superpowers/plans/2026-08-22-signalgap-search-and-ai.md`, Task 8:
   - Cascade the e2e reset to delete `searchRuns` / `sourceResults` / stored blobs (otherwise `first-run.spec.ts` silently stops being clean now that those tables get written).
   - **The real-deployment concurrency proof** (Step 3b in the plan) — 20 parallel `ConvexHttpClient` calls at the deployed `reserve` on a scan at 115, asserting exactly 5 granted and the counter landing on 120. Costs **zero** SerpApi calls. This is the evidence gap named above.
   - One bounded live SerpApi smoke test — exactly **1** paid call.
   Then push, confirm CI, post evidence on MOO-731, close it.
2. **Item 6** — Tasks 9–15 of the same plan. Task 14 makes real paid model calls across 15–20 evaluation packets; **price it and get Tarik's approval before running.**
3. **Item 7** gets its own plan, written after items 5–6 land so its interfaces are real rather than predicted. It ends at **Review Pause 2**: one fixture lead traced from `Why this surfaced` through citations, coverage, score and generated brief. That plan was deliberately not written in advance — see the scope note at the top of the current plan.

---

## 9. Working agreements with Tarik

- He wants **plain English**, short sentences, one idea per sentence. When a decision is needed: two options, the context to choose fast, and a recommendation.
- **Decision log entries are a portfolio deliverable**, not paperwork — written so a smart non-engineer can follow them, jargon defined inline on first use. Claude drafts the decision; **the "What actually happened" section is left blank for Tarik to fill in his own voice.** That split is what makes them credible.
- Read primary sources before building. A summary of a source is not the source.
- Never weaken an evidence, locality, independence, coverage, or citation rule to make the feed look fuller.
