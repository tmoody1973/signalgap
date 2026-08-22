import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { MARKET_KEY, QUERY_CATALOG_VERSION, RULESET_VERSION } from "./config/ruleset";
import { SEARCH_BUDGET } from "./config/searchBudget";
import { MILWAUKEE_LOCATION } from "./integrations/serpapi/contracts";

// Deleting a scan must take its searches, its results and their archived raw
// JSON with it. Orphans left behind make the e2e first-run assertions read a
// dirty deployment as a clean one.
async function purgeScan(ctx: MutationCtx, scanId: Id<"scans">) {
  const runs = await ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId)).collect();
  for (const run of runs) {
    if (run.rawStorageId) await ctx.storage.delete(run.rawStorageId);
    await ctx.db.delete(run._id);
  }
  const results = await ctx.db.query("sourceResults").withIndex("by_scan", (q) => q.eq("scanId", scanId)).collect();
  for (const result of results) await ctx.db.delete(result._id);
  await ctx.db.delete(scanId);
}

// ponytail: CLI-only reset for e2e; internal so browsers cannot call it.
export const deleteScansForClerkUser = internalMutation({
  args: { clerkUserId: v.string() },
  returns: v.number(),
  handler: async (ctx, { clerkUserId }) => {
    const user = await ctx.db.query("users").withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId)).unique();
    if (!user) return 0;
    const scans = await ctx.db.query("scans").withIndex("by_owner_started", (q) => q.eq("ownerId", user._id)).collect();
    for (const s of scans) await purgeScan(ctx, s._id);
    return scans.length;
  },
});

// --- Test-only helpers for the real-deployment concurrency proof (Ruling 7) ---
// convex-test serialises every top-level transaction behind a mutex, so its
// 20-way reserve test proves ordering, not the 120 cap. These run the same
// mutation against a real deployment, where the transactions genuinely race.
// All internal: no browser can reach them.

export const seedScanAtReservation = internalMutation({
  args: { reserved: v.number() },
  returns: v.object({ scanId: v.id("scans"), userId: v.id("users") }),
  handler: async (ctx, { reserved }) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkUserId: `race-harness-${now}-${Math.random().toString(36).slice(2)}`,
      createdAt: now, updatedAt: now,
    });
    const scanId = await ctx.db.insert("scans", {
      ownerId: userId, marketKey: MARKET_KEY,
      rulesetVersion: RULESET_VERSION, queryCatalogVersion: QUERY_CATALOG_VERSION,
      status: "running", stage: "discovery", startedAt: now,
      searchBudgetLimit: SEARCH_BUDGET.hardCap, searchesReserved: reserved,
      searchesSucceeded: 0, searchesFailed: 0,
      eligibleCount: 0, excludedCount: 0, processingCount: 0,
      failureSummaries: [], isSavedDemo: false,
    });
    return { scanId, userId };
  },
});

export const readScanCounters = internalQuery({
  args: { scanId: v.id("scans") },
  returns: v.union(v.null(), v.object({
    searchesReserved: v.number(), searchesSucceeded: v.number(), searchesFailed: v.number(),
    searchBudgetLimit: v.number(), runCount: v.number(),
  })),
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return null;
    const runs = await ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId)).collect();
    return {
      searchesReserved: scan.searchesReserved, searchesSucceeded: scan.searchesSucceeded,
      searchesFailed: scan.searchesFailed, searchBudgetLimit: scan.searchBudgetLimit,
      runCount: runs.length,
    };
  },
});

export const deleteScanById = internalMutation({
  args: { scanId: v.id("scans"), userId: v.optional(v.id("users")) },
  returns: v.null(),
  handler: async (ctx, { scanId, userId }) => {
    if (await ctx.db.get(scanId)) await purgeScan(ctx, scanId);
    if (userId && (await ctx.db.get(userId))) await ctx.db.delete(userId);
    return null;
  },
});

type RaceOutcome = {
  granted: number; rejected: number;
  searchesReserved: number; runCount: number; searchBudgetLimit: number;
};

// Each ctx.runMutation from an action is its own transaction on the real
// backend, so Promise.all here is a genuine race against one scan row —
// which is exactly what the 120 cap has to survive.
export const raceReserve = internalAction({
  args: { reserved: v.number(), callers: v.number() },
  returns: v.object({
    granted: v.number(), rejected: v.number(),
    searchesReserved: v.number(), runCount: v.number(), searchBudgetLimit: v.number(),
  }),
  handler: async (ctx, { reserved, callers }): Promise<RaceOutcome> => {
    const { scanId, userId }: { scanId: Id<"scans">; userId: Id<"users"> } = await ctx.runMutation(internal.testing.seedScanAtReservation, { reserved });
    try {
      const outcomes: Array<{ runId: Id<"searchRuns">; reused: boolean } | { rejected: string }> = await Promise.all(
        Array.from({ length: callers }, (_, i) =>
          ctx.runMutation(internal.searchRuns.reserve, {
            scanId,
            spec: {
              templateId: "corroborate-entity-01", engine: "google" as const, purpose: "corroboration" as const,
              query: `race ${i}`, location: MILWAUKEE_LOCATION,
              language: "en" as const, timeWindow: "7d" as const,
            },
          }),
        ),
      );
      const counters: { searchesReserved: number; runCount: number; searchBudgetLimit: number } | null = await ctx.runQuery(internal.testing.readScanCounters, { scanId });
      if (!counters) throw new Error("seeded scan disappeared mid-race");
      return {
        granted: outcomes.filter((o) => "runId" in o).length,
        rejected: outcomes.filter((o) => "rejected" in o).length,
        searchesReserved: counters.searchesReserved,
        runCount: counters.runCount,
        searchBudgetLimit: counters.searchBudgetLimit,
      };
    } finally {
      await ctx.runMutation(internal.testing.deleteScanById, { scanId, userId });
    }
  },
});
