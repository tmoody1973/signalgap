import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

// Ruling 7. The 20-way test in tests/integration/search-budget.test.ts runs under
// convex-test, which takes a mutex per top-level transaction — the reservations
// never actually interleave there, so it proves ordering and nothing about the
// cap in production. This spawns 20 SEPARATE `npx convex run` processes, each its
// own client and its own transaction against the real deployment. Zero SerpApi
// calls: it only exercises Convex mutations.
const live = process.env.LIVE_TESTS === "1" && !!process.env.CONVEX_DEPLOYMENT;

const CALLERS = 20;
const SEEDED_AT = 115;
const CAP = 120;
const EXPECTED_GRANTS = CAP - SEEDED_AT;

const convex = async (fn: string, args: unknown) => {
  const { stdout } = await run("npx", ["convex", "run", fn, JSON.stringify(args)], {
    env: process.env, maxBuffer: 1024 * 1024,
  });
  const start = stdout.indexOf("{");
  return start === -1 ? null : JSON.parse(stdout.slice(start));
};

describe.skipIf(!live)("reserve holds the 120 cap under real concurrency", () => {
  it(`grants exactly ${EXPECTED_GRANTS} when ${CALLERS} independent clients race a scan at ${SEEDED_AT}`, async () => {
    const { scanId, userId } = await convex("internal.testing.seedScanAtReservation", { reserved: SEEDED_AT });
    try {
      const spec = (i: number) => ({
        templateId: "corroborate-entity-01", engine: "google", purpose: "corroboration",
        query: `race ${i}`, location: "Milwaukee, Wisconsin, United States",
        language: "en", timeWindow: "7d",
      });
      const outcomes = await Promise.all(
        Array.from({ length: CALLERS }, (_, i) => convex("internal.searchRuns.reserve", { scanId, spec: spec(i) })),
      );

      const granted = outcomes.filter((o) => o && "runId" in o).length;
      const rejected = outcomes.filter((o) => o && "rejected" in o).length;
      const counters = await convex("internal.testing.readScanCounters", { scanId });
      console.log(`real concurrency: granted=${granted} rejected=${rejected} reserved=${counters.searchesReserved} runs=${counters.runCount}`);

      // Anything other than an exact match is a Critical finding — a production
      // race that overspends the SerpApi budget. Do not relax these.
      expect(granted).toBe(EXPECTED_GRANTS);
      expect(rejected).toBe(CALLERS - EXPECTED_GRANTS);
      expect(counters.searchesReserved).toBe(CAP);
      expect(counters.runCount).toBe(EXPECTED_GRANTS);
    } finally {
      await convex("internal.testing.deleteScanById", { scanId, userId });
    }
  }, 180_000);
});
