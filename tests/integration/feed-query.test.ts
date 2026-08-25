import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { scanDoc } from "../fixtures/factories";
import { asUser, setup } from "./helpers";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

type Beat = "housing" | "transportation" | "culture";
type ProductLabel =
  | "Worth a look" | "Unverified tip" | "Coverage gap"
  | "Conflicting reports" | "Needs a recheck" | "No longer qualifies";
type Disposition = "new" | "rejected" | "monitoring" | "assigned";
type ExclusionReason =
  | "weak_locality" | "stale" | "insufficient_independence" | "no_beat_relevance"
  | "already_covered" | "inaccessible_evidence" | "coverage_pass_incomplete"
  | "promotional" | "duplicate" | "speculative" | "routine_crime" | "unreadable_evidence";

async function seedOwnerAndScan(
  t: ReturnType<typeof setup>,
  clerkUserId: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { clerkUserId, createdAt: NOW, updatedAt: NOW });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId, overrides) as never);
    return { ownerId, scanId };
  });
}

/** One candidate plus its appearance row in a given scan — the unit the feed reads. */
async function seedLead(
  t: ReturnType<typeof setup>,
  opts: {
    ownerId: Id<"users">;
    scanId: Id<"scans">;
    status: "processing" | "eligible" | "excluded";
    beat?: Beat;
    label?: ProductLabel;
    disposition?: Disposition;
    scoreTotal?: number;
    firstSeenAt?: number;
    exclusionReasons?: ExclusionReason[];
    fingerprint?: string;
  },
): Promise<Id<"candidates">> {
  const beat = opts.beat ?? "housing";
  const label = opts.label ?? "Worth a look";
  const disposition = opts.disposition ?? "new";
  const firstSeenAt = opts.firstSeenAt ?? NOW;
  return t.run(async (ctx) => {
    const candidateId = await ctx.db.insert("candidates", {
      ownerId: opts.ownerId,
      fingerprint: opts.fingerprint ?? `fp-${Math.random()}`,
      currentTitle: "A lead",
      reportingQuestion: "What happened here?",
      beat, status: opts.status, primaryLabel: label, disposition,
      latestEvidenceVersion: 0,
      scoreTotal: opts.scoreTotal,
      independentCategoryCount: 2,
      coverageOriginalCount: 0,
      coveragePassStatus: "complete",
      exclusionReasons: opts.exclusionReasons,
      firstSeenAt, lastSeenAt: firstSeenAt, updatedAt: firstSeenAt,
    });
    await ctx.db.insert("candidateAppearances", {
      candidateId, scanId: opts.scanId, ownerId: opts.ownerId,
      statusAtScan: opts.status, labelAtScan: label, dispositionAtScan: disposition,
      scoreAtScan: opts.scoreTotal, coverageCountAtScan: 0, categoryCountAtScan: 2,
    });
    return candidateId;
  });
}

type ListArgs = {
  scanId: Id<"scans">;
  view: "eligible" | "excluded";
  beat?: Beat;
  label?: ProductLabel;
  disposition?: Disposition;
  numItems?: number;
  cursor?: string | null;
};

const page = (t: ReturnType<typeof setup>, clerkUserId: string, args: ListArgs) =>
  asUser(t, clerkUserId).query(api.candidates.list.listForScan, {
    scanId: args.scanId, view: args.view, beat: args.beat, label: args.label, disposition: args.disposition,
    paginationOpts: { numItems: args.numItems ?? 50, cursor: args.cursor ?? null },
  });

