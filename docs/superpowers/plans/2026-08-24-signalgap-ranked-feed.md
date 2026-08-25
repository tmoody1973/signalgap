# SignalGap Ranked Feed Implementation Plan (checklist item 9, part A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an editor a front door. Today the workspace shows a progress panel and nothing links to a lead — you would have to know the URL. This plan builds the ranked feed, the honest list of what did not qualify and why, and URL-backed filters, so a scan's output can actually be read.

**Architecture:** One new owner-scoped Convex query (`candidates.listForScan`) does the filtering, sorting and pagination server-side and returns a compact card shape — never the heavy evidence bundle. `src/app/workspace/` renders it as two lists that share one card component. Filters live in URL search parameters so a link to a filtered view is shareable and survives navigating into a lead and back. One small change to the rules engine gives a lead the AI could not read an honest verdict instead of vanishing.

**Tech Stack:** Convex 1.45 (queries with `paginationOptsValidator`), React 19 / Next.js App Router, Untitled UI primitives already in `src/components/ui/untitled/`, Tailwind v4 with tokens in `src/styles/theme.css`, Vitest 4, Playwright.

**Spec:** `docs/hackathon-build/spec.md` — `UI Behavior > Compact feed`, `Public And Internal Function Contracts`, `Editorial Rules And Scoring`. With `checklist.md` item 9.

**Linear:** MOO-735.

**Predecessors:** items 1–8 are closed. Every signature below was read out of committed code on 2026-08-24 at `11b37be`.

**Scope:** this is **part A of three**. Editorial controls (Reject/Monitor/Assign, notes, corrections, brief regeneration) and histories/comparison are separate plans. Tarik's call, 2026-08-24: the feed is the missing front door and unblocks the live-scan demo, so it ships first.

---

## Global Constraints

Every task's requirements implicitly include this section.

### The product claim this defends

- SerpApi gives it live eyes. AI connects and interprets. **Transparent rules and a journalist decide what is credible.**
- AI may never set eligibility, a score, or the `Coverage gap` label.
- **Never weaken a locality, independence, coverage, evidence or citation rule to make the feed look fuller.** A thin feed is an honest feed.
- **Never introduce a fabricated result to improve a demo.**

### The fact that shapes this whole plan

**At most ten leads per scan can ever qualify.** `convex/editorial/eligibility.ts:22` excludes any candidate whose `coverage.passStatus !== "complete"`, and the coverage stage can afford two searches per candidate out of twenty (`SEARCH_BUDGET.coverage`), so it fully checks at most ten.

So the "did not qualify" list is **where most of a scan lives** — not a corner case. It gets the same care as the feed: every entry names its reasons in the newsroom language of `src/lib/exclusion-reasons.ts`.

### Existing interfaces — consume, do not modify

**`convex/candidates/evaluate.ts` is the ONLY writer** of `status`, `primaryLabel`, `scoreTotal`, `scoreComponents`, `independentCategoryCount`, `coverageOriginalCount`, `coveragePassStatus`, `exclusionReasons`. Task 1 changes what it writes in one case; **no second writer may appear.**

**`candidates` table** (`convex/schema.ts:99`) — `ownerId`, `fingerprint`, `currentTitle`, `reportingQuestion`, `beat`, `status`, `primaryLabel`, `disposition`, `latestEvidenceVersion`, `latestBriefVersion?`, `scoreTotal?`, `scoreComponents?`, `judgment?`, `independentCategoryCount`, `coverageOriginalCount`, `coveragePassStatus`, `exclusionReasons?`, `firstSeenAt`, `lastSeenAt`, `updatedAt`. Indexes: `by_owner_fingerprint`, `by_owner_updated`, `by_owner_disposition`.

