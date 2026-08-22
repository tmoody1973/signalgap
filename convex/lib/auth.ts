import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export async function findByClerkId(ctx: QueryCtx | MutationCtx, clerkUserId: string): Promise<Doc<"users"> | null> {
  return ctx.db.query("users").withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId)).unique();
}

export async function currentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return findByClerkId(ctx, identity.subject);
}

export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  const user = await findByClerkId(ctx, identity.subject);
  if (!user) throw new Error("User not bootstrapped");
  return user;
}
