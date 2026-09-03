import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireUser } from "../lib/auth";
import * as V from "../lib/validators";

/**
 * An editor's decision about a lead: reject it, monitor it, assign it, or
 * leave a note. This is the one thing on the lead page a person DOES.
 *
 * `disposition` is an editorial column, not a rules verdict, so writing it
 * here does not cross `evaluate.ts`, which owns status, label, score and the
 * exclusion reasons. `candidateAppearances.dispositionAtScan` is the frozen
 * per-scan record and is deliberately left alone: the feed filters on the
 * live column, and history is the events table's job.
 *
 * Every change writes an `editorEvents` row with before/after and the actor,
 * because "who decided this?" must always be answerable (decision 004).
 */
export const set = mutation({
  args: {
    candidateId: v.id("candidates"),
    disposition: V.vDisposition,
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { candidateId, disposition, note }) => {
    const user = await requireUser(ctx);
    const candidate = await ctx.db.get(candidateId);
    if (!candidate || candidate.ownerId !== user._id) throw new Error("Lead not found");

    const trimmed = (note ?? "").trim().slice(0, 2000);
    const changed = candidate.disposition !== disposition;
    // Nothing to record is nothing to write. A no-op click must not leave an
    // event claiming an editor did something.
    if (!changed && trimmed === "") return null;

    // The event belongs to the scan the editor was looking at, which is the
    // lead's newest appearance -- the same rule evidence.forCandidate uses.
    const appearances = await ctx.db
      .query("candidateAppearances")
      .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId))
      .collect();
    let scanId: Id<"scans"> | undefined;
    let newest = -1;
    for (const appearance of appearances) {
      const scan = await ctx.db.get(appearance.scanId);
      const startedAt = scan?.startedAt ?? 0;
      if (scan && startedAt > newest) { newest = startedAt; scanId = appearance.scanId; }
    }
    if (!scanId) throw new Error("Lead has no scan");

    const now = Date.now();
    if (changed) await ctx.db.patch(candidateId, { disposition, updatedAt: now });
    await ctx.db.insert("editorEvents", {
      candidateId,
      ownerId: user._id,
      scanId,
      actorUserId: user._id,
      type: changed ? "disposition_changed" : "note_added",
      ...(changed ? { before: { disposition: candidate.disposition }, after: { disposition } } : {}),
      ...(trimmed ? { note: trimmed } : {}),
      createdAt: now,
    });
    return null;
  },
});
