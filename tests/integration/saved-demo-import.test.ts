import { beforeEach, describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import { EXPORT_PARTS, type Snapshot } from "../../convex/demoScan";
import type { Id } from "../../convex/_generated/dataModel";
import { seedFormedCandidate, setup } from "./helpers";

/**
 * Item 10's saved fallback, on its real path: mark a completed scan, export
 * every part of it, then import it back TWICE and prove the deployment holds
 * one copy rather than two.
 *
 * The snapshot here is produced by the same `exportPart` query the committed
 * fixture came from, so this test fails if export and import ever stop agreeing
 * about which tables a scan is made of.
 */
describe("saved demo export and import", () => {
  beforeEach(() => {
    process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
    process.env.AI_FALLBACK_ENABLED = "false";
  });

  const exportAll = async (t: ReturnType<typeof setup>, scanId: Id<"scans">): Promise<Snapshot> => {
    // Built key by key, so it starts empty and is only a whole Snapshot once
    // every part in EXPORT_PARTS has been filled in.
    const snapshot = {} as Snapshot;
    for (const part of EXPORT_PARTS) {
      snapshot[part] = await t.query(internal.demoScan.exportPart, { scanId, part });
    }
    return snapshot;
  };

  const countRows = (t: ReturnType<typeof setup>, clerkUserId: string) =>
    t.run(async (ctx) => {
      const user = await ctx.db.query("users").withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId)).unique();
      if (!user) return null;
      const scans = await ctx.db.query("scans").withIndex("by_owner_started", (q) => q.eq("ownerId", user._id)).collect();
      const candidates = await ctx.db.query("candidates").withIndex("by_owner_updated", (q) => q.eq("ownerId", user._id)).collect();
      let sourceResults = 0;
      let appearances = 0;
      for (const scan of scans) {
        sourceResults += (await ctx.db.query("sourceResults").withIndex("by_scan", (q) => q.eq("scanId", scan._id)).collect()).length;
        appearances += (await ctx.db.query("candidateAppearances").withIndex("by_owner_scan", (q) => q.eq("ownerId", user._id).eq("scanId", scan._id)).collect()).length;
      }
      return { scans: scans.length, candidates: candidates.length, sourceResults, appearances, savedDemos: scans.filter((s) => s.isSavedDemo).length };
    });

  it("marks a scan idempotently and takes the capture timestamp from when it ran", async () => {
    const t = setup();
    const { scanId } = await seedFormedCandidate(t);
    const startedAt = await t.run(async (ctx) => (await ctx.db.get(scanId))!.startedAt);

    const first = await t.mutation(internal.demoScan.setSavedDemo, { scanId, isSavedDemo: true });
    const second = await t.mutation(internal.demoScan.setSavedDemo, { scanId, isSavedDemo: true });

    expect(first.captureTimestamp).toBe(startedAt);
    expect(second).toEqual(first);

    // Reversible, and it leaves nothing behind.
    await t.mutation(internal.demoScan.setSavedDemo, { scanId, isSavedDemo: false });
    const cleared = await t.run(async (ctx) => await ctx.db.get(scanId));
    expect(cleared?.isSavedDemo).toBe(false);
    expect(cleared?.captureTimestamp).toBeUndefined();
  });

  it("importing twice leaves one copy, not two", async () => {
    const t = setup();
    const { scanId } = await seedFormedCandidate(t);
    await t.mutation(internal.demoScan.setSavedDemo, { scanId, isSavedDemo: true });
    const snapshot = await exportAll(t, scanId);

    expect(snapshot.scan).toHaveLength(1);
    expect(snapshot.candidates.length).toBeGreaterThan(0);
    expect(snapshot.sourceResults.length).toBeGreaterThan(0);

    const run1 = await t.mutation(internal.demoScan.importSavedDemo, { clerkUserId: "importer", snapshot });
    const after1 = await countRows(t, "importer");

    const run2 = await t.mutation(internal.demoScan.importSavedDemo, { clerkUserId: "importer", snapshot });
    const after2 = await countRows(t, "importer");

    expect(run1.replacedScans).toBe(0);
    expect(run2.replacedScans).toBe(1);
    expect(run2.inserted).toEqual(run1.inserted);
    expect(after2).toEqual(after1);
    expect(after2?.scans).toBe(1);
    expect(after2?.savedDemos).toBe(1);
  });

  it("restores the verdict the rules already made, and never recomputes it", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);
    await t.mutation(internal.demoScan.setSavedDemo, { scanId, isSavedDemo: true });
    const original = await t.run(async (ctx) => await ctx.db.get(candidateId));
    const snapshot = await exportAll(t, scanId);

    const { scanId: importedScanId } = await t.mutation(internal.demoScan.importSavedDemo, { clerkUserId: "importer", snapshot });

    const restored = await t.run(async (ctx) => {
      const scan = (await ctx.db.get(importedScanId))!;
      const appearance = (await ctx.db.query("candidateAppearances").withIndex("by_owner_scan", (q) => q.eq("ownerId", scan.ownerId).eq("scanId", importedScanId)).first())!;
      return { scan, candidate: (await ctx.db.get(appearance.candidateId))! };
    });

    expect(restored.candidate.status).toBe(original!.status);
    expect(restored.candidate.primaryLabel).toBe(original!.primaryLabel);
    expect(restored.candidate.scoreTotal).toBe(original!.scoreTotal);
    expect(restored.candidate.exclusionReasons).toEqual(original!.exclusionReasons);
    expect(restored.candidate.fingerprint).toBe(original!.fingerprint);
    // The copy is owned by the importer, carries the capture timestamp, and
    // names no workflow — the run it named happened somewhere else.
    expect(restored.scan.isSavedDemo).toBe(true);
    expect(restored.scan.captureTimestamp).toBe(original && (snapshot.scan[0] as { captureTimestamp: number }).captureTimestamp);
    expect(restored.scan.workflowId).toBeUndefined();
    expect(restored.scan.ownerId).not.toBe((snapshot.scan[0] as { ownerId: Id<"users"> }).ownerId);
  });

  it("refuses a snapshot that is not marked as a saved demo", async () => {
    const t = setup();
    const { scanId } = await seedFormedCandidate(t);
    const snapshot = await exportAll(t, scanId);
    await expect(
      t.mutation(internal.demoScan.importSavedDemo, { clerkUserId: "importer", snapshot }),
    ).rejects.toThrow(/not marked as a saved demo/);
  });
});
