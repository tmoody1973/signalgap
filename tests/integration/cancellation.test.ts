import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { runDiscoveryStage } from "../../convex/stages/discovery";
import { asUser, fakeFetch, seedUser, setup } from "./helpers";

const NOW = 1_700_000_000_000;

describe("cancellation", () => {
  it("preserves work already completed", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }));
    const before = await t.run(async (ctx) => ctx.db.query("sourceResults").collect());

    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });
    const { status } = await t.mutation(internal.scans.finalize, { scanId });

    expect(status).toBe("canceled");
    const after = await t.run(async (ctx) => ctx.db.query("sourceResults").collect());
    // Cancelling stops the future. It never deletes the past — those searches
    // were paid for and an editor is entitled to what they bought.
    expect(after).toHaveLength(before.length);
  });

  it("stops new reservations the moment it is requested", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    // reserve refuses outright once cancelRequestedAt is set.
    const reserved = await t.mutation(internal.searchRuns.reserve, {
      scanId,
      spec: {
        templateId: "news-housing-en-01", engine: "google_news", purpose: "discovery",
        query: "Milwaukee housing when:7d", location: "Milwaukee, Wisconsin, United States",
        language: "en", timeWindow: "7d",
      },
    });
    expect(reserved).toEqual({ rejected: "scan_not_active" });
  });

  it("a cancelled scan can never be finalized as completed, even later", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    await t.mutation(internal.scans.finalize, { scanId });
    const second = await t.mutation(internal.scans.finalize, { scanId });
    expect(second.status).toBe("canceled");
  });
});
