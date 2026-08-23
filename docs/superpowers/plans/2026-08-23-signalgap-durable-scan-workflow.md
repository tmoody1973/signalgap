# SignalGap Durable Scan Workflow Implementation Plan (Checklist item 8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `scans.startScan` from a row insert into a real, resumable scan — a Convex Workflow that runs the spec's 14 lifecycle steps, spends the 13 fixed discovery searches, checks equitable coverage for the candidates worth checking, reports four public stages while it works, survives a server restart, stops cleanly when cancelled, and always ends in an honest terminal state with counts that add up.

**Architecture:** Three layers, and the boundary between them is the point. `convex/scanWorkflow.ts` is the **only** durable orchestrator — it holds no business logic, it calls steps. Each stage is a plain exported async function plus a one-line `internalAction` wrapper in its own module (`convex/stages/`), which is how the existing code lets tests inject a fake model and a fake `fetch`. Every state transition — stage, failure, counts, terminal status — goes through owner-scoped `internalMutation`s in `convex/scans.ts`, so the scan document can never drift from what actually happened.

**Tech Stack:** `@convex-dev/workflow` 0.4.6 (already installed and registered in `convex/convex.config.ts`), Convex 1.45, Vitest 4 (`unit` = node, `integration` = edge-runtime, `live` = node/opt-in), Playwright, React 19 / Next.js App Router.

**Spec:** `docs/hackathon-build/spec.md` (authority) — sections `Data Flow`, `SerpApi Integration`, `Convex Workflow Orchestration`, `Public And Internal Function Contracts`, `UI Behavior > Workspace and live scan`. With `prd.md` and `checklist.md` item 8.

**Linear:** MOO-734.

**Predecessors:** items 5, 6 and 7 are closed. This plan consumes their real interfaces, not predicted ones — **every signature below was read out of committed code on 2026-08-23 at `c18890d`.**

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec and from committed code.

### The product claim this defends

- SerpApi gives it live eyes. AI connects and interprets. **Transparent rules and a journalist decide what is credible.**
- AI may never set eligibility, a score, or the `Coverage gap` label. Nothing in this plan may add a path that lets it.
- **Never weaken a locality, independence, coverage, evidence or citation rule to make the feed look fuller.** A thin scan is an honest scan.
- **Never introduce a fabricated result to improve a demo.** Fixtures that reach a screen a human reviews are demo material.

### The number is 13, not 16

`DISCOVERY_TEMPLATE_IDS` in `convex/integrations/serpapi/queryCatalog.ts` holds exactly **13** ids. Decision 005 moved the three Google Events templates to `ENRICHMENT_TEMPLATE_IDS` because SerpApi's `google_events` engine returned zero results for every query tried, including its own documented example.

`SEARCH_BUDGET.discovery` stays at **16**. It is a *ceiling*, not a target — the spec's budget table allocates 16 and we spend 13. Do not "fix" the 16 to match the 13; the reservation tests are written against the ceiling.

```ts
// convex/config/searchBudget.ts — committed, do not change
export const SEARCH_BUDGET = {
  discovery: 16, coverage: 20, corroboration: 20,
  enrichment: 30, reserve: 34, hardCap: 120,
} as const;
```

### Budget rules — binding

- **No code path may call SerpApi without a successful `searchRuns.reserve`.** `runExecuteSearch` already reserves first; never bypass it.
- `searchesReserved` means **authorized paid attempts** and never exceeds 120. Re-opening a failed run counts as a new authorized attempt: it increments `searchesReserved` and is refused at the cap.
- `searchesFailed` is a **cumulative count of failed attempts**, not a live gauge. A retry never decrements it. Decrementing makes `succeeded + failed + in-flight == reserved` impossible to hold, because a retry reuses the same row.
- **Required coverage capacity is reserved before optional Maps or YouTube enrichment.** This is a spec ordering requirement, not a preference. Coverage runs as its own stage, before enrichment, always.
- The cap under concurrency is already proven by `tests/live/reserve-concurrency.test.ts` (20 separate `npx convex run` processes; granted=5, rejected=15, reserved=120). `convex-test` takes a mutex per top-level transaction, so an in-process 20-way test proves nothing about production — do not claim it does.

### Existing interfaces — consume, do not modify

**Search execution** (`convex/integrations/serpapi/executeSearch.ts`)
```ts
export async function runExecuteSearch(
  ctx: ActionCtx,
  { scanId, spec }: { scanId: Id<"scans">; spec: SearchSpec },
  options?: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> },
): Promise<{ runId?: Id<"searchRuns">; status: "succeeded" | "failed" | "skipped"; resultCount: number }>
```
It reserves, marks running, calls SerpApi, archives raw JSON to File Storage, normalizes, ingests, and completes or fails the run. `status: "skipped"` means "budget exhausted, scan not active, or this exact search already succeeded" — it is **not** an error.

**Search spec + intent** (`convex/integrations/serpapi/contracts.ts`)
```ts
type SearchSpec = {
  templateId: string;
  engine: "google" | "google_news" | "google_trends_trending_now" | "google_events" | "youtube" | "google_maps";
  purpose: "discovery" | "corroboration" | "coverage" | "enrichment";
  query: string;
  location: "Milwaukee, Wisconsin, United States";  // MILWAUKEE_LOCATION
  language: "en" | "es";
  timeWindow: "7d" | "30d" | "current";
  candidateId?: string;
};
type SearchIntent = { templateId: string; purpose: SearchPurpose; reason: string; candidateId?: string; entityTerms?: string[] };
export const MILWAUKEE_LOCATION = "Milwaukee, Wisconsin, United States" as const;
export const idempotencyKeyFor = (scanId: string, spec: SearchSpec) => string;
```

**Query catalog** (`convex/integrations/serpapi/queryCatalog.ts`)
```ts
export type QueryTemplate = {
  id: string; engine: SerpEngine; language: SearchLanguage; timeWindow: TimeWindow;
  purposes: SearchPurpose[]; requiresTerms: boolean;
  maxWindowForPurpose: Partial<Record<SearchPurpose, TimeWindow>>;
  build: (args: { now: number; terms: string[] }) => string;
};
export const DISCOVERY_TEMPLATE_IDS: readonly string[];    // 13 ids
export const COVERAGE_TEMPLATE_IDS = ["coverage-general-01", "coverage-community-01"] as const;
export const SUPPLEMENTAL_TEMPLATE_IDS = ["corroborate-entity-01", "official-record-entity-01"] as const;
export const ENRICHMENT_TEMPLATE_IDS = ["events-housing-01", "events-transport-01", "events-culture-01"] as const;
export const getTemplate: (id: string) => QueryTemplate | undefined;
export const renderQuery: (t: QueryTemplate, args: { now: number; terms: string[] }) => string;
```

**Intent validator** (`convex/editorial/searchIntent.ts`)
```ts
export function validateSearchIntent(
  intent: SearchIntent,
  ctx: { now: number; remainingForPurpose: number },
): { ok: true; spec: SearchSpec } | { ok: false; reason: IntentRejection };
```
Entity terms from a model go through an **allowlist**, not a denylist. A denylist was demonstrably bypassable six ways.

**AI operations** (`convex/ai/`) — each is an exported plain async function plus a one-line `internalAction`:
```ts
runAnalyzeResults(ctx, { scanId, sourceResultIds }, generate?)
runClusterSignals(ctx, { scanId, signals }, generate?)
runClassifyEvidence(ctx, { scanId, candidateId, sourceResultIds }, generate?)
runPlanFollowUp(ctx, { scanId, candidateId, beat, gaps, priorTemplateIds, remainingBudget?, now? }, generate?)
runGenerateBrief(ctx, { scanId, candidateId }, generate?)
```
A repeat AI call with an identical idempotency key returns `{ ok: false, reason: "already_generated" }` and makes **no** model call. That is a success, not a failure.

**Rules engine** (`convex/editorial/`) — pure, already written, **do not modify**:
- `evaluateCandidate(input: CandidateInput): CandidateEvaluation` in `status.ts` is the only thing that produces `status`, `label`, `reasons`, `score`, `independence`, `coverage`.
- `coverageGapAllowed(s) === s.passStatus === "complete" && s.originalReportCount <= 2`. A failed coverage pass blocks `Coverage gap`, always.
- `evaluateEligibility` emits `coverage_pass_incomplete` when `passStatus !== "complete"`.

**The only writer of a verdict** — `convex/candidates/evaluate.ts` is the **only** writer of `status`, `primaryLabel`, `scoreTotal`, `scoreComponents`, `independentCategoryCount`, `coverageOriginalCount`, `coveragePassStatus`, `exclusionReasons`. **Do not add a second writer.**

**Coverage catalog** (`convex/config/coverageOutlets.ts`)
```ts
export const COVERAGE_CATALOG_VERSION = "2026-08-21.1";
export const COVERAGE_OUTLETS: { general: {domain,name}[]; community: {domain,name}[] };
export const REQUIRED_COVERAGE_GROUPS: readonly ("general" | "community")[] = ["general", "community"];
export function outletGroupForDomain(hostname: string): "general" | "community" | null;
```
**Both partitions must succeed** for `coveragePassStatus = "complete"`. Each partition consumes one of the 20 coverage reservations, so a scan can fully check at most 10 candidates before retries.

### Labels — exact strings, from `src/lib/source-labels.ts`

`Worth a look`, `Unverified tip`, `Coverage gap`, `Conflicting reports`, `Needs a recheck`, `No longer qualifies`, `Incomplete scan`, `Stopped early`, `Outdated`, `Saved copy`. Use `PRODUCT_LABELS` and `StatusLabel`; never type a label as a literal in a component.

Public stage text is fixed by `STAGE_TEXT` in the same file:

| Internal `stage` | User-facing text |
| --- | --- |
| `discovery` | Discovering signals |
| `evidence` | Checking local evidence |
| `coverage` | Reviewing existing coverage |
| `briefs` | Preparing leads |

### Scan state machine — binding

```
queued → running → completed | partial | canceled
queued → canceled
```

- `scans.cancel` sets `cancelRequestedAt`. It does **not** pretend an in-flight HTTP request can be aborted.
- The workflow checks cancellation **immediately before every SerpApi or model boundary** and before scheduling the next batch.
- **Finalization is safe to call more than once and only moves from a nonterminal to a terminal state. It never converts a canceled scan into completed.**

### Convex rules

- Every public function: `args` **and** `returns` validators, Clerk identity via `requireUser`, server-derived `ownerId`. Processing functions are `internalMutation` / `internalAction` only.
- Raw SerpApi JSON lives in File Storage; `rawStorageId` is **never** returned to the browser.
- Times are Unix milliseconds.
- **`npx convex codegen` does not deploy.** After adding or changing a Convex function that a CLI or e2e run will call, also run `npx convex dev --once`.
- Convex CLI commands need the env sourced: `set -a; . ./.env.local; set +a`.
- **A workflow handler must be deterministic.** `fetch`, env vars and `crypto` are blocked inside it; `Date` and `Math.random` are patched. Put every non-deterministic thing in a step, never in the handler body.
- **Always annotate the workflow handler's return type** — `.handler(async (step, args): Promise<X> => ...)` — or TypeScript hits a type cycle through `internal.*`.

### Process rules learned the hard way

- **UI cannot be verified by reading.** Seed a finished record and **open it in a browser** before calling UI work done. Item 7 found five defects that 352 green tests never would.
- **Trace one fact backwards, by hand, and refuse any hop you cannot justify.**
- Implementer subagents go idle mid-task without reporting. **Check `git log` and `git status` rather than trusting silence.**
- **Do not let an implementer run `/simplify` or any refactor pass.** One did, and it edited a shared module outside its task.
- npm only. Commit after every task. Never commit `.env*`. Paid API tests run only with `LIVE_TESTS=1`.

---

## File Structure

**Create**

| File | Responsibility |
| --- | --- |
| `convex/workflow.ts` | The single `WorkflowManager` instance. Nothing else. |
| `convex/scanWorkflow.ts` | The durable orchestrator. Calls steps, holds no business logic. |
| `convex/stages/discovery.ts` | Stage 1 — render and execute the 13 fixed discovery searches. |
| `convex/stages/evidence.ts` | Stage 2 — analyze, cluster, form, snapshot; plus `selectForCoverage`. **Created in Task 8**, which is where `runCandidateFormation` already exists to call. |
| `convex/stages/coverage.ts` | Stage 3 — two-partition coverage searches per candidate; attach coverage sources. |
| `convex/stages/enrichment.ts` | Corroboration and conditional enrichment, both via `planFollowUp`. |
| `convex/stages/finalize.ts` | Stage 4 — briefs for eligible candidates, then hand back counts. |
| `convex/editorial/prefilter.ts` | Pure function. Which formed candidates are worth paid coverage calls, and why not. |
| `tests/unit/editorial/prefilter.test.ts` | Prefilter boundary cases. |
| `tests/integration/scan-workflow.test.ts` | The lifecycle end to end against a fake model and fake fetch. |
| `tests/integration/cancellation.test.ts` | Cancel preserves completed work and blocks new reservations. |
| `tests/integration/partial-coverage.test.ts` | A failed coverage partition blocks `Coverage gap` but keeps the lead. |
| `tests/integration/search-budget-concurrency.test.ts` | In-process budget accounting (the honest, limited claim). |
| `tests/e2e/scan-progress.spec.ts` | Four stages, counts, cancel, terminal state in a browser. |
| `src/components/scan/scan-progress.tsx` | The four-stage progress panel. |

**Modify**

| File | Change |
| --- | --- |
| `convex/schema.ts` | `scans.workflowId: v.optional(v.string())`. |
| `convex/scans.ts` | `startScan` starts the workflow; `cancel` cancels it; add internal `setStage`, `recordFailure`, `bumpCounts`, `finalize`, `getForWorkflow`. |
| `convex/slice.ts` | Split `runSliceForScan` at the coverage boundary into `runCandidateFormation` + `runCandidateFinalization`; keep `runSliceForScan` as a thin composition so item 7's tests keep passing unchanged. |
| `src/app/workspace/page.tsx` | Render `ScanProgress` when a scan is active. |
| `src/lib/source-labels.ts` | Nothing — `STAGE_TEXT` already exists. Listed so nobody adds a second copy. |

### The one real design decision in this plan

The spec's lifecycle puts **coverage searches before evaluation** (step 9 before step 11), because `coveragePassStatus` is an input to eligibility. The committed `runSliceForScan` runs `cluster → form → classify → snapshot → evaluate → brief` with no coverage step, so today every candidate evaluates with `coveragePassStatus = "pending"` and picks up `coverage_pass_incomplete`.

**We split the slice rather than re-evaluating after coverage.** Re-evaluating would mean the brief is written against a verdict that is about to change, and `Existing coverage` in the brief would describe a check that had not run. Splitting keeps the spec's ordering and keeps `evaluate` the single writer, called once per candidate per scan.

`runSliceForScan` stays exported and behaves identically (formation → finalization with no coverage in between), so `tests/integration/evidence-brief-vertical-slice.test.ts` and `internal.testing.seedSliceFixture` are untouched.

---

## Task 1: Workflow manager, `workflowId` on the scan, and a scan that actually starts

**Files:**
- Create: `convex/workflow.ts`
- Create: `convex/scanWorkflow.ts`
- Modify: `convex/schema.ts:14-37` (the `scans` table)
- Modify: `convex/scans.ts:37-62` (`startScan`), `convex/scans.ts:87-` (`cancel`)
- Test: `tests/integration/scan-workflow.test.ts`

**Interfaces:**
- Consumes: `SEARCH_BUDGET` (`convex/config/searchBudget.ts`), `requireUser` (`convex/lib/auth.ts`), `MARKET_KEY`/`RULESET_VERSION`/`QUERY_CATALOG_VERSION` (`convex/config/ruleset.ts`).
- Produces:
  - `export const workflow: WorkflowManager` from `convex/workflow.ts`.
  - `export const runScan` — the workflow, in `convex/scanWorkflow.ts`, `args: { scanId: Id<"scans"> }`, handler returns `Promise<null>`. **A stub in this task**; Tasks 3–8 fill it in.
  - `scans.workflowId?: string` on the scan document.
  - `internal.scans.attachWorkflow` — `internalMutation({ args: { scanId, workflowId: v.string() }, returns: v.null() })`.

**Why a stub workflow first:** starting a workflow and cancelling it are the two things that are hard to get right and easy to get wrong silently. Proving them against an empty handler means every later task adds behaviour to a spine that is already known to work.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/scan-workflow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { asUser, setup } from "./helpers";

const NOW = 1_700_000_000_000;

async function seedUser(t: ReturnType<typeof setup>) {
  return t.run(async (ctx) =>
    ctx.db.insert("users", { clerkUserId: "owner", createdAt: NOW, updatedAt: NOW }),
  );
}

