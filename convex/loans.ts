import { ConvexError, v } from "convex/values";
import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin, requireViewer } from "./lib/auth";
import { nextLoanStatus, overlaps, todayUtc, validateRange } from "./lib/rules";
import { notifyLoanChange } from "./notifications";

async function hasApprovedOverlap(ctx: QueryCtx, loan: Pick<Doc<"loans">, "toolId" | "startDate" | "endDate">) {
  // Approved loans on this tool that start on or before our end date; only those can overlap.
  const candidates = ctx.db
    .query("loans")
    .withIndex("by_tool_status_start", (q) =>
      q.eq("toolId", loan.toolId).eq("status", "approved").lte("startDate", loan.endDate),
    )
    .order("desc");
  for await (const other of candidates) {
    if (overlaps(other, loan)) return true;
    // Approved loans never overlap each other, so once one ends before our start, all earlier ones do too.
    if (other.endDate < loan.startDate) return false;
  }
  return false;
}

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.removed) throw new ConvexError("Listing not found.");
    if (tool.ownerId === viewer._id) throw new ConvexError("You cannot borrow your own tool.");
    const error = validateRange(startDate, endDate, todayUtc());
    if (error) throw new ConvexError(error);
    if (await hasApprovedOverlap(ctx, { toolId, startDate, endDate })) {
      throw new ConvexError("The tool is already lent out on some of those days.");
    }
    const loanId = await ctx.db.insert("loans", {
      toolId,
      toolName: tool.name,
      ownerId: tool.ownerId,
      borrowerId: viewer._id,
      startDate,
      endDate,
      status: "requested",
    });
    await notifyLoanChange(ctx, (await ctx.db.get(loanId))!);
    return loanId;
  },
});

export const act = mutation({
  args: {
    loanId: v.id("loans"),
    action: v.union(v.literal("approve"), v.literal("decline"), v.literal("markReturned"), v.literal("cancel")),
  },
  handler: async (ctx, { loanId, action }) => {
    const viewer = await requireViewer(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new ConvexError("Request not found.");
    const next = nextLoanStatus(viewer, loan, action);
    if (!next.ok) throw new ConvexError(next.error);
    // Re-check at approval time: another request for the same days may have been approved since this one was made.
    if (action === "approve" && (await hasApprovedOverlap(ctx, loan))) {
      throw new ConvexError("You already approved another loan for some of those days.");
    }
    await ctx.db.patch(loanId, { status: next.status });
    await notifyLoanChange(ctx, { ...loan, status: next.status });
  },
});

async function withNames(ctx: QueryCtx, page: PaginationResult<Doc<"loans">>) {
  const today = todayUtc();
  return {
    ...page,
    page: await Promise.all(
      page.page.map(async (loan) => {
        const [owner, borrower] = await Promise.all([ctx.db.get(loan.ownerId), ctx.db.get(loan.borrowerId)]);
        return {
          _id: loan._id,
          _creationTime: loan._creationTime,
          toolName: loan.toolName,
          startDate: loan.startDate,
          endDate: loan.endDate,
          status: loan.status,
          overdue: loan.status === "approved" && loan.endDate < today,
          lastAutomation: loan.lastAutomation ?? null,
          ownerName: owner?.name ?? "Neighbor",
          borrowerName: borrower?.name ?? "Neighbor",
        };
      }),
    ),
  };
}

export const myRequests = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const viewer = await requireViewer(ctx);
    const page = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .order("desc")
      .paginate(paginationOpts);
    return withNames(ctx, page);
  },
});

export const incoming = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const viewer = await requireViewer(ctx);
    const page = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .paginate(paginationOpts);
    return withNames(ctx, page);
  },
});

export const all = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    await requireAdmin(ctx);
    return withNames(ctx, await ctx.db.query("loans").order("desc").paginate(paginationOpts));
  },
});
