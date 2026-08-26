import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { ClusterSignal, ScoredPair } from "../editorial/blocking";
import { pairLinkKey } from "../editorial/blocking";
import {
  MAX_ADJUDICATED_PAIRS,
  SCHEMA_VERSION,
  type AdjudicatePairsInput,
  type AdjudicatePairsOutput,
  adjudicatePairsOutput,
} from "./contracts";
import type { GenerateFn } from "./provider";
import { runAiOperation } from "./runOperation";

/**
 * The ONE place a model is asked anything about which sources are the same story
 * — and it is asked the smallest question there is.
 *
 * `convex/editorial/blocking.ts` scores every blocked pair and decides two of the
 * three rows on its own: at or above `LINK_THRESHOLD` it links, below
 * `REJECT_THRESHOLD` it rejects, and no model is involved in either. On the real
 * 294-source scan that is 15 links and 1,102 rejections. What is left is the
 * band between the thresholds — 89 pairs — where the score genuinely does not
 * know. This operation asks about those, and only those.
 *
 * WHAT THE MODEL CANNOT DO HERE, by construction rather than by instruction:
 *
 *  - It cannot group. The output schema has one boolean per pair and no field
 *    in which two sources, let alone a cluster, can be named together. Union-find
 *    in `blocking.ts` does the grouping.
 *  - It cannot name a source. The payload carries no `sourceResultId` at all —
 *    each pair is identified by an opaque `pairId` this file mints and keeps in
 *    a local map. There is nothing to invent a citation with.
 *  - It cannot answer about a pair it was not shown, or skip one it was.
 *    `verdictsCoverExactly` runs inside `runAiOperation`, BEFORE the model run is
 *    marked succeeded, so a short answer is an invalid run and not a quiet
 *    success. Task 3 shipped that bug once (task-1-report.md §B3: a schema-valid
 *    answer covering 22 of 294 sources, and nothing noticed).
 *  - It cannot overturn a deterministic verdict. `groupSignals` honours an
 *    adjudicated link only for a pair its own score put in the ambiguous band.
 *
 * FAILURE IS SURVIVABLE. Every failure path returns zero links and a named
 * reason. The scan then groups from the auto-links alone — slightly coarser
 * clusters, which is exactly what shipped in Task 5 — instead of dying.
 */

export type AdjudicationRequest = {
  input: AdjudicatePairsInput;
  /** pairId -> the `pairLinkKey` it stands for. The model never sees the right-hand side. */
  byPairId: Map<string, string>;
  /** Ambiguous pairs the ceiling would not fit. Counted, never silently dropped. */
  overCeiling: number;
};

export type AdjudicationOutcome = {
  /** `pairLinkKey` values the model called same-story. Empty on every failure path. */
  links: string[];
  sent: number;
  overCeiling: number;
  sameStoryCount: number;
  modelRunId: Id<"modelRuns"> | null;
  /** null when the call succeeded or there was nothing to ask. */
  failure: string | null;
};

const MAX_SNIPPET = 240;

/**
 * Turns the ambiguous band into one payload, and remembers which opaque id meant
 * which pair.
 *
 * Ordering is by score, highest first, so if the ceiling bites, what is cut is
 * the end of the band least likely to be a real merge.
 */
export function buildAdjudicationRequest(
  signals: readonly ClusterSignal[],
  pairs: readonly ScoredPair[],
): AdjudicationRequest {
  const byId = new Map(signals.map((s) => [s.sourceResultId, s]));
  const band = pairs
    .filter((p) => p.verdict === "ambiguous")
    .slice()
    .sort((x, y) => y.score - x.score);

  const selected = band.slice(0, MAX_ADJUDICATED_PAIRS);
  const byPairId = new Map<string, string>();
  const side = (id: string) => {
    const s = byId.get(id);
    return {
      title: s?.title ?? "",
      snippet: (s?.snippet ?? "").slice(0, MAX_SNIPPET),
      claimSummary: s?.claimSummary ?? "",
    };
  };

  const payload = selected.map((p, i) => {
    const pairId = `p${i}`;
    byPairId.set(pairId, pairLinkKey(p.a, p.b));
    return {
      pairId,
      sharedTerms: [...p.sharedEntityKeys, ...p.sharedTokens, ...p.sharedDates],
      first: side(p.a),
      second: side(p.b),
    };
  });

  return { input: { pairs: payload }, byPairId, overCeiling: band.length - selected.length };
}

/**
 * The completeness rule: exactly one verdict per pair sent, and no verdict about
 * anything else. Returns the errors, so `runAiOperation` can invalidate the run
 * with them rather than persisting an answer that covers less than it was asked.
 */
export function verdictsCoverExactly(value: AdjudicatePairsOutput, sentPairIds: readonly string[]): string[] {
  const expected = new Set(sentPairIds);
  const seen = new Set<string>();
  for (const verdict of value.verdicts) {
    if (!expected.has(verdict.pairId)) {
      return [`verdicts: answers about "${verdict.pairId}", which was not one of the ${expected.size} pairs sent`];
    }
    if (seen.has(verdict.pairId)) return [`verdicts: answers about "${verdict.pairId}" more than once`];
    seen.add(verdict.pairId);
  }
  if (seen.size !== expected.size) {
    const missing = sentPairIds.filter((id) => !seen.has(id)).map((id) => `"${id}"`);
    return [`verdicts: ${expected.size} pairs were sent and ${seen.size} answered; missing ${missing.join(", ")}`];
  }
  return [];
}

export async function runAdjudicatePairs(
  ctx: ActionCtx,
  { scanId, signals, pairs }: { scanId: Id<"scans">; signals: readonly ClusterSignal[]; pairs: readonly ScoredPair[] },
  generate?: GenerateFn,
): Promise<AdjudicationOutcome> {
  const request = buildAdjudicationRequest(signals, pairs);
  const sent = request.input.pairs.length;
  // An empty band is not a failure and must not cost a call.
  if (sent === 0) {
    return { links: [], sent: 0, overCeiling: request.overCeiling, sameStoryCount: 0, modelRunId: null, failure: null };
  }

  const sentPairIds = [...request.byPairId.keys()];
  const result = await runAiOperation<AdjudicatePairsOutput>(ctx, {
    scanId,
    operation: "adjudicatePairs",
    input: request.input,
    outputSchema: adjudicatePairsOutput,
    schemaVersion: SCHEMA_VERSION,
    // No source id is shown to the model and none may come back, so the known-id
    // list is empty on purpose: any `sourceResultId` in the output is an invention
    // and `validateAgainstSources` rejects it.
    validation: { knownSourceIds: [], excerptsBySourceId: {} },
    verify: (value) => verdictsCoverExactly(value, sentPairIds),
    generate,
  });

  if (!result.ok) {
    return {
      links: [], sent, overCeiling: request.overCeiling, sameStoryCount: 0,
      modelRunId: result.modelRunId ?? null,
      failure: `${result.reason}${result.errors.length > 0 ? `: ${result.errors[0]}` : ""}`,
    };
  }

  const links = result.value.verdicts
    .filter((v) => v.sameStory)
    .map((v) => request.byPairId.get(v.pairId))
    .filter((key): key is string => key !== undefined);

  return {
    links, sent, overCeiling: request.overCeiling, sameStoryCount: links.length,
    modelRunId: result.modelRunId, failure: null,
  };
}
