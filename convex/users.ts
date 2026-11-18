import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import { getViewer, requireAdmin, roleFor } from "./lib/auth";

// Called by the client right after sign-in. Creates the user row, or refreshes name and role.
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to continue.");
    const name = (identity.givenName ?? identity.name ?? "Neighbor").slice(0, 60);
    const role = roleFor(identity.email, identity.emailVerified);
    const existing = await getViewer(ctx);
    if (existing) {
      if (existing.name !== name || existing.role !== role) await ctx.db.patch(existing._id, { name, role });
      return existing._id;
    }
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      clerkUserId: identity.subject,
      name,
      role,
      trusted: false,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    return viewer && { _id: viewer._id, name: viewer.name, role: viewer.role, trusted: viewer.trusted };
  },
});

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    await requireAdmin(ctx);
    const page = await ctx.db.query("users").order("desc").paginate(paginationOpts);
    return {
      ...page,
      page: page.page.map((u) => ({ _id: u._id, name: u.name, role: u.role, trusted: u.trusted })),
    };
  },
});

export const setTrusted = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get(userId))) throw new ConvexError("User not found.");
    await ctx.db.patch(userId, { trusted });
  },
});