describe("scan workflow", () => {
  it("startScan records the workflow it started", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // A scan with no workflowId is a row nobody is executing. That is exactly
    // the state item 8 exists to remove.
    expect(scan?.workflowId).toEqual(expect.any(String));
    expect(scan?.status).toBe("queued");
    expect(scan?.searchBudgetLimit).toBe(120);
  });

  it("refuses a second live scan for the same owner", async () => {
    const t = setup();
    await seedUser(t);
    await asUser(t, "owner").mutation(api.scans.startScan, {});
    await expect(asUser(t, "owner").mutation(api.scans.startScan, {}))
      .rejects.toThrow(/already running/);
  });

  it("cancel marks the scan and leaves the workflow id in place for audit", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.cancelRequestedAt).toEqual(expect.any(Number));
    // Cancelling does NOT erase which workflow ran. An editor asking "what
    // happened to my scan" needs the id to still be there.
    expect(scan?.workflowId).toEqual(expect.any(String));
  });

  it("a stranger cannot cancel someone else's scan", async () => {
    const t = setup();
    await seedUser(t);
    await t.run(async (ctx) => ctx.db.insert("users", { clerkUserId: "stranger", createdAt: NOW, updatedAt: NOW }));
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await expect(asUser(t, "stranger").mutation(api.scans.cancel, { scanId }))
      .rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/integration/scan-workflow.test.ts
```

Expected: FAIL — `scan?.workflowId` is `undefined` (the field does not exist yet).

- [ ] **Step 3: Add the schema field**

In `convex/schema.ts`, inside `scans: defineTable({ ... })`, directly after `cancelRequestedAt`:

```ts
    cancelRequestedAt: v.optional(v.number()),
    // The durable workflow executing this scan. Optional because a scan row can
    // exist for a moment before `start` returns, and because saved demo scans
    // (item 10) are imported rows that no workflow ever ran.
    workflowId: v.optional(v.string()),
```

- [ ] **Step 4: Create the workflow manager**

Create `convex/workflow.ts`:

```ts
import { WorkflowManager } from "@convex-dev/workflow";
import { components } from "./_generated/api";

/**
 * The one WorkflowManager. Its own module so nothing imports the orchestrator
 * just to reach the manager, which is how import cycles start.
 *
 * `retryActionsByDefault` stays FALSE. Our search and model actions are already
 * idempotent through reservation and idempotency keys, and a blind retry of a
 * paid SerpApi call spends money the budget did not authorise. Steps that are
 * genuinely safe to retry ask for it explicitly with `{ retry: true }`.
 */
export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    // One scan should not be able to starve the deployment. 13 discovery
    // searches at a time is already more parallelism than SerpApi wants.
    maxParallelism: 5,
    retryActionsByDefault: false,
  },
});
```

- [ ] **Step 5: Create the workflow stub**

Create `convex/scanWorkflow.ts`:

```ts
import { v } from "convex/values";
import { workflow } from "./workflow";

/**
 * The scan's durable spine. It orchestrates and nothing else — every decision,
 * every write and every external call lives in a step.
 *
 * The handler is replayed from the top each time a step completes, so it must
 * stay deterministic: no `fetch`, no `process.env`, no unseeded randomness. The
 * component blocks those; this comment is here so nobody spends an hour finding
 * out why.
 */
export const runScan = workflow.define({
  args: { scanId: v.id("scans") },
  returns: v.null(),
  // The explicit Promise<null> annotation breaks the type cycle that otherwise
  // forms through `internal.*` once steps are added in Task 3.
}).handler(async (_step, _args): Promise<null> => {
  // Tasks 3–8 fill this in, stage by stage.
  return null;
});
```

- [ ] **Step 6: Start the workflow from `startScan`**

Replace the body of `startScan` in `convex/scans.ts`. The existing ownership and duplicate-scan checks stay exactly as they are:

```ts
import { start } from "@convex-dev/workflow";
import { components, internal } from "./_generated/api";
// ...existing imports unchanged...

export const startScan = mutation({
  args: {},
  returns: v.id("scans"),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    for (const status of ["queued", "running"] as const) {
      const active = await ctx.db.query("scans").withIndex("by_owner_status", (q) => q.eq("ownerId", user._id).eq("status", status)).first();
      if (active) throw new Error("A scan is already running");
    }
    const scanId = await ctx.db.insert("scans", {
      ownerId: user._id,
      marketKey: MARKET_KEY,
      rulesetVersion: RULESET_VERSION,
      queryCatalogVersion: QUERY_CATALOG_VERSION,
      status: "queued",
      stage: "discovery",
      startedAt: Date.now(),
      searchBudgetLimit: SEARCH_BUDGET.hardCap,
      searchesReserved: 0, searchesSucceeded: 0, searchesFailed: 0,
      eligibleCount: 0, excludedCount: 0, processingCount: 0,
      failureSummaries: [],
      isSavedDemo: false,
    });

    // Started INSIDE the same transaction as the insert. Either both happen or
    // neither does, so there is no window where a queued scan exists with
    // nothing executing it.
    const workflowId = await start(ctx, internal.scanWorkflow.runScan, { scanId });
    await ctx.db.patch(scanId, { workflowId });
    return scanId;
  },
});
```

- [ ] **Step 7: Cancel the workflow from `scans.cancel`**

Replace the body of `cancel` in `convex/scans.ts`:

```ts
export const cancel = mutation({
  args: { scanId: v.id("scans") },
  returns: v.null(),
  handler: async (ctx, { scanId }) => {
    const user = await requireUser(ctx);
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.ownerId !== user._id) throw new Error("Scan not found");
    if (scan.status === "completed" || scan.status === "partial" || scan.status === "canceled") return null;

    // The flag is what every step checks before spending money. Cancelling the
    // workflow stops future steps; it cannot abort an HTTP request already in
    // flight, and the spec is explicit that we do not pretend otherwise.
    await ctx.db.patch(scanId, { cancelRequestedAt: Date.now() });
    if (scan.workflowId) await cancelWorkflow(ctx, components.workflow, scan.workflowId as WorkflowId);
    return null;
  },
});
```

Add to the imports at the top of `convex/scans.ts`:

```ts
import { cancel as cancelWorkflow, start, type WorkflowId } from "@convex-dev/workflow";
import { components, internal } from "./_generated/api";
```

- [ ] **Step 8: Add `internal.scans.attachWorkflow`**

Later tasks need a way to record a restarted workflow. Add to `convex/scans.ts`:

```ts
export const attachWorkflow = internalMutation({
  args: { scanId: v.id("scans"), workflowId: v.string() },
  returns: v.null(),
  handler: async (ctx, { scanId, workflowId }) => {
    await ctx.db.patch(scanId, { workflowId });
    return null;
  },
});
```

Add `internalMutation` to the `./_generated/server` import.

- [ ] **Step 9: Run the tests to verify they pass**

```bash
npx vitest run tests/integration/scan-workflow.test.ts
npm run check
```

Expected: 4 passed in the new file, whole suite green.

- [ ] **Step 10: Deploy and smoke it by hand**

```bash
set -a; . ./.env.local; set +a
npx convex dev --once
```

Expected: `Convex functions ready!` with no schema error. A schema change on an existing deployment with rows is where a validator mismatch shows up, and only a real deploy proves it.

- [ ] **Step 11: Commit**

```bash
git add convex/workflow.ts convex/scanWorkflow.ts convex/schema.ts convex/scans.ts tests/integration/scan-workflow.test.ts
git commit -m "feat(scan): startScan starts a durable workflow, cancel stops it (MOO-734)"
```

---

## Task 2: Scan state transitions — stage, failures, counts, and an honest finalize

**Files:**
- Modify: `convex/scans.ts`
- Test: `tests/integration/scan-workflow.test.ts` (append)

**Interfaces:**
- Consumes: the `scans` table, `V.vStage`, `V.vFailureSummary`, `V.vPurpose` from `convex/lib/validators.ts`.
- Produces, all `internalMutation` unless noted:
  - `internal.scans.setStage` — `{ scanId, stage: vStage }` → `v.null()`. Also flips `queued` → `running` the first time.
  - `internal.scans.recordFailure` — `{ scanId, purpose: vPurpose, code: v.string(), message: v.string() }` → `v.null()`. Append-only, deduplicated by `purpose:code`.
  - `internal.scans.recordSearchOutcome` — `{ scanId, succeeded: v.number(), failed: v.number() }` → `v.null()`. Cumulative counters.
  - `internal.scans.setCandidateCounts` — `{ scanId, eligibleCount, excludedCount, processingCount }` → `v.null()`.
  - `internal.scans.finalize` — `{ scanId }` → `v.object({ status: vScanStatus })`. Idempotent; derives the terminal status.
  - `internal.scans.getForWorkflow` — `internalQuery`, `{ scanId }` → the fields a step needs, including `cancelRequestedAt` and remaining budget.

**The rule this task encodes:** `finalize` derives the terminal status rather than being told it. A caller that could pass `"completed"` is a caller that could turn a cancelled scan into a successful one, which the spec forbids outright.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/scan-workflow.test.ts`:

```ts
describe("scan state transitions", () => {
  it("setStage moves queued to running the first time and records the stage", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    await t.mutation(internal.scans.setStage, { scanId, stage: "coverage" });
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.status).toBe("running");
    expect(scan?.stage).toBe("coverage");
  });

  it("recordFailure appends once per purpose+code, not once per occurrence", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    for (let i = 0; i < 3; i++) {
      await t.mutation(internal.scans.recordFailure, {
        scanId, purpose: "coverage", code: "http_429", message: "rate limited",
      });
    }
    await t.mutation(internal.scans.recordFailure, {
      scanId, purpose: "discovery", code: "http_429", message: "rate limited",
    });

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // Three rate-limited coverage calls are ONE thing an editor needs told,
    // not three. A different purpose is a different thing.
    expect(scan?.failureSummaries).toHaveLength(2);
    expect(scan?.failureSummaries.map((f) => f.purpose).sort()).toEqual(["coverage", "discovery"]);
  });

  it("finalize with no failures completes the scan", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await t.mutation(internal.scans.setStage, { scanId, stage: "briefs" });

    const { status } = await t.mutation(internal.scans.finalize, { scanId });
    expect(status).toBe("completed");
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.completedAt).toEqual(expect.any(Number));
  });

  it("finalize with named failures ends partial, not completed", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await t.mutation(internal.scans.recordFailure, {
      scanId, purpose: "coverage", code: "http_500", message: "upstream error",
    });

    const { status } = await t.mutation(internal.scans.finalize, { scanId });
    expect(status).toBe("partial");
  });

  it("finalize NEVER turns a cancelled scan into a completed one", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const { status } = await t.mutation(internal.scans.finalize, { scanId });
    expect(status).toBe("canceled");
  });

  it("finalize is safe to call twice and does not move a terminal scan", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const first = await t.mutation(internal.scans.finalize, { scanId });
    const firstCompletedAt = (await t.run(async (ctx) => ctx.db.get(scanId)))?.completedAt;
    await t.mutation(internal.scans.recordFailure, {
      scanId, purpose: "coverage", code: "late", message: "arrived after finalize",
    });
    const second = await t.mutation(internal.scans.finalize, { scanId });

    expect(first.status).toBe("completed");
    // A late failure cannot rewrite history. The scan already ended.
    expect(second.status).toBe("completed");
    expect((await t.run(async (ctx) => ctx.db.get(scanId)))?.completedAt).toBe(firstCompletedAt);
  });

  it("recordSearchOutcome accumulates and never decrements failures", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    await t.mutation(internal.scans.recordSearchOutcome, { scanId, succeeded: 3, failed: 1 });
    await t.mutation(internal.scans.recordSearchOutcome, { scanId, succeeded: 2, failed: 0 });

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.searchesSucceeded).toBe(5);
    // searchesFailed is a cumulative count of failed ATTEMPTS, not a live gauge
    // of currently-failed rows. A retry reuses the row, so decrementing would
    // make succeeded + failed + in-flight == reserved impossible to hold.
    expect(scan?.searchesFailed).toBe(1);
  });
});
```

Add `internal` to the imports at the top of the file:

```ts
import { api, internal } from "../../convex/_generated/api";
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/integration/scan-workflow.test.ts
```

Expected: FAIL — `internal.scans.setStage is not a function` and friends.

- [ ] **Step 3: Implement the transitions**

Append to `convex/scans.ts`:

```ts
export const setStage = internalMutation({
  args: { scanId: v.id("scans"), stage: V.vStage },
  returns: v.null(),
  handler: async (ctx, { scanId, stage }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return null;
    // A terminal scan's stage is history. Nothing may move it.
    if (scan.status !== "queued" && scan.status !== "running") return null;
    await ctx.db.patch(scanId, { stage, status: "running" });
    return null;
  },
});

export const recordFailure = internalMutation({
  args: { scanId: v.id("scans"), purpose: V.vPurpose, code: v.string(), message: v.string() },
  returns: v.null(),
  handler: async (ctx, { scanId, purpose, code, message }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return null;
    // Deduplicated by purpose+code: twenty rate-limited coverage calls are one
    // thing an editor needs told, not twenty.
    if (scan.failureSummaries.some((f) => f.purpose === purpose && f.code === code)) return null;
    await ctx.db.patch(scanId, {
      failureSummaries: [...scan.failureSummaries, { purpose, code, message: message.slice(0, 400) }],
    });
    return null;
  },
});

export const recordSearchOutcome = internalMutation({
  args: { scanId: v.id("scans"), succeeded: v.number(), failed: v.number() },
  returns: v.null(),
  handler: async (ctx, { scanId, succeeded, failed }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return null;
    await ctx.db.patch(scanId, {
      searchesSucceeded: scan.searchesSucceeded + succeeded,
      searchesFailed: scan.searchesFailed + failed,
    });
    return null;
  },
});

export const setCandidateCounts = internalMutation({
  args: {
    scanId: v.id("scans"),
    eligibleCount: v.number(), excludedCount: v.number(), processingCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { scanId, eligibleCount, excludedCount, processingCount }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return null;
    await ctx.db.patch(scanId, { eligibleCount, excludedCount, processingCount });
    return null;
  },
});

/**
 * The one place a scan reaches a terminal state.
 *
 * It DERIVES the status rather than accepting one. A caller that could pass
 * "completed" is a caller that could turn a cancelled scan into a successful
 * one, and the spec forbids that outright.
 */
export const finalize = internalMutation({
  args: { scanId: v.id("scans") },
  returns: v.object({ status: V.vScanStatus }),
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) throw new Error("Scan not found");
    // Already terminal. Say what it is and change nothing — a failure that
    // arrives late cannot rewrite a scan that already ended.
    if (scan.status !== "queued" && scan.status !== "running") return { status: scan.status };

    const status = scan.cancelRequestedAt !== undefined
      ? ("canceled" as const)
      : scan.failureSummaries.length > 0
        ? ("partial" as const)
        : ("completed" as const);

    await ctx.db.patch(scanId, { status, completedAt: Date.now() });
    return { status };
  },
});

const vWorkflowScan = v.object({
  scanId: v.id("scans"),
  ownerId: v.id("users"),
  isCancelRequested: v.boolean(),
  isActive: v.boolean(),
  searchesReserved: v.number(),
  searchBudgetLimit: v.number(),
  remaining: v.number(),
});

/**
 * What a step needs to decide whether to spend anything. Read before every
 * external boundary, per `spec.md > Cancellation and idempotency`.
 */
export const getForWorkflow = internalQuery({
  args: { scanId: v.id("scans") },
  returns: v.union(v.null(), vWorkflowScan),
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return null;
    const limit = Math.min(scan.searchBudgetLimit, SEARCH_BUDGET.hardCap);
    return {
      scanId: scan._id,
      ownerId: scan.ownerId,
      isCancelRequested: scan.cancelRequestedAt !== undefined,
      isActive: scan.status === "queued" || scan.status === "running",
      searchesReserved: scan.searchesReserved,
      searchBudgetLimit: limit,
      remaining: Math.max(0, limit - scan.searchesReserved),
    };
  },
});
```

Add `internalQuery` to the `./_generated/server` import.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/integration/scan-workflow.test.ts
npm run check
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add convex/scans.ts tests/integration/scan-workflow.test.ts
git commit -m "feat(scan): stage, failure and terminal-state transitions (MOO-734)"
```

---

## Task 3: The discovery stage — 13 fixed searches, and never a fourteenth

**Files:**
- Create: `convex/stages/discovery.ts`
- Test: `tests/integration/scan-workflow.test.ts` (append a `discovery stage` describe block)

**Interfaces:**
- Consumes: `DISCOVERY_TEMPLATE_IDS`, `getTemplate`, `renderQuery` (`convex/integrations/serpapi/queryCatalog.ts`); `MILWAUKEE_LOCATION`, `SearchSpec` (`convex/integrations/serpapi/contracts.ts`); `runExecuteSearch` (`convex/integrations/serpapi/executeSearch.ts`); `internal.scans.getForWorkflow`, `internal.scans.recordSearchOutcome`, `internal.scans.recordFailure` (Task 2).
- **Also produces the shared test fixtures**, in `tests/integration/helpers.ts`, because Tasks 6, 7, 8 and 10 all need them and three drifting copies of one fixture is exactly what went wrong in item 7:
  ```ts
  export async function seedUser(t: TestConvex<typeof schema>, clerkUserId = "owner"): Promise<Id<"users">>;
  export function fakeFetch(byQueryNeedle?: Record<string, unknown>): typeof fetch;
  ```
  Move `seedUser` and `fakeFetch` there as part of this task and import them in `tests/integration/scan-workflow.test.ts`. Do **not** define them locally.
- Produces:
  - `export function discoverySpecs(now: number): SearchSpec[]` — pure, exactly 13 specs.
  - `export async function runDiscoveryStage(ctx, { scanId, now? }, options?): Promise<DiscoveryOutcome>` where
    ```ts
    export type DiscoveryOutcome = {
      executed: number;      // runs that actually reached SerpApi
      succeeded: number;
      failed: number;
      skipped: number;       // budget exhausted, cancelled, or already succeeded
      sourceResultIds: Id<"sourceResults">[];
      canceled: boolean;
    };
    ```
  - `export const discover = internalAction({ args: { scanId }, returns: vDiscoveryOutcome })` — the one-line wrapper.

**The rule this task encodes:** discovery is a *fixed* list. Nothing — not a model, not a retry, not a clever optimisation — may add a fourteenth discovery search. Supplemental searches exist, they are a different purpose, and they come out of the reserve.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/scan-workflow.test.ts`:

