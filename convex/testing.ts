import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// ponytail: CLI-only reset for e2e; internal so browsers cannot call it.
export const deleteScansForClerkUser = internalMutation({
  args: { clerkUserId: v.string() },
  returns: v.number(),
  handler: async (ctx, { clerkUserId }) => {
    const user = await ctx.db.query("users").withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId)).unique();
    if (!user) return 0;
    const scans = await ctx.db.query("scans").withIndex("by_owner_started", (q) => q.eq("ownerId", user._id)).collect();
    for (const s of scans) await ctx.db.delete(s._id);
    return scans.length;
  },
});
