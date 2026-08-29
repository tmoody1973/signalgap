import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Deleting a scan must take everything the scan produced with it: its searches,
 * its results, their archived raw JSON, and — since item 7 — the candidates the
 * scan formed and everything hanging off them. Orphans left behind make the e2e
 * first-run assertions read a dirty deployment as a clean one.
 *
 * Lives here rather than in `testing.ts` because item 10's saved-demo import
 * needs the same "remove the previous copy completely" step to be idempotent,
 * and two cleanup routines that must agree are one routine waiting to drift.
 */
export async function purgeScan(ctx: MutationCtx, scanId: Id<"scans">) {
  const runs = await ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId)).collect();
  for (const run of runs) {
    if (run.rawStorageId) await ctx.storage.delete(run.rawStorageId);
    await ctx.db.delete(run._id);
  }
  const results = await ctx.db.query("sourceResults").withIndex("by_scan", (q) => q.eq("scanId", scanId)).collect();
  for (const result of results) await ctx.db.delete(result._id);

  // Candidates are reached through this scan's appearances. A candidate that
  // appeared in another scan too keeps that appearance and survives; one whose
  // only appearance was here goes with it, along with its evidence and briefs.
  const scan = await ctx.db.get(scanId);
  const appearances = scan
    ? await ctx.db
        .query("candidateAppearances")
        .withIndex("by_owner_scan", (q) => q.eq("ownerId", scan.ownerId).eq("scanId", scanId))
        .collect()
    : [];

  for (const appearance of appearances) {
    const candidateId = appearance.candidateId;
    await ctx.db.delete(appearance._id);

    const memberships = await ctx.db
      .query("candidateSources")
      .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId).eq("scanId", scanId))
      .collect();
    for (const membership of memberships) await ctx.db.delete(membership._id);

    const stillAppears = await ctx.db
      .query("candidateAppearances")
      .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId))
      .first();
    if (stillAppears) continue;

    const evidence = await ctx.db
      .query("evidenceItems")
      .withIndex("by_candidate_version", (q) => q.eq("candidateId", candidateId))
      .collect();
    for (const item of evidence) await ctx.db.delete(item._id);

    const briefs = await ctx.db
      .query("briefVersions")
      .withIndex("by_candidate_version", (q) => q.eq("candidateId", candidateId))
      .collect();
    for (const brief of briefs) await ctx.db.delete(brief._id);

    await ctx.db.delete(candidateId);
  }

  const modelRuns = await ctx.db
    .query("modelRuns")
    .withIndex("by_scan_operation", (q) => q.eq("scanId", scanId))
    .collect();
  for (const run of modelRuns) await ctx.db.delete(run._id);

  await ctx.db.delete(scanId);
}
