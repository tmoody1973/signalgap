import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeResponse } from "../../../convex/integrations/serpapi/normalize";
import type { SearchSpec } from "../../../convex/integrations/serpapi/contracts";

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.resolve(__dirname, `../../fixtures/serpapi/${name}.json`), "utf8"));

const spec = (over: Partial<SearchSpec>): SearchSpec => ({
  templateId: "t", engine: "google", purpose: "discovery", query: "q",
  location: "Milwaukee, Wisconsin, United States", language: "en", timeWindow: "7d", ...over,
});

describe("normalizeResponse", () => {
  it("maps google_news results to the news family with publisher and date", () => {
    const { results } = normalizeResponse(spec({ engine: "google_news" }), fixture("google_news"));
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.sourceFamily).toBe("news");
      expect(r.canonicalUrl).toMatch(/^https?:\/\//);
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  it("maps youtube results to video and keeps the channel", () => {
    const { results } = normalizeResponse(spec({ engine: "youtube" }), fixture("youtube"));
    expect(results.every((r) => r.sourceFamily === "video")).toBe(true);
    expect(results.some((r) => r.channel !== undefined)).toBe(true);
  });

  it("maps google_maps results to map and keeps the place name", () => {
    const { results } = normalizeResponse(spec({ engine: "google_maps" }), fixture("google_maps"));
    expect(results.every((r) => r.sourceFamily === "map")).toBe(true);
    expect(results.some((r) => r.placeName !== undefined)).toBe(true);
  });

  it("maps google_events results to event", () => {
    const { results } = normalizeResponse(spec({ engine: "google_events" }), fixture("google_events"));
    expect(results.every((r) => r.sourceFamily === "event")).toBe(true);
  });

  it("maps trending searches to the trend family", () => {
    const { results } = normalizeResponse(
      spec({ engine: "google_trends_trending_now", timeWindow: "current" }),
      fixture("google_trends_trending_now"),
    );
    expect(results.every((r) => r.sourceFamily === "trend")).toBe(true);
  });

  it("classifies a google result on an official domain as official", () => {
    const json = { organic_results: [{ position: 1, title: "Common Council agenda", link: "https://city.milwaukee.gov/agenda/1", snippet: "..." }] };
    const { results } = normalizeResponse(spec({}), json);
    expect(results[0].sourceFamily).toBe("official");
  });

  it("classifies an r/milwaukee comment permalink as community discussion and keeps the post id", () => {
    const json = { organic_results: [{ position: 1, title: "Any word on the Bronzeville build?", link: "https://www.reddit.com/r/milwaukee/comments/1abc23/any_word/", snippet: "..." }] };
    const { results } = normalizeResponse(spec({}), json);
    expect(results[0].sourceFamily).toBe("community_discussion");
    expect(results[0].nativeId).toBe("1abc23");
  });

  it("skips a reddit result that is not an r/milwaukee comment permalink", () => {
    const json = { organic_results: [{ position: 1, title: "x", link: "https://www.reddit.com/r/wisconsin/comments/9zz/x/", snippet: "..." }] };
    const { results, skipped } = normalizeResponse(spec({}), json);
    expect(results).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("counts malformed entries instead of coercing them", () => {
    const json = { organic_results: [{ position: 1 }, { link: "https://x.org/a", title: "ok", snippet: "s" }] };
    const { results, skipped } = normalizeResponse(spec({}), json);
    expect(results).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it("returns an empty result set for an empty response without throwing", () => {
    expect(normalizeResponse(spec({}), {})).toEqual({ results: [], skipped: 0 });
  });

  it("carries the spec language onto every result", () => {
    const json = { organic_results: [{ position: 1, title: "Vivienda", link: "https://x.org/a", snippet: "s" }] };
    const { results } = normalizeResponse(spec({ language: "es" }), json);
    expect(results[0].originalLanguage).toBe("es");
  });

  // Real captured responses for the two google-engine shapes (item 10's live-fixture
  // requirement) — confirms the official/community_discussion branches hold up
  // against actual SerpApi output, not just hand-built JSON.
  it("classifies a live-captured official-domain search as official", () => {
    const { results, skipped } = normalizeResponse(spec({ templateId: "official-housing-01" }), fixture("google_official"));
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.sourceFamily === "official")).toBe(true);
    expect(skipped).toBe(0);
  });

  it("classifies a live-captured r/milwaukee discovery search as community discussion", () => {
    const { results, skipped } = normalizeResponse(spec({ templateId: "reddit-housing-01" }), fixture("google_reddit"));
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.sourceFamily === "community_discussion" && r.nativeId !== undefined)).toBe(true);
    expect(skipped).toBe(0);
  });
});