**`candidateAppearances`** (`convex/schema.ts:141`) — one row per candidate per scan, with `statusAtScan`, `labelAtScan`, `dispositionAtScan`, `scoreAtScan?`, `coverageCountAtScan?`, `categoryCountAtScan?`, `rank?`. Indexes: `by_scan_rank`, `by_candidate_scan`, `by_owner_scan`. **This is the feed's join table** — a feed is a view of one scan's appearances, not of all candidates ever.

**Labels** (`src/lib/source-labels.ts`) — `PRODUCT_LABELS`, `BEAT_TEXT`, `STAGE_TEXT`, `labelTone`, `LABEL_EXPLANATIONS`, and the `StatusLabel` component. Never type a label as a literal.

**Exclusion reasons** (`src/lib/exclusion-reasons.ts`) — `EXCLUSION_REASON_TEXT` and `exclusionSentence(reasons)`. A unit test compares its keys against `vExclusionReason`, so **a new reason must be added in three places at once** or the build fails: `convex/editorial/types.ts`, `convex/lib/validators.ts`, `src/lib/exclusion-reasons.ts`.

**Evidence page** — `/leads/[candidateId]` exists and works (item 7). The feed links to it; do not change it.

### Convex rules

- Every public function: `args` **and** `returns` validators, Clerk identity via `requireUser`, server-derived `ownerId`.
- **Pagination cursors and maximum page sizes are explicit.** Use `paginationOptsValidator`.
- Raw SerpApi JSON stays in File Storage; `rawStorageId` is never returned to the browser.
- **`npx convex codegen` does not deploy.** Also run `npx convex dev --once`.
- Convex CLI needs `set -a; . ./.env.local; set +a`.

### UI rules

- **Untitled UI (MIT only) is the sole primitive foundation.** Search `src/components/ui/untitled/` before adding a primitive. No shadcn/ui, no Radix, no second token system. Add anything copied to `THIRD_PARTY_NOTICES.md` in the same change.
- Colors come from tokens in `src/styles/theme.css`. No ad-hoc hex.
- **Status readable without colour** — visible text always; `data-tone` is decoration.
- Preserve React Aria semantics. Keep client boundaries small.
- **Verify light mode, dark mode, keyboard focus, narrow width, and greyscale — by looking at it in a browser.** Item 7 found five defects this way that 352 green tests never would.

### Process

- npm only. Commit after every task. TDD for rules, queries and validators.
- Never commit `.env*`. **Never run a live Milwaukee scan** — up to 120 paid searches from ~983 left this month; that is item 10 and Tarik's call.
- Implementers do not run `/simplify` or any refactor pass.

---

## File Structure

**Create**

| File | Responsibility |
| --- | --- |
| `convex/candidates/list.ts` | `listForScan` — the feed query: filter, sort, paginate, return card shape. |
| `src/lib/feed-filters.ts` | Pure parse/serialise between URL search params and a typed filter object. |
| `src/components/feed/lead-card.tsx` | One card. Used by both lists. |
| `src/components/feed/feed-filters.tsx` | The filter controls. |
| `src/components/feed/lead-feed.tsx` | The two lists, counts, empty states, load-more. |
| `tests/unit/feed-filters.test.ts` | Filter parse/serialise round-trip and rejection of junk. |
| `tests/unit/editorial/unreadable.test.ts` | The rules engine's "cannot be judged" verdict. |
| `tests/integration/feed-query.test.ts` | Ownership, sort order, filters, pagination. |
| `tests/e2e/feed.spec.ts` | The rendered feed. |

**Modify**

| File | Change |
| --- | --- |
| `convex/editorial/types.ts` | Add `unreadable_evidence` to `ExclusionReason`. |
| `convex/lib/validators.ts` | Add it to `vExclusionReason`. |
| `src/lib/exclusion-reasons.ts` | Add its sentence. |
| `convex/editorial/status.ts` | Add `unreadableVerdict()` — the rules engine's honest answer for a candidate it cannot judge. |
| `convex/candidates/evaluate.ts` | Use it instead of returning `{ rejected: "no_judgment" }`. |
| `convex/slice.ts` | Stop skipping finalization for `!readyForVerdict` — they now get a real verdict. |
| `convex/stages/evidence.ts` | Stop filtering them out of `candidateIds`. |
| `src/app/workspace/page.tsx` | Render the feed under the progress panel. |

