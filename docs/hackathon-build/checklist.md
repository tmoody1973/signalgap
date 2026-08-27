# SignalGap Build Checklist

**Status:** Draft for participant gut-check

**Project:** SignalGap

**Hackathon target:** SerpApi — Best AI Use Case

**Primary demo market:** Milwaukee

**Planning allocation:** 80 hours

**Primary development agent:** Claude Code

**Repository:** Create a new public GitHub repository named `signalgap`

## Build Preferences

- **Plan design:** Handed off to the build strategist
- **Build mode:** Autonomous; locks when implementation begins
- **Comprehension checks:** N/A during routine implementation
- **Package manager:** npm with one committed lockfile
- **Git:** Commit after every checklist item; never combine a failing state with the next item; tag the three accepted review points as `checkpoint/design-foundation`, `checkpoint/evidence-vertical-slice`, and `checkpoint/live-scan`
- **Verification:** Automated checks after every item plus three participant look-at-it pauses
- **Check-in cadence:** Speed-run between fixed review pauses; report immediately on permissions, missing credentials, licensing uncertainty, paid-call budget risk, or a verification failure that cannot be resolved safely
- **Secrets:** Never commit `.env*`; maintain `.env.example` with names only
- **Paid API tests:** Captured fixtures by default; live SerpApi and model smoke tests are explicit and bounded
- **Submission centerpiece:** `Why this surfaced`, showing how distinct public signals converged before the reporting brief

## Execution Rules

1. Read `docs/hackathon-build/prd.md` and `docs/hackathon-build/spec.md` before implementation.
2. Execute items in order. A later item may not begin until the current item's verification passes and its commit exists.
3. Use test-first loops for deterministic rules, adapters, schemas, AI validators, and workflow transitions.
4. Treat every milestone below as a collection of 15–30 minute implementation loops ending in one independently reviewable result.
5. Stop at the three marked participant review pauses. Resume only after Tarik accepts the visible result or requests changes.
6. Do not add shadcn/ui, a second component system, a vector database, direct Reddit comment ingestion, sentiment analysis, or autonomous publishing.
7. Do not place Untitled UI PRO source or assets in the public repository. Every copied MIT component must be recorded in `THIRD_PARTY_NOTICES.md`.
8. Never weaken evidence, locality, independence, coverage, or citation rules to populate the feed.

## Review Pauses

| Pause | After item | Participant inspects | Resume condition |
| --- | ---: | --- | --- |
| 1. Editorial foundation | 2 | Public page, authenticated shell, typography, compact density, labels, keyboard focus, light and dark themes | Visual direction and basic interaction accepted |
| 2. Evidence vertical slice | 7 | One fixture lead from `Why this surfaced` through citations, score, coverage and generated brief | Source traceability and uncertainty presentation accepted |
| 3. Live Milwaukee scan | 10 | Real SerpApi scan, query log, partial-state behavior and explicit saved fallback | Live workflow is credible and demo-ready |

## Checklist

- [ ] **1. Bootstrap the public repository and verified application foundation — 6 hours**
  Spec ref: `spec.md > Stack`, `spec.md > File Structure`, and `spec.md > External APIs And Dependencies`
  What to build: Create the `signalgap` Next.js App Router TypeScript project; initialize Git; create the public GitHub repository; install Tailwind CSS, Clerk, Convex, Convex Workflow, Vercel AI SDK providers, Zod, React Aria, next-themes, Vitest and Playwright; create the documented folder structure, `CLAUDE.md`, `.env.example`, `THIRD_PARTY_NOTICES.md`, baseline CI, and npm scripts `lint`, `typecheck`, `test`, `test:e2e`, `test:live`, `build`, and `check`. Configure one smoke test and one rendered-page browser test so an empty suite cannot pass accidentally.
  Acceptance: The repository is public without secrets; the app starts and builds; linting, type checking, unit tests and the baseline Playwright test pass; environment names match the specification; the README identifies SignalGap as editorial lead discovery rather than autonomous journalism. Covers PRD Stories 1.1 and 9.3 foundation requirements.
  Verify: Run `npm run check && npm run test:e2e && npm run build`; run `git status --short` and confirm only intended files are committed; run `gh repo view signalgap --json name,visibility,url` and confirm `visibility` is `PUBLIC`.

