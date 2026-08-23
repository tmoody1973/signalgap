import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

/**
 * Writes one versioned evidence snapshot.
 *
 * Append-only on purpose: an editor has to be able to see what the system
 * believed last Tuesday, not only what it believes now. Nothing from an earlier
 * version is ever edited or removed.
 */
export const writeSnapshot = internalMutation({
  args: {
    scanId: v.id("scans"),
    candidateId: v.id("candidates"),
    modelRunId: v.id("modelRuns"),
    items: v.array(v.object({
      sourceResultIds: v.array(v.string()),
      kind: v.string(),
      claimText: v.string(),
      exactExcerpt: v.union(v.string(), v.null()),
      originalLanguageText: v.union(v.string(), v.null()),
      translatedText: v.union(v.string(), v.null()),
    })),
  },
  returns: v.union(
    v.object({ evidenceVersion: v.number(), written: v.number() }),
    v.object({
      rejected: v.union(
        v.literal("candidate_not_found"),
        v.literal("cannot_confirm"),
        v.literal("source_not_in_candidate"),
      ),
    }),
  ),
  handler: async (ctx, { scanId, candidateId, modelRunId, items }) => {
    const candidate = await ctx.db.get(candidateId);
    if (!candidate) return { rejected: "candidate_not_found" as const };

    // Confirmation is computed from qualifying sources by the deterministic
    // layer. Nothing arriving through this path may claim it — and one bad item
    // rejects the WHOLE snapshot, because a half-written snapshot is a snapshot
    // an editor would go on to trust.
    if (items.some((i) => i.kind === "confirmed_fact")) return { rejected: "cannot_confirm" as const };

    const memberships = await ctx.db
      .query("candidateSources")
      .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId).eq("scanId", scanId))
      .collect();
    const memberIds = new Set(memberships.map((m) => m.sourceResultId as string));
    if (items.some((i) => i.sourceResultIds.some((id) => !memberIds.has(id)))) {
      return { rejected: "source_not_in_candidate" as const };
    }

    const accessibleById = new Map<string, boolean>();
    for (const membership of memberships) {
      const row = await ctx.db.get(membership.sourceResultId);
      accessibleById.set(membership.sourceResultId as string, row?.isAccessible ?? false);
    }

    const evidenceVersion = candidate.latestEvidenceVersion + 1;
    for (const item of items) {
      await ctx.db.insert("evidenceItems", {
        candidateId,
        scanId,
        ownerId: candidate.ownerId,
        evidenceVersion,
        kind: item.kind as never,
        claimText: item.claimText,
        sourceResultIds: item.sourceResultIds as Id<"sourceResults">[],
        exactExcerpt: item.exactExcerpt ?? undefined,
        originalLanguageText: item.originalLanguageText ?? undefined,
        translatedText: item.translatedText ?? undefined,
        classificationBasis: "ai_suggested",
        // Derived from the stored source, never from the model's opinion of it.
        requiresReverification: item.sourceResultIds.some((id) => accessibleById.get(id) === false),
        createdByModelRunId: modelRunId,
      });
    }

    await ctx.db.patch(candidateId, { latestEvidenceVersion: evidenceVersion, updatedAt: Date.now() });
    return { evidenceVersion, written: items.length };
  },
});
