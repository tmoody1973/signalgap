import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
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

describe("scan state transitions", () => {
  it("setStage moves queued to running the first time and records the stage", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    await t.mutation(internal.scans.setStage, { scanId, stage: "coverage" });
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.status).toBe("running");
    expect(scan?.stage).toBe("coverage");
  });

  it("recordFailure appends once per purpose+code, not once per occurrence", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    for (let i = 0; i < 3; i++) {
      await t.mutation(internal.scans.recordFailure, {
        scanId, purpose: "coverage", code: "http_429", message: "rate limited",
      });
    }
    await t.mutation(internal.scans.recordFailure, {
      scanId, purpose: "discovery", code: "http_429", message: "rate limited",
    });

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // Three rate-limited coverage calls are ONE thing an editor needs told,
    // not three. A different purpose is a different thing.
    expect(scan?.failureSummaries).toHaveLength(2);
    expect(scan?.failureSummaries.map((f) => f.purpose).sort()).toEqual(["coverage", "discovery"]);
  });

  it("finalize with no failures completes the scan", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await t.mutation(internal.scans.setStage, { scanId, stage: "briefs" });

    const { status } = await t.mutation(internal.scans.finalize, { scanId });
    expect(status).toBe("completed");
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.completedAt).toEqual(expect.any(Number));
  });

  it("finalize with named failures ends partial, not completed", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await t.mutation(internal.scans.recordFailure, {
      scanId, purpose: "coverage", code: "http_500", message: "upstream error",
    });

    const { status } = await t.mutation(internal.scans.finalize, { scanId });
    expect(status).toBe("partial");
  });

  it("finalize NEVER turns a cancelled scan into a completed one", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const { status } = await t.mutation(internal.scans.finalize, { scanId });
    expect(status).toBe("canceled");
  });

  it("finalize is safe to call twice and does not move a terminal scan", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const first = await t.mutation(internal.scans.finalize, { scanId });
    const firstCompletedAt = (await t.run(async (ctx) => ctx.db.get(scanId)))?.completedAt;
    await t.mutation(internal.scans.recordFailure, {
      scanId, purpose: "coverage", code: "late", message: "arrived after finalize",
    });
    const second = await t.mutation(internal.scans.finalize, { scanId });

    expect(first.status).toBe("completed");
    // A late failure cannot rewrite history. The scan already ended.
    expect(second.status).toBe("completed");
    expect((await t.run(async (ctx) => ctx.db.get(scanId)))?.completedAt).toBe(firstCompletedAt);
  });

  it("recordSearchOutcome accumulates and never decrements failures", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    await t.mutation(internal.scans.recordSearchOutcome, { scanId, succeeded: 3, failed: 1 });
    await t.mutation(internal.scans.recordSearchOutcome, { scanId, succeeded: 2, failed: 0 });

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.searchesSucceeded).toBe(5);
    // searchesFailed is a cumulative count of failed ATTEMPTS, not a live gauge
    // of currently-failed rows. A retry reuses the row, so decrementing would
    // make succeeded + failed + in-flight == reserved impossible to hold.
    expect(scan?.searchesFailed).toBe(1);
  });

  it("cancelling leaves the scan terminal, so the owner can start another one", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // Cancelling the workflow means the workflow will never reach its own
    // finalize. If cancel does not finalize, this scan sits queued forever and
    // startScan's duplicate guard locks the owner out permanently.
    expect(scan?.status).toBe("canceled");
    expect(scan?.completedAt).toEqual(expect.any(Number));

    await expect(asUser(t, "owner").mutation(api.scans.startScan, {})).resolves.toEqual(expect.any(String));
  });

  it("a terminal scan's summary is frozen — late writes cannot change it", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await t.mutation(internal.scans.recordSearchOutcome, { scanId, succeeded: 4, failed: 0 });
    await t.mutation(internal.scans.finalize, { scanId });

    const atFinalize = await t.run(async (ctx) => ctx.db.get(scanId));

    // A search that was already in flight when the scan ended reports back here.
    await t.mutation(internal.scans.recordSearchOutcome, { scanId, succeeded: 1, failed: 1 });
    await t.mutation(internal.scans.recordFailure, { scanId, purpose: "coverage", code: "late", message: "arrived after the scan ended" });
    await t.mutation(internal.scans.setCandidateCounts, { scanId, eligibleCount: 9, excludedCount: 9, processingCount: 9 });

    const after = await t.run(async (ctx) => ctx.db.get(scanId));
    // Without the guard, a failure appended after finalize would leave a scan
    // reading "completed" with a failure under it and no Incomplete scan label.
    expect(after!.failureSummaries).toEqual(atFinalize!.failureSummaries);
    expect(after!.searchesSucceeded).toBe(atFinalize!.searchesSucceeded);
    expect(after!.searchesFailed).toBe(atFinalize!.searchesFailed);
    expect(after!.eligibleCount).toBe(atFinalize!.eligibleCount);
    expect(after!.status).toBe("completed");
  });
});
