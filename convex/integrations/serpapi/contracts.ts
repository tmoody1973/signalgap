import type { Id } from "../../_generated/dataModel";
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
  // Real once a SearchSpec exists: by then `validateSearchIntent` has already
  // run and the id came from our own code, never from a model.
  candidateId?: Id<"candidates">;
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
// `candidateId` is NOT one of those things: `planFollowUpOutput` (ai/contracts.ts)
// carries no such field, so a model never supplies one — the caller injects its
// own trusted id. Typing it as an Id keeps that fact in the type system.
export type SearchIntent = {
  templateId: string;
  purpose: SearchPurpose;
  reason: string;
  candidateId?: Id<"candidates">;
  /** Only substituted into a template's declared slots; never concatenated raw. */
  entityTerms?: string[];
};