```ts
import { discoverySpecs, runDiscoveryStage } from "../../convex/stages/discovery";
import { DISCOVERY_TEMPLATE_IDS } from "../../convex/integrations/serpapi/queryCatalog";

const EMPTY_SERP = {
  search_metadata: { id: "x", status: "Success" },
  organic_results: [],
};

function fakeFetch(byTemplate: Record<string, unknown> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const q = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";
    const body = Object.entries(byTemplate).find(([needle]) => q.includes(needle))?.[1] ?? EMPTY_SERP;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("discovery stage", () => {
  it("renders exactly the 13 frozen templates, once each", () => {
    const specs = discoverySpecs(NOW);
    expect(specs).toHaveLength(13);
    expect(specs.map((s) => s.templateId).sort()).toEqual([...DISCOVERY_TEMPLATE_IDS].sort());
    // Decision 005: Google Events is enrichment now, and must not reappear here.
    expect(specs.some((s) => s.engine === "google_events")).toBe(false);
    for (const spec of specs) {
      expect(spec.purpose).toBe("discovery");
      expect(spec.query.trim().length).toBeGreaterThan(0);
    }
  });

  it("every rendered query is unique, so no two runs share an idempotency key", () => {
    const queries = discoverySpecs(NOW).map((s) => `${s.templateId}|${s.query}`);
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("executes all 13 and reserves 13, not 16", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const outcome = await t.action(async (ctx) =>
      runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }),
    );

    expect(outcome.executed).toBe(13);
    expect(outcome.canceled).toBe(false);
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // 16 is the budget CEILING. Spending 13 is the point of decision 005.
    expect(scan?.searchesReserved).toBe(13);
  });

  it("stops before the next search once cancellation is requested", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const outcome = await t.action(async (ctx) =>
      runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }),
    );

    expect(outcome.canceled).toBe(true);
    expect(outcome.executed).toBe(0);
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // Not one paid call after the editor said stop.
    expect(scan?.searchesReserved).toBe(0);
  });

  it("a failing search is named on the scan and does not stop the other twelve", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const failOnSpanish = (async (input: RequestInfo | URL) => {
      const q = new URL(String(input)).searchParams.get("q") ?? "";
      if (q.includes("vivienda")) return new Response("upstream boom", { status: 500 });
      return new Response(JSON.stringify(EMPTY_SERP), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const outcome = await t.action(async (ctx) =>
      runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: failOnSpanish, sleep: async () => {} }),
    );

    expect(outcome.failed).toBeGreaterThanOrEqual(1);
    expect(outcome.succeeded).toBeGreaterThanOrEqual(11);
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.failureSummaries.some((f) => f.purpose === "discovery")).toBe(true);
  });

  it("running the stage twice reuses completed runs and reserves nothing new", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    const opts = { fetchImpl: fakeFetch(), sleep: async () => {} };

    await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, opts));
    const afterFirst = (await t.run(async (ctx) => ctx.db.get(scanId)))?.searchesReserved;
    const second = await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, opts));

    // Resuming a workflow after a restart must not re-buy searches we own.
    expect((await t.run(async (ctx) => ctx.db.get(scanId)))?.searchesReserved).toBe(afterFirst);
    expect(second.skipped).toBe(13);
    expect(second.executed).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/integration/scan-workflow.test.ts
```

Expected: FAIL — cannot resolve `../../convex/stages/discovery`.

- [ ] **Step 3: Implement the discovery stage**

Create `convex/stages/discovery.ts`:

```ts
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import { MILWAUKEE_LOCATION, type SearchSpec } from "../integrations/serpapi/contracts";
import { runExecuteSearch } from "../integrations/serpapi/executeSearch";
import { DISCOVERY_TEMPLATE_IDS, getTemplate, renderQuery } from "../integrations/serpapi/queryCatalog";

export const vDiscoveryOutcome = v.object({
  executed: v.number(),
  succeeded: v.number(),
  failed: v.number(),
  skipped: v.number(),
  sourceResultIds: v.array(v.id("sourceResults")),
  canceled: v.boolean(),
});
export type DiscoveryOutcome = Infer<typeof vDiscoveryOutcome>;

/**
 * The fixed opening set, rendered.
 *
 * Pure and exported so a test can assert the shape of the catalog without
 * touching a network or a database. Every discovery template declares its own
 * terms, so none of them takes entity terms — a model has no say in what a scan
 * opens with, which is the entire reason the set is frozen.
 */
export function discoverySpecs(now: number): SearchSpec[] {
  return DISCOVERY_TEMPLATE_IDS.map((id) => {
    const template = getTemplate(id);
    // Unreachable with the committed catalog — DISCOVERY_TEMPLATE_IDS is derived
    // from the same array. Throws rather than silently shortening the set,
    // because a scan that quietly opens with 12 searches is a lie about coverage.
    if (!template) throw new Error(`discovery template missing from catalog: ${id}`);
    return {
      templateId: template.id,
      engine: template.engine,
      purpose: "discovery" as const,
      query: renderQuery(template, { now, terms: [] }),
      location: MILWAUKEE_LOCATION,
      language: template.language,
      timeWindow: template.timeWindow,
    };
  });
}

type DiscoveryArgs = { scanId: Id<"scans">; now?: number };
type DiscoveryOptions = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };

/**
 * Runs the fixed opening set, one search at a time.
 *
 * Serial on purpose. These are paid calls against a third party with its own
 * rate limits, and the workflow's own workpool already runs stages in parallel
 * with everything else in the deployment. Thirteen sequential calls is seconds,
 * not minutes.
 *
 * Extracted from the internalAction so tests inject fetch and sleep: Convex
 * validates action args before the handler runs, so a function value can never
 * travel through `args`.
 */
export async function runDiscoveryStage(
  ctx: ActionCtx,
  { scanId, now = Date.now() }: DiscoveryArgs,
  options: DiscoveryOptions = {},
): Promise<DiscoveryOutcome> {
  const outcome: DiscoveryOutcome = {
    executed: 0, succeeded: 0, failed: 0, skipped: 0, sourceResultIds: [], canceled: false,
  };

  for (const spec of discoverySpecs(now)) {
    // Checked before EVERY paid boundary, not once at the top. An editor who
    // cancels mid-stage must not be billed for the rest of the list.
    const scan = await ctx.runQuery(internal.scans.getForWorkflow, { scanId });
    if (!scan || !scan.isActive || scan.isCancelRequested) {
      outcome.canceled = true;
      break;
    }

    const result = await runExecuteSearch(ctx, { scanId, spec }, options);
    if (result.status === "skipped") {
      outcome.skipped++;
      continue;
    }

    outcome.executed++;
    if (result.status === "succeeded") outcome.succeeded++;
    else {
      outcome.failed++;
      const run = result.runId ? await ctx.runQuery(internal.searchRuns.getRun, { runId: result.runId }) : null;
      await ctx.runMutation(internal.scans.recordFailure, {
        scanId,
        purpose: "discovery",
        code: run?.errorCode ?? "search_failed",
        message: run?.errorMessage ?? `discovery search ${spec.templateId} failed`,
      });
    }
  }

  await ctx.runMutation(internal.scans.recordSearchOutcome, {
    scanId, succeeded: outcome.succeeded, failed: outcome.failed,
  });

  outcome.sourceResultIds = await ctx.runQuery(internal.sourceResults.idsForScan, { scanId, purpose: "discovery" });
  return outcome;
}

export const discover = internalAction({
  args: { scanId: v.id("scans") },
  returns: vDiscoveryOutcome,
  handler: (ctx, args): Promise<DiscoveryOutcome> => runDiscoveryStage(ctx, args),
});
```

- [ ] **Step 4: Add the two internal reads this stage needs**

`runExecuteSearch` does not return the error text, and the stage needs the ingested ids. Add to `convex/searchRuns.ts` — check first, `getRun` already exists at line 161; confirm it returns `errorCode` and `errorMessage`, and add them to its `returns` validator if it does not.

Add to `convex/sourceResults.ts`:

```ts
/**
 * Every source this scan ingested for one purpose, oldest first.
 *
 * Ordering matters: the next stage clusters these, and a stable order makes a
 * replayed workflow produce the same clusters as the run it is resuming.
 */
export const idsForScan = internalQuery({
  args: { scanId: v.id("scans"), purpose: V.vPurpose },
  returns: v.array(v.id("sourceResults")),
  handler: async (ctx, { scanId, purpose }) => {
    const runs = await ctx.db
      .query("searchRuns")
      .withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId).eq("purpose", purpose))
      .collect();
    const runIds = new Set(runs.map((r) => r._id as string));

    const rows = await ctx.db
      .query("sourceResults")
      .withIndex("by_scan_canonical", (q) => q.eq("scanId", scanId))
      .collect();
    return rows.filter((r) => runIds.has(r.searchRunId as string)).map((r) => r._id);
  },
});
```

Add `internalQuery` to the `./_generated/server` import in `convex/sourceResults.ts`. `searchRuns` already has `.index("by_scan_purpose", ["scanId", "purpose"])` (`convex/schema.ts:61`) — use it; do not add a new index.

`getRun` currently returns only `{ status, resultCount, reservedAt }` (`convex/searchRuns.ts:161`). Widen its `returns` validator and handler so the stage can name a real failure instead of a generic one:

```ts
export const getRun = internalQuery({
  args: { runId: v.id("searchRuns") },
  returns: v.union(v.null(), v.object({
    status: V.vSearchRunStatus, resultCount: v.number(), reservedAt: v.number(),
    errorCode: v.union(v.string(), v.null()), errorMessage: v.union(v.string(), v.null()),
  })),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    return run ? {
      status: run.status, resultCount: run.resultCount, reservedAt: run.reservedAt,
      errorCode: run.errorCode ?? null, errorMessage: run.errorMessage ?? null,
    } : null;
  },
});
```

Confirm `searchRuns.errorCode` and `errorMessage` exist in `convex/schema.ts` before widening. If they are named differently, use the committed names.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run tests/integration/scan-workflow.test.ts
npm run check
```

Expected: green. If `outcome.executed` is 13 but `searchesReserved` is not, the reservation path was bypassed — that is a bug in the stage, never a reason to relax the assertion.

- [ ] **Step 6: Commit**

```bash
git add convex/stages/discovery.ts convex/sourceResults.ts convex/searchRuns.ts convex/schema.ts tests/integration/scan-workflow.test.ts
git commit -m "feat(scan): the discovery stage runs the 13 frozen templates (MOO-734)"
```

---

## Task 4: The prefilter — deciding which candidates are worth paid coverage calls

**Files:**
- Create: `convex/editorial/prefilter.ts`
- Create: `tests/unit/editorial/prefilter.test.ts`

**Interfaces:**
- Consumes: `CandidateInput`, `SignalCategory` (`convex/editorial/types.ts`); `DISCOVERY_WINDOW_MS` (`convex/config/ruleset.ts`).
- Produces:
  ```ts
  export type PrefilterInput = {
    candidateId: string;
    localityBand: LocalityBand;          // "direct_city" | "county_city_effect" | "area_city_consequence" | "none"
    relevanceBand: RelevanceBand;        // "policy_service_change" | "community_cultural_impact" | "emerging_question" | "promotion_only"
    beat: Beat | null;
    initiatingSignalAt: number;
    now: number;
    isDuplicateOfCandidate: boolean;
    isSpeculative: boolean;
    isRoutineCrime: boolean;
    confirmingCategoryCount: number;     // categories that CAN confirm, already counted
  };
  export type PrefilterVerdict =
    | { worthCoverage: true; priority: number }
    | { worthCoverage: false; reasons: PrefilterReason[] };
  export type PrefilterReason =
    | "weak_locality" | "stale" | "no_beat_relevance" | "promotional"
    | "duplicate" | "speculative" | "routine_crime" | "no_confirming_signal";
  export function prefilterCandidate(input: PrefilterInput): PrefilterVerdict;
  export function orderForCoverage(verdicts: Array<{ candidateId: string; verdict: PrefilterVerdict }>): string[];
  ```

**Why this exists:** spec lifecycle step 7. There are 20 coverage reservations and two per candidate, so **at most 10 candidates** can be fully checked. Spending them on a stale, non-local, or duplicate candidate means a real lead goes unchecked. This is the only place in the plan that decides who gets the money.

**What it is NOT:** it does not decide eligibility. `evaluateCandidate` does that, later, with coverage results in hand. A candidate the prefilter skips still gets evaluated — it just carries `coveragePassStatus: "pending"` and therefore cannot be a `Coverage gap`. That is the honest outcome, and it is the same one item 7's review lead already shows.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/editorial/prefilter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { orderForCoverage, prefilterCandidate, type PrefilterInput } from "../../../convex/editorial/prefilter";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const base: PrefilterInput = {
  candidateId: "c1",
  localityBand: "direct_city",
  relevanceBand: "core_beat",
  beat: "housing",
  initiatingSignalAt: NOW - DAY,
  now: NOW,
  isDuplicateOfCandidate: false,
  isSpeculative: false,
  isRoutineCrime: false,
  confirmingCategoryCount: 2,
};

describe("prefilterCandidate", () => {
  it("passes a fresh, local, on-beat candidate with confirming signal", () => {
    const verdict = prefilterCandidate(base);
    expect(verdict.worthCoverage).toBe(true);
  });

  it("refuses a candidate with no Milwaukee connection", () => {
    const verdict = prefilterCandidate({ ...base, localityBand: "none" });
    expect(verdict).toEqual({ worthCoverage: false, reasons: ["weak_locality"] });
  });

  it("refuses a candidate older than the seven-day discovery window", () => {
    const verdict = prefilterCandidate({ ...base, initiatingSignalAt: NOW - 8 * DAY });
    expect(verdict).toEqual({ worthCoverage: false, reasons: ["stale"] });
  });

  it("refuses promotion, duplicates, speculation and routine crime", () => {
    expect(prefilterCandidate({ ...base, relevanceBand: "promotion_only" }))
      .toEqual({ worthCoverage: false, reasons: ["promotional"] });
    expect(prefilterCandidate({ ...base, isDuplicateOfCandidate: true }))
      .toEqual({ worthCoverage: false, reasons: ["duplicate"] });
    expect(prefilterCandidate({ ...base, isSpeculative: true }))
      .toEqual({ worthCoverage: false, reasons: ["speculative"] });
    expect(prefilterCandidate({ ...base, isRoutineCrime: true }))
      .toEqual({ worthCoverage: false, reasons: ["routine_crime"] });
  });

  it("refuses a candidate nothing can confirm", () => {
    // A Reddit thread on its own is a tip. Spending two paid coverage searches
    // on a tip is two searches a real lead does not get.
    const verdict = prefilterCandidate({ ...base, confirmingCategoryCount: 0 });
    expect(verdict).toEqual({ worthCoverage: false, reasons: ["no_confirming_signal"] });
  });

  it("names every reason, not just the first", () => {
    const verdict = prefilterCandidate({
      ...base, localityBand: "none", isSpeculative: true, confirmingCategoryCount: 0,
    });
    expect(verdict.worthCoverage).toBe(false);
    if (verdict.worthCoverage) throw new Error("unreachable");
    expect(verdict.reasons.sort()).toEqual(["no_confirming_signal", "speculative", "weak_locality"]);
  });

  it("ranks a two-category, same-day candidate above a one-category, six-day-old one", () => {
    const strong = prefilterCandidate({ ...base, confirmingCategoryCount: 3, initiatingSignalAt: NOW });
    const weak = prefilterCandidate({ ...base, confirmingCategoryCount: 1, initiatingSignalAt: NOW - 6 * DAY });
    if (!strong.worthCoverage || !weak.worthCoverage) throw new Error("both should pass");
    expect(strong.priority).toBeGreaterThan(weak.priority);
  });
});

describe("orderForCoverage", () => {
  it("returns only passing candidates, highest priority first", () => {
    const ordered = orderForCoverage([
      { candidateId: "low", verdict: { worthCoverage: true, priority: 1 } },
      { candidateId: "skip", verdict: { worthCoverage: false, reasons: ["stale"] } },
      { candidateId: "high", verdict: { worthCoverage: true, priority: 9 } },
    ]);
    expect(ordered).toEqual(["high", "low"]);
  });

  it("breaks a priority tie by candidate id, so a replayed workflow orders the same way", () => {
    const ordered = orderForCoverage([
      { candidateId: "b", verdict: { worthCoverage: true, priority: 5 } },
      { candidateId: "a", verdict: { worthCoverage: true, priority: 5 } },
    ]);
    expect(ordered).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/editorial/prefilter.test.ts
```

Expected: FAIL — cannot resolve `convex/editorial/prefilter`.

- [ ] **Step 3: Implement the prefilter**

Create `convex/editorial/prefilter.ts`:

