import workflowTest from "@convex-dev/workflow/test";
import type { TestConvex } from "convex-test";
import { convexTest } from "convex-test";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { GenerateFn } from "../../convex/ai/provider";
import schema from "../../convex/schema";
import { runCandidateFormation } from "../../convex/slice";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { SLICE_SOURCES, sliceModelAnswers, type SliceSourceKey } from "../fixtures/slice";

export const modules = import.meta.glob("../../convex/**/*.ts");

export function setup() {
  const t = convexTest(schema, modules);
  // startScan/cancel call into the workflow component (convex/workflow.ts);
  // convex-test needs it registered or those calls throw "Component
  // \"workflow\" is not registered." This does not make the workflow run —
  // see the scan-workflow tests' own note on that.
  workflowTest.register(t);
  return t;
}

export const asUser = (t: ReturnType<typeof setup>, subject: string) =>
  t.withIdentity({ subject, tokenIdentifier: `clerk|${subject}`, name: subject, email: `${subject}@example.com` });

/**
 * Shared across every test that needs an owner to exist before startScan.
 * One definition — item 7 went wrong when three tasks each kept their own
 * drifting copy of this.
 */
export async function seedUser(t: TestConvex<typeof schema>, clerkUserId = "owner"): Promise<Id<"users">> {
  return t.run(async (ctx) =>
    ctx.db.insert("users", { clerkUserId, createdAt: Date.now(), updatedAt: Date.now() }),
  );
}

const EMPTY_SERP = {
  search_metadata: { id: "x", status: "Success" },
  organic_results: [],
};

/**
 * A `fetch` stand-in for SerpApi. Every query gets EMPTY_SERP unless one of
 * `byQueryNeedle`'s keys appears in the rendered query string, in which case
 * that entry's body is returned instead.
 */
export function fakeFetch(byQueryNeedle: Record<string, unknown> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const q = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";
    const body = Object.entries(byQueryNeedle).find(([needle]) => q.includes(needle))?.[1] ?? EMPTY_SERP;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const SLICE_NOW = 1_700_000_000_000;
const SLICE_DAY = 86_400_000;

/** Answers the fake model gives, chosen by which operation the prompt names. */
function sliceScriptedModel(answers: ReturnType<typeof sliceModelAnswers>): GenerateFn {
  return async ({ system }) => {
    const object =
      /Group the supplied signals/.test(system) ? answers.clusterSignals
      : /suggest how each piece of evidence/.test(system) ? answers.classifyEvidence
      : answers.generateBrief;
    return { object, usage: { inputTokens: 100, outputTokens: 50 } };
  };
}

/**
 * The same one-candidate packet `evidence-brief-vertical-slice.test.ts` seeds
 * (a scan, a search run, the four SLICE_SOURCES rows, and a scripted model),
 * shared here so tasks 6, 7 and 8 do not each grow their own copy.
 */
export async function seedSliceScan(t: ReturnType<typeof setup>) {
  const { scanId, ids } = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: SLICE_NOW, updatedAt: SLICE_NOW });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));

    const sourceIds = {} as Record<SliceSourceKey, Id<"sourceResults">>;
    for (const [i, source] of SLICE_SOURCES.entries()) {
      sourceIds[source.key] = await ctx.db.insert("sourceResults", {
        scanId, searchRunId, ownerId,
        canonicalKey: `k${i}`, canonicalUrl: source.canonicalUrl, originalUrl: source.canonicalUrl,
        engine: source.engine, sourceFamily: source.sourceFamily, sourceType: "unknown" as const,
        title: source.title, snippet: source.snippet,
        publisher: source.publisher ?? undefined,
        originalLanguage: source.originalLanguage,
        publishedAt: SLICE_NOW - SLICE_DAY, discoveredAt: SLICE_NOW,
        isAccessible: true, contentHash: `h${i}`,
      });
    }
    return { scanId, ids: sourceIds };
  });

  return {
    scanId,
    sourceIds: Object.values(ids),
    ids,
    model: sliceScriptedModel(sliceModelAnswers(ids)),
  };
}

/**
 * One formed candidate with a real judgment, built by running item 7's
 * formation half (`runCandidateFormation`) over `seedSliceScan`'s packet.
 * Tasks 6, 7 and 8 all need one of these to run a later stage against.
 */
export async function seedFormedCandidate(
  t: TestConvex<typeof schema>,
): Promise<{ scanId: Id<"scans">; candidateId: Id<"candidates">; model: GenerateFn }> {
  // runCandidateFormation routes through runAiOperation, which checks this env
  // var even though `model` below replaces the real provider call — set it here
  // so every caller of this fixture doesn't have to remember its own beforeEach.
  process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
  process.env.AI_FALLBACK_ENABLED = "false";
  const { scanId, sourceIds, model } = await seedSliceScan(t);
  const formed = await t.action(async (ctx) => runCandidateFormation(ctx, { scanId, sourceResultIds: sourceIds }, model));
  if (!formed.ok || formed.candidates.length === 0 || !formed.candidates[0].readyForVerdict) {
    throw new Error("seedFormedCandidate: formation did not produce a verdict-ready candidate");
  }
  return { scanId, candidateId: formed.candidates[0].candidateId, model };
}

/**
 * `count` formed candidates in ONE scan, each its own single-source cluster
 * with a distinct entity key so every one gets a distinct fingerprint.
 *
 * Skips the AI pipeline: nothing that consumes these candidates (the coverage
 * stage) reads a judgment, only a title, so `formFromCluster` alone is enough
 * and stays cheap even at the candidate counts the budget tests need.
 */
export async function seedManyFormedCandidates(
  t: TestConvex<typeof schema>, count: number,
): Promise<{ scanId: Id<"scans">; candidateIds: Id<"candidates">[] }> {
  const { scanId } = await seedSliceScan(t);
  const { ownerId, searchRunId } = await t.run(async (ctx) => {
    const scan = (await ctx.db.get(scanId))!;
    const run = (await ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId)).first())!;
    return { ownerId: scan.ownerId, searchRunId: run._id };
  });

  const candidateIds: Id<"candidates">[] = [];
  for (let i = 0; i < count; i++) {
    const sourceResultId = await t.run(async (ctx) => ctx.db.insert("sourceResults", {
      scanId, searchRunId, ownerId,
      canonicalKey: `many-${i}`, canonicalUrl: `https://jsonline.com/many-${i}`, originalUrl: `https://jsonline.com/many-${i}`,
      engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
      title: `Story ${i}`, snippet: `s${i}`, originalLanguage: "en", discoveredAt: Date.now(),
      isAccessible: true, contentHash: `h-many-${i}`,
    }));
    const formed = await t.mutation(internal.candidates.form.formFromCluster, {
      scanId,
      cluster: { sourceResultIds: [sourceResultId], similarityBasis: "distinct", entityKeys: [`entity-${i}`], suggestedExistingCandidateId: null },
      beat: "housing" as const,
      workingTitle: `Candidate ${i}`,
    });
    if ("rejected" in formed) continue;
    candidateIds.push(formed.candidateId);
  }
  return { scanId, candidateIds };
}
