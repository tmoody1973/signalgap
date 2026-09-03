# SignalGap Journalist-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SignalGap something a working reporter would use tomorrow: leads before telemetry, the brief's payoff before the score table, honest labels on rejected leads, and a way to act on a lead instead of just reading it.

**Architecture:** Presentation tasks (1 to 8) reorder and relabel existing components and add small pure functions in `src/lib/` with unit tests. The disposition tasks (9 and 10) add one public Convex mutation that writes the candidate's `disposition` column and an `editorEvents` row, plus one client component that calls it. Nothing touches the rules engine, the AI pipeline, or `convex/candidates/evaluate.ts`.

**Tech Stack:** Next.js App Router, React, Convex (queries, mutations, `convex-test`), Clerk, Vitest, Playwright, Untitled UI primitives already in `src/components/ui/untitled/`.

**Spec:** `docs/reviews/2026-08-30-journalist-ux-review.md` (the review this plan implements), `docs/hackathon-build/prd.md` sections "Target User", "User Jobs", and "Core User Journey", and `docs/hackathon-build/spec.md`.

## Global Constraints

Copied from `CLAUDE.md` and the handoff; every task inherits these.

- Never weaken locality, independence, coverage, or citation rules. Nothing in this plan changes a rule.
- `convex/candidates/evaluate.ts` is the ONLY writer of `status`, `primaryLabel`, `scoreTotal`, `scoreComponents`, `independentCategoryCount`, `coverageOriginalCount`, `coveragePassStatus`, `exclusionReasons`. This plan writes `disposition` and `updatedAt` only, which are not on that list.
- Every public Convex function has `args` and `returns` validators, calls `requireUser`, and derives `ownerId` on the server.
- Untitled UI (MIT) is the only primitive foundation. Search `src/components/ui/untitled/` before adding a primitive. `Button` exists; there is no textarea primitive, so a native `<textarea>` styled with the same classes as the feed's `<select>` is correct.
- Colors come from tokens in `src/styles/theme.css`. No hex in components.
- Use exact product labels from `src/lib/source-labels.ts`. No sensational copy.
- Preserve React Aria semantics. Keep client boundaries small.
- Verify light mode, dark mode, keyboard focus, 375px width, and non-color status text for any UI change.
- npm only. Commit after every task. TDD for anything with logic.
- **Run `npm run check` bare, never piped.** A pipe reports the last command's exit code. The proof typecheck ran is the `Test Files` block in the output.
- After adding any file under `convex/`, run `npx convex dev --once` before `npm run check`. Typecheck does not regenerate Convex types.
- The e2e suite runs as `E2E_CLERK_EMAIL`, which is a throwaway account. It is safe to run. Always pass `PLAYWRIGHT_BASE_URL=http://localhost:3100` because port 3000 is a different project on this machine.
- Commit messages follow `<type>: <description>` and end with the attribution block:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016fYSsPjHhdehmbrYt8z8Nf
  ```

## Out of scope, named so nobody sneaks them in

- **Synthetic reporting questions on rejected leads.** Real scans generate a question like "Is there a WNBA story behind this trend?" for candidates the rules then reject. That is a pipeline ordering question (question generation runs before or regardless of evaluation) and needs its own investigation. Not a display fix; the e2e fixture's rejected leads carry good questions by design.
- **A score anchor ("70 of 100, strong").** Score bands are a product decision Tarik owns; the project pins thresholds to his labels. Do not invent bands.
- **Re-classifying the 36 leads the rules accepted as "housing."** Needs paid AI calls and a re-export. Task 7 covers the 93 leads the rules rejected for beat, which is the visible contradiction.
- **Batching the evidence stage.** Task 8b in the August repair plan. Separate plan.
- **Compare scans (item 9 Part C).** This plan removes the dead link; it does not build the page.

## File structure

| File | Responsibility | Tasks |
| --- | --- | --- |
| `src/components/shell/app-header.tsx` | Top nav | 1 |
| `src/app/workspace/page.tsx` | Which panel renders first; saved-scan heading | 2, 4 |
| `src/components/scan/scan-progress.tsx` | Scan status panel; collapses when finished | 2, 3, 4 |
| `src/lib/failure-text.ts` (new) | Failure codes to plain English | 3 |
| `src/components/evidence/evidence-view.tsx` | Lead page section order | 5, 6, 10 |
| `src/components/evidence/start-here.tsx` (new) | Brief summary + interview questions, hoisted | 5 |
| `src/components/evidence/reporting-brief.tsx` | Loses the two hoisted pieces | 5 |
| `src/lib/source-labels.ts` | `displayBeat` | 7 |
| `src/components/feed/lead-card.tsx` | Feed card: beat, chips | 7, 8 |
| `src/components/evidence/lead-card.tsx` | Lead page header: beat | 7 |
| `src/lib/exclusion-reasons.ts` | Short chip text | 8 |
| `convex/candidates/disposition.ts` (new) | Public mutation | 9 |
| `src/components/evidence/disposition-bar.tsx` (new) | Assign / Monitor / Reject / note | 10 |

---

### Task 1: Remove the dead "Compare scans" link

**Files:**
- Modify: `src/components/shell/app-header.tsx:16`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. `routes.compare()` in `src/lib/routes.ts` stays; it is harmless and item 9 Part C will use it.

- [ ] **Step 1: Confirm the page does not exist**

Run: `ls src/app/compare 2>&1`
Expected: `No such file or directory`

- [ ] **Step 2: Remove the link**

In `src/components/shell/app-header.tsx`, delete this line:

```tsx
          <Link href={routes.compare()} className="text-sm text-muted hover:text-ink">Compare scans</Link>
```

The `routes` import is still used by the SignalGap wordmark link, so leave it.

- [ ] **Step 3: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: no errors. If ESLint reports `routes` as unused, the wordmark link was changed by mistake; restore it.

- [ ] **Step 4: Commit**

```bash
git add src/components/shell/app-header.tsx
git commit -m "fix(nav): remove Compare scans until the page exists

The link in the primary navigation returned a 404. A dead link in the
nav is a trust hit for a reporter on first contact. Item 9 Part C will
put it back when there is a page to go to.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016fYSsPjHhdehmbrYt8z8Nf"
```

---

### Task 2: "Saved scan," not "Saved demo scan"

To a journalist, "demo" means fake data. The `Saved copy` label and capture timestamp already say what this is.

**Files:**
- Modify: `src/app/workspace/page.tsx:58`
- Modify: `src/components/scan/scan-progress.tsx:138`
- Modify: `tests/e2e/saved-demo-fallback.spec.ts` (every `"Open saved demo scan"` and `"Saved demo scan"`)
- Modify: `scripts/check-saved-demo.mts` (every `"Open saved demo scan"`)

**Interfaces:**
- Produces: button accessible name `Open saved scan`; heading text `Saved scan`. Task 10's e2e does not depend on these.

- [ ] **Step 1: Update the e2e spec first, so it fails**

In `tests/e2e/saved-demo-fallback.spec.ts`, replace every occurrence:

```
"Open saved demo scan"  ->  "Open saved scan"
"Saved demo scan"       ->  "Saved scan"
```

Run: `grep -c "saved demo scan\|Saved demo scan" tests/e2e/saved-demo-fallback.spec.ts`
Expected: `0`

- [ ] **Step 2: Run the spec to see it fail**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/saved-demo-fallback.spec.ts`
Expected: FAIL, `getByRole('button', { name: 'Open saved scan' })` not found.

- [ ] **Step 3: Rename in the component and the page**

In `src/components/scan/scan-progress.tsx`, change:

