import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
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
});