- [ ] **2. Establish the licensed editorial design system and application shell — 6 hours — REVIEW PAUSE 1**
  Spec ref: `spec.md > UI Component And Design-System Policy` and `spec.md > Components And Responsibilities > Next.js Editorial Workspace`
  What to build: Implement Newsreader/Inter typography, warm-white/charcoal/amber semantic tokens, small radii, thin rules, restrained shadows and next-themes dark mode. Manually add only the MIT Untitled UI primitives needed for buttons, badges, alerts, progress, filters, navigation, tables, tabs, dropdowns and modals; record each origin and modification. Build the public orientation page, Clerk-aware application shell, first-run workspace, navigation, label legend and responsive layout without copying a stock dashboard.
  Acceptance: The first-run view names Milwaukee, the three beats, the evidence boundary and `Run first scan`; approved labels include visible text rather than color alone; focus is visible; light and dark themes meet the PRD's warm-white/charcoal direction; narrow and desktop layouts do not horizontally overflow; every imported component is documented and MIT-eligible. Covers PRD Stories 1.1, 1.2 and 9.3.
  Verify: Run `npm run test:e2e -- tests/e2e/design-system.spec.ts tests/e2e/first-run.spec.ts`; run `rg -n "shadcn|@radix-ui|Untitled UI PRO" src package.json package-lock.json THIRD_PARTY_NOTICES.md` and confirm no prohibited dependency or PRO source; manually inspect the public page and signed-in shell at desktop and mobile widths in both themes, then stop for participant approval.

- [ ] **3. Implement Clerk–Convex authorization and the validated persistence model — 8 hours**
  Spec ref: `spec.md > Data Model`, `spec.md > Clerk Authentication Boundary`, `spec.md > Convex Data Layer`, and `spec.md > Security And Privacy`
  What to build: Configure Clerk JWT identity for Convex; implement `users`, `scans`, `searchRuns`, `sourceResults`, `candidates`, `candidateAppearances`, `candidateSources`, `evidenceItems`, `briefVersions`, `editorEvents`, and `modelRuns` with the specified fields and indexes. Add shared validators, `users.ensureCurrent`, owner-scoped public queries/mutations, internal-only processing functions, bounded pagination, and fixture factories. Keep raw SerpApi JSON in Convex File Storage rather than large documents.
  Acceptance: A signed-in user can create and read only owned records; another fixture user receives no cross-tenant data; every public function verifies identity and ownership; every function validates arguments and returns; editor and evidence history are append-only; raw blobs are not exposed to browsers. Covers PRD Stories 1.2, 4.3, 6.3, 7.4, 8.1 and resilience requirements in Epic 9.
  Verify: Run `npx convex codegen && npm run typecheck`; run `npm test -- tests/integration/auth-ownership.test.ts tests/integration/schema-validation.test.ts tests/integration/raw-storage-boundary.test.ts` and confirm all unauthorized-access cases fail closed.

