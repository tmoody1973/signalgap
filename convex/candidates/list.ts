import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireUser } from "../lib/auth";
import * as V from "../lib/validators";

/**
 * The compact feed: one owner-scoped, paginated view of a SINGLE scan's
 * candidates, split into "eligible" and "excluded" by that scan's own verdict.
 *
 * At most ten leads per scan can ever qualify (the coverage stage fully checks
 * at most ten), so "excluded" is not a corner case — it is where most of a
 * scan lives, and every lead there carries its reasons.
 *
 * The card shape is deliberately thin. `evidence.forCandidate` is the heavy
 * per-lead bundle: nothing here reads evidenceItems, scoreComponents, or
 * judgment, because a list of a scan's candidates must not fan out into that
 * many deep reads.
 */

const vLeadCard = v.object({
  candidateId: v.id("candidates"),
  reportingQuestion: v.string(),
  // The working title we clustered under. Empty `reportingQuestion` is a real
  // state, not a bug: `formFromCluster` writes it blank and only a brief fills
  // it in, so a candidate whose brief never landed has none. The card falls
  // back to this rather than rendering an empty heading. Already on the row —
  // no extra read, so the no-fan-out rule above still holds.
  currentTitle: v.string(),
  // Absent when no beat was ever established — see `schema.ts`. The card must
  // say so rather than naming one, and the beat filter below excludes these
  // rather than sweeping them into a beat they were never judged to be in.
  beat: v.optional(V.vBeat),
  label: V.vProductLabel,
  // Matches evidence.forCandidate's convention: excluded means no score, not
  // zero, and a candidate never evaluated has none either.
  scoreTotal: v.union(v.number(), v.null()),
  independentCategoryCount: v.number(),
  coverageOriginalCount: v.number(),
  discoveredAt: v.number(),
  disposition: V.vDisposition,
  // Empty when the lead qualified, same as evidence.forCandidate — never
  // absent, so the card can tell "qualified" from "not yet evaluated".
  exclusionReasons: v.array(V.vExclusionReason),
});

const vLeadCardPage = v.object({
  page: v.array(vLeadCard),
  isDone: v.boolean(),
  continueCursor: v.string(),
  counts: v.object({ eligible: v.number(), excluded: v.number(), processing: v.number() }),
});

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: "", counts: { eligible: 0, excluded: 0, processing: 0 } };

function toCard(candidate: Doc<"candidates">): typeof vLeadCard.type {
  return {
    candidateId: candidate._id,
    reportingQuestion: candidate.reportingQuestion,
    currentTitle: candidate.currentTitle,
    beat: candidate.beat,
    label: candidate.primaryLabel,
    scoreTotal: candidate.scoreTotal ?? null,
    independentCategoryCount: candidate.independentCategoryCount,
    coverageOriginalCount: candidate.coverageOriginalCount,
    discoveredAt: candidate.firstSeenAt,
    disposition: candidate.disposition,
    exclusionReasons: candidate.exclusionReasons ?? [],
  };
}

export const listForScan = query({
  args: {
    scanId: v.id("scans"),
    view: v.union(v.literal("eligible"), v.literal("excluded")),
    beat: v.optional(V.vBeat),
    label: v.optional(V.vProductLabel),
    disposition: v.optional(V.vDisposition),
    paginationOpts: paginationOptsValidator,
  },
  returns: vLeadCardPage,
  handler: async (ctx, { scanId, view, beat, label, disposition, paginationOpts }) => {
    const user = await requireUser(ctx);
    const scan = await ctx.db.get(scanId);
    // Ownership is checked before anything else is read. Mirrors
    // sourceResults.listForScan: a mismatch is an empty page, not an error.
    if (!scan || scan.ownerId !== user._id) return EMPTY_PAGE;

    // A feed is a view of ONE scan: walk this scan's appearances, not every
    // candidate the owner has ever had.
    const appearances = await ctx.db
      .query("candidateAppearances")
      .withIndex("by_owner_scan", (q) => q.eq("ownerId", user._id).eq("scanId", scanId))
      .collect();

    const candidates: Doc<"candidates">[] = [];
    for (const appearance of appearances) {
      // statusAtScan, not the candidate's live status: it is THIS scan's own
      // verdict, frozen at the moment this scan evaluated it, and it is what
      // decides which of the two views a lead belongs in here. A candidate
      // re-evaluated in a later scan must not rewrite this scan's history.
      if (appearance.statusAtScan !== view) continue;
      const candidate = await ctx.db.get(appearance.candidateId);
      if (!candidate) continue;
      if (beat !== undefined && candidate.beat !== beat) continue;
      if (label !== undefined && candidate.primaryLabel !== label) continue;
      if (disposition !== undefined && candidate.disposition !== disposition) continue;
      candidates.push(candidate);
    }

    // Sort before paginating: score descending (nulls last), then freshness,
    // then the id. The id tiebreak is not cosmetic — without it, two leads
    // scored and dated the same reorder on every load and an editor loses
    // their place.
    candidates.sort((a, b) => {
      const scoreA = a.scoreTotal ?? -Infinity;
      const scoreB = b.scoreTotal ?? -Infinity;
      if (scoreA !== scoreB) return scoreB - scoreA;
      if (a.firstSeenAt !== b.firstSeenAt) return b.firstSeenAt - a.firstSeenAt;
      return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
    });

    // Convex's `.paginate()` needs an index-ordered query, and there is no
    // index for this compound sort. A scan's candidate set is bounded (the
    // budget caps it well under a hundred), so this is sorted in memory and
    // the cursor is just an offset into that already-sorted array.
    const offset = paginationOpts.cursor === null ? 0 : Number(paginationOpts.cursor);
    const page = candidates.slice(offset, offset + paginationOpts.numItems);
    const nextOffset = offset + page.length;

    return {
      page: page.map(toCard),
      isDone: nextOffset >= candidates.length,
      continueCursor: String(nextOffset),
      // For the whole scan, not the filtered/paginated page — an editor
      // filtering to one beat still needs the scan's real totals. These are
      // the scan's own running counts, updated as each candidate's verdict
      // landed during this scan, so they carry the same frozen-at-this-scan
      // semantics as statusAtScan above.
      counts: { eligible: scan.eligibleCount, excluded: scan.excludedCount, processing: scan.processingCount },
    };
  },
});
