import { canonicalizeUrl } from "./canonical";
import type { SearchSpec, SourceResultInput } from "./contracts";
import { normalizeGoogleResult } from "./normalize/google";
import { asString, parseDate, type Entry } from "./normalize/shared";

function normalizeNews(spec: SearchSpec, entry: Entry): SourceResultInput | null {
  const title = asString(entry.title);
  const link = asString(entry.link);
  if (!title || !link) return null;
  const source = entry.source as Entry | undefined;
  return {
    engine: spec.engine,
    canonicalUrl: canonicalizeUrl(link),
    originalUrl: link,
    title,
    snippet: asString(entry.snippet) ?? "",
    publisher: asString(source?.name),
    // google_news gives an ISO iso_date alongside the human-readable date in every
    // fixture we captured; fall back to the human string (and thus to NaN/omit)
    // only if a future response is missing it.
    publishedAt: parseDate(entry.iso_date) ?? parseDate(entry.date),
    position: typeof entry.position === "number" ? entry.position : undefined,
    originalLanguage: spec.language,
    sourceFamily: "news",
  };
}

function normalizeEvent(spec: SearchSpec, entry: Entry): SourceResultInput | null {
  const title = asString(entry.title);
  const link = asString(entry.link);
  if (!title || !link) return null;
  const date = entry.date as Entry | undefined;
  const venue = entry.venue as Entry | undefined;
  return {
    engine: spec.engine,
    canonicalUrl: canonicalizeUrl(link),
    originalUrl: link,
    title,
    snippet: asString(entry.description) ?? "",
    placeName: asString(venue?.name),
    publishedAt: parseDate(date?.start_date),
    originalLanguage: spec.language,
    sourceFamily: "event",
  };
}

function normalizeVideo(spec: SearchSpec, entry: Entry): SourceResultInput | null {
  const title = asString(entry.title);
  const link = asString(entry.link);
  if (!title || !link) return null;
  const channel = entry.channel as Entry | undefined;
  return {
    engine: spec.engine,
    canonicalUrl: canonicalizeUrl(link),
    originalUrl: link,
    nativeId: asString(entry.video_id),
    title,
    snippet: asString(entry.description) ?? "",
    channel: asString(channel?.name),
    // youtube's published_date is almost always relative ("3 months ago") — NaN,
    // omitted, by design; see task-6-report.md.
    publishedAt: parseDate(entry.published_date),
    position: typeof entry.position_on_page === "number" ? entry.position_on_page : undefined,
    originalLanguage: spec.language,
    sourceFamily: "video",
  };
}

function normalizeMap(spec: SearchSpec, entry: Entry): SourceResultInput | null {
  const title = asString(entry.title);
  if (!title) return null;
  const placeId = asString(entry.place_id);
  const website = asString(entry.website);
  // Not every place has a website; fall back to a Maps place link built from
  // place_id so canonicalUrl/originalUrl (both required) always resolve.
  const link = website ?? (placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : undefined);
  if (!link) return null;
  return {
    engine: spec.engine,
    canonicalUrl: canonicalizeUrl(link),
    originalUrl: link,
    nativeId: placeId,
    title,
    snippet: asString(entry.description) ?? asString(entry.type) ?? "",
    placeName: title,
    position: typeof entry.position === "number" ? entry.position : undefined,
    originalLanguage: spec.language,
    sourceFamily: "map",
  };
}

function normalizeTrend(spec: SearchSpec, entry: Entry): SourceResultInput | null {
  const query = asString(entry.query);
  if (!query) return null;
  // Trending Now entries have no content URL of their own; build a stable,
  // navigable Trends explore link so canonicalUrl/originalUrl still resolve.
  const link = `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}&geo=${encodeURIComponent(spec.query)}`;
  const breakdown = entry.trend_breakdown as string[] | undefined;
  return {
    engine: spec.engine,
    canonicalUrl: canonicalizeUrl(link),
    originalUrl: link,
    title: query,
    snippet: Array.isArray(breakdown) ? breakdown.join(", ") : "",
    publishedAt: typeof entry.start_timestamp === "number" ? entry.start_timestamp * 1000 : undefined,
    originalLanguage: spec.language,
    sourceFamily: "trend",
  };
}

const RESULT_ARRAYS: Record<SearchSpec["engine"], { key: string; normalize: (spec: SearchSpec, e: Entry) => SourceResultInput | null }> = {
  google_news: { key: "news_results", normalize: normalizeNews },
  google_events: { key: "events_results", normalize: normalizeEvent },
  youtube: { key: "video_results", normalize: normalizeVideo },
  google_maps: { key: "local_results", normalize: normalizeMap },
  google_trends_trending_now: { key: "trending_searches", normalize: normalizeTrend },
  google: { key: "organic_results", normalize: normalizeGoogleResult },
};

export function normalizeResponse(spec: SearchSpec, json: unknown): { results: SourceResultInput[]; skipped: number } {
  const body = json && typeof json === "object" ? (json as Entry) : {};
  const { key, normalize } = RESULT_ARRAYS[spec.engine];
  const entries = body[key];

  const results: SourceResultInput[] = [];
  let skipped = 0;
  if (Array.isArray(entries)) {
    for (const raw of entries) {
      const entry = raw && typeof raw === "object" ? (raw as Entry) : undefined;
      const result = entry && normalize(spec, entry);
      if (result) results.push(result);
      else skipped++;
    }
  }
  return { results, skipped };
}
