import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import { REQUIRED_COVERAGE_GROUPS } from "../config/coverageOutlets";
import { SEARCH_BUDGET } from "../config/searchBudget";
import { MILWAUKEE_LOCATION, type SearchSpec } from "../integrations/serpapi/contracts";
import { runExecuteSearch } from "../integrations/serpapi/executeSearch";
import { getTemplate, renderQuery } from "../integrations/serpapi/queryCatalog";

export const vCoverageStageOutcome = v.object({
  checked: v.number(),
  attempted: v.number(),
  skippedForBudget: v.number(),
  // A candidate with no usable search terms was never a budget decision —
  // telemetry that folded it into skippedForBudget would tell an operator the
  // wrong story about why coverage came back thin.
  skippedNoTerms: v.number(),
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
  const outcome: CoverageStageOutcome = {
    checked: 0, attempted: 0, skippedForBudget: 0, skippedNoTerms: 0, canceled: false,
  };
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
      outcome.skippedNoTerms++;
      continue;
    }

    outcome.attempted++;
    let allSucceeded = true;

    for (const group of REQUIRED_COVERAGE_GROUPS) {
      // Checked before EVERY partition, not once per candidate. An editor who
      // cancels mid-stage must not be billed for the rest of the list.
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
        candidateId,
      };

      const result = await runExecuteSearch(ctx, { scanId, spec }, options);
      spent++;

      if (result.status === "succeeded" && result.runId) {
        await ctx.runMutation(internal.candidates.coverage.recordPartition, { candidateId, group, status: "succeeded" });
        await ctx.runMutation(internal.candidates.coverage.attachReports, {
          scanId, candidateId, searchRunId: result.runId, now,
        });
      } else if (result.status === "failed") {
        allSucceeded = false;
        await ctx.runMutation(internal.candidates.coverage.recordPartition, { candidateId, group, status: "failed" });
        // The real error, not a static stand-in: recordFailure dedupes by
        // purpose+code, so a generic code here would let a second, different
        // coverage failure (a rate limit after a timeout, say) go unreported.
        const run = result.runId ? await ctx.runQuery(internal.searchRuns.getRun, { runId: result.runId }) : null;
        await ctx.runMutation(internal.scans.recordFailure, {
          scanId, purpose: "coverage",
          code: run?.errorCode ?? "coverage_partition_failed",
          message: run?.errorMessage ?? `the ${group} coverage partition failed; no coverage gap can be claimed`,
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
