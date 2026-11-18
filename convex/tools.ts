import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireViewer } from "./lib/auth";
import { canManageTool, todayUtc } from "./lib/rules";
import { vCategory, vCondition } from "./schema";
import { notifyLoanChange } from "./notifications";

function cleanText(value: string, field: string, max: number, required = true) {
  const trimmed = value.trim();
  if (required && !trimmed) throw new ConvexError(`${field} is required.`);
  if (trimmed.length > max) throw new ConvexError(`${field} must be at most ${max} characters.`);
  return trimmed;
}

function activeTools(ctx: QueryCtx, category: Doc<"tools">["category"] | undefined) {
  return category
    ? ctx.db.query("tools").withIndex("by_removed_category", (q) => q.eq("removed", false).eq("category", category))
    : ctx.db.query("tools").withIndex("by_removed", (q) => q.eq("removed", false));
}

// Approved loans on one tool never overlap, so the latest one starting on or before today is the only candidate.
async function currentLoan(ctx: QueryCtx, toolId: Id<"tools">) {
  const today = todayUtc();
  const loan = await ctx.db
    .query("loans")
    .withIndex("by_tool_status_start", (q) => q.eq("toolId", toolId).eq("status", "approved").lte("startDate", today))
    .order("desc")
    .first();
  return loan && loan.endDate >= today ? loan : null;
}

// Public landing page: name and category only. No owner, condition or availability leaves the server.
export const listPublic = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await activeTools(ctx, undefined).order("desc").paginate(paginationOpts);
    return { ...page, page: page.page.map((t) => ({ _id: t._id, name: t.name, category: t.category })) };
  },
});

export const list = query({
  args: { paginationOpts: paginationOptsValidator, category: v.optional(vCategory) },
  handler: async (ctx, { paginationOpts, category }) => {
    const viewer = await requireViewer(ctx);
    const page = await activeTools(ctx, category).order("desc").paginate(paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (tool) => {
          const owner = await ctx.db.get(tool.ownerId);
          const loan = await currentLoan(ctx, tool._id);
          return {
            _id: tool._id,
            name: tool.name,
            category: tool.category,
            condition: tool.condition,
            description: tool.description,
            ownerName: owner?.name ?? "Neighbor",
            ownerTrusted: owner?.trusted ?? false,
            isMine: tool.ownerId === viewer._id,
            availableAgain: loan ? loan.endDate : null,
          };
        }),
      ),
    };
  },
});

export const mine = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const viewer = await requireViewer(ctx);
    const page = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id).eq("removed", false))
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (tool) => {
          const loan = await currentLoan(ctx, tool._id);
          return { ...tool, availableAgain: loan ? loan.endDate : null };
        }),
      ),
    };
  },
});

const toolFields = { name: v.string(), category: vCategory, condition: vCondition, description: v.string() };

function cleanTool(args: { name: string; category: Doc<"tools">["category"]; condition: Doc<"tools">["condition"]; description: string }) {
  return {
    name: cleanText(args.name, "Name", 80),
    category: args.category,
    condition: args.condition,
    description: cleanText(args.description, "Description", 500, false),
  };
}

export const create = mutation({
  args: toolFields,
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    return await ctx.db.insert("tools", { ...cleanTool(args), ownerId: viewer._id, removed: false });
  },
});

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...args }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.removed) throw new ConvexError("Listing not found.");
    if (!canManageTool(viewer, tool, "edit")) throw new ConvexError("You can only edit your own listings.");
    await ctx.db.patch(toolId, cleanTool(args));
  },
});

// Owners delete their own listings; admins can remove any. Open requests are declined so borrowers hear about it.
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.removed) throw new ConvexError("Listing not found.");
    if (!canManageTool(viewer, tool, "remove")) throw new ConvexError("You can only remove your own listings.");
    const isOwner = tool.ownerId === viewer._id;
    if (isOwner && (await currentLoan(ctx, toolId))) {
      throw new ConvexError("This tool is lent out right now. Mark it returned first.");
    }
    await ctx.db.patch(toolId, { removed: true });
    // Not for display: the open requests on one tool are few, and every one must be declined.
    const open = await ctx.db
      .query("loans")
      .withIndex("by_tool_status_start", (q) => q.eq("toolId", toolId).eq("status", "requested"))
      .collect();
    for (const loan of open) {
      await ctx.db.patch(loan._id, { status: "declined" });
      await notifyLoanChange(ctx, { ...loan, status: "declined" });
    }
  },
});
