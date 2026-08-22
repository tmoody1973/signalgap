import { contentHash } from "./canonical";

export type SerpEngine = "google" | "google_news" | "google_trends_trending_now" | "google_events" | "youtube" | "google_maps";
export type SearchPurpose = "discovery" | "corroboration" | "coverage" | "enrichment";
export type TimeWindow = "7d" | "30d" | "current";
export type SearchLanguage = "en" | "es";
export const MILWAUKEE_LOCATION = "Milwaukee, Wisconsin, United States" as const;
export const MILWAUKEE_LL = "@43.0389,-87.9065,12z" as const;

export type SearchSpec = {
  templateId: string;
  engine: SerpEngine;
  purpose: SearchPurpose;
  query: string;
  location: typeof MILWAUKEE_LOCATION;
  language: SearchLanguage;
  timeWindow: TimeWindow;
  candidateId?: string;
};

export const idempotencyKeyFor = (scanId: string, spec: SearchSpec) =>
  `${scanId}:${spec.purpose}:${spec.templateId}:${contentHash([spec.query, spec.language, spec.timeWindow])}`;

export type SourceFamily = "news" | "official" | "event" | "video" | "map" | "community_discussion" | "public_web" | "trend";

export type SourceResultInput = {
  engine: SerpEngine;
  canonicalUrl: string;
  originalUrl: string;
  nativeId?: string;
  title: string;
  snippet: string;
  publisher?: string;
  author?: string;
  channel?: string;
  placeName?: string;
  publishedAt?: number;
  position?: number;
  originalLanguage: string;
  sourceFamily: SourceFamily;
};

// What a model is allowed to ask for. No URL, no engine parameters.
export type SearchIntent = {
  templateId: string;
  purpose: SearchPurpose;
  reason: string;
  candidateId?: string;
  /** Only substituted into a template's declared slots; never concatenated raw. */
  entityTerms?: string[];
};
