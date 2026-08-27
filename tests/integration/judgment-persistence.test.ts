import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { scanDoc } from "../fixtures/factories";
import { setup } from "./helpers";

const judged = (value: string, basis: "deterministic" | "ai_suggested" | "editor", reason = "r") => ({ value, basis, reason });
const flag = (value: boolean) => ({ value, basis: "ai_suggested" as const, reason: "flagged by the model" });

const fullJudgment = {
  localityBand: judged("direct_city", "deterministic", "an official Milwaukee source is cited: city.milwaukee.gov"),
  relevanceBand: judged("policy_service_change", "ai_suggested"),
  beat: judged("housing", "ai_suggested"),
  isSpeculative: flag(false),
  isRoutineCrime: flag(false),
  isDuplicateOfCandidate: flag(false),
  hasMaterialConflict: flag(true),
};

async function seedCandidate(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const candidateId = await ctx.db.insert("candidates", {
      ownerId, fingerprint: "fp", currentTitle: "T", reportingQuestion: "",
      beat: "housing" as const, status: "processing" as const, primaryLabel: "Worth a look" as const,
      disposition: "new" as const, latestEvidenceVersion: 0,
      independentCategoryCount: 0, coverageOriginalCount: 0, coveragePassStatus: "pending" as const,
      firstSeenAt: now, lastSeenAt: now, updatedAt: now,
    });
    return { ownerId, scanId, candidateId };
  });
}

describe("judgment persistence", () => {
  it("stores all seven fields with their basis", async () => {
    const t = setup();
    const { candidateId } = await seedCandidate(t);

    await t.mutation(internal.candidates.judgment.saveJudgment, { candidateId, judgment: fullJudgment });

    const stored = (await t.run(async (ctx) => await ctx.db.get(candidateId))) as Doc<"candidates">;
    expect(Object.keys(stored.judgment ?? {})).toHaveLength(7);
    expect(stored.judgment?.localityBand?.basis).toBe("deterministic");
    expect(stored.judgment?.hasMaterialConflict.basis).toBe("ai_suggested");
  });

  it("moves the beat onto the candidate when the judgment names one", async () => {
    const t = setup();
    const { candidateId } = await seedCandidate(t);
    await t.mutation(internal.candidates.judgment.saveJudgment, {
      candidateId, judgment: { ...fullJudgment, beat: judged("culture", "ai_suggested") },
    });
    const stored = (await t.run(async (ctx) => await ctx.db.get(candidateId))) as Doc<"candidates">;
    expect(stored.beat).toBe("culture");
  });

  it("refuses a beat that is not one of the three real beats, and clears the column rather than keeping a stale one", async () => {
    // Task 4b changed this from a partial mirror to a total one. It used to
    // leave whatever the column already held, which meant a model naming a
    // fourth beat left the card asserting the old one — a judgment the product
    // no longer supported. Absence is the honest state.
    const t = setup();
    const { candidateId } = await seedCandidate(t);
    await t.mutation(internal.candidates.judgment.saveJudgment, {
      candidateId, judgment: { ...fullJudgment, beat: judged("sports", "ai_suggested") },
    });
    const stored = (await t.run(async (ctx) => await ctx.db.get(candidateId))) as Doc<"candidates">;
    expect(stored.beat).toBeUndefined();
  });

  it("lets an editor override a field and records the basis as editor", async () => {
    const t = setup();
    const { candidateId } = await seedCandidate(t);

    await t.mutation(internal.candidates.judgment.saveJudgment, { candidateId, judgment: fullJudgment });
    await t.mutation(internal.candidates.judgment.saveJudgment, {
      candidateId, judgment: fullJudgment,
      editorOverrides: { localityBand: "none", hasMaterialConflict: false },
    });

    const stored = (await t.run(async (ctx) => await ctx.db.get(candidateId))) as Doc<"candidates">;
    expect(stored.judgment?.localityBand).toEqual({ value: "none", basis: "editor", reason: "set by an editor" });
    expect(stored.judgment?.hasMaterialConflict).toEqual({ value: false, basis: "editor", reason: "set by an editor" });
  });

  it("an editor override beats the deterministic rule, not just the AI", async () => {
    const t = setup();
    const { candidateId } = await seedCandidate(t);
    await t.mutation(internal.candidates.judgment.saveJudgment, {
      candidateId, judgment: fullJudgment, editorOverrides: { localityBand: "county_city_effect" },
    });
    const stored = (await t.run(async (ctx) => await ctx.db.get(candidateId))) as Doc<"candidates">;
    // fullJudgment.localityBand arrived with basis "deterministic"; the editor still wins.
    expect(stored.judgment?.localityBand?.value).toBe("county_city_effect");
    expect(stored.judgment?.localityBand?.basis).toBe("editor");
  });

  it("reads back null for a candidate that has never been classified", async () => {
    const t = setup();
    const { candidateId } = await seedCandidate(t);
    expect(await t.query(internal.candidates.judgment.readJudgment, { candidateId })).toBeNull();
  });

  it("reads back exactly what was written", async () => {
    const t = setup();
    const { candidateId } = await seedCandidate(t);
    await t.mutation(internal.candidates.judgment.saveJudgment, { candidateId, judgment: fullJudgment });
    expect(await t.query(internal.candidates.judgment.readJudgment, { candidateId })).toEqual(fullJudgment);
  });
});
