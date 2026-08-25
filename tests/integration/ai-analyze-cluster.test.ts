import { beforeEach, describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { runAnalyzeResults } from "../../convex/ai/analyzeResults";
import { runClusterSignals } from "../../convex/ai/clusterSignals";
import type { GenerateFn } from "../../convex/ai/provider";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { setup } from "./helpers";

/** A model that always hands back the same object, and records that it was asked. */
const fixedModel = (object: unknown): { fn: GenerateFn; calls: number } => {
  const state = { calls: 0 };
  const fn: GenerateFn = async () => {
    state.calls++;
    return { object, usage: { inputTokens: 100, outputTokens: 50 } };
  };
  return { get fn() { return fn; }, get calls() { return state.calls; } };
};

const spanishSource = {
  title: "La ciudad aprueba la rezonificación de Harambee",
  snippet: "El consejo votó a favor el martes.",
  originalLanguage: "es",
};

async function seedScanWithSources(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));

    const insert = (over: Record<string, unknown>) => ctx.db.insert("sourceResults", {
      scanId, searchRunId, ownerId,
      canonicalKey: `k${Math.random()}`, canonicalUrl: "https://example.com/a", originalUrl: "https://example.com/a",
      engine: "google_news" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
      title: "Board approves Harambee rezoning", snippet: "The board voted 9-4 on Tuesday.",
      originalLanguage: "en", discoveredAt: now, isAccessible: true, contentHash: "h",
      ...over,
    });

    const englishId = await insert({});
    const spanishId = await insert({ ...spanishSource, canonicalUrl: "https://example.com/es" });
    // Ingest already knew this one deterministically: an official domain is primary.
    const officialId = await insert({
      sourceFamily: "official" as const, sourceType: "primary" as const,
      title: "Common Council agenda item 250412", snippet: "Rezoning of the 3000 block.",
      canonicalUrl: "https://city.milwaukee.gov/agenda",
    });
    return { ownerId, scanId, englishId, spanishId, officialId };
  });
}

const analysisItem = (id: Id<"sourceResults">, over: Record<string, unknown> = {}) => ({
  sourceResultId: id,
  detectedLanguage: "en",
  originalTitle: null, translatedTitle: null, originalSnippet: null, translatedSnippet: null,
  sourceTypeSuggestion: "secondary",
  entities: { people: [], organizations: [], streets: [], neighborhoods: [], agencies: [] },
  dates: [], claims: [], potentialHumanSources: [],
  reason: "A local outlet reported the vote.",
  ...over,
});

const readRun = async (t: ReturnType<typeof setup>, runId: Id<"modelRuns">) =>
  (await t.run(async (ctx) => await ctx.db.get(runId))) as Doc<"modelRuns"> | null;

const latestRun = async (t: ReturnType<typeof setup>) =>
  (await t.run(async (ctx) => await ctx.db.query("modelRuns").collect())) as Doc<"modelRuns">[];

beforeEach(() => {
  process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
  process.env.AI_FALLBACK_ENABLED = "false";
});