- [ ] **4. Build the deterministic editorial rules engine test-first — 8 hours**
  Spec ref: `spec.md > Editorial Rules And Scoring` and `spec.md > Components And Responsibilities > Deterministic Editorial Engine`
  What to build: Implement versioned locality, seven-day recency, two-independent-category, accessibility, beat relevance, duplication, press-release lineage, equitable coverage completion, coverage-count, label-promotion and 100-point score functions. Return structured exclusion and score-band reasons. Encode the constraints that Reddit, social posts, Trends and Maps cannot independently confirm facts and that failed coverage blocks `Coverage gap`.
  Acceptance: Only fully eligible candidates receive scores; all five score components equal the total; 0/1/2/3 coverage reports produce the fixed scarcity bands; one primary source alone fails the stricter two-category gate; duplicate releases count once; conflicts stay outside confirmed facts; editor corrections trigger deterministic recalculation without changing dispositions. Covers PRD Stories 3.1, 3.4, 4.2, 4.4, 5.1–5.4 and 9.2.
  Verify: Run `npm test -- tests/unit/editorial`; confirm boundary fixtures cover Reddit-only, failed coverage, duplicate release, conflicting claims, inaccessible citation, weak locality, pure promotion, and all score bands; run `npm run typecheck`.

- [ ] **5. Implement the SerpApi adapter and one complete search-storage slice — 10 hours**
  Spec ref: `spec.md > SerpApi Integration`, `spec.md > Data Flow > Critical scan lifecycle`, and `spec.md > Risks And Verification > Testing strategy`
  What to build: Implement the approved `SearchSpec`, deterministic search-intent validator, 60-second SerpApi client, two-retry jittered policy, atomic budget reservation, idempotency key, raw-response archive, and engine-normalized `SourceResultInput`. Start with `reddit-housing-01`, then add fixture normalizers for Google Search, News, Trends Trending Now, Events, YouTube and Maps. Canonicalize URLs and extract Reddit post IDs. Make every search's safe query, engine, purpose, status, attempts, duration and result count inspectable.
  Acceptance: The fixture request reserves budget once, archives raw JSON, ingests normalized results without duplicates, and exposes safe metadata; retrying does not create a second run or result; unknown engines/domains/time windows are rejected; the 121st reservation cannot occur; indexed Reddit results are filtered to Milwaukee comment URLs and marked unverified. Covers PRD Stories 2.4, 4.3, 9.1 and 9.2.
  Verify: Run `npm test -- tests/unit/serpapi tests/integration/search-storage-slice.test.ts`; inspect the fixture `searchRuns` and `sourceResults` records; run the opt-in command `LIVE_TESTS=1 npm run test:live -- --testNamePattern="single bounded SerpApi search"` only when a development API key is configured and confirm exactly one reservation.

- [ ] **6. Implement source-bound AI contracts and the model evaluation harness — 10 hours**
  Spec ref: `spec.md > AI Usage` and `spec.md > Components And Responsibilities > AI Analysis Layer`
  What to build: Implement the Vercel AI SDK provider boundary for Claude Sonnet 5 with logged GPT-5.6 Terra fallback; create strict Zod contracts and versioned prompts for `analyzeResults`, `clusterSignals`, `classifyEvidence`, `planFollowUp`, and `generateBrief`. Validate opaque source IDs, exact excerpts, enums and lengths before persistence. Preserve Spanish original text beside translation, conflicts, prompt/schema/model provenance, token use and fallback reason. Create 15–20 captured Milwaukee evaluation packets with expected source/citation annotations.
  Acceptance: Unknown source IDs, invented excerpts and unsupported confirmed facts invalidate the entire output; one schema-invalid Sonnet response retries once before optional fallback; models return search intents rather than executable parameters; model output cannot promote eligibility, score or coverage labels; Spanish translation never replaces original content. Covers PRD Stories 4.1–4.5, 6.1–6.3 and the AI proof points.
  Verify: Run `npm test -- tests/unit/ai tests/integration/model-fallback.test.ts tests/integration/bilingual-evidence.test.ts`; run the fixture evaluation command and confirm it reports claim-source validity, citation completeness, conflict preservation, duplicate detection, Spanish preservation, clustering, brief usefulness, invalid-output rate, latency and cost for each configured model.

