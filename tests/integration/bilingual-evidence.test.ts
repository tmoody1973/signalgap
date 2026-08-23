import { beforeEach, describe, expect, it } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { runAnalyzeResults } from "../../convex/ai/analyzeResults";
import type { GenerateFn } from "../../convex/ai/provider";
import { independenceSummary } from "../../convex/editorial/independence";
import type { EngineSource } from "../../convex/editorial/types";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { setup } from "./helpers";

/**
 * Spanish-language discovery is a coverage decision, not a translation feature.
 * The rules that decide eligibility, coverage, confirmation and score are
 * identical across languages — and translation quality can never stand in for
 * missing source evidence.
 */

const SPANISH = {
  title: "La ciudad aprueba la rezonificación de Harambee",
  snippet: "El consejo votó 9-4 el martes por la noche.",
  publisher: "El Conquistador",
  canonicalUrl: "https://elconquistador.com/rezonificacion",
  publishedAt: 1_700_000_000_000,
};

const fixedModel = (object: unknown): GenerateFn => async () =>
  ({ object, usage: { inputTokens: 10, outputTokens: 5 } });

const analysisItem = (id: Id<"sourceResults">, over: Record<string, unknown> = {}) => ({
  sourceResultId: id,
  detectedLanguage: "es",
  originalTitle: SPANISH.title, translatedTitle: "The city approves the Harambee rezoning",
  originalSnippet: SPANISH.snippet, translatedSnippet: "The council voted 9-4 on Tuesday night.",
  sourceTypeSuggestion: "secondary",
  entities: { people: [], organizations: [], streets: [], neighborhoods: ["Harambee"], agencies: [] },
  dates: [], claims: [], potentialHumanSources: [],
  reason: "A Spanish-language local outlet reported the vote.",
  ...over,
});

async function seedSpanish(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));
    const spanishId = await ctx.db.insert("sourceResults", {
      scanId, searchRunId, ownerId,
      canonicalKey: "k-es", canonicalUrl: SPANISH.canonicalUrl, originalUrl: SPANISH.canonicalUrl,
      engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
      title: SPANISH.title, snippet: SPANISH.snippet, publisher: SPANISH.publisher,
      publishedAt: SPANISH.publishedAt, originalLanguage: "es",
      discoveredAt: now, isAccessible: true, contentHash: "h",
    });
    return { ownerId, scanId, spanishId };
  });
}

beforeEach(() => {
  process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
  process.env.AI_FALLBACK_ENABLED = "false";
});

describe("a Spanish result keeps everything it arrived with", () => {
  it("leaves title, snippet, publisher, publishedAt and canonicalUrl exactly as captured", async () => {
    const t = setup();
    const { scanId, spanishId } = await seedSpanish(t);

    await t.action(async (ctx) => await runAnalyzeResults(
      ctx, { scanId, sourceResultIds: [spanishId] }, fixedModel({ items: [analysisItem(spanishId)] })));

    const row = (await t.run(async (ctx) => await ctx.db.get(spanishId))) as Doc<"sourceResults">;
    expect(row.title).toBe(SPANISH.title);
    expect(row.snippet).toBe(SPANISH.snippet);
    expect(row.publisher).toBe(SPANISH.publisher);
    expect(row.publishedAt).toBe(SPANISH.publishedAt);
    expect(row.canonicalUrl).toBe(SPANISH.canonicalUrl);
    expect(row.originalLanguage).toBe("es");
  });

  it("adds the translation in its own fields, beside the original", async () => {
    const t = setup();
    const { scanId, spanishId } = await seedSpanish(t);

    await t.action(async (ctx) => await runAnalyzeResults(
      ctx, { scanId, sourceResultIds: [spanishId] }, fixedModel({ items: [analysisItem(spanishId)] })));

    const row = (await t.run(async (ctx) => await ctx.db.get(spanishId))) as Doc<"sourceResults">;
    expect(row.translatedTitle).toBe("The city approves the Harambee rezoning");
    expect(row.translatedSnippet).toBe("The council voted 9-4 on Tuesday night.");
    // The translated fields are separate columns, so anything rendering the row
    // can label them as AI-generated without guessing which text is which.
    expect(row.translatedTitle).not.toBe(row.title);
  });

  it("rejects a translation offered with no original beside it", async () => {
    const t = setup();
    const { scanId, spanishId } = await seedSpanish(t);

    const outcome = await t.action(async (ctx) => await runAnalyzeResults(
      ctx, { scanId, sourceResultIds: [spanishId] },
      fixedModel({ items: [analysisItem(spanishId, { originalTitle: null, originalSnippet: null })] }),
    ));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors.join(" ")).toMatch(/translation with no original/);

    const row = (await t.run(async (ctx) => await ctx.db.get(spanishId))) as Doc<"sourceResults">;
    expect(row.translatedTitle).toBeUndefined();
  });

  it("does not change whether the source is accessible or verified", async () => {
    const t = setup();
    const { scanId, spanishId } = await seedSpanish(t);
    const before = (await t.run(async (ctx) => await ctx.db.get(spanishId))) as Doc<"sourceResults">;

    await t.action(async (ctx) => await runAnalyzeResults(
      ctx, { scanId, sourceResultIds: [spanishId] }, fixedModel({ items: [analysisItem(spanishId)] })));

    const after = (await t.run(async (ctx) => await ctx.db.get(spanishId))) as Doc<"sourceResults">;
    expect(after.isAccessible).toBe(before.isAccessible);
    expect(after.accessCheckedAt).toBe(before.accessCheckedAt);
    expect(after.contentHash).toBe(before.contentHash);
  });
});

describe("translation never manufactures independence", () => {
  const source = (over: Partial<EngineSource>): EngineSource => ({
    id: "a", signalCategory: "original_news", role: "corroborating",
    independenceGroup: "press-release-250412", isAccessible: true, isPromotional: false,
    ...over,
  });

  it("a Spanish story repeating the same press release stays one original report", () => {
    const summary = independenceSummary([
      source({ id: "en" }),
      source({ id: "es" }), // translated for the reader; same lineage
    ]);
    expect(summary.independentCategoryCount).toBe(1);
    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0].sourceIds).toEqual(["en", "es"]);
  });

  it("counts a Spanish story as independent only when its lineage differs", () => {
    const summary = independenceSummary([
      source({ id: "en", independenceGroup: "jsonline-original" }),
      source({ id: "es", independenceGroup: "elconquistador-original", signalCategory: "official_record" }),
    ]);
    expect(summary.independentCategoryCount).toBe(2);
  });

  it("a translated community post is still not a confirming source", () => {
    const summary = independenceSummary([
      source({ id: "reddit-es", signalCategory: "community_discussion", independenceGroup: "reddit" }),
    ]);
    expect(summary.independentCategoryCount).toBe(0);
    expect(summary.nonConfirmingSourceIds).toEqual(["reddit-es"]);
  });
});
