import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
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

  it("takes the candidate, its membership, evidence and brief with the scan", async () => {
    const t = setup();
    const seeded = await t.mutation(internal.testing.seedSliceFixture, { clerkUserId: "cascade-slice" });
    expect(seeded.candidateId).toBeTruthy();

    const before = await t.run(async (ctx) => ({
      candidates: (await ctx.db.query("candidates").collect()).length,
      evidence: (await ctx.db.query("evidenceItems").collect()).length,
      briefs: (await ctx.db.query("briefVersions").collect()).length,
      memberships: (await ctx.db.query("candidateSources").collect()).length,
      modelRuns: (await ctx.db.query("modelRuns").collect()).length,
    }));
    expect(before).toEqual({ candidates: 1, evidence: 4, briefs: 1, memberships: 4, modelRuns: 1 });

    await t.mutation(internal.testing.deleteScansForClerkUser, { clerkUserId: "cascade-slice" });

    const after = await t.run(async (ctx) => ({
      scans: (await ctx.db.query("scans").collect()).length,
      candidates: (await ctx.db.query("candidates").collect()).length,
      evidence: (await ctx.db.query("evidenceItems").collect()).length,
      briefs: (await ctx.db.query("briefVersions").collect()).length,
      memberships: (await ctx.db.query("candidateSources").collect()).length,
      appearances: (await ctx.db.query("candidateAppearances").collect()).length,
      modelRuns: (await ctx.db.query("modelRuns").collect()).length,
      sources: (await ctx.db.query("sourceResults").collect()).length,
    }));
    expect(after).toEqual({
      scans: 0, candidates: 0, evidence: 0, briefs: 0,
      memberships: 0, appearances: 0, modelRuns: 0, sources: 0,
    });
  });

  it("re-seeding the fixture replaces the lead instead of doubling it", async () => {
    const t = setup();
    await t.mutation(internal.testing.seedSliceFixture, { clerkUserId: "cascade-slice" });
    await t.mutation(internal.testing.seedSliceFixture, { clerkUserId: "cascade-slice" });

    const counts = await t.run(async (ctx) => ({
      candidates: (await ctx.db.query("candidates").collect()).length,
      evidence: (await ctx.db.query("evidenceItems").collect()).length,
      briefs: (await ctx.db.query("briefVersions").collect()).length,
    }));
    expect(counts).toEqual({ candidates: 1, evidence: 4, briefs: 1 });
  });

  it("gives the seeded lead a verdict the RULES computed, not one we typed", async () => {
    const t = setup();
    const { candidateId } = await t.mutation(internal.testing.seedSliceFixture, { clerkUserId: "cascade-slice" });
    const candidate = (await t.run(async (ctx) => await ctx.db.get(candidateId))) as Doc<"candidates">;

    // Seeded as processing / Worth a look / no score. The engine set all three.
    //
    // The verdict on this REAL lead is EXCLUDED, and that is the interesting
    // part. Three independent Milwaukee outlets covered the same plan
    // commission vote — three independence groups — but all three are the same
    // KIND of source, and the gate needs two independent categories. No
    // official record naming this project was captured, so none is attached.
    expect(candidate.status).toBe("excluded");
    expect(candidate.independentCategoryCount).toBe(1);
    // Excluded means no score at all. Not a zero.
    expect(candidate.scoreTotal).toBeUndefined();
    // Not "Unverified tip": there IS one confirming category, just not the two
    // the gate needs. "Coverage gap" is impossible because the coverage check
    // never ran. So it lands on the neutral label.
    expect(candidate.primaryLabel).toBe("Worth a look");
  });

  it("returns 0 and touches nothing when the clerk user has never signed in", async () => {
    const t = setup();
    expect(await t.mutation(internal.testing.deleteScansForClerkUser, { clerkUserId: "nobody" })).toBe(0);
  });
});