- [ ] **7. Deliver one source-traceable evidence-to-brief vertical slice — 8 hours — REVIEW PAUSE 2**
  Spec ref: `spec.md > UI Behavior > Expanded evidence view`, `spec.md > AI Usage > generateBrief`, and `spec.md > Custom SignalGap editorial components`
  What to build: Using a captured candidate packet, connect normalized source results to candidate membership, a versioned evidence snapshot, deterministic eligibility and score, and a validated brief. Implement custom `LeadCard`, `WhyThisSurfaced`, `EvidenceItem`, `CitationTrace`, `CoverageAudit`, `ScoreBreakdown` and `ReportingBrief` components. Show confirmed, unverified, conflicting, reverification, coverage, potential-source and interview-question sections with original links and query provenance.
  Acceptance: `Why this surfaced` begins the evidence view and shows at least two categories; every confirmed fact and coverage report opens its stored source evidence; unverified Reddit remains labeled and nonconfirming; conflicting material cannot enter confirmed facts; the score shows all five components; the brief contains every approved section, identifies itself as AI assistance, and invents no filler for unsupported sections. Covers PRD Stories 3.1, 4.1–4.6, 5.1 and 6.1.
  Verify: Run `npm test -- tests/integration/evidence-brief-vertical-slice.test.ts`; run `npm run test:e2e -- tests/e2e/evidence-vertical-slice.spec.ts`; manually trace one brief fact backward through evidence, excerpt, source URL and search query, inspect both themes and keyboard order, then stop for participant approval.

- [x] **8. Complete the durable scan workflow and fixed search catalog — 8 hours**
  Spec ref: `spec.md > Data Flow`, `spec.md > SerpApi Integration > Fixed discovery catalog`, and `spec.md > Convex Workflow Orchestration`
  What to build: Register the Convex Workflow component and implement the 14-step lifecycle from authenticated scan creation through finalization. Add the 13 frozen discovery templates (Google Events moved to enrichment — decision 005), two-part equitable coverage searches, up to 20 corroboration calls, conditional enrichment, the 34-call reserve and hard 120-call ceiling. Persist four public stages, candidate-level completion, cancellation checks before external boundaries, partial failures and final usage totals. Reserve coverage before optional Maps or YouTube work.
  Acceptance: Only one live scan runs per owner; progress shows all four approved stages; completed candidate cards may appear while the feed remains incomplete; cancellation preserves completed work and stops new reservations; retries reuse completed steps; coverage failure blocks the gap label; a scan ends completed, partial or canceled with named reasons and accurate counts. Covers PRD Stories 2.1–2.4, 3.4, 8.1 and 9.1.
  Verify: Run `npm test -- tests/integration/scan-workflow.test.ts tests/integration/search-budget-concurrency.test.ts tests/integration/cancellation.test.ts tests/integration/partial-coverage.test.ts`; run `npm run test:e2e -- tests/e2e/scan-progress.spec.ts`; confirm fixture execution produces 13 fixed search runs (Google Events moved to enrichment — decision 005) and never exceeds 120 reservations under forced concurrency.

