import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { scanDoc } from "../fixtures/factories";
import { setup } from "./helpers";

/**
 * The reading stage's progress counters. They exist because a scan spends its
 * whole search budget in the first minute and then reads every source it found
 * before any lead exists — a stretch in which nothing on screen moved, and a
 * healthy scan was cancelled at 3.1 minutes because it looked dead.
 */
const seedScan = async (t: ReturnType<typeof setup>, overrides: Record<string, unknown> = {}) =>
  await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { clerkUserId: "u", createdAt: 1, updatedAt: 1 });
    return await ctx.db.insert("scans", scanDoc(ownerId, overrides) as never) as Id<"scans">;
  });

const readScan = (t: ReturnType<typeof setup>, scanId: Id<"scans">) =>
  t.run(async (ctx) => await ctx.db.get(scanId));

describe("scans.setAnalysisProgress", () => {
  it("starts at zero of the total, so the line is honest before any batch lands", async () => {
    const t = setup();
    const scanId = await seedScan(t);
    await t.mutation(internal.scans.setAnalysisProgress, { scanId, total: 380 });
    const scan = await readScan(t, scanId);
    expect(scan?.sourcesTotal).toBe(380);
    expect(scan?.sourcesAnalyzed).toBe(0);
  });

  it("accumulates across batches instead of being overwritten by the last one", async () => {
    // Four workers finish out of order. The last batch to land is not the
    // furthest along, so an assignment here would make the number go backwards.
    const t = setup();
    const scanId = await seedScan(t);
    await t.mutation(internal.scans.setAnalysisProgress, { scanId, total: 30 });
    await t.mutation(internal.scans.setAnalysisProgress, { scanId, advanceBy: 10 });
    await t.mutation(internal.scans.setAnalysisProgress, { scanId, advanceBy: 10 });
    await t.mutation(internal.scans.setAnalysisProgress, { scanId, advanceBy: 7 });
    expect((await readScan(t, scanId))?.sourcesAnalyzed).toBe(27);
  });

  it("resets the count when a new total is set", async () => {
    // A scan that reads twice must not report the first pass added to the second.
    const t = setup();
    const scanId = await seedScan(t);
    await t.mutation(internal.scans.setAnalysisProgress, { scanId, total: 30 });
    await t.mutation(internal.scans.setAnalysisProgress, { scanId, advanceBy: 20 });
    await t.mutation(internal.scans.setAnalysisProgress, { scanId, total: 50 });
    const scan = await readScan(t, scanId);
    expect(scan?.sourcesTotal).toBe(50);
    expect(scan?.sourcesAnalyzed).toBe(0);
  });

  it("refuses to move a terminal scan, the same way setStage does", async () => {
    // A finished scan is a snapshot. A snapshot whose progress line keeps
    // moving is not one -- and a killed action's late batch must not rewrite
    // history after the scan was cancelled.
    for (const status of ["completed", "partial", "canceled"] as const) {
      const t = setup();
      const scanId = await seedScan(t, { status, sourcesTotal: 380, sourcesAnalyzed: 200 });
      await t.mutation(internal.scans.setAnalysisProgress, { scanId, advanceBy: 10 });
      expect((await readScan(t, scanId))?.sourcesAnalyzed).toBe(200);
    }
  });

  it("leaves a scan that never reported progress with no counters at all", async () => {
    // The committed saved-demo fixture is inserted verbatim and has neither
    // field. Absent must stay absent rather than becoming a zero that reads as
    // "read nothing".
    const t = setup();
    const scanId = await seedScan(t);
    const scan = await readScan(t, scanId);
    expect(scan?.sourcesTotal).toBeUndefined();
    expect(scan?.sourcesAnalyzed).toBeUndefined();
  });
});
