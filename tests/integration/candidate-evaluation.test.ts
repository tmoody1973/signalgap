import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { setup } from "./helpers";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const judged = (value: string, basis: "deterministic" | "ai_suggested" | "editor" = "ai_suggested") =>
  ({ value, basis, reason: "r" });
const flag = (value: boolean) => ({ value, basis: "ai_suggested" as const, reason: "r" });

const strongJudgment = {
  localityBand: judged("direct_city", "deterministic"),
  relevanceBand: judged("policy_service_change"),
  beat: judged("housing"),
  isSpeculative: flag(false),
  isRoutineCrime: flag(false),
  isDuplicateOfCandidate: flag(false),
  hasMaterialConflict: flag(false),
};

async function seed(
  t: ReturnType<typeof setup>,
  opts: {
    families: ("official" | "news" | "community_discussion")[];
    accessible?: boolean;
    coveragePassStatus?: "pending" | "complete" | "failed";
  },
) {
  return await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: NOW, updatedAt: NOW });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));
    const candidateId = await ctx.db.insert("candidates", {
      ownerId, fingerprint: "fp", currentTitle: "Harambee rezoning", reportingQuestion: "",
      beat: "housing" as const, status: "processing" as const, primaryLabel: "Worth a look" as const,
      disposition: "new" as const, latestEvidenceVersion: 0,
      independentCategoryCount: 0, coverageOriginalCount: 0,
      coveragePassStatus: opts.coveragePassStatus ?? "complete",
      firstSeenAt: NOW, lastSeenAt: NOW, updatedAt: NOW,
      judgment: strongJudgment,
    });
    await ctx.db.insert("candidateAppearances", {
      candidateId, scanId, ownerId,
      statusAtScan: "processing" as const, labelAtScan: "Worth a look" as const, dispositionAtScan: "new" as const,
    });

    const ids: Id<"sourceResults">[] = [];
    for (const [i, family] of opts.families.entries()) {
      const sourceResultId = await ctx.db.insert("sourceResults", {
        scanId, searchRunId, ownerId,
        canonicalKey: `k${i}`,
        canonicalUrl: family === "official" ? "https://city.milwaukee.gov/a" : `https://outlet${i}.com/a`,
        originalUrl: "https://x.com/a",
        engine: "google" as const, sourceFamily: family, sourceType: "unknown" as const,
        title: `t${i}`, snippet: `s${i}`, originalLanguage: "en",
        publishedAt: NOW - DAY, discoveredAt: NOW,
        isAccessible: opts.accessible ?? true, contentHash: "h",
      });
      await ctx.db.insert("candidateSources", {
        candidateId, scanId, sourceResultId,
        role: i === 0 ? ("initiating" as const) : ("corroborating" as const),
        independenceGroup: `host:outlet${i}`,
        signalCategory: family === "official" ? ("official_record" as const)
          : family === "news" ? ("original_news" as const) : ("community_discussion" as const),
        addedBy: "ai_suggestion" as const,
      });
      ids.push(sourceResultId);
    }
    return { ownerId, scanId, candidateId, ids };
  });
}

const read = async (t: ReturnType<typeof setup>, id: Id<"candidates">) =>
  (await t.run(async (ctx) => await ctx.db.get(id))) as Doc<"candidates">;

describe("candidate evaluation", () => {
  it("writes an eligible verdict with a score when two independent categories confirm", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["official", "news"] });

    const result = await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });

    expect("status" in result && result.status).toBe("eligible");
    const candidate = await read(t, candidateId);
    expect(candidate.status).toBe("eligible");
    expect(candidate.scoreTotal).toBeGreaterThan(0);
    expect(Object.keys(candidate.scoreComponents ?? {})).toHaveLength(5);
  });

  it("makes the five score components add up to the total", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["official", "news"] });
    await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });

    const candidate = await read(t, candidateId);
    const sum = Object.values(candidate.scoreComponents ?? {}).reduce((acc, c) => acc + c.points, 0);
    expect(sum).toBe(candidate.scoreTotal);
  });

  it("excludes a candidate whose only source is community discussion, and stores no score", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["community_discussion"] });

    const result = await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });

    expect("status" in result && result.status).toBe("excluded");
    const candidate = await read(t, candidateId);
    expect(candidate.scoreTotal).toBeUndefined();
    expect(candidate.scoreComponents).toBeUndefined();
  });

  it("clears a previous score when a re-evaluation turns the candidate excluded", async () => {
    const t = setup();
    const { scanId, candidateId, ids } = await seed(t, { families: ["official", "news"] });
    await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });
    expect((await read(t, candidateId)).scoreTotal).toBeGreaterThan(0);

    // Every source goes dark; the candidate can no longer stand up.
    await t.run(async (ctx) => {
      for (const id of ids) await ctx.db.patch(id, { isAccessible: false });
    });
    await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });

    const candidate = await read(t, candidateId);
    expect(candidate.status).toBe("excluded");
    expect(candidate.scoreTotal).toBeUndefined();
  });

  it("refuses to evaluate a candidate that has no stored judgment", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["official", "news"] });
    await t.run(async (ctx) => await ctx.db.patch(candidateId, { judgment: undefined }));

    expect(await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW }))
      .toEqual({ rejected: "no_judgment" });
  });

  it("uses the editor's band over the model's when an editor has overridden it", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["official", "news"] });
    await t.run(async (ctx) => await ctx.db.patch(candidateId, {
      judgment: { ...strongJudgment, localityBand: { value: "none", basis: "editor" as const, reason: "set by an editor" } },
    }));

    const result = await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });
    expect("status" in result && result.status).toBe("excluded");
    expect("reasons" in result && result.reasons).toContain("weak_locality");
  });

  it("records the independence and coverage counts the engine computed", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["official", "news"] });
    await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });

    const candidate = await read(t, candidateId);
    expect(candidate.independentCategoryCount).toBe(2);
    expect(candidate.coveragePassStatus).toBe("complete");
  });

  it("refuses eligibility while the coverage check has not completed", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["official", "news"], coveragePassStatus: "pending" });

    const result = await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });
    expect("status" in result && result.status).toBe("excluded");
    expect("reasons" in result && result.reasons).toContain("coverage_pass_incomplete");
    expect((await read(t, candidateId)).scoreTotal).toBeUndefined();
  });

  it("refuses eligibility when the coverage check failed outright", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["official", "news"], coveragePassStatus: "failed" });

    const result = await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });
    expect("status" in result && result.status).toBe("excluded");
    // A failed coverage pass can never support a `Coverage gap` claim.
    expect((await read(t, candidateId)).primaryLabel).not.toBe("Coverage gap");
  });

  it("never leaves a candidate in processing after evaluating it", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["community_discussion"] });
    await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });
    expect((await read(t, candidateId)).status).not.toBe("processing");
  });

  it("mirrors the verdict onto this scan's appearance row", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["official", "news"] });
    await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });

    const appearance = (await t.run(async (ctx) =>
      (await ctx.db.query("candidateAppearances").collect())[0])) as Doc<"candidateAppearances">;
    expect(appearance.statusAtScan).toBe("eligible");
    expect(appearance.categoryCountAtScan).toBe(2);
    expect(appearance.scoreAtScan).toBeGreaterThan(0);
  });
});