```ts
import { DISCOVERY_WINDOW_MS } from "../config/ruleset";
import type { Beat, LocalityBand, RelevanceBand } from "./types";

export type PrefilterReason =
  | "weak_locality" | "stale" | "no_beat_relevance" | "promotional"
  | "duplicate" | "speculative" | "routine_crime" | "no_confirming_signal";

export type PrefilterInput = {
  candidateId: string;
  localityBand: LocalityBand;
  relevanceBand: RelevanceBand;
  beat: Beat | null;
  initiatingSignalAt: number;
  now: number;
  isDuplicateOfCandidate: boolean;
  isSpeculative: boolean;
  isRoutineCrime: boolean;
  confirmingCategoryCount: number;
};

export type PrefilterVerdict =
  | { worthCoverage: true; priority: number }
  | { worthCoverage: false; reasons: PrefilterReason[] };

const DAY = 86_400_000;

/**
 * Which candidates get the money.
 *
 * There are 20 coverage reservations and each candidate costs two, so at most
 * TEN candidates can be fully checked in a scan. Spending a pair on a stale or
 * non-local candidate is a pair a real lead does not get.
 *
 * This is deliberately the SAME set of tests the eligibility gate applies, minus
 * everything that needs coverage results — running them early is what makes the
 * spend rational. It decides nothing about eligibility; `evaluateCandidate`
 * still does that, later, with the coverage answer in hand.
 */
export function prefilterCandidate(input: PrefilterInput): PrefilterVerdict {
  const reasons: PrefilterReason[] = [];

  if (input.localityBand === "none") reasons.push("weak_locality");
  if (input.now - input.initiatingSignalAt > DISCOVERY_WINDOW_MS) reasons.push("stale");
  if (input.beat === null) reasons.push("no_beat_relevance");
  if (input.relevanceBand === "promotion_only") reasons.push("promotional");
  if (input.isDuplicateOfCandidate) reasons.push("duplicate");
  if (input.isSpeculative) reasons.push("speculative");
  if (input.isRoutineCrime) reasons.push("routine_crime");
  // Nothing that CAN confirm means the coverage answer changes nothing: the
  // independence gate fails either way. Two paid searches would buy no decision.
  if (input.confirmingCategoryCount === 0) reasons.push("no_confirming_signal");

  if (reasons.length > 0) return { worthCoverage: false, reasons };

  // Priority favours convergence first, freshness second. A story three kinds of
  // source landed on today is the one an editor most needs answered.
  const ageDays = Math.max(0, (input.now - input.initiatingSignalAt) / DAY);
  const freshness = Math.max(0, 7 - ageDays);
  return { worthCoverage: true, priority: input.confirmingCategoryCount * 10 + freshness };
}

/**
 * Passing candidates, best first.
 *
 * The id tiebreak is not cosmetic: a workflow that replays after a restart must
 * order candidates identically, or the resumed run spends its coverage
 * reservations on a different set than the run it is continuing.
 */
export function orderForCoverage(
  verdicts: Array<{ candidateId: string; verdict: PrefilterVerdict }>,
): string[] {
  return verdicts
    .filter((v): v is { candidateId: string; verdict: { worthCoverage: true; priority: number } } => v.verdict.worthCoverage)
    .sort((a, b) => b.verdict.priority - a.verdict.priority || a.candidateId.localeCompare(b.candidateId))
    .map((v) => v.candidateId);
}
```

Before writing, open `convex/editorial/types.ts` and confirm the exact names of `LocalityBand`, `RelevanceBand` and `Beat`, and the exact literal for a promotion-only relevance band. Use what is there — do not introduce a synonym.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/unit/editorial/prefilter.test.ts
npm run check
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add convex/editorial/prefilter.ts tests/unit/editorial/prefilter.test.ts
git commit -m "feat(editorial): prefilter decides which candidates get paid coverage calls (MOO-734)"
```

---

## Task 5: Split the slice at the coverage boundary

**Files:**
- Modify: `convex/slice.ts`
- Test: `tests/integration/evidence-brief-vertical-slice.test.ts` (must keep passing **unchanged**)
- Test: `tests/integration/scan-workflow.test.ts` (append)

**Interfaces:**
- Consumes: `runClusterSignals`, `runClassifyEvidence`, `runGenerateBrief` (`convex/ai/`); `internal.candidates.form.formFromCluster`, `.judgment.saveJudgment`, `.snapshot.writeSnapshot`, `.evaluate.evaluate`.
- Produces, from `convex/slice.ts`:
  ```ts
  export type FormedCandidate = {
    candidateId: Id<"candidates">;
    sourceResultIds: Id<"sourceResults">[];
    evidenceVersion: number | null;
    failures: string[];
  };
  export async function runCandidateFormation(
    ctx: ActionCtx,
    args: { scanId: Id<"scans">; sourceResultIds: Id<"sourceResults">[] },
    generate?: GenerateFn,
  ): Promise<{ ok: true; candidates: FormedCandidate[] } | { ok: false; reason: string; errors: string[] }>;

  export async function runCandidateFinalization(
    ctx: ActionCtx,
    args: { scanId: Id<"scans">; candidateId: Id<"candidates">; now?: number },
    generate?: GenerateFn,
  ): Promise<SliceCandidateOutcome>;
  ```
  `runSliceForScan` keeps its exact current signature and return type, and is now `formation → finalization` with nothing in between.

**Why:** the spec runs coverage searches (step 9) **before** evaluation (step 11), because `coveragePassStatus` is an eligibility input. Today the slice evaluates with coverage pending, so every candidate picks up `coverage_pass_incomplete`. Splitting lets the workflow put the coverage stage in the gap. Re-evaluating after coverage instead would write the brief against a verdict about to change, and the brief's `Existing coverage` section would describe a check that had not run.

**Constraint:** `tests/integration/evidence-brief-vertical-slice.test.ts` and `internal.testing.seedSliceFixture` must keep working with **no edits**. If either needs changing, the split is wrong — fix the split.

- [ ] **Step 1: Run the existing slice tests and record the baseline**

```bash
npx vitest run tests/integration/evidence-brief-vertical-slice.test.ts
```

Expected: PASS. Note the count. That number must be identical at the end of this task.

- [ ] **Step 2: Write the failing test for the new split**

Append to `tests/integration/scan-workflow.test.ts`:

```ts
import { runCandidateFinalization, runCandidateFormation } from "../../convex/slice";

describe("slice split at the coverage boundary", () => {
  it("formation stops before evaluation, so coverage can run in between", async () => {
    const t = setup();
    const { scanId, sourceIds, model } = await seedSliceScan(t);

    const formed = await t.action(async (ctx) => runCandidateFormation(ctx, { scanId, sourceResultIds: sourceIds }, model));
    if (!formed.ok) throw new Error(formed.reason);

    expect(formed.candidates.length).toBeGreaterThan(0);
    const candidate = await t.run(async (ctx) => ctx.db.get(formed.candidates[0].candidateId));
    // Formation writes membership, judgment and the snapshot. It writes NO
    // verdict — status stays at its insert value until the rules run.
    expect(candidate?.status).toBe("processing");
    expect(candidate?.scoreTotal).toBeUndefined();
    expect(candidate?.exclusionReasons).toBeUndefined();
  });

  it("finalization writes the verdict and then the brief, in that order", async () => {
    const t = setup();
    const { scanId, sourceIds, model } = await seedSliceScan(t);
    const formed = await t.action(async (ctx) => runCandidateFormation(ctx, { scanId, sourceResultIds: sourceIds }, model));
    if (!formed.ok) throw new Error(formed.reason);

    const outcome = await t.action(async (ctx) =>
      runCandidateFinalization(ctx, { scanId, candidateId: formed.candidates[0].candidateId, now: NOW }, model),
    );

    expect(outcome.status).toMatch(/eligible|excluded/);
    const candidate = await t.run(async (ctx) => ctx.db.get(formed.candidates[0].candidateId));
    expect(candidate?.status).toBe(outcome.status);
    // The brief is generated against a settled verdict, never a provisional one.
    if (outcome.briefId) {
      const brief = await t.run(async (ctx) => ctx.db.get(outcome.briefId!));
      expect(brief?.version).toBe(1);
    }
  });
});
```

Add a `seedSliceScan` helper to the same file. **Copy it from `tests/integration/evidence-brief-vertical-slice.test.ts`** — that file already builds a scan, a search run, the four `SLICE_SOURCES` rows, and a `scriptedModel`. Do not invent a second fixture; item 7's near-miss was exactly that.

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run tests/integration/scan-workflow.test.ts
```

Expected: FAIL — `runCandidateFormation` is not exported.

- [ ] **Step 4: Split the function**

Rewrite `convex/slice.ts`. The body below is the committed code, cut in two — no behaviour changes inside either half:

```ts
export type FormedCandidate = {
  candidateId: Id<"candidates">;
  sourceResultIds: Id<"sourceResults">[];
  evidenceVersion: number | null;
  failures: string[];
};

export type FormationOutcome =
  | { ok: true; candidates: FormedCandidate[] }
  | { ok: false; reason: string; errors: string[] };

/**
 * Everything up to, but not including, the verdict.
 *
 * The cut is here because `spec.md > Data Flow` runs coverage searches (step 9)
 * BEFORE evaluation (step 11) — `coveragePassStatus` is an eligibility input.
 * The workflow puts the coverage stage in this gap. Evaluating first and
 * re-evaluating after would write the brief against a verdict about to change.
 */
export async function runCandidateFormation(
  ctx: ActionCtx,
  { scanId, sourceResultIds }: { scanId: Id<"scans">; sourceResultIds: Id<"sourceResults">[] },
  generate?: GenerateFn,
): Promise<FormationOutcome> {
  const signals = sourceResultIds.map((id) => ({ sourceResultId: id, entityKeys: [], claimSummary: "" }));
  const clustered = await runClusterSignals(ctx, { scanId, signals }, generate);
  if (!clustered.ok) return { ok: false, reason: clustered.reason, errors: clustered.errors };

  const candidates: FormedCandidate[] = [];

  for (const cluster of clustered.clusters) {
    const failures: string[] = [];

    const formed = await ctx.runMutation(internal.candidates.form.formFromCluster, {
      scanId,
      cluster,
      // The rules engine needs a beat to start from; the model's beat suggestion
      // arrives with classification a moment later and can move it.
      beat: "housing",
      workingTitle: cluster.similarityBasis.slice(0, 120),
    });
    if ("rejected" in formed) continue;
    const { candidateId } = formed;
    const memberIds = cluster.sourceResultIds as Id<"sourceResults">[];

    const classified = await runClassifyEvidence(ctx, { scanId, candidateId, sourceResultIds: memberIds }, generate);
    if (!classified.ok) {
      candidates.push({ candidateId, sourceResultIds: memberIds, evidenceVersion: null, failures: [`classify: ${classified.reason}`] });
      continue;
    }

    await ctx.runMutation(internal.candidates.judgment.saveJudgment, {
      candidateId,
      judgment: {
        localityBand: classified.judgment.localityBand,
        relevanceBand: classified.judgment.relevanceBand,
        beat: classified.judgment.beat,
        isSpeculative: classified.judgment.isSpeculative,
        isRoutineCrime: classified.judgment.isRoutineCrime,
        isDuplicateOfCandidate: classified.judgment.isDuplicateOfCandidate,
        hasMaterialConflict: classified.judgment.hasMaterialConflict,
      },
    });

    const snapshot = await ctx.runMutation(internal.candidates.snapshot.writeSnapshot, {
      scanId,
      candidateId,
      modelRunId: classified.modelRunId,
      items: classified.suggestions.items.map((i) => ({
        sourceResultIds: i.sourceResultIds,
        kind: i.kind,
        claimText: i.claimText,
        exactExcerpt: i.exactExcerpt,
        originalLanguageText: i.originalLanguageText,
        translatedText: i.translatedText,
      })),
    });
    const evidenceVersion = "evidenceVersion" in snapshot ? snapshot.evidenceVersion : null;
    if ("rejected" in snapshot) failures.push(`snapshot: ${snapshot.rejected}`);

    candidates.push({ candidateId, sourceResultIds: memberIds, evidenceVersion, failures });
  }

  return { ok: true, candidates };
}

/**
 * The verdict, then the brief. In that order, always.
 *
 * `evaluate` is the single writer of status, label and score. Nothing here
 * re-derives any of them; the brief is generated against what the rules decided.
 */
export async function runCandidateFinalization(
  ctx: ActionCtx,
  { scanId, candidateId, now = Date.now() }: { scanId: Id<"scans">; candidateId: Id<"candidates">; now?: number },
  generate?: GenerateFn,
): Promise<SliceCandidateOutcome> {
  const failures: string[] = [];

  const verdict = await ctx.runMutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now });
  if ("rejected" in verdict) {
    return {
      candidateId, status: "excluded", label: "Worth a look", scoreTotal: null,
      evidenceVersion: null, briefId: null, failures: [`evaluate: ${verdict.rejected}`],
    };
  }

  let briefId: Id<"briefVersions"> | null = null;
  const brief = await runGenerateBrief(ctx, { scanId, candidateId }, generate);
  if (brief.ok) briefId = brief.briefId;
  // "already_generated" means the identical brief exists; that is a success,
  // not a failure, and it deliberately costs no model call.
  else if (brief.reason !== "already_generated") failures.push(`brief: ${brief.reason}`);

  const candidate = await ctx.runQuery(internal.candidates.evaluate.getEvidenceVersion, { candidateId });

  return {
    candidateId,
    status: verdict.status,
    label: verdict.label,
    scoreTotal: verdict.scoreTotal,
    evidenceVersion: candidate?.latestEvidenceVersion ?? null,
    briefId,
    failures,
  };
}

/**
 * Formation then finalization, with nothing in between — the item 7 behaviour,
 * unchanged. The workflow does not call this; it calls the two halves with the
 * coverage stage between them. Kept because item 7's tests and
 * `internal.testing.seedSliceFixture` both depend on it.
 */
export async function runSliceForScan(
  ctx: ActionCtx,
  { scanId, sourceResultIds, now = Date.now() }: { scanId: Id<"scans">; sourceResultIds: Id<"sourceResults">[]; now?: number },
  generate?: GenerateFn,
): Promise<SliceOutcome> {
  const formed = await runCandidateFormation(ctx, { scanId, sourceResultIds }, generate);
  if (!formed.ok) return formed;

  const candidates: SliceCandidateOutcome[] = [];
  for (const c of formed.candidates) {
    const outcome = await runCandidateFinalization(ctx, { scanId, candidateId: c.candidateId, now }, generate);
    candidates.push({ ...outcome, evidenceVersion: c.evidenceVersion, failures: [...c.failures, ...outcome.failures] });
  }
  return { ok: true, candidates };
}
```

- [ ] **Step 5: Add the small read finalization needs**

Add to `convex/candidates/evaluate.ts`:

```ts
export const getEvidenceVersion = internalQuery({
  args: { candidateId: v.id("candidates") },
  returns: v.union(v.null(), v.object({ latestEvidenceVersion: v.number() })),
  handler: async (ctx, { candidateId }) => {
    const candidate = await ctx.db.get(candidateId);
    return candidate ? { latestEvidenceVersion: candidate.latestEvidenceVersion } : null;
  },
});
```

Add `internalQuery` to the `./_generated/server` import.

- [ ] **Step 6: Run BOTH suites**

```bash
npx vitest run tests/integration/evidence-brief-vertical-slice.test.ts tests/integration/scan-workflow.test.ts
npm run check
```

Expected: the item 7 file passes with **the same count as Step 1**, and the new tests pass. A changed count in the item 7 file means behaviour moved — go back and fix the split rather than the test.

- [ ] **Step 7: Prove the fixture still seeds**

```bash
set -a; . ./.env.local; set +a
npx convex dev --once
CLERK_ID=$(curl -s -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  "https://api.clerk.com/v1/users?email_address=$E2E_CLERK_EMAIL" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
npx convex run internal.testing.seedSliceFixture "{\"clerkUserId\":\"$CLERK_ID\"}"
npm run test:e2e
```

Expected: the fixture seeds and all 22 Playwright tests pass. The review lead is the product's shop window; a refactor that quietly breaks it is worse than no refactor.

- [ ] **Step 8: Commit**

```bash
git add convex/slice.ts convex/candidates/evaluate.ts tests/integration/scan-workflow.test.ts
git commit -m "refactor(slice): split formation from finalization so coverage runs between (MOO-734)"
```

---

## Task 6: The coverage stage — two partitions per candidate, and a partition that fails says so

**Files:**
- Create: `convex/stages/coverage.ts`
- Modify: `convex/schema.ts` (add `candidates.coveragePartitions`)
- Modify: `convex/candidates/evaluate.ts:78-83` (read real partitions instead of collapsing one status)
- Create: `tests/integration/partial-coverage.test.ts`

**Interfaces:**
- Consumes: `COVERAGE_TEMPLATE_IDS`, `getTemplate`, `renderQuery`; `COVERAGE_OUTLETS`, `REQUIRED_COVERAGE_GROUPS`, `outletGroupForDomain` (`convex/config/coverageOutlets.ts`); `COVERAGE_WINDOW_MS` (`convex/config/ruleset.ts`); `runExecuteSearch`; `internal.scans.getForWorkflow`.
- **Does NOT consume the prefilter.** This stage receives an already-ordered `candidateIds` list and executes. Deciding *who* gets the twenty reservations happens once, in Task 8's `selectForCoverage`. Two orderings could disagree; one cannot.
- Produces:
  ```ts
  export type CoverageStageOutcome = {
    checked: number;              // candidates whose BOTH partitions succeeded
    attempted: number;
    skippedForBudget: number;
    canceled: boolean;
  };
  export async function runCoverageStage(
    ctx: ActionCtx,
    args: { scanId: Id<"scans">; candidateIds: Id<"candidates">[]; now?: number },
    options?: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> },
  ): Promise<CoverageStageOutcome>;
  export const checkCoverage = internalAction({ args: { scanId, candidateIds }, returns: vCoverageStageOutcome });
  ```
- Also produces `internal.candidates.coverage.recordPartition` — `internalMutation({ args: { candidateId, group: v.union(v.literal("general"), v.literal("community")), status: v.union(v.literal("succeeded"), v.literal("failed")) } })`.

**The bug this task fixes, and it is a real one:** `convex/candidates/evaluate.ts:78-83` currently collapses both partitions into one value derived from `candidate.coveragePassStatus`:

```ts
const partition = candidate.coveragePassStatus === "complete" ? "succeeded" : ... ;
const coverage: CoverageInput = { partitions: { general: partition, community: partition }, reports: coverageReports };
```

That cannot represent "general succeeded, community failed" — the exact case the spec calls out, and the one where a scan would otherwise quietly claim a `Coverage gap` after checking only the big outlets. The candidate needs real per-partition state.

**Ordering constraint:** this stage runs **before** enrichment (Task 7). Required coverage capacity is reserved first. That is a spec requirement, not a preference.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/partial-coverage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { runCoverageStage } from "../../convex/stages/coverage";
import { asUser, setup } from "./helpers";

const NOW = 1_700_000_000_000;

