import { normalizeEntityKey } from "../candidates/fingerprint";

/**
 * Which sources in a scan are the same story — decided by code, not by a model.
 *
 * The 294-source scan of 2026-08-25 handed all 294 signals to one model call.
 * Measured: 238 s against a 120 s timeout, and 294 singleton clusters because
 * `slice.ts` was sending empty signals. Batching that call is forbidden — a
 * cluster can span any two of the 294, so a batch boundary silently prevents a
 * merge, which is the one thing the product exists to do.
 *
 * This is the canopy pattern (McCallum, Nigam & Ungar 2000; see
 * `docs/research/2026-08-25-evidence-pipeline/research-clustering.md` §1 and §3).
 * It removes the need for the big call instead of working around it:
 *
 *   1. BLOCK  — an inverted index over rare tokens and entity keys turns
 *               43,071 possible pairs into a few hundred worth looking at.
 *   2. SCORE  — a weighted count of what two sources actually share.
 *   3. GROUP  — union-find over the pairs that scored high enough.
 *
 * WHAT IS DECIDED HERE AND WHAT IS NOT. Everything in this file is deterministic
 * and testable: the blocking keys, the score, and both thresholds. A pair at or
 * above `LINK_THRESHOLD` is the same story; below `REJECT_THRESHOLD` it is not;
 * neither verdict is a model's to make or to override. Pairs BETWEEN the two
 * thresholds are the only thing a model will ever be asked about (Task 6), and
 * even then it answers one bounded yes/no per pair — it cannot merge what the
 * score rejected, cannot split what the score accepted, and never sees the whole
 * partition. Until Task 6 lands, an ambiguous pair is simply left unlinked and
 * counted in `stats.ambiguousPairs`.
 *
 * Known and accepted cost, from the record-linkage literature: blocking trades
 * recall for precision. Two reports on the same zoning vote that share no
 * distinctive word are never compared. Against `main`, which merges nothing at
 * all, this is not a loss.
 */

export type ClusterSignal = {
  sourceResultId: string;
  title: string;
  snippet: string;
  /** `analyzeResults` writes these beside the original; they are blocked on too. */
  translatedTitle?: string | null;
  translatedSnippet?: string | null;
  /** `sourceResults.analysis.entityKeys`, as the model wrote them. */
  entityKeys: string[];
  claimSummary: string;
  dates: string[];
};

export type PairVerdict = "linked" | "ambiguous";

export type ScoredPair = {
  a: string;
  b: string;
  score: number;
  verdict: PairVerdict;
  sharedTokens: string[];
  sharedEntityKeys: string[];
  sharedDates: string[];
};

export type SignalCluster = {
  sourceResultIds: string[];
  similarityBasis: string;
  entityKeys: string[];
  /**
   * Always null. Cross-scan continuity used to be proposed by the model here and
   * was read by nothing (`formFromCluster` destructures it away), so the
   * deterministic layer does not invent one either. It belongs with the
   * cross-scan lookup, not with within-scan grouping.
   */
  suggestedExistingCandidateId: null;
};

export type GroupingStats = {
  signals: number;
  possiblePairs: number;
  /** Pairs that survived blocking and were actually scored. */
  blockedPairs: number;
  linkedPairs: number;
  ambiguousPairs: number;
  rejectedPairs: number;
  largestCluster: number;
  /**
   * The tell. A cluster with no entity key falls back to its own source ids for
   * identity (`clusterIdentityKeys`), which is scan-local — it can never match a
   * prior scan's candidate. If this equals the cluster count, cross-scan
   * continuity is off product-wide and nothing else in the pipeline would say so.
   */
  clustersWithoutEntityKeys: number;
};

export type GroupingOutcome = {
  clusters: SignalCluster[];
  /** Every pair that survived blocking and did not score below the floor. */
  pairs: ScoredPair[];
  stats: GroupingStats;
};

// --- the constants that decide things -----------------------------------------
//
// OWNER: the editorial layer — these live here, next to `independence.ts` and
// `eligibility.ts`, because they decide which sources corroborate each other,
// which drives `independentCategoryCount`, which drives eligibility. Changing
// either threshold changes which leads qualify, so both are pinned by
// `tests/unit/editorial/blocking.test.ts` against the real 294-source scan.

