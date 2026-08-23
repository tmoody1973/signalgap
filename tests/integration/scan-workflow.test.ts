import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { discoverySpecs, runDiscoveryStage } from "../../convex/stages/discovery";
import { DISCOVERY_TEMPLATE_IDS } from "../../convex/integrations/serpapi/queryCatalog";
import { asUser, fakeFetch, seedUser, setup } from "./helpers";

const NOW = 1_700_000_000_000;

describe("scan workflow", () => {
  it("startScan records the workflow it started", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // A scan with no workflowId is a row nobody is executing. That is exactly
    // the state item 8 exists to remove.
    expect(scan?.workflowId).toEqual(expect.any(String));
    expect(scan?.status).toBe("queued");
    expect(scan?.searchBudgetLimit).toBe(120);
  });

  it("refuses a second live scan for the same owner", async () => {
    const t = setup();
    await seedUser(t);
    await asUser(t, "owner").mutation(api.scans.startScan, {});
    await expect(asUser(t, "owner").mutation(api.scans.startScan, {}))
      .rejects.toThrow(/already running/);
  });

  it("cancel marks the scan and leaves the workflow id in place for audit", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.cancelRequestedAt).toEqual(expect.any(Number));
    // Cancelling does NOT erase which workflow ran. An editor asking "what
    // happened to my scan" needs the id to still be there.
    expect(scan?.workflowId).toEqual(expect.any(String));
  });

  it("a stranger cannot cancel someone else's scan", async () => {
    const t = setup();
    await seedUser(t);
    await t.run(async (ctx) => ctx.db.insert("users", { clerkUserId: "stranger", createdAt: NOW, updatedAt: NOW }));
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await expect(asUser(t, "stranger").mutation(api.scans.cancel, { scanId }))
      .rejects.toThrow();
  });
});

describe("scan state transitions", () => {
  it("setStage moves queued to running the first time and records the stage", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    await t.mutation(internal.scans.setStage, { scanId, stage: "coverage" });
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.status).toBe("running");
    expect(scan?.stage).toBe("coverage");
  });

  it("recordFailure appends once per purpose+code, not once per occurrence", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    for (let i = 0; i < 3; i++) {
      await t.mutation(internal.scans.recordFailure, {
        scanId, purpose: "coverage", code: "http_429", message: "rate limited",
      });
    }
    await t.mutation(internal.scans.recordFailure, {
      scanId, purpose: "discovery", code: "http_429", message: "rate limited",
    });

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // Three rate-limited coverage calls are ONE thing an editor needs told,
    // not three. A different purpose is a different thing.
    expect(scan?.failureSummaries).toHaveLength(2);
    expect(scan?.failureSummaries.map((f) => f.purpose).sort()).toEqual(["coverage", "discovery"]);
  });

  it("finalize with no failures completes the scan", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await t.mutation(internal.scans.setStage, { scanId, stage: "briefs" });

    const { status } = await t.mutation(internal.scans.finalize, { scanId });
    expect(status).toBe("completed");
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.completedAt).toEqual(expect.any(Number));
  });

  it("finalize with named failures ends partial, not completed", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await t.mutation(internal.scans.recordFailure, {
      scanId, purpose: "coverage", code: "http_500", message: "upstream error",
    });

    const { status } = await t.mutation(internal.scans.finalize, { scanId });
    expect(status).toBe("partial");
  });

  it("finalize NEVER turns a cancelled scan into a completed one", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const { status } = await t.mutation(internal.scans.finalize, { scanId });
    expect(status).toBe("canceled");
  });

  it("finalize is safe to call twice and does not move a terminal scan", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const first = await t.mutation(internal.scans.finalize, { scanId });
    const firstCompletedAt = (await t.run(async (ctx) => ctx.db.get(scanId)))?.completedAt;
    await t.mutation(internal.scans.recordFailure, {
      scanId, purpose: "coverage", code: "late", message: "arrived after finalize",
    });
    const second = await t.mutation(internal.scans.finalize, { scanId });

    expect(first.status).toBe("completed");
    // A late failure cannot rewrite history. The scan already ended.
    expect(second.status).toBe("completed");
    expect((await t.run(async (ctx) => ctx.db.get(scanId)))?.completedAt).toBe(firstCompletedAt);
  });

  it("recordSearchOutcome accumulates and never decrements failures", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    await t.mutation(internal.scans.recordSearchOutcome, { scanId, succeeded: 3, failed: 1 });
    await t.mutation(internal.scans.recordSearchOutcome, { scanId, succeeded: 2, failed: 0 });

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.searchesSucceeded).toBe(5);
    // searchesFailed is a cumulative count of failed ATTEMPTS, not a live gauge
    // of currently-failed rows. A retry reuses the row, so decrementing would
    // make succeeded + failed + in-flight == reserved impossible to hold.
    expect(scan?.searchesFailed).toBe(1);
  });

  it("cancelling leaves the scan terminal, so the owner can start another one", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // Cancelling the workflow means the workflow will never reach its own
    // finalize. If cancel does not finalize, this scan sits queued forever and
    // startScan's duplicate guard locks the owner out permanently.
    expect(scan?.status).toBe("canceled");
    expect(scan?.completedAt).toEqual(expect.any(Number));

    await expect(asUser(t, "owner").mutation(api.scans.startScan, {})).resolves.toEqual(expect.any(String));
  });

  it("a terminal scan's summary is frozen — late writes cannot change it", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await t.mutation(internal.scans.recordSearchOutcome, { scanId, succeeded: 4, failed: 0 });
    await t.mutation(internal.scans.finalize, { scanId });

    const atFinalize = await t.run(async (ctx) => ctx.db.get(scanId));

    // A search that was already in flight when the scan ended reports back here.
    await t.mutation(internal.scans.recordSearchOutcome, { scanId, succeeded: 1, failed: 1 });
    await t.mutation(internal.scans.recordFailure, { scanId, purpose: "coverage", code: "late", message: "arrived after the scan ended" });
    await t.mutation(internal.scans.setCandidateCounts, { scanId, eligibleCount: 9, excludedCount: 9, processingCount: 9 });

    const after = await t.run(async (ctx) => ctx.db.get(scanId));
    // Without the guard, a failure appended after finalize would leave a scan
    // reading "completed" with a failure under it and no Incomplete scan label.
    expect(after!.failureSummaries).toEqual(atFinalize!.failureSummaries);
    expect(after!.searchesSucceeded).toBe(atFinalize!.searchesSucceeded);
    expect(after!.searchesFailed).toBe(atFinalize!.searchesFailed);
    expect(after!.eligibleCount).toBe(atFinalize!.eligibleCount);
    expect(after!.status).toBe("completed");
  });
});

