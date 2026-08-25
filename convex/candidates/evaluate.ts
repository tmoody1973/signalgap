import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { outletGroupForDomain } from "../config/coverageOutlets";
import { COVERAGE_WINDOW_MS } from "../config/ruleset";
import { evaluateCandidate, unreadableVerdict } from "../editorial/status";
import type { CandidateInput, CoverageInput, EngineSource, LocalityBand, RelevanceBand } from "../editorial/types";
import { toEngineSource } from "./toEngineSource";

/**
 * Everything `evaluateCandidate` needs, read off the candidate's sources and
 * its judgment. Only called when a judgment exists — see `evaluate` below.
 */
async function buildInput(
  ctx: MutationCtx,
  { scanId, candidateId, candidate, judgment, now }: {
    scanId: Id<"scans">;
    candidateId: Id<"candidates">;
    candidate: Doc<"candidates">;
    judgment: NonNullable<Doc<"candidates">["judgment"]>;
    now: number;
  },
): Promise<CandidateInput> {
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
        // Same helper `attachReports` used to decide this row WAS coverage
        // (convex/candidates/coverage.ts) — recomputed rather than persisted,
        // so there is exactly one source of truth for what group an outlet is
        // in. A hardcoded "general" here silently reported every community
        // outlet as a general one — final-review.md I5.
        let group: "general" | "community" = "general";
        try { group = outletGroupForDomain(new URL(row.canonicalUrl).hostname) ?? "general"; } catch { /* keep default */ }
        coverageReports.push({ id: row._id as string, independenceGroup: membership.independenceGroup, group });
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

  // Real per-partition state when the coverage stage has run. The fallback
  // maps an old row's single status onto both partitions so a candidate
  // written before this field existed still evaluates the same way.
  const fallback = candidate.coveragePassStatus === "complete" ? "succeeded"
    : candidate.coveragePassStatus === "failed" ? "failed" : "pending";
  const coverage: CoverageInput = {
    partitions: candidate.coveragePartitions ?? { general: fallback, community: fallback },
    reports: coverageReports,
  };

  return {
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
}

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
    v.object({ rejected: v.literal("candidate_not_found") }),
  ),
  handler: async (ctx, { scanId, candidateId, now = Date.now() }) => {
    const candidate = await ctx.db.get(candidateId);
    if (!candidate) return { rejected: "candidate_not_found" as const };

    // A candidate whose classification failed has no bands to judge. It still
    // gets a verdict — the rules engine's honest "we could not read this" —
    // because a lead that silently stays at "processing" appears in neither
    // the feed nor the exclusions list, and an editor never learns it existed.
    const judgment = candidate.judgment;
    const verdict = judgment
      ? evaluateCandidate(await buildInput(ctx, { scanId, candidateId, candidate, judgment, now }))
      : unreadableVerdict();

    await ctx.db.patch(candidateId, {
      status: verdict.status,
      primaryLabel: verdict.label,
      // Excluded means no score. Not zero, and never a stale score from before.
      scoreTotal: verdict.score?.total,
      scoreComponents: verdict.score?.components,
      independentCategoryCount: verdict.independence.independentCategoryCount,
      coverageOriginalCount: verdict.coverage.originalReportCount,
      coveragePassStatus: verdict.coverage.passStatus,
      // Kept so the lead page can name the failed rule instead of showing a blank.
      exclusionReasons: verdict.reasons,
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

export const getEvidenceVersion = internalQuery({
  args: { candidateId: v.id("candidates") },
  returns: v.union(v.null(), v.object({ latestEvidenceVersion: v.number() })),
  handler: async (ctx, { candidateId }) => {
    const candidate = await ctx.db.get(candidateId);
    return candidate ? { latestEvidenceVersion: candidate.latestEvidenceVersion } : null;
  },
});