// Reuse the item 7 fixture's shape rather than inventing a second one.
// See tests/integration/evidence-brief-vertical-slice.test.ts.
async function seedFormedCandidate(t: ReturnType<typeof setup>) { /* copy from the item 7 test */ }

const emptyResults = { search_metadata: { id: "x", status: "Success" }, organic_results: [] };

const jsOnlineResult = {
  search_metadata: { id: "y", status: "Success" },
  organic_results: [{
    position: 1,
    title: "Metcalfe Park hub clears commission",
    link: "https://www.jsonline.com/story/news/2026/08/17/metcalfe-park/",
    snippet: "The plan commission approved the project.",
    date: "Aug 17, 2026",
  }],
};

describe("coverage stage", () => {
  it("runs BOTH partitions for a candidate and marks the pass complete", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    await t.action(async (ctx) => runCoverageStage(ctx, { scanId, candidateIds: [candidateId], now: NOW }, {
      fetchImpl: (async () => new Response(JSON.stringify(emptyResults), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
      sleep: async () => {},
    }));

    const candidate = await t.run(async (ctx) => ctx.db.get(candidateId));
    expect(candidate?.coveragePartitions).toEqual({ general: "succeeded", community: "succeeded" });

    const runs = await t.run(async (ctx) =>
      ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId).eq("purpose", "coverage")).collect());
    // Two partitions, two reservations. The spec's arithmetic: 20 coverage
    // reservations means at most 10 candidates fully checked.
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.templateId).sort()).toEqual(["coverage-community-01", "coverage-general-01"]);
  });

  it("a failed community partition blocks Coverage gap but keeps the lead", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    const failCommunity = (async (input: RequestInfo | URL) => {
      const q = new URL(String(input)).searchParams.get("q") ?? "";
      if (q.includes("milwaukeenns.org")) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify(emptyResults), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await t.action(async (ctx) => runCoverageStage(ctx, { scanId, candidateIds: [candidateId], now: NOW }, { fetchImpl: failCommunity, sleep: async () => {} }));
    await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });

    const candidate = await t.run(async (ctx) => ctx.db.get(candidateId));
    expect(candidate?.coveragePartitions).toEqual({ general: "succeeded", community: "failed" });
    expect(candidate?.coveragePassStatus).toBe("failed");
    // Zero results from the general partition is NOT "nobody covered this" when
    // the community outlets were never reached. That claim is what this blocks.
    expect(candidate?.primaryLabel).not.toBe("Coverage gap");
    // But the lead survives. A failed coverage pass is not a reason to bin it.
    expect(candidate?.exclusionReasons).toContain("coverage_pass_incomplete");
  });

  it("a found report is attached as a coverage source and counted once per outlet", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    const found = (async (input: RequestInfo | URL) => {
      const q = new URL(String(input)).searchParams.get("q") ?? "";
      const body = q.includes("jsonline.com") ? jsOnlineResult : emptyResults;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await t.action(async (ctx) => runCoverageStage(ctx, { scanId, candidateIds: [candidateId], now: NOW }, { fetchImpl: found, sleep: async () => {} }));

    const memberships = await t.run(async (ctx) =>
      ctx.db.query("candidateSources").withIndex("by_candidate_role", (q) => q.eq("candidateId", candidateId).eq("role", "coverage")).collect());
    expect(memberships).toHaveLength(1);
    expect(memberships[0].addedBy).toBe("deterministic_rule");
  });

  it("stops before the next partition once cancellation is requested", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const outcome = await t.action(async (ctx) => runCoverageStage(ctx, { scanId, candidateIds: [candidateId], now: NOW }, {
      fetchImpl: (async () => new Response(JSON.stringify(emptyResults), { status: 200 })) as typeof fetch,
      sleep: async () => {},
    }));

    expect(outcome.canceled).toBe(true);
    const runs = await t.run(async (ctx) =>
      ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId).eq("purpose", "coverage")).collect());
    expect(runs).toHaveLength(0);
  });

  it("stops at the coverage allocation rather than eating the enrichment budget", async () => {
    const t = setup();
    const { scanId, candidateIds } = await seedManyFormedCandidates(t, 15);

    const outcome = await t.action(async (ctx) => runCoverageStage(ctx, { scanId, candidateIds, now: NOW }, {
      fetchImpl: (async () => new Response(JSON.stringify(emptyResults), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
      sleep: async () => {},
    }));

    const runs = await t.run(async (ctx) =>
      ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId).eq("purpose", "coverage")).collect());
    // SEARCH_BUDGET.coverage is 20, two per candidate: ten candidates, no more.
    expect(runs.length).toBeLessThanOrEqual(20);
    expect(outcome.checked).toBeLessThanOrEqual(10);
    expect(outcome.skippedForBudget).toBeGreaterThan(0);
  });
});
```

**Put `seedFormedCandidate` in `tests/integration/helpers.ts`, not in this file.** Tasks 7 and 8 both need it, and a fixture copied into three files drifts — that is the item 7 lesson. Build it from the item 7 test's existing seeder (`tests/integration/evidence-brief-vertical-slice.test.ts`), which already creates a scan, a search run, the four `SLICE_SOURCES` rows and a scripted model. Its signature:

```ts
export async function seedFormedCandidate(
  t: TestConvex<typeof schema>,
): Promise<{ scanId: Id<"scans">; candidateId: Id<"candidates">; model: GenerateFn }>;

export async function seedManyFormedCandidates(
  t: TestConvex<typeof schema>, count: number,
): Promise<{ scanId: Id<"scans">; candidateIds: Id<"candidates">[] }>;
```

`seedManyFormedCandidates` loops the single-candidate seeder with distinct fingerprints. Also export `seedSliceScan` from helpers if Task 5 defined it locally — same reason.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/integration/partial-coverage.test.ts
```

Expected: FAIL — cannot resolve `convex/stages/coverage`.

- [ ] **Step 3: Add real per-partition state to the schema**

In `convex/schema.ts`, inside `candidates: defineTable({ ... })`, directly after `coveragePassStatus`:

```ts
    coveragePassStatus: V.vCoveragePassStatus,
    // Per-partition, because "general succeeded, community failed" is a real
    // outcome the spec names and a single collapsed status cannot express.
    // A scan that checked only the big outlets must never claim a coverage gap.
    coveragePartitions: v.optional(v.object({
      general: V.vCoveragePartitionStatus,
      community: V.vCoveragePartitionStatus,
    })),
```

Add to `convex/lib/validators.ts`:

```ts
export const vCoveragePartitionStatus = v.union(v.literal("pending"), v.literal("succeeded"), v.literal("failed"));
```

- [ ] **Step 4: Make `evaluate` read the real partitions**

Replace `convex/candidates/evaluate.ts:78-83`:

```ts
    // Real per-partition state when the coverage stage has run. The fallback
    // maps an old row's single status onto both partitions so a candidate
    // written before this field existed still evaluates the same way.
    const fallback = candidate.coveragePassStatus === "complete" ? "succeeded"
      : candidate.coveragePassStatus === "failed" ? "failed" : "pending";
    const coverage: CoverageInput = {
      partitions: candidate.coveragePartitions ?? { general: fallback, community: fallback },
      reports: coverageReports,
    };
```

`coverageSummary` already derives `passStatus` from the partitions (`convex/editorial/coverage.ts:19`), and `evaluate` already writes `coveragePassStatus: verdict.coverage.passStatus`. So `evaluate` stays the single writer of `coveragePassStatus`, and the coverage stage only ever writes `coveragePartitions`. Do not let the stage write `coveragePassStatus`.

- [ ] **Step 5: Add the partition recorder**

Create `convex/candidates/coverage.ts`:

```ts
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import * as V from "../lib/validators";

/**
 * Records the outcome of ONE coverage partition.
 *
 * This is the only thing the coverage stage writes about coverage. It never
 * writes `coveragePassStatus` — `evaluate` derives that from these two values
 * through `coverageSummary`, so there stays exactly one writer of the verdict.
 */
export const recordPartition = internalMutation({
  args: {
    candidateId: v.id("candidates"),
    group: v.union(v.literal("general"), v.literal("community")),
    status: v.union(v.literal("succeeded"), v.literal("failed")),
  },
  returns: v.null(),
  handler: async (ctx, { candidateId, group, status }) => {
    const candidate = await ctx.db.get(candidateId);
    if (!candidate) return null;
    const current = candidate.coveragePartitions ?? { general: "pending" as const, community: "pending" as const };
    await ctx.db.patch(candidateId, { coveragePartitions: { ...current, [group]: status } });
    return null;
  },
});

/**
 * Attaches results from a coverage search to the candidate as `coverage`
 * sources.
 *
 * `addedBy: "deterministic_rule"` because nothing here is a model's opinion: a
 * result is coverage if its domain is in the frozen catalog and its date is
 * inside the 30-day window. Both are checked, here, before anything is written.
 */
export const attachReports = internalMutation({
  args: { scanId: v.id("scans"), candidateId: v.id("candidates"), searchRunId: v.id("searchRuns"), now: v.number() },
  returns: v.object({ attached: v.number() }),
  handler: async (ctx, { scanId, candidateId, searchRunId, now }) => {
    const candidate = await ctx.db.get(candidateId);
    if (!candidate) return { attached: 0 };

    const rows = await ctx.db
      .query("sourceResults")
      .withIndex("by_scan_canonical", (q) => q.eq("scanId", scanId))
      .collect();

    let attached = 0;
    for (const row of rows) {
      if (row.searchRunId !== searchRunId) continue;

      // Outside the 30-day window a story is not "prior coverage of this
      // development", it is a different story.
      if (row.publishedAt === undefined || now - row.publishedAt > COVERAGE_WINDOW_MS) continue;

      let group: "general" | "community" | null = null;
      try { group = outletGroupForDomain(new URL(row.canonicalUrl).hostname); } catch { group = null; }
      // Not in the frozen catalog is not coverage. The catalog is the claim.
      if (group === null) continue;

      const existing = await ctx.db
        .query("candidateSources")
        .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId).eq("scanId", scanId))
        .collect();
      if (existing.some((m) => m.sourceResultId === row._id)) continue;

      await ctx.db.insert("candidateSources", {
        candidateId, scanId, sourceResultId: row._id,
        role: "coverage",
        independenceGroup: defaultIndependenceGroup(row.canonicalUrl, row.publisher ?? null),
        signalCategory: signalCategoryFor(row.sourceFamily),
        addedBy: "deterministic_rule",
      });
      attached++;
    }
    return { attached };
  },
});
```

Import `COVERAGE_WINDOW_MS` from `../config/ruleset`, `outletGroupForDomain` from `../config/coverageOutlets`, and `defaultIndependenceGroup`/`signalCategoryFor` from `./toEngineSource`.

- [ ] **Step 6: Implement the coverage stage**

Create `convex/stages/coverage.ts`:

```ts
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import { SEARCH_BUDGET } from "../config/searchBudget";
import { REQUIRED_COVERAGE_GROUPS } from "../config/coverageOutlets";
import { MILWAUKEE_LOCATION, type SearchSpec } from "../integrations/serpapi/contracts";
import { runExecuteSearch } from "../integrations/serpapi/executeSearch";
import { getTemplate, renderQuery } from "../integrations/serpapi/queryCatalog";

export const vCoverageStageOutcome = v.object({
  checked: v.number(),
  attempted: v.number(),
  skippedForBudget: v.number(),
  canceled: v.boolean(),
});
export type CoverageStageOutcome = Infer<typeof vCoverageStageOutcome>;

const TEMPLATE_FOR_GROUP = { general: "coverage-general-01", community: "coverage-community-01" } as const;

type CoverageArgs = { scanId: Id<"scans">; candidateIds: Id<"candidates">[]; now?: number };
type CoverageOptions = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };

/**
 * Two searches per candidate: the general local-news outlets, then the
 * community and culturally specific ones.
 *
 * Both must succeed for the pass to be complete. Running only the first and
 * finding nothing is not "nobody covered this" — it is "we did not look where
 * the community outlets are", which is precisely the equity failure the
 * two-partition design exists to prevent.
 *
 * The 20-call coverage allocation is enforced here rather than left to the hard
 * cap, so a scan with 40 candidates cannot eat the enrichment budget.
 */
export async function runCoverageStage(
  ctx: ActionCtx,
  { scanId, candidateIds, now = Date.now() }: CoverageArgs,
  options: CoverageOptions = {},
): Promise<CoverageStageOutcome> {
  const outcome: CoverageStageOutcome = { checked: 0, attempted: 0, skippedForBudget: 0, canceled: false };
  let spent = 0;

  for (const candidateId of candidateIds) {
    // Both partitions or neither. Spending one reservation on a candidate we
    // cannot finish buys an unusable half-answer.
    if (spent + REQUIRED_COVERAGE_GROUPS.length > SEARCH_BUDGET.coverage) {
      outcome.skippedForBudget++;
      continue;
    }

    const terms = await ctx.runQuery(internal.candidates.coverage.termsFor, { candidateId });
    if (terms.length === 0) {
      outcome.skippedForBudget++;
      continue;
    }

    outcome.attempted++;
    let allSucceeded = true;

    for (const group of REQUIRED_COVERAGE_GROUPS) {
      const scan = await ctx.runQuery(internal.scans.getForWorkflow, { scanId });
      if (!scan || !scan.isActive || scan.isCancelRequested) {
        outcome.canceled = true;
        return outcome;
      }

      const template = getTemplate(TEMPLATE_FOR_GROUP[group]);
      if (!template) throw new Error(`coverage template missing from catalog: ${TEMPLATE_FOR_GROUP[group]}`);
      const spec: SearchSpec = {
        templateId: template.id,
        engine: template.engine,
        purpose: "coverage",
        query: renderQuery(template, { now, terms }),
        location: MILWAUKEE_LOCATION,
        language: template.language,
        timeWindow: template.timeWindow,
        candidateId: candidateId as string,
      };

      const result = await runExecuteSearch(ctx, { scanId, spec }, options);
      spent++;

      if (result.status === "succeeded" && result.runId) {
        await ctx.runMutation(internal.candidates.coverage.recordPartition, { candidateId, group, status: "succeeded" });
        await ctx.runMutation(internal.candidates.coverage.attachReports, {
          scanId, candidateId, searchRunId: result.runId, now,
        });
        await ctx.runMutation(internal.scans.recordSearchOutcome, { scanId, succeeded: 1, failed: 0 });
      } else if (result.status === "failed") {
        allSucceeded = false;
        await ctx.runMutation(internal.candidates.coverage.recordPartition, { candidateId, group, status: "failed" });
        await ctx.runMutation(internal.scans.recordSearchOutcome, { scanId, succeeded: 0, failed: 1 });
        await ctx.runMutation(internal.scans.recordFailure, {
          scanId, purpose: "coverage", code: "coverage_partition_failed",
          message: `the ${group} coverage partition failed; no coverage gap can be claimed`,
        });
      } else {
        // skipped: budget exhausted or the scan went inactive between checks.
        allSucceeded = false;
        outcome.skippedForBudget++;
      }
    }

    if (allSucceeded) outcome.checked++;
  }

  return outcome;
}

export const checkCoverage = internalAction({
  args: { scanId: v.id("scans"), candidateIds: v.array(v.id("candidates")) },
  returns: vCoverageStageOutcome,
  handler: (ctx, args): Promise<CoverageStageOutcome> => runCoverageStage(ctx, args),
});
```

- [ ] **Step 7: Add `internal.candidates.coverage.termsFor`**

Both coverage templates are `requiresTerms: true` and render `siteDisjunction(domains) + quoted(terms)`. The terms are the candidate's entity keys. Add to `convex/candidates/coverage.ts`:

```ts
/**
 * The quoted phrases a coverage search looks for.
 *
 * The candidate's own working title, trimmed. Entity keys would be better and
 * are what the fingerprint already stores — use `candidate.fingerprint`'s source
 * keys if `formFromCluster` persists them; otherwise the title is the honest
 * available answer and the query log shows exactly what ran either way.
 */
export const termsFor = internalQuery({
  args: { candidateId: v.id("candidates") },
  returns: v.array(v.string()),
  handler: async (ctx, { candidateId }) => {
    const candidate = await ctx.db.get(candidateId);
    if (!candidate) return [];
    const title = candidate.currentTitle.trim();
    return title.length === 0 ? [] : [title.slice(0, 80)];
  },
});
```

Before implementing, check whether `formFromCluster` persists the cluster's `entityKeys` anywhere on the candidate. If it does, use those instead of the title and say so in the comment — entity keys are what the spec means by the candidate's search terms.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npx vitest run tests/integration/partial-coverage.test.ts
npm run check
```

Expected: green, including the item 7 slice test — `evaluate`'s partition change must not move that lead's verdict, because its `coveragePassStatus` was and stays `pending`.

- [ ] **Step 9: Deploy and re-seed**

```bash
set -a; . ./.env.local; set +a
npx convex dev --once
npm run test:e2e
```

A schema addition needs a real deploy to prove the validator accepts existing rows.

- [ ] **Step 10: Commit**

```bash
git add convex/stages/coverage.ts convex/candidates/coverage.ts convex/candidates/evaluate.ts convex/schema.ts convex/lib/validators.ts tests/integration/partial-coverage.test.ts
git commit -m "feat(scan): two-partition coverage, and a failed partition blocks the gap label (MOO-734)"
```

---

## Task 7: Corroboration and conditional enrichment

**Files:**
- Create: `convex/stages/enrichment.ts`
- Test: `tests/integration/scan-workflow.test.ts` (append an `enrichment stage` describe block)

**Interfaces:**
- Consumes: `runPlanFollowUp` (`convex/ai/planFollowUp.ts`); `runExecuteSearch`; `SEARCH_BUDGET`; `internal.scans.getForWorkflow`, `.recordSearchOutcome`, `.recordFailure`.
- Produces:
  ```ts
  export type EnrichmentOutcome = {
    plannedFor: number;      // candidates the model was asked about
    accepted: number;        // intents the validator approved
    rejected: number;        // intents the validator refused — shown to the editor
    executed: number;
    canceled: boolean;
  };
  export async function runEnrichmentStage(
    ctx: ActionCtx,
    args: { scanId: Id<"scans">; candidateIds: Id<"candidates">[]; now?: number },
    options?: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> },
    generate?: GenerateFn,
  ): Promise<EnrichmentOutcome>;
  export const enrich = internalAction({ args: { scanId, candidateIds }, returns: vEnrichmentOutcome });
  ```

**The boundary this task demonstrates:** the model proposes searches; `validateSearchIntent` decides. Rejected intents are counted and returned, because an editor seeing what the model asked for and was refused is the proof the boundary exists. `runPlanFollowUp` already does the validation — this stage supplies the real remaining budget and executes only what came back `accepted`.

**Ordering:** runs **after** Task 6. Coverage reservations are already spent by the time an optional Maps or YouTube call is considered.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/scan-workflow.test.ts`:

