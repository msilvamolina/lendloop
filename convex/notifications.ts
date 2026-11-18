import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { sign, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./lib/hmac";

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000;

// Transactional outbox: the event row and the scheduled delivery commit together with the loan change,
// so a status change can never happen without its notification being queued (and vice versa).
export async function notifyLoanChange(ctx: MutationCtx, loan: Doc<"loans">) {
  const idempotencyKey = `notify:${loan._id}:${loan.status}`;
  const existing = await ctx.db
    .query("automationEvents")
    .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
    .first();
  if (existing) return;
  const eventId = await ctx.db.insert("automationEvents", {
    kind: "notification",
    status: "pending",
    idempotencyKey,
    loanId: loan._id,
    loanStatus: loan.status,
    attempts: 0,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { eventId });
}

// Builds the minimal payload n8n needs to notify one person. No emails, no owner/borrower pairing, no descriptions.
export const loadDelivery = internalQuery({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || !event.loanId || !event.loanStatus || event.status !== "pending") return null;
    const loan = await ctx.db.get(event.loanId);
    if (!loan) return null;
    // The borrower's own actions (request, cancel) notify the lender; the lender's decisions notify the borrower.
    const toLender = event.loanStatus === "requested" || event.loanStatus === "cancelled";
    const recipientId = toLender ? loan.ownerId : loan.borrowerId;
    const recipient = await ctx.db.get(recipientId);
    return {
      attempts: event.attempts,
      payload: {
        eventId: event.idempotencyKey,
        type: `loan.${event.loanStatus}`,
        occurredAt: new Date(event._creationTime).toISOString(),
        loan: { id: loan._id, toolName: loan.toolName, startDate: loan.startDate, endDate: loan.endDate },
        recipient: { userId: recipientId, firstName: recipient?.name ?? "Neighbor" },
      },
    };
  },
});

export const deliver = internalAction({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const delivery = await ctx.runQuery(internal.notifications.loadDelivery, { eventId });
    if (!delivery) return; // already sent, or the loan disappeared
    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.notifications.recordAttempt, {
        eventId,
        ok: false,
        retryInMs: null,
        detail: "N8N_WEBHOOK_URL or N8N_WEBHOOK_SECRET is not set on the Convex deployment",
      });
      return;
    }

    const body = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    let detail: string;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: await sign(secret, timestamp, body),
          "x-lendloop-event-id": delivery.payload.eventId,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        await ctx.runMutation(internal.notifications.recordAttempt, { eventId, ok: true, retryInMs: null });
        return;
      }
      detail = `n8n answered HTTP ${res.status}`;
    } catch (error) {
      detail = `request failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    const attempt = delivery.attempts + 1;
    const retryInMs = attempt < MAX_ATTEMPTS ? BASE_BACKOFF_MS * 2 ** (attempt - 1) : null;
    await ctx.runMutation(internal.notifications.recordAttempt, { eventId, ok: false, retryInMs, detail });
  },
});

export const recordAttempt = internalMutation({
  args: {
    eventId: v.id("automationEvents"),
    ok: v.boolean(),
    retryInMs: v.union(v.number(), v.null()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, ok, retryInMs, detail }) => {
    const event = await ctx.db.get(eventId);
    if (!event) return;
    const status = ok ? "sent" : retryInMs === null ? "failed" : "pending";
    const now = Date.now();
    await ctx.db.patch(eventId, { status, attempts: event.attempts + 1, detail, updatedAt: now });
    if (retryInMs !== null) await ctx.scheduler.runAfter(retryInMs, internal.notifications.deliver, { eventId });
    if (event.loanId && status !== "pending") {
      await ctx.db.patch(event.loanId, { lastAutomation: { kind: "notification", status, at: now } });
    }
  },
});
