import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { outletGroupForDomain } from "../config/coverageOutlets";
import { COVERAGE_WINDOW_MS } from "../config/ruleset";
import { defaultIndependenceGroup, signalCategoryFor } from "./toEngineSource";

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
      .withIndex("by_search_run", (q) => q.eq("searchRunId", searchRunId))
      .collect();

    let attached = 0;
    for (const row of rows) {
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

/**
 * The quoted phrases a coverage search looks for.
 *
 * `formFromCluster` never persists the cluster's `entityKeys` on the
 * candidate — they only feed `candidateFingerprint` (a one-way hash) and are
 * otherwise discarded (see `convex/candidates/form.ts`). The candidate's own
 * working title is therefore the honest available answer, and the query log
 * shows exactly what ran either way.
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
