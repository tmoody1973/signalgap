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
type FinalizeCandidateRef = { candidateId: Id<"candidates">; readyForVerdict: boolean };

export async function runFinalizeStage(
  ctx: ActionCtx,
  { scanId, candidates, now = Date.now() }: { scanId: Id<"scans">; candidates: FinalizeCandidateRef[]; now?: number },
  generate?: GenerateFn,
): Promise<FinalizeOutcome> {
  let eligible = 0;
  let excluded = 0;

  for (const [index, { candidateId, readyForVerdict }] of candidates.entries()) {
    const scan = await ctx.runQuery(internal.scans.getForWorkflow, { scanId });
    if (!scan || !scan.isActive || scan.isCancelRequested) {
      await ctx.runMutation(internal.scans.setCandidateCounts, {
        scanId, eligibleCount: eligible, excludedCount: excluded,
        processingCount: candidates.length - index,
      });
      return { eligible, excluded, canceled: true };
    }

    const outcome = await runCandidateFinalization(ctx, { scanId, candidateId, readyForVerdict, now }, generate);
    if (outcome.status === "eligible") eligible++;
    else excluded++;

    for (const failure of outcome.failures) {
      await ctx.runMutation(internal.scans.recordFailure, {
        scanId, purpose: "enrichment", code: "candidate_step_failed", message: failure,
      });
    }

    await ctx.runMutation(internal.scans.setCandidateCounts, {
      scanId, eligibleCount: eligible, excludedCount: excluded,
      processingCount: candidates.length - (index + 1),
    });
  }

  return { eligible, excluded, canceled: false };
}

export const finalizeCandidates = internalAction({
  args: { scanId: v.id("scans"), candidates: v.array(v.object({ candidateId: v.id("candidates"), readyForVerdict: v.boolean() })) },
  returns: vFinalizeOutcome,
  handler: (ctx, args): Promise<FinalizeOutcome> => runFinalizeStage(ctx, args),
});
