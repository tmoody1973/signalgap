import workflowTest from "@convex-dev/workflow/test";
import type { TestConvex } from "convex-test";
import { convexTest } from "convex-test";
import type { Id } from "../../convex/_generated/dataModel";
import type { GenerateFn } from "../../convex/ai/provider";
import schema from "../../convex/schema";
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