describe("candidates.list.listForScan", () => {
  it("returns only this owner's leads", async () => {
    const t = setup();
    const { ownerId: aliceId, scanId: aliceScan } = await seedOwnerAndScan(t, "alice", { eligibleCount: 1 });
    const { ownerId: bobId, scanId: bobScan } = await seedOwnerAndScan(t, "bob", { eligibleCount: 1 });
    await seedLead(t, { ownerId: aliceId, scanId: aliceScan, status: "eligible" });
    await seedLead(t, { ownerId: bobId, scanId: bobScan, status: "eligible" });

    const alice = await page(t, "alice", { scanId: aliceScan, view: "eligible" });
    expect(alice.page).toHaveLength(1);

    const bob = await page(t, "bob", { scanId: bobScan, view: "eligible" });
    expect(bob.page).toHaveLength(1);
    expect(bob.page[0].candidateId).not.toBe(alice.page[0].candidateId);

    // alice cannot read bob's scan by guessing its id.
    const aliceOnBobScan = await page(t, "alice", { scanId: bobScan, view: "eligible" });
    expect(aliceOnBobScan).toEqual({ page: [], isDone: true, continueCursor: "", counts: { eligible: 0, excluded: 0, processing: 0 } });
  });

  it("defaults to eligible leads only when view is eligible", async () => {
    const t = setup();
    const { ownerId, scanId } = await seedOwnerAndScan(t, "owner", { eligibleCount: 1, excludedCount: 1 });
    await seedLead(t, { ownerId, scanId, status: "eligible" });
    await seedLead(t, { ownerId, scanId, status: "excluded", exclusionReasons: ["stale"] });

    const eligible = await page(t, "owner", { scanId, view: "eligible" });
    expect(eligible.page).toHaveLength(1);
    expect(eligible.page[0].exclusionReasons).toEqual([]);
  });

  it("sorts by score descending, then freshness, then stable id", async () => {
    const t = setup();
    const { ownerId, scanId } = await seedOwnerAndScan(t, "owner", { eligibleCount: 3 });
    // Two leads deliberately tie on both score AND freshness, so only the id
    // tiebreak can order them.
    const tieA = await seedLead(t, { ownerId, scanId, status: "eligible", scoreTotal: 50, firstSeenAt: NOW });
    const tieB = await seedLead(t, { ownerId, scanId, status: "eligible", scoreTotal: 50, firstSeenAt: NOW });
    await seedLead(t, { ownerId, scanId, status: "eligible", scoreTotal: 80, firstSeenAt: NOW - DAY });

    const result = await page(t, "owner", { scanId, view: "eligible" });
    expect(result.page.map((c) => c.scoreTotal)).toEqual([80, 50, 50]);
    const [expectedFirst, expectedSecond] = [tieA, tieB].sort();
    expect(result.page[1].candidateId).toBe(expectedFirst);
    expect(result.page[2].candidateId).toBe(expectedSecond);

    // Order is stable across repeated calls, not just internally consistent.
    const again = await page(t, "owner", { scanId, view: "eligible" });
    expect(again.page.map((c) => c.candidateId)).toEqual(result.page.map((c) => c.candidateId));
  });

  it("the excluded view returns leads with their reasons", async () => {
    const t = setup();
    const { ownerId, scanId } = await seedOwnerAndScan(t, "owner", { excludedCount: 1 });
    await seedLead(t, { ownerId, scanId, status: "excluded", exclusionReasons: ["coverage_pass_incomplete"] });

    const result = await page(t, "owner", { scanId, view: "excluded" });
    expect(result.page).toHaveLength(1);
    expect(result.page[0].exclusionReasons).toContain("coverage_pass_incomplete");
    expect(result.page[0].scoreTotal).toBeNull();
  });

  it("falls back to an empty list when a row has no exclusionReasons at all", async () => {
    const t = setup();
    const { ownerId, scanId } = await seedOwnerAndScan(t, "owner", { excludedCount: 1 });
    // exclusionReasons omitted entirely — the field is optional on the row,
    // and this is the shape an imported saved-demo scan (item 10) can have.
    await seedLead(t, { ownerId, scanId, status: "excluded" });

    const result = await page(t, "owner", { scanId, view: "excluded" });
    expect(result.page).toHaveLength(1);
    expect(result.page[0].exclusionReasons).toEqual([]);
  });

  it("filters by beat, label and disposition independently", async () => {
    const t = setup();
    const { ownerId, scanId } = await seedOwnerAndScan(t, "owner", { eligibleCount: 4 });
    await seedLead(t, { ownerId, scanId, status: "eligible", beat: "housing", label: "Worth a look", disposition: "new" });
    await seedLead(t, { ownerId, scanId, status: "eligible", beat: "transportation", label: "Worth a look", disposition: "new" });
    await seedLead(t, { ownerId, scanId, status: "eligible", beat: "housing", label: "Coverage gap", disposition: "new" });
    await seedLead(t, { ownerId, scanId, status: "eligible", beat: "housing", label: "Worth a look", disposition: "monitoring" });

    expect((await page(t, "owner", { scanId, view: "eligible", beat: "housing" })).page).toHaveLength(3);
    expect((await page(t, "owner", { scanId, view: "eligible", label: "Coverage gap" })).page).toHaveLength(1);
    expect((await page(t, "owner", { scanId, view: "eligible", disposition: "monitoring" })).page).toHaveLength(1);
    expect((await page(t, "owner", {
      scanId, view: "eligible", beat: "housing", label: "Worth a look", disposition: "new",
    })).page).toHaveLength(1);
  });

  it("paginates without dropping or repeating a lead", async () => {
    const t = setup();
    const { ownerId, scanId } = await seedOwnerAndScan(t, "owner", { eligibleCount: 30 });
    const ids: Id<"candidates">[] = [];
    for (let i = 0; i < 30; i++) {
      ids.push(await seedLead(t, { ownerId, scanId, status: "eligible", scoreTotal: i, firstSeenAt: NOW - i * 1000 }));
    }

    const first = await page(t, "owner", { scanId, view: "eligible", numItems: 25 });
    expect(first.page).toHaveLength(25);
    expect(first.isDone).toBe(false);

    const second = await page(t, "owner", { scanId, view: "eligible", numItems: 25, cursor: first.continueCursor });
    expect(second.page).toHaveLength(5);
    expect(second.isDone).toBe(true);

    const seenIds = [...first.page, ...second.page].map((c) => c.candidateId);
    expect(new Set(seenIds).size).toBe(30);
    expect(new Set(seenIds)).toEqual(new Set(ids));

    // Page 1 must be entirely above page 2. Without this, an implementation
    // that sliced before sorting would still pass the distinctness check above.
    expect(Math.min(...first.page.map((c) => c.scoreTotal!)))
      .toBeGreaterThanOrEqual(Math.max(...second.page.map((c) => c.scoreTotal!)));
  });

  it("counts are for the whole scan, not the current page", async () => {
    const t = setup();
    const { ownerId, scanId } = await seedOwnerAndScan(t, "owner", { eligibleCount: 6, excludedCount: 2, processingCount: 1 });
    for (let i = 0; i < 5; i++) await seedLead(t, { ownerId, scanId, status: "eligible", beat: "housing" });
    await seedLead(t, { ownerId, scanId, status: "eligible", beat: "transportation" });

    // Filtered down to one beat, the page shrinks — the counts must not.
    const result = await page(t, "owner", { scanId, view: "eligible", beat: "transportation" });
    expect(result.page).toHaveLength(1);
    expect(result.counts).toEqual({ eligible: 6, excluded: 2, processing: 1 });
  });
});
