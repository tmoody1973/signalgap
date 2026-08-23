import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { COVERAGE_WINDOW_MS } from "../config/ruleset";
import { evaluateCandidate } from "../editorial/status";
import type { CandidateInput, CoverageInput, EngineSource, LocalityBand, RelevanceBand } from "../editorial/types";
import { toEngineSource } from "./toEngineSource";

/**
 * The single writer of a candidate's verdict.
 *
 * Nothing here decides anything. It assembles the input the pure rules engine
 * takes, calls `evaluateCandidate`, and writes back exactly what came out. If a
 * verdict ever looks wrong, the bug is in `convex/editorial/`, not here — and
 * that separation is the whole product claim.
 */
export const evaluate = internalMutation({
  args: { scanId: v.id("scans"), candidateId: v.id("candidates"), now: v.optional(v.number()) },
  returns: v.union(
    v.object({
      status: v.union(v.literal("eligible"), v.literal("excluded")),
      label: v.string(),
      scoreTotal: v.union(v.number(), v.null()),
      reasons: v.array(v.string()),
    }),
    v.object({ rejected: v.union(v.literal("candidate_not_found"), v.literal("no_judgment")) }),
  ),
  handler: async (ctx, { scanId, candidateId, now = Date.now() }) => {
    const candidate = await ctx.db.get(candidateId);
    if (!candidate) return { rejected: "candidate_not_found" as const };

    // No judgment means no bands. Guessing a band is fabricating 40 points.
    const judgment = candidate.judgment;
    if (!judgment) return { rejected: "no_judgment" as const };

    const memberships = await ctx.db
      .query("candidateSources")
      .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId).eq("scanId", scanId))
      .collect();

    const sources: EngineSource[] = [];
    const coverageReports: CoverageInput["reports"] = [];
    let initiatingSignalAt = now;

    for (const membership of memberships) {
      const row = await ctx.db.get(membership.sourceResultId);
      if (!row) continue;

      if (membership.role === "coverage") {
        // Coverage reports are counted separately from confirming sources, and
        // only inside the 30-day window — outside it, a story is not "prior
        // coverage of this development", it is a different story.
        if (row.publishedAt !== undefined && now - row.publishedAt <= COVERAGE_WINDOW_MS) {
          coverageReports.push({
            id: row._id as string,
            independenceGroup: membership.independenceGroup,
            group: "general",
          });
        }
        continue;
      }

      if (membership.role === "initiating" && row.publishedAt !== undefined) initiatingSignalAt = row.publishedAt;

      sources.push(toEngineSource({
        sourceResultId: row._id as string,
        sourceFamily: row.sourceFamily,
        canonicalUrl: row.canonicalUrl,
        publisher: row.publisher ?? null,
        publishedAt: row.publishedAt,
        isAccessible: row.isAccessible,
        role: membership.role,
        independenceGroupOverride: membership.independenceGroup,
        signalCategoryOverride: membership.signalCategory,
        isPromotional: false,
      }));
    }

    const partition = candidate.coveragePassStatus === "complete" ? "succeeded"
      : candidate.coveragePassStatus === "failed" ? "failed" : "pending";
    const coverage: CoverageInput = {
      partitions: { general: partition, community: partition },
      reports: coverageReports,
    };

    const input: CandidateInput = {
      localityBand: (judgment.localityBand?.value ?? "none") as LocalityBand,
      relevanceBand: (judgment.relevanceBand?.value ?? "promotion_only") as RelevanceBand,
      beat: (judgment.beat?.value ?? null) as CandidateInput["beat"],
      initiatingSignalAt,
      now,
      sources,
      coverage,
      hasTrendMomentum: sources.some((s) => s.signalCategory === "trend"),
      isDuplicateOfCandidate: judgment.isDuplicateOfCandidate.value,
      isSpeculative: judgment.isSpeculative.value,
      isRoutineCrime: judgment.isRoutineCrime.value,
      hasMaterialConflict: judgment.hasMaterialConflict.value,
    };

    const verdict = evaluateCandidate(input);

    await ctx.db.patch(candidateId, {
      status: verdict.status,
      primaryLabel: verdict.label,
      // Excluded means no score. Not zero, and never a stale score from before.
      scoreTotal: verdict.score?.total,
      scoreComponents: verdict.score?.components,
      independentCategoryCount: verdict.independence.independentCategoryCount,
      coverageOriginalCount: verdict.coverage.originalReportCount,
      coveragePassStatus: verdict.coverage.passStatus,
      updatedAt: Date.now(),
    });

    const appearance = await ctx.db
      .query("candidateAppearances")
      .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId).eq("scanId", scanId))
      .unique();
    if (appearance) {
      await ctx.db.patch(appearance._id, {
        statusAtScan: verdict.status,
        labelAtScan: verdict.label,
        scoreAtScan: verdict.score?.total,
        coverageCountAtScan: verdict.coverage.originalReportCount,
        categoryCountAtScan: verdict.independence.independentCategoryCount,
      });
    }

    return {
      status: verdict.status,
      label: verdict.label,
      scoreTotal: verdict.score?.total ?? null,
      reasons: verdict.reasons,
    };
  },
});
