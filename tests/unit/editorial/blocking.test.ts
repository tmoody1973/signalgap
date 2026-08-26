import { describe, expect, it } from "vitest";
import distinctPacket from "../../fixtures/evaluation/cluster-distinct-01.json";
import syndicatedPacket from "../../fixtures/evaluation/cluster-syndicated-01.json";
import scan294 from "../../fixtures/clustering/scan-294.json";
import { type ClusterSignal, groupSignals } from "../../../convex/editorial/blocking";

/**
 * The deterministic half of clustering, tested against the two objective
 * evaluation packets (which until now could only be checked with a paid model
 * call) and against the real 294-source Milwaukee scan.
 *
 * `tests/fixtures/clustering/scan-294.json` is the real captured scan
 * `k1781cvj03wmdd2bgz4ks2rzbh8d4ze8` — titles, snippets, and the entity keys and
 * claim summaries `analyzeResults` produced for the 40 sources that were
 * analysed during Task 1's measurement. Committed because `.eval-runs/` is
 * git-ignored and these canaries have to run in CI.
 */

/** The evaluation packets carry a claim summary and nothing else. */
function fromPacket(packet: typeof distinctPacket | typeof syndicatedPacket): ClusterSignal[] {
  return packet.input.signals.map((s) => ({
    sourceResultId: s.sourceResultId,
    title: "",
    snippet: "",
    entityKeys: s.entityKeys,
    claimSummary: s.claimSummary,
    dates: [],
  }));
}

const SCAN: ClusterSignal[] = scan294.map((r) => ({
  sourceResultId: r.sourceResultId,
  title: r.title,
  snippet: r.snippet,
  entityKeys: (r as { entityKeys?: string[] }).entityKeys ?? [],
  claimSummary: (r as { claimSummary?: string }).claimSummary ?? "",
  dates: [],
}));

const ID = {
  asianFoodFestival: "k97cp4yf7x290h4s1sjktg10sx8d51qx", // "Ka Vang's Asian street food festival expands to Milwaukee"
  freshwaterFestival: "k97e3ffyry70mjy7vsmshnhmr58d5g9s", // "Freshwater Food & Wine Festival, Sept 19 - 20"
  homelessFamily: "k975xbgmjvgzwe1t0xv6b5rzdd8d453c", // "Homeless family help : r/milwaukee"
  mayorBikeRide: "k97eyxc1qgmr61gzan2ds5ekn98d40wr", // "Mayor's \"Back to School\" Bike Ride"
  backToSchoolFestival: "k97cnx1qgvcmzr4ndya0wz1x5s8d46m0", // "4th Annual Back to School Festival"
  homesMke: "k972wcvf9tvy8hrbjkxmkxfh6s8d42a4", // "Homes MKE - City of Milwaukee"
  southSideSpanish: "k97a905v5nv0m7smvwjkvphnws8d47z8", // "Lo más importante del lado sur de Milwaukee"
};

type Outcome = ReturnType<typeof groupSignals>;

function clusterIndexOf(outcome: Outcome, id: string): number {
  return outcome.clusters.findIndex((c) => c.sourceResultIds.includes(id));
}

function sameCluster(outcome: Outcome, a: string, b: string): boolean {
  const i = clusterIndexOf(outcome, a);
  return i >= 0 && i === clusterIndexOf(outcome, b);
}

function verdictFor(outcome: Outcome, a: string, b: string): "linked" | "ambiguous" | "rejected" {
  if (outcome.pairs.some((p) => p.verdict === "linked" && p.a === a && p.b === b)) return "linked";
  if (outcome.pairs.some((p) => p.verdict === "ambiguous" && p.a === a && p.b === b)) return "ambiguous";
  return "rejected";
}

/** Pair keys are stored with the two ids sorted, so tests do not have to guess the order. */
function pairVerdict(outcome: Outcome, x: string, y: string) {
  const [a, b] = [x, y].sort();
  return verdictFor(outcome, a, b);
}