```ts
import { runEnrichmentStage } from "../../convex/stages/enrichment";

const planAnswer = (intents: unknown[]) => ({ intents });

function planningModel(intents: unknown[]): GenerateFn {
  return async () => ({ object: planAnswer(intents), usage: { inputTokens: 10, outputTokens: 5 } });
}

describe("enrichment stage", () => {
  it("executes an intent the validator approved", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    const outcome = await t.action(async (ctx) => runEnrichmentStage(
      ctx, { scanId, candidateIds: [candidateId], now: NOW },
      { fetchImpl: fakeFetch(), sleep: async () => {} },
      planningModel([{ templateId: "corroborate-entity-01", purpose: "corroboration", reason: "confirm the approval", entityTerms: ["Metcalfe Park"] }]),
    ));

    expect(outcome.accepted).toBe(1);
    expect(outcome.executed).toBe(1);
    const runs = await t.run(async (ctx) =>
      ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId).eq("purpose", "corroboration")).collect());
    expect(runs).toHaveLength(1);
  });

  it("refuses an intent carrying operators and executes nothing", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    const outcome = await t.action(async (ctx) => runEnrichmentStage(
      ctx, { scanId, candidateIds: [candidateId], now: NOW },
      { fetchImpl: fakeFetch(), sleep: async () => {} },
      planningModel([{ templateId: "corroborate-entity-01", purpose: "corroboration", reason: "x", entityTerms: ["site:evil.example"] }]),
    ));

    // The model asked. The validator said no. Nothing was bought.
    expect(outcome.rejected).toBe(1);
    expect(outcome.executed).toBe(0);
  });

  it("refuses an unknown template id", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    const outcome = await t.action(async (ctx) => runEnrichmentStage(
      ctx, { scanId, candidateIds: [candidateId], now: NOW },
      { fetchImpl: fakeFetch(), sleep: async () => {} },
      planningModel([{ templateId: "invented-template-99", purpose: "corroboration", reason: "x", entityTerms: ["Metcalfe Park"] }]),
    ));

    expect(outcome.rejected).toBe(1);
    expect(outcome.executed).toBe(0);
  });

  it("passes the REAL remaining budget, so it cannot plan past the hard cap", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);
    // Push the scan to the ceiling before planning.
    await t.run(async (ctx) => ctx.db.patch(scanId, { searchesReserved: 120 }));

    const outcome = await t.action(async (ctx) => runEnrichmentStage(
      ctx, { scanId, candidateIds: [candidateId], now: NOW },
      { fetchImpl: fakeFetch(), sleep: async () => {} },
      planningModel([{ templateId: "corroborate-entity-01", purpose: "corroboration", reason: "x", entityTerms: ["Metcalfe Park"] }]),
    ));

    expect(outcome.executed).toBe(0);
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.searchesReserved).toBe(120);
  });

  it("stops before planning once cancellation is requested", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const outcome = await t.action(async (ctx) => runEnrichmentStage(
      ctx, { scanId, candidateIds: [candidateId], now: NOW },
      { fetchImpl: fakeFetch(), sleep: async () => {} },
      planningModel([{ templateId: "corroborate-entity-01", purpose: "corroboration", reason: "x", entityTerms: ["Metcalfe Park"] }]),
    ));

    expect(outcome.canceled).toBe(true);
    expect(outcome.plannedFor).toBe(0);
    // A model call is money too. Cancellation stops it before the boundary.
    const modelRuns = await t.run(async (ctx) => ctx.db.query("modelRuns").collect());
    expect(modelRuns).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/integration/scan-workflow.test.ts
```

Expected: FAIL — cannot resolve `convex/stages/enrichment`.

- [ ] **Step 3: Implement the enrichment stage**

Create `convex/stages/enrichment.ts`:

```ts
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import type { GenerateFn } from "../ai/provider";
import { runPlanFollowUp } from "../ai/planFollowUp";
import { SEARCH_BUDGET } from "../config/searchBudget";
import { runExecuteSearch } from "../integrations/serpapi/executeSearch";

export const vEnrichmentOutcome = v.object({
  plannedFor: v.number(),
  accepted: v.number(),
  rejected: v.number(),
  executed: v.number(),
  canceled: v.boolean(),
});
export type EnrichmentOutcome = Infer<typeof vEnrichmentOutcome>;

type EnrichmentArgs = { scanId: Id<"scans">; candidateIds: Id<"candidates">[]; now?: number };
type EnrichmentOptions = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };

/**
 * The model proposes searches. The validator decides.
 *
 * `runPlanFollowUp` already runs every intent through `validateSearchIntent`
 * and hands back both the accepted specs and the rejections. This stage's only
 * jobs are to supply the REAL remaining budget (so a model asking for six
 * corroborations when two are left gets two) and to execute what survived.
 *
 * Rejections are counted and returned rather than swallowed. An editor seeing
 * what the model asked for and was refused is the demonstration that the
 * boundary exists at all.
 */
export async function runEnrichmentStage(
  ctx: ActionCtx,
  { scanId, candidateIds, now = Date.now() }: EnrichmentArgs,
  options: EnrichmentOptions = {},
  generate?: GenerateFn,
): Promise<EnrichmentOutcome> {
  const outcome: EnrichmentOutcome = { plannedFor: 0, accepted: 0, rejected: 0, executed: 0, canceled: false };

  for (const candidateId of candidateIds) {
    // Checked BEFORE the model call. A model call costs money too, and the spec
    // says check cancellation before every external boundary — not just SerpApi.
    const scan = await ctx.runQuery(internal.scans.getForWorkflow, { scanId });
    if (!scan || !scan.isActive || scan.isCancelRequested) {
      outcome.canceled = true;
      return outcome;
    }
    if (scan.remaining <= 0) return outcome;

    const context = await ctx.runQuery(internal.stages.enrichment.planningContext, { scanId, candidateId });
    if (!context) continue;

    // The real ceiling, not the static allocation. `remaining` is what the hard
    // cap will actually permit, so a model can never plan past it.
    const remainingBudget = {
      discovery: 0,
      coverage: 0,
      corroboration: Math.min(SEARCH_BUDGET.corroboration, scan.remaining),
      enrichment: Math.min(SEARCH_BUDGET.enrichment, scan.remaining),
    };

    outcome.plannedFor++;
    const planned = await runPlanFollowUp(
      ctx,
      { scanId, candidateId, beat: context.beat, gaps: context.gaps, priorTemplateIds: context.priorTemplateIds, remainingBudget, now },
      generate,
    );
    if (!planned.ok) {
      await ctx.runMutation(internal.scans.recordFailure, {
        scanId, purpose: "enrichment", code: "plan_failed", message: planned.reason,
      });
      continue;
    }

    outcome.accepted += planned.accepted;
    outcome.rejected += planned.rejected;

    for (const intent of planned.intents) {
      if (!intent.accepted) continue;

      const before = await ctx.runQuery(internal.scans.getForWorkflow, { scanId });
      if (!before || !before.isActive || before.isCancelRequested) {
        outcome.canceled = true;
        return outcome;
      }

      const result = await runExecuteSearch(ctx, { scanId, spec: intent.spec }, options);
      if (result.status === "skipped") continue;

      outcome.executed++;
      if (result.status === "succeeded") {
        await ctx.runMutation(internal.scans.recordSearchOutcome, { scanId, succeeded: 1, failed: 0 });
      } else {
        await ctx.runMutation(internal.scans.recordSearchOutcome, { scanId, succeeded: 0, failed: 1 });
        await ctx.runMutation(internal.scans.recordFailure, {
          scanId, purpose: intent.spec.purpose, code: "search_failed",
          message: `${intent.spec.templateId} failed`,
        });
      }
    }
  }

  return outcome;
}

export const enrich = internalAction({
  args: { scanId: v.id("scans"), candidateIds: v.array(v.id("candidates")) },
  returns: vEnrichmentOutcome,
  handler: (ctx, args): Promise<EnrichmentOutcome> => runEnrichmentStage(ctx, args),
});
```

- [ ] **Step 4: Add the planning context query**

Add to `convex/stages/enrichment.ts`:

```ts
/**
 * What the planner needs to know, and nothing more.
 *
 * `gaps` are stated deterministically from what the evidence is missing — never
 * asked of a model. A model deciding what its own gaps are is a model choosing
 * what to buy.
 */
export const planningContext = internalQuery({
  args: { scanId: v.id("scans"), candidateId: v.id("candidates") },
  returns: v.union(v.null(), v.object({
    beat: v.union(v.literal("housing"), v.literal("transportation"), v.literal("culture"), v.null()),
    gaps: v.array(v.string()),
    priorTemplateIds: v.array(v.string()),
  })),
  handler: async (ctx, { scanId, candidateId }) => {
    const candidate = await ctx.db.get(candidateId);
    if (!candidate) return null;

    const memberships = await ctx.db
      .query("candidateSources")
      .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId).eq("scanId", scanId))
      .collect();
    const categories = new Set(memberships.map((m) => m.signalCategory));

    const gaps: string[] = [];
    if (!categories.has("official_record")) gaps.push("no official record names this project");
    if (!categories.has("original_news")) gaps.push("no local reporting confirms this yet");
    if (candidate.independentCategoryCount < 2) gaps.push("only one kind of source can confirm this");

    const runs = await ctx.db
      .query("searchRuns")
      .withIndex("by_candidate", (q) => q.eq("candidateId", candidateId))
      .collect();

    return {
      beat: (candidate.judgment?.beat?.value ?? null) as "housing" | "transportation" | "culture" | null,
      gaps,
      priorTemplateIds: [...new Set(runs.map((r) => r.templateId))],
    };
  },
});
```

Add `internalQuery` to the imports.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run tests/integration/scan-workflow.test.ts
npm run check
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add convex/stages/enrichment.ts tests/integration/scan-workflow.test.ts
git commit -m "feat(scan): corroboration and conditional enrichment inside the validator boundary (MOO-734)"
```

---

## Task 8: The workflow itself — 14 steps, four stages, one honest ending

**Files:**
- Modify: `convex/scanWorkflow.ts`
- Create: `convex/stages/finalize.ts`
- Test: `tests/integration/scan-workflow.test.ts` (append a `full lifecycle` describe block)
- Test: `tests/integration/cancellation.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–7, plus `runAnalyzeResults`, `runCandidateFormation`, `runCandidateFinalization`, `prefilterCandidate`, `orderForCoverage`.
- Produces:
  - `convex/stages/finalize.ts` — `runFinalizeStage(ctx, { scanId, candidateIds, now? }, generate?): Promise<{ eligible: number; excluded: number; canceled: boolean }>` and its `internalAction` wrapper `internal.stages.finalize.finalizeCandidates`.
  - `internal.stages.evidence.buildEvidence` — `internalAction` wrapping analyze + formation, returning `{ candidateIds, failures }`.
  - `internal.stages.evidence.selectForCoverage` — `internalQuery` returning the prefilter-ordered candidate ids and the skipped ones with their reasons.
  - The finished `internal.scanWorkflow.runScan`.

**The rule this task encodes:** the handler orchestrates. It contains no `if` that decides an editorial question, no arithmetic on a score, no string a user will read. Every one of those lives in a step, and the steps are already written and tested by Tasks 3–7.

- [ ] **Step 1: Write the failing lifecycle test**

Append to `tests/integration/scan-workflow.test.ts`:

```ts
describe("full lifecycle", () => {
  it("walks all four public stages and ends completed", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    // convex-test does not execute the workflow component, so the lifecycle is
    // driven here in the same order the handler drives it. What this proves is
    // the ORDER and the state transitions; Step 8 proves the real workflow runs.
    await t.mutation(internal.scans.setStage, { scanId, stage: "discovery" });
    await t.mutation(internal.scans.setStage, { scanId, stage: "evidence" });
    await t.mutation(internal.scans.setStage, { scanId, stage: "coverage" });
    await t.mutation(internal.scans.setStage, { scanId, stage: "briefs" });
    const { status } = await t.mutation(internal.scans.finalize, { scanId });

    expect(status).toBe("completed");
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.stage).toBe("briefs");
    // succeeded + failed can never exceed what was authorised.
    expect(scan!.searchesSucceeded + scan!.searchesFailed).toBeLessThanOrEqual(scan!.searchesReserved);
  });

  it("coverage is reserved before any enrichment search", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    await t.action(async (ctx) => runCoverageStage(ctx, { scanId, candidateIds: [candidateId], now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }));
    await t.action(async (ctx) => runEnrichmentStage(
      ctx, { scanId, candidateIds: [candidateId], now: NOW },
      { fetchImpl: fakeFetch(), sleep: async () => {} },
      planningModel([{ templateId: "corroborate-entity-01", purpose: "corroboration", reason: "x", entityTerms: ["Metcalfe Park"] }]),
    ));

    const runs = await t.run(async (ctx) =>
      ctx.db.query("searchRuns").withIndex("by_scan_status", (q) => q.eq("scanId", scanId)).collect());
    const firstCoverage = Math.min(...runs.filter((r) => r.purpose === "coverage").map((r) => r.reservedAt));
    const firstOptional = Math.min(...runs.filter((r) => r.purpose !== "coverage" && r.purpose !== "discovery").map((r) => r.reservedAt));
    // spec.md > Search budget: "Required coverage capacity is reserved before
    // optional Maps or YouTube enrichment."
    expect(firstCoverage).toBeLessThanOrEqual(firstOptional);
  });
});
```

- [ ] **Step 2: Write the failing cancellation test**

Create `tests/integration/cancellation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { runCoverageStage } from "../../convex/stages/coverage";
import { runDiscoveryStage } from "../../convex/stages/discovery";
import { asUser, setup } from "./helpers";

const NOW = 1_700_000_000_000;

describe("cancellation", () => {
  it("preserves work already completed", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }));
    const before = await t.run(async (ctx) => ctx.db.query("sourceResults").collect());

    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });
    const { status } = await t.mutation(internal.scans.finalize, { scanId });

    expect(status).toBe("canceled");
    const after = await t.run(async (ctx) => ctx.db.query("sourceResults").collect());
    // Cancelling stops the future. It never deletes the past — those searches
    // were paid for and an editor is entitled to what they bought.
    expect(after).toHaveLength(before.length);
  });

  it("stops new reservations the moment it is requested", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    // reserve refuses outright once cancelRequestedAt is set.
    const reserved = await t.mutation(internal.searchRuns.reserve, {
      scanId,
      spec: {
        templateId: "news-housing-en-01", engine: "google_news", purpose: "discovery",
        query: "Milwaukee housing when:7d", location: "Milwaukee, Wisconsin, United States",
        language: "en", timeWindow: "7d",
      },
    });
    expect(reserved).toEqual({ rejected: "scan_not_active" });
  });

  it("a cancelled scan can never be finalized as completed, even later", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    await t.mutation(internal.scans.finalize, { scanId });
    const second = await t.mutation(internal.scans.finalize, { scanId });
    expect(second.status).toBe("canceled");
  });
});
```

Import `seedUser` and `fakeFetch` from `tests/integration/helpers.ts` — Task 3 put them there. Do not copy them.

- [ ] **Step 3: Run both to verify they fail**

```bash
npx vitest run tests/integration/scan-workflow.test.ts tests/integration/cancellation.test.ts
```

Expected: FAIL on the missing helpers and stages.

- [ ] **Step 4: Create the evidence stage wrapper**

Create `convex/stages/evidence.ts`:

