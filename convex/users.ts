import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { currentUser, findByClerkId } from "./lib/auth";

export const ensureCurrent = mutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const now = Date.now();
    const existing = await findByClerkId(ctx, identity.subject);
    if (existing) {
      await ctx.db.patch(existing._id, { email: identity.email, displayName: identity.name, updatedAt: now });
      return existing._id;
    }
    return ctx.db.insert("users", { clerkUserId: identity.subject, email: identity.email, displayName: identity.name, createdAt: now, updatedAt: now });
  },
});

export const me = query({
  args: {},
  returns: v.union(v.null(), v.object({ _id: v.id("users"), displayName: v.optional(v.string()), email: v.optional(v.string()) })),
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    return user ? { _id: user._id, displayName: user.displayName, email: user.email } : null;
  },
});
