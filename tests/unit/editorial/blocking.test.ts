import { describe, expect, it } from "vitest";
import distinctPacket from "../../fixtures/evaluation/cluster-distinct-01.json";
import syndicatedPacket from "../../fixtures/evaluation/cluster-syndicated-01.json";
import scan294 from "../../fixtures/clustering/scan-294.json";
import datedSignals from "../../fixtures/clustering/dated-signals.json";
import { type ClusterSignal, groupSignals, pairLinkKey } from "../../../convex/editorial/blocking";

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
    // It AUTO-LINKS at 10. It does not merely reach the ambiguous band, so no
    // adjudicator is what saves it.
    expect(outcome.pairs[0].verdict).toBe("linked");
  });

  /**
   * Both packets carry two signals, and two is inside `BLOCK_MAX_DF`, so on
   * their own they run the DEGENERATE branch of `cutoffsFor` — document
   * frequency is discarded and every shared key counts full. That is not the
   * code production runs. Dropping the same two signals into the real 294 puts
   * them past the cliff and scores them the way a real scan would.
   */
  it("cluster-distinct-01 still does not merge inside a real 296-source scan", () => {
    const outcome = groupSignals([...SCAN, ...fromPacket(distinctPacket)]);
    const [a, b] = distinctPacket.expected.mustNotMergeIntoOneCluster;
    expect(sameCluster(outcome, a, b)).toBe(false);
    // Stronger than "scored low": blocking never proposes the pair at all.
    expect(pairVerdict(outcome, a, b)).toBe("rejected");
  });

  it("cluster-syndicated-01 still auto-links inside a real 296-source scan, with no margin", () => {
    const outcome = groupSignals([...SCAN, ...fromPacket(syndicatedPacket)]);
    const [a, b] = syndicatedPacket.expected.mustMergeIntoOneCluster;
    expect(sameCluster(outcome, a, b)).toBe(true);
    // In a real corpus `milwaukee`, `news`, `neighborhood`, `park` and `sherman`
    // are common enough to be dropped or discounted; `depth, publishes,
    // retrospective, service, uprising` are what is left. The pair lands exactly
    // ON `LINK_THRESHOLD`, which is what makes this a drift canary rather than a
    // comfortable pass — raise the threshold at all and this packet fails.
    expect(outcome.pairs.find((p) => p.a === a && p.b === b)?.score).toBe(4);
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

  it("clusters the scan into a plausible band, not one story and not one per source", () => {
    // 1 cluster is the over-merge disaster. 294 is today's bug on `main`. The
    // band holds for the deterministic layer alone (279) and for the full
    // pipeline with Task 6's measured 39 adjudicated links (254).
    expect(outcome.clusters.length).toBeGreaterThan(1);
    expect(outcome.clusters.length).toBeLessThan(SCAN.length);
    expect(outcome.clusters.length).toBeGreaterThanOrEqual(150);
    expect(outcome.clusters.length).toBeLessThanOrEqual(290);
  });

  /**
   * The exact numbers every report in this task series quotes, pinned so that
   * "the deterministic numbers are unmoved" is something a test says rather than
   * something a person re-measures. Deliberately brittle: a threshold, weight or
   * cutoff change moves these, and the change should have to say so out loud —
   * update this test and the report together, exactly like the KNOWN MISS tests.
   */
  it("decides 15 links, 89 ambiguous and 1,102 rejections on the real 294", () => {
    expect(outcome.stats.blockedPairs).toBe(1206);
    expect(outcome.stats.linkedPairs).toBe(15);
    expect(outcome.stats.ambiguousPairs).toBe(89);
    expect(outcome.stats.rejectedPairs).toBe(1102);
    expect(outcome.clusters).toHaveLength(279);
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

/**
 * The date channel, which until this fixture existed no test could see at all:
 * every row of the real 294 has an empty `dates` array, so `WEIGHT_DATE` was
 * exercised by nothing while the thresholds were being calibrated against it.
 *
 * `dated-signals.json` is synthetic and deliberately so — it is not a captured
 * scan and must not be read as one. Twelve rows, which is past the `n > BLOCK_MAX_DF`
 * cliff, so these run on the production branch of `cutoffsFor` rather than the
 * degenerate one. Every row carries the news day `2026-08-25`, the way a model
 * asked for "any dates" over a single day's scan routinely will. Exactly two rows
 * also carry a specific event date.
 */
describe("the date channel is bounded by document frequency, like every other channel", () => {
  const DATED: ClusterSignal[] = datedSignals;

  function scoreOf(outcome: Outcome, a: string, b: string): number | undefined {
    return outcome.pairs.find((p) => p.a === a && p.b === b)?.score;
  }

  it("ignores a date every source in the scan carries", () => {
    // df 12 across 12 sources: this date describes the news day, not a story, and
    // is dropped exactly as an over-common token or entity key is. Before this
    // rule the same date auto-LINKED these two unrelated parking stories at 4.
    const outcome = groupSignals(DATED);
    expect(pairVerdict(outcome, "broadcast-c", "broadcast-d")).toBe("ambiguous");
    expect(scoreOf(outcome, "broadcast-c", "broadcast-d")).toBe(3);
    expect(outcome.pairs.every((p) => !p.sharedDates.includes("2026-08-25"))).toBe(true);
  });

  it("does not let a shared news day rescue a pair that shares one incidental word", () => {
    // Four filler pairs share a single ordinary token ("permit", "clears",
    // "spring", "year") and nothing else. With the news day counted they all rose
    // into the ambiguous band and the scan stopped rejecting anything at all.
    const outcome = groupSignals(DATED);
    expect(outcome.stats.rejectedPairs).toBe(4);
    expect(outcome.stats.ambiguousPairs).toBe(1);
  });

  it("still counts a date only two sources share, at full weight", () => {
    // df 2: this is a real event date, and the channel has to keep earning its
    // place. The rule bounds the channel; it does not switch it off.
    const withDates = groupSignals(DATED);
    const withoutDates = groupSignals(DATED.map((s) => ({ ...s, dates: [] })));
    expect(scoreOf(withDates, "rare-a", "rare-b")).toBe(6);
    expect(scoreOf(withoutDates, "rare-a", "rare-b")).toBe(5);
  });

  it("never lets a date propose a pair on its own", () => {
    // Dates are scored but not indexed for blocking. Two sources sharing only a
    // rare date, and no token or entity key, are never even compared.
    const outcome = groupSignals([
      { sourceResultId: "x", title: "Zoning vote delayed", snippet: "", entityKeys: [], claimSummary: "", dates: ["2026-09-19"] },
      { sourceResultId: "y", title: "Ferry schedule trimmed", snippet: "", entityKeys: [], claimSummary: "", dates: ["2026-09-19"] },
    ]);
    expect(outcome.stats.blockedPairs).toBe(0);
    expect(outcome.clusters).toHaveLength(2);
  });
});

describe("one piece of evidence is scored once", () => {
  it("does not count both an entity key and the words it is spelled with", () => {
    // `analyzeResults` extracts "East Side" from the same sentence that produces
    // the tokens "east" and "side". Counting all three scored one weak
    // geographic locator through two channels.
    const signals: ClusterSignal[] = [
      { sourceResultId: "a", title: "Trouble on the East Side", snippet: "", entityKeys: ["East Side"], claimSummary: "", dates: [] },
      { sourceResultId: "b", title: "East Side ride draws a crowd", snippet: "", entityKeys: ["East Side"], claimSummary: "", dates: [] },
    ];
    const outcome = groupSignals(signals);
    const pair = outcome.pairs[0];
    // The entity key keeps the point; "east" and "side" are struck from the
    // token channel, so they do not appear in the basis a journalist reads either.
    expect(pair.sharedEntityKeys).toEqual(["east side"]);
    expect(pair.sharedTokens).not.toContain("east");
    expect(pair.sharedTokens).not.toContain("side");
    expect(pair.score).toBe(2);
  });

  it("still counts a token that no shared entity key spells", () => {
    const signals: ClusterSignal[] = [
      { sourceResultId: "a", title: "East Side rezoning heads to a vote", snippet: "", entityKeys: ["East Side"], claimSummary: "", dates: [] },
      { sourceResultId: "b", title: "East Side rezoning vote is set", snippet: "", entityKeys: ["East Side"], claimSummary: "", dates: [] },
    ];
    const outcome = groupSignals(signals);
    expect(outcome.pairs[0].sharedTokens).toContain("rezoning");
    expect(outcome.pairs[0].sharedTokens).toContain("vote");
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

  /**
   * The bound on union-find, pinned so it is a known quantity rather than a
   * latent one. There is NO cluster-size cap, no coherence re-check, and no
   * requirement that a cluster's members be pairwise linked — this test states
   * exactly what that buys and what it costs.
   *
   * A roundup source (one article covering four neighbourhoods) links to two
   * sources that have nothing whatever in common with each other. `a` and `c`
   * share no key, are never blocked, and are never scored as a pair — yet they
   * land in one cluster through `b`.
   *
   * This is correct union-find and it is what makes syndicated coverage group at
   * all. It is kept rather than capped because a cap would have to drop one of
   * two links that both scored above `LINK_THRESHOLD`, with no principle saying
   * which — trading a visible over-merge for an invisible dropped link. The
   * guard is instead `stats.largestCluster`, bounded by the canary above, plus
   * `independence.ts` downstream, which splits a cluster by source category.
   *
   * The cost, named: a neighbourhood roundup can chain two unrelated stories into
   * one lead. If that shows up in real scans, the fix is to stop roundups being
   * strong blocking keys, not to truncate the cluster after the fact.
   */
  it("chains through a roundup source, joining two sources never scored as a pair", () => {
    const fillers: ClusterSignal[] = Array.from({ length: 12 }, (_, i) => ({
      sourceResultId: `filler-${i}`, title: "", snippet: "",
      entityKeys: [`Ward ${i}`], claimSummary: "", dates: [],
    }));
    const signals: ClusterSignal[] = [
      { sourceResultId: "a", title: "", snippet: "", entityKeys: ["Harambee", "Riverwest"], claimSummary: "", dates: [] },
      { sourceResultId: "b", title: "", snippet: "", entityKeys: ["Harambee", "Riverwest", "Bay View", "Lincoln Village"], claimSummary: "", dates: [] },
      { sourceResultId: "c", title: "", snippet: "", entityKeys: ["Bay View", "Lincoln Village"], claimSummary: "", dates: [] },
      ...fillers,
    ];
    const outcome = groupSignals(signals);

    // Past the n > BLOCK_MAX_DF cliff, so this is the production branch.
    expect(outcome.stats.signals).toBe(15);
    // The a-c pair is never proposed by blocking, so it is never scored at all.
    expect(pairVerdict(outcome, "a", "c")).toBe("rejected");
    expect(outcome.pairs.some((p) => [p.a, p.b].sort().join() === ["a", "c"].sort().join())).toBe(false);
    // And yet all three are one cluster.
    expect(sameCluster(outcome, "a", "c")).toBe(true);
    expect(outcome.stats.largestCluster).toBe(3);
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

/**
 * The line this whole project is about, drawn in one function.
 *
 * Task 6 adds an AI adjudicator over the ambiguous band. What it hands back is a
 * set of pair keys and nothing else — it does not group, and `groupSignals` will
 * only honour a key for a pair IT put in the band. A yes about a pair the code
 * linked is redundant; a yes about a pair the code rejected does nothing at all.
 */
describe("adjudicated links are a suggestion the rule consumes, not the rule", () => {
  // Twelve signals, so this runs the production branch of `cutoffsFor` and not
  // the degenerate one. "a" and "b" share exactly two full-weight tokens, which
  // scores 2 — the floor of the ambiguous band. "c" shares nothing with either.
  const fillers: ClusterSignal[] = Array.from({ length: 9 }, (_, i) => ({
    sourceResultId: `filler-${i}`, title: `Ward ${i} budget hearing`, snippet: "",
    entityKeys: [], claimSummary: "", dates: [],
  }));
  const signals: ClusterSignal[] = [
    { sourceResultId: "a", title: "Harambee rezoning delayed", snippet: "", entityKeys: [], claimSummary: "", dates: [] },
    { sourceResultId: "b", title: "Harambee rezoning proceeds", snippet: "", entityKeys: [], claimSummary: "", dates: [] },
    { sourceResultId: "c", title: "Ferry timetable trimmed", snippet: "", entityKeys: [], claimSummary: "", dates: [] },
    ...fillers,
  ];

  it("leaves an ambiguous pair unlinked when nothing adjudicates it", () => {
    const outcome = groupSignals(signals);
    expect(pairVerdict(outcome, "a", "b")).toBe("ambiguous");
    expect(sameCluster(outcome, "a", "b")).toBe(false);
  });

  it("puts an adjudicated pair through union-find and changes the grouping", () => {
    const outcome = groupSignals(signals, [pairLinkKey("a", "b")]);
    expect(sameCluster(outcome, "a", "b")).toBe(true);
    expect(outcome.clusters).toHaveLength(signals.length - 1);
    expect(outcome.stats.adjudicatedLinks).toBe(1);
    // The code's own verdict on the pair is unchanged and still legible.
    expect(pairVerdict(outcome, "a", "b")).toBe("ambiguous");
    expect(outcome.pairs.find((p) => p.a === "a" && p.b === "b")?.adjudicatedSameStory).toBe(true);
  });

  it("ignores an adjudicated yes about a pair the code rejected", () => {
    // "a" and "c" share nothing; blocking never proposes them, so they are never
    // scored. A model cannot merge what the score refused to consider.
    const outcome = groupSignals(signals, [pairLinkKey("a", "c")]);
    expect(sameCluster(outcome, "a", "c")).toBe(false);
    expect(outcome.stats.adjudicatedLinks).toBe(0);
    // The stronger case: a pair blocking DID compare and the score rejected. The
    // adjudicator is never shown it, and a yes about it must still do nothing.
    const rejected: ClusterSignal[] = [
      { sourceResultId: "a", title: "Harambee rezoning delayed", snippet: "", entityKeys: [], claimSummary: "", dates: [] },
      { sourceResultId: "b", title: "Harambee festival returns", snippet: "", entityKeys: [], claimSummary: "", dates: [] },
      ...fillers,
    ];
    const scored = groupSignals(rejected);
    expect(scored.stats.rejectedPairs).toBe(1);
    expect(pairVerdict(scored, "a", "b")).toBe("rejected");
    const withYes = groupSignals(rejected, [pairLinkKey("a", "b")]);
    expect(sameCluster(withYes, "a", "b")).toBe(false);
    expect(withYes.stats.adjudicatedLinks).toBe(0);
  });

  it("does not double-count an adjudicated yes about a pair the code already linked", () => {
    const linked: ClusterSignal[] = [
      { sourceResultId: "a", title: "", snippet: "", entityKeys: ["Sherman Park", "Vel Phillips Avenue"], claimSummary: "", dates: [] },
      { sourceResultId: "b", title: "", snippet: "", entityKeys: ["Sherman Park", "Vel Phillips Avenue"], claimSummary: "", dates: [] },
    ];
    const outcome = groupSignals(linked, [pairLinkKey("a", "b")]);
    expect(pairVerdict(outcome, "a", "b")).toBe("linked");
    expect(outcome.stats.adjudicatedLinks).toBe(0);
    expect(outcome.stats.linkedPairs).toBe(1);
    // The field means "the model settled one the code left open". A pair the code
    // decided is not one the code left open, whatever the model said about it.
    expect(outcome.pairs[0].adjudicatedSameStory).toBe(false);
  });
});

/**
 * KNOWN MISS #2 reaches the adjudicator once a real shared event date is
 * present. Task 5's fix report §1 measured this: the committed 294 fixture
 * carries no dates at all, so the shipped `KNOWN MISS` test above is unaffected
 * and stays exactly as it is — but production, where `analyzeResults` fills
 * `analysis.dates`, puts this pair in front of Task 6.
 */
describe("KNOWN MISS #2, with the date production would have", () => {
  it("lifts the two Homes MKE reports into the band the adjudicator sees", () => {
    const dated = SCAN.map((s) =>
      s.sourceResultId === ID.homesMke || s.sourceResultId === ID.southSideSpanish
        ? { ...s, dates: ["2026-10-01"] }
        : s);
    const outcome = groupSignals(dated);
    expect(pairVerdict(outcome, ID.homesMke, ID.southSideSpanish)).toBe("ambiguous");
    // And an adjudicated yes is what turns it into a merge — nothing else does.
    const adjudicated = groupSignals(dated, [pairLinkKey(ID.homesMke, ID.southSideSpanish)]);
    expect(sameCluster(adjudicated, ID.homesMke, ID.southSideSpanish)).toBe(true);
  });
});
