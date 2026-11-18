import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const vCategory = v.union(
  v.literal("power-tools"),
  v.literal("hand-tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("cleaning"),
  v.literal("other"),
);
export const vCondition = v.union(v.literal("like-new"), v.literal("good"), v.literal("fair"), v.literal("worn"));
export const vLoanStatus = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);

export default defineSchema({
  // One row per Clerk user. No email stored: it is only read from the JWT to decide the admin role.
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
    trusted: v.boolean(),
  }).index("by_token", ["tokenIdentifier"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: vCategory,
    condition: vCondition,
    description: v.string(),
    // Soft delete keeps loan history readable after a listing is removed.
    removed: v.boolean(),
  })
    .index("by_removed", ["removed"])
    .index("by_removed_category", ["removed", "category"])
    .index("by_owner", ["ownerId", "removed"]),

  loans: defineTable({
    toolId: v.id("tools"),
    toolName: v.string(),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    // ISO calendar dates (YYYY-MM-DD), inclusive on both ends.
    startDate: v.string(),
    endDate: v.string(),
    status: vLoanStatus,
    // Denormalized so each loan card can show "Reminder sent 2 days ago" without another query.
    lastAutomation: v.optional(
      v.object({ kind: v.string(), status: v.string(), at: v.number() }),
    ),
  })
    .index("by_borrower", ["borrowerId"])
    .index("by_owner", ["ownerId"])
    .index("by_tool_status_start", ["toolId", "status", "startDate"])
    .index("by_status_end", ["status", "endDate"]),

  // Outbox + audit trail for everything that crosses the n8n boundary, in both directions.
  automationEvents: defineTable({
    kind: v.union(v.literal("notification"), v.literal("reminder"), v.literal("workflow_error")),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    idempotencyKey: v.string(),
    loanId: v.optional(v.id("loans")),
    // The loan status this notification announces (the loan may have moved on by delivery time).
    loanStatus: v.optional(vLoanStatus),
    attempts: v.number(),
    detail: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_status", ["status"]),
});