describe("the two objective evaluation packets, as free unit tests", () => {
  it("cluster-distinct-01: a Sherman Park retrospective and a Public Works meeting do not merge", () => {
    const outcome = groupSignals(fromPacket(distinctPacket));
    const [a, b] = distinctPacket.expected.mustNotMergeIntoOneCluster;
    expect(sameCluster(outcome, a, b)).toBe(false);
    expect(outcome.clusters).toHaveLength(2);
  });

  it("cluster-syndicated-01: the same story under two publishers merges into one cluster", () => {
    const outcome = groupSignals(fromPacket(syndicatedPacket));
    const [a, b] = syndicatedPacket.expected.mustMergeIntoOneCluster;
    expect(sameCluster(outcome, a, b)).toBe(true);
    expect(outcome.clusters).toHaveLength(1);
  });
});

describe("the traps the real 294 handed us", () => {
  const outcome = groupSignals(SCAN);

  it("must NOT merge: Asian Street Food Festival and Freshwater Food & Wine Festival", () => {
    expect(sameCluster(outcome, ID.asianFoodFestival, ID.freshwaterFestival)).toBe(false);
  });

  it("must NOT merge: a homeless-family sighting and the mayor's bike ride", () => {
    expect(sameCluster(outcome, ID.homelessFamily, ID.mayorBikeRide)).toBe(false);
  });

  /**
   * KNOWN MISS, measured not assumed. The two sources share no token rare enough
   * to index ("back" has df 6, "bike" 4, "school" 13 across the 294), so the pair
   * is never even blocked. The model merged them on knowledge the text does not
   * carry — that the mayor's ride happens AT that festival. No lexical method
   * reaches it; a third blocking channel over embeddings might, and that is
   * named as future work in research-clustering.md §3.
   *
   * This assertion is deliberately pinned to the miss so it cannot be forgotten.
   * When a later change finds this pair, this test goes red — update it and the
   * task-5 report together.
   */
  it("KNOWN MISS: the mayor's bike ride and the festival at that same event are never compared", () => {
    expect(pairVerdict(outcome, ID.mayorBikeRide, ID.backToSchoolFestival)).toBe("rejected");
    expect(sameCluster(outcome, ID.mayorBikeRide, ID.backToSchoolFestival)).toBe(false);
  });

  /**
   * KNOWN MISS, and a closer one. The Spanish South Side report and the English
   * Homes MKE page DO get blocked — they share the rare token "sell" (df 2) —
   * but score 1, one point under `REJECT_THRESHOLD`. This is the cross-lingual
   * recall loss the research predicted. Note the fixture carries no
   * `translatedTitle`/`translatedSnippet`, which production would have; whether
   * the translation closes the gap is untested.
   */
  it("KNOWN MISS: the two Homes MKE reports score one point under the floor", () => {
    expect(pairVerdict(outcome, ID.homesMke, ID.southSideSpanish)).toBe("rejected");
  });
});

describe("whole-scan canaries on the real 294", () => {
  const outcome = groupSignals(SCAN);

  it("clusters the scan into more than one story and fewer than one per source", () => {
    // 1 cluster is the over-merge disaster. 294 is today's bug on `main`.
    expect(outcome.clusters.length).toBeGreaterThan(1);
    expect(outcome.clusters.length).toBeLessThan(SCAN.length);
  });

  it("keeps the largest cluster under the transitivity ceiling", () => {
    // Union-find can chain two loose links into one wrong cluster. This is the
    // guard, not cleverness.
    expect(outcome.stats.largestCluster).toBeLessThanOrEqual(8);
  });

  it("blocks away the overwhelming majority of the 43,071 possible pairs", () => {
    expect(outcome.stats.possiblePairs).toBe((294 * 293) / 2);
    expect(outcome.stats.blockedPairs).toBeLessThan(outcome.stats.possiblePairs * 0.05);
  });
});

describe("cross-lingual blocking", () => {
  const base: ClusterSignal[] = [
    {
      sourceResultId: "en",
      title: "Neighbors question Harambee rezoning timeline",
      snippet: "Residents say they learned of the proposal a week before the vote.",
      entityKeys: [],
      claimSummary: "",
      dates: [],
    },
    {
      sourceResultId: "es",
      title: "Vecinos cuestionan la rezonificación del barrio",
      snippet: "Los residentes dicen que se enteraron una semana antes de la votación.",
      entityKeys: [],
      claimSummary: "",
      dates: [],
    },
  ];

  it("does not link a Spanish and an English report that share no token", () => {
    expect(sameCluster(groupSignals(base), "en", "es")).toBe(false);
  });

  it("links them once the translation analyzeResults already stores is supplied", () => {
    const translated = base.map((s) => s.sourceResultId === "es"
      ? {
        ...s,
        translatedTitle: "Neighbors question Harambee rezoning timeline",
        translatedSnippet: "Residents say they learned of the proposal a week before the vote.",
      }
      : s);
    expect(sameCluster(groupSignals(translated), "en", "es")).toBe(true);
  });
});