describe("analyzeResults", () => {
  it("writes the translation BESIDE the original and never over it", async () => {
    const t = setup();
    const { scanId, spanishId } = await seedScanWithSources(t);

    const model = fixedModel({
      items: [analysisItem(spanishId, {
        detectedLanguage: "es",
        originalTitle: spanishSource.title,
        translatedTitle: "City approves Harambee rezoning",
        originalSnippet: spanishSource.snippet,
        translatedSnippet: "The council voted in favor on Tuesday.",
      })],
    });

    const outcome = await t.action(async (ctx) => await runAnalyzeResults(ctx, { scanId, sourceResultIds: [spanishId] }, model.fn));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.translated).toBe(1);

    const row = (await t.run(async (ctx) => await ctx.db.get(spanishId))) as Doc<"sourceResults">;
    expect(row.title).toBe(spanishSource.title);
    expect(row.snippet).toBe(spanishSource.snippet);
    expect(row.translatedTitle).toBe("City approves Harambee rezoning");
    expect(row.originalLanguage).toBe("es");
  });

  it("fills in an unknown source type but will not overwrite one the rules already set", async () => {
    const t = setup();
    const { scanId, englishId, officialId } = await seedScanWithSources(t);

    const model = fixedModel({
      items: [
        analysisItem(englishId, { sourceTypeSuggestion: "secondary" }),
        analysisItem(officialId, { sourceTypeSuggestion: "discussion" }),
      ],
    });

    const outcome = await t.action(async (ctx) =>
      await runAnalyzeResults(ctx, { scanId, sourceResultIds: [englishId, officialId] }, model.fn));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.typed).toBe(1);

    const rows = await t.run(async (ctx) => ({
      english: await ctx.db.get(englishId),
      official: await ctx.db.get(officialId),
    }));
    expect((rows.english as Doc<"sourceResults">).sourceType).toBe("secondary");
    expect((rows.official as Doc<"sourceResults">).sourceType).toBe("primary");
  });

  it("fails the WHOLE run and writes an invalid modelRun when one source ID was invented", async () => {
    const t = setup();
    const { scanId, englishId } = await seedScanWithSources(t);

    const model = fixedModel({
      items: [
        analysisItem(englishId),
        analysisItem("src_invented_by_the_model" as Id<"sourceResults">),
      ],
    });

    const outcome = await t.action(async (ctx) => await runAnalyzeResults(ctx, { scanId, sourceResultIds: [englishId] }, model.fn));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("invalid_output");
    expect(outcome.errors.join(" ")).toContain("src_invented_by_the_model");

    const runs = await latestRun(t);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("invalid");
    expect(runs[0].validationErrors?.join(" ")).toContain("src_invented_by_the_model");

    // Nothing from the good half of the answer was written either.
    const row = (await t.run(async (ctx) => await ctx.db.get(englishId))) as Doc<"sourceResults">;
    expect(row.translatedTitle).toBeUndefined();
  });

  it("rejects a quotation that is not character-for-character in the stored text", async () => {
    const t = setup();
    const { scanId, englishId } = await seedScanWithSources(t);
    const model = fixedModel({
      items: [analysisItem(englishId, {
        claims: [{ text: "The board voted.", exactExcerpt: "The board voted 9-4 on Wednesday." }],
      })],
    });

    const outcome = await t.action(async (ctx) => await runAnalyzeResults(ctx, { scanId, sourceResultIds: [englishId] }, model.fn));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors.join(" ")).toMatch(/word-for-word/);
  });

  it("accepts a quotation copied exactly from the stored snippet", async () => {
    const t = setup();
    const { scanId, englishId } = await seedScanWithSources(t);
    const model = fixedModel({
      items: [analysisItem(englishId, {
        claims: [{ text: "The board voted.", exactExcerpt: "The board voted 9-4 on Tuesday." }],
      })],
    });

    const outcome = await t.action(async (ctx) => await runAnalyzeResults(ctx, { scanId, sourceResultIds: [englishId] }, model.fn));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const run = await readRun(t, outcome.modelRunId);
    expect(run?.status).toBe("succeeded");
    expect(run?.inputTokens).toBe(100);
  });

  it("stores a shape the schema rejects as an invalid run, after exactly two tries", async () => {
    const t = setup();
    const { scanId, englishId } = await seedScanWithSources(t);
    const model = fixedModel({ items: [{ sourceResultId: englishId, detectedLanguage: "klingon" }] });

    const outcome = await t.action(async (ctx) => await runAnalyzeResults(ctx, { scanId, sourceResultIds: [englishId] }, model.fn));
    expect(outcome.ok).toBe(false);
    expect(model.calls).toBe(2);

    const runs = await latestRun(t);
    expect(runs[0].status).toBe("invalid");
  });

  it("keeps the entities, dates and claims it extracted instead of throwing them away", async () => {
    const t = setup();
    const { scanId, englishId } = await seedScanWithSources(t);

    const model = fixedModel({
      items: [analysisItem(englishId, {
        entities: {
          people: ["Cavalier Johnson"],
          organizations: ["Harambee Neighborhood Association", "Cavalier Johnson"],
          streets: ["North Avenue"],
          neighborhoods: ["Harambee"],
          agencies: ["Common Council"],
        },
        dates: ["2026-08-25"],
        claims: [
          { text: "The board voted 9-4 to rezone the 3000 block.", exactExcerpt: "The board voted 9-4 on Tuesday." },
          { text: "A second claim with no quotation.", exactExcerpt: null },
        ],
      })],
    });

    const outcome = await t.action(async (ctx) =>
      await runAnalyzeResults(ctx, { scanId, sourceResultIds: [englishId] }, model.fn));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const row = (await t.run(async (ctx) => await ctx.db.get(englishId))) as Doc<"sourceResults">;
    // Flattened across the five categories, in category order, deduplicated.
    expect(row.analysis?.entityKeys).toEqual([
      "Cavalier Johnson", "Harambee Neighborhood Association", "North Avenue", "Harambee", "Common Council",
    ]);
    expect(row.analysis?.claimSummary).toBe("The board voted 9-4 to rezone the 3000 block.");
    expect(row.analysis?.claims).toEqual([
      { text: "The board voted 9-4 to rezone the 3000 block.", exactExcerpt: "The board voted 9-4 on Tuesday." },
      { text: "A second claim with no quotation." },
    ]);
    expect(row.analysis?.dates).toEqual(["2026-08-25"]);
    // Traceable to the call that was paid for.
    expect(row.analysis?.modelRunId).toBe(outcome.modelRunId);
  });

  it("falls back to the model's reason when it extracted no claim at all", async () => {
    const t = setup();
    const { scanId, englishId } = await seedScanWithSources(t);
    const model = fixedModel({ items: [analysisItem(englishId, { reason: "A local outlet reported the vote." })] });

    const outcome = await t.action(async (ctx) =>
      await runAnalyzeResults(ctx, { scanId, sourceResultIds: [englishId] }, model.fn));
    expect(outcome.ok).toBe(true);

    const row = (await t.run(async (ctx) => await ctx.db.get(englishId))) as Doc<"sourceResults">;
    expect(row.analysis?.claimSummary).toBe("A local outlet reported the vote.");
    expect(row.analysis?.claims).toEqual([]);
  });

  it("writes analysis WITHOUT overwriting a source type the rules set or the original text", async () => {
    const t = setup();
    const { scanId, officialId } = await seedScanWithSources(t);

    const model = fixedModel({
      items: [analysisItem(officialId, {
        sourceTypeSuggestion: "discussion",
        originalTitle: "Common Council agenda item 250412",
        translatedTitle: "A translation that must not replace the headline",
        entities: { people: [], organizations: [], streets: [], neighborhoods: [], agencies: ["Common Council"] },
        claims: [{ text: "The council took up the rezoning.", exactExcerpt: null }],
      })],
    });

    const outcome = await t.action(async (ctx) =>
      await runAnalyzeResults(ctx, { scanId, sourceResultIds: [officialId] }, model.fn));
    expect(outcome.ok).toBe(true);

    const row = (await t.run(async (ctx) => await ctx.db.get(officialId))) as Doc<"sourceResults">;
    // Rule 1: ingest decided this one. The model does not get to change it.
    expect(row.sourceType).toBe("primary");
    // Rule 2: the translation sits beside the original, never over it.
    expect(row.title).toBe("Common Council agenda item 250412");
    expect(row.snippet).toBe("Rezoning of the 3000 block.");
    expect(row.translatedTitle).toBe("A translation that must not replace the headline");
    // ...and the analysis still landed.
    expect(row.analysis?.entityKeys).toEqual(["Common Council"]);
  });

  it("replaces the analysis on a second write rather than appending to it", async () => {
    const t = setup();
    const { scanId, englishId } = await seedScanWithSources(t);

    const model = fixedModel({
      items: [analysisItem(englishId, {
        entities: { people: [], organizations: ["First Org"], streets: [], neighborhoods: [], agencies: [] },
        claims: [{ text: "First claim.", exactExcerpt: null }],
      })],
    });
    const first = await t.action(async (ctx) =>
      await runAnalyzeResults(ctx, { scanId, sourceResultIds: [englishId] }, model.fn));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // A later analysis of the same row writes over the earlier one. It never
    // accumulates, so a re-run cannot leave two competing entity lists behind.
    await t.mutation(internal.ai.analyzeResults.persistAnalysis, {
      modelRunId: first.modelRunId,
      items: [{
        sourceResultId: englishId,
        translatedTitle: null, translatedSnippet: null, sourceTypeSuggestion: "unknown" as const,
        analysis: {
          entityKeys: ["Second Org"], claimSummary: "Second claim.", dates: [],
          claims: [{ text: "Second claim.", exactExcerpt: null }],
        },
      }],
    });

    const row = (await t.run(async (ctx) => await ctx.db.get(englishId))) as Doc<"sourceResults">;
    expect(row.analysis?.entityKeys).toEqual(["Second Org"]);
    expect(row.analysis?.claims).toEqual([{ text: "Second claim." }]);
    expect(row.analysis?.claimSummary).toBe("Second claim.");
  });

  it("refuses an identical re-run and leaves the stored analysis exactly as it was", async () => {
    const t = setup();
    const { scanId, englishId } = await seedScanWithSources(t);

    const item = analysisItem(englishId, {
      entities: { people: [], organizations: ["Only Org"], streets: [], neighborhoods: [], agencies: [] },
      claims: [{ text: "The only claim.", exactExcerpt: null }],
    });
    const model = fixedModel({ items: [item] });

    const first = await t.action(async (ctx) =>
      await runAnalyzeResults(ctx, { scanId, sourceResultIds: [englishId] }, model.fn));
    expect(first.ok).toBe(true);

    // The idempotency key is the same question, so the ledger refuses to pay twice.
    const second = await t.action(async (ctx) =>
      await runAnalyzeResults(ctx, { scanId, sourceResultIds: [englishId] }, model.fn));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("already_generated");

    const row = (await t.run(async (ctx) => await ctx.db.get(englishId))) as Doc<"sourceResults">;
    expect(row.analysis?.entityKeys).toEqual(["Only Org"]);
    expect(row.analysis?.claims).toEqual([{ text: "The only claim." }]);
  });

  it("leaves a row that was never analysed readable, with no analysis at all", async () => {
    const t = setup();
    const { scanId, englishId, spanishId } = await seedScanWithSources(t);

    const model = fixedModel({ items: [analysisItem(englishId)] });
    await t.action(async (ctx) => await runAnalyzeResults(ctx, { scanId, sourceResultIds: [englishId] }, model.fn));

    const untouched = (await t.run(async (ctx) => await ctx.db.get(spanishId))) as Doc<"sourceResults">;
    expect(untouched.analysis).toBeUndefined();
    expect(untouched.title).toBe(spanishSource.title);
  });
});

