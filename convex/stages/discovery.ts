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

  outcome.sourceResultIds = await ctx.runQuery(internal.sourceResults.idsForScan, { scanId, purpose: "discovery" });
  return outcome;
}

export const discover = internalAction({
  args: { scanId: v.id("scans") },
  returns: vDiscoveryOutcome,
  handler: (ctx, args): Promise<DiscoveryOutcome> => runDiscoveryStage(ctx, args),
});
