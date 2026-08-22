import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { scanDoc } from "../fixtures/factories";
import { asUser, setup } from "./helpers";

describe("schema validators", () => {
  it("rejects an unknown scan status", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    const aliceId = await alice.mutation(api.users.ensureCurrent, {});
    await expect(
      t.run((ctx) => ctx.db.insert("scans", scanDoc(aliceId, { status: "bogus" }) as never)),
    ).rejects.toThrow();
  });

  it("rejects a candidate with a non-approved label", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    const aliceId = await alice.mutation(api.users.ensureCurrent, {});
    await expect(
      t.run((ctx) => ctx.db.insert("candidates", {
        ownerId: aliceId, fingerprint: "f", currentTitle: "t", reportingQuestion: "q", beat: "housing",
        status: "eligible", primaryLabel: "Definitely true", disposition: "new", latestEvidenceVersion: 1,
        independentCategoryCount: 2, coverageOriginalCount: 0, coveragePassStatus: "complete",
        firstSeenAt: 1, lastSeenAt: 1, updatedAt: 1,
      } as never)),
    ).rejects.toThrow();
  });

  it("rejects a public call with a wrong argument type", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    await alice.mutation(api.users.ensureCurrent, {});
    await expect(alice.query(api.scans.get, { scanId: 42 } as never)).rejects.toThrow();
  });
});
