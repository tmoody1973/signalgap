import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import scan294 from "../../fixtures/clustering/scan-294.json";
import adjudicated from "../../fixtures/clustering/adjudicated-links-294.json";
import { type ClusterSignal, groupSignals, pairLinkKey } from "../../../convex/editorial/blocking";

/**
 * The only test in this repo that can tell us whether clustering is RIGHT, as
 * opposed to consistent with itself.
 *
 * Everything else measured so far is precision by inspection: someone read the
 * merges and judged them. This reads `docs/evaluation/clustering-pair-labels.md`
 * — 107 pairs from the real 294-source scan, labeled same/different/unsure by
 * hand — and scores the code against it.
 *
 * WHAT THE NUMBERS MEAN, precisely, because the denominator is easy to overstate:
 *
 *  - **Precision** is over the pairs the code LINKS: of the merges it made among
 *    labeled pairs, how many were real.
 *  - **Recall is over the sheet, not over the scan.** The sheet holds the 89
 *    ambiguous pairs, the 15 auto-links and 3 seeded rejects — 107 of the
 *    43,071 possible pairs. So this measures the recall of SCORING over what
 *    blocking already proposed. It cannot measure blocking's own recall; a same-
 *    story pair that blocking never proposed and nobody seeded is invisible here.
 *    The two `KNOWN MISS` traps are in the sheet precisely so that part is not
 *    entirely dark.
 *  - **`unsure` is excluded from both**, never counted as a wrong answer. A pair
 *    an editor cannot call is not evidence about the code.
 *
 * While the sheet is unlabeled these tests SKIP with a message. A test that
 * fails because a human has not done homework is noise, and `npm run check` has
 * to stay green in the meantime.
 */

const SHEET_PATH = fileURLToPath(new URL("../../../docs/evaluation/clustering-pair-labels.md", import.meta.url));

type Label = "same" | "different" | "unsure";

/**
 * The sheet is hand-edited markdown, so this is a trust boundary: an answer that
 * is neither blank nor one of the three words is a typo that would otherwise be
 * silently dropped from the score. It throws instead.
 */
