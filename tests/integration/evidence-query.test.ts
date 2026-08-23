import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { GenerateFn } from "../../convex/ai/provider";
import { runSliceForScan } from "../../convex/slice";
import { scanDoc } from "../fixtures/factories";
import { SLICE_SOURCES, sliceModelAnswers, type SliceSourceKey } from "../fixtures/slice";
import { asUser, setup } from "./helpers";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const QUERY_TEXT = 'site:city.milwaukee.gov "Harambee rezoning"';

function scriptedModel(answers: ReturnType<typeof sliceModelAnswers>): GenerateFn {
  return async ({ system }) => ({
    object:
      /Group the supplied signals/.test(system) ? answers.clusterSignals
      : /suggest how each piece of evidence/.test(system) ? answers.classifyEvidence
      : answers.generateBrief,
    usage: { inputTokens: 10, outputTokens: 5 },
  });
}

async function seedAndRun(t: ReturnType<typeof setup>) {
  const seeded = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("users", { clerkUserId: "stranger", createdAt: NOW, updatedAt: NOW });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", {
      scanId, ownerId, idempotencyKey: "idem", templateId: "official-housing-01",
      queryCatalogVersion: "t", purpose: "discovery" as const, engine: "google" as const,
      query: QUERY_TEXT, parameters: { gl: "us", hl: "en" }, language: "en" as const,
      status: "succeeded" as const, attemptCount: 1, resultCount: 4, durationMs: 800,
      reservedAt: NOW, completedAt: NOW,
    });

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
        // The Reddit source is deliberately unreachable: an unreachable citation
        // must stay visible and marked, never disappear.
        isAccessible: source.key !== "reddit", contentHash: `h${i}`,
      });
    }
    return { ownerId, scanId, ids };
  });

  await t.action(async (ctx) =>
    await runSliceForScan(ctx, { scanId: seeded.scanId, sourceResultIds: Object.values(seeded.ids), now: NOW },
      scriptedModel(sliceModelAnswers(seeded.ids))));

  const candidateId = await t.run(async (ctx) => (await ctx.db.query("candidates").collect())[0]._id);
  return { ...seeded, candidateId };
}

beforeEach(() => {
  process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
  process.env.AI_FALLBACK_ENABLED = "false";
});

describe("evidence.forCandidate", () => {
  it("returns null to a signed-in user who does not own the candidate", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    expect(await asUser(t, "stranger").query(api.evidence.forCandidate, { candidateId })).toBeNull();
  });

  it("gives the owner the whole view in one call", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });

    expect(view).not.toBeNull();
    if (!view) return;
    expect(view.evidence.length).toBeGreaterThan(0);
    expect(view.brief).not.toBeNull();
    expect(view.queryLog.length).toBeGreaterThan(0);
  });

  it("shows why this surfaced with at least two distinct categories", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    if (!view) throw new Error("no view");

    const categories = new Set(view.whySurfaced.map((w) => w.category));
    expect(categories.size).toBeGreaterThanOrEqual(2);
  });

  it("traces every evidence source back to the exact executed query", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    if (!view) throw new Error("no view");

    const sources = view.evidence.flatMap((e) => e.sources);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) expect(source.foundByQuery).toBe(QUERY_TEXT);
  });

  it("keeps an unreachable source visible rather than dropping it", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    if (!view) throw new Error("no view");

    const sources = view.evidence.flatMap((e) => e.sources);
    expect(sources.some((s) => !s.isAccessible)).toBe(true);
    expect(view.evidence.some((e) => e.requiresReverification)).toBe(true);
  });

  it("says plainly whether a coverage gap is allowed", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    if (!view) throw new Error("no view");

    // The coverage pass has not run in this fixture, so a gap can never be claimed.
    expect(view.coverage.passStatus).toBe("pending");
    expect(view.coverage.gapAllowed).toBe(false);
  });

  it("carries the judgment basis so an editor can ask who decided", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    if (!view) throw new Error("no view");

    expect(view.judgment?.localityBand?.basis).toBe("deterministic");
    expect(view.judgment?.localityBand?.reason).toContain("city.milwaukee.gov");
  });

  it("keeps the Spanish original beside its translation in the view", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    if (!view) throw new Error("no view");

    const bilingual = view.evidence.find((e) => e.translatedText !== null);
    expect(bilingual?.originalLanguageText).toMatch(/residentes/);
    expect(bilingual?.translatedText).toMatch(/residents/i);
  });

  it("gives the brief with our cautious sentence for the empty confirmed section", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    if (!view) throw new Error("no view");

    expect(view.brief?.sections.confirmedFacts[0].sourceResultIds).toEqual([]);
    expect(view.brief?.sections.confirmedFacts[0].text).toMatch(/independently confirmed/i);
  });

  it("returns all five score components, adding up, once the lead qualifies", async () => {
    const t = setup();
    const { scanId, candidateId, ids } = await seedAndRun(t);

    // Two things keep the fixture lead excluded, both correctly: the coverage
    // pass never ran, and its Reddit source is unreachable (an unreachable
    // corroborating source excludes). Fix both, then re-evaluate — this is the
    // eligible path the score breakdown renders.
    await t.run(async (ctx) => {
      await ctx.db.patch(candidateId, { coveragePassStatus: "complete" });
      await ctx.db.patch(ids.reddit, { isAccessible: true });
    });
    await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });

    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    if (!view) throw new Error("no view");

    expect(view.candidate.status).toBe("eligible");
    expect(view.score?.components).toHaveLength(5);
    expect(view.score?.components.map((c) => c.key).sort()).toEqual([
      "coverageScarcity", "crossSource", "freshness", "milwaukeeEvidence", "relevance",
    ]);
    expect(view.score?.components.reduce((sum, c) => sum + c.points, 0)).toBe(view.score?.total);
    for (const component of view.score?.components ?? []) {
      expect(component.label.length).toBeGreaterThan(0);
      expect(component.reason.length).toBeGreaterThan(0);
    }
  });

  it("never returns a raw storage id", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    expect(JSON.stringify(view)).not.toMatch(/rawStorageId/);
  });

  it("shows no score for a lead that did not qualify", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    if (!view) throw new Error("no view");

    // This fixture's coverage pass never completed, so the lead is excluded and
    // carries no score at all — not a zero.
    expect(view.candidate.status).toBe("excluded");
    expect(view.score).toBeNull();
    expect(view.candidate.scoreTotal).toBeNull();
  });
});
