# SignalGap — session handoff

**Last updated:** 2026-08-29, 14:26 CDT.
**Purpose:** everything a fresh Claude session needs to pick this up. Read this, then `docs/hackathon-build/spec.md`.

---

## 0. START HERE

```bash
cd /Users/tarikmoody/Projects/SignalGap
git log --oneline -5
git status --short          # ANYTHING UNCOMMITTED IS A TASK THAT STALLED MID-FLIGHT
npm run check               # expect 543 passed / 2 skipped
```

**There is work in flight right now.** A subagent was preserving the live scan as the saved demo (checklist item 10's remaining half) and the session ended mid-task. Expect uncommitted `convex/demoScan.ts` (new) and a modified `convex/testing.ts`. Its brief and progress are in `.superpowers/sdd/2026-08-25-signalgap-ai-batching/saved-demo-report.md`. **Read that first, decide whether to finish it or start it clean, and do not assume it is correct — it was never reviewed.**

**Nothing is blocked on Tarik.** The next decision he owes is nothing; the next work is below.

---

## 1. What SignalGap is

An editorial lead-discovery workspace for small Milwaukee newsrooms. It searches the public web through SerpApi, uses AI to connect and explain related signals, applies **deterministic rules** to decide what qualifies, and hands a human editor a source-linked reporting brief.

**Hackathon target: SerpApi — "Best AI Use Case."** (`docs/hackathon-build/prd.md:4`)

The central claim every decision defends: **SerpApi gives it live eyes. AI connects and interprets. Transparent rules and a journalist decide what is credible.** AI may never set eligibility, a score, or the `Coverage gap` label.

**The pitch is now stronger than "we used AI":** we measured what the AI was deciding and moved most of it into rules. The model went from sorting 294 results to answering 89 yes/no questions. Faster, cheaper, testable — and graded 100% precision against Tarik's own labels.

---

## 2. Where the work lives

| Thing | Where |
| --- | --- |
| Repo (public) | https://github.com/tmoody1973/signalgap |
| Linear | MOO-727…738, one per checklist item |
| Spec / PRD / checklist | `docs/hackathon-build/` |
| Decisions | `docs/decisions/` (001–010) |
| Learning log | `docs/LEARNING-LOG.md` |
| Plans | `docs/superpowers/plans/` |
| **Research that cost money** | **`docs/research/2026-08-25-evidence-pipeline/`** — measurements, Claude API findings, clustering design. Every number in the repair plan traces here. |
| Agent reports | `.superpowers/sdd/2026-08-25-signalgap-ai-batching/` — **gitignored, laptop-only** |
| Convex dev | `dev:handsome-lapwing-832` |

---

## 3. Status

| Item | State |
| --- | --- |
| 1–8 | **Done** |
| 9 | **Part A (ranked feed) done.** Parts B (editorial controls) and C (histories/comparison) not started. Box deliberately unticked. |
| **10** | **Live scan succeeded. Saved-demo half in flight.** See §4. |
| 11 | Harden, evaluate, deploy — **not started** |
| 12 | Devpost handoff — **not started** |

**543 unit/integration tests, 40 Playwright. `main` is 2 commits ahead of origin — push early.**

### The evidence pipeline repair is complete

`docs/superpowers/plans/2026-08-25-signalgap-ai-batching.md`. Nine tasks plus 4b, each independently reviewed. It fixed three defects that made the first live scan produce **zero leads**:

1. All 294 sources went to one model call — needed 27–38 minutes against a 120s limit. Now streamed, `effort: "low"`, batches of **10** at concurrency 4. Half the time, half the cost.
2. The AI's extracted entities and claims were **thrown away**; clustering received empty strings. Now persisted on `sourceResults.analysis`.
3. Every cluster collapsed into **one candidate** — the fingerprint was a constant. Would have produced one confident, fabricated mega-lead. Fixed and proven both ways.

Clustering is now deterministic (`convex/editorial/blocking.ts`) with AI only in the ambiguous band (`adjudicatePairs`). Decision 009.

---

## 4. The crown jewel — and its risk

**Scan `k17d48736cyxjgzq8yz16w11yx8d60a3` (2026-08-26)** is the first successful end-to-end run.

- 28 of 120 searches, 285 sources, 236 leads, **1 qualified**
- Candidate `jh78d9y7g1drwen8gvxvggbjfs8d7bg2` — *"What specific projects will the $13.9 million federal grant fund for MCTS's bus fleet and county trunk highways, and on what timeline?"*
- `Coverage gap`, transportation, **70/100**, two independent source categories, coverage complete, seven interview questions, every citation resolving
- 493 model calls, 486 succeeded

**The 7 rejected calls are the product working, not failing** — three paraphrased a quotation instead of copying it, two quoted under 20 characters, one cited a source id that does not exist, one slipped a search operator into a snippet. Each refused rather than published. **That is the demo moment.**

**⚠️ This scan exists only in the dev Convex deployment on this laptop.** Preserving it is exactly the in-flight task. Until that lands, the best evidence in the project is one `npx convex import --replace` away from gone.

### A live scan is NOT currently a reliable demo path

**Task 8b** in the repair plan. The second scan (2026-08-27, four beats, 368 sources) **stalled at ~280 candidates and was cancelled.** `runEvidenceStage` makes one `classifyEvidence` call per candidate, serially, in one Convex action, and ran out of wall clock. A model-run row sat in `running` for 24 minutes against a 6-minute hard ceiling — the action was killed without unwinding.

**The action time limit (~30 min) is from research and has never been verified first-hand.** Do not quote it as fact.

**Fallback if the clock gets tight:** dropping back to three beats would likely make scans finish again — scan 1 completed at 236 candidates. That is a real option, not a defeat.

---

## 5. What to do next, in order

1. **Finish or restart the saved-demo work** (§0). Mark the scan `isSavedDemo` with an honest `captureTimestamp`, export a committed fixture with an idempotent import, and add the manual `Open saved demo scan` action with the `Saved copy` label. This de-risks everything else.
2. **Task 8b** — verify the real action limit, then bound the evidence stage. Also: a killed action leaves a `modelRuns` row reading `running` forever, and `reopen` refuses `in_flight`, so that unit of work is permanently unrepeatable.
3. **Item 11** — harden, secret scan, deploy prod Convex + Vercel, run the journey against the deployed URL.
4. **Item 12** — README, four screenshots, 2–4 minute demo video, Devpost story.

---

## 6. Rulings a new session must honor

### Product
- **Labels are newsroom language, not spec-speak.** Decision 003.
- **The two-independent-category gate stays.** Decision 007. It fired exactly once in 236 leads on real data — that is a strict rule working, not a bug. One news day is not a sample.
- **Never weaken a locality, independence, coverage, evidence or citation rule to make the pipeline run.** A scan that finishes by seeing less is worse than one that fails loudly.
- **Never introduce a fabricated result to improve a demo.** It has been caught happening once.
- **Four beats now** — housing, transportation, culture, **sports** (decision 010). Each beat costs **4** discovery searches, not 3. The fixed opening set is **17**; `discovery` allocation was raised 16→20 out of `reserve` 34→30, hard cap unmoved at 120.

### Correctness
- **`convex/candidates/evaluate.ts` is the ONLY writer** of `status`, `primaryLabel`, `scoreTotal`, `scoreComponents`, `independentCategoryCount`, `coverageOriginalCount`, `coveragePassStatus`, `exclusionReasons`. Defended eleven times.
- **`runAiOperation` owns the retry loop, the schema-invalid rule and the ledger.** New model work goes *through* it.
- **Ledger honesty.** One `modelRuns` row per call. A partial failure is reported as partial.
- **`candidateFingerprint` takes entity keys only** — the beat was removed (task 4b) because a correctable field welded into an immutable identity breaks continuity the moment it is corrected.
- **`candidates.beat` is `v.optional(V.vBeat)`.** Formation writes no beat; `saveJudgment` is a **total mirror** — a judgment naming no beat clears the column.
- **`clusterIdentityKeys` throws** when a cluster has no sources. Deliberate: loud beats a fabricated mega-lead.
- **Thresholds are pinned by Tarik's labels.** `docs/evaluation/clustering-pair-labels.md` — 107 pairs he labeled by hand. Precision floor **1.00**, recall **0.90**. A single wrong merge fails the build and names the pair. **Do not tune a threshold without re-reading that file.**

### Evidence honesty
- **The in-process budget tests prove arithmetic, not concurrency.** The concurrency proof is `tests/live/reserve-concurrency.test.ts`.
- **Fixtures must not rot.** `seedSliceFixture`'s `now` is anchored to `Date.UTC(2026, 7, 20)`. Never "modernise" it.
- **`convex-test` cannot execute the Convex Workflow component.** Only a live scan proves it replays.
- **Two `KNOWN MISS` tests** in `blocking.test.ts` pin what deterministic clustering cannot reach. Do not delete or weaken them.

---

## 7. Operational gotchas that cost real time

- **Port 3000 is a different project** on this machine ("Paper Majority"). Run SignalGap on **3100** and pass `PLAYWRIGHT_BASE_URL=http://localhost:3100`.
- **Do not run scan work through `playwright.config.ts`** — its `globalSetup` calls `deleteScansForClerkUser` and will destroy the live scan.
- **Clerk sign-in: use the email strategy, not password.** `clerk.signIn({ page, emailAddress })`. The password path hits a `needs_client_trust` device gate. See `tests/e2e/helpers/auth.ts`.
- **`Run new scan` now lives in the scan-progress panel.** It used to render only in the empty state, so it vanished the moment a lead qualified.
- **Spurious typecheck failure** from stale `.next/dev/types/` reproduces on clean `main`. `rm -rf .next/dev/types` clears it.
- Convex CLI needs env sourced: `set -a; . ./.env.local; set +a`. `npx convex codegen` does **not** deploy — also `npx convex dev --once`.
- **`.superpowers/` is gitignored.** Agent reports do not commit. Anything worth keeping goes in `docs/`.
- **Playwright browsers were wiped** by a disk cleanup on 2026-08-26. `npx playwright install chromium` if a launch fails.
- **SerpApi: 931 searches left** this month. A four-beat scan reserves 17.

---

## 8. The process that works

`superpowers:subagent-driven-development`. Per task: a fresh implementer works from a written brief; an independent reviewer runs against the diff; findings go into a fix loop; each round ends with a scoped re-review; the task ends with a commit.

**It has earned its cost repeatedly.** In this repair it caught: a batch size of 25 that would have breached the timeout; streaming code from the research that would have **hung on every successful call**; a scoring channel that was invisible to all 19 of its tests and flipped a must-not-merge pair in production; a model answering about half its inputs and being recorded as a success; and a retry that silently produced a different candidate set.

### Rules that came from real failures
- **Reviewers and implementers must write a report to a file AND reply.** Agents go idle mid-task and lose everything otherwise.
- **A report is a claim, not evidence.** Verify claims against code. One report asserted an import that did not exist.
- **"I could not do this" is always an acceptable answer.** Say it in every brief.
- **Never let an implementer run `/simplify`.** One did and it edited a shared module outside its task.
- **Never `git add -A`** while subagents are in flight. Stage explicitly.
- **Watch a fix's measurement reach.** A pagination fix was "proven" with 27 leads; the defect only appears on the second click, which needs 50+.

---

## 9. Working agreements with Tarik

- **Plain English**, short sentences, one idea per sentence. Technical terms defined inline on first use.
- When a decision is needed: **two options max**, the honest cost of each, and a recommendation first.
- **Say what you did NOT check.** Every time. Which part is verified and which is inference.
- **Flag anything hard to undo before touching it** — production data, deploys, spending money, deleting.
- **Decision log entries are a portfolio deliverable.** Claude drafts the decision; **"What actually happened" is left blank for Tarik**, in his voice. That split is what makes them credible.
- Read primary sources before building. A summary of a source is not the source.
