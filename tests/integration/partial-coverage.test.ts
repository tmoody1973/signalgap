import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { runCoverageStage } from "../../convex/stages/coverage";
import { asUser, seedFormedCandidate, seedManyFormedCandidates, setup } from "./helpers";

const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.stubEnv("SERPAPI_API_KEY", "test-key");
});

const emptyResults = { search_metadata: { id: "x", status: "Success" }, organic_results: [] };

const jsOnlineResult = {
  search_metadata: { id: "y", status: "Success" },
  organic_results: [{
    position: 1,
    title: "Metcalfe Park hub clears commission",
    link: "https://www.jsonline.com/story/news/2026/08/17/metcalfe-park/",
    snippet: "The plan commission approved the project.",
    date: "Aug 17, 2026",
  }],
};

describe("coverage stage", () => {
  it("runs BOTH partitions for a candidate and marks the pass complete", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    await t.action(async (ctx) => runCoverageStage(ctx, { scanId, candidateIds: [candidateId], now: NOW }, {
      fetchImpl: (async () => new Response(JSON.stringify(emptyResults), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch,
      sleep: async () => {},
    }));

    const candidate = await t.run(async (ctx) => ctx.db.get(candidateId));
    expect(candidate?.coveragePartitions).toEqual({ general: "succeeded", community: "succeeded" });

    const runs = await t.run(async (ctx) =>
      ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId).eq("purpose", "coverage")).collect());
    // Two partitions, two reservations. The spec's arithmetic: 20 coverage
    // reservations means at most 10 candidates fully checked.
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.templateId).sort()).toEqual(["coverage-community-01", "coverage-general-01"]);
  });

  it("a failed community partition blocks Coverage gap but keeps the lead", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    const failCommunity = (async (input: RequestInfo | URL) => {
      const q = new URL(String(input)).searchParams.get("q") ?? "";
      if (q.includes("milwaukeenns.org")) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify(emptyResults), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    await t.action(async (ctx) => runCoverageStage(ctx, { scanId, candidateIds: [candidateId], now: NOW }, { fetchImpl: failCommunity, sleep: async () => {} }));
    await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });

    const candidate = await t.run(async (ctx) => ctx.db.get(candidateId));
    expect(candidate?.coveragePartitions).toEqual({ general: "succeeded", community: "failed" });
    expect(candidate?.coveragePassStatus).toBe("failed");
    // Zero results from the general partition is NOT "nobody covered this" when
    // the community outlets were never reached. That claim is what this blocks.
    expect(candidate?.primaryLabel).not.toBe("Coverage gap");
    // But the lead survives. A failed coverage pass is not a reason to bin it.
    expect(candidate?.exclusionReasons).toContain("coverage_pass_incomplete");
  });

  it("a found report is attached as a coverage source and counted once per outlet", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    const found = (async (input: RequestInfo | URL) => {
      const q = new URL(String(input)).searchParams.get("q") ?? "";
      const body = q.includes("jsonline.com") ? jsOnlineResult : emptyResults;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    await t.action(async (ctx) => runCoverageStage(ctx, { scanId, candidateIds: [candidateId], now: NOW }, { fetchImpl: found, sleep: async () => {} }));

    const memberships = await t.run(async (ctx) =>
      ctx.db.query("candidateSources").withIndex("by_candidate_role", (q) => q.eq("candidateId", candidateId).eq("role", "coverage")).collect());
    expect(memberships).toHaveLength(1);
    expect(memberships[0].addedBy).toBe("deterministic_rule");
  });

  it("a story older than the 30-day window is not counted as coverage", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    const stale = {
      search_metadata: { id: "z", status: "Success" },
      organic_results: [{
        position: 1, title: "Old Metcalfe Park story",
        link: "https://www.jsonline.com/story/news/2023/08/17/metcalfe-park/",
        snippet: "An old story.",
        // 45 days before NOW (1_700_000_000_000 = 2023-11-14) — well outside
        // COVERAGE_WINDOW_MS. Outside the window a story is a different story,
        // not prior coverage of this development. Counting it would understate
        // the gap the product exists to report.
        date: "Oct 1, 2023",
      }],
    };
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const q = new URL(String(input)).searchParams.get("q") ?? "";
      const body = q.includes("jsonline.com") ? stale : emptyResults;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    await t.action(async (ctx) => runCoverageStage(ctx, { scanId, candidateIds: [candidateId], now: NOW }, { fetchImpl, sleep: async () => {} }));

    const memberships = await t.run(async (ctx) =>
      ctx.db.query("candidateSources").withIndex("by_candidate_role", (q) => q.eq("candidateId", candidateId).eq("role", "coverage")).collect());
    expect(memberships).toHaveLength(0);
  });

  it("a result with no publish date is not counted as coverage", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    const undated = {
      search_metadata: { id: "z", status: "Success" },
      organic_results: [{
        position: 1, title: "Undated Metcalfe Park story",
        link: "https://www.jsonline.com/story/news/metcalfe-park/",
        snippet: "No date on this one.",
        // No `date` field at all: publishedAt comes back undefined. Absence of
        // a date is not evidence the story falls inside the window — it must
        // not silently count as coverage either.
      }],
    };
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const q = new URL(String(input)).searchParams.get("q") ?? "";
      const body = q.includes("jsonline.com") ? undated : emptyResults;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    await t.action(async (ctx) => runCoverageStage(ctx, { scanId, candidateIds: [candidateId], now: NOW }, { fetchImpl, sleep: async () => {} }));

    const memberships = await t.run(async (ctx) =>
      ctx.db.query("candidateSources").withIndex("by_candidate_role", (q) => q.eq("candidateId", candidateId).eq("role", "coverage")).collect());
    expect(memberships).toHaveLength(0);
  });

  it("a story from an outlet outside the frozen catalog is not counted as coverage", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    const offCatalog = {
      search_metadata: { id: "z", status: "Success" },
      organic_results: [{
        position: 1, title: "OnMilwaukee covers Metcalfe Park",
        // A real, well-known Milwaukee outlet — just not one the frozen
        // catalog names. The catalog IS the claim: an off-catalog hit must not
        // silently widen what "coverage" means.
        link: "https://onmilwaukee.com/articles/metcalfe-park",
        snippet: "OnMilwaukee's own report.",
        date: "Aug 17, 2026",
      }],
    };
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const q = new URL(String(input)).searchParams.get("q") ?? "";
      const body = q.includes("jsonline.com") ? offCatalog : emptyResults;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    await t.action(async (ctx) => runCoverageStage(ctx, { scanId, candidateIds: [candidateId], now: NOW }, { fetchImpl, sleep: async () => {} }));

    const memberships = await t.run(async (ctx) =>
      ctx.db.query("candidateSources").withIndex("by_candidate_role", (q) => q.eq("candidateId", candidateId).eq("role", "coverage")).collect());
    expect(memberships).toHaveLength(0);
  });

  it("stops before the next partition once cancellation is requested", async () => {
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const outcome = await t.action(async (ctx) => runCoverageStage(ctx, { scanId, candidateIds: [candidateId], now: NOW }, {
      fetchImpl: (async () => new Response(JSON.stringify(emptyResults), { status: 200 })) as unknown as typeof fetch,
      sleep: async () => {},
    }));

    expect(outcome.canceled).toBe(true);
    const runs = await t.run(async (ctx) =>
      ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId).eq("purpose", "coverage")).collect());
    expect(runs).toHaveLength(0);
  });

  it("stops at the coverage allocation rather than eating the enrichment budget", async () => {
    const t = setup();
    const { scanId, candidateIds } = await seedManyFormedCandidates(t, 15);

    const outcome = await t.action(async (ctx) => runCoverageStage(ctx, { scanId, candidateIds, now: NOW }, {
      fetchImpl: (async () => new Response(JSON.stringify(emptyResults), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch,
      sleep: async () => {},
    }));

    const runs = await t.run(async (ctx) =>
      ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId).eq("purpose", "coverage")).collect());
    // SEARCH_BUDGET.coverage is 20, two per candidate: exactly ten candidates
    // checked, exactly twenty reservations, and the remaining five skipped.
    expect(runs.length).toBe(20);
    expect(outcome.checked).toBe(10);
    expect(outcome.skippedForBudget).toBe(5);
  });
});
