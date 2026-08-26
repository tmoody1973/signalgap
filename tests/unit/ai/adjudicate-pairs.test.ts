import { describe, expect, it } from "vitest";
import {
  MAX_ADJUDICATED_PAIRS,
  adjudicatePairsOutput,
} from "../../../convex/ai/contracts";
import {
  buildAdjudicationRequest,
  verdictsCoverExactly,
} from "../../../convex/ai/adjudicatePairs";
import { type ClusterSignal, type ScoredPair, pairLinkKey } from "../../../convex/editorial/blocking";

/**
 * The ambiguous-band adjudicator, tested without a model.
 *
 * The value of this operation is entirely in what it is NOT allowed to say: it
 * answers one yes/no about one pair the code chose, it cannot name a pair it was
 * not shown, and it cannot skip one.
 */

const signal = (id: string, title: string): ClusterSignal => ({
  sourceResultId: id, title, snippet: `${title} snippet`, entityKeys: [], claimSummary: `${title} claim`, dates: [],
});

const pair = (a: string, b: string, score: number): ScoredPair => {
  const [x, y] = [a, b].sort();
  return { a: x, b: y, score, verdict: "ambiguous", sharedTokens: ["shared"], sharedEntityKeys: [], sharedDates: [], adjudicatedSameStory: false };
};

describe("what the model is asked, and what it may answer", () => {
  it("sends only the ambiguous pairs — never one code already linked or rejected", () => {
    const signals = [signal("a", "A"), signal("b", "B"), signal("c", "C")];
    const pairs: ScoredPair[] = [
      { ...pair("a", "b", 5), verdict: "linked" },
      pair("b", "c", 3),
    ];
    const request = buildAdjudicationRequest(signals, pairs);
    expect(request.input.pairs).toHaveLength(1);
    expect(request.byPairId.get(request.input.pairs[0].pairId)).toBe(pairLinkKey("b", "c"));
  });

  it("hands the model an opaque pairId and no source id at all", () => {
    const ids = ["k97cd08vxvgazcax0nxst0mzen8d4ahz", "k970k2cnqy9gms61jbn2w3ttz98d5fwj"];
    const titles = ["Zoning vote delayed", "Council sets zoning vote"];
    const request = buildAdjudicationRequest(ids.map((id, i) => signal(id, titles[i])), [pair(ids[0], ids[1], 3)]);
    const json = JSON.stringify(request.input);
    // The only handle the model is given is a token code minted. It cannot cite a
    // source, cannot compose a pair it was not shown, and cannot name a cluster.
    for (const id of ids) expect(json).not.toContain(id);
    expect(request.input.pairs[0].pairId).toMatch(/^p\d+$/);
  });

  it("cannot express a grouping: a cluster-shaped answer does not parse", () => {
    const grouping = { verdicts: [{ pairId: "p0", sameStory: true, reason: "same", sourceResultIds: ["a", "b", "c"] }] };
    const parsed = adjudicatePairsOutput.safeParse(grouping);
    // Zod strips unknown keys rather than rejecting, so the assertion that matters
    // is that the parsed value carries no way to name more than one pair.
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.verdicts[0]).toEqual({ pairId: "p0", sameStory: true, reason: "same" });
  });
});

describe("the completeness check Task 3 learned the hard way", () => {
  const sent = ["p0", "p1", "p2"];

  it("rejects a verdict for a pair that was not sent", () => {
    const errors = verdictsCoverExactly(
      { verdicts: [
        { pairId: "p0", sameStory: true, reason: "r" },
        { pairId: "p1", sameStory: false, reason: "r" },
        { pairId: "p2", sameStory: false, reason: "r" },
        { pairId: "p9", sameStory: true, reason: "r" },
      ] },
      sent,
    );
    expect(errors).toEqual(["verdicts: answers about \"p9\", which was not one of the 3 pairs sent"]);
  });

  it("catches a missing verdict instead of silently accepting a short answer", () => {
    const errors = verdictsCoverExactly(
      { verdicts: [{ pairId: "p0", sameStory: true, reason: "r" }] },
      sent,
    );
    expect(errors).toEqual(["verdicts: 3 pairs were sent and 1 answered; missing \"p1\", \"p2\""]);
  });

  it("catches the same pair answered twice", () => {
    const errors = verdictsCoverExactly(
      { verdicts: [
        { pairId: "p0", sameStory: true, reason: "r" },
        { pairId: "p0", sameStory: false, reason: "r" },
        { pairId: "p1", sameStory: false, reason: "r" },
        { pairId: "p2", sameStory: false, reason: "r" },
      ] },
      sent,
    );
    expect(errors).toEqual(["verdicts: answers about \"p0\" more than once"]);
  });

  it("passes a complete answer", () => {
    expect(verdictsCoverExactly(
      { verdicts: sent.map((pairId) => ({ pairId, sameStory: false, reason: "r" })) },
      sent,
    )).toEqual([]);
  });
});

describe("the ceiling", () => {
  const signals = Array.from({ length: 400 }, (_, i) => signal(`s${i}`, `Story ${i}`));
  const many: ScoredPair[] = Array.from({ length: MAX_ADJUDICATED_PAIRS + 30 }, (_, i) =>
    pair(`s${i}`, `s${i + 1}`, 2 + (i % 20) / 10));

  it("never sends more pairs than the ceiling", () => {
    const request = buildAdjudicationRequest(signals, many);
    expect(request.input.pairs).toHaveLength(MAX_ADJUDICATED_PAIRS);
  });

  it("reports the pairs it could not send rather than dropping them silently", () => {
    const request = buildAdjudicationRequest(signals, many);
    expect(request.overCeiling).toBe(30);
  });

  it("sends the highest-scoring pairs first, so what is cut is what was least likely to merge", () => {
    const request = buildAdjudicationRequest(signals, many);
    const sentKeys = new Set(request.byPairId.values());
    const cut = many.filter((p) => !sentKeys.has(pairLinkKey(p.a, p.b)));
    const lowestSent = Math.min(...many.filter((p) => sentKeys.has(pairLinkKey(p.a, p.b))).map((p) => p.score));
    expect(Math.max(...cut.map((p) => p.score))).toBeLessThanOrEqual(lowestSent);
  });
});
