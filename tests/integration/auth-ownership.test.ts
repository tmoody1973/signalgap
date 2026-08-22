import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { asUser, setup } from "./helpers";

describe("users.ensureCurrent", () => {
  it("rejects anonymous callers", async () => {
    const t = setup();
    await expect(t.mutation(api.users.ensureCurrent, {})).rejects.toThrow(/Unauthenticated/);
  });

  it("creates one user per Clerk subject and is idempotent", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    const first = await alice.mutation(api.users.ensureCurrent, {});
    const second = await alice.mutation(api.users.ensureCurrent, {});
    expect(first).toBe(second);
    const me = await alice.query(api.users.me, {});
    expect(me?._id).toBe(first);
  });

  it("returns null for a user who has not bootstrapped", async () => {
    const t = setup();
    expect(await asUser(t, "bob").query(api.users.me, {})).toBeNull();
  });
});

describe("scans ownership", () => {
  it("starts a queued scan for the owner only", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    await alice.mutation(api.users.ensureCurrent, {});
    const scanId = await alice.mutation(api.scans.startScan, {});
    const scan = await alice.query(api.scans.get, { scanId });
    expect(scan?.status).toBe("queued");
    expect(scan?.searchBudgetLimit).toBe(120);

    const bob = asUser(t, "bob");
    await bob.mutation(api.users.ensureCurrent, {});
    expect(await bob.query(api.scans.get, { scanId })).toBeNull();
    expect(await bob.query(api.scans.list, {})).toEqual([]);
    await expect(bob.mutation(api.scans.cancel, { scanId })).rejects.toThrow(/not found/i);
  });

  it("refuses a second active scan", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    await alice.mutation(api.users.ensureCurrent, {});
    await alice.mutation(api.scans.startScan, {});
    await expect(alice.mutation(api.scans.startScan, {})).rejects.toThrow(/already running/);
  });

  it("cancel records cancelRequestedAt and moves queued to canceled", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    await alice.mutation(api.users.ensureCurrent, {});
    const scanId = await alice.mutation(api.scans.startScan, {});
    await alice.mutation(api.scans.cancel, { scanId });
    const scan = await alice.query(api.scans.get, { scanId });
    expect(scan?.status).toBe("canceled");
    expect(scan?.cancelRequestedAt).toBeTypeOf("number");
  });
});
