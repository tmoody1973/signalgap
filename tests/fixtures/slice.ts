import type { Id } from "../../convex/_generated/dataModel";

/**
 * One captured Milwaukee candidate packet: an official agenda record, an English
 * news story, a Spanish news story from a different outlet, and an r/milwaukee
 * comment thread. Chosen so the slice exercises every branch the demo shows —
 * two independent confirming categories, a bilingual source, and a community
 * post that must stay non-confirming.
 *
 * Each row also carries the `analysis` block `analyzeResults` writes — entity
 * keys, a claim summary, and for the Spanish row the translation that sits beside
 * the original. That is not decoration: `analyzeResults` runs before clustering
 * in the real pipeline, and `convex/editorial/blocking.ts` groups these four on
 * exactly this data. A row with no `analysis` is what an un-analysed source looks
 * like, and these four are analysed by the time formation sees them.
 *
 * The one inference worth naming: the official agenda record's entity keys
 * include "Harambee", which its snippet does not say — the 3000 block of North
 * MLK Drive is in Harambee, and a model extracting neighbourhoods says so. That
 * key is what ties the official record to the news coverage.
 */
export const SLICE_SOURCES = [
  {
    key: "official",
    sourceFamily: "official" as const,
    canonicalUrl: "https://city.milwaukee.gov/agenda/250412",
    title: "Common Council agenda item 250412",
    snippet: "Rezoning of the 3000 block of North Dr. Martin Luther King Jr. Drive.",
    publisher: null,
    originalLanguage: "en",
    engine: "google" as const,
    translatedTitle: null,
    translatedSnippet: null,
    analysis: {
      entityKeys: ["Common Council", "North Dr. Martin Luther King Jr. Drive", "Harambee"],
      claimSummary: "The Common Council will consider rezoning the 3000 block of North Dr. Martin Luther King Jr. Drive in Harambee.",
      claims: [{ text: "The rezoning is agenda item 250412.", exactExcerpt: "Rezoning of the 3000 block of North Dr. Martin Luther King Jr. Drive." }],
      dates: [],
    },
  },
  {
    key: "news",
    sourceFamily: "news" as const,
    canonicalUrl: "https://jsonline.com/story/harambee-rezoning",
    title: "Neighbors question Harambee rezoning timeline",
    snippet: "Residents say they learned of the proposal a week before the vote.",
    publisher: "Milwaukee Journal Sentinel",
    originalLanguage: "en",
    engine: "google_news" as const,
    translatedTitle: null,
    translatedSnippet: null,
    analysis: {
      entityKeys: ["Harambee", "Common Council"],
      claimSummary: "Residents say they learned of the Harambee rezoning proposal a week before the Common Council vote.",
      claims: [{ text: "Residents say they learned of the proposal a week before the vote.", exactExcerpt: "Residents say they learned of the proposal a week before the vote." }],
      dates: [],
    },
  },
  {
    key: "spanish",
    sourceFamily: "news" as const,
    canonicalUrl: "https://elconquistador.example/rezonificacion-harambee",
    title: "Vecinos cuestionan la rezonificación de Harambee",
    snippet: "Los residentes dicen que se enteraron una semana antes de la votación.",
    publisher: "El Conquistador",
    originalLanguage: "es",
    engine: "google" as const,
    translatedTitle: "Neighbors question the Harambee rezoning",
    translatedSnippet: "Residents say they found out a week before the vote.",
    analysis: {
      entityKeys: ["Harambee"],
      claimSummary: "Neighbors say they found out about the Harambee rezoning a week before the vote.",
      claims: [{ text: "Neighbors say they were notified a week before the vote.", exactExcerpt: null }],
      dates: [],
    },
  },
  {
    key: "reddit",
    sourceFamily: "community_discussion" as const,
    canonicalUrl: "https://reddit.com/r/milwaukee/comments/abc123/harambee_rezoning",
    title: "Anyone know what's happening with the Harambee rezoning?",
    snippet: "Saw surveyors on MLK yesterday. Nobody I know got a notice.",
    publisher: null,
    originalLanguage: "en",
    engine: "google" as const,
    translatedTitle: null,
    translatedSnippet: null,
    analysis: {
      entityKeys: ["Harambee", "MLK Drive"],
      claimSummary: "A resident asks what is happening with the Harambee rezoning and reports surveyors on MLK Drive.",
      claims: [{ text: "A resident reports surveyors on MLK Drive.", exactExcerpt: "Saw surveyors on MLK yesterday. Nobody I know got a notice." }],
      dates: [],
    },
  },
] as const;

/**
 * The `sourceResults` row for one `SLICE_SOURCES` entry, including the `analysis`
 * block. Shared so the three seeders that insert this packet cannot drift apart.
 */
export function sliceSourceDoc(
  source: (typeof SLICE_SOURCES)[number],
  index: number,
  refs: { scanId: Id<"scans">; searchRunId: Id<"searchRuns">; ownerId: Id<"users">; modelRunId: Id<"modelRuns">; now: number; dayMs: number },
) {
  return {
    scanId: refs.scanId, searchRunId: refs.searchRunId, ownerId: refs.ownerId,
    canonicalKey: `k${index}`, canonicalUrl: source.canonicalUrl, originalUrl: source.canonicalUrl,
    engine: source.engine, sourceFamily: source.sourceFamily, sourceType: "unknown" as const,
    title: source.title, snippet: source.snippet,
    translatedTitle: source.translatedTitle ?? undefined,
    translatedSnippet: source.translatedSnippet ?? undefined,
    publisher: source.publisher ?? undefined,
    originalLanguage: source.originalLanguage,
    publishedAt: refs.now - refs.dayMs, discoveredAt: refs.now,
    isAccessible: true, contentHash: `h${index}`,
    analysis: {
      entityKeys: [...source.analysis.entityKeys],
      claimSummary: source.analysis.claimSummary,
      claims: source.analysis.claims.map((c) => ({
        text: c.text,
        ...(c.exactExcerpt === null ? {} : { exactExcerpt: c.exactExcerpt }),
      })),
      dates: [...source.analysis.dates],
      modelRunId: refs.modelRunId,
    },
  };
}

