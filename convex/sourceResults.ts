import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { canonicalKey, contentHash, extractRedditPostId } from "./integrations/serpapi/canonical";
import type { SourceFamily } from "./integrations/serpapi/contracts";
import { requireUser } from "./lib/auth";
import * as V from "./lib/validators";

const vSourceResultInput = v.object({
  engine: V.vEngine,
  canonicalUrl: v.string(),
  originalUrl: v.string(),
  nativeId: v.optional(v.string()),
  title: v.string(),
  snippet: v.string(),
  publisher: v.optional(v.string()),
  author: v.optional(v.string()),
  channel: v.optional(v.string()),
  placeName: v.optional(v.string()),
  publishedAt: v.optional(v.number()),
  position: v.optional(v.number()),
  originalLanguage: v.string(),
  sourceFamily: V.vSourceFamily,
});

// The AI layer suggests sourceType later (analyzeResults); ingest only ever writes a
// deterministic starting value and never guesses "secondary" — that is a classification,
// not an observation available at ingest time.
const startingSourceType = (sourceFamily: SourceFamily) =>
  sourceFamily === "community_discussion" ? ("discussion" as const)
    : sourceFamily === "official" ? ("primary" as const)
      : ("unknown" as const);

export const ingest = internalMutation({
  args: { scanId: v.id("scans"), searchRunId: v.id("searchRuns"), results: v.array(vSourceResultInput) },
  returns: v.object({ inserted: v.number(), duplicates: v.number() }),
  handler: async (ctx, { scanId, searchRunId, results }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return { inserted: 0, duplicates: 0 };

    const seen = new Set<string>();
    let inserted = 0;
    let duplicates = 0;
    for (const r of results) {
      const key = canonicalKey(r.engine, r.canonicalUrl, r.nativeId);
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      const existing = await ctx.db
        .query("sourceResults")
        .withIndex("by_scan_canonical", (q) => q.eq("scanId", scanId).eq("canonicalKey", key))
        .unique();
      seen.add(key);
      if (existing) {
        duplicates++;
        continue;
      }
      await ctx.db.insert("sourceResults", {
        scanId, searchRunId, ownerId: scan.ownerId,
        canonicalKey: key, canonicalUrl: r.canonicalUrl, originalUrl: r.originalUrl,
        engine: r.engine, sourceFamily: r.sourceFamily, sourceType: startingSourceType(r.sourceFamily),
        title: r.title, snippet: r.snippet, originalLanguage: r.originalLanguage,
        publisher: r.publisher, author: r.author, channel: r.channel, placeName: r.placeName,
        publishedAt: r.publishedAt, discoveredAt: Date.now(), position: r.position,
        nativeId: r.nativeId, redditPostId: extractRedditPostId(r.originalUrl) ?? undefined,
        isAccessible: true, contentHash: contentHash([r.title, r.snippet]),
      });
      inserted++;
    }
    return { inserted, duplicates };
  },
});

const vSafeSourceResult = v.object({
  _id: v.id("sourceResults"),
  scanId: v.id("scans"),
  canonicalKey: v.string(),
  canonicalUrl: v.string(),
  originalUrl: v.string(),
  engine: V.vEngine,
  sourceFamily: V.vSourceFamily,
  sourceType: V.vSourceType,
  title: v.string(),
  snippet: v.string(),
  originalLanguage: v.string(),
  translatedTitle: v.optional(v.string()),
  translatedSnippet: v.optional(v.string()),
  publisher: v.optional(v.string()),
  author: v.optional(v.string()),
  channel: v.optional(v.string()),
  placeName: v.optional(v.string()),
  publishedAt: v.optional(v.number()),
  discoveredAt: v.number(),
  position: v.optional(v.number()),
  nativeId: v.optional(v.string()),
  redditPostId: v.optional(v.string()),
  isAccessible: v.boolean(),
  accessCheckedAt: v.optional(v.number()),
  contentHash: v.string(),
});

