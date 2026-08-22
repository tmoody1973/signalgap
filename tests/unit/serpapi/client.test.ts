import { describe, expect, it, vi } from "vitest";
import { buildParams, callSerpApi } from "../../../convex/integrations/serpapi/client";
import type { SearchSpec } from "../../../convex/integrations/serpapi/contracts";

const spec = (over: Partial<SearchSpec> = {}): SearchSpec => ({
  templateId: "news-housing-en-01", engine: "google_news", purpose: "discovery",
  query: "Milwaukee housing", location: "Milwaukee, Wisconsin, United States",
  language: "en", timeWindow: "7d", ...over,
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const status = (code: number) => new Response("{}", { status: code });
const opts = (fetchImpl: typeof fetch) => ({ apiKey: "secret", fetchImpl, sleep: async () => {} });

describe("buildParams", () => {
  it("never includes the API key", () => {
    expect(JSON.stringify(buildParams(spec()))).not.toContain("secret");
    expect(Object.keys(buildParams(spec()))).not.toContain("api_key");
  });
  it("maps Trending Now to geo, not location", () => {
    const p = buildParams(spec({ engine: "google_trends_trending_now", query: "US-WI", timeWindow: "current" }));
    expect(p.geo).toBe("US-WI");
    expect(p.location).toBeUndefined();
  });
  it("maps google_maps to ll coordinates, not location", () => {
    const p = buildParams(spec({ engine: "google_maps", query: "Milwaukee Neighborhood News Service" }));
    expect(p.ll).toBe("@43.0389,-87.9065,12z");
    expect(p.location).toBeUndefined();
  });
  it("maps youtube to search_query", () => {
    expect(buildParams(spec({ engine: "youtube", query: "milwaukee common council" })).search_query).toBe("milwaukee common council");
  });
  it("carries the Spanish language through", () => {
    expect(buildParams(spec({ language: "es" })).hl).toBe("es");
  });
  it("does not send an undocumented num param for the google engine", () => {
    expect(buildParams(spec({ engine: "google", timeWindow: "current" })).num).toBeUndefined();
  });
  it("passes spec.query through unchanged for google_news (no tbs, no location)", () => {
    // Regression guard: the `when:` time-window operator is rendered into spec.query by
    // the query template, not appended here — otherwise searchRuns.query (the visible
    // log) would say one thing while SerpApi ran another.
    const q = "Milwaukee housing when:7d";
    const p = buildParams(spec({ engine: "google_news", query: q }));
    expect(p.q).toBe(q);
    expect(p.tbs).toBeUndefined();
    expect(p.location).toBeUndefined();
  });
  it("applies qdr tbs values for the google engine", () => {
    expect(buildParams(spec({ engine: "google", timeWindow: "7d" })).tbs).toBe("qdr:w");
    expect(buildParams(spec({ engine: "google", timeWindow: "30d" })).tbs).toBe("qdr:m");
  });
});

describe("callSerpApi", () => {
  it("returns the parsed body on first success", async () => {
    const fetchImpl = vi.fn(async () => ok({ news_results: [] })) as unknown as typeof fetch;
    const r = await callSerpApi(spec(), opts(fetchImpl));
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 twice then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => (++n < 3 ? status(429) : ok({ news_results: [] }))) as unknown as typeof fetch;
    const r = await callSerpApi(spec(), opts(fetchImpl));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.attempts).toBe(3);
  });

  it("gives up after two retries and reports the code", async () => {
    const fetchImpl = vi.fn(async () => status(503)) as unknown as typeof fetch;
    const r = await callSerpApi(spec(), opts(fetchImpl));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.attempts).toBe(3);
      expect(r.errorCode).toBe("http_503");
    }
  });

  it("never retries a 400", async () => {
    const fetchImpl = vi.fn(async () => status(400)) as unknown as typeof fetch;
    const r = await callSerpApi(spec(), opts(fetchImpl));
    expect(r.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never retries a 401", async () => {
    const fetchImpl = vi.fn(async () => status(401)) as unknown as typeof fetch;
    await callSerpApi(spec(), opts(fetchImpl));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats a SerpApi error field as a failure without retrying", async () => {
    const fetchImpl = vi.fn(async () => ok({ error: "Google hasn't returned any results" })) as unknown as typeof fetch;
    const r = await callSerpApi(spec(), opts(fetchImpl));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe("serpapi_error");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps the API key out of the failure message", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("connect failed https://serpapi.com/search.json?api_key=secret"); }) as unknown as typeof fetch;
    const r = await callSerpApi(spec(), opts(fetchImpl));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorMessage).not.toContain("secret");
  });

  it("honours a Retry-After header on a 429, capped at 30s", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () =>
      ++n < 2 ? new Response("{}", { status: 429, headers: { "retry-after": "120" } }) : ok({ news_results: [] })
    ) as unknown as typeof fetch;
    const sleep = vi.fn(async () => {});
    const r = await callSerpApi(spec(), { apiKey: "secret", fetchImpl, sleep });
    expect(r.ok).toBe(true);
    expect(sleep).toHaveBeenCalledWith(30_000);
  });
});
