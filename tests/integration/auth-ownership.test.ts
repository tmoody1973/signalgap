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
