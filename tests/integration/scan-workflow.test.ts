import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { asUser, setup } from "./helpers";

const NOW = 1_700_000_000_000;

async function seedUser(t: ReturnType<typeof setup>) {
  return t.run(async (ctx) =>
    ctx.db.insert("users", { clerkUserId: "owner", createdAt: NOW, updatedAt: NOW }),
  );
}

describe("scan workflow", () => {
  it("startScan records the workflow it started", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // A scan with no workflowId is a row nobody is executing. That is exactly
    // the state item 8 exists to remove.
    expect(scan?.workflowId).toEqual(expect.any(String));
    expect(scan?.status).toBe("queued");
    expect(scan?.searchBudgetLimit).toBe(120);
  });

  it("refuses a second live scan for the same owner", async () => {
    const t = setup();
    await seedUser(t);
    await asUser(t, "owner").mutation(api.scans.startScan, {});
    await expect(asUser(t, "owner").mutation(api.scans.startScan, {}))
      .rejects.toThrow(/already running/);
  });

  it("cancel marks the scan and leaves the workflow id in place for audit", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.cancelRequestedAt).toEqual(expect.any(Number));
    // Cancelling does NOT erase which workflow ran. An editor asking "what
    // happened to my scan" needs the id to still be there.
    expect(scan?.workflowId).toEqual(expect.any(String));
  });

  it("a stranger cannot cancel someone else's scan", async () => {
    const t = setup();
    await seedUser(t);
    await t.run(async (ctx) => ctx.db.insert("users", { clerkUserId: "stranger", createdAt: NOW, updatedAt: NOW }));
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await expect(asUser(t, "stranger").mutation(api.scans.cancel, { scanId }))
      .rejects.toThrow();
  });
});
