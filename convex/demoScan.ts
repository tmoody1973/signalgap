import { v } from "convex/values";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { purgeScan } from "./lib/purgeScan";

/**
 * Item 10's saved fallback: the real 2026-08-26 Milwaukee scan, marked as the
 * saved demo, exported to a committed fixture, and imported back through one
 * idempotent path.
 *
 * Three rules hold this file together:
 *
 * 1. **Nothing is recomputed on import.** `candidates/evaluate.ts` is the only
 *    writer of status, label, score, counts and exclusion reasons. This module
 *    restores what the rules already decided; it never re-decides.
 * 2. **`captureTimestamp` is when the scan RAN**, never when it was marked or
 *    imported. A timestamp that lies about the age of the data defeats the
 *    whole point of the `Saved copy` label.
 * 3. **Raw SerpApi JSON stays in File Storage.** `rawStorageId` is dropped on
 *    export, so no paid payload is ever committed to the repository.
 */

// ---------------------------------------------------------------- marking

/**
 * Mark a completed scan as the saved demo, or unmark it.
 *
 * Idempotent: running it twice with the same arguments leaves the same two
 * fields at the same values. Reversible: `isSavedDemo: false` clears both, and
 * nothing else about the scan is touched.
 *
 * `captureTimestamp` is taken from the scan's own `startedAt` — the moment the
 * scan actually ran. `startedAt` rather than `completedAt` because it is the
 * conservative claim: no source in the scan is OLDER than that instant, so the
 * label can never overstate how fresh the data is.
 */
export const setSavedDemo = internalMutation({
  args: { scanId: v.id("scans"), isSavedDemo: v.boolean() },
  returns: v.object({
    scanId: v.id("scans"),
    isSavedDemo: v.boolean(),
    captureTimestamp: v.optional(v.number()),
  }),
  handler: async (ctx, { scanId, isSavedDemo }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) throw new Error(`Scan ${scanId} not found`);
    if (isSavedDemo && scan.startedAt === undefined) {
      throw new Error("Scan has no startedAt, so there is no honest capture timestamp to record");
    }
    const captureTimestamp = isSavedDemo ? scan.startedAt : undefined;
    await ctx.db.patch(scanId, { isSavedDemo, captureTimestamp });
    return { scanId, isSavedDemo, captureTimestamp };
  },
});

// ---------------------------------------------------------------- export

export const EXPORT_PARTS = [
  "scan",
  "searchRuns",
  "sourceResults",
  "candidates",
  "candidateAppearances",
  "candidateSources",
  "evidenceItems",
  "briefVersions",
  "modelRuns",
  "editorEvents",
] as const;

const vExportPart = v.union(...EXPORT_PARTS.map((p) => v.literal(p)));

/**
 * One table at a time, because a whole scan in a single query response would
 * sit near Convex's read limits and fail on the day it matters.
 *
 * Rows come back verbatim apart from `rawStorageId`. The fixture is a dump of
 * what is there, not a rewrite of it — the remapping of ids onto a fresh
 * deployment is the importer's job, below.
 */
