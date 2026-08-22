import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { runExecuteSearch } from "../../convex/integrations/serpapi/executeSearch";
import { scanDoc } from "../fixtures/factories";
import { asUser, setup } from "./helpers";

const noSleep = async () => {};

const SPEC = {
  templateId: "reddit-housing-01", engine: "google" as const, purpose: "discovery" as const,
  query: "site:reddit.com/r/milwaukee/comments/ (development)",
  location: "Milwaukee, Wisconsin, United States" as const, language: "en" as const, timeWindow: "7d" as const,
};

const BODY = {
  organic_results: [
    { position: 1, title: "Any word on the Bronzeville build?", link: "https://www.reddit.com/r/milwaukee/comments/1abc23/any_word/", snippet: "Saw fencing go up" },
    { position: 2, title: "Duplicate", link: "https://www.reddit.com/r/milwaukee/comments/1abc23/any_word/?utm_source=x", snippet: "same post" },
  ],
};

async function scanFor(t: ReturnType<typeof setup>) {
  const alice = asUser(t, "alice");
  const ownerId = await alice.mutation(api.users.ensureCurrent, {});
  const scanId = await t.run((ctx) => ctx.db.insert("scans", scanDoc(ownerId)));
  return { scanId, alice };
}

// Ruling 18 invariant: every paid attempt ever authorized (searchesReserved)
// ends up in exactly one bucket — succeeded, failed, or still in flight
// (reserved/running). If this breaks, either money is being under-counted
// (reserved undercounts real calls) or a run is stuck unaccounted for.
async function assertScanInvariant(t: ReturnType<typeof setup>, scanId: Id<"scans">) {
  const { scan, runs } = await t.run(async (ctx) => ({
    scan: await ctx.db.get(scanId),
    runs: await ctx.db.query("searchRuns").withIndex("by_scan_status", (q) => q.eq("scanId", scanId)).collect(),
  }));
  if (!scan) throw new Error("scan not found");
  const inFlight = runs.filter((r) => r.status === "reserved" || r.status === "running").length;
  expect(scan.searchesSucceeded + scan.searchesFailed + inFlight).toBe(scan.searchesReserved);
  expect(scan.searchesReserved).toBeLessThanOrEqual(120);
}

