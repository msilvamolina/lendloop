import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

// The single entry point every public query/mutation uses to learn who is calling.
// Identity comes from the Clerk JWT that Convex has already verified (auth.config.ts); the role comes from our own
// users table, never from the client.
export async function getViewer(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireViewer(ctx: QueryCtx): Promise<Doc<"users">> {
  const viewer = await getViewer(ctx);
  if (!viewer) throw new ConvexError("Sign in to continue.");
  return viewer;
}

export async function requireAdmin(ctx: QueryCtx): Promise<Doc<"users">> {
  const viewer = await requireViewer(ctx);
  if (viewer.role !== "admin") throw new ConvexError("Admins only.");
  return viewer;
}

// Admin bootstrap: a verified email listed in the ADMIN_EMAILS deployment env var (comma separated).
export function roleFor(email: string | undefined, emailVerified: boolean | undefined, adminEmails = process.env.ADMIN_EMAILS) {
  if (!email || emailVerified !== true || !adminEmails) return "user" as const;
  const admins = adminEmails.split(",").map((e) => e.trim().toLowerCase());
  return admins.includes(email.toLowerCase()) ? ("admin" as const) : ("user" as const);
}
