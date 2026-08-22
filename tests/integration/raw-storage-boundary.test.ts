import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { asUser, setup } from "./helpers";

describe("searchRuns.listForScan", () => {
  it("never exposes raw storage IDs or secrets and is owner-scoped", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    const aliceId = await alice.mutation(api.users.ensureCurrent, {});
    const { scanId } = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([JSON.stringify({ organic_results: [] })]));
      const scanId = await ctx.db.insert("scans", scanDoc(aliceId));
      await ctx.db.insert("searchRuns", searchRunDoc(scanId, aliceId, storageId));
      return { scanId };
    });

    const result = await alice.query(api.searchRuns.listForScan, { scanId, paginationOpts: { numItems: 200, cursor: null } });
    expect(result.page).toHaveLength(1);
    expect(JSON.stringify(result.page)).not.toMatch(/rawStorageId|api_key/);
    expect(result.page[0]).toMatchObject({ query: "Milwaukee (housing OR zoning)", purpose: "discovery", status: "succeeded", resultCount: 7 });

    const bob = asUser(t, "bob");
    await bob.mutation(api.users.ensureCurrent, {});
    expect((await bob.query(api.searchRuns.listForScan, { scanId, paginationOpts: { numItems: 200, cursor: null } })).page).toEqual([]);
  });
});
