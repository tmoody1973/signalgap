import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internalAction, internalQuery } from "../_generated/server";
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
      if (result.status !== "succeeded") {
        // The real error, not a static stand-in: recordFailure dedupes by
        // purpose+code, so a generic code here would let a second, different
        // enrichment failure (a rate limit after a timeout, say) go unreported.
        const run = result.runId ? await ctx.runQuery(internal.searchRuns.getRun, { runId: result.runId }) : null;
        await ctx.runMutation(internal.scans.recordFailure, {
          scanId, purpose: intent.spec.purpose,
          code: run?.errorCode ?? "search_failed",
          message: run?.errorMessage ?? `${intent.spec.templateId} failed`,
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
