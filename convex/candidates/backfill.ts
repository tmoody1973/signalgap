import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/**
 * A one-off repair for candidate rows written before `persistBrief` learned to
 * carry the reporting question across.
 *
 * Those rows hold the blank `formFromCluster` wrote, while their brief holds the
 * real question — so the feed card, which reads the candidate row and must not
 * fan out into briefs, rendered an empty heading. This copies the question the
 * newsroom already has; it invents nothing and calls no model.
 *
 * Only blanks are filled. A row with a question already on it is left exactly as
 * it is, so re-running this is safe and it can never overwrite an edit.
 */
export const reportingQuestionsForScan = internalMutation({
  args: { scanId: v.id("scans") },
  returns: v.object({ examined: v.number(), filled: v.number(), noBrief: v.number() }),
  handler: async (ctx, { scanId }) => {
    const appearances = await ctx.db
      .query("candidateAppearances")
      .withIndex("by_scan_rank", (q) => q.eq("scanId", scanId))
      .collect();

    let examined = 0;
    let filled = 0;
    let noBrief = 0;
    for (const appearance of appearances) {
      const candidate = await ctx.db.get(appearance.candidateId);
      if (!candidate) continue;
      examined++;
      if (candidate.reportingQuestion !== "") continue;

      const [brief] = await ctx.db
        .query("briefVersions")
        .withIndex("by_candidate_version", (q) => q.eq("candidateId", candidate._id))
        .order("desc")
        .take(1);
      // No brief means no question exists anywhere. The card falls back to the
      // working title and says so; leave the blank honest.
      if (!brief) { noBrief++; continue; }

      await ctx.db.patch(candidate._id, { reportingQuestion: brief.reportingQuestion });
      filled++;
    }
    return { examined, filled, noBrief };
  },
});
