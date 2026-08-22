import { isOfficialDomain } from "../../../config/officialDomains";
import { canonicalizeUrl, extractRedditPostId } from "../canonical";
import type { SearchSpec, SourceResultInput } from "../contracts";
import { asString, parseDate, type Entry } from "./shared";

// google's organic_results serve three different real-world shapes depending on
// which query template produced them (official-record queries, reddit discovery
// queries, or plain web search) — this is the only engine where sourceFamily is
// derived from the URL rather than fixed by the engine itself, so it gets its own
// file per the 40-line guidance in the task brief.
export function normalizeGoogleResult(spec: SearchSpec, entry: Entry): SourceResultInput | null {
  const title = asString(entry.title);
  const link = asString(entry.link);
  if (!title || !link) return null;

  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }

  const host = url.hostname;
  const official = isOfficialDomain(host);
  const redditId = extractRedditPostId(link);
  const looksLikeReddit = /\/r\//i.test(url.pathname);

  if (!official && looksLikeReddit && !redditId) {
    // Reddit-shaped URL that isn't an r/milwaukee comment permalink (wrong
    // subreddit, or a non-comment page) — skip rather than mis-file it.
    return null;
  }

  const sourceFamily = official ? "official" : redditId ? "community_discussion" : "public_web";

  return {
    engine: spec.engine,
    canonicalUrl: canonicalizeUrl(link),
    originalUrl: link,
    nativeId: redditId ?? undefined,
    title,
    snippet: asString(entry.snippet) ?? "",
    publishedAt: parseDate(entry.date),
    position: typeof entry.position === "number" ? entry.position : undefined,
    originalLanguage: spec.language,
    sourceFamily,
  };
}