const vSafeSourceResultPage = v.object({ page: v.array(vSafeSourceResult), isDone: v.boolean(), continueCursor: v.string() });

export const listForScan = query({
  args: { scanId: v.id("scans"), paginationOpts: paginationOptsValidator },
  returns: vSafeSourceResultPage,
  handler: async (ctx, { scanId, paginationOpts }) => {
    const user = await requireUser(ctx);
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.ownerId !== user._id) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db.query("sourceResults").withIndex("by_scan", (q) => q.eq("scanId", scanId)).paginate(paginationOpts);
    return {
      page: result.page.map((r) => ({
        _id: r._id, scanId: r.scanId, canonicalKey: r.canonicalKey, canonicalUrl: r.canonicalUrl, originalUrl: r.originalUrl,
        engine: r.engine, sourceFamily: r.sourceFamily, sourceType: r.sourceType, title: r.title, snippet: r.snippet,
        originalLanguage: r.originalLanguage, translatedTitle: r.translatedTitle, translatedSnippet: r.translatedSnippet,
        publisher: r.publisher, author: r.author, channel: r.channel, placeName: r.placeName, publishedAt: r.publishedAt,
        discoveredAt: r.discoveredAt, position: r.position, nativeId: r.nativeId, redditPostId: r.redditPostId,
        isAccessible: r.isAccessible, accessCheckedAt: r.accessCheckedAt, contentHash: r.contentHash,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Every source this scan ingested for one purpose, oldest first.
 *
 * Ordering matters: the next stage clusters these, and a stable order makes a
 * replayed workflow produce the same clusters as the run it is resuming.
 */
export const idsForScan = internalQuery({
  args: { scanId: v.id("scans"), purpose: V.vPurpose },
  returns: v.array(v.id("sourceResults")),
  handler: async (ctx, { scanId, purpose }) => {
    const runs = await ctx.db
      .query("searchRuns")
      .withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId).eq("purpose", purpose))
      .collect();
    const runIds = new Set(runs.map((r) => r._id as string));

    const rows = await ctx.db
      .query("sourceResults")
      .withIndex("by_scan_canonical", (q) => q.eq("scanId", scanId))
      .collect();
    return rows.filter((r) => runIds.has(r.searchRunId as string)).map((r) => r._id);
  },
});

/**
 * Exactly what the deterministic clusterer reads, in the order it was asked for.
 *
 * `analysis` is optional on the row — a source whose `analyzeResults` batch
 * failed, or that was ingested before analysis ran, is a valid source. It gets
 * empty entity keys and an empty claim summary and is clustered on its title and
 * snippet alone, rather than being dropped. Dropping it would mean a scan that
 * finishes by seeing less.
 */
export const clusteringSignalsFor = internalQuery({
  args: { scanId: v.id("scans"), sourceResultIds: v.array(v.id("sourceResults")) },
  returns: v.array(v.object({
    sourceResultId: v.id("sourceResults"),
    title: v.string(),
    snippet: v.string(),
    translatedTitle: v.union(v.string(), v.null()),
    translatedSnippet: v.union(v.string(), v.null()),
    entityKeys: v.array(v.string()),
    claimSummary: v.string(),
    dates: v.array(v.string()),
  })),
  handler: async (ctx, { scanId, sourceResultIds }) => {
    const rows = [];
    for (const id of sourceResultIds) {
      const row = await ctx.db.get(id);
      if (!row || row.scanId !== scanId) continue;
      rows.push({
        sourceResultId: row._id,
        title: row.title,
        snippet: row.snippet,
        translatedTitle: row.translatedTitle ?? null,
        translatedSnippet: row.translatedSnippet ?? null,
        entityKeys: row.analysis?.entityKeys ?? [],
        claimSummary: row.analysis?.claimSummary ?? "",
        dates: row.analysis?.dates ?? [],
      });
    }
    return rows;
  },
});