```ts
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internalAction, internalQuery } from "../_generated/server";
import type { GenerateFn } from "../ai/provider";
import { runAnalyzeResults } from "../ai/analyzeResults";
import { orderForCoverage, prefilterCandidate } from "../editorial/prefilter";
import { runCandidateFormation } from "../slice";

export const vEvidenceOutcome = v.object({
  candidateIds: v.array(v.id("candidates")),
  analyzed: v.boolean(),
  canceled: v.boolean(),
});
export type EvidenceOutcome = Infer<typeof vEvidenceOutcome>;

/**
 * Lifecycle steps 5–6 and 10: analyze the raw results, cluster them into
 * candidates, and write each candidate's evidence snapshot.
 *
 * It stops short of a verdict. `runCandidateFormation` is the half of the slice
 * that runs before coverage — see the comment on the split in `convex/slice.ts`.
 */
export async function runEvidenceStage(
  ctx: ActionCtx,
  { scanId, sourceResultIds }: { scanId: Id<"scans">; sourceResultIds: Id<"sourceResults">[] },
  generate?: GenerateFn,
): Promise<EvidenceOutcome> {
  const scan = await ctx.runQuery(internal.scans.getForWorkflow, { scanId });
  if (!scan || !scan.isActive || scan.isCancelRequested) {
    return { candidateIds: [], analyzed: false, canceled: true };
  }
  if (sourceResultIds.length === 0) return { candidateIds: [], analyzed: false, canceled: false };

  const analyzed = await runAnalyzeResults(ctx, { scanId, sourceResultIds }, generate);
  if (!analyzed.ok) {
    await ctx.runMutation(internal.scans.recordFailure, {
      scanId, purpose: "discovery", code: "analyze_failed", message: analyzed.reason,
    });
    // Analysis adds translation and source-type suggestions. Without it the
    // clusters are thinner, but the sources are real and the scan continues.
  }

  const formed = await runCandidateFormation(ctx, { scanId, sourceResultIds }, generate);
  if (!formed.ok) {
    await ctx.runMutation(internal.scans.recordFailure, {
      scanId, purpose: "discovery", code: "cluster_failed", message: formed.reason,
    });
    return { candidateIds: [], analyzed: analyzed.ok, canceled: false };
  }

  return { candidateIds: formed.candidates.map((c) => c.candidateId), analyzed: analyzed.ok, canceled: false };
}

export const buildEvidence = internalAction({
  args: { scanId: v.id("scans"), sourceResultIds: v.array(v.id("sourceResults")) },
  returns: vEvidenceOutcome,
  handler: (ctx, args): Promise<EvidenceOutcome> => runEvidenceStage(ctx, args),
});

/**
 * Lifecycle step 7 — who gets the twenty coverage reservations.
 *
 * A query, not an action: it reads state and applies a pure function. The
 * skipped list travels with its reasons so the scan can say why a candidate
 * was never coverage-checked, rather than leaving a silent hole.
 */
export const selectForCoverage = internalQuery({
  args: { scanId: v.id("scans"), candidateIds: v.array(v.id("candidates")), now: v.number() },
  returns: v.object({
    ordered: v.array(v.id("candidates")),
    skipped: v.array(v.object({ candidateId: v.id("candidates"), reasons: v.array(v.string()) })),
  }),
  handler: async (ctx, { scanId, candidateIds, now }) => {
    const verdicts = [];
    const skipped = [];

    for (const candidateId of candidateIds) {
      const candidate = await ctx.db.get(candidateId);
      if (!candidate?.judgment) continue;

      const memberships = await ctx.db
        .query("candidateSources")
        .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId).eq("scanId", scanId))
        .collect();
      const confirming = new Set(
        memberships
          .filter((m) => m.role === "initiating" || m.role === "corroborating")
          .filter((m) => CONFIRMING_CATEGORIES.has(m.signalCategory))
          .map((m) => m.signalCategory),
      );

      let initiatingSignalAt = now;
      for (const m of memberships) {
        if (m.role !== "initiating") continue;
        const row = await ctx.db.get(m.sourceResultId);
        if (row?.publishedAt !== undefined) initiatingSignalAt = row.publishedAt;
      }

      const verdict = prefilterCandidate({
        candidateId: candidateId as string,
        localityBand: (candidate.judgment.localityBand?.value ?? "none") as never,
        relevanceBand: (candidate.judgment.relevanceBand?.value ?? "promotion_only") as never,
        beat: (candidate.judgment.beat?.value ?? null) as never,
        initiatingSignalAt,
        now,
        isDuplicateOfCandidate: candidate.judgment.isDuplicateOfCandidate.value,
        isSpeculative: candidate.judgment.isSpeculative.value,
        isRoutineCrime: candidate.judgment.isRoutineCrime.value,
        confirmingCategoryCount: confirming.size,
      });

      verdicts.push({ candidateId: candidateId as string, verdict });
      if (!verdict.worthCoverage) skipped.push({ candidateId, reasons: verdict.reasons });
    }

    return {
      ordered: orderForCoverage(verdicts) as Id<"candidates">[],
      skipped,
    };
  },
});
```

Import `CONFIRMING_CATEGORIES` from `../editorial/types`.

- [ ] **Step 5: Create the finalize stage**

Create `convex/stages/finalize.ts`:

```ts
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import type { GenerateFn } from "../ai/provider";
import { runCandidateFinalization } from "../slice";

export const vFinalizeOutcome = v.object({
  eligible: v.number(),
  excluded: v.number(),
  canceled: v.boolean(),
});
export type FinalizeOutcome = Infer<typeof vFinalizeOutcome>;

/**
 * Lifecycle steps 11–13, per candidate: the rules decide, then the brief is
 * written for whatever survived.
 *
 * Counts are pushed to the scan as they land, not at the end. A candidate whose
 * work is finished may appear in the feed while the scan is still running, which
 * is what `spec.md > UI Behavior` asks for; the feed stays marked incomplete
 * until the scan reaches a terminal state.
 */
export async function runFinalizeStage(
  ctx: ActionCtx,
  { scanId, candidateIds, now = Date.now() }: { scanId: Id<"scans">; candidateIds: Id<"candidates">[]; now?: number },
  generate?: GenerateFn,
): Promise<FinalizeOutcome> {
  let eligible = 0;
  let excluded = 0;

  for (const [index, candidateId] of candidateIds.entries()) {
    const scan = await ctx.runQuery(internal.scans.getForWorkflow, { scanId });
    if (!scan || !scan.isActive || scan.isCancelRequested) {
      await ctx.runMutation(internal.scans.setCandidateCounts, {
        scanId, eligibleCount: eligible, excludedCount: excluded,
        processingCount: candidateIds.length - index,
      });
      return { eligible, excluded, canceled: true };
    }

    const outcome = await runCandidateFinalization(ctx, { scanId, candidateId, now }, generate);
    if (outcome.status === "eligible") eligible++;
    else excluded++;

    for (const failure of outcome.failures) {
      await ctx.runMutation(internal.scans.recordFailure, {
        scanId, purpose: "enrichment", code: "candidate_step_failed", message: failure,
      });
    }

    await ctx.runMutation(internal.scans.setCandidateCounts, {
      scanId, eligibleCount: eligible, excludedCount: excluded,
      processingCount: candidateIds.length - (index + 1),
    });
  }

  return { eligible, excluded, canceled: false };
}

export const finalizeCandidates = internalAction({
  args: { scanId: v.id("scans"), candidateIds: v.array(v.id("candidates")) },
  returns: vFinalizeOutcome,
  handler: (ctx, args): Promise<FinalizeOutcome> => runFinalizeStage(ctx, args),
});
```

- [ ] **Step 6: Write the workflow handler**

Replace `convex/scanWorkflow.ts`:

```ts
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { workflow } from "./workflow";

/**
 * The scan's durable spine — `spec.md > Data Flow > Critical scan lifecycle`,
 * steps 1 through 14.
 *
 * It orchestrates and NOTHING else. There is no `if` here that decides an
 * editorial question, no arithmetic on a score, and no string a user will read.
 * Every one of those lives in a step, written and tested on its own.
 *
 * The handler replays from the top whenever a step completes, so it must stay
 * deterministic: no `fetch`, no `process.env`, no unseeded randomness. The
 * component blocks those; this comment is here so nobody spends an hour on it.
 *
 * Cancellation is not checked here — each step checks it immediately before its
 * own external boundary and returns `canceled: true`, which is both more precise
 * and the only way to stop mid-stage.
 */
export const runScan = workflow.define({
  args: { scanId: v.id("scans") },
  returns: v.null(),
}).handler(async (step, { scanId }): Promise<null> => {
  // ── Stage 1 of 4: Discovering signals ──────────────────────────────────
  await step.runMutation(internal.scans.setStage, { scanId, stage: "discovery" });
  const discovery = await step.runAction(internal.stages.discovery.discover, { scanId });
  if (discovery.canceled) {
    await step.runMutation(internal.scans.finalize, { scanId });
    return null;
  }

  // ── Stage 2 of 4: Checking local evidence ─────────────────────────────
  await step.runMutation(internal.scans.setStage, { scanId, stage: "evidence" });
  const evidence = await step.runAction(internal.stages.evidence.buildEvidence, {
    scanId, sourceResultIds: discovery.sourceResultIds,
  });
  if (evidence.canceled) {
    await step.runMutation(internal.scans.finalize, { scanId });
    return null;
  }

  // ── Stage 3 of 4: Reviewing existing coverage ─────────────────────────
  // Coverage before enrichment, always: `spec.md > Search budget` requires the
  // required coverage capacity to be reserved before optional Maps or YouTube.
  await step.runMutation(internal.scans.setStage, { scanId, stage: "coverage" });
  const selection = await step.runQuery(internal.stages.evidence.selectForCoverage, {
    scanId, candidateIds: evidence.candidateIds, now: Date.now(),
  });
  const coverage = await step.runAction(internal.stages.coverage.checkCoverage, {
    scanId, candidateIds: selection.ordered,
  });
  if (coverage.canceled) {
    await step.runMutation(internal.scans.finalize, { scanId });
    return null;
  }

  const enrichment = await step.runAction(internal.stages.enrichment.enrich, {
    scanId, candidateIds: selection.ordered,
  });
  if (enrichment.canceled) {
    await step.runMutation(internal.scans.finalize, { scanId });
    return null;
  }

  // ── Stage 4 of 4: Preparing leads ─────────────────────────────────────
  // Every candidate is evaluated, including the ones the prefilter skipped.
  // A skipped candidate is not deleted — it is excluded with its reasons shown,
  // which is what an editor needs to overrule it.
  await step.runMutation(internal.scans.setStage, { scanId, stage: "briefs" });
  await step.runAction(internal.stages.finalize.finalizeCandidates, {
    scanId, candidateIds: evidence.candidateIds,
  });

  await step.runMutation(internal.scans.finalize, { scanId });
  return null;
});
```

`Date.now()` inside the handler is safe — the workflow component patches `Date` so a replay returns the same value it did on the first pass. That is exactly why the prefilter's `now` is passed in rather than read inside the query.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx vitest run tests/integration/scan-workflow.test.ts tests/integration/cancellation.test.ts
npm run check
```

Expected: green.

- [ ] **Step 8: Prove the real workflow runs — `convex-test` cannot**

`convex-test` does not execute the workflow component. The tests above prove the steps and the order; only a deployment proves the workflow. Say so plainly rather than claiming coverage you do not have.

```bash
set -a; . ./.env.local; set +a
npx convex dev --once
npm run dev            # leave running in another terminal
```

Then, signed in, press **Run first scan** in the workspace and watch the dashboard:

```bash
npx convex logs
```

Expected in the logs: `setStage discovery` → `discover` → `setStage evidence` → … → `finalize`. Expected in the dashboard's `scans` table: `stage` advances, `searchesReserved` climbs to about 13 plus coverage, `status` ends `completed` or `partial`.

**This will spend real SerpApi searches.** Budget: ~983 remaining on Starter; one scan may use up to 120. Run it **once**, and only when the rest of the task is green.

- [ ] **Step 9: Commit**

```bash
git add convex/scanWorkflow.ts convex/stages/evidence.ts convex/stages/finalize.ts tests/integration/scan-workflow.test.ts tests/integration/cancellation.test.ts tests/integration/helpers.ts
git commit -m "feat(scan): the durable workflow runs all four stages end to end (MOO-734)"
```

---

## Task 9: The scan progress panel — four stages an editor can read

**Files:**
- Create: `src/components/scan/scan-progress.tsx`
- Modify: `src/app/workspace/page.tsx:33-52`
- Create: `tests/e2e/scan-progress.spec.ts`

**Interfaces:**
- Consumes: `api.scans.get` and `api.scans.list` (both already exist and already return `stage`, `status`, counts, `failureSummaries`, budget); `STAGE_TEXT` and `PRODUCT_LABELS` from `src/lib/source-labels.ts`; `StatusLabel` from `src/components/ui/editorial/status-label.tsx`.
- Produces: `export function ScanProgress({ scan }: { scan: NonNullable<FunctionReturnType<typeof api.scans.get>> })`.

**What it must show**, from `spec.md > UI Behavior > Workspace and live scan`:
- All four stages, each as pending / active / completed / failed.
- Search and API usage.
- Eligible, excluded and processing counts — always all three.
- Cancellation.
- On complete-with-failures, the `Incomplete scan` label plus the affected purposes and what they cost.

**Non-negotiable:** status must be readable **without colour**. Every state carries visible text.

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/scan-progress.spec.ts`:

```ts
import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { signInOnly } from "./helpers/auth";

/**
 * The scan progress panel, against a seeded scan in a known state. No live
 * SerpApi call: what is under test is the rendering, not the network.
 */
async function clerkUserId(): Promise<string> {
  const email = process.env.E2E_CLERK_EMAIL;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!email || !secretKey) throw new Error("Set E2E_CLERK_EMAIL and CLERK_SECRET_KEY");
  const res = await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const users = (await res.json()) as Array<{ id: string }>;
  if (!users[0]?.id) throw new Error("No Clerk user found for E2E_CLERK_EMAIL");
  return users[0].id;
}

function seed(stage: string, status: string, withFailure = false) {
  const userId = process.env.__CLERK_ID__!;
  execSync(`npx convex run internal.testing.seedScanInState '${JSON.stringify({ clerkUserId: userId, stage, status, withFailure })}'`, { encoding: "utf8" });
}

test.beforeAll(async () => { process.env.__CLERK_ID__ = await clerkUserId(); });

test.afterAll(async () => {
  execSync(`npx convex run internal.testing.deleteScansForClerkUser '${JSON.stringify({ clerkUserId: process.env.__CLERK_ID__ })}'`, { encoding: "utf8" });
});

test.describe("scan progress", () => {
  test("names all four stages in order, always", async ({ page }) => {
    seed("coverage", "running");
    await signInOnly(page);
    await page.goto("/workspace");

    const panel = page.getByRole("region", { name: "Scan progress" });
    await expect(panel).toBeVisible();
    // All four, always — a stage that has not started yet is information, not
    // clutter. An editor needs to know what is still coming.
    for (const text of ["Discovering signals", "Checking local evidence", "Reviewing existing coverage", "Preparing leads"]) {
      await expect(panel.getByText(text, { exact: true })).toBeVisible();
    }
  });

  test("each stage's state is readable without colour", async ({ page }) => {
    seed("coverage", "running");
    await signInOnly(page);
    await page.goto("/workspace");

    const panel = page.getByRole("region", { name: "Scan progress" });
    await expect(panel.getByText("Done").first()).toBeVisible();      // discovery, evidence
    await expect(panel.getByText("Working")).toBeVisible();            // coverage
    await expect(panel.getByText("Not started").first()).toBeVisible(); // briefs
  });

  test("shows all three counts even when two of them are zero", async ({ page }) => {
    seed("briefs", "running");
    await signInOnly(page);
    await page.goto("/workspace");

    const panel = page.getByRole("region", { name: "Scan progress" });
    await expect(panel.getByText(/\d+ ready/)).toBeVisible();
    await expect(panel.getByText(/\d+ did not qualify/)).toBeVisible();
    await expect(panel.getByText(/\d+ still working/)).toBeVisible();
  });

  test("shows search usage against the ceiling", async ({ page }) => {
    seed("coverage", "running");
    await signInOnly(page);
    await page.goto("/workspace");
    await expect(page.getByText(/of 120 searches/)).toBeVisible();
  });

  test("a scan that finished with failures says Incomplete scan and names the purpose", async ({ page }) => {
    seed("briefs", "partial", true);
    await signInOnly(page);
    await page.goto("/workspace");

    const panel = page.getByRole("region", { name: "Scan progress" });
    await expect(panel.getByText("Incomplete scan")).toBeVisible();
    // Naming the purpose is what turns a warning into something actionable.
    await expect(panel.getByText(/coverage/i)).toBeVisible();
  });

  test("a cancelled scan says Stopped early and offers no cancel button", async ({ page }) => {
    seed("evidence", "canceled");
    await signInOnly(page);
    await page.goto("/workspace");

    const panel = page.getByRole("region", { name: "Scan progress" });
    await expect(panel.getByText("Stopped early")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Cancel scan" })).toHaveCount(0);
  });

  test("a running scan offers cancel, and cancelling changes the state", async ({ page }) => {
    seed("discovery", "running");
    await signInOnly(page);
    await page.goto("/workspace");

    await page.getByRole("button", { name: "Cancel scan" }).click();
    await expect(page.getByText("Stopped early")).toBeVisible();
  });

  test("no horizontal overflow at 375px", async ({ page }) => {
    seed("coverage", "running");
    await signInOnly(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/workspace");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
});
```

- [ ] **Step 2: Add the state seeder**

Add to `convex/testing.ts`, beside `seedSliceFixture`:

```ts
/**
 * One scan parked in a named state, for rendering tests.
 *
 * Deliberately NOT a second copy of `seedSliceFixture`. That one builds a real
 * lead from captured payloads and is demo material; this one exists only to put
 * the progress panel into a state, and creates no candidates at all.
 */
export const seedScanInState = internalMutation({
  args: {
    clerkUserId: v.string(),
    stage: V.vStage,
    status: V.vScanStatus,
    withFailure: v.optional(v.boolean()),
  },
  returns: v.object({ scanId: v.id("scans") }),
  handler: async (ctx, { clerkUserId, stage, status, withFailure = false }) => {
    const user = await ctx.db.query("users").withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId)).unique();
    if (!user) throw new Error("Seed the Clerk user first");

    for (const existing of await ctx.db.query("scans").withIndex("by_owner_started", (q) => q.eq("ownerId", user._id)).collect()) {
      await ctx.db.delete(existing._id);
    }

    const now = Date.now();
    const scanId = await ctx.db.insert("scans", {
      ownerId: user._id,
      marketKey: MARKET_KEY, rulesetVersion: RULESET_VERSION, queryCatalogVersion: QUERY_CATALOG_VERSION,
      status, stage, startedAt: now - 60_000,
      completedAt: status === "running" || status === "queued" ? undefined : now,
      cancelRequestedAt: status === "canceled" ? now - 1_000 : undefined,
      searchBudgetLimit: SEARCH_BUDGET.hardCap,
      searchesReserved: 27, searchesSucceeded: 25, searchesFailed: 2,
      eligibleCount: 3, excludedCount: 5, processingCount: status === "running" ? 2 : 0,
      failureSummaries: withFailure
        ? [{ purpose: "coverage" as const, code: "coverage_partition_failed", message: "the community coverage partition failed; no coverage gap can be claimed" }]
        : [],
      isSavedDemo: false,
    });
    return { scanId };
  },
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
set -a; . ./.env.local; set +a
npx convex dev --once
npm run test:e2e -- tests/e2e/scan-progress.spec.ts
```