function parseLabelSheet(markdown: string): Map<string, Label> {
  const labels = new Map<string, Label>();
  for (const block of markdown.split(/^#### /m).slice(1)) {
    const id = block.slice(0, block.indexOf("\n")).trim();
    const key = /<!-- pair: (\S+) -->/.exec(block)?.[1];
    if (!key) continue;
    const answer = (/\*\*Answer:\*\*(.*)/.exec(block)?.[1] ?? "").replace(/[`*_]/g, "").trim().toLowerCase();
    if (answer.length === 0) continue;
    if (answer !== "same" && answer !== "different" && answer !== "unsure") {
      throw new Error(`${id}: answer "${answer}" is not one of same / different / unsure`);
    }
    labels.set(key, answer);
  }
  return labels;
}

const SCAN: ClusterSignal[] = scan294.map((r) => ({
  sourceResultId: r.sourceResultId,
  title: r.title,
  snippet: r.snippet,
  entityKeys: (r as { entityKeys?: string[] }).entityKeys ?? [],
  claimSummary: (r as { claimSummary?: string }).claimSummary ?? "",
  dates: [],
}));

const SHEET = readFileSync(SHEET_PATH, "utf8");
const PAIRS_IN_SHEET = new Set([...SHEET.matchAll(/<!-- pair: (\S+) -->/g)].map((m) => m[1]));
const LABELS = parseLabelSheet(SHEET);
const GRADED = [...LABELS].filter(([, label]) => label !== "unsure");

const UNLABELED = `docs/evaluation/clustering-pair-labels.md has no answers in it yet.`
  + ` Fill in the **Answer:** lines (same / different / unsure) and this test starts scoring`
  + ` clustering against them. Skipping rather than failing: unlabeled is not a regression.`;

/**
 * PLACEHOLDER FLOORS — deliberately not tuned, because nothing has been labeled.
 * Set them once the sheet comes back: high enough that the measured value has
 * little headroom, or the test cannot fail when a threshold drifts.
 */
const DETERMINISTIC_PRECISION_FLOOR = 0.85;
const DETERMINISTIC_RECALL_FLOOR = 0.1;
const PIPELINE_PRECISION_FLOOR = 0.85;
const PIPELINE_RECALL_FLOOR = 0.5;

function scoreAgainstLabels(linked: ReadonlySet<string>) {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  for (const [key, label] of GRADED) {
    const merged = linked.has(key);
    if (label === "same" && merged) truePositives++;
    else if (label === "different" && merged) falsePositives++;
    else if (label === "same") falseNegatives++;
  }
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision: truePositives + falsePositives === 0 ? 1 : truePositives / (truePositives + falsePositives),
    recall: truePositives + falseNegatives === 0 ? 1 : truePositives / (truePositives + falseNegatives),
  };
}

/** Failure messages carry the counts, so a red test says what moved. */
function withCounts(metric: string, scored: ReturnType<typeof scoreAgainstLabels>): string {
  return `${metric} over ${GRADED.length} labeled pairs:`
    + ` ${scored.truePositives} correct merges, ${scored.falsePositives} wrong merges,`
    + ` ${scored.falseNegatives} missed merges`;
}

const deterministic = groupSignals(SCAN);
const linkedByCode = new Set(
  deterministic.pairs.filter((p) => p.verdict === "linked").map((p) => pairLinkKey(p.a, p.b)),
);
/**
 * The full pipeline, scored offline. `adjudicated-links-294.json` is the real
 * output of the ONE paid adjudication call Task 6 made over these same 89 pairs,
 * captured so this test never needs a model. No unit test may reach one.
 */
const withAdjudication = groupSignals(SCAN, adjudicated.links.map((l) => l.pair));
const linkedByPipeline = new Set(
  withAdjudication.pairs
    .filter((p) => p.verdict === "linked" || p.adjudicatedSameStory)
    .map((p) => pairLinkKey(p.a, p.b)),
);

describe("the hand-labeled pair set", () => {
  it("covers every pair the deterministic layer decides on its own", () => {
    // The sheet and the fixture have to describe the same scan. If a threshold
    // moves, pairs appear that nobody labeled, and the labels below stop
    // measuring the code that is actually running. This one runs even while the
    // sheet is blank, so threshold drift is caught today rather than later.
    const missing = deterministic.pairs
      .map((p) => pairLinkKey(p.a, p.b))
      .filter((key) => !PAIRS_IN_SHEET.has(key));
    expect(
      missing.length,
      `${missing.length} scored pairs are not in docs/evaluation/clustering-pair-labels.md.`
      + ` A clustering threshold moved. Re-run \`npx tsx scripts/build-label-sheet.ts --force\``
      + ` and have the new pairs labeled — note that discards any answers already in the sheet.`,
    ).toBe(0);
  });

  it("holds the deterministic layer's precision and recall floors", (ctx) => {
    if (GRADED.length === 0) return ctx.skip(UNLABELED);
    const scored = scoreAgainstLabels(linkedByCode);
    expect(scored.precision, withCounts("deterministic precision", scored)).toBeGreaterThanOrEqual(DETERMINISTIC_PRECISION_FLOOR);
    expect(scored.recall, withCounts("deterministic recall", scored)).toBeGreaterThanOrEqual(DETERMINISTIC_RECALL_FLOOR);
  });

  it("holds the whole pipeline's floors, code plus the captured adjudication", (ctx) => {
    if (GRADED.length === 0) return ctx.skip(UNLABELED);
    const scored = scoreAgainstLabels(linkedByPipeline);
    expect(scored.precision, withCounts("pipeline precision", scored)).toBeGreaterThanOrEqual(PIPELINE_PRECISION_FLOOR);
    expect(scored.recall, withCounts("pipeline recall", scored)).toBeGreaterThanOrEqual(PIPELINE_RECALL_FLOOR);
  });

  it("never merges a pair the editor called different", (ctx) => {
    if (GRADED.length === 0) return ctx.skip(UNLABELED);
    // The strict half of precision, named separately because this is the failure
    // that reaches the feed: two unrelated stories presented as one lead.
    const wrong = GRADED
      .filter(([key, label]) => label === "different" && linkedByPipeline.has(key))
      .map(([key]) => key);
    expect(wrong, `merged pairs labeled "different": ${wrong.join(", ")}`).toEqual([]);
  });
});
