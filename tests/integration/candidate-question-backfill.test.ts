import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { scanDoc } from "../fixtures/factories";
import { setup } from "./helpers";

const NOW = 1_700_000_000_000;

async function seed(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: NOW, updatedAt: NOW });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);

    const candidate = async (reportingQuestion: string) => {
      const candidateId = await ctx.db.insert("candidates", {
        ownerId, fingerprint: `fp-${Math.random()}`, currentTitle: "A lead",
        reportingQuestion, beat: "housing" as const, status: "eligible" as const,
        primaryLabel: "Worth a look" as const, disposition: "new" as const,
        latestEvidenceVersion: 1, independentCategoryCount: 2, coverageOriginalCount: 0,
        coveragePassStatus: "complete" as const,
        firstSeenAt: NOW, lastSeenAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("candidateAppearances", {
        candidateId, scanId, ownerId,
        statusAtScan: "eligible" as const, labelAtScan: "Worth a look" as const, dispositionAtScan: "new" as const,
      });
      return candidateId;
    };

    const withBrief = async (candidateId: Id<"candidates">, question: string, version = 1) => {
      const note = [{ text: "n", sourceResultIds: [] }];
      await ctx.db.insert("briefVersions", {
        candidateId, scanId, ownerId, version, reportingQuestion: question,
        whySurfaced: "w", confirmedFacts: note, unverifiedClaims: note, conflicts: note,
        existingCoverage: note, potentialHumanSources: note, interviewQuestions: ["q"],
        createdAt: NOW + version,
      });
    };

    const blank = await candidate("");
    await withBrief(blank, "Who signed off on the grant, and when?");

    const edited = await candidate("A question an editor already wrote.");
    await withBrief(edited, "The brief's weaker phrasing.");

    const briefless = await candidate("");

    const versioned = await candidate("");
    await withBrief(versioned, "The first question.", 1);
    await withBrief(versioned, "The revised question.", 2);

    return { scanId, blank, edited, briefless, versioned };
  });
}

const get = (t: ReturnType<typeof setup>, id: Id<"candidates">) =>
  t.run(async (ctx) => (await ctx.db.get(id)) as Doc<"candidates">);

describe("candidates.backfill.reportingQuestionsForScan", () => {
  it("fills a blank question from the brief the newsroom already has", async () => {
    const t = setup();
    const { scanId, blank } = await seed(t);

    const result = await t.mutation(internal.candidates.backfill.reportingQuestionsForScan, { scanId });

    expect((await get(t, blank)).reportingQuestion).toBe("Who signed off on the grant, and when?");
    expect(result).toEqual({ examined: 4, filled: 2, noBrief: 1 });
  });

  it("never overwrites a question that is already there", async () => {
    const t = setup();
    const { scanId, edited } = await seed(t);
    await t.mutation(internal.candidates.backfill.reportingQuestionsForScan, { scanId });
    expect((await get(t, edited)).reportingQuestion).toBe("A question an editor already wrote.");
  });

  it("leaves a candidate with no brief blank, because no question exists to copy", async () => {
    const t = setup();
    const { scanId, briefless } = await seed(t);
    await t.mutation(internal.candidates.backfill.reportingQuestionsForScan, { scanId });
    expect((await get(t, briefless)).reportingQuestion).toBe("");
  });

  it("takes the latest brief version, not the first", async () => {
    const t = setup();
    const { scanId, versioned } = await seed(t);
    await t.mutation(internal.candidates.backfill.reportingQuestionsForScan, { scanId });
    expect((await get(t, versioned)).reportingQuestion).toBe("The revised question.");
  });

  it("is safe to run twice", async () => {
    const t = setup();
    const { scanId, blank } = await seed(t);
    await t.mutation(internal.candidates.backfill.reportingQuestionsForScan, { scanId });
    const second = await t.mutation(internal.candidates.backfill.reportingQuestionsForScan, { scanId });
    expect(second).toEqual({ examined: 4, filled: 0, noBrief: 1 });
    expect((await get(t, blank)).reportingQuestion).toBe("Who signed off on the grant, and when?");
  });
});
