import { beforeEach, describe, expect, it } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { GenerateFn } from "../../convex/ai/provider";
import { runSliceForScan } from "../../convex/slice";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { SLICE_SOURCES, sliceModelAnswers, type SliceSourceKey } from "../fixtures/slice";
import { setup } from "./helpers";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

/** Answers the fake model gives, chosen by which operation the prompt names. */
function scriptedModel(answers: ReturnType<typeof sliceModelAnswers>): GenerateFn {
  return async ({ system }) => {
    const object =
      /Group the supplied signals/.test(system) ? answers.clusterSignals
      : /suggest how each piece of evidence/.test(system) ? answers.classifyEvidence
      : answers.generateBrief;
    return { object, usage: { inputTokens: 100, outputTokens: 50 } };
  };
}

async function seedScan(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: NOW, updatedAt: NOW });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));

    const ids = {} as Record<SliceSourceKey, Id<"sourceResults">>;
    for (const [i, source] of SLICE_SOURCES.entries()) {
      ids[source.key] = await ctx.db.insert("sourceResults", {
        scanId, searchRunId, ownerId,
        canonicalKey: `k${i}`, canonicalUrl: source.canonicalUrl, originalUrl: source.canonicalUrl,
        engine: source.engine, sourceFamily: source.sourceFamily, sourceType: "unknown" as const,
        title: source.title, snippet: source.snippet,
        publisher: source.publisher ?? undefined,
        originalLanguage: source.originalLanguage,
        publishedAt: NOW - DAY, discoveredAt: NOW,
        isAccessible: true, contentHash: `h${i}`,
      });
    }
    return { ownerId, scanId, ids };
  });
}

beforeEach(() => {
  process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
  process.env.AI_FALLBACK_ENABLED = "false";
});

describe("evidence-to-brief vertical slice", () => {
  it("takes one captured packet from source results to a written brief", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    const model = scriptedModel(sliceModelAnswers(ids));

    const outcome = await t.action(async (ctx) =>
      await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, model));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.candidates).toHaveLength(1);

    const [candidate] = outcome.candidates;
    expect(candidate.failures).toEqual([]);
    expect(candidate.evidenceVersion).toBe(1);
    expect(candidate.briefId).not.toBeNull();
  });

  it("lets the RULES set locality, overruling the model's weaker guess", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    await t.action(async (ctx) =>
      await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, scriptedModel(sliceModelAnswers(ids))));

    const candidate = (await t.run(async (ctx) => (await ctx.db.query("candidates").collect())[0])) as Doc<"candidates">;
    // The model suggested "area_city_consequence"; an official Milwaukee domain
    // is among the sources, so the deterministic rule wins.
    expect(candidate.judgment?.localityBand?.value).toBe("direct_city");
    expect(candidate.judgment?.localityBand?.basis).toBe("deterministic");
  });

  it("counts two independent confirming categories and keeps Reddit out of them", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    await t.action(async (ctx) =>
      await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, scriptedModel(sliceModelAnswers(ids))));

    const candidate = (await t.run(async (ctx) => (await ctx.db.query("candidates").collect())[0])) as Doc<"candidates">;
    expect(candidate.independentCategoryCount).toBe(2);
  });

  it("writes no confirmed fact, because the model was never allowed to claim one", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    await t.action(async (ctx) =>
      await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, scriptedModel(sliceModelAnswers(ids))));

    const evidence = (await t.run(async (ctx) => await ctx.db.query("evidenceItems").collect())) as Doc<"evidenceItems">[];
    expect(evidence.length).toBe(4);
    expect(evidence.every((e) => e.kind !== "confirmed_fact")).toBe(true);
  });

  it("puts OUR cautious sentence in the empty confirmed-facts section of the brief", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    await t.action(async (ctx) =>
      await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, scriptedModel(sliceModelAnswers(ids))));

    const brief = (await t.run(async (ctx) => (await ctx.db.query("briefVersions").collect())[0])) as Doc<"briefVersions">;
    expect(brief.confirmedFacts).toHaveLength(1);
    expect(brief.confirmedFacts[0].sourceResultIds).toEqual([]);
    expect(brief.confirmedFacts[0].text).toMatch(/independently confirmed/i);
  });

  it("keeps the Spanish original beside its translation all the way into the snapshot", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    await t.action(async (ctx) =>
      await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, scriptedModel(sliceModelAnswers(ids))));

    const evidence = (await t.run(async (ctx) => await ctx.db.query("evidenceItems").collect())) as Doc<"evidenceItems">[];
    const bilingual = evidence.find((e) => e.translatedText !== undefined);
    expect(bilingual?.originalLanguageText).toMatch(/residentes/);
    expect(bilingual?.translatedText).toMatch(/residents/i);

    const spanishSource = (await t.run(async (ctx) => await ctx.db.get(ids.spanish))) as Doc<"sourceResults">;
    expect(spanishSource.title).toBe(SLICE_SOURCES[2].title);
  });

  it("running it twice does not duplicate the candidate, the brief, or the spend", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    let calls = 0;
    const answers = sliceModelAnswers(ids);
    const counting: GenerateFn = async (args) => { calls++; return await scriptedModel(answers)(args); };

    await t.action(async (ctx) => await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, counting));
    const firstCalls = calls;
    await t.action(async (ctx) => await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, counting));

    const { candidates, briefs } = await t.run(async (ctx) => ({
      candidates: await ctx.db.query("candidates").collect(),
      briefs: await ctx.db.query("briefVersions").collect(),
    }));
    expect(candidates).toHaveLength(1);
    expect(briefs).toHaveLength(1);
    // The second pass asks the model strictly fewer times than the first.
    expect(calls - firstCalls).toBeLessThan(firstCalls);
  });

  it("reports a failure per candidate instead of throwing when the model output is unusable", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    const answers = sliceModelAnswers(ids);
    const broken: GenerateFn = async (args) => {
      if (/suggest how each piece of evidence/.test(args.system)) {
        return { object: { ...answers.classifyEvidence, items: [] }, usage: {} };
      }
      return await scriptedModel(answers)(args);
    };

    const outcome = await t.action(async (ctx) =>
      await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, broken));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.candidates[0].failures.join(" ")).toMatch(/classify/);
  });
});
