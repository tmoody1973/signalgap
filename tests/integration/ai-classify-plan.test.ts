import { beforeEach, describe, expect, it } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { runClassifyEvidence } from "../../convex/ai/classifyEvidence";
import { runPlanFollowUp } from "../../convex/ai/planFollowUp";
import type { GenerateFn } from "../../convex/ai/provider";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { setup } from "./helpers";

const fixedModel = (object: unknown): GenerateFn => async () =>
  ({ object, usage: { inputTokens: 10, outputTokens: 5 } });

const classifyItem = (ids: string[], over: Record<string, unknown> = {}) => ({
  sourceResultIds: ids,
  kind: "unverified_signal",
  claimText: "The council is scheduled to vote on the rezoning.",
  exactExcerpt: null, originalLanguageText: null, translatedText: null,
  sourceTypeSuggestion: "secondary",
  independenceGroupSuggestion: null,
  relationship: "supports",
  milwaukeeConnection: "The parcel is in the Harambee neighborhood.",
  accessibilityConcern: false, repeatsPressRelease: false,
  reason: "One outlet reported the agenda item.",
  ...over,
});

const classifyOutput = (ids: string[], over: Record<string, unknown> = {}) => ({
  beatSuggestion: "housing",
  localityBandSuggestion: "area_city_consequence",
  relevanceBandSuggestion: "policy_service_change",
  flags: { isSpeculative: false, isRoutineCrime: false, isDuplicateOfCandidate: false, hasMaterialConflict: true },
  items: [classifyItem(ids)],
  ...over,
});

async function seed(t: ReturnType<typeof setup>, opts: { officialSource: boolean }) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));
    const candidateId = await ctx.db.insert("candidates", {
      ownerId, fingerprint: "fp", currentTitle: "Harambee rezoning", reportingQuestion: "?",
      beat: "housing" as const, status: "processing" as const, primaryLabel: "Worth a look" as const,
      disposition: "new" as const, latestEvidenceVersion: 1,
      independentCategoryCount: 1, coverageOriginalCount: 0, coveragePassStatus: "pending" as const,
      firstSeenAt: now, lastSeenAt: now, updatedAt: now,
    });
    const sourceResultId = await ctx.db.insert("sourceResults", {
      scanId, searchRunId, ownerId,
      canonicalKey: "k1",
      canonicalUrl: opts.officialSource ? "https://city.milwaukee.gov/agenda/250412" : "https://jsonline.com/story",
      originalUrl: "https://jsonline.com/story",
      engine: "google" as const,
      sourceFamily: opts.officialSource ? ("official" as const) : ("news" as const),
      sourceType: "unknown" as const,
      title: "Council to vote on Harambee rezoning", snippet: "The item is on Tuesday's agenda.",
      originalLanguage: "en", discoveredAt: now, isAccessible: true, contentHash: "h",
    });
    return { ownerId, scanId, candidateId, sourceResultId };
  });
}

const allRuns = async (t: ReturnType<typeof setup>) =>
  (await t.run(async (ctx) => await ctx.db.query("modelRuns").collect())) as Doc<"modelRuns">[];

beforeEach(() => {
  process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
  process.env.AI_FALLBACK_ENABLED = "false";
});

describe("classifyEvidence — decision 004 provenance", () => {
  it("uses the deterministic locality and ignores the model when an official domain is cited", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId } = await seed(t, { officialSource: true });

    const outcome = await t.action(async (ctx) => await runClassifyEvidence(
      ctx, { scanId, candidateId, sourceResultIds: [sourceResultId] },
      fixedModel(classifyOutput([sourceResultId])),
    ));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.judgment.localityBand?.value).toBe("direct_city");
    expect(outcome.judgment.localityBand?.basis).toBe("deterministic");
    expect(outcome.judgment.localityBand?.reason).toContain("city.milwaukee.gov");
  });

  it("falls back to the model's locality suggestion when no rule applies, and says so", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId } = await seed(t, { officialSource: false });

    const outcome = await t.action(async (ctx) => await runClassifyEvidence(
      ctx, { scanId, candidateId, sourceResultIds: [sourceResultId] },
      fixedModel(classifyOutput([sourceResultId])),
    ));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.judgment.localityBand?.value).toBe("area_city_consequence");
    expect(outcome.judgment.localityBand?.basis).toBe("ai_suggested");
  });

  it("lets an editor override both, and marks the basis editor", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId } = await seed(t, { officialSource: true });

    const outcome = await t.action(async (ctx) => await runClassifyEvidence(
      ctx,
      { scanId, candidateId, sourceResultIds: [sourceResultId], editorOverrides: { localityBand: "none", beat: "culture" } },
      fixedModel(classifyOutput([sourceResultId])),
    ));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.judgment.localityBand).toEqual({ value: "none", basis: "editor", reason: "set by an editor" });
    expect(outcome.judgment.beat?.value).toBe("culture");
    expect(outcome.judgment.beat?.basis).toBe("editor");
  });

  it("gives every one of the seven judgment fields a basis", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId } = await seed(t, { officialSource: false });

    const outcome = await t.action(async (ctx) => await runClassifyEvidence(
      ctx, { scanId, candidateId, sourceResultIds: [sourceResultId] },
      fixedModel(classifyOutput([sourceResultId])),
    ));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const fields = Object.values(outcome.judgment);
    expect(fields).toHaveLength(7);
    for (const field of fields) {
      expect(field).not.toBeNull();
      expect(["deterministic", "ai_suggested", "editor"]).toContain(field?.basis);
    }
    expect(outcome.judgment.hasMaterialConflict).toEqual({
      value: true, basis: "ai_suggested", reason: "flagged by the model",
    });
  });

  it("rejects an output that tries to mark something a confirmed fact", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId } = await seed(t, { officialSource: false });

    const outcome = await t.action(async (ctx) => await runClassifyEvidence(
      ctx, { scanId, candidateId, sourceResultIds: [sourceResultId] },
      fixedModel(classifyOutput([sourceResultId], { items: [classifyItem([sourceResultId], { kind: "confirmed_fact" })] })),
    ));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("invalid_output");
    expect((await allRuns(t))[0].status).toBe("invalid");
  });

  it("rejects an output citing a source that was not supplied", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId } = await seed(t, { officialSource: false });

    const outcome = await t.action(async (ctx) => await runClassifyEvidence(
      ctx, { scanId, candidateId, sourceResultIds: [sourceResultId] },
      fixedModel(classifyOutput([sourceResultId], { items: [classifyItem(["src_made_up"])] })),
    ));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors.join(" ")).toContain("src_made_up");
  });
});

