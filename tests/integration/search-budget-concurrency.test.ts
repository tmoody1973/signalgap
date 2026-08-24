import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { SEARCH_BUDGET } from "../../convex/config/searchBudget";
import { runDiscoveryStage } from "../../convex/stages/discovery";
import { asUser, fakeFetch, seedUser, setup } from "./helpers";

const NOW = 1_700_000_000_000;

/**
 * WHAT THIS FILE PROVES, AND WHAT IT DOES NOT.
 *
 * Proves: the reservation arithmetic is correct, allocations are respected, the
 * hard cap refuses the 121st, and counters stay consistent.
 *
 * Does NOT prove anything about concurrency. `convex-test` takes a mutex per
 * top-level transaction, so calls here never interleave. The real proof lives
 * in `tests/live/reserve-concurrency.test.ts`, which spawns 20 separate
 * `npx convex run` processes against the deployment. Do not quote this file as
 * evidence for the concurrency claim.
 */
describe("search budget accounting", () => {
  it("refuses the 121st reservation", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await t.run(async (ctx) => ctx.db.patch(scanId, { searchesReserved: SEARCH_BUDGET.hardCap }));

    const rejected = await t.mutation(internal.searchRuns.reserve, {
      scanId,
      spec: {
        templateId: "news-housing-en-01", engine: "google_news", purpose: "discovery",
        query: "Milwaukee housing when:7d", location: "Milwaukee, Wisconsin, United States",
        language: "en", timeWindow: "7d",
      },
    });
    expect(rejected).toEqual({ rejected: "budget_exhausted" });
  });

  it("a re-opened failed run counts as a NEW authorized attempt", async () => {
    const t = setup();
    await seedUser(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const failing = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: failing, sleep: async () => {} }));
    const afterFirst = await t.run(async (ctx) => ctx.db.get(scanId));

    await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }));
    const afterRetry = await t.run(async (ctx) => ctx.db.get(scanId));

    // The row is reused, so `reserved` does not climb — but `searchesFailed`
    // NEVER decrements. It is a cumulative count of failed attempts, not a live
    // gauge, and decrementing it makes succeeded + failed + in-flight ==
    // reserved impossible to hold.
    expect(afterRetry!.searchesFailed).toBeGreaterThanOrEqual(afterFirst!.searchesFailed);
  });

  it("succeeded plus failed never exceeds what was authorized", async () => {
    const t = setup();
    await seedUser(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }));

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan!.searchesSucceeded + scan!.searchesFailed).toBeLessThanOrEqual(scan!.searchesReserved);
  });

  it("the allocations sum to the hard cap", () => {
    const { discovery, coverage, corroboration, enrichment, reserve, hardCap } = SEARCH_BUDGET;
    // spec.md > Search budget. If this ever fails, the spec table and the code
    // have drifted and one of them is lying to an editor about what a scan costs.
    expect(discovery + coverage + corroboration + enrichment + reserve).toBe(hardCap);
  });

  it("discovery spends 13 of its 16-call ceiling", async () => {
    const t = setup();
    await seedUser(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }));

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // Decision 005. 16 is the ceiling in the spec's budget table; 13 is what
    // the frozen catalog actually contains after Google Events moved out.
    expect(scan!.searchesReserved).toBe(13);
    expect(scan!.searchesReserved).toBeLessThanOrEqual(SEARCH_BUDGET.discovery);
  });
});