export const exportPart = internalQuery({
  args: { scanId: v.id("scans"), part: vExportPart },
  returns: v.array(v.any()),
  handler: async (ctx, { scanId, part }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) throw new Error(`Scan ${scanId} not found`);
    const ownerId = scan.ownerId;

    switch (part) {
      case "scan":
        return [scan];
      case "searchRuns": {
        const runs = await ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId)).collect();
        // The paid payload stays in File Storage. Everything else about the
        // search — the query, the parameters, the counts, the failure — travels.
        return runs.map((run) => {
          const row: Partial<Doc<"searchRuns">> = { ...run };
          delete row.rawStorageId;
          return row;
        });
      }
      case "sourceResults":
        return await ctx.db.query("sourceResults").withIndex("by_scan", (q) => q.eq("scanId", scanId)).collect();
      case "candidateAppearances":
        return await ctx.db.query("candidateAppearances").withIndex("by_owner_scan", (q) => q.eq("ownerId", ownerId).eq("scanId", scanId)).collect();
      case "candidates": {
        const appearances = await ctx.db.query("candidateAppearances").withIndex("by_owner_scan", (q) => q.eq("ownerId", ownerId).eq("scanId", scanId)).collect();
        const rows: Doc<"candidates">[] = [];
        for (const a of appearances) {
          const candidate = await ctx.db.get(a.candidateId);
          if (candidate) rows.push(candidate);
        }
        return rows;
      }
      case "candidateSources": {
        const appearances = await ctx.db.query("candidateAppearances").withIndex("by_owner_scan", (q) => q.eq("ownerId", ownerId).eq("scanId", scanId)).collect();
        const rows: Doc<"candidateSources">[] = [];
        for (const a of appearances) {
          rows.push(...await ctx.db.query("candidateSources").withIndex("by_candidate_scan", (q) => q.eq("candidateId", a.candidateId).eq("scanId", scanId)).collect());
        }
        return rows;
      }
      case "evidenceItems": {
        const rows: Doc<"evidenceItems">[] = [];
        for (const kind of ["confirmed_fact", "unverified_signal", "conflicting_claim", "existing_coverage", "potential_source"] as const) {
          rows.push(...await ctx.db.query("evidenceItems").withIndex("by_scan_kind", (q) => q.eq("scanId", scanId).eq("kind", kind)).collect());
        }
        return rows;
      }
      case "briefVersions":
        return await ctx.db.query("briefVersions").withIndex("by_scan", (q) => q.eq("scanId", scanId)).collect();
      case "modelRuns": {
        const rows: Doc<"modelRuns">[] = [];
        for (const operation of ["analyzeResults", "clusterSignals", "adjudicatePairs", "classifyEvidence", "planFollowUp", "generateBrief"] as const) {
          rows.push(...await ctx.db.query("modelRuns").withIndex("by_scan_operation", (q) => q.eq("scanId", scanId).eq("operation", operation)).collect());
        }
        return rows;
      }
      case "editorEvents": {
        // No index by scan, and the table is small until item 9 part B lands.
        // ponytail: full scan of a table that holds tens of rows; add a
        // by_scan index if editor history ever grows past a page.
        const all = await ctx.db.query("editorEvents").withIndex("by_owner_created", (q) => q.eq("ownerId", ownerId)).collect();
        return all.filter((e) => e.scanId === scanId);
      }
    }
  },
});

// ---------------------------------------------------------------- import

export type Snapshot = Record<(typeof EXPORT_PARTS)[number], Record<string, unknown>[]>;

type ImportResult = {
  scanId: Id<"scans">;
  captureTimestamp: number;
  replacedScans: number;
  inserted: Record<string, number>;
};

/** Strip the fields a fresh deployment assigns for itself. */
const strip = (row: Record<string, unknown>) => {
  const rest = { ...row };
  delete rest._id;
  delete rest._creationTime;
  return rest;
};

/**
 * Import the committed saved-demo snapshot for one Clerk user.
 *
 * **Idempotent by capture timestamp.** Before inserting anything it purges every
 * scan this owner already has that is flagged `isSavedDemo` with the SAME
 * `captureTimestamp`. That is the identity of a saved demo: one owner, one
 * captured moment, one copy. Re-running replaces rather than doubles, and
 * `purgeScan` — the same routine the e2e reset uses — is what does the removing,
 * so the two can never drift apart.
 *
 * Insert order is dependency order: scan, candidates, modelRuns, searchRuns,
 * sourceResults, appearances, memberships, evidence, briefs, editor events.
 * Every `Id` in the snapshot is rewritten through `remap` as it goes; an
 * unmapped id throws rather than silently writing a dangling reference.
 *
 * `_creationTime` cannot be set on insert, so imported rows carry the import
 * moment there. Nothing in the product orders by it — the feed orders by score
 * then `firstSeenAt` — but it is the one field the copy cannot reproduce.
 */
