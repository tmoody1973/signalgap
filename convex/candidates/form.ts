import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { candidateFingerprint, clusterIdentityKeys } from "./fingerprint";
import { defaultIndependenceGroup, signalCategoryFor } from "./toEngineSource";

/**
 * Turns one AI-proposed cluster into persisted candidate membership.
 *
 * The model proposed the grouping. Nothing it proposed is trusted here: every
 * source id is re-read from `sourceResults` and checked against THIS scan, and
 * every signal category is derived from the stored source family rather than
 * from anything the model said about it.
 */
export const formFromCluster = internalMutation({
  args: {
    scanId: v.id("scans"),
    cluster: v.object({
      sourceResultIds: v.array(v.string()),
      similarityBasis: v.string(),
      entityKeys: v.array(v.string()),
      suggestedExistingCandidateId: v.union(v.string(), v.null()),
    }),
    workingTitle: v.string(),
  },
  returns: v.union(
    v.object({ candidateId: v.id("candidates"), created: v.boolean(), sourceCount: v.number() }),
    v.object({ rejected: v.union(v.literal("scan_not_found"), v.literal("no_valid_sources")) }),
  ),
  handler: async (ctx, { scanId, cluster, workingTitle }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return { rejected: "scan_not_found" as const };

    // Re-read every proposed source. A row that does not exist, or belongs to a
    // different scan, is silently dropped — it cannot become evidence.
    const sources = [];
    for (const raw of cluster.sourceResultIds) {
      const row = await ctx.db.get(raw as Id<"sourceResults">).catch(() => null);
      if (!row || !("scanId" in row) || row.scanId !== scanId) continue;
      sources.push(row);
    }
    if (sources.length === 0) return { rejected: "no_valid_sources" as const };

    // Identity comes from the cluster's entity keys, or — when it has none —
    // from the sources that actually survived the re-read above. Never from
    // nothing: `candidateFingerprint([])` is a constant, and a constant here
    // merges every cluster in the scan into one candidate.
    const fingerprint = candidateFingerprint(clusterIdentityKeys(cluster.entityKeys, sources.map((s) => s._id)));
    const now = Date.now();

    const existing = await ctx.db
      .query("candidates")
      .withIndex("by_owner_fingerprint", (q) => q.eq("ownerId", scan.ownerId).eq("fingerprint", fingerprint))
      .unique();

    let candidateId: Id<"candidates">;
    let created = false;
    if (existing) {
      candidateId = existing._id;
      await ctx.db.patch(candidateId, { lastSeenAt: now, updatedAt: now });
    } else {
      created = true;
      candidateId = await ctx.db.insert("candidates", {
        ownerId: scan.ownerId,
        fingerprint,
        currentTitle: workingTitle,
        reportingQuestion: "",
        // No beat. Formation runs before classification, so any value here would
        // be a default dressed as a judgment; `saveJudgment` writes the column
        // when — and only when — the classifier establishes one.
        // "processing" until the rules engine has run. `candidates/evaluate.ts`
        // is the only writer of status, label and score.
        status: "processing",
        primaryLabel: "Worth a look",
        disposition: "new",
        latestEvidenceVersion: 0,
        independentCategoryCount: 0,
        coverageOriginalCount: 0,
        coveragePassStatus: "pending",
        firstSeenAt: now,
        lastSeenAt: now,
        updatedAt: now,
      });
    }

    for (const [index, source] of sources.entries()) {
      const alreadyMember = await ctx.db
        .query("candidateSources")
        .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId).eq("scanId", scanId))
        .filter((q) => q.eq(q.field("sourceResultId"), source._id))
        .unique();
      if (alreadyMember) continue;

      const signalCategory = signalCategoryFor(source.sourceFamily);
      await ctx.db.insert("candidateSources", {
        candidateId,
        scanId,
        sourceResultId: source._id,
        // Structural, not a judgment: the first source is what started the lead.
        // Community discussion is the one exception — spec.md:541, r/milwaukee
        // results "never count as corroboration". Filing one as corroborating
        // would both inflate independence and let a dead Reddit link exclude an
        // otherwise sound lead, so it enters as enrichment instead.
        role: signalCategory === "community_discussion" ? "enrichment"
          : index === 0 ? "initiating" : "corroborating",
        independenceGroup: defaultIndependenceGroup(source.canonicalUrl, source.publisher ?? null),
        signalCategory,
        addedBy: "ai_suggestion",
      });
    }

    const appearance = await ctx.db
      .query("candidateAppearances")
      .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId).eq("scanId", scanId))
      .unique();
    if (!appearance) {
      await ctx.db.insert("candidateAppearances", {
        candidateId,
        scanId,
        ownerId: scan.ownerId,
        statusAtScan: "processing",
        labelAtScan: "Worth a look",
        dispositionAtScan: "new",
      });
    }

    return { candidateId, created, sourceCount: sources.length };
  },
});