### The one real design decision

**A lead the AI could not read currently appears nowhere.** Its classification failed, so it has no judgment; `evaluate` returns `{ rejected: "no_judgment" }` and writes nothing, leaving `status: "processing"` forever. The default feed shows eligible only; the exclusions list shows excluded only. It is in neither.

Item 8 added `readyForVerdict` to stop such a candidate reaching `evaluate`, because `evaluate` would have reported the *wrong cause* — "no judgment" names the consequence, not the reason.

**Tarik's call, 2026-08-24: show it, and say we could not read it.**

The fix is to give the **rules engine** an honest verdict for that case, then delete the skip. That is why Task 1 removes code rather than adding a special case:

- `unreadableVerdict()` lives in `convex/editorial/status.ts` beside `evaluateCandidate`, so the verdict still comes from the rules engine and the product claim holds.
- `evaluate` calls it and writes the result, so it remains the single writer.
- `readyForVerdict`'s skip in `convex/slice.ts` and the filter in `convex/stages/evidence.ts` both go away, because the reason they existed is gone.

**Keep the `readyForVerdict` field itself.** Finalization still uses it to decide whether to attempt a brief — a candidate with no evidence snapshot has nothing to cite, and asking a model to write a brief from nothing is exactly the fabrication this product refuses.

---

## Task 1: A lead the AI could not read gets an honest verdict, not a disappearance

**Files:**
- Modify: `convex/editorial/types.ts`, `convex/lib/validators.ts`, `src/lib/exclusion-reasons.ts`, `convex/editorial/status.ts`, `convex/candidates/evaluate.ts`, `convex/slice.ts`, `convex/stages/evidence.ts`
- Test: `tests/unit/editorial/unreadable.test.ts` (create), `tests/unit/exclusion-reasons.test.ts` (existing sync test must stay green), `tests/integration/scan-workflow.test.ts` (existing tests change)

**Interfaces:**
- Produces:
  ```ts
  // convex/editorial/status.ts
  export function unreadableVerdict(): CandidateEvaluation;
  ```
  returning `{ status: "excluded", label: "Worth a look", reasons: ["unreadable_evidence"], score: null, independence, coverage }` with empty independence and pending coverage.
- Changes `internal.candidates.evaluate.evaluate`: the `no_judgment` rejection becomes a written verdict. Its `returns` validator keeps the `rejected` union for `candidate_not_found` only.

**Why this shape:** the verdict still comes from `convex/editorial/`, so "transparent rules decide" stays true. `evaluate` stays the single writer.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/editorial/unreadable.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { unreadableVerdict } from "../../../convex/editorial/status";

