import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { scanDoc } from "../fixtures/factories";
import { asUser, setup } from "./helpers";

const spec = (templateId: string) => ({
  templateId, engine: "google" as const, purpose: "discovery" as const,
  query: `q-${templateId}`, location: "Milwaukee, Wisconsin, United States" as const,
  language: "en" as const, timeWindow: "7d" as const,
});

async function ownedScan(t: ReturnType<typeof setup>, reserved = 0) {
  const alice = asUser(t, "alice");
  const ownerId = await alice.mutation(api.users.ensureCurrent, {});
  const scanId = await t.run((ctx) => ctx.db.insert("scans", scanDoc(ownerId, { searchesReserved: reserved })));
  return { scanId, ownerId };
}

describe("searchRuns.reserve", () => {
  it("reserves once and increments the scan counter", async () => {
    const t = setup();
    const { scanId } = await ownedScan(t);
    const r = await t.mutation(internal.searchRuns.reserve, { scanId, spec: spec("news-housing-en-01") });
    expect(r).toMatchObject({ reused: false });
    const scan = await t.run((ctx) => ctx.db.get(scanId));
    expect(scan?.searchesReserved).toBe(1);
  });

  it("is idempotent: the same spec returns the same run without double-counting", async () => {
    const t = setup();
    const { scanId } = await ownedScan(t);
    const first = await t.mutation(internal.searchRuns.reserve, { scanId, spec: spec("news-housing-en-01") });
    const second = await t.mutation(internal.searchRuns.reserve, { scanId, spec: spec("news-housing-en-01") });
    expect(second).toMatchObject({ runId: (first as { runId: string }).runId, reused: true });
    const scan = await t.run((ctx) => ctx.db.get(scanId));
    expect(scan?.searchesReserved).toBe(1);
  });

  it("allows the 120th reservation and refuses the 121st", async () => {
    const t = setup();
    const { scanId } = await ownedScan(t, 119);
    const ok = await t.mutation(internal.searchRuns.reserve, { scanId, spec: spec("t-120") });
    expect(ok).toMatchObject({ reused: false });
    const over = await t.mutation(internal.searchRuns.reserve, { scanId, spec: spec("t-121") });
    expect(over).toEqual({ rejected: "budget_exhausted" });
    const scan = await t.run((ctx) => ctx.db.get(scanId));
    expect(scan?.searchesReserved).toBe(120);
  });

  it("never exceeds the cap under concurrent reservations", async () => {
    const t = setup();
    const { scanId } = await ownedScan(t, 115);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => t.mutation(internal.searchRuns.reserve, { scanId, spec: spec(`race-${i}`) })),
    );
    const granted = results.filter((r) => "runId" in r).length;
    expect(granted).toBe(5);
    const scan = await t.run((ctx) => ctx.db.get(scanId));
    expect(scan?.searchesReserved).toBe(120);
  });

  it("refuses to reserve on a cancelled scan", async () => {
    const t = setup();
    const { scanId } = await ownedScan(t);
    await t.run((ctx) => ctx.db.patch(scanId, { status: "canceled" }));
    expect(await t.mutation(internal.searchRuns.reserve, { scanId, spec: spec("x") })).toEqual({ rejected: "scan_not_active" });
  });

  it("refuses to reserve once cancellation has been requested", async () => {
    const t = setup();
    const { scanId } = await ownedScan(t);
    await t.run((ctx) => ctx.db.patch(scanId, { cancelRequestedAt: 1 }));
    expect(await t.mutation(internal.searchRuns.reserve, { scanId, spec: spec("x") })).toEqual({ rejected: "scan_not_active" });
  });

  it("persists candidateId on the stored run", async () => {
    const t = setup();
    const { scanId, ownerId } = await ownedScan(t);
    const candidateId = await t.run((ctx) =>
      ctx.db.insert("candidates", {
        ownerId, fingerprint: "fp-1", currentTitle: "t", reportingQuestion: "q",
        beat: "housing", status: "eligible", primaryLabel: "Worth a look", disposition: "new",
        latestEvidenceVersion: 1, independentCategoryCount: 1, coverageOriginalCount: 1,
        coveragePassStatus: "complete", firstSeenAt: 1, lastSeenAt: 1, updatedAt: 1,
      }),
    );
    const r = await t.mutation(internal.searchRuns.reserve, { scanId, spec: { ...spec("cand-01"), candidateId } });
    expect(r).toMatchObject({ reused: false });
    const run = await t.run((ctx) => ctx.db.get((r as { runId: Id<"searchRuns"> }).runId));
    expect(run?.candidateId).toBe(candidateId);
  });
});

describe("searchRuns run transitions are idempotent", () => {
  async function reservedRun(t: ReturnType<typeof setup>) {
    const { scanId } = await ownedScan(t);
    const r = await t.mutation(internal.searchRuns.reserve, { scanId, spec: spec("news-housing-en-01") });
    return { scanId, runId: (r as { runId: Id<"searchRuns"> }).runId };
  }

  it("calling complete twice increments searchesSucceeded exactly once", async () => {
    const t = setup();
    const { scanId, runId } = await reservedRun(t);
    await t.mutation(internal.searchRuns.complete, { runId, resultCount: 3, durationMs: 100 });
    await t.mutation(internal.searchRuns.complete, { runId, resultCount: 3, durationMs: 100 });
    const scan = await t.run((ctx) => ctx.db.get(scanId));
    expect(scan?.searchesSucceeded).toBe(1);
  });

  it("calling fail after complete does not decrement or double-count", async () => {
    const t = setup();
    const { scanId, runId } = await reservedRun(t);
    await t.mutation(internal.searchRuns.complete, { runId, resultCount: 3, durationMs: 100 });
    await t.mutation(internal.searchRuns.fail, { runId, errorCode: "E", errorMessage: "late failure", durationMs: 50 });
    const scan = await t.run((ctx) => ctx.db.get(scanId));
    expect(scan?.searchesSucceeded).toBe(1);
    expect(scan?.searchesFailed).toBe(0);
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.status).toBe("succeeded");
  });

  it("markRunning on an already-succeeded run is a no-op", async () => {
    const t = setup();
    const { runId } = await reservedRun(t);
    await t.mutation(internal.searchRuns.complete, { runId, resultCount: 3, durationMs: 100 });
    await t.mutation(internal.searchRuns.markRunning, { runId, parameters: { gl: "us" } });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.status).toBe("succeeded");
    expect(run?.attemptCount).toBe(0);
  });
});