describe("discovery stage", () => {
  it("renders exactly the 13 frozen templates, once each", () => {
    const specs = discoverySpecs(NOW);
    expect(specs).toHaveLength(13);
    expect(specs.map((s) => s.templateId).sort()).toEqual([...DISCOVERY_TEMPLATE_IDS].sort());
    // Decision 005: Google Events is enrichment now, and must not reappear here.
    expect(specs.some((s) => s.engine === "google_events")).toBe(false);
    for (const spec of specs) {
      expect(spec.purpose).toBe("discovery");
      expect(spec.query.trim().length).toBeGreaterThan(0);
    }
  });

  it("every rendered query is unique, so no two runs share an idempotency key", () => {
    const queries = discoverySpecs(NOW).map((s) => `${s.templateId}|${s.query}`);
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("executes all 13 and reserves 13, not 16", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const outcome = await t.action(async (ctx) =>
      runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }),
    );

    expect(outcome.executed).toBe(13);
    expect(outcome.canceled).toBe(false);
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // 16 is the budget CEILING. Spending 13 is the point of decision 005.
    expect(scan?.searchesReserved).toBe(13);
  });

  it("stops before the next search once cancellation is requested", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const outcome = await t.action(async (ctx) =>
      runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }),
    );

    expect(outcome.canceled).toBe(true);
    expect(outcome.executed).toBe(0);
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // Not one paid call after the editor said stop.
    expect(scan?.searchesReserved).toBe(0);
  });

  it("a failing search is named on the scan and does not stop the other twelve", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const failOnSpanish = (async (input: RequestInfo | URL) => {
      const q = new URL(String(input)).searchParams.get("q") ?? "";
      if (q.includes("vivienda")) return new Response("upstream boom", { status: 500 });
      return new Response(JSON.stringify({ search_metadata: { id: "x", status: "Success" }, organic_results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const outcome = await t.action(async (ctx) =>
      runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: failOnSpanish, sleep: async () => {} }),
    );

    expect(outcome.failed).toBeGreaterThanOrEqual(1);
    expect(outcome.succeeded).toBeGreaterThanOrEqual(11);
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.failureSummaries.some((f) => f.purpose === "discovery")).toBe(true);
  });

  it("running the stage twice reuses completed runs and reserves nothing new", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    const opts = { fetchImpl: fakeFetch(), sleep: async () => {} };

    await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, opts));
    const afterFirst = (await t.run(async (ctx) => ctx.db.get(scanId)))?.searchesReserved;
    const second = await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, opts));

    // Resuming a workflow after a restart must not re-buy searches we own.
    expect((await t.run(async (ctx) => ctx.db.get(scanId)))?.searchesReserved).toBe(afterFirst);
    expect(second.skipped).toBe(13);
    expect(second.executed).toBe(0);
  });
});
