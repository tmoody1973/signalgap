import { describe, expect, it } from "vitest";
import { callSerpApi } from "../../convex/integrations/serpapi/client";
import { MILWAUKEE_LOCATION } from "../../convex/integrations/serpapi/contracts";
import { normalizeResponse } from "../../convex/integrations/serpapi/normalize";
import { getTemplate, renderQuery } from "../../convex/integrations/serpapi/queryCatalog";

// Exactly ONE paid SerpApi call. Everything else in the suite runs on captured
// fixtures; this is the only thing that proves the fixtures still match reality.
const live = process.env.LIVE_TESTS === "1" && !!process.env.SERPAPI_API_KEY;

describe.skipIf(!live)("single bounded SerpApi search", () => {
  it("returns normalizable Milwaukee results for one discovery template", async () => {
    const template = getTemplate("news-housing-en-01");
    expect(template).toBeDefined();
    if (!template) return;

    const spec = {
      templateId: template.id, engine: template.engine, purpose: "discovery" as const,
      query: renderQuery(template, { now: Date.now(), terms: [] }),
      location: MILWAUKEE_LOCATION, language: template.language, timeWindow: template.timeWindow,
    };
    const result = await callSerpApi(spec, { apiKey: process.env.SERPAPI_API_KEY! });
    if (!result.ok) console.error(`live smoke failed: ${result.errorCode} ${result.errorMessage}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { results, skipped } = normalizeResponse(spec, result.json);
    console.log(`live smoke: query="${spec.query}" ${results.length} normalized, ${skipped} skipped, ${result.durationMs}ms`);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].canonicalUrl).toMatch(/^https?:\/\//);
  }, 90_000);
});
