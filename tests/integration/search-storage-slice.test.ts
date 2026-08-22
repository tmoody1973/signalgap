import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { scanDoc } from "../fixtures/factories";
import { asUser, setup } from "./helpers";

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

    const r = await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });
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
  }, 20_000);

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