/**
 * The canopy has two distance metrics, and these are the two.
 *
 * `df` is document frequency — how many sources in THIS scan contain a key.
 *
 * `BLOCK_MAX_DF` is the loose, fast metric: a key is worth indexing at all only
 * if it appears in at least 2 and at most 8 sources. Below 2 it can never be
 * shared; above 8 it is describing the city, not a story.
 *
 * `FULL_WEIGHT_MAX_DF` is the tight metric: a key shared by 3 or fewer sources
 * counts full, and one shared by 4 to 8 counts at `DISTANT_WEIGHT_FACTOR`.
 *
 * CHOSEN by sweeping both over the real 294-source scan and READING every pair
 * each setting linked — not by picking a number that looked nice:
 *
 *   block | full | pairs blocked | auto-linked | ambiguous | largest cluster
 *       3 |    3 |           421 |          11 |        49 |               2
 *       6 |    6 |           950 |          33 |       137 |               5
 *       8 |    8 |         1,206 |          50 |       181 |               6
 *   **8** |  **3** |     **1,206** |      **15** |     **89** |           **2**
 *
 * A single hard cutoff of 3 has a flaw that is easy to miss and disqualifying: a
 * story covered by FOUR or more outlets pushes its own distinctive words to
 * df >= 4, where the cutoff throws them away, so the outlets can never be linked
 * to each other. The measured cost was real — a road-rage shooting, the Pope Leo
 * Village housing story, the Koss museum opening and the Sherman Park
 * retrospective all failed to link at cutoff 3 and do link here.
 *
 * Widening the single cutoff to 6 or 8 instead fixes that and buys three merges
 * that are plainly wrong: two unrelated r/milwaukee dining threads on
 * "dining, dinner, named, restaurants", a third chained onto them by
 * transitivity, and a Denver hit-and-run joined to a Dodge County motorcycle
 * crash on "driver, hit, injured, seriously". Half-weighting the 4-to-8 band
 * keeps all three under `LINK_THRESHOLD` while still admitting them to the
 * ambiguous band, which is exactly what the band is for.
 *
 * On a small scan (a handful of sources) document frequency carries almost no
 * information — with four sources there is no evidence that any word is rare.
 * Blocking degenerates to "compare everything", which at that size is free, and
 * the stopword list rather than the cutoff is what keeps "the" out of the index.
 */
export const BLOCK_MAX_DF = 8;
export const FULL_WEIGHT_MAX_DF = 3;
export const DISTANT_WEIGHT_FACTOR = 0.5;

/**
 * Per-channel weights. An entity key is a model-extracted proper noun and is
 * worth more than a bag-of-words hit.
 *
 * All three channels are bounded by the same document-frequency cutoffs above,
 * and dates were the last to get there. `analysis.dates` comes from a prompt
 * asking for "any dates" with no format constraint, so on a single news day a
 * model routinely emits the current date or the bare year for most of the scan.
 * Counting those un-capped was measured on the real 294: one date shared across
 * the scan took auto-links from 15 to 51 and turned the homeless-family /
 * mayor's-bike-ride pair — the named must-NOT-merge trap — into an auto-link at
 * 4.5. Two shared dates rejected nothing at all and produced a cluster of 18.
 *
 * The rule is therefore the one the other channels already use rather than a
 * date parser: a date shared by more than `BLOCK_MAX_DF` sources is describing
 * the news day and is dropped, and one shared by 4 to 8 counts at
 * `DISTANT_WEIGHT_FACTOR`. That is also how a shared YEAR and a shared SPECIFIC
 * DATE are told apart — not by parsing the string, which the unconstrained model
 * output does not support, but by measuring how many sources say it. A year
 * everyone mentions is common by observation; an event date three sources
 * mention is rare by observation. Verified on the real 294: injecting the news
 * day plus the year onto all 294 rows now changes no score, no verdict and no
 * cluster, while a date on just two rows still counts at full weight.
 *
 * Dates are scored but NOT indexed for blocking, so a date can sharpen a pair
 * that tokens or entity keys already proposed and can never propose one itself.
 */
export const WEIGHT_TOKEN = 1;
export const WEIGHT_ENTITY_KEY = 2;
export const WEIGHT_DATE = 1;