export const importSavedDemo = internalMutation({
  args: { clerkUserId: v.string(), snapshot: v.any() },
  returns: v.object({
    scanId: v.id("scans"),
    captureTimestamp: v.number(),
    replacedScans: v.number(),
    inserted: v.record(v.string(), v.number()),
  }),
  handler: async (ctx, { clerkUserId, snapshot }: { clerkUserId: string; snapshot: Snapshot }): Promise<ImportResult> => {
    const now = Date.now();
    const existingUser = await ctx.db.query("users").withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId)).unique();
    const ownerId = existingUser?._id ?? (await ctx.db.insert("users", { clerkUserId, createdAt: now, updatedAt: now }));

    const source = strip(snapshot.scan[0]) as Omit<Doc<"scans">, "_id" | "_creationTime">;
    const captureTimestamp = source.captureTimestamp;
    if (source.isSavedDemo !== true || captureTimestamp === undefined) {
      throw new Error("Snapshot scan is not marked as a saved demo with a capture timestamp");
    }

    // Replace, never double. Same owner + same captured moment = same copy.
    const priors = await ctx.db.query("scans").withIndex("by_owner_started", (q) => q.eq("ownerId", ownerId)).collect();
    const replaced = priors.filter((s) => s.isSavedDemo && s.captureTimestamp === captureTimestamp);
    for (const prior of replaced) await purgeScan(ctx, prior._id);

    const ids = new Map<string, string>();
    const remap = <T extends TableNames>(old: unknown, what: string): Id<T> => {
      const mapped = ids.get(old as string);
      if (mapped === undefined) throw new Error(`Snapshot references an unknown ${what}: ${String(old)}`);
      return mapped as Id<T>;
    };
    const record = (row: Record<string, unknown>, fresh: string) => { ids.set(row._id as string, fresh); };

    // The workflow id is deliberately NOT carried over. It named a workflow run
    // in another deployment; restoring it would point the UI at nothing.
    const scanFields = strip(snapshot.scan[0]);
    delete scanFields.workflowId;
    const scanId = await ctx.db.insert("scans", { ...scanFields, ownerId } as Parameters<typeof ctx.db.insert<"scans">>[1]);
    record(snapshot.scan[0], scanId);

    const inserted: Record<string, number> = { scan: 1 };
    const count = (part: string, n: number) => { inserted[part] = n; };

    for (const row of snapshot.candidates) {
      const fresh = await ctx.db.insert("candidates", { ...strip(row), ownerId } as Parameters<typeof ctx.db.insert<"candidates">>[1]);
      record(row, fresh);
    }
    count("candidates", snapshot.candidates.length);

    for (const row of snapshot.modelRuns) {
      const fresh = await ctx.db.insert("modelRuns", {
        ...strip(row), ownerId, scanId,
        ...(row.candidateId ? { candidateId: remap<"candidates">(row.candidateId, "candidate") } : {}),
        ...(row.fallbackFromRunId ? { fallbackFromRunId: remap<"modelRuns">(row.fallbackFromRunId, "modelRun") } : {}),
      } as Parameters<typeof ctx.db.insert<"modelRuns">>[1]);
      record(row, fresh);
    }
    count("modelRuns", snapshot.modelRuns.length);

    for (const row of snapshot.searchRuns) {
      const fresh = await ctx.db.insert("searchRuns", {
        ...strip(row), ownerId, scanId,
        ...(row.candidateId ? { candidateId: remap<"candidates">(row.candidateId, "candidate") } : {}),
      } as Parameters<typeof ctx.db.insert<"searchRuns">>[1]);
      record(row, fresh);
    }
    count("searchRuns", snapshot.searchRuns.length);

    for (const row of snapshot.sourceResults) {
      const analysis = row.analysis as { modelRunId: string } | undefined;
      const fresh = await ctx.db.insert("sourceResults", {
        ...strip(row), ownerId, scanId,
        searchRunId: remap<"searchRuns">(row.searchRunId, "searchRun"),
        ...(analysis ? { analysis: { ...analysis, modelRunId: remap<"modelRuns">(analysis.modelRunId, "modelRun") } } : {}),
      } as Parameters<typeof ctx.db.insert<"sourceResults">>[1]);
      record(row, fresh);
    }
    count("sourceResults", snapshot.sourceResults.length);

    for (const row of snapshot.candidateAppearances) {
      await ctx.db.insert("candidateAppearances", {
        ...strip(row), ownerId, scanId,
        candidateId: remap<"candidates">(row.candidateId, "candidate"),
      } as Parameters<typeof ctx.db.insert<"candidateAppearances">>[1]);
    }
    count("candidateAppearances", snapshot.candidateAppearances.length);

    for (const row of snapshot.candidateSources) {
      await ctx.db.insert("candidateSources", {
        ...strip(row), scanId,
        candidateId: remap<"candidates">(row.candidateId, "candidate"),
        sourceResultId: remap<"sourceResults">(row.sourceResultId, "sourceResult"),
      } as Parameters<typeof ctx.db.insert<"candidateSources">>[1]);
    }
    count("candidateSources", snapshot.candidateSources.length);

    for (const row of snapshot.evidenceItems) {
      await ctx.db.insert("evidenceItems", {
        ...strip(row), ownerId, scanId,
        candidateId: remap<"candidates">(row.candidateId, "candidate"),
        sourceResultIds: (row.sourceResultIds as string[]).map((s) => remap<"sourceResults">(s, "sourceResult")),
        ...(row.createdByModelRunId ? { createdByModelRunId: remap<"modelRuns">(row.createdByModelRunId, "modelRun") } : {}),
      } as Parameters<typeof ctx.db.insert<"evidenceItems">>[1]);
    }
    count("evidenceItems", snapshot.evidenceItems.length);

    const remapBlocks = (blocks: unknown) =>
      (blocks as { text: string; sourceResultIds: string[] }[]).map((b) => ({
        ...b, sourceResultIds: b.sourceResultIds.map((s) => remap<"sourceResults">(s, "sourceResult")),
      }));

    for (const row of snapshot.briefVersions) {
      await ctx.db.insert("briefVersions", {
        ...strip(row), ownerId, scanId,
        candidateId: remap<"candidates">(row.candidateId, "candidate"),
        confirmedFacts: remapBlocks(row.confirmedFacts),
        unverifiedClaims: remapBlocks(row.unverifiedClaims),
        conflicts: remapBlocks(row.conflicts),
        existingCoverage: remapBlocks(row.existingCoverage),
        potentialHumanSources: remapBlocks(row.potentialHumanSources),
        ...(row.modelRunId ? { modelRunId: remap<"modelRuns">(row.modelRunId, "modelRun") } : {}),
        ...(row.editedByUserId ? { editedByUserId: ownerId } : {}),
      } as Parameters<typeof ctx.db.insert<"briefVersions">>[1]);
    }
    count("briefVersions", snapshot.briefVersions.length);

    for (const row of snapshot.editorEvents) {
      await ctx.db.insert("editorEvents", {
        ...strip(row), ownerId, scanId, actorUserId: ownerId,
        candidateId: remap<"candidates">(row.candidateId, "candidate"),
      } as Parameters<typeof ctx.db.insert<"editorEvents">>[1]);
    }
    count("editorEvents", snapshot.editorEvents.length);

    return { scanId, captureTimestamp, replacedScans: replaced.length, inserted };
  },
});