describe("clusterSignals", () => {
  const signals = (ids: Id<"sourceResults">[]) =>
    ids.map((id) => ({ sourceResultId: id, entityKeys: ["harambee"], claimSummary: "rezoning vote" }));

  it("returns proposed clusters and records a succeeded run", async () => {
    const t = setup();
    const { scanId, englishId, officialId } = await seedScanWithSources(t);
    const model = fixedModel({
      clusters: [{
        sourceResultIds: [englishId, officialId],
        similarityBasis: "Both describe the same Common Council agenda item.",
        entityKeys: ["harambee", "rezoning"],
        suggestedExistingCandidateId: null,
      }],
    });

    const outcome = await t.action(async (ctx) =>
      await runClusterSignals(ctx, { scanId, signals: signals([englishId, officialId]) }, model.fn));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.clusters).toHaveLength(1);
    expect((await readRun(t, outcome.modelRunId))?.status).toBe("succeeded");
  });

  it("rejects a cluster containing zero input results", async () => {
    const t = setup();
    const { scanId, englishId } = await seedScanWithSources(t);
    const model = fixedModel({
      clusters: [{ sourceResultIds: [], similarityBasis: "vibes", entityKeys: [], suggestedExistingCandidateId: null }],
    });

    const outcome = await t.action(async (ctx) =>
      await runClusterSignals(ctx, { scanId, signals: signals([englishId]) }, model.fn));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("invalid_output");
  });

  it("rejects a cluster citing a source that was not in the input", async () => {
    const t = setup();
    const { scanId, englishId } = await seedScanWithSources(t);
    const model = fixedModel({
      clusters: [{
        sourceResultIds: ["src_not_supplied"],
        similarityBasis: "b", entityKeys: [], suggestedExistingCandidateId: null,
      }],
    });

    const outcome = await t.action(async (ctx) =>
      await runClusterSignals(ctx, { scanId, signals: signals([englishId]) }, model.fn));
    expect(outcome.ok).toBe(false);
  });

  it("rejects a link to a candidate the model was never shown", async () => {
    const t = setup();
    const { scanId, englishId } = await seedScanWithSources(t);
    const model = fixedModel({
      clusters: [{
        sourceResultIds: [englishId],
        similarityBasis: "b", entityKeys: [], suggestedExistingCandidateId: "cand_invented",
      }],
    });

    const outcome = await t.action(async (ctx) =>
      await runClusterSignals(ctx, { scanId, signals: signals([englishId]) }, model.fn));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors.join(" ")).toContain("cand_invented");
    const runs = await latestRun(t);
    expect(runs[0].status).toBe("invalid");
  });
});