describe("executeSearch slice", () => {
  it("reserves once, archives raw JSON, and ingests deduplicated results", async () => {
    const t = setup();
    const { scanId } = await scanFor(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchImpl);

    const r = await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });
    expect(r.status).toBe("succeeded");
    expect(r.resultCount).toBe(1); // the utm duplicate collapses onto the same post id

    const { runs, results, scan } = await t.run(async (ctx) => ({
      runs: await ctx.db.query("searchRuns").collect(),
      results: await ctx.db.query("sourceResults").collect(),
      scan: await ctx.db.get(scanId),
    }));
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("succeeded");
    expect(runs[0].rawStorageId).toBeDefined();
    expect(JSON.stringify(runs[0].parameters)).not.toContain("test-key");
    expect(results).toHaveLength(1);
    expect(results[0].redditPostId).toBe("1abc23");
    expect(scan?.searchesReserved).toBe(1);
    expect(scan?.searchesSucceeded).toBe(1);
    await assertScanInvariant(t, scanId);
  });

  it("re-running the same spec does not double-reserve or duplicate results", async () => {
    const t = setup();
    const { scanId } = await scanFor(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200 })));

    await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });
    await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });

    const { runs, results, scan } = await t.run(async (ctx) => ({
      runs: await ctx.db.query("searchRuns").collect(),
      results: await ctx.db.query("sourceResults").collect(),
      scan: await ctx.db.get(scanId),
    }));
    expect(runs).toHaveLength(1);
    expect(results).toHaveLength(1);
    expect(scan?.searchesReserved).toBe(1);
  });

  it("records a failure without ingesting anything", async () => {
    const t = setup();
    const { scanId } = await scanFor(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));

    // Real callSerpApi retries a 503 with jittered backoff — inject a no-op sleep
    // via the extracted runExecuteSearch so this test doesn't wait out real timers.
    const r = await t.action((ctx) => runExecuteSearch(ctx, { scanId, spec: SPEC }, { sleep: noSleep }));
    expect(r.status).toBe("failed");

    const { runs, results, scan } = await t.run(async (ctx) => ({
      runs: await ctx.db.query("searchRuns").collect(),
      results: await ctx.db.query("sourceResults").collect(),
      scan: await ctx.db.get(scanId),
    }));
    expect(runs[0].status).toBe("failed");
    expect(runs[0].errorCode).toBe("http_503");
    expect(results).toHaveLength(0);
    expect(scan?.searchesFailed).toBe(1);
    await assertScanInvariant(t, scanId);
  });

  it("routes a thrown ingest error to a truthful failed run, never leaving it stuck running", async () => {
    const t = setup();
    const { scanId } = await scanFor(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200 })));

    const r = await t.action(async (ctx) => {
      // Simulate ingest throwing (write conflict, validator mismatch, RPC failure)
      // after the paid SerpApi call already succeeded — everything else routes
      // through the real ctx.
      // internal.sourceResults.ingest is a fresh Proxy on every access (Convex's
      // generated api has no stable object identity per path) — compare by the
      // resolved "module:function" name instead of `===`.
      const ingestName = getFunctionName(internal.sourceResults.ingest);
      const spyingCtx = {
        ...ctx,
        runMutation: ((ref: unknown, args: unknown) =>
          getFunctionName(ref as never) === ingestName
            ? Promise.reject(new Error("simulated write conflict"))
            : ctx.runMutation(ref as never, args as never)) as typeof ctx.runMutation,
      };
      return runExecuteSearch(spyingCtx, { scanId, spec: SPEC }, { sleep: noSleep });
    });

    expect(r.status).toBe("failed");
    const { runs, results, scan } = await t.run(async (ctx) => ({
      runs: await ctx.db.query("searchRuns").collect(),
      results: await ctx.db.query("sourceResults").collect(),
      scan: await ctx.db.get(scanId),
    }));
    expect(runs[0].status).toBe("failed");
    expect(runs[0].errorCode).toBe("ingest_failed");
    expect(results).toHaveLength(0);
    expect(scan?.searchesFailed).toBe(1);
  });

  it("skips without a network call when a reused run already succeeded", async () => {
    const t = setup();
    const { scanId } = await scanFor(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    const first = await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });
    expect(first.status).toBe("succeeded");
    fetchImpl.mockClear();

    const second = await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });
    expect(second.status).toBe("skipped");
    expect(second.resultCount).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips without a network call when a reused run is still running and fresh", async () => {
    const t = setup();
    const { scanId } = await scanFor(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const reserved = await t.mutation(internal.searchRuns.reserve, { scanId, spec: SPEC });
    const { runId } = reserved as { runId: Id<"searchRuns"> };
    await t.run((ctx) => ctx.db.patch(runId, { status: "running", reservedAt: Date.now() }));

    const r = await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });
    expect(r.status).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries a reused run that is running but past the staleness window", async () => {
    const t = setup();
    const { scanId } = await scanFor(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    const reserved = await t.mutation(internal.searchRuns.reserve, { scanId, spec: SPEC });
    const { runId } = reserved as { runId: Id<"searchRuns"> };
    // Past the 5-minute staleness window — a "running" row this old is presumed
    // abandoned (e.g. a crashed action), not still in flight.
    await t.run((ctx) => ctx.db.patch(runId, { status: "running", reservedAt: Date.now() - 6 * 60_000 }));

    const r = await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });
    expect(fetchImpl).toHaveBeenCalled();
    expect(r.status).toBe("succeeded");
  });

  it("a failed-run retry that succeeds re-opens the run as a new paid attempt and clears the stale error (Ruling 18)", async () => {
    const t = setup();
    const { scanId } = await scanFor(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    const reserved = await t.mutation(internal.searchRuns.reserve, { scanId, spec: SPEC });
    const { runId } = reserved as { runId: Id<"searchRuns"> };
    await t.run((ctx) => ctx.db.patch(runId, {
      status: "failed", errorCode: "network_error", errorMessage: "prior attempt", completedAt: Date.now(),
    }));
    await t.run((ctx) => ctx.db.patch(scanId, { searchesFailed: 1 }));

    const r = await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });
    expect(fetchImpl).toHaveBeenCalled();
    expect(r.status).toBe("succeeded");

    const { run, scan } = await t.run(async (ctx) => ({ run: await ctx.db.get(runId), scan: await ctx.db.get(scanId) }));
    expect(run?.status).toBe("succeeded");
    // A stale error from the first attempt must not survive a successful retry.
    expect(run?.errorCode).toBeUndefined();
    expect(run?.errorMessage).toBeUndefined();
    // The reopen is its own authorized paid attempt: reserved goes up by 1 even
    // though no new row was inserted.
    expect(scan?.searchesReserved).toBe(2);
    expect(scan?.searchesSucceeded).toBe(1);
    await assertScanInvariant(t, scanId);
  });

  it("a failed-run retry that fails again counts a second failed attempt on the same run (Ruling 18)", async () => {
    const t = setup();
    const { scanId } = await scanFor(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));

    const reserved = await t.mutation(internal.searchRuns.reserve, { scanId, spec: SPEC });
    const { runId } = reserved as { runId: Id<"searchRuns"> };
    await t.run((ctx) => ctx.db.patch(runId, {
      status: "failed", errorCode: "network_error", errorMessage: "prior attempt", completedAt: Date.now(),
    }));
    await t.run((ctx) => ctx.db.patch(scanId, { searchesFailed: 1 }));

    const r = await t.action((ctx) => runExecuteSearch(ctx, { scanId, spec: SPEC }, { sleep: noSleep }));
    expect(r.status).toBe("failed");

    const { run, scan } = await t.run(async (ctx) => ({ run: await ctx.db.get(runId), scan: await ctx.db.get(scanId) }));
    expect(run?.status).toBe("failed");
    expect(run?.errorCode).toBe("http_503"); // the new failure, not the stale one
    expect(scan?.searchesReserved).toBe(2);
    expect(scan?.searchesFailed).toBe(2); // a distinct paid attempt failing, counted again
    await assertScanInvariant(t, scanId);
  });

  it("refuses to reopen a failed run at the budget cap, without a network call (Ruling 18)", async () => {
    const t = setup();
    const { scanId, alice } = await scanFor(t);
    const ownerId = await alice.mutation(api.users.ensureCurrent, {});
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const reserved = await t.mutation(internal.searchRuns.reserve, { scanId, spec: SPEC });
    const { runId } = reserved as { runId: Id<"searchRuns"> };
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { status: "failed", errorCode: "network_error", errorMessage: "prior", completedAt: Date.now() });
      // Fill the rest of the budget with real rows, not a synthetic counter —
      // the invariant only means something if it corresponds to actual rows.
      for (let i = 0; i < 119; i++) {
        await ctx.db.insert("searchRuns", {
          scanId, ownerId, idempotencyKey: `filler-${i}`, templateId: `filler-${i}`,
          queryCatalogVersion: "t", purpose: "discovery" as const, engine: "google" as const, query: `q-${i}`,
          parameters: {}, language: "en" as const, status: "succeeded" as const, attemptCount: 1, resultCount: 0,
          durationMs: 0, reservedAt: 1, completedAt: 2,
        });
      }
      await ctx.db.patch(scanId, { searchesReserved: 120, searchesSucceeded: 119, searchesFailed: 1 });
    });

    const r = await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });
    expect(r.status).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    await assertScanInvariant(t, scanId);
  });

  it("skips without calling SerpApi when the budget is exhausted", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    const ownerId = await alice.mutation(api.users.ensureCurrent, {});
    const scanId = await t.run((ctx) => ctx.db.insert("scans", scanDoc(ownerId, { searchesReserved: 120 })));
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");

    const r = await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });
    expect(r.status).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never exposes rawStorageId through the owner-scoped query", async () => {
    const t = setup();
    const { scanId, alice } = await scanFor(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200 })));
    await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });

    const page = await alice.query(api.sourceResults.listForScan, { scanId, paginationOpts: { numItems: 25, cursor: null } });
    expect(JSON.stringify(page)).not.toMatch(/rawStorageId|api_key/);
    expect(page.page[0].canonicalUrl).toContain("reddit.com/r/milwaukee/comments/1abc23");
  });

  it("maps sourceFamily to a deterministic sourceType at ingest, never guessing secondary", async () => {
    const t = setup();
    const { scanId, alice } = await scanFor(t);
    const ownerId = await alice.mutation(api.users.ensureCurrent, {});
    const searchRunId = await t.run((ctx) => ctx.db.insert("searchRuns", {
      scanId, ownerId, idempotencyKey: "x", templateId: "news-housing-en-01",
      queryCatalogVersion: "t", purpose: "discovery" as const, engine: "google_news" as const,
      query: "q", parameters: {}, language: "en" as const,
      status: "running" as const, attemptCount: 1, resultCount: 0, durationMs: 0, reservedAt: 1,
    }));

    const base = { originalLanguage: "en", snippet: "", title: "t" };
    await t.mutation(internal.sourceResults.ingest, {
      scanId, searchRunId,
      results: [
        { ...base, engine: "google" as const, canonicalUrl: "https://reddit.com/r/milwaukee/comments/a1/x", originalUrl: "https://reddit.com/r/milwaukee/comments/a1/x", sourceFamily: "community_discussion" as const },
        { ...base, engine: "google" as const, canonicalUrl: "https://city.milwaukee.gov/a", originalUrl: "https://city.milwaukee.gov/a", sourceFamily: "official" as const },
        { ...base, engine: "google_news" as const, canonicalUrl: "https://jsonline.com/a", originalUrl: "https://jsonline.com/a", sourceFamily: "news" as const },
      ],
    });

    const results = await t.run((ctx) => ctx.db.query("sourceResults").collect());
    const byFamily = Object.fromEntries(results.map((r) => [r.sourceFamily, r.sourceType]));
    expect(byFamily.community_discussion).toBe("discussion");
    expect(byFamily.official).toBe("primary");
    expect(byFamily.news).toBe("unknown");
    expect(results.some((r) => r.sourceType === "secondary")).toBe(false);
  });
});