// ---------------------------------------------------- getting the fixture up

/**
 * The committed fixture is ~2.3 MB, which is far past what a shell can hand to
 * `npx convex run` as an argument. So the import script uploads the JSON to
 * File Storage first — the same place raw SerpApi archives already live — and
 * the action below reads it back inside the deployment, where the limit is
 * megabytes rather than a command line.
 */
export const generateSnapshotUploadUrl = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const importFromStorage = internalAction({
  args: { clerkUserId: v.string(), storageId: v.id("_storage") },
  returns: v.object({
    scanId: v.id("scans"),
    captureTimestamp: v.number(),
    replacedScans: v.number(),
    inserted: v.record(v.string(), v.number()),
  }),
  handler: async (ctx, { clerkUserId, storageId }): Promise<ImportResult> => {
    const blob = await ctx.storage.get(storageId);
    if (!blob) throw new Error(`Uploaded snapshot ${storageId} not found`);
    const snapshot = JSON.parse(await blob.text());
    try {
      return await ctx.runMutation(internal.demoScan.importSavedDemo, { clerkUserId, snapshot });
    } finally {
      // The fixture is the repository's copy. The uploaded one is scaffolding
      // and leaving it behind would quietly bill storage for a duplicate.
      await ctx.storage.delete(storageId);
    }
  },
});