/**
 * At or above this, code links the pair. No model is involved and no model can
 * undo it.
 *
 * CHOSEN: 4 — two shared entity keys, or one entity key plus two full-weight
 * tokens, or four of them. It sits in a real gap in the score distribution of
 * the 294, measured after the double count below was removed:
 *
 *   - Immediately BELOW it, at 3.5, sits a dense wall of pairs that are plainly
 *     not the same story — two unrelated r/milwaukee dining threads, a Joint
 *     Review Board notice against the city events calendar on calendar
 *     boilerplate, and ten permutations of the same high-school football
 *     listing across aggregator sites. Dropping the threshold to 3.5 auto-links
 *     every one of them.
 *   - The lowest GENUINE merge sits exactly at 4.0: the Sherman Park 2016
 *     retrospective under two headlines.
 *
 * An earlier version of this comment justified the value with the
 * homeless-family / mayor's-bike-ride pair scoring 3.5. That 3.5 was an
 * artifact: the pair was being scored through two channels for one observation
 * (see the entity-key suppression in `groupSignals`). It now scores 2.0, at the
 * floor of the ambiguous band, so the trap is held apart by a margin of 2 rather
 * than 0.5 — but it is no longer what pins this threshold. The wall at 3.5 is.
 */
export const LINK_THRESHOLD = 4;

/**
 * Below this, code rejects the pair. No model is involved.
 *
 * CHOSEN: 2 — one shared key is not a story. Everything in
 * [REJECT_THRESHOLD, LINK_THRESHOLD) is the ambiguous band and is the ONLY input
 * Task 6's model call will ever receive; on the real 294 that band is 89 pairs.
 * Dropping this to 1 was re-measured on the shipped two-tier cutoffs: the band
 * goes to **521** pairs, so 432 pairs the code rejects on its own would become a
 * model's call, which hollows out the claim that code decides. (An earlier
 * version of this comment said 410. That figure came from the abandoned
 * single-cutoff design and was never true of the code it sat next to.)
 */
export const REJECT_THRESHOLD = 2;

/**
 * Function words carry no identity, and no corpus size thins them out — on a
 * six-source scan "the" has df 5 and would sail past `BLOCK_MAX_DF`.
 * English and Spanish, because `analyzeResults` translates and the scan is
 * bilingual by design.
 */
const STOPWORDS = new Set<string>([
  // English
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one",
  "our", "out", "day", "get", "has", "him", "his", "how", "its", "new", "now", "old", "see", "two",
  "way", "who", "boy", "did", "man", "men", "put", "say", "she", "too", "use", "that", "with", "have",
  "this", "will", "your", "from", "they", "know", "want", "been", "good", "much", "some", "time",
  "very", "when", "come", "here", "just", "like", "long", "make", "many", "over", "such", "take",
  "than", "them", "well", "were", "what", "there", "their", "would", "about", "which", "after",
  "could", "other", "into", "more", "only", "also", "said", "says", "these", "those", "being",
  "where", "while", "still", "since", "before", "during", "through", "because", "between",
  // Spanish
  "que", "los", "las", "una", "por", "con", "para", "del", "como", "más", "mas", "pero", "sus",
  "les", "esta", "este", "esto", "son", "fue", "han", "hay", "sobre", "todo", "toda", "todos",
  "entre", "cuando", "donde", "porque", "desde", "hasta", "muy", "sin", "aunque", "ser", "estar",
  "dice", "dicen", "dijo", "año", "años", "ano", "anos",
]);

const MIN_TOKEN_LENGTH = 3;

/** Lower-cased, accent-stripped, punctuation-free words. Reuses the same normalisation identity does. */
function tokenize(...parts: (string | null | undefined)[]): Set<string> {
  const words = normalizeEntityKey(parts.filter(Boolean).join(" ")).split(" ");
  return new Set(words.filter((w) => w.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(w)));
}

/**
 * Entity keys as the model wrote them are compared after normalisation —
 * `analyzeResults` deduplicates by exact string, so "Common Council" and
 * "common council" arrive as two keys and would otherwise never match.
 */
function normalizedEntityKeys(raw: string[]): Set<string> {
  const out = new Set<string>();
  for (const key of raw) {
    const normalized = normalizeEntityKey(key);
    if (normalized.length > 0) out.add(normalized);
  }
  return out;
}

function normalizedDates(raw: string[]): Set<string> {
  const out = new Set<string>();
  for (const date of raw) {
    const trimmed = date.trim();
    if (trimmed.length > 0) out.add(trimmed);
  }
  return out;
}

