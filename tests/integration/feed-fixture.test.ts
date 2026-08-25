import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import { setup } from "./helpers";

/**
 * The anti-fabrication guard for `seedFeedFixture`.
 *
 * This fixture is demo material: a human looks at the feed it produces and
 * believes it. So the test that matters is not "does it seed 30 rows" — it is
 * "does every row it seeds trace back to a captured SerpApi payload". A future
 * edit that invents a headline, a publisher, a URL, a date or a snippet fails
 * here.
 */

const payload = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/serpapi/${name}.json`, import.meta.url), "utf8"));

type CapturedRow = { url: string; title: string; publisher?: string; publishedAt?: number; snippet?: string };

function capturedRows(): CapturedRow[] {
  const rows: CapturedRow[] = [];
  for (const r of payload("google_news").news_results as Array<Record<string, never>>) {
    const row = r as unknown as { link: string; title: string; source: { name: string }; iso_date: string };
    // `news_results` carries no snippet at all, so a seeded news row must hold "".
    rows.push({ url: row.link, title: row.title, publisher: row.source.name, publishedAt: Date.parse(row.iso_date) });
  }
  for (const name of ["google_official", "google_reddit"]) {
    for (const r of payload(name).organic_results as Array<{ link: string; title: string; snippet: string }>) {
      rows.push({ url: r.link, title: r.title, snippet: r.snippet });
    }
  }
  return rows;
}

describe("seedFeedFixture", () => {
  it("seeds every source from a captured payload row, verbatim", async () => {
    const t = setup();
    await t.mutation(internal.testing.seedFeedFixture, { clerkUserId: "feed-fixture-user" });

    const seeded = await t.run(async (ctx) =>
      (await ctx.db.query("sourceResults").collect()).map((s) => ({
        url: s.canonicalUrl, title: s.title, publisher: s.publisher, publishedAt: s.publishedAt, snippet: s.snippet,
      })));
    expect(seeded.length).toBeGreaterThan(0);

    const captured = capturedRows();
    for (const row of seeded) {
      const match = captured.find((c) => c.url === row.url);
      // A seeded URL that is in no captured payload is an invented source.
      expect(match, `no captured payload row for ${row.url}`).toBeDefined();
      expect(row.title).toBe(match?.title);
      expect(row.publisher).toBe(match?.publisher);
      expect(row.publishedAt).toBe(match?.publishedAt);
      // Every snippet in this fixture belongs to an official or Reddit row — the
      // rows whose entire visible substance IS the snippet, and which two
      // reporting questions quote. `?? ""` also catches a snippet invented onto a
      // news row, where the payload carries none.
      expect(row.snippet).toBe(match?.snippet ?? "");
    }
  });

  it("re-running leaves one scan and one copy of each lead, not two", async () => {
    const t = setup();
    const first = await t.mutation(internal.testing.seedFeedFixture, { clerkUserId: "feed-idempotent" });
    const second = await t.mutation(internal.testing.seedFeedFixture, { clerkUserId: "feed-idempotent" });

    expect(second.eligibleCount).toBe(first.eligibleCount);
    expect(second.excludedCount).toBe(first.excludedCount);

    const after = await t.run(async (ctx) => ({
      scans: (await ctx.db.query("scans").collect()).length,
      candidates: (await ctx.db.query("candidates").collect()).length,
      appearances: (await ctx.db.query("candidateAppearances").collect()).length,
      sources: (await ctx.db.query("sourceResults").collect()).length,
    }));
    expect(after.scans).toBe(1);
    expect(after.candidates).toBe(first.eligibleCount + first.excludedCount);
    expect(after.appearances).toBe(after.candidates);
    // Orphaned source rows from the first run would leave this above the second
    // run's own count.
    expect(after.sources).toBeLessThanOrEqual(after.candidates * 4);
  });

  it("gives the did-not-qualify list more than one reason, and every beat a lead", async () => {
    const t = setup();
    await t.mutation(internal.testing.seedFeedFixture, { clerkUserId: "feed-variety" });

    const candidates = await t.run(async (ctx) => ctx.db.query("candidates").collect());
    const reasonSets = new Set(candidates.map((c) => (c.exclusionReasons ?? []).join("+")));
    const reasons = new Set(candidates.flatMap((c) => c.exclusionReasons ?? []));
    const beats = new Set(candidates.map((c) => c.beat));

    expect(reasonSets.size).toBeGreaterThanOrEqual(8);
    expect(reasons.size).toBeGreaterThanOrEqual(8);
    expect([...beats].sort()).toEqual(["culture", "housing", "transportation"]);
    // 25 is the feed's page size, so the list has to cross it for `Load next 25`.
    expect(candidates.length).toBeGreaterThan(25);
  });
});