```tsx
            Open saved demo scan
```
to
```tsx
            Open saved scan
```

In `src/app/workspace/page.tsx`, change:

```tsx
                {isShowingSaved ? "Saved demo scan" : "Latest scan"}
```
to
```tsx
                {isShowingSaved ? "Saved scan" : "Latest scan"}
```

In `scripts/check-saved-demo.mts`, replace every `"Open saved demo scan"` with `"Open saved scan"`.

- [ ] **Step 4: Run the spec to see it pass**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/saved-demo-fallback.spec.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace/page.tsx src/components/scan/scan-progress.tsx tests/e2e/saved-demo-fallback.spec.ts scripts/check-saved-demo.mts
git commit -m "fix(workspace): call the saved scan a saved scan

\"Demo\" reads as fake data to a reporter. The Saved copy label and the
capture timestamp already say exactly what this is.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016fYSsPjHhdehmbrYt8z8Nf"
```

---

### Task 3: Failure strings in English

The panel currently prints `2 of 29 analyze batches failed: batch 5 invalid_output` and `brief: invalid_output`. A reporter reads `invalid_output` and concludes the product is broken. The original message stays available under a native `<details>` for anyone who wants it.

**Files:**
- Create: `src/lib/failure-text.ts`
- Create: `tests/unit/scan/failure-text.test.ts`
- Modify: `src/components/scan/scan-progress.tsx:112-121`

**Interfaces:**
- Produces: `failureText(code: string, message: string): { headline: string; detail: string | null }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scan/failure-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FAILURE_TEXT, failureText } from "@/lib/failure-text";

/**
 * The scan panel names its failures, which is the right instinct. It named
 * them in code -- "batch 5 invalid_output", "brief: invalid_output" -- which
 * a reporter reads as "this product is broken". These are the translations.
 */
