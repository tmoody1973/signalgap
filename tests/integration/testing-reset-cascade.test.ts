import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { setup } from "./helpers";

describe("deleteScansForClerkUser cascade", () => {
  it("removes the scan, its search runs, its source results and the archived raw JSON", async () => {
    const t = setup();
    const { scanId, runId, storageId } = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", { clerkUserId: "cascade-user", createdAt: now, updatedAt: now });
      const scanId = await ctx.db.insert("scans", scanDoc(userId) as never);
      const storageId = await ctx.storage.store(new Blob([JSON.stringify({ raw: true })], { type: "application/json" }));
      const runId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, userId, storageId));
      await ctx.db.insert("sourceResults", {
        scanId, searchRunId: runId, ownerId: userId,
        canonicalKey: "google_news|https://example.com/a", canonicalUrl: "https://example.com/a",
        originalUrl: "https://example.com/a", engine: "google_news", sourceFamily: "news", sourceType: "unknown",
        title: "t", snippet: "s", originalLanguage: "en", discoveredAt: now,
        isAccessible: true, contentHash: "hash",
      });
      return { scanId, runId, storageId };
    });

    const deleted = await t.mutation(internal.testing.deleteScansForClerkUser, { clerkUserId: "cascade-user" });
    expect(deleted).toBe(1);

    await t.run(async (ctx) => {
      expect(await ctx.db.get(scanId)).toBeNull();
      expect(await ctx.db.get(runId)).toBeNull();
      expect(await ctx.db.query("sourceResults").collect()).toHaveLength(0);
      expect(await ctx.storage.getUrl(storageId)).toBeNull();
    });
  });

  it("returns 0 and touches nothing when the clerk user has never signed in", async () => {
    const t = setup();
    expect(await t.mutation(internal.testing.deleteScansForClerkUser, { clerkUserId: "nobody" })).toBe(0);
  });
});
