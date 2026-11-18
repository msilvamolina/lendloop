import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./lib/auth";
import { daysBetween } from "./lib/rules";

const OVERDUE_PAGE_SIZE = 50;

export const reminderKey = (loanId: Id<"loans">, asOf: string) => `reminder:${loanId}:${asOf}`;

function findByKey(ctx: QueryCtx | MutationCtx, idempotencyKey: string) {
  return ctx.db
    .query("automationEvents")
    .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
    .first();
}

// What the daily n8n run needs per overdue loan, and nothing else (no emails, no lender identity).
export const overduePage = internalQuery({
  args: { asOf: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { asOf, cursor }) => {
    const page = await ctx.db
      .query("loans")
      .withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", asOf))
      .paginate({ cursor, numItems: OVERDUE_PAGE_SIZE });
    const loans = [];
    for (const loan of page.page) {
      // Already reminded for this day (sent, or a failure n8n reported): a re-run must not remind twice.
      const done = await findByKey(ctx, reminderKey(loan._id, asOf));
      if (done && done.status === "sent") continue;
      const borrower = await ctx.db.get(loan.borrowerId);
      loans.push({
        loanId: loan._id,
        toolName: loan.toolName,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, asOf),
        borrower: { userId: loan.borrowerId, firstName: borrower?.name ?? "Neighbor" },
      });
    }
    return { loans, cursor: page.continueCursor, isDone: page.isDone };
  },
});

// Idempotent on (loan, day): n8n retries and re-runs land on the same row instead of creating a new one.
export const recordReminder = internalMutation({
  args: {
    loanId: v.id("loans"),
    asOf: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { loanId, asOf, status, detail }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan) return { result: "unknown_loan" as const };
    const idempotencyKey = reminderKey(loanId, asOf);
    const existing = await findByKey(ctx, idempotencyKey);
    const now = Date.now();
    if (existing) {
      // Only an upgrade from failed to sent changes anything; everything else is a harmless duplicate.
      if (existing.status === "sent" || status === "failed") return { result: "duplicate" as const };
      await ctx.db.patch(existing._id, { status, detail, attempts: existing.attempts + 1, updatedAt: now });
    } else {
      await ctx.db.insert("automationEvents", {
        kind: "reminder",
        status,
        idempotencyKey,
        loanId,
        attempts: 1,
        detail,
        updatedAt: now,
      });
    }
    await ctx.db.patch(loanId, { lastAutomation: { kind: "reminder", status, at: now } });
    return { result: "recorded" as const };
  },
});

// Reported by the n8n error workflow, so failed runs show up in the app and not only in n8n.
export const recordWorkflowError = internalMutation({
  args: { executionId: v.string(), workflowName: v.string(), nodeName: v.string(), message: v.string() },
  handler: async (ctx, { executionId, workflowName, nodeName, message }) => {
    const idempotencyKey = `n8n-error:${executionId}`;
    if (await findByKey(ctx, idempotencyKey)) return { result: "duplicate" as const };
    await ctx.db.insert("automationEvents", {
      kind: "workflow_error",
      status: "failed",
      idempotencyKey,
      attempts: 1,
      detail: `${workflowName} / ${nodeName}: ${message}`.slice(0, 500),
      updatedAt: Date.now(),
    });
    return { result: "recorded" as const };
  },
});

export const log = query({
  args: { paginationOpts: paginationOptsValidator, onlyFailed: v.boolean() },
  handler: async (ctx, { paginationOpts, onlyFailed }) => {
    await requireAdmin(ctx);
    const events = onlyFailed
      ? ctx.db.query("automationEvents").withIndex("by_status", (q) => q.eq("status", "failed"))
      : ctx.db.query("automationEvents");
    return await events.order("desc").paginate(paginationOpts);
  },
});