describe("failureText", () => {
  it("writes newsroom English, never a code", () => {
    for (const text of Object.values(FAILURE_TEXT)) {
      expect(text).not.toMatch(/_/);
      expect(text).toMatch(/[.]$/);
      expect(text[0]).toEqual(text[0].toUpperCase());
    }
  });

  it("covers every code the pipeline records on a scan", () => {
    // Grepped from convex/ on 2026-08-30. A new code with no sentence falls
    // back to its raw message (next test), so this list is a floor, not a gate.
    for (const code of [
      "serpapi_error", "analyze_failed", "cluster_failed", "adjudicate_failed",
      "adjudicate_capped", "over_merged", "candidate_step_failed",
      "coverage_partition_failed", "plan_failed",
    ]) {
      expect(FAILURE_TEXT[code]).toBeDefined();
    }
  });

  it("puts the English first and keeps the original as detail", () => {
    const out = failureText("analyze_failed", "2 of 29 analyze batches failed: batch 5 invalid_output");
    expect(out.headline).toBe(FAILURE_TEXT.analyze_failed);
    expect(out.detail).toBe("2 of 29 analyze batches failed: batch 5 invalid_output");
  });

  it("falls back to the raw message for a code it does not know", () => {
    // Never a blank line. A future code reaching an old client shows its
    // message, not nothing.
    const out = failureText("brand_new_code", "something specific happened");
    expect(out.headline).toBe("something specific happened");
    expect(out.detail).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/scan/failure-text.test.ts`
Expected: FAIL, cannot find module `@/lib/failure-text`.

- [ ] **Step 3: Write the module**

Create `src/lib/failure-text.ts`:

```ts
/**
 * What a scan's failure means, said the way an editor would say it.
 *
 * The pipeline records a code and a message on the scan. The message is
 * written for whoever debugs the pipeline ("batch 5 invalid_output"). The
 * headline here is written for whoever decides whether to trust the scan.
 * Both are shown: the headline first, the original message as detail.
 */
export const FAILURE_TEXT: Record<string, string> = {
  serpapi_error: "A search returned no usable results.",
  analyze_failed: "Some sources could not be read, so their signals are missing.",
  cluster_failed: "Related signals could not be grouped into leads.",
  adjudicate_failed: "Some near-duplicate leads could not be checked against each other.",
  adjudicate_capped: "Too many near-duplicate pairs to check, so some were left unmerged.",
  over_merged: "Signals about different stories were grouped together and had to be split.",
  candidate_step_failed: "A lead's evidence or brief could not be finished.",
  coverage_partition_failed: "The existing-coverage check did not finish for one group of outlets.",
  plan_failed: "Follow-up searches could not be planned for a lead.",
};

export function failureText(code: string, message: string): { headline: string; detail: string | null } {
  const headline = FAILURE_TEXT[code];
  return headline === undefined ? { headline: message, detail: null } : { headline, detail: message };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/unit/scan/failure-text.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Render it**

In `src/components/scan/scan-progress.tsx`, add the import:

```tsx
import { failureText } from "@/lib/failure-text";
```

Replace the failure list:

```tsx
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
```

with:

```tsx
      {scan.failureSummaries.length > 0 && (
        <ul className="mt-3">
          {scan.failureSummaries.map((failure) => {
            const { headline, detail } = failureText(failure.code, failure.message);
            return (
              <li key={`${failure.purpose}:${failure.code}`} className="border-t border-rule py-2 text-sm">
                {/* The purpose span keeps its exact text: the e2e suite asserts
                    "coverage" here, and the stage name above is the longer
                    "Reviewing existing coverage", so this is what it targets. */}
                <span className="text-xs uppercase tracking-wide text-muted">{failure.purpose}</span>
                <span className="mt-0.5 block">{headline}</span>
                {detail && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted">Technical detail</summary>
                    <p className="mt-1 font-mono text-xs break-words text-muted">{detail}</p>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
```

- [ ] **Step 6: Run the full check, bare**

Run: `npm run check`
Expected: exit 0, and the output ends with a `Test Files` block. 4 more tests than before.

- [ ] **Step 7: Run the scan-progress e2e**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/scan-progress.spec.ts`
Expected: 9 passed. The "names the purpose" test still finds `coverage` exactly.

- [ ] **Step 8: Commit**

```bash
git add src/lib/failure-text.ts tests/unit/scan/failure-text.test.ts src/components/scan/scan-progress.tsx
git commit -m "feat(scan): say what a failure means in English

The panel printed pipeline messages verbatim: \"batch 5 invalid_output\",
\"brief: invalid_output\". Naming failures is the right instinct; naming
them in code reads as \"this product is broken\" to a reporter. Each
known code now has an English headline and the original message sits
under a Technical detail toggle. Unknown codes fall back to the message.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016fYSsPjHhdehmbrYt8z8Nf"
```

---

### Task 4: Leads first; a finished scan's stages fold away

On a finished scan, the first 900 pixels are four rows reading DONE and a search-budget counter. The editor came for leads. While a scan is running, the stages are the thing to watch, so the order flips only when the scan is finished.

**Files:**
- Modify: `src/app/workspace/page.tsx:52-75`
- Modify: `src/components/scan/scan-progress.tsx:78-110`
- Modify: `tests/e2e/scan-progress.spec.ts` (one new test)

**Interfaces:**
- Consumes: `ScanProgress` props unchanged.
- Produces: on a finished scan, stage rows and the search-budget line sit inside `<details>` with summary text `How this scan ran`. Counts, failures, buttons, and the terminal label stay outside it.

- [ ] **Step 1: Write the failing e2e test**

Append inside the `test.describe("scan progress", ...)` block in `tests/e2e/scan-progress.spec.ts`:

```ts
  test("a finished scan folds its stages away, and they can be opened", async ({ page }) => {
    // Four rows reading DONE are not information to an editor reading a
    // finished scan; the counts and the failures are. The stages stay one
    // click away rather than being removed.
    seed("briefs", "partial", true, { eligibleCount: 1, excludedCount: 9, processingCount: 0 });
    await signInOnly(page);
    await page.goto("/workspace");

    const panel = page.getByRole("region", { name: "Scan progress" });
    await expect(panel.getByText("1 ready")).toBeVisible();
    await expect(panel.getByText("Discovering signals", { exact: true })).toBeHidden();

    await panel.getByText("How this scan ran").click();
    await expect(panel.getByText("Discovering signals", { exact: true })).toBeVisible();
    await expect(panel.getByText(/of 120 searches/)).toBeVisible();
  });

  test("a finished scan shows its leads above its progress", async ({ page }) => {
    seed("briefs", "partial", false, { eligibleCount: 1, excludedCount: 9, processingCount: 0 });
    await signInOnly(page);
    await page.goto("/workspace");

    const leads = page.getByRole("region", { name: "Leads" });
    const progress = page.getByRole("region", { name: "Scan progress" });
    const leadsTop = await leads.evaluate((el) => el.getBoundingClientRect().top);
    const progressTop = await progress.evaluate((el) => el.getBoundingClientRect().top);
    expect(leadsTop).toBeLessThan(progressTop);
  });

  test("a running scan keeps its progress above its leads", async ({ page }) => {
    seed("coverage", "running");
    await signInOnly(page);
    await page.goto("/workspace");

    const leads = page.getByRole("region", { name: "Leads" });
    const progress = page.getByRole("region", { name: "Scan progress" });
    const leadsTop = await leads.evaluate((el) => el.getBoundingClientRect().top);
    const progressTop = await progress.evaluate((el) => el.getBoundingClientRect().top);
    expect(progressTop).toBeLessThan(leadsTop);
  });
```

- [ ] **Step 2: Run them to see the first two fail**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/scan-progress.spec.ts`
Expected: 2 failed ("folds its stages away": `Discovering signals` is visible; "leads above": leadsTop is greater), 1 passed (running order is already correct), 9 existing passed.

- [ ] **Step 3: Fold the stages on a finished scan**

In `src/components/scan/scan-progress.tsx`, replace the `<ol>` and the two `<p>` lines after it (stages, counts, search budget) with:

```tsx
      {/* All three counts, always, and always visible: two zeroes and a
          number is information, and it is the first thing an editor reads. */}
      <p className="mt-3 text-sm text-muted">
        <strong className="font-semibold text-ink">{scan.eligibleCount}</strong> ready
        {" · "}
        <strong className="font-semibold text-ink">{scan.excludedCount}</strong> did not qualify
        {" · "}
        <strong className="font-semibold text-ink">{scan.processingCount}</strong> still working
      </p>

      {/* While the scan runs, the stages are what an editor watches, so they
          stay open. Once it is finished they are four rows reading DONE and a
          budget counter -- one click away, never gone. */}
      {isFinished ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-muted">How this scan ran</summary>
          <StageRows scan={scan} />
          <p className="mt-1 text-sm text-muted">
            {scan.searchesReserved} of {scan.searchBudgetLimit} searches used
            {scan.searchesFailed > 0 && ` · ${scan.searchesFailed} failed`}
          </p>
        </details>
      ) : (
        <>
          <StageRows scan={scan} />
          <p className="mt-1 text-sm text-muted">
            {scan.searchesReserved} of {scan.searchBudgetLimit} searches used
            {scan.searchesFailed > 0 && ` · ${scan.searchesFailed} failed`}
          </p>
        </>
      )}
```

Then add this component above `export function ScanProgress`:

```tsx
function StageRows({ scan }: { scan: Scan }) {
  return (
    <ol className="mt-3.5">
      {STAGE_ORDER.map((stage) => (
        <li key={stage} className="grid grid-cols-[1fr_auto] gap-4 border-t border-rule py-2.5 last:border-b">
          <span className="text-sm">{STAGE_TEXT[stage]}</span>
          <span className="text-xs uppercase tracking-wide text-muted">{STATE_TEXT[stageState(stage, scan)]}</span>
        </li>
      ))}
    </ol>
  );
}
```

The `analysisProgress` paragraph that followed the search-budget line is unchanged; it already renders only when `!isFinished`, so leave it where it is, after the block above.

- [ ] **Step 4: Put leads first on a finished scan**

In `src/app/workspace/page.tsx`, inside the IIFE that renders the section, replace the `return (...)` with:

```tsx
          const finished = shown.status === "completed" || shown.status === "partial" || shown.status === "canceled";
          const progress = (
            <ScanProgress
              scan={shown}
              onCancel={() => {
                cancelScan({ scanId: shown._id })
                  .catch((err: unknown) => setStartError(err instanceof Error ? err.message : "Could not cancel scan"));
              }}
              onRunNewScan={handleStart}
              runNewScanDisabled={starting}
              onOpenSavedDemo={savedDemo && !isShowingSaved ? () => setViewingSavedDemo(true) : undefined}
              onShowLatestScan={isShowingSaved && latest._id !== savedDemo?._id ? () => setViewingSavedDemo(false) : undefined}
            />
          );
          const feed = <LeadFeed scan={shown} onRunNewScan={handleStart} runNewScanDisabled={starting} />;
          return (
            <section aria-labelledby="latest-scan">
              <h1 id="latest-scan" className="font-editorial text-3xl">
                {isShowingSaved ? "Saved scan" : "Latest scan"}
              </h1>
              {/* An editor watches a running scan and reads a finished one.
                  The order follows that: progress first while work is in
                  flight, leads first once there is a verdict to read. */}
              {finished ? <>{feed}{progress}</> : <>{progress}{feed}</>}
            </section>
          );
```

- [ ] **Step 5: Run the spec to see all pass**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/scan-progress.spec.ts`
Expected: 12 passed.

- [ ] **Step 6: Run the whole e2e suite and the check**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test`
Expected: all passed (51). The saved-demo, feed, and first-run specs locate regions by role, not position.

Run: `npm run check`
Expected: exit 0 with the `Test Files` block.

- [ ] **Step 7: Look at it once, at 375px, in both themes**

Run: `PORT=3100 npm run dev` in one shell if not already running, then `npx tsx scripts/check-saved-demo.mts /tmp/sg` and read `/tmp/sg-saved.png`. The lead card should be the first thing under the heading; the status panel below it; "How this scan ran" closed.

- [ ] **Step 8: Commit**

```bash
git add src/app/workspace/page.tsx src/components/scan/scan-progress.tsx tests/e2e/scan-progress.spec.ts
git commit -m "feat(workspace): leads first on a finished scan

On a finished scan the first 900 pixels were four stage rows reading DONE
and a search-budget counter, with the one lead an editor came for below
them. Now: while a scan runs, progress leads and the stages stay open;
once it is finished, the feed comes first and the stages fold under
\"How this scan ran\", one click away rather than removed. Counts,
failures and buttons never fold.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016fYSsPjHhdehmbrYt8z8Nf"
```

---

### Task 5: "Start here" on the lead page

The brief's one-sentence summary is the coverage gap in a line, and the seven interview questions are the most useful thing on the page. They are 2,500 pixels down. Hoist them to directly under the headline; the full brief keeps its sourced sections.

**Files:**
- Create: `src/components/evidence/start-here.tsx`
- Modify: `src/components/evidence/reporting-brief.tsx:34-36, 56-65`
- Modify: `src/components/evidence/evidence-view.tsx:44`
- Modify: `tests/e2e/evidence-vertical-slice.spec.ts` (one new test)

**Interfaces:**
- Consumes: `BriefView` from `src/lib/evidence-view.ts` (`whySurfaced: string`, `interviewQuestions: string[]`, `version: number`).
- Produces: `StartHere({ brief }: { brief: BriefView | null })`, a section with `aria-labelledby="start-here-heading"`.

- [ ] **Step 1: Write the failing e2e test**

Append inside the outermost `test.describe` in `tests/e2e/evidence-vertical-slice.spec.ts` (or at the end of the file if tests are top-level there):

```ts
test("the brief's summary and questions sit directly under the headline", async ({ page }) => {
  // The one sentence that names the coverage gap, and the questions a
  // reporter would actually ask, used to be the last things on the page.
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toBeVisible({ timeout: 20_000 });
  const start = page.getByRole("region", { name: "Start here" });
  await expect(start).toBeVisible();
  await expect(start.getByText("Questions to ask")).toBeVisible();

  const h1Top = await h1.evaluate((el) => el.getBoundingClientRect().top);
  const startTop = await start.evaluate((el) => el.getBoundingClientRect().top);
  const score = page.getByRole("region", { name: "Score" });
  const scoreTop = await score.evaluate((el) => el.getBoundingClientRect().top);
  expect(startTop).toBeGreaterThan(h1Top);
  expect(startTop).toBeLessThan(scoreTop);
});
```

Note: `getByRole("region", { name })` resolves through `aria-labelledby`, which both the new section and the existing Score section use.

- [ ] **Step 2: Run it to see it fail**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/evidence-vertical-slice.spec.ts`
Expected: the new test fails, region "Start here" not found. Existing tests pass.

- [ ] **Step 3: Create the component**

Create `src/components/evidence/start-here.tsx`:

```tsx
import type { BriefView } from "@/lib/evidence-view";

/**
 * The two pieces of the brief a reporter acts on, placed where they will be
 * read first: the sentence that says why this is a story, and the questions
 * to ask. Everything else on the page is evidence FOR these two things.
 *
 * Same ground and standing label as the brief (`--ai-tint`), because this is
 * AI-drafted prose and must never be read as sourced evidence. The label is
 * words, not a colour, so it survives greyscale and a screen reader.
 */
export function StartHere({ brief }: { brief: BriefView | null }) {
  if (!brief) return null;
  return (
    <section
      aria-labelledby="start-here-heading"
      className="rounded-md border border-rule bg-[var(--ai-tint)] px-5 py-4.5"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--status-caution)]">
        AI-drafted · read this before the evidence · version {brief.version}
      </p>
      <h2 id="start-here-heading" className="mt-1 font-editorial text-xl">Start here</h2>
      <p className="mt-2 text-sm">{brief.whySurfaced}</p>

      {brief.interviewQuestions.length > 0 && (
        <div className="mt-3.5">
          <h3 className="text-sm font-semibold">Questions to ask</h3>
          <ol className="mt-1 list-decimal pl-5 text-sm marker:text-muted">
            {brief.interviewQuestions.map((question) => (
              <li key={question} className="pl-1">{question}</li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Mount it and move the two pieces out of the brief**

In `src/components/evidence/evidence-view.tsx`, add the import:

```tsx
import { StartHere } from "./start-here";
```

and directly after `<LeadCard ... />` insert:

```tsx
      <StartHere brief={view.brief} />
```

In `src/components/evidence/reporting-brief.tsx`, delete this line:

```tsx
        <p className="mt-2 text-sm">{brief.whySurfaced}</p>
```

and delete the whole `{brief.interviewQuestions.length > 0 && ( ... )}` block at the end of the tinted div. Change the section heading text from `Reporting brief` to `Full brief` in the non-null branch only (the "No brief has been written" branch keeps `Reporting brief`).

- [ ] **Step 5: Check nothing else asserted the old placement**

Run: `grep -rn "Suggested interview questions\|whySurfaced" tests/ src/ | grep -v "start-here\|evidence-view.ts\|convex"`
Expected: no test references. If a unit test under `tests/unit/design/` reads component source for forbidden strings, it is unaffected: no new hex, no new primitive.

- [ ] **Step 6: Run the spec, the suite, and the check**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/evidence-vertical-slice.spec.ts`
Expected: all passed including the new one.

Run: `npm run check`
Expected: exit 0 with the `Test Files` block.

- [ ] **Step 7: Commit**

```bash
git add src/components/evidence/start-here.tsx src/components/evidence/reporting-brief.tsx src/components/evidence/evidence-view.tsx tests/e2e/evidence-vertical-slice.spec.ts
git commit -m "feat(evidence): put the brief's payoff under the headline

The brief's one-sentence summary is the coverage gap in a line, and the
interview questions are the most useful thing on the page. They sat
2,500 pixels down, after a score table and three empty sections. Hoisted
into a Start here block directly under the reporting question, on the
same AI-tinted ground with the same standing label. The full brief keeps
its sourced sections below.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016fYSsPjHhdehmbrYt8z8Nf"
```

---

### Task 6: Empty evidence sections collapse to one line each

On the flagship lead, Confirmed facts, Unverified signals and Conflicting claims are all empty, and each takes a full headed section. Three headings that say "nothing" in a row read as thinness. One compact list says the same thing honestly in a quarter of the space. The confirmed-facts warning keeps its full wording because it carries the product's central caveat.

**Files:**
- Modify: `src/components/evidence/evidence-view.tsx:19-25, 46-61`
- Modify: `tests/e2e/evidence-vertical-slice.spec.ts` (one new test)

**Interfaces:**
- Produces: a section with `aria-labelledby="absent-heading"` and heading text `Not found in the cited sources`, rendered only when at least one kind is empty.

- [ ] **Step 1: Write the failing e2e test**

Append to `tests/e2e/evidence-vertical-slice.spec.ts`:

```ts
test("empty evidence kinds share one compact section instead of three empty ones", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
  const absent = page.getByRole("region", { name: "Not found in the cited sources" });
  await expect(absent).toBeVisible();
  // The confirmed-facts caveat is the product's central warning and keeps
  // its full wording wherever it lands.
  await expect(absent.getByText(/Treat every claim on this page as unverified/)).toBeVisible();
  // An empty kind no longer gets its own level-2 heading.
  await expect(page.getByRole("heading", { level: 2, name: "Conflicting claims" })).toHaveCount(0);
});
```

This assumes the slice fixture has no conflicting claims. Confirm first:

Run: `grep -n "conflicting_claim" convex/testing.ts | head -3`
Expected: no `conflicting_claim` evidence in `seedSliceFixture`. If there is one, change the heading in the last assertion to whichever kind the fixture leaves empty.

- [ ] **Step 2: Run it to see it fail**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/evidence-vertical-slice.spec.ts`
Expected: the new test fails, region not found.

- [ ] **Step 3: Split present from absent**

In `src/components/evidence/evidence-view.tsx`, change the confirmed-facts empty text:

```tsx
  { kind: "confirmed_fact", heading: "Confirmed facts", empty: "Nothing here has been independently confirmed yet. Treat every claim on this page as unverified." },
```

Then replace the `{KIND_SECTIONS.map(...)}` block with:

```tsx
      {(() => {
        const present = KIND_SECTIONS.filter(({ kind }) => view.evidence.some((e) => e.kind === kind));
        const absent = KIND_SECTIONS.filter(({ kind }) => !view.evidence.some((e) => e.kind === kind));
        return (
          <>
            {present.map(({ kind, heading }) => (
              <section key={kind} aria-labelledby={`section-${kind}`} className="border-t border-rule pt-5">
                <h2 id={`section-${kind}`} className="font-editorial text-xl">{heading}</h2>
                <div className="mt-3.5 flex flex-col gap-3.5">
                  {view.evidence.filter((e) => e.kind === kind).map((entry) => <EvidenceItem key={entry.id} entry={entry} />)}
                </div>
              </section>
            ))}
            {/* Three headed sections that each say "nothing" read as thinness.
                One list says the same thing, and the confirmed-facts caveat
                keeps its full wording because it is the product's central
                warning, not a placeholder. */}
            {absent.length > 0 && (
              <section aria-labelledby="absent-heading" className="border-t border-rule pt-5">
                <h2 id="absent-heading" className="font-editorial text-xl">Not found in the cited sources</h2>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted">
                  {absent.map(({ kind, heading, empty }) => (
                    <li key={kind}>
                      <span className="font-medium text-ink">{heading}.</span> {empty}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        );
      })()}
```

- [ ] **Step 4: Check the old wording is not asserted elsewhere**

Run: `grep -rn "Treat every claim below" tests/ src/`
Expected: no matches. If a test matches, update it to `Treat every claim on this page`.

- [ ] **Step 5: Run the spec and the check**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/evidence-vertical-slice.spec.ts`
Expected: all passed.

Run: `npm run check`
Expected: exit 0 with the `Test Files` block.

- [ ] **Step 6: Commit**

```bash
git add src/components/evidence/evidence-view.tsx tests/e2e/evidence-vertical-slice.spec.ts
git commit -m "feat(evidence): fold empty evidence kinds into one line each

On the flagship lead, Confirmed facts, Unverified signals and Conflicting
claims were all empty and each took a full headed section. Three
headings saying \"nothing\" in a row read as thinness. Kinds with entries
keep their sections; kinds without share one list under \"Not found in
the cited sources\". The confirmed-facts caveat keeps its full wording.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016fYSsPjHhdehmbrYt8z8Nf"
```

---

### Task 7: Never show a beat the rules rejected

A rejected card reads "Housing and neighborhood development" and, two lines down, "it does not fall in a covered beat." The rules already said no beat. The card should say what the rules said. In the saved scan this covers 93 of the 129 housing-labelled leads; the other 36 were accepted as housing by the rules and are out of scope.

**Files:**
- Modify: `src/lib/source-labels.ts:46`
- Modify: `tests/unit/source-labels.test.ts`
- Modify: `src/components/feed/lead-card.tsx:56,60`
- Modify: `src/components/evidence/lead-card.tsx:3,25`

**Interfaces:**
- Produces: `displayBeat(beat: Beat | undefined, exclusionReasons: readonly string[]): string`.

- [ ] **Step 1: Write the failing test**

Append to the `describe("source labels", ...)` block in `tests/unit/source-labels.test.ts`, and add `displayBeat` and `BEAT_UNSET_TEXT` to the import from `@/lib/source-labels`:

```ts
  it("does not name a beat the rules rejected", () => {
    // A card that says \"Housing\" and, two lines down, \"does not fall in a
    // covered beat\" is the product contradicting itself. The rules' verdict
    // wins over the classifier's suggestion on screen, as it does everywhere.
    expect(displayBeat("housing", ["no_beat_relevance", "speculative"])).toBe(BEAT_UNSET_TEXT);
  });

  it("names the beat when the rules did not reject it", () => {
    expect(displayBeat("housing", [])).toBe(BEAT_TEXT.housing);
    expect(displayBeat("housing", ["weak_locality"])).toBe(BEAT_TEXT.housing);
    expect(displayBeat(undefined, [])).toBe(BEAT_UNSET_TEXT);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/source-labels.test.ts`
Expected: FAIL, `displayBeat` is not exported.

- [ ] **Step 3: Add the function**

In `src/lib/source-labels.ts`, after `export const beatText = ...`, add:

```ts
/**
 * The beat a card may show. `no_beat_relevance` is the rules engine saying
 * "this is not in a covered beat", and the classifier's suggestion does not
 * outrank that on screen any more than it does in scoring.
 */
export const displayBeat = (beat: Beat | undefined, exclusionReasons: readonly string[]): string =>
  exclusionReasons.includes("no_beat_relevance") ? BEAT_UNSET_TEXT : beatText(beat);
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/unit/source-labels.test.ts`
Expected: all passed.

- [ ] **Step 5: Use it on both cards**

In `src/components/feed/lead-card.tsx`, change the import `beatText` to `displayBeat` and the beat span to:

```tsx
        <span className="text-xs text-muted">{displayBeat(lead.beat, lead.exclusionReasons)}</span>
```

In `src/components/evidence/lead-card.tsx`, change the import `beatText` to `displayBeat` and the beat span to:

```tsx
        <span className="text-xs text-muted">{displayBeat(candidate.beat, candidate.exclusionReasons)}</span>
```

- [ ] **Step 6: Run the check and the feed e2e**

Run: `npm run check`
Expected: exit 0 with the `Test Files` block.

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/feed.spec.ts`
Expected: all passed. The beat filter runs server-side on the column and is unaffected; no feed assertion reads the beat text on a card.

- [ ] **Step 7: Commit**

```bash
git add src/lib/source-labels.ts tests/unit/source-labels.test.ts src/components/feed/lead-card.tsx src/components/evidence/lead-card.tsx
git commit -m "fix(feed): never show a beat the rules rejected

A rejected card read \"Housing and neighborhood development\" and, two
lines down, \"it does not fall in a covered beat\". The rules had already
said no beat. displayBeat shows Beat not established whenever
no_beat_relevance is among the reasons. In the saved scan this corrects
93 of the 129 housing-labelled cards; the other 36 were accepted as
housing by the rules and would need a paid re-classification.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016fYSsPjHhdehmbrYt8z8Nf"
```

---

### Task 8: Rejection reasons as chips on the feed card

The same five-clause sentence appears verbatim on 235 cards. Chips make the list scannable. The full sentence stays on the lead page's Score section, and both come from one lib, so no rule ever gets two wordings that drift.

**Files:**
- Modify: `src/lib/exclusion-reasons.ts`
- Modify: `tests/unit/exclusion-reasons.test.ts`
- Modify: `src/components/feed/lead-card.tsx:48,61`
- Modify: `tests/e2e/feed.spec.ts:119`

**Interfaces:**
- Produces: `EXCLUSION_REASON_SHORT` (same keys as `EXCLUSION_REASON_TEXT`) and `exclusionChips(reasons): { short: string; long: string }[]`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe("exclusion reasons", ...)` block in `tests/unit/exclusion-reasons.test.ts`, adding `EXCLUSION_REASON_SHORT` and `exclusionChips` to the import:

```ts
  it("has a short form for every reason, and only those reasons", () => {
    expect(Object.keys(EXCLUSION_REASON_SHORT).sort()).toEqual(ALL.slice().sort());
  });

  it("keeps the short form short enough to be a chip", () => {
    for (const text of Object.values(EXCLUSION_REASON_SHORT)) {
      expect(text.length).toBeLessThanOrEqual(20);
      expect(text).not.toMatch(/_/);
      expect(text[0]).toEqual(text[0].toUpperCase());
    }
  });

  it("pairs each chip with the full sentence it stands for", () => {
    const chips = exclusionChips(["insufficient_independence", "stale"]);
    expect(chips).toEqual([
      { short: EXCLUSION_REASON_SHORT.insufficient_independence, long: EXCLUSION_REASON_TEXT.insufficient_independence },
      { short: EXCLUSION_REASON_SHORT.stale, long: EXCLUSION_REASON_TEXT.stale },
    ]);
  });

  it("drops unknown codes from chips too", () => {
    expect(exclusionChips(["not_a_real_code"])).toEqual([]);
    expect(exclusionChips(undefined)).toEqual([]);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/exclusion-reasons.test.ts`
Expected: FAIL, `EXCLUSION_REASON_SHORT` not exported.

- [ ] **Step 3: Add the short forms**

In `src/lib/exclusion-reasons.ts`, after `EXCLUSION_REASON_TEXT`, add:

```ts
/**
 * The same reasons, short enough to sit in a chip. Keyed identically so a
 * reason can never have a sentence without a chip or a chip without a
 * sentence; the unit test enforces that.
 */
export const EXCLUSION_REASON_SHORT: Record<ExclusionReason, string> = {
  weak_locality: "Not Milwaukee",
  stale: "Too old",
  insufficient_independence: "One source",
  no_beat_relevance: "Off-beat",
  already_covered: "Already covered",
  inaccessible_evidence: "Source unreachable",
  coverage_pass_incomplete: "Coverage unchecked",
  promotional: "Promotion",
  duplicate: "Duplicate",
  speculative: "Speculation",
  routine_crime: "Routine crime",
  unreadable_evidence: "Unreadable",
};

/** One chip per known reason, each carrying the full sentence for its title. */
export function exclusionChips(reasons: readonly string[] | undefined): { short: string; long: string }[] {
  return (reasons ?? []).filter(isKnown).map((r) => ({ short: EXCLUSION_REASON_SHORT[r], long: EXCLUSION_REASON_TEXT[r] }));
}
```

Note `ExclusionReason` is declared after `EXCLUSION_REASON_TEXT` in the file; place the new block after the `export type ExclusionReason` line and after `isKnown`.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run tests/unit/exclusion-reasons.test.ts`
Expected: all passed.

- [ ] **Step 5: Update the feed e2e assertion first**

In `tests/e2e/feed.spec.ts`, replace:

```ts
    await expect(feed.getByText(/^Did not qualify: /)).toHaveCount(30);
```

with:

```ts
    // One chip list per card. The full sentence lives on the lead page.
    await expect(feed.getByRole("list", { name: "Why it did not qualify" })).toHaveCount(30);
```

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/feed.spec.ts -g "names a reason"`
Expected: FAIL, list not found.

- [ ] **Step 6: Render chips on the card**

In `src/components/feed/lead-card.tsx`, change the import from `exclusionSentence` to `exclusionChips`, change:

```tsx
  const reasons = exclusionSentence(lead.exclusionReasons);
```
to
```tsx
  const chips = exclusionChips(lead.exclusionReasons);
```

and replace:

```tsx
      {reasons && <p className="text-sm text-muted">{reasons}</p>}
```

with:

```tsx
      {chips.length > 0 && (
        <ul aria-label="Why it did not qualify" className="flex flex-wrap gap-1.5">
          {chips.map(({ short, long }) => (
            <li
              key={short}
              title={long}
              className="inline-flex items-center rounded-sm border border-rule px-1.5 py-0.5 font-ui text-xs text-muted"
            >
              {short}
            </li>
          ))}
        </ul>
      )}
```

- [ ] **Step 7: Run the feed e2e, the suite, and the check**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/feed.spec.ts`
Expected: all passed.

Run: `npm run check`
Expected: exit 0 with the `Test Files` block.

- [ ] **Step 8: Commit**

```bash
git add src/lib/exclusion-reasons.ts tests/unit/exclusion-reasons.test.ts src/components/feed/lead-card.tsx tests/e2e/feed.spec.ts
git commit -m "feat(feed): rejection reasons as chips on the card

The same five-clause sentence appeared verbatim on 235 cards. Each reason
now has a short form next to its sentence in one lib, so a rule can never
carry two wordings that drift, and the card shows chips with the full
sentence as each chip's title. The lead page keeps the sentence.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016fYSsPjHhdehmbrYt8z8Nf"
```

---

### Task 9: The disposition mutation

The only interactive control on the lead page is Dark mode. This is the mutation that changes that: one public function that sets `disposition` on the candidate and writes an `editorEvents` row saying who changed what, from what, with what note.

**Files:**
- Create: `convex/candidates/disposition.ts`
- Create: `tests/integration/disposition.test.ts`

**Interfaces:**
- Consumes: `requireUser` from `convex/lib/auth.ts`; `V.vDisposition` from `convex/lib/validators.ts`; the `editorEvents` table shape in `convex/schema.ts` (`before`/`after` are `Record<string, string>`; `type` is one of `disposition_changed | note_added | ...`).
- Produces: `api.candidates.disposition.set({ candidateId: Id<"candidates">, disposition: "new" | "rejected" | "monitoring" | "assigned", note?: string })` returning `null`.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/disposition.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { scanDoc } from "../fixtures/factories";
import { asUser, setup } from "./helpers";

/**
 * Item 9 Part B, the first half: an editor can reject, monitor or assign a
 * lead and leave a note, and the product records who did it and from what.
 * Before this, the lead page's only control was Dark mode.
 */
async function seedLeadFor(t: ReturnType<typeof setup>, clerkUserId: string) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId, createdAt: now, updatedAt: now });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId, { startedAt: now }) as never) as Id<"scans">;
    const candidateId = await ctx.db.insert("candidates", {
      ownerId, fingerprint: "fp", currentTitle: "T", reportingQuestion: "Q?",
      status: "eligible" as const, primaryLabel: "Coverage gap" as const,
      disposition: "new" as const, latestEvidenceVersion: 1,
      independentCategoryCount: 2, coverageOriginalCount: 0, coveragePassStatus: "complete" as const,
      exclusionReasons: [], firstSeenAt: now, lastSeenAt: now, updatedAt: now,
    });
    await ctx.db.insert("candidateAppearances", {
      candidateId, scanId, ownerId,
      statusAtScan: "eligible" as const, labelAtScan: "Coverage gap" as const, dispositionAtScan: "new" as const, rank: 1,
    });
    return { ownerId, scanId, candidateId };
  });
}

const events = (t: ReturnType<typeof setup>, candidateId: Id<"candidates">) =>
  t.run(async (ctx) =>
    await ctx.db.query("editorEvents").withIndex("by_candidate_created", (q) => q.eq("candidateId", candidateId)).collect(),
  );

describe("candidates.disposition.set", () => {
  it("changes the disposition and records who changed it from what", async () => {
    const t = setup();
    const { ownerId, candidateId, scanId } = await seedLeadFor(t, "editor");
    const editor = asUser(t, "editor");

    await editor.mutation(api.candidates.disposition.set, { candidateId, disposition: "assigned", note: "Give to Maria" });

    const candidate = await t.run(async (ctx) => await ctx.db.get(candidateId));
    expect(candidate?.disposition).toBe("assigned");

    const [event] = await events(t, candidateId);
    expect(event).toMatchObject({
      type: "disposition_changed",
      before: { disposition: "new" },
      after: { disposition: "assigned" },
      note: "Give to Maria",
      actorUserId: ownerId,
      scanId,
    });
  });

  it("records a note on its own without touching the disposition", async () => {
    const t = setup();
    const { candidateId } = await seedLeadFor(t, "editor");
    const editor = asUser(t, "editor");

    await editor.mutation(api.candidates.disposition.set, { candidateId, disposition: "new", note: "Ask county about matching funds" });

    expect((await t.run(async (ctx) => await ctx.db.get(candidateId)))?.disposition).toBe("new");
    const [event] = await events(t, candidateId);
    expect(event.type).toBe("note_added");
    expect(event.before).toBeUndefined();
    expect(event.note).toBe("Ask county about matching funds");
  });

  it("writes nothing when nothing changed", async () => {
    const t = setup();
    const { candidateId } = await seedLeadFor(t, "editor");
    const editor = asUser(t, "editor");

    await editor.mutation(api.candidates.disposition.set, { candidateId, disposition: "new", note: "   " });

    expect(await events(t, candidateId)).toHaveLength(0);
  });

  it("refuses another owner's lead", async () => {
    const t = setup();
    const { candidateId } = await seedLeadFor(t, "editor");
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", { clerkUserId: "stranger", createdAt: now, updatedAt: now });
    });

    await expect(
      asUser(t, "stranger").mutation(api.candidates.disposition.set, { candidateId, disposition: "rejected" }),
    ).rejects.toThrow(/Lead not found/);
    expect((await t.run(async (ctx) => await ctx.db.get(candidateId)))?.disposition).toBe("new");
  });

  it("refuses anonymous callers", async () => {
    const t = setup();
    const { candidateId } = await seedLeadFor(t, "editor");
    await expect(t.mutation(api.candidates.disposition.set, { candidateId, disposition: "rejected" })).rejects.toThrow(/Unauthenticated/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/integration/disposition.test.ts`
Expected: FAIL, `api.candidates.disposition` is undefined (typecheck) or the module does not exist.

- [ ] **Step 3: Write the mutation**

Create `convex/candidates/disposition.ts`:

```ts
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireUser } from "../lib/auth";
import * as V from "../lib/validators";

/**
 * An editor's decision about a lead: reject it, monitor it, assign it, or
 * leave a note. This is the one thing on the lead page a person DOES.
 *
 * `disposition` is an editorial column, not a rules verdict, so writing it
 * here does not cross `evaluate.ts`, which owns status, label, score and the
 * exclusion reasons. `candidateAppearances.dispositionAtScan` is the frozen
 * per-scan record and is deliberately left alone: the feed filters on the
 * live column, and history is the events table's job.
 *
 * Every change writes an `editorEvents` row with before/after and the actor,
 * because "who decided this?" must always be answerable (decision 004).
 */
export const set = mutation({
  args: {
    candidateId: v.id("candidates"),
    disposition: V.vDisposition,
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { candidateId, disposition, note }) => {
    const user = await requireUser(ctx);
    const candidate = await ctx.db.get(candidateId);
    if (!candidate || candidate.ownerId !== user._id) throw new Error("Lead not found");

    const trimmed = (note ?? "").trim().slice(0, 2000);
    const changed = candidate.disposition !== disposition;
    // Nothing to record is nothing to write. A no-op click must not leave an
    // event claiming an editor did something.
    if (!changed && trimmed === "") return null;

    // The event belongs to the scan the editor was looking at, which is the
    // lead's newest appearance -- the same rule evidence.forCandidate uses.
    const appearances = await ctx.db
      .query("candidateAppearances")
      .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId))
      .collect();
    let scanId: Id<"scans"> | undefined;
    let newest = -1;
    for (const appearance of appearances) {
      const scan = await ctx.db.get(appearance.scanId);
      const startedAt = scan?.startedAt ?? 0;
      if (scan && startedAt > newest) { newest = startedAt; scanId = appearance.scanId; }
    }
    if (!scanId) throw new Error("Lead has no scan");

    const now = Date.now();
    if (changed) await ctx.db.patch(candidateId, { disposition, updatedAt: now });
    await ctx.db.insert("editorEvents", {
      candidateId,
      ownerId: user._id,
      scanId,
      actorUserId: user._id,
      type: changed ? "disposition_changed" : "note_added",
      ...(changed ? { before: { disposition: candidate.disposition }, after: { disposition } } : {}),
      ...(trimmed ? { note: trimmed } : {}),
      createdAt: now,
    });
    return null;
  },
});
```

- [ ] **Step 4: Regenerate Convex types, then run the tests**

Run: `npx convex dev --once`
Expected: `Convex functions ready!`

Run: `npx vitest run tests/integration/disposition.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Red-check the ownership guard**

Temporarily change `candidate.ownerId !== user._id` to `false &&` in the mutation, run the test file, confirm "refuses another owner's lead" fails, then restore the line. Do not commit the broken state.

- [ ] **Step 6: Run the full check, bare**

Run: `npm run check`
Expected: exit 0 with the `Test Files` block.

- [ ] **Step 7: Commit**

```bash
git add convex/candidates/disposition.ts tests/integration/disposition.test.ts convex/_generated/api.d.ts
git commit -m "feat(candidates): an editor can reject, monitor, assign, or note a lead

Item 9 Part B, first half. One public mutation sets the candidate's
disposition column and writes an editorEvents row with before/after,
the actor, and an optional note. A note alone records note_added. A
no-op writes nothing. Owner-scoped through requireUser; another owner's
lead is \"not found\". Does not touch evaluate.ts's columns or the frozen
per-scan appearance record.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016fYSsPjHhdehmbrYt8z8Nf"
```

---

### Task 10: The disposition bar

Three buttons and a note field directly under the lead's headline, so the page has a "now what."

**Files:**
- Create: `src/components/evidence/disposition-bar.tsx`
- Modify: `src/components/evidence/evidence-view.tsx` (mount after `LeadCard`, before `StartHere`)
- Create: `tests/e2e/disposition.spec.ts`

**Interfaces:**
- Consumes: `api.candidates.disposition.set` from Task 9; `Button` from `src/components/ui/untitled/button.tsx` (`color`, `size`, `onPress`, `isDisabled`); `EvidenceView["candidate"]` for `id` and `disposition`.
- Produces: a `<section aria-labelledby="disposition-heading">` with buttons named `Assign`, `Monitor`, `Reject`, `Back to new`, a textarea labelled `Note`, and a button `Save note`.

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/disposition.spec.ts`:

```ts
import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { clerkUserId, signInOnly } from "./helpers/auth";

/**
 * The lead page's "now what": an editor assigns a lead, the header says so,
 * a reload still says so, and the feed's disposition filter finds it.
 */
let candidateId = "";

test.beforeAll(async () => {
  const userId = await clerkUserId();
  const out = execSync(`npx convex run internal.testing.seedSliceFixture '${JSON.stringify({ clerkUserId: userId })}'`, { encoding: "utf8" });
  candidateId = JSON.parse(out.slice(out.indexOf("{"))).candidateId as string;
});

// Removed so first-run.spec.ts still reads a clean workspace.
test.afterAll(async () => {
  const userId = await clerkUserId();
  execSync(`npx convex run internal.testing.deleteScansForClerkUser '${JSON.stringify({ clerkUserId: userId })}'`, { stdio: "ignore" });
});

test.beforeEach(async ({ page }) => {
  await signInOnly(page);
  await page.goto(`/leads/${candidateId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
});

test.describe("disposition", () => {
  test("assigning a lead is recorded, survives a reload, and reaches the feed filter", async ({ page }) => {
    const bar = page.getByRole("region", { name: "Your decision" });
    await expect(bar.getByRole("button", { name: "Assign" })).toBeEnabled();

    await bar.getByRole("button", { name: "Assign" }).click();
    // The header's disposition word is the live column; it must change
    // without a reload, and the pressed button must say it is the current one.
    await expect(page.getByRole("banner").getByText("Assigned", { exact: true })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Assign" })).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(page.getByRole("banner").getByText("Assigned", { exact: true })).toBeVisible();

    await page.goto("/workspace?disposition=assigned");
    const feed = page.getByRole("region", { name: "Leads" });
    await expect(feed.getByRole("article")).toHaveCount(1);
  });

  test("a note is saved and the field clears", async ({ page }) => {
    const bar = page.getByRole("region", { name: "Your decision" });
    await bar.getByLabel("Note").fill("Ask the county about matching funds.");
    await bar.getByRole("button", { name: "Save note" }).click();
    await expect(bar.getByText("Note saved")).toBeVisible();
    await expect(bar.getByLabel("Note")).toHaveValue("");
  });

  test("the decision is reachable by keyboard", async ({ page }) => {
    const reject = page.getByRole("region", { name: "Your decision" }).getByRole("button", { name: "Reject" });
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      if (await reject.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(reject).toBeFocused();
  });
});
```

Confirm the feed filter's URL key before relying on it:

Run: `grep -n "disposition" src/lib/feed-filters.ts | head -5`
Expected: the parser reads a `disposition` search param. If the key differs, use that key in the `page.goto` line.

Confirm the lead header is a `<header>` (so `getByRole("banner")` resolves) at `src/components/evidence/lead-card.tsx:20`. It is.

- [ ] **Step 2: Run it to see it fail**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/disposition.spec.ts`
Expected: 3 failed, region "Your decision" not found.

- [ ] **Step 3: Create the component**

Create `src/components/evidence/disposition-bar.tsx`:

```tsx
"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/untitled/button";
import type { EvidenceView } from "@/lib/evidence-view";

type Disposition = EvidenceView["candidate"]["disposition"];

const ACTIONS: { disposition: Disposition; label: string }[] = [
  { disposition: "assigned", label: "Assign" },
  { disposition: "monitoring", label: "Monitor" },
  { disposition: "rejected", label: "Reject" },
];

/**
 * What an editor DOES with a lead. Three decisions and a note, directly under
 * the headline, because a page with nothing to press is a report, not a desk.
 *
 * The current decision is the pressed button (`aria-pressed`), which is a
 * state a screen reader announces and a keyboard user can find. The header's
 * disposition word updates through the live query, so nothing here mirrors it.
 */
export function DispositionBar({ candidate }: { candidate: EvidenceView["candidate"] }) {
  const set = useMutation(api.candidates.disposition.set);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (disposition: Disposition, withNote: string) => {
    setBusy(true); setError(null); setStatus(null);
    try {
      await set({ candidateId: candidate.id, disposition, ...(withNote ? { note: withNote } : {}) });
      if (withNote) { setNote(""); setStatus("Note saved"); }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="disposition-heading" className="border-t border-rule pt-4">
      <h2 id="disposition-heading" className="text-xs font-medium uppercase tracking-wide text-muted">Your decision</h2>

      <div className="mt-2 flex flex-wrap gap-2">
        {ACTIONS.map(({ disposition, label }) => {
          const current = candidate.disposition === disposition;
          return (
            <Button
              key={disposition}
              color={current ? "primary" : "secondary"}
              size="sm"
              aria-pressed={current}
              isDisabled={busy || current}
              onPress={() => void run(disposition, "")}
            >
              {label}
            </Button>
          );
        })}
        {candidate.disposition !== "new" && (
          <Button color="secondary" size="sm" isDisabled={busy} onPress={() => void run("new", "")}>
            Back to new
          </Button>
        )}
      </div>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-muted">Note</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
          className="scheme-light dark:scheme-dark w-full rounded-md border border-rule bg-raised px-2 py-1.5 text-sm text-ink"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button color="secondary" size="sm" isDisabled={busy || note.trim() === ""} onPress={() => void run(candidate.disposition, note.trim())}>
          Save note
        </Button>
        {status && <span role="status" className="text-sm text-muted">{status}</span>}
        {error && <span role="alert" className="text-sm text-[var(--status-conflict)]">{error}</span>}
      </div>
    </section>
  );
}
```

Check the `Button` primitive accepts `aria-pressed` and `color="primary"`:

Run: `grep -n "color\|aria-pressed\|\.\.\.props\|ButtonProps" src/components/ui/untitled/button.tsx | head -10`
Expected: a `color` union including `primary` and `secondary`, and either an explicit `aria-pressed` or a props spread onto the React Aria `Button`. If neither, add `"aria-pressed"?: boolean` to the props type and forward it, keeping the React Aria element.

- [ ] **Step 4: Mount it**

In `src/components/evidence/evidence-view.tsx`, add the import:

```tsx
import { DispositionBar } from "./disposition-bar";
```

and, directly after `<LeadCard ... />` and before `<StartHere ... />`, insert:

```tsx
      <DispositionBar candidate={view.candidate} />
```

- [ ] **Step 5: Run the spec to see it pass**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/disposition.spec.ts`
Expected: 3 passed.

- [ ] **Step 6: Run the whole suite and the check**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test`
Expected: all passed. If `evidence-vertical-slice.spec.ts` counts buttons on the lead page anywhere, update that count.

Run: `npm run check`
Expected: exit 0 with the `Test Files` block.

- [ ] **Step 7: Look at it once in both themes and at 375px**

Open `http://localhost:3100/leads/jh78d9y7g1drwen8gvxvggbjfs8d7bg2` signed in as the owner, toggle Dark mode, narrow to 375px. The three buttons wrap; the pressed one is visibly different AND announced (`aria-pressed`); the textarea takes the theme's raised background.

- [ ] **Step 8: Commit**

```bash
git add src/components/evidence/disposition-bar.tsx src/components/evidence/evidence-view.tsx tests/e2e/disposition.spec.ts
git commit -m "feat(evidence): assign, monitor, reject, or note a lead from its page

Item 9 Part B, second half. The lead page's only control was Dark mode;
a page with nothing to press is a report, not a desk. Three decisions
and a note sit directly under the headline. The current decision is the
pressed button, announced through aria-pressed. The header's disposition
word updates through the live query and the feed's disposition filter
finds the lead without any further change.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016fYSsPjHhdehmbrYt8z8Nf"
```

---

## After the last task

- [ ] Update `docs/HANDOFF.md` §3: item 9 Part B is now done (disposition + notes), Part C (histories/comparison) still not started. Refresh the test counts from the final `npm run check` and Playwright runs.
- [ ] Update `docs/hackathon-build/checklist.md` item 9 progress note with the same.
- [ ] Re-run `npx tsx scripts/check-saved-demo.mts /tmp/sg` and read the screenshots: leads first, chips on rejected cards, `Beat not established` where the rules said so, Start here under the headline, the decision bar beneath it.
- [ ] Push.

## Self-review against the spec

**Coverage.** Review table rows 1 through 8 map to Tasks 1 (row 8), 2 (row 7), 3 (row 6), 4 (row 2), 5 and 6 (row 3), 7 (row 4, the honest half), 8 (row 5, the display half), 9 and 10 (row 1). Row 9 (score anchor) is deliberately out of scope with the reason stated.

**Placeholders.** Every code step has its code. Two steps ask the implementer to confirm a fact with a grep before relying on it (the feed filter's URL key, the Button primitive's props); each says what to do in both outcomes.

**Type consistency.** `displayBeat(beat, exclusionReasons)` in Task 7 matches its two call sites. `exclusionChips` returns `{ short, long }[]` in Task 8 and the card destructures exactly that. `api.candidates.disposition.set` takes `{ candidateId, disposition, note? }` in Task 9 and the bar calls it with exactly that in Task 10. The region names `Scan progress`, `Leads`, `Score`, `Start here`, `Not found in the cited sources`, and `Your decision` all resolve through `aria-labelledby` to headings with the same text.
