import type { EngineSource, SignalCategory, SourceRole } from "../editorial/types";
import type { SourceFamily } from "../integrations/serpapi/contracts";

/**
 * The normalizers speak in source FAMILIES (what engine produced this). The rules
 * engine speaks in signal CATEGORIES (what kind of evidence this is). This is the
 * one place the two vocabularies meet, so the mapping is auditable in a single
 * eight-line table rather than scattered across call sites.
 */
const CATEGORY_BY_FAMILY: Record<SourceFamily, SignalCategory> = {
  news: "original_news",
  official: "official_record",
  event: "event",
  video: "video",
  map: "map",
  community_discussion: "community_discussion",
  public_web: "public_web",
  trend: "trend",
};

export const signalCategoryFor = (family: SourceFamily): SignalCategory => CATEGORY_BY_FAMILY[family];

/**
 * Independence is about lineage, not brand. Host is the honest default: two
 * stories on one site are one original report. Real syndication (the same press
 * release under three mastheads) is detected later and recorded as an override —
 * we never guess a publisher relationship here.
 */
export function defaultIndependenceGroup(canonicalUrl: string, publisher: string | null): string {
  try {
    return `host:${new URL(canonicalUrl).hostname.toLowerCase().replace(/^www\./, "")}`;
  } catch {
    return publisher ? `publisher:${publisher.toLowerCase()}` : "ungrouped";
  }
}

export function toEngineSource(args: {
  sourceResultId: string;
  sourceFamily: SourceFamily;
  canonicalUrl: string;
  publisher: string | null;
  publishedAt: number | undefined;
  isAccessible: boolean;
  role: SourceRole;
  independenceGroupOverride: string | null;
  signalCategoryOverride: SignalCategory | null;
  isPromotional: boolean;
}): EngineSource {
  const source: EngineSource = {
    id: args.sourceResultId,
    signalCategory: args.signalCategoryOverride ?? signalCategoryFor(args.sourceFamily),
    role: args.role,
    independenceGroup: args.independenceGroupOverride ?? defaultIndependenceGroup(args.canonicalUrl, args.publisher),
    isAccessible: args.isAccessible,
    isPromotional: args.isPromotional,
  };
  // Absent is absent. An invented date would move the freshness score.
  if (args.publishedAt !== undefined) source.publishedAt = args.publishedAt;
  return source;
}
