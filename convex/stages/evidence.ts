import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internalAction, internalQuery } from "../_generated/server";
import type { GenerateFn } from "../ai/provider";
import { runAnalyzeResults } from "../ai/analyzeResults";
import { CONFIRMING_CATEGORIES } from "../editorial/types";
import { orderForCoverage, prefilterCandidate } from "../editorial/prefilter";
import { runCandidateFormation } from "../slice";

const vFormedCandidateRef = v.object({ candidateId: v.id("candidates"), readyForVerdict: v.boolean() });
export const vEvidenceOutcome = v.object({
  candidates: v.array(vFormedCandidateRef),
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
 *
 * `candidates` carries EVERY formed candidate, including ones formation could
 * not classify — such a candidate still gets finalized, so it still needs a
 * verdict (`convex/editorial/status.ts`'s `unreadableVerdict`). Each entry
 * keeps its own `readyForVerdict` so `finalizeCandidates` knows, per candidate,
 * whether there is an evidence snapshot worth asking a model to write a brief
 * from.
 */
export async function runEvidenceStage(
  ctx: ActionCtx,
  { scanId, sourceResultIds }: { scanId: Id<"scans">; sourceResultIds: Id<"sourceResults">[] },
  generate?: GenerateFn,
): Promise<EvidenceOutcome> {
  const scan = await ctx.runQuery(internal.scans.getForWorkflow, { scanId });
  if (!scan || !scan.isActive || scan.isCancelRequested) {
    return { candidates: [], analyzed: false, canceled: true };
  }
  if (sourceResultIds.length === 0) return { candidates: [], analyzed: false, canceled: false };

  const analyzed = await runAnalyzeResults(ctx, { scanId, sourceResultIds }, generate);
  if (!analyzed.ok) {
    await ctx.runMutation(internal.scans.recordFailure, {
      scanId, purpose: "discovery", code: "analyze_failed", message: analyzed.reason,
    });
    // Analysis adds translation and source-type suggestions. Without it the
    // clusters are thinner, but the sources are real and the scan continues.
  }

  // Checked again here: analysis above was a model call too, and classification
  // ahead runs one more PER CLUSTER — an editor cancelling during "Checking
  // local evidence" must not keep paying for it. `shouldContinue` repeats this
  // same check at the top of the per-cluster loop inside formation itself.
  let canceledDuringFormation = false;
  const shouldContinue = async () => {
    const s = await ctx.runQuery(internal.scans.getForWorkflow, { scanId });
    const ok = !!s && s.isActive && !s.isCancelRequested;
    if (!ok) canceledDuringFormation = true;
    return ok;
  };
  if (!(await shouldContinue())) {
    return { candidates: [], analyzed: analyzed.ok, canceled: true };
  }

  const formed = await runCandidateFormation(ctx, { scanId, sourceResultIds }, generate, shouldContinue);
  if (!formed.ok) {
    await ctx.runMutation(internal.scans.recordFailure, {
      scanId, purpose: "discovery", code: "cluster_failed", message: formed.reason,
    });
    return { candidates: [], analyzed: analyzed.ok, canceled: false };
  }

  return {
    candidates: formed.candidates.map((c) => ({ candidateId: c.candidateId, readyForVerdict: c.readyForVerdict })),
    analyzed: analyzed.ok,
    canceled: canceledDuringFormation,
  };
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