describe("unreadableVerdict", () => {
  it("excludes the candidate and names the real cause", () => {
    const verdict = unreadableVerdict();
    expect(verdict.status).toBe("excluded");
    // The cause is that classification failed. "no judgment" names the
    // consequence, which is what made this lead vanish in the first place.
    expect(verdict.reasons).toEqual(["unreadable_evidence"]);
  });

  it("carries no score, because nothing was judged", () => {
    expect(unreadableVerdict().score).toBeNull();
  });

  it("cannot be a coverage gap", () => {
    // A gap is a claim about the ABSENCE of reporting. We did not read the
    // evidence, so we are in no position to claim anything about coverage.
    expect(unreadableVerdict().label).not.toBe("Coverage gap");
    expect(unreadableVerdict().coverage.passStatus).not.toBe("complete");
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

```bash
npx vitest run tests/unit/editorial/unreadable.test.ts
```

Expected: FAIL — `unreadableVerdict` is not exported.

- [ ] **Step 3: Add the reason in all three places, together**

`convex/editorial/types.ts` — append to the union:

```ts
export type ExclusionReason =
  | "weak_locality" | "stale" | "insufficient_independence" | "no_beat_relevance" | "already_covered"
  | "inaccessible_evidence" | "coverage_pass_incomplete" | "promotional" | "duplicate" | "speculative"
  | "routine_crime" | "unreadable_evidence";
```

`convex/lib/validators.ts` — append `v.literal("unreadable_evidence")` to `vExclusionReason`.

`src/lib/exclusion-reasons.ts` — append to `EXCLUSION_REASON_TEXT`:

```ts
  unreadable_evidence: "the evidence could not be read, so nothing was judged",
```

The existing sync test in `tests/unit/exclusion-reasons.test.ts` compares these lists and fails if you miss one. That is the guard; do not disable it.

- [ ] **Step 4: Add the verdict to the rules engine**

Append to `convex/editorial/status.ts`:

```ts
/**
 * The verdict for a candidate the system could not judge at all — its evidence
 * classification failed, so there are no bands, no categories and no snapshot.
 *
 * It exists so such a lead is EXCLUDED WITH A REASON rather than left at
 * "processing" forever, invisible in both the feed and the exclusions list.
 * Naming the real cause matters: "no judgment" describes the consequence, and
 * an editor reading it would look for the wrong problem.
 *
 * It lives here, beside `evaluateCandidate`, because the rules decide every
 * verdict this product renders — including the verdict "we cannot decide".
 */
export function unreadableVerdict(): CandidateEvaluation {
  return {
    status: "excluded",
    label: "Worth a look",
    reasons: ["unreadable_evidence"],
    // No score. Not zero — a zero would say the rules ran and found nothing.
    score: null,
    independence: { independentCategoryCount: 0, confirmingSourceIds: [], nonConfirmingSourceIds: [], groups: [] },
    coverage: { passStatus: "pending", originalReportCount: 0, countedReportIds: [], groupsChecked: [] },
  };
}
```

**Read `IndependenceSummary` in `convex/editorial/independence.ts` and `CoverageSummary` in `convex/editorial/coverage.ts` and match their real fields** — the shapes above are from memory and may be wrong. The compiler will tell you.

- [ ] **Step 5: Run the unit test, watch it pass**

```bash
npx vitest run tests/unit/editorial/unreadable.test.ts tests/unit/exclusion-reasons.test.ts
```

- [ ] **Step 6: Have `evaluate` write it**

In `convex/candidates/evaluate.ts`, replace the `no_judgment` bail:

```ts
    // A candidate whose classification failed has no bands to judge. It still
    // gets a verdict — the rules engine's honest "we could not read this" —
    // because a lead that silently stays at "processing" appears in neither
    // the feed nor the exclusions list, and an editor never learns it existed.
    const verdict = candidate.judgment ? evaluateCandidate(buildInput(candidate)) : unreadableVerdict();
```

Restructure as the real code requires — the input assembly currently sits after the judgment check and must not run without a judgment. Keep the `candidate_not_found` rejection. Remove `no_judgment` from the `returns` validator only if nothing else can produce it.

- [ ] **Step 7: Delete the skips that existed only to avoid the wrong message**

`convex/slice.ts` — `runSliceForScan` no longer short-circuits on `!readyForVerdict`; every formed candidate goes through `runCandidateFinalization`.

**Keep `readyForVerdict` on `FormedCandidate`**, and use it inside `runCandidateFinalization` to skip **brief generation only**:

```ts
  // No evidence snapshot means nothing to cite. Asking a model to write a brief
  // from nothing is the fabrication this product refuses.
  if (readyForVerdict) { /* existing runGenerateBrief call */ }
```

`convex/stages/evidence.ts` — stop filtering `candidateIds` to `readyForVerdict === true`; return them all, and pass the flag through so finalization still knows. Decide how (a parallel array, or return objects instead of ids) and say which in your report.

- [ ] **Step 8: Update the tests that asserted the old behaviour**

`tests/integration/scan-workflow.test.ts` has tests asserting a classify failure never reaches `evaluate` and stays at `status: "processing"`. **That was the bug.** Rewrite them to assert the new truth:

```ts
it("a lead the AI could not read is excluded with an honest reason, not left invisible", async () => {
  // ... drive a classify failure through runEvidenceStage + finalization ...
  const candidate = await t.run(async (ctx) => ctx.db.get(candidateId));
  expect(candidate?.status).toBe("excluded");
  expect(candidate?.exclusionReasons).toEqual(["unreadable_evidence"]);
  // Still no brief — there was no evidence to cite.
  expect(candidate?.latestBriefVersion).toBeUndefined();
});
```

Do **not** delete the guard that a healthy candidate still reaches finalization with a real verdict.

- [ ] **Step 9: Full check and deploy**

```bash
npm run check
set -a; . ./.env.local; set +a
npx convex dev --once
npm run test:e2e
```

`tests/integration/evidence-brief-vertical-slice.test.ts` must stay green and untouched.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(editorial): a lead the AI could not read is excluded with a reason, not invisible (MOO-735)"
```

---

## Task 2: The feed query

**Files:**
- Create: `convex/candidates/list.ts`, `tests/integration/feed-query.test.ts`

**Interfaces:**
- Produces `api.candidates.listForScan`:
  ```ts
  query({
    args: {
      scanId: v.id("scans"),
      view: v.union(v.literal("eligible"), v.literal("excluded")),
      beat: v.optional(V.vBeat),
      label: v.optional(V.vProductLabel),
      disposition: v.optional(V.vDisposition),
      paginationOpts: paginationOptsValidator,
    },
    returns: vLeadCardPage,   // { page: vLeadCard[], isDone, continueCursor, counts }
  })
  ```
  where `vLeadCard` carries exactly the spec's card fields: `candidateId`, `reportingQuestion`, `beat`, `label`, `scoreTotal | null`, `independentCategoryCount`, `coverageOriginalCount`, `discoveredAt`, `disposition`, `exclusionReasons`.

**The card shape is deliberately small.** `evidence.forCandidate` is the heavy per-lead bundle and must never be called to render a list.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/feed-query.test.ts` covering, at minimum:

```ts
it("returns only this owner's leads", async () => { /* seed two owners, assert isolation */ });

it("defaults to eligible leads only", async () => {
  // spec.md > Compact feed: "Only eligible leads appear by default."
});

it("sorts by score descending, then freshness, then stable id", async () => {
  // Seed three leads with a deliberate score tie so the tiebreak is exercised.
  // The id tiebreak is not cosmetic: without it the same scan renders in a
  // different order on every load and an editor cannot trust their place.
});

it("the excluded view returns leads with their reasons", async () => {
  expect(page[0].exclusionReasons).toContain("coverage_pass_incomplete");
});

it("filters by beat, label and disposition independently", async () => { /* ... */ });

it("paginates without dropping or repeating a lead", async () => {
  // Seed 30, take two pages of 25 and 5, assert the union is exactly the 30
  // distinct ids. A cursor bug shows up here and nowhere else.
});

it("counts are for the whole scan, not the current page", async () => {
  // An editor filtering to one beat still needs to know the scan's totals.
});
```

- [ ] **Step 2: Run it, watch it fail**

```bash
npx vitest run tests/integration/feed-query.test.ts
```

Expected: FAIL — `api.candidates.listForScan` does not exist.

- [ ] **Step 3: Implement**

Create `convex/candidates/list.ts`. Points the implementation must honour:

- `requireUser`, and verify the scan belongs to that user before reading anything.
- Read `candidateAppearances` by `by_owner_scan`, then the candidate rows. **A feed is a view of one scan**, not of every candidate the owner ever had.
- Sort: `scoreTotal` descending (nulls last), then `firstSeenAt` descending, then `_id` ascending. **Sort before paginating.**
- `counts` are computed over the whole scan: `{ eligible, excluded, processing }`.
- Never return `scoreComponents`, `judgment`, or anything from `evidenceItems`.

- [ ] **Step 4: Run the test, watch it pass; then full check**

```bash
npx vitest run tests/integration/feed-query.test.ts
npm run check
set -a; . ./.env.local; set +a && npx convex dev --once
```

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(feed): the ranked feed query, owner-scoped and paginated (MOO-735)"
```

---

## Task 3: URL-backed filters

**Files:**
- Create: `src/lib/feed-filters.ts`, `tests/unit/feed-filters.test.ts`

**Interfaces:**
```ts
export type FeedFilters = {
  view: "eligible" | "excluded";
  beat: Beat | null;
  label: ProductLabel | null;
  disposition: Disposition | null;
};
export function parseFeedFilters(params: URLSearchParams): FeedFilters;   // total: junk becomes the default
export function feedFiltersToParams(filters: FeedFilters): URLSearchParams;
```

**Why pure and separate:** filters are the one piece of feed logic worth unit-testing without a browser, and `parseFeedFilters` is a trust boundary — the input is a URL a person can type.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/feed-filters.test.ts`:

```ts
it("defaults to the eligible view with no filters", () => {
  expect(parseFeedFilters(new URLSearchParams())).toEqual({
    view: "eligible", beat: null, label: null, disposition: null,
  });
});

it("round-trips every filter", () => {
  const filters = { view: "excluded", beat: "housing", label: "Coverage gap", disposition: "monitoring" } as const;
  expect(parseFeedFilters(feedFiltersToParams(filters))).toEqual(filters);
});

it("drops a value that is not in the vocabulary rather than trusting it", () => {
  // The input is a URL a person can type. An unknown beat must not reach the
  // query as a filter that silently matches nothing.
  const params = new URLSearchParams("beat=sports&label=BREAKING&view=everything");
  expect(parseFeedFilters(params)).toEqual({ view: "eligible", beat: null, label: null, disposition: null });
});

it("omits null filters from the params, so a clean view has a clean URL", () => {
  const params = feedFiltersToParams({ view: "eligible", beat: null, label: null, disposition: null });
  expect(params.toString()).toBe("");
});
```

- [ ] **Step 2: Run it, watch it fail. Step 3: Implement. Step 4: Run it, watch it pass.**

Validate against the real vocabularies — `BEAT_TEXT`'s keys, `PRODUCT_LABELS`' values, and the disposition union in `convex/lib/validators.ts`. Import them; do not retype the lists.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(feed): URL-backed filters, validated at the boundary (MOO-735)"
```

---

## Task 4: The lead card

**Files:**
- Create: `src/components/feed/lead-card.tsx`

**Interfaces:**
```ts
export function LeadCard({ lead }: { lead: LeadCardView }): JSX.Element;
```
`LeadCardView` derives from the query's return type the way `src/lib/evidence-view.ts` does, so a renamed Convex field breaks the build rather than rendering blank.

**Card fields, from `spec.md > Compact feed`, all of them:** reporting question, beat, primary cautious label, score, independent categories, coverage count, discovery time, disposition, `Open evidence`.

**Two things this card must get right:**

- **A lead with no score says so in words** — `No score` — never `0`. A zero says the rules ran and scored it nothing; the truth is they never scored it. `src/components/evidence/lead-card.tsx` already solved this for the evidence page; read it and stay consistent, but note it is a *different* component for a different surface. Do not try to share one.
- **An excluded lead shows why, on the card.** Use `exclusionSentence()` from `src/lib/exclusion-reasons.ts`. An editor scanning the didn't-qualify list must be able to triage without opening anything.

- [ ] **Step 1: Build it**

Search `src/components/ui/untitled/` first for anything that fits, and read `src/components/evidence/lead-card.tsx` for the house style — comment density, token use, how it states an absence.

Requirements:
- `Open evidence` is a real link to `/leads/{candidateId}`, keyboard reachable, with a visible focus ring.
- Label via `StatusLabel`; beat via `BEAT_TEXT`; never a literal string.
- Discovery time as a relative phrase with the absolute date in a `title` — an editor's first filter is age. *(This is the "relative dates" item carried from MOO-733's review.)*
- No `"use client"` unless something here genuinely needs interactivity. It should not.

- [ ] **Step 2: `npm run check`, then commit**

```bash
git commit -am "feat(feed): the lead card (MOO-735)"
```

---

## Task 5: The feed, its filters, and its empty states

**Files:**
- Create: `src/components/feed/feed-filters.tsx`, `src/components/feed/lead-feed.tsx`
- Modify: `src/app/workspace/page.tsx`

**Interfaces:** consumes `api.candidates.listForScan` (Task 2), `parseFeedFilters`/`feedFiltersToParams` (Task 3), `LeadCard` (Task 4).

**What it must show, from the spec and the checklist:**

- Two views — the ranked feed and what did not qualify — switchable, with the current view in the URL.
- **All three counts, always**, even at zero: eligible, excluded, processing. Same rule as the progress panel.
- Filters: beat, label, disposition. Every change writes to the URL.
- Load-next-25 pagination.
- **Empty states that are useful rather than apologetic:**
  - Filtered to nothing → `Clear filters`.
  - Scan finished with no eligible leads → show the counts, point at the didn't-qualify list, offer `Run new scan`. **Never suggest lowering a threshold.** That is the one thing this product will not do.

- [ ] **Step 1: Build it**

Filters go in the URL via `useRouter`/`useSearchParams`, so a filtered view is shareable and survives opening a lead and coming back. **Do not hold filter state in React alone** — that is the requirement.

Keep the client boundary as small as the interactivity actually needs.

- [ ] **Step 2: Wire into the workspace**

`src/app/workspace/page.tsx` renders the feed under `ScanProgress` when a scan exists. The first-run empty state stays exactly as it is.

- [ ] **Step 3: `npm run check`, deploy, then LOOK AT IT**

```bash
npm run check
set -a; . ./.env.local; set +a
npx convex dev --once
npm run dev
```

Seed a scan and some leads, then open `http://localhost:3000/workspace` and check **by eye**: light mode, dark mode, keyboard focus through the filters and into a card's link, 375px width, and greyscale. Report what you saw, not what the code should produce.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(feed): the ranked feed and the didn't-qualify list (MOO-735)"
```

---

## Task 6: A fixture that seeds a readable feed

**Files:**
- Modify: `convex/testing.ts`

**Interfaces:** produces `internal.testing.seedFeedFixture` — `{ clerkUserId }` → `{ scanId, eligibleCount, excludedCount }`.

**This is demo material, so it follows item 10's rule: no fabricated results.** Build it on the real captured Milwaukee payloads already in `tests/fixtures/serpapi/`, the same source `seedSliceFixture` uses. Reuse that seeder's rows rather than writing a second set — the earlier near-miss on this project was an invented lead reaching a screen a human reviewed.

What it must produce, so the feed can be seen doing its job:
- At least one eligible lead and several that did not qualify, **with different reasons**, so the exclusions list is not one repeated sentence.
- At least one lead per beat, so the beat filter does something visible.
- Enough leads to cross a page boundary, so `Load next` is exercised.

Use `purgeScan` when clearing prior scans — `convex/testing.ts:16` exists because orphans make the e2e first-run assertions read a dirty deployment as clean.

- [ ] **Step 1: Build it. Step 2: `npx convex dev --once` and run it by hand. Step 3: Commit.**

---

## Task 7: End-to-end, in a browser

**Files:**
- Create: `tests/e2e/feed.spec.ts`

Seed with `seedFeedFixture`, tear down with `internal.testing.deleteScansForClerkUser`.

**Each test must be able to fail.** Two lessons from item 8, both real:
- An assertion that matched a *stage heading* elsewhere on the page passed while the feature it named was deleted. **Prefer `{ exact: true }` and role-scoped queries over `.first()`.**
- A test whose name promised something the fixture could not produce sat there for days. **If you cannot make an assertion true and false, say so rather than writing it.**

Cover:

```ts
it("the workspace lists leads, best first");
it("shows all three counts, including zeroes");
it("a lead links to its evidence page, and the link works");
it("filtering by beat changes the list and the URL");
it("a filtered URL pasted fresh loads that filtered view");   // the point of URL-backed filters
it("the didn't-qualify list names a reason for each lead");
it("filtering to nothing offers Clear filters");
it("a scan with no eligible leads points at the exclusions rather than suggesting a lower bar");
it("no horizontal overflow at 375px");
```

- [ ] **Step 1: Write them, watch them fail. Step 2: Make them pass. Step 3: Full `npm run test:e2e`. Step 4: Commit.**

---

## Task 8: Close it out

**Files:** `docs/hackathon-build/checklist.md`, `docs/LEARNING-LOG.md`

- [ ] Tick the feed portions of item 9 only. **Leave the editorial-controls and history/comparison bullets unticked** — they are parts B and C and are not built. A checklist that overstates is worse than one that lags.
- [ ] Add a learning-log entry if this plan taught something: expected / happened / now believe, plain English, terms defined inline.
- [ ] `npm run check`, `npm run test:e2e`, commit.

---

## Self-Review

**Spec coverage.** `Compact feed`'s card fields → Task 4. Default sort → Task 2. URL filters → Tasks 3 and 5. Always-visible counts → Tasks 2 and 5. Exclusions with reasons → Tasks 1, 2, 4. Empty states → Task 5. `candidates.listForScan` from the contracts table → Task 2.

**Deliberately out of scope, and why.** Dispositions, notes, corrections, brief regeneration, lead history, scan history and scan comparison are parts B and C. `Outdated` still has no schema home (carried from MOO-730) and belongs with brief regeneration in part B. Scroll restoration is deferred — it needs the feed to exist before it can be judged.

**Known gaps, named rather than hidden.**
- At most ten leads per scan can qualify, so the feed will look thin until the coverage allocation changes. That is honest, not broken — but it is the first thing to check against the live scan at item 10.
- `selectForCoverage` already computes real per-candidate reasons for why a lead was never coverage-checked (`convex/stages/evidence.ts`), and nothing surfaces them. Task 2's `exclusionReasons` is close but not the same thing: a coverage-skipped lead reads `coverage_pass_incomplete`, which is true but does not say *we ran out of budget before reaching you*. Worth part B.
- `readyForVerdict` remains a documented, not structural, obligation.

**Type consistency, checked against committed code on 2026-08-24 at `11b37be`.**
- `candidateAppearances` is the scan↔candidate join; indexes `by_scan_rank`, `by_candidate_scan`, `by_owner_scan`.
- `candidates` indexes: `by_owner_fingerprint`, `by_owner_updated`, `by_owner_disposition`. **There is no index on `(ownerId, status)`** — if Task 2 wants one, add it deliberately and say so.
- `vDisposition` is `new | rejected | monitoring | assigned`.
- `exclusionReasons` is `v.optional(v.array(vExclusionReason))` — **optional**, so a card must handle its absence.
- `scoreTotal` is `v.optional(v.number())` on the row; the evidence query normalises it to `number | null`. Pick one convention for the feed and state it.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-24-signalgap-ranked-feed.md`.

Execute with `superpowers:subagent-driven-development`, as items 5–8 were.