- [ ] **9. Complete the ranked feed, editorial controls, histories and comparison — 6 hours**
  Spec ref: `spec.md > UI Behavior`, `spec.md > Public And Internal Function Contracts`, and `spec.md > Audit And Snapshot Layer`
  What to build: Implement the top-25 ranked feed, load-next-25 pagination, URL-backed filters, counts, exclusions review and scroll restoration. Add correction previews and recalculation, immutable brief regeneration, separate editor notes, Reject/Monitor/Assign workflows with reporter/note fields, chronological lead history, scan history, and stable-fingerprint comparison for New, Changed, Persistent and Disappeared leads.
  Acceptance: Only eligible leads appear by default; filters and position survive evidence navigation; exclusions show reasons and can re-enter after correction; dispositions never alter scores; correction can produce `No longer qualifies` and `Outdated`; prior brief versions remain read-only; canceled scans cannot be compared; disposition-only changes do not count as evidence changes. Covers PRD Stories 3.1–3.4, 5.2–5.4, 6.2–6.3, 7.1–7.4 and 8.1–8.2.
  Verify: Run `npm test -- tests/integration/editorial-history.test.ts tests/integration/scan-comparison.test.ts`; run `npm run test:e2e -- tests/e2e/feed-controls.spec.ts tests/e2e/editorial-decisions.spec.ts tests/e2e/scan-comparison.spec.ts`; confirm a full correction–recalculation–regeneration–assignment journey persists after reload.

  **Progress, 2026-08-25 — part A of three is done; the box stays unticked because two thirds of this item are not built.**
  This item bundles three subsystems. It was split into three plans (Tarik's call, 2026-08-24) because the feed is the missing front door: until it exists nothing links the workspace to a lead.
  - **Part A — the ranked feed: DONE.** `docs/superpowers/plans/2026-08-24-signalgap-ranked-feed.md`, 8 tasks, each independently reviewed. Delivers the two views (ranked and did-not-qualify), URL-backed beat/label/disposition filters, load-next-25 pagination, all three counts always visible including zeroes, exclusion reasons on every excluded lead, and empty states that point at what was ruled out and never offer to lower a bar. 443 unit/integration tests, 40 Playwright tests.
  - **Part B — editorial controls: NOT STARTED.** Reject/Monitor/Assign, editor notes, corrections and recalculation, immutable brief regeneration. `Outdated` still has no schema home and belongs here — it is brief-scoped, so it must not enter `vProductLabel`.
  - **Part C — histories and comparison: NOT STARTED.** Lead history, scan history, stable-fingerprint comparison of New/Changed/Persistent/Disappeared.
  - **Scroll restoration** remains deferred; it needed the feed to exist before it could be judged.
  - **Known and honest:** at most ten leads per scan can qualify, because coverage affords two searches each out of twenty. The did-not-qualify list is where most of a scan lives. First thing to check against the live scan in item 10.

- [ ] **10. Run and preserve the first live Milwaukee scan — 5 hours — REVIEW PAUSE 3**

  **Progress, 2026-08-26 — the first live scan ran end to end and produced a qualifying lead. Box stays unticked: the saved-demo fallback and the export path are not built.**
  The 2026-08-25 attempt returned 294 real results and produced **zero** leads — three defects, repaired across `docs/superpowers/plans/2026-08-25-signalgap-ai-batching.md` (decision 009, and `docs/research/2026-08-25-evidence-pipeline/` for the measurements).
  - **Scan `k17d48736cyxjgzq8yz16w11yx8d60a3`, 2026-08-26.** 28 of 120 searches used (9 failed, all named). 285 real sources, 236 leads formed, **1 qualified**: a $13.9M MCTS federal grant story, labeled `Coverage gap`, transportation, score 70/100, two independent source categories, coverage check complete, seven interview questions, every citation resolving. 493 model calls, 486 succeeded.
  - **The seven rejected model calls are the product working**, not failing: three paraphrased a quotation instead of copying it, two quoted under 20 characters, one cited a source id that does not exist, one slipped a search operator into a snippet. Each was refused rather than published.
  - **Still owed by this item:** the `Open saved demo scan` fallback with the `Saved copy` label and capture timestamp; the timestamped fixture export through the idempotent import path; and a full manual demo journey.
  - **Honest caveat:** one qualifying lead out of 236 is one news day. Whether that is the two-independent-category gate holding the line or being too strict needs more scans, not more argument.
  Spec ref: `spec.md > Deployment`, `spec.md > Demo And Submission Flow`, and `spec.md > Risks And Verification > Acceptance gates before demo`
  What to build: Configure development credentials, execute one bounded live Milwaukee scan across the approved English, Spanish, official-domain, indexed-Reddit, News, Trends and Events routes, then run conditional coverage/corroboration/enrichment for promising candidates. Review source accessibility and classifications, make necessary editor corrections, preserve the completed scan, and export one real timestamped fallback fixture through the idempotent import path. Implement the explicit dependency-failure action `Open saved demo scan` with `Saved copy` and capture timestamp.
  Acceptance: At least one real candidate can be traced from live discovery to evidence, equitable coverage, score, brief and disposition; all confirmed claims have working citations; Reddit remains unverified; search use stays at or below 120; failures are named; fallback selection is manual and unmistakably saved; no fabricated result is introduced to improve the demo. Covers PRD P0 requirements, Stories 8.1, 9.1–9.2 and the hackathon success measures.
  Verify: Run `LIVE_TESTS=1 npm run test:live -- --testNamePattern="Milwaukee scan"`; inspect the persisted query log, raw archive IDs, model runs, source links, coverage groups and budget totals; run `npm run test:e2e -- tests/e2e/saved-demo-fallback.spec.ts`; manually perform the full live demo journey, then stop for participant approval.

- [ ] **11. Harden, evaluate and deploy the submission candidate — 3 hours**
  Spec ref: `spec.md > Risks And Verification`, `spec.md > Security And Privacy`, `spec.md > Deployment`, and `spec.md > Requirements Traceability`
  What to build: Close gaps found at the three pauses; run the 15–20-packet Sonnet/Terra comparison; verify secret redaction, authorization, accessibility, responsive behavior, partial/empty/canceled/conflicting/outdated states and component licensing. Deploy separate production Convex and Vercel targets, configure Clerk redirects, import the saved fixture, and run the primary journey against the deployed URL. Record known limitations and the final model choice in the README.
  Acceptance: Unit, integration and Playwright suites pass; the production build succeeds; no secret or PRO source is committed; every PRD epic has a passing test or named manual proof; deployed live and saved journeys work; three of the top five evaluated leads are marked worth follow-up or the shortfall is transparently documented before submission. Covers all Epic 9 criteria and the PRD success measures.
  Verify: Run `npm run check && npm run test:e2e && npm run build`; run a secret scan and `rg -n "Untitled UI PRO|api_key=|sk-ant-|sk-proj-" . --glob '!node_modules/**' --glob '!.git/**'`; deploy with `npx vercel deploy --prod`; set `PLAYWRIGHT_BASE_URL` to the deployed URL and rerun the primary Playwright journey; review `THIRD_PARTY_NOTICES.md` against every file in `src/components/ui/untitled/`.

- [ ] **12. Prepare the Devpost handoff — 2 hours**
  Spec ref: `prd.md > Submission Proof Points` and `spec.md > Demo And Submission Flow`
  What to build: Finalize the public repository README, architecture and AI/SerpApi explanation, local setup, environment names, test commands, deployed URL, known limitations and license notices. Capture four submission images—live scan progress/query log, ranked feed, `Why this surfaced` evidence view, and reporting brief/citation/disposition—and record a two-to-four-minute demo centered on the real Milwaukee lead. Assemble the project name, one-line pitch, build story, runtime AI use, Claude Code role, approximate hours, SerpApi indispensability, equitable-coverage safeguard, source traceability, and saved-demo disclosure for `$prepare-submission`.
  Acceptance: A reviewer can open the repository and deployed app, understand what was built, reproduce the supported setup, see how SerpApi and AI differ, trace the demo's confirmed fact to a source, and understand the limitations. The participant has the story, screenshots, repo link, demo link/instructions and learning documents needed for submission preparation.
  Verify: Review the four images at submission size; rehearse the demo within four minutes; click every README, deployed-app and evidence link; run `gh repo view signalgap --json url,visibility,description,homepageUrl`; confirm the next guided command is `$prepare-submission` after the build is complete.

## Gut-Check Questions

Before this checklist is locked for `$build-project`, confirm:

1. Does this sequencing feel appropriate for the available 80 hours?
2. Are the three participant pauses placed at the right moments?
3. Is `Why this surfaced` still the right submission centerpiece after seeing its implementation dependencies?
4. Is there any checklist item you want reduced, postponed or moved earlier?