/**
 * Both cutoffs, adjusted for how much this scan can tell us.
 *
 * Document frequency only means something once there are enough documents for a
 * count to be evidence. On a scan of four sources, a term in all four is not
 * "common" — there is simply no corpus to be common in, and the honest reading is
 * that the scan is about one thing. The line is drawn where the outer cutoff
 * stops filtering anything: at n <= BLOCK_MAX_DF every key is inside the canopy
 * by definition, so df is discarded and every shared key counts full.
 *
 * The cost, named: a real scan of eight or fewer sources will over-merge, because
 * "milwaukee" and "housing" then count as much as "harambee". A scan that small
 * is degenerate — real ones run 100 to 400 — and over-merging eight sources is a
 * smaller harm than being unable to group any story covered by more than three.
 */
function cutoffsFor(n: number): { blockMaxDf: number; fullWeightMaxDf: number } {
  return n > BLOCK_MAX_DF
    ? { blockMaxDf: BLOCK_MAX_DF, fullWeightMaxDf: FULL_WEIGHT_MAX_DF }
    : { blockMaxDf: n, fullWeightMaxDf: n };
}

/** key -> the signal indexes carrying it, for the keys inside the outer canopy. */
function invertedIndex(perSignal: Set<string>[], blockMaxDf: number): Map<string, number[]> {
  const postings = new Map<string, number[]>();
  for (const [i, keys] of perSignal.entries()) {
    for (const key of keys) {
      const existing = postings.get(key);
      if (existing) existing.push(i);
      else postings.set(key, [i]);
    }
  }
  for (const [key, docs] of postings) {
    // df of 1 can never be shared; df above the outer cutoff is describing the
    // city rather than a story.
    if (docs.length < 2 || docs.length > blockMaxDf) postings.delete(key);
  }
  return postings;
}

/**
 * How much a shared key is worth: full inside the tight metric, discounted in
 * the loose band, zero outside it. Zero can only happen for a key that was never
 * indexed, so it never reaches the score.
 */
