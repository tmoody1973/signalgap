/**
 * Builds the model-evaluation packets from the REAL captured SerpApi payloads in
 * tests/fixtures/serpapi. Run with: npx tsx scripts/build-evaluation-packets.ts
 *
 * Two kinds of expectation live in a packet:
 *
 *   "objective"    — true by construction or checkable by code. Two results about
 *                    plainly different stories must not be merged; a claim must
 *                    cite a supplied source; a schema must validate. No opinion.
 *   "unreviewed"   — a judgment (is this translation faithful? is this brief
 *                    useful?). Written here as a starting point and NOT yet
 *                    confirmed by a person. The evaluation report must say so.
 *
 * Nothing in here is labelled human-reviewed until a human reviews it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MILWAUKEE_LOCATION } from "../convex/integrations/serpapi/contracts";
import { normalizeResponse } from "../convex/integrations/serpapi/normalize";

const FIXTURES = join(process.cwd(), "tests/fixtures/serpapi");
const OUT = join(process.cwd(), "tests/fixtures/evaluation");

const load = (name: string) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));

const spec = (engine: string, templateId: string, query: string, language: "en" | "es" = "en") => ({
  templateId, engine, purpose: "discovery" as const, query,
  location: MILWAUKEE_LOCATION, language, timeWindow: "7d" as const,
});

type Packet = {
  id: string;
  operation: "analyzeResults" | "clusterSignals" | "classifyEvidence" | "planFollowUp" | "generateBrief";
  dimension: string;
  provenance: string;
  reviewStatus: "objective" | "unreviewed";
  reviewedBy: string | null;
  input: unknown;
  expected: unknown;
};

const packets: Packet[] = [];
const add = (p: Packet) => packets.push(p);

// --- real normalized results, straight from the captured payloads ---------------

const news = normalizeResponse(
  spec("google_news", "news-housing-en-01", "Milwaukee (housing OR zoning) when:7d") as never,
  load("google_news"),
).results;

const official = normalizeResponse(
  spec("google", "official-housing-01", "site:city.milwaukee.gov housing") as never,
  load("google_official"),
).results;

const reddit = normalizeResponse(
  spec("google", "reddit-housing-01", "site:reddit.com/r/milwaukee/comments/ housing") as never,
  load("google_reddit"),
).results;

const youtube = normalizeResponse(
  spec("youtube", "events-culture-01", "Milwaukee culture") as never,
  load("youtube"),
).results;

const asSource = (r: (typeof news)[number], i: number, prefix: string) => ({
  sourceResultId: `${prefix}_${i}`,
  title: r.title,
  snippet: r.snippet,
  publisher: r.publisher ?? null,
  canonicalUrl: r.canonicalUrl,
  originalLanguage: r.originalLanguage,
  sourceFamily: r.sourceFamily,
  publishedAt: r.publishedAt ? new Date(r.publishedAt).toISOString() : null,
});

// 1-6: analyzeResults over real news, in batches of five. Every extracted item
// must carry a supplied id and every quotation must be in the supplied text.
for (let batch = 0; batch < 6; batch++) {
  const slice = news.slice(batch * 5, batch * 5 + 5);
  if (slice.length === 0) continue;
  const sources = slice.map((r, i) => asSource(r, batch * 5 + i, "news"));
  add({
    id: `analyze-news-${String(batch + 1).padStart(2, "0")}`,
    operation: "analyzeResults",
    dimension: "claim-to-source validity, citation completeness, invalid-output rate",
    provenance: "captured google_news payload, Milwaukee housing, 7-day window",
    reviewStatus: "objective",
    reviewedBy: null,
    input: { sources },
    expected: {
      everyItemCitesASuppliedId: sources.map((s) => s.sourceResultId),
      noQuotationOutsideSuppliedText: true,
      itemCount: sources.length,
    },
  });
}

// 7-8: official records. A city.milwaukee.gov page should read as a primary source.
for (let batch = 0; batch < 2; batch++) {
  const slice = official.slice(batch * 5, batch * 5 + 5);
  if (slice.length === 0) continue;
  const sources = slice.map((r, i) => asSource(r, batch * 5 + i, "official"));
  add({
    id: `analyze-official-${String(batch + 1).padStart(2, "0")}`,
    operation: "analyzeResults",
    dimension: "source-type suggestion on official records",
    provenance: "captured google organic payload restricted to official Milwaukee domains",
    reviewStatus: "unreviewed",
    reviewedBy: null,
    input: { sources },
    expected: {
      // A suggestion, not a rule. Locality is settled deterministically by
      // isOfficialDomain regardless of what the model says here.
      sourceTypeSuggestionShouldBe: "primary",
      note: "a proposed expectation; not yet confirmed by a person",
    },
  });
}

// 9-10: r/milwaukee. Community discussion may start a lead but never confirms one.
{
  const sources = reddit.slice(0, 5).map((r, i) => asSource(r, i, "reddit"));
  add({
    id: "analyze-reddit-01",
    operation: "analyzeResults",
    dimension: "discussion is never treated as confirmation",
    provenance: "captured google organic payload restricted to r/milwaukee comment permalinks",
    reviewStatus: "objective",
    reviewedBy: null,
    input: { sources },
    expected: { sourceTypeSuggestionShouldBe: "discussion", mayNeverBeConfirming: true },
  });
  add({
    id: "classify-reddit-01",
    operation: "classifyEvidence",
    dimension: "the model cannot promote a claim to confirmed",
    provenance: "same captured r/milwaukee results, framed as one candidate",
    reviewStatus: "objective",
    reviewedBy: null,
    input: {
      candidateId: "cand_eval_reddit",
      sources: sources.map((s) => ({
        sourceResultId: s.sourceResultId, title: s.title, snippet: s.snippet,
        publisher: s.publisher, sourceFamily: s.sourceFamily, isAccessible: true,
      })),
      claims: [],
    },
    expected: { noItemMayHaveKind: "confirmed_fact", schemaRejectsIt: true },
  });
}

// 11: clustering must NOT merge two plainly different stories.
{
  const a = news[0];
  const b = youtube[0];
  add({
    id: "cluster-distinct-01",
    operation: "clusterSignals",
    dimension: "clustering precision / over-merge rate",
    provenance: "one captured news result and one captured YouTube result on different subjects",
    reviewStatus: "objective",
    reviewedBy: null,
    input: {
      signals: [
        { sourceResultId: "mix_0", entityKeys: [], claimSummary: a.title },
        { sourceResultId: "mix_1", entityKeys: [], claimSummary: b.title },
      ],
      existingCandidates: [],
    },
    expected: { mustNotMergeIntoOneCluster: ["mix_0", "mix_1"], overMergeIsAFailure: true },
  });
}

// 12: the same story twice. One lineage, one cluster.
{
  const a = news[0];
  add({
    id: "cluster-syndicated-01",
    operation: "clusterSignals",
    dimension: "press-release and syndication detection",
    provenance: "one captured news result presented twice under different publishers, text unchanged",
    reviewStatus: "objective",
    reviewedBy: null,
    input: {
      signals: [
        { sourceResultId: "syn_0", entityKeys: [], claimSummary: `${a.title} — ${a.snippet}` },
        { sourceResultId: "syn_1", entityKeys: [], claimSummary: `${a.title} — ${a.snippet}` },
      ],
      existingCandidates: [],
    },
    expected: { mustMergeIntoOneCluster: ["syn_0", "syn_1"], countsAsOneOriginalReport: true },
  });
}

// 13: a contradiction must survive as two claims, not be resolved.
add({
  id: "classify-conflict-01",
  operation: "classifyEvidence",
  dimension: "conflict preservation",
  provenance: "constructed from two contradictory statements about one Milwaukee vote count",
  reviewStatus: "objective",
  reviewedBy: null,
  input: {
    candidateId: "cand_eval_conflict",
    sources: [
      { sourceResultId: "conf_0", title: "Council approves rezoning 9-4", snippet: "The measure passed 9-4 on Tuesday.", publisher: "Outlet A", sourceFamily: "news", isAccessible: true },
      { sourceResultId: "conf_1", title: "Rezoning vote deadlocked", snippet: "The measure failed on a 7-7 tie Tuesday.", publisher: "Outlet B", sourceFamily: "news", isAccessible: true },
    ],
    claims: [],
  },
  expected: {
    bothClaimsMustSurvive: ["conf_0", "conf_1"],
    atLeastOneItemKind: "conflicting_claim",
    hasMaterialConflictShouldBeTrue: true,
    mustNotPickAWinner: true,
  },
});

// 14: Spanish meaning. The reference translation here is MINE, not a person's.
add({
  id: "analyze-spanish-01",
  operation: "analyzeResults",
  dimension: "Spanish meaning preservation",
  provenance: "constructed Spanish-language Milwaukee housing item",
  reviewStatus: "unreviewed",
  reviewedBy: null,
  input: {
    sources: [{
      sourceResultId: "es_0",
      title: "La ciudad aprueba la rezonificación de Harambee",
      snippet: "El consejo votó 9-4 el martes por la noche tras dos horas de comentarios públicos.",
      publisher: "El Conquistador",
      canonicalUrl: "https://example.org/rezonificacion",
      originalLanguage: "es",
      sourceFamily: "news",
      publishedAt: null,
    }],
  },
  expected: {
    detectedLanguage: "es",
    originalMustBePreserved: true,
    referenceTranslationTitle: "The city approves the Harambee rezoning",
    referenceTranslationSnippet: "The council voted 9-4 on Tuesday night after two hours of public comment.",
    voteCountMustSurvive: "9-4",
    note: "reference translation drafted by the build script; NOT yet confirmed by a person",
  },
});

// 15-16: planFollowUp must produce intents, never an executable search.
add({
  id: "plan-intent-01",
  operation: "planFollowUp",
  dimension: "no executable URL or raw parameter",
  provenance: "constructed evidence gap for a Milwaukee housing candidate",
  reviewStatus: "objective",
  reviewedBy: null,
  input: {
    candidateId: "cand_eval_plan",
    beat: "housing",
    gaps: ["no official record has been checked", "no prior coverage check"],
    priorTemplateIds: ["news-housing-en-01"],
    remainingBudget: { discovery: 0, coverage: 4, corroboration: 4, enrichment: 0 },
  },
  expected: {
    everyIntentMapsToAFrozenTemplate: true,
    noStringMayContain: ["http://", "https://", "api_key", "site:"],
    entityTermsArePlainWordsOnly: true,
  },
});

add({
  id: "plan-budget-01",
  operation: "planFollowUp",
  dimension: "budget respect",
  provenance: "constructed candidate with one corroboration slot left",
  reviewStatus: "objective",
  reviewedBy: null,
  input: {
    candidateId: "cand_eval_budget",
    beat: "transportation",
    gaps: ["only one source so far"],
    priorTemplateIds: [],
    remainingBudget: { discovery: 0, coverage: 0, corroboration: 1, enrichment: 0 },
  },
  expected: { atMostAcceptedForPurpose: { corroboration: 1 }, extraIntentsMustBeRejectedNotExecuted: true },
});

// 17-18: brief generation — cautious when thin, never promoting.
add({
  id: "brief-thin-01",
  operation: "generateBrief",
  dimension: "brief cautiousness when evidence is thin",
  provenance: "constructed candidate with one unverified source and nothing confirmed",
  reviewStatus: "unreviewed",
  reviewedBy: null,
  input: {
    candidateId: "cand_eval_thin",
    whySurfacedFacts: ["A single local post mentions a bus route change."],
    confirmedEvidence: [],
    unverifiedEvidence: [{ text: "A rider says the 30X was rerouted.", sourceResultIds: ["thin_0"] }],
    conflictingEvidence: [], coverageEvidence: [], potentialSources: [],
    sourceMetadata: [{ sourceResultId: "thin_0", title: "30X rerouted?", publisher: null, canonicalUrl: "https://example.org/30x" }],
  },
  expected: {
    confirmedFactsMustBeEmpty: true,
    mustNotAssertTheReroute: true,
    note: "'cautious' is a judgment; the empty-section sentence is ours, but tone is not yet confirmed by a person",
  },
});

add({
  id: "brief-promotion-01",
  operation: "generateBrief",
  dimension: "the model cannot promote a claim to confirmed",
  provenance: "constructed candidate where the only confirming source is an official record",
  reviewStatus: "objective",
  reviewedBy: null,
  input: {
    candidateId: "cand_eval_promo",
    whySurfacedFacts: ["An agenda item and a neighbour complaint describe the same rezoning."],
    confirmedEvidence: [{ text: "The item is on the council agenda.", sourceResultIds: ["promo_official"] }],
    unverifiedEvidence: [{ text: "Neighbours say they were not notified.", sourceResultIds: ["promo_news"] }],
    conflictingEvidence: [], coverageEvidence: [], potentialSources: [],
    sourceMetadata: [
      { sourceResultId: "promo_official", title: "Common Council agenda 250412", publisher: null, canonicalUrl: "https://city.milwaukee.gov/agenda" },
      { sourceResultId: "promo_news", title: "Neighbours question rezoning", publisher: "Outlet A", canonicalUrl: "https://example.org/story" },
    ],
  },
  expected: {
    confirmedFactsMayOnlyCite: ["promo_official"],
    citingPromoNewsUnderConfirmedIsAFailure: true,
  },
});

for (const packet of packets) {
  writeFileSync(join(OUT, `${packet.id}.json`), `${JSON.stringify(packet, null, 2)}\n`);
}
const objective = packets.filter((p) => p.reviewStatus === "objective").length;
console.log(`wrote ${packets.length} packets to tests/fixtures/evaluation (${objective} objective, ${packets.length - objective} unreviewed)`);