describe("planFollowUp — intents only, never an executable search", () => {
  const intent = (over: Record<string, unknown> = {}) => ({
    templateId: "official-record-entity-01",
    purpose: "corroboration",
    desiredSourceFamily: "official",
    entityTerms: ["Harambee rezoning"],
    reason: "no official record has been checked yet",
    ...over,
  });

  const planArgs = (scanId: Id<"scans">, candidateId: Id<"candidates">) => ({
    scanId, candidateId, beat: "housing" as const,
    gaps: ["no official record"], priorTemplateIds: ["news-housing-en-01"],
  });

  it("maps a valid intent onto an approved template and produces a runnable spec", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { officialSource: false });

    const outcome = await t.action(async (ctx) =>
      await runPlanFollowUp(ctx, planArgs(scanId, candidateId), fixedModel({ intents: [intent()] })));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.accepted).toBe(1);
    const first = outcome.intents[0];
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    expect(first.spec.location).toBe("Milwaukee, Wisconsin, United States");
    expect(first.spec.query).toContain("Harambee rezoning");
    expect(first.spec.query).not.toContain("http");
  });

  it("rejects the WHOLE output when an intent smuggles a URL in its reason", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { officialSource: false });

    const outcome = await t.action(async (ctx) => await runPlanFollowUp(
      ctx, planArgs(scanId, candidateId),
      fixedModel({ intents: [intent({ reason: "fetch https://serpapi.com/search?q=milwaukee" })] }),
    ));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("invalid_output");
    expect((await allRuns(t))[0].status).toBe("invalid");
  });

  it("rejects an output carrying a raw api_key anywhere", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { officialSource: false });

    const outcome = await t.action(async (ctx) => await runPlanFollowUp(
      ctx, planArgs(scanId, candidateId),
      fixedModel({ intents: [intent({ entityTerms: ["Harambee", "site:city.milwaukee.gov"] })] }),
    ));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors.join(" ")).toMatch(/URL or search operator/);
  });

  it("logs a rejection with its reason instead of executing it", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { officialSource: false });

    const outcome = await t.action(async (ctx) => await runPlanFollowUp(
      ctx, planArgs(scanId, candidateId),
      fixedModel({ intents: [intent({ templateId: "template-the-model-invented" })] }),
    ));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.accepted).toBe(0);
    expect(outcome.rejected).toBe(1);
    const first = outcome.intents[0];
    expect(first.accepted).toBe(false);
    if (first.accepted) return;
    expect(first.rejection).toBe("unknown_template");
  });

  it("rejects an intent whose purpose the template does not serve", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { officialSource: false });

    const outcome = await t.action(async (ctx) => await runPlanFollowUp(
      ctx, planArgs(scanId, candidateId),
      fixedModel({ intents: [intent({ templateId: "trend-milwaukee-01", purpose: "coverage" })] }),
    ));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const first = outcome.intents[0];
    if (first.accepted) throw new Error("should have been rejected");
    expect(first.rejection).toBe("purpose_mismatch");
  });

  it("stops granting a purpose once its remaining budget runs out inside one batch", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { officialSource: false });

    const outcome = await t.action(async (ctx) => await runPlanFollowUp(
      ctx,
      { ...planArgs(scanId, candidateId), remainingBudget: { discovery: 0, coverage: 0, corroboration: 1, enrichment: 0 } },
      fixedModel({ intents: [intent({ entityTerms: ["one"] }), intent({ entityTerms: ["two"] })] }),
    ));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.accepted).toBe(1);
    expect(outcome.rejected).toBe(1);
    const second = outcome.intents[1];
    if (second.accepted) throw new Error("second should have been refused");
    expect(second.rejection).toBe("budget_exhausted");
  });
});