/** The succeeded `analyzeResults` run the packet's `analysis` blocks are attributed to. */
export function sliceAnalyzeRunDoc(scanId: Id<"scans">, ownerId: Id<"users">, now: number) {
  return {
    scanId, ownerId,
    operation: "analyzeResults" as const,
    idempotencyKey: `slice-analyze-${scanId}`,
    provider: "anthropic", modelId: "claude-sonnet-5",
    promptVersion: "1", schemaVersion: "1", inputSnapshotHash: "slice-analyze",
    status: "succeeded" as const, attempt: 1,
    startedAt: now, completedAt: now,
  };
}

export type SliceSourceKey = (typeof SLICE_SOURCES)[number]["key"];

/** Builds the fake model's answers, keyed to whatever ids the test actually inserted. */
export function sliceModelAnswers(ids: Record<SliceSourceKey, Id<"sourceResults">>) {
  return {
    clusterSignals: {
      clusters: [{
        sourceResultIds: [ids.official, ids.news, ids.spanish, ids.reddit] as string[],
        similarityBasis: "All four describe the same Common Council rezoning item in Harambee.",
        entityKeys: ["Harambee", "rezoning", "Common Council"],
        suggestedExistingCandidateId: null,
      }],
    },
    classifyEvidence: {
      beatSuggestion: "housing",
      localityBandSuggestion: "area_city_consequence",
      relevanceBandSuggestion: "policy_service_change",
      flags: { isSpeculative: false, isRoutineCrime: false, isDuplicateOfCandidate: false, hasMaterialConflict: false },
      items: [
        {
          sourceResultIds: [ids.official as string],
          kind: "existing_coverage",
          claimText: "The rezoning is agenda item 250412.",
          exactExcerpt: "Rezoning of the 3000 block of North Dr. Martin Luther King Jr. Drive.",
          originalLanguageText: null,
          translatedText: null,
          sourceTypeSuggestion: "primary",
          independenceGroupSuggestion: null,
          relationship: "supports",
          milwaukeeConnection: "The parcel is in Milwaukee's Harambee neighborhood.",
          accessibilityConcern: false,
          repeatsPressRelease: false,
          reason: "The council's own agenda names the item.",
        },
        {
          sourceResultIds: [ids.news as string],
          kind: "unverified_signal",
          claimText: "Residents say they learned of the proposal a week before the vote.",
          exactExcerpt: "Residents say they learned of the proposal a week before the vote.",
          originalLanguageText: null,
          translatedText: null,
          sourceTypeSuggestion: "secondary",
          independenceGroupSuggestion: null,
          relationship: "supports",
          milwaukeeConnection: "Reported by a Milwaukee outlet about a Milwaukee parcel.",
          accessibilityConcern: false,
          repeatsPressRelease: false,
          reason: "One local outlet reported it; nobody else has yet.",
        },
        {
          sourceResultIds: [ids.spanish as string],
          kind: "unverified_signal",
          claimText: "Neighbors say they were notified a week before the vote.",
          exactExcerpt: null,
          originalLanguageText: "Los residentes dicen que se enteraron una semana antes de la votación.",
          translatedText: "Residents say they found out a week before the vote.",
          sourceTypeSuggestion: "secondary",
          independenceGroupSuggestion: null,
          relationship: "supports",
          milwaukeeConnection: "A Spanish-language Milwaukee outlet covering the same parcel.",
          accessibilityConcern: false,
          repeatsPressRelease: false,
          reason: "Independent outlet, same claim.",
        },
        {
          sourceResultIds: [ids.reddit as string],
          kind: "potential_source",
          claimText: "A resident reports surveyors on MLK Drive.",
          exactExcerpt: "Saw surveyors on MLK yesterday. Nobody I know got a notice.",
          originalLanguageText: null,
          translatedText: null,
          sourceTypeSuggestion: "discussion",
          independenceGroupSuggestion: null,
          relationship: "supports",
          milwaukeeConnection: "Posted in r/milwaukee about an MLK Drive block.",
          accessibilityConcern: false,
          repeatsPressRelease: false,
          reason: "Community discussion. Never confirmation — a lead to call, not a fact.",
        },
      ],
    },
    generateBrief: {
      reportingQuestion: "Who was notified before the Harambee rezoning reached the council?",
      whySurfaced: "An official agenda item and two independent local outlets describe the same rezoning.",
      confirmedFacts: [],
      unverifiedClaims: [{
        text: "Residents say they learned of the proposal a week before the vote.",
        sourceResultIds: [ids.news as string],
        exactExcerpt: "Residents say they learned of the proposal a week before the vote.",
      }],
      conflicts: [],
      existingCoverage: [],
      potentialHumanSources: [{
        text: "A resident who saw surveyors on MLK Drive.",
        sourceResultIds: [ids.reddit as string],
        exactExcerpt: null,
      }],
      interviewQuestions: [
        "How much notice does the city owe residents before a rezoning vote?",
        "Who signed off on the notification schedule for item 250412?",
      ],
    },
  };
}