describe("entity keys are normalised before they are compared", () => {
  it("treats \"Common Council\" and \"common council\" as the same key", () => {
    const signals: ClusterSignal[] = [
      { sourceResultId: "a", title: "", snippet: "", entityKeys: ["Common Council"], claimSummary: "", dates: [] },
      { sourceResultId: "b", title: "", snippet: "", entityKeys: ["common  council"], claimSummary: "", dates: [] },
    ];
    const outcome = groupSignals(signals);
    expect(outcome.stats.blockedPairs).toBe(1);
  });
});

describe("the fallback-identity tell", () => {
  it("counts the clusters that carry no entity key at all", () => {
    const signals: ClusterSignal[] = [
      { sourceResultId: "a", title: "Zoning vote delayed", snippet: "", entityKeys: [], claimSummary: "", dates: [] },
      { sourceResultId: "b", title: "Bus route cut", snippet: "", entityKeys: [], claimSummary: "", dates: [] },
      { sourceResultId: "c", title: "Park reopens", snippet: "", entityKeys: ["Kosciuszko Park"], claimSummary: "", dates: [] },
    ];
    const outcome = groupSignals(signals);
    expect(outcome.clusters).toHaveLength(3);
    // Two of the three would silently take `clusterIdentityKeys`' source-id
    // fallback, which costs cross-scan continuity. That has to be visible.
    expect(outcome.stats.clustersWithoutEntityKeys).toBe(2);
  });

  it("carries the union of its members' entity keys onto the cluster", () => {
    const signals: ClusterSignal[] = [
      { sourceResultId: "a", title: "Harambee rezoning heads to a council vote", snippet: "", entityKeys: ["Harambee"], claimSummary: "", dates: [] },
      { sourceResultId: "b", title: "Council vote set on Harambee rezoning", snippet: "", entityKeys: ["Common Council"], claimSummary: "", dates: [] },
    ];
    const outcome = groupSignals(signals);
    expect(outcome.clusters).toHaveLength(1);
    expect([...outcome.clusters[0].entityKeys].sort()).toEqual(["Common Council", "Harambee"]);
    expect(outcome.stats.clustersWithoutEntityKeys).toBe(0);
  });
});

describe("grouping", () => {
  it("chains a transitive link: a-b and b-c put all three in one cluster", () => {
    const signals: ClusterSignal[] = [
      { sourceResultId: "a", title: "", snippet: "", entityKeys: ["Sherman Park", "Vel Phillips Avenue"], claimSummary: "", dates: [] },
      { sourceResultId: "b", title: "", snippet: "", entityKeys: ["Sherman Park", "Vel Phillips Avenue", "Harambee"], claimSummary: "", dates: [] },
      { sourceResultId: "c", title: "", snippet: "", entityKeys: ["Harambee", "Vel Phillips Avenue"], claimSummary: "", dates: [] },
    ];
    const outcome = groupSignals(signals);
    expect(outcome.clusters).toHaveLength(1);
    expect(outcome.clusters[0].sourceResultIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("returns one singleton cluster per signal when nothing is shared", () => {
    const signals: ClusterSignal[] = [
      { sourceResultId: "a", title: "Zoning vote delayed", snippet: "", entityKeys: [], claimSummary: "", dates: [] },
      { sourceResultId: "b", title: "Bus route cut", snippet: "", entityKeys: [], claimSummary: "", dates: [] },
    ];
    const outcome = groupSignals(signals);
    expect(outcome.clusters).toHaveLength(2);
    expect(outcome.stats.linkedPairs).toBe(0);
  });

  it("preserves every input signal — a source may never be dropped", () => {
    const outcome = groupSignals(SCAN);
    const placed = new Set(outcome.clusters.flatMap((c) => c.sourceResultIds));
    expect(placed.size).toBe(SCAN.length);
  });
});