function keyWeight(index: Map<string, number[]>, key: string, base: number, fullWeightMaxDf: number): number {
  const docs = index.get(key);
  if (!docs) return 0;
  return docs.length <= fullWeightMaxDf ? base : base * DISTANT_WEIGHT_FACTOR;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

class UnionFind {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/**
 * Groups a scan's sources into stories. Pure — no Convex, no model, no clock.
 *
 * Every input signal appears in exactly one output cluster. That is deliberate:
 * the model call this replaces returned a schema-valid answer covering 22 of 294
 * sources and nothing noticed (task-1-report.md §B3). Code cannot lose a source.
 */
export function groupSignals(signals: ClusterSignal[]): GroupingOutcome {
  const n = signals.length;
  const tokensPerSignal = signals.map((s) =>
    tokenize(s.title, s.snippet, s.translatedTitle, s.translatedSnippet, s.claimSummary));
  const entityKeysPerSignal = signals.map((s) => normalizedEntityKeys(s.entityKeys));
  const datesPerSignal = signals.map((s) => normalizedDates(s.dates));

  // 1. BLOCK — only pairs that share at least one indexed key are ever scored.
  const { blockMaxDf, fullWeightMaxDf } = cutoffsFor(n);
  const tokenIndex = invertedIndex(tokensPerSignal, blockMaxDf);
  const entityIndex = invertedIndex(entityKeysPerSignal, blockMaxDf);
  // Dates get the same document-frequency treatment as the other two channels,
  // and for the same reason: a key shared by most of the scan is describing the
  // news day, not a story. Deliberately NOT added to `candidates` below — a date
  // may sharpen a pair that tokens or entity keys already proposed, but it may
  // never propose one on its own.
  const dateIndex = invertedIndex(datesPerSignal, blockMaxDf);
  const candidates = new Set<string>();
  for (const postings of [tokenIndex, entityIndex]) {
    for (const docs of postings.values()) {
      for (let i = 0; i < docs.length; i++) {
        for (let j = i + 1; j < docs.length; j++) candidates.add(pairKey(docs[i], docs[j]));
      }
    }
  }

  // 2. SCORE — a weighted count of what the two sources actually share.
  const pairs: ScoredPair[] = [];
  const links: [number, number][] = [];
  let rejectedPairs = 0;
  let ambiguousCount = 0;
  for (const key of candidates) {
    const [i, j] = key.split(":").map(Number);
    const sharedEntityKeys = [...entityKeysPerSignal[i]]
      .filter((k) => entityIndex.has(k) && entityKeysPerSignal[j].has(k)).sort();
    // A shared entity key and the words it is spelled with are ONE piece of
    // evidence, not two. `analyzeResults` extracted "East Side" FROM the sentence
    // that also produced the tokens "east" and "side", so counting both scored a
    // single weak geographic locator through two independent channels — 3.5 for
    // what is really one observation. The entity key is the better witness (a
    // model called it a proper noun), so it keeps the point and its constituent
    // words are struck from the token channel for this pair.
    const claimedByEntityKey = new Set(sharedEntityKeys.flatMap((k) => k.split(" ")));
    const sharedTokens = [...tokensPerSignal[i]]
      .filter((t) => tokenIndex.has(t) && tokensPerSignal[j].has(t) && !claimedByEntityKey.has(t)).sort();
    const sharedDates = [...datesPerSignal[i]]
      .filter((d) => dateIndex.has(d) && datesPerSignal[j].has(d)).sort();

    const score = sharedTokens.reduce((total, t) => total + keyWeight(tokenIndex, t, WEIGHT_TOKEN, fullWeightMaxDf), 0)
      + sharedEntityKeys.reduce((total, k) => total + keyWeight(entityIndex, k, WEIGHT_ENTITY_KEY, fullWeightMaxDf), 0)
      + sharedDates.reduce((total, d) => total + keyWeight(dateIndex, d, WEIGHT_DATE, fullWeightMaxDf), 0);

    if (score < REJECT_THRESHOLD) {
      rejectedPairs++;
      continue;
    }
    const verdict: PairVerdict = score >= LINK_THRESHOLD ? "linked" : "ambiguous";
    if (verdict === "linked") links.push([i, j]);
    else ambiguousCount++;
    const [a, b] = [signals[i].sourceResultId, signals[j].sourceResultId].sort();
    pairs.push({ a, b, score, verdict, sharedTokens, sharedEntityKeys, sharedDates });
  }

  // 3. GROUP — union-find over the linked pairs only. An ambiguous pair does not
  // link today; Task 6 is what turns it into a yes or a no.
  const uf = new UnionFind(n);
  for (const [i, j] of links) uf.union(i, j);

  const members = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    const existing = members.get(root);
    if (existing) existing.push(i);
    else members.set(root, [i]);
  }

  const clusters: SignalCluster[] = [];
  let clustersWithoutEntityKeys = 0;
  let largestCluster = 0;
  for (const group of members.values()) {
    largestCluster = Math.max(largestCluster, group.length);
    // The union of the members' keys, deduplicated on the normalised form but
    // kept in the model's original casing — `candidateFingerprint` normalises
    // again downstream, and the raw key is what a human reads on the card.
    const seen = new Set<string>();
    const entityKeys: string[] = [];
    for (const i of group) {
      for (const raw of signals[i].entityKeys) {
        const normalized = normalizeEntityKey(raw);
        if (normalized.length === 0 || seen.has(normalized)) continue;
        seen.add(normalized);
        entityKeys.push(raw);
      }
    }
    if (entityKeys.length === 0) clustersWithoutEntityKeys++;
    clusters.push({
      sourceResultIds: group.map((i) => signals[i].sourceResultId),
      similarityBasis: describeBasis(group, pairs, signals),
      entityKeys,
      suggestedExistingCandidateId: null,
    });
  }

  return {
    clusters,
    pairs,
    stats: {
      signals: n,
      possiblePairs: (n * (n - 1)) / 2,
      blockedPairs: candidates.size,
      linkedPairs: links.length,
      ambiguousPairs: ambiguousCount,
      rejectedPairs,
      largestCluster,
      clustersWithoutEntityKeys,
    },
  };
}

const MAX_BASIS = 300; // `similarityBasis` is `reason` in the AI contract: max 300 chars.

/**
 * Why these sources are one story, in the words the code actually used. No model
 * wrote this, so it never says more than the score knew.
 */
function describeBasis(group: number[], pairs: ScoredPair[], signals: ClusterSignal[]): string {
  if (group.length === 1) return "Standalone signal: no other result in this scan shared a distinguishing term.";

  const ids = new Set(group.map((i) => signals[i].sourceResultId));
  const shared = new Set<string>();
  for (const pair of pairs) {
    if (pair.verdict !== "linked" || !ids.has(pair.a) || !ids.has(pair.b)) continue;
    for (const key of pair.sharedEntityKeys) shared.add(key);
    for (const token of pair.sharedTokens) shared.add(token);
  }
  return `Linked by shared terms: ${[...shared].sort().join(", ")}`.slice(0, MAX_BASIS);
}
