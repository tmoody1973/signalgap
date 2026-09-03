import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { scanDoc } from "../fixtures/factories";
import { asUser, setup } from "./helpers";

/**
 * Item 9 Part B, the first half: an editor can reject, monitor or assign a
 * lead and leave a note, and the product records who did it and from what.
 * Before this, the lead page's only control was Dark mode.
 */
async function seedLeadFor(t: ReturnType<typeof setup>, clerkUserId: string) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId, createdAt: now, updatedAt: now });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId, { startedAt: now }) as never) as Id<"scans">;
    const candidateId = await ctx.db.insert("candidates", {
      ownerId, fingerprint: "fp", currentTitle: "T", reportingQuestion: "Q?",
      status: "eligible" as const, primaryLabel: "Coverage gap" as const,
      disposition: "new" as const, latestEvidenceVersion: 1,
      independentCategoryCount: 2, coverageOriginalCount: 0, coveragePassStatus: "complete" as const,
      exclusionReasons: [], firstSeenAt: now, lastSeenAt: now, updatedAt: now,
    });
    await ctx.db.insert("candidateAppearances", {
      candidateId, scanId, ownerId,
      statusAtScan: "eligible" as const, labelAtScan: "Coverage gap" as const, dispositionAtScan: "new" as const, rank: 1,
    });
    return { ownerId, scanId, candidateId };
  });
}

const events = (t: ReturnType<typeof setup>, candidateId: Id<"candidates">) =>
  t.run(async (ctx) =>
    await ctx.db.query("editorEvents").withIndex("by_candidate_created", (q) => q.eq("candidateId", candidateId)).collect(),
  );

describe("candidates.disposition.set", () => {
  it("changes the disposition and records who changed it from what", async () => {
    const t = setup();
    const { ownerId, candidateId, scanId } = await seedLeadFor(t, "editor");
    const editor = asUser(t, "editor");

    await editor.mutation(api.candidates.disposition.set, { candidateId, disposition: "assigned", note: "Give to Maria" });

    const candidate = await t.run(async (ctx) => await ctx.db.get(candidateId));
    expect(candidate?.disposition).toBe("assigned");

    const [event] = await events(t, candidateId);
    expect(event).toMatchObject({
      type: "disposition_changed",
      before: { disposition: "new" },
      after: { disposition: "assigned" },
      note: "Give to Maria",
      actorUserId: ownerId,
      scanId,
    });
  });

  it("records a note on its own without touching the disposition", async () => {
    const t = setup();
    const { candidateId } = await seedLeadFor(t, "editor");
    const editor = asUser(t, "editor");

    await editor.mutation(api.candidates.disposition.set, { candidateId, disposition: "new", note: "Ask county about matching funds" });

    expect((await t.run(async (ctx) => await ctx.db.get(candidateId)))?.disposition).toBe("new");
    const [event] = await events(t, candidateId);
    expect(event.type).toBe("note_added");
    expect(event.before).toBeUndefined();
    expect(event.note).toBe("Ask county about matching funds");
  });

  it("writes nothing when nothing changed", async () => {
    const t = setup();
    const { candidateId } = await seedLeadFor(t, "editor");
    const editor = asUser(t, "editor");

    await editor.mutation(api.candidates.disposition.set, { candidateId, disposition: "new", note: "   " });

    expect(await events(t, candidateId)).toHaveLength(0);
  });

  it("refuses another owner's lead", async () => {
    const t = setup();
    const { candidateId } = await seedLeadFor(t, "editor");
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", { clerkUserId: "stranger", createdAt: now, updatedAt: now });
    });

    await expect(
      asUser(t, "stranger").mutation(api.candidates.disposition.set, { candidateId, disposition: "rejected" }),
    ).rejects.toThrow(/Lead not found/);
    expect((await t.run(async (ctx) => await ctx.db.get(candidateId)))?.disposition).toBe("new");
  });

  it("refuses anonymous callers", async () => {
    const t = setup();
    const { candidateId } = await seedLeadFor(t, "editor");
    await expect(t.mutation(api.candidates.disposition.set, { candidateId, disposition: "rejected" })).rejects.toThrow(/Unauthenticated/);
  });

  it("writes only disposition and updatedAt, never the rules engine's columns", async () => {
    const t = setup();
    const { candidateId } = await seedLeadFor(t, "editor");
    const editor = asUser(t, "editor");

    const before = await t.run(async (ctx) => await ctx.db.get(candidateId));

    await editor.mutation(api.candidates.disposition.set, { candidateId, disposition: "rejected", note: "Checking this out" });

    const after = await t.run(async (ctx) => await ctx.db.get(candidateId));
    expect(after?.disposition).not.toBe(before?.disposition);

    const omit = (doc: NonNullable<typeof before>) => {
      const rest: Record<string, unknown> = { ...doc };
      delete rest.disposition;
      delete rest.updatedAt;
      return rest;
    };
    expect(omit(after as NonNullable<typeof after>)).toEqual(omit(before as NonNullable<typeof before>));
  });
});