Expected: FAIL — no `Scan progress` region on the page.

- [ ] **Step 4: Build the component**

Create `src/components/scan/scan-progress.tsx`:

```tsx
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import { StatusLabel } from "@/components/ui/editorial/status-label";
import { PRODUCT_LABELS, STAGE_TEXT, type Stage } from "@/lib/source-labels";

type Scan = NonNullable<FunctionReturnType<typeof api.scans.get>>;

const STAGE_ORDER: Stage[] = ["discovery", "evidence", "coverage", "briefs"];

// Visible words, not colours. A status an editor can only see if they can
// distinguish two shades of amber is a status half the newsroom cannot read.
const STATE_TEXT = {
  done: "Done",
  active: "Working",
  pending: "Not started",
  stopped: "Stopped",
} as const;

function stageState(stage: Stage, scan: Scan): keyof typeof STATE_TEXT {
  const current = STAGE_ORDER.indexOf(scan.stage as Stage);
  const index = STAGE_ORDER.indexOf(stage);
  const isTerminal = scan.status === "completed" || scan.status === "partial" || scan.status === "canceled";

  if (index < current) return "done";
  if (index > current) return scan.status === "canceled" ? "stopped" : "pending";
  // The current stage: finished if the scan finished, stopped if it was ended.
  if (scan.status === "canceled") return "stopped";
  return isTerminal ? "done" : "active";
}

/**
 * What the scan is doing, in the four names the product uses everywhere else.
 *
 * A server component: nothing here is interactive except the cancel button,
 * which is its own small client island in the workspace page.
 */
export function ScanProgress({ scan, onCancel }: { scan: Scan; onCancel?: () => void }) {
  const terminalLabel =
    scan.status === "canceled" ? PRODUCT_LABELS.canceled
      : scan.status === "partial" ? PRODUCT_LABELS.partial
        : null;

  return (
    <section aria-labelledby="scan-progress-heading" className="border-t border-rule pt-5">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 id="scan-progress-heading" className="font-editorial text-xl">Scan progress</h2>
        {terminalLabel && <StatusLabel label={terminalLabel} />}
      </div>

      <ol className="mt-3.5">
        {STAGE_ORDER.map((stage) => (
          <li key={stage} className="grid grid-cols-[1fr_auto] gap-4 border-t border-rule py-2.5 last:border-b">
            <span className="text-sm">{STAGE_TEXT[stage]}</span>
            <span className="text-xs uppercase tracking-wide text-muted">{STATE_TEXT[stageState(stage, scan)]}</span>
          </li>
        ))}
      </ol>

      {/* All three counts, always. Two zeroes and a number is information; one
          number on its own is a number an editor cannot place. */}
      <p className="mt-3 text-sm text-muted">
        <strong className="font-semibold text-ink">{scan.eligibleCount}</strong> ready
        {" · "}
        <strong className="font-semibold text-ink">{scan.excludedCount}</strong> did not qualify
        {" · "}
        <strong className="font-semibold text-ink">{scan.processingCount}</strong> still working
      </p>

      <p className="mt-1 text-sm text-muted">
        {scan.searchesReserved} of {scan.searchBudgetLimit} searches used
        {scan.searchesFailed > 0 && ` · ${scan.searchesFailed} failed`}
      </p>

      {scan.failureSummaries.length > 0 && (
        <ul className="mt-3">
          {scan.failureSummaries.map((failure) => (
            <li key={`${failure.purpose}:${failure.code}`} className="border-t border-rule py-2 text-sm">
              <span className="text-xs uppercase tracking-wide text-muted">{failure.purpose}</span>
              <span className="mt-0.5 block">{failure.message}</span>
            </li>
          ))}
        </ul>
      )}

      {onCancel && scan.status !== "completed" && scan.status !== "partial" && scan.status !== "canceled" && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-4 rounded-sm border border-rule px-3 py-1.5 font-ui text-sm"
        >
          Cancel scan
        </button>
      )}
    </section>
  );
}
```

Before writing, check `src/components/ui/untitled/` for an existing button primitive and use it rather than a bare `<button>`. Search first; the project rule is that Untitled UI is the sole primitive foundation. If a suitable primitive exists, use it and delete the hand-rolled classes.

- [ ] **Step 5: Render it in the workspace**

In `src/app/workspace/page.tsx`, replace the `Latest scan` section:

```tsx
        ) : (
          <section aria-labelledby="latest-scan">
            <h1 id="latest-scan" className="font-editorial text-3xl">Latest scan</h1>
            <ScanProgress
              scan={scans.page[0]}
              onCancel={() => { void cancelScan({ scanId: scans.page[0]._id }); }}
            />
          </section>
        )}
```

Add near the other hooks:

```tsx
  const cancelScan = useMutation(api.scans.cancel);
```

and the import:

```tsx
import { ScanProgress } from "@/components/scan/scan-progress";
```

- [ ] **Step 6: Run the e2e test to verify it passes**

```bash
set -a; . ./.env.local; set +a
npx convex dev --once
npm run test:e2e
```

Expected: the new spec passes and the existing 22 still pass.

- [ ] **Step 7: LOOK AT IT — reading is not verifying**

Seed one scan and open it in a browser:

```bash
CLERK_ID=$(curl -s -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  "https://api.clerk.com/v1/users?email_address=$E2E_CLERK_EMAIL" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
npx convex run internal.testing.seedScanInState "{\"clerkUserId\":\"$CLERK_ID\",\"stage\":\"coverage\",\"status\":\"running\",\"withFailure\":true}"
npm run dev
# open http://localhost:3000/workspace
```

Check by eye, all five: light mode, dark mode, keyboard focus on the cancel button, 375px width, and that every state is legible with the page in greyscale. Item 7 found five defects this way that 352 green tests never would.

- [ ] **Step 8: Commit**

```bash
git add src/components/scan/scan-progress.tsx src/app/workspace/page.tsx convex/testing.ts tests/e2e/scan-progress.spec.ts
git commit -m "feat(ui): the four-stage scan progress panel (MOO-734)"
```

---

## Task 10: Budget accounting under load, and the honest claim about it

**Files:**
- Create: `tests/integration/search-budget-concurrency.test.ts`
- Modify: `docs/hackathon-build/checklist.md` (tick item 8)
- Modify: `docs/LEARNING-LOG.md`

**Interfaces:** consumes everything above. Produces no new code.

**The honesty rule this task exists to protect:** `convex-test` takes a mutex per top-level transaction, so an in-process 20-way test **never interleaves and proves nothing about production**. Item 5 already proved the real thing with `tests/live/reserve-concurrency.test.ts` — 20 separate `npx convex run` processes against the real deployment: granted=5, rejected=15, reserved=120, from a scan seeded at 115, zero SerpApi calls.

So this file makes the **smaller, true claim**: the arithmetic is right and the allocations are respected. It must say so in a comment, and the Linear evidence comment must say so too. Do not restate item 5's concurrency proof as if this file produced it.

- [ ] **Step 1: Write the test**

Create `tests/integration/search-budget-concurrency.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { SEARCH_BUDGET } from "../../convex/config/searchBudget";
import { runDiscoveryStage } from "../../convex/stages/discovery";
import { asUser, fakeFetch, seedUser, setup } from "./helpers";

const NOW = 1_700_000_000_000;

/**
 * WHAT THIS FILE PROVES, AND WHAT IT DOES NOT.
 *
 * Proves: the reservation arithmetic is correct, allocations are respected, the
 * hard cap refuses the 121st, and counters stay consistent.
 *
 * Does NOT prove anything about concurrency. `convex-test` takes a mutex per
 * top-level transaction, so calls here never interleave. The real proof lives
 * in `tests/live/reserve-concurrency.test.ts`, which spawns 20 separate
 * `npx convex run` processes against the deployment. Do not quote this file as
 * evidence for the concurrency claim.
 */
describe("search budget accounting", () => {
  it("refuses the 121st reservation", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await t.run(async (ctx) => ctx.db.patch(scanId, { searchesReserved: SEARCH_BUDGET.hardCap }));

    const rejected = await t.mutation(internal.searchRuns.reserve, {
      scanId,
      spec: {
        templateId: "news-housing-en-01", engine: "google_news", purpose: "discovery",
        query: "Milwaukee housing when:7d", location: "Milwaukee, Wisconsin, United States",
        language: "en", timeWindow: "7d",
      },
    });
    expect(rejected).toEqual({ rejected: "budget_exhausted" });
  });

  it("a re-opened failed run counts as a NEW authorized attempt", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const failing = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: failing, sleep: async () => {} }));
    const afterFirst = await t.run(async (ctx) => ctx.db.get(scanId));

    await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }));
    const afterRetry = await t.run(async (ctx) => ctx.db.get(scanId));

    // The row is reused, so `reserved` does not climb — but `searchesFailed`
    // NEVER decrements. It is a cumulative count of failed attempts, not a live
    // gauge, and decrementing it makes succeeded + failed + in-flight ==
    // reserved impossible to hold.
    expect(afterRetry!.searchesFailed).toBeGreaterThanOrEqual(afterFirst!.searchesFailed);
  });

  it("succeeded plus failed never exceeds what was authorized", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }));

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan!.searchesSucceeded + scan!.searchesFailed).toBeLessThanOrEqual(scan!.searchesReserved);
  });

  it("the allocations sum to the hard cap", () => {
    const { discovery, coverage, corroboration, enrichment, reserve, hardCap } = SEARCH_BUDGET;
    // spec.md > Search budget. If this ever fails, the spec table and the code
    // have drifted and one of them is lying to an editor about what a scan costs.
    expect(discovery + coverage + corroboration + enrichment + reserve).toBe(hardCap);
  });

  it("discovery spends 13 of its 16-call ceiling", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }));

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // Decision 005. 16 is the ceiling in the spec's budget table; 13 is what
    // the frozen catalog actually contains after Google Events moved out.
    expect(scan!.searchesReserved).toBe(13);
    expect(scan!.searchesReserved).toBeLessThanOrEqual(SEARCH_BUDGET.discovery);
  });
});
```

- [ ] **Step 2: Run everything**

```bash
npm run check
npm run test:e2e
```

Expected: all green.

- [ ] **Step 3: Run the live concurrency proof once, and quote its real numbers**

```bash
set -a; . ./.env.local; set +a
LIVE_TESTS=1 npm run test:live -- --testNamePattern="reserve"
```

Expected: `granted=5, rejected=15, reserved=120`, zero SerpApi calls. Paste the actual output into the Linear comment — not a description of it.

- [ ] **Step 4: Tick the checklist and write the learning-log entry**

In `docs/hackathon-build/checklist.md`, change item 8's `- [ ]` to `- [x]`.

Append to `docs/LEARNING-LOG.md`, dated, answering the three questions the log always answers:

```markdown
## 2026-08-23 — the coverage answer had nowhere to live

**What we expected.** Wiring the workflow would be plumbing: call the pieces
items 5–7 already built, in the order the spec lists them.

**What happened.** Two of the pieces did not fit the order.

`runSliceForScan` ran evaluation immediately after the evidence snapshot, but
the spec puts the coverage searches *between* those two, because whether other
newsrooms already covered a story is an input to whether it qualifies. Wiring it
as written would have generated every brief against a verdict that was about to
change.

Worse, `evaluate` collapsed both coverage partitions into a single status, so
"we checked the big outlets but never reached the community ones" could not be
represented at all. A scan in that state would have looked exactly like a scan
that checked everywhere and found nothing — and would have claimed a coverage
gap on the strength of it.

**What we now believe.** A pipeline built one stage at a time will fit its own
tests and still not fit the sequence it belongs to. The vertical slice was right
to build; it just could not tell us where the seams needed to be, because it
never ran the step that goes between them. Read the lifecycle end to end before
wiring, and expect the seams to move.
```

- [ ] **Step 5: Commit**

```bash
git add tests/integration/search-budget-concurrency.test.ts docs/hackathon-build/checklist.md docs/LEARNING-LOG.md
git commit -m "test(scan): budget accounting, with the honest claim about what it proves (MOO-734)"
git push origin main
```

- [ ] **Step 6: Post the evidence and close MOO-734**

Post a comment on MOO-734 containing:
- Pasted output of `npm run check` and `npm run test:e2e` (counts, not descriptions).
- Pasted output of the live reserve-concurrency run.
- The dashboard numbers from the one real scan: search runs by purpose, `searchesReserved`, terminal status.
- **Explicitly**: that `convex-test` does not execute the workflow component, so the in-process tests prove the steps and their order, and the single live scan is what proves the workflow runs.
- **Explicitly**: that discovery produced **13** runs, not 16, and why.

Then move MOO-734 to Done.

---

## Self-Review

**1. Spec coverage.** Every one of the 14 lifecycle steps has a home:

| Spec step | Task |
| ---: | --- |
| 1. `scans.startScan` + workflow with idempotency key | 1 |
| 2. `searchRuns.reserve` | already committed; enforced in 3, 6, 7 |
| 3. `serpapi.executeSearch` | already committed; called in 3, 6, 7 |
| 4. `sourceResults.ingest` | already committed; called via `runExecuteSearch` |
| 5. `ai.analyzeResults` | 8 (`runEvidenceStage`) |
| 6. `candidates.formAppearances` | 5 + 8 |
| 7. `editorial.prefilterCandidates` | 4 + 8 (`selectForCoverage`) |
| 8. `ai.planFollowUp` + `validateSearchIntent` | 7 |
| 9. corroboration, coverage, conditional enrichment | 6 + 7 |
| 10. `evidence.build` | 5 (`runCandidateFormation`) |
| 11. `editorial.evaluateCandidate` | 5 (`runCandidateFinalization`) |
| 12. `editorial.calculateScore` | inside `evaluateCandidate`, already committed |
| 13. `briefs.generateVersion` | 5 (`runCandidateFinalization`) |
| 14. `scans.finalize` | 2 + 8 |

Other spec requirements: four public stages → 2, 8, 9. Cancellation before every external boundary → 3, 6, 7, 8. Coverage reserved before optional enrichment → 6 before 7, asserted in 8. Hard 120 cap → 10. Partial failures with named purposes → 2, 6, 9. Streaming candidate cards while the feed is incomplete → 8 (`setCandidateCounts` per candidate) and 9.

**2. Known gaps, named rather than hidden.**
- **`convex-test` cannot execute the workflow component.** Task 8 Step 8 is a manual deployment run, and Task 10 Step 6 requires saying so in the evidence. Nobody may claim the workflow is covered by the integration suite.
- **The Google Events enrichment branch stays unverified against a real payload** (decision 005 — the engine returns nothing). Item 10 re-checks whether SerpApi fixed it. `ENRICHMENT_TEMPLATE_IDS` stays wired and tested against a hand-written fixture, and that limitation is already recorded.
- **`termsFor` (Task 6 Step 7) uses the candidate's working title** unless `formFromCluster` turns out to persist entity keys. Check before implementing; entity keys are what the spec means, and the title is the honest fallback.
- **`Outdated` still has no schema home.** It is brief-scoped, not candidate-scoped, so it must not enter `vProductLabel`. That belongs to MOO-735 and is already written there.

**3. Type consistency, checked against committed code on 2026-08-23:**
- `LocalityBand = "direct_city" | "county_city_effect" | "area_city_consequence" | "none"` (`convex/editorial/types.ts:26`).
- `RelevanceBand = "policy_service_change" | "community_cultural_impact" | "emerging_question" | "promotion_only"` (`types.ts:27`).
- `CoverageInput = { partitions: { general, community }: CoveragePartitionStatus; reports: CoverageReport[] }` (`types.ts:21`) — partitions, **not** a `passStatus`. Task 6 depends on this.
- `CoveragePartitionStatus = "pending" | "succeeded" | "failed"` (`types.ts:20`); the `candidates.coveragePassStatus` column is the different `"pending" | "complete" | "failed"`. Do not conflate them.
- `searchRuns` indexes are `by_scan_purpose`, `by_scan_status`, `by_idempotency_key`, `by_candidate` (`convex/schema.ts:61-64`). There is no `by_scan`.
- `searchRuns.errorCode` / `errorMessage` are `v.optional(v.string())` (`convex/schema.ts:55-56`).
- `candidateSources` indexes: `by_candidate_scan`, `by_source_result`, `by_candidate_role` (`convex/schema.ts:156-158`).
- `CONFIRMING_CATEGORIES` excludes `community_discussion`, `map` and `trend` (`types.ts:4`) — that is why a Reddit-only candidate fails the prefilter's `no_confirming_signal`.
- The `users` index is `by_clerk_user_id`, not `by_clerk_user` (`convex/schema.ts:12`).
- `internal.testing.deleteScansForClerkUser` already exists (`convex/testing.ts:76`) — Task 9's e2e teardown reuses it rather than writing a second one.
- `runExecuteSearch` returns `runId?`, so every use is optional-chained.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-23-signalgap-durable-scan-workflow.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, an independent reviewer against each diff, review between tasks, fast iteration. This is what items 5–7 used.

**2. Inline Execution** — execute tasks in this session with `superpowers:executing-plans`, batching with checkpoints.

**Which approach?**
