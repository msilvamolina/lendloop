import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "./lib/hmac";
import { daysBetween, isIsoDate, todayUtc } from "./lib/rules";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Every n8n -> Convex call goes through here: HMAC over the raw body, replay window, then a JSON object.
function signedRoute(handler: (ctx: ActionCtx, body: Record<string, unknown>) => Promise<Response>) {
  return httpAction(async (ctx, req) => {
    const raw = await req.text();
    const check = await verify({
      secret: process.env.N8N_INBOUND_SECRET,
      timestamp: req.headers.get(TIMESTAMP_HEADER),
      signature: req.headers.get(SIGNATURE_HEADER),
      body: raw,
    });
    if (!check.ok) {
      console.warn(`Rejected n8n call to ${new URL(req.url).pathname}: ${check.reason}`);
      return json(401, { error: "unauthorized" }); // no detail to the caller on purpose
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: "body must be JSON" });
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return json(400, { error: "body must be an object" });
    return handler(ctx, body as Record<string, unknown>);
  });
}

const str = (value: unknown, max = 200) => (typeof value === "string" && value.length <= max ? value : null);

// n8n may only act on yesterday/today/tomorrow (UTC), so a leaked old request cannot backfill arbitrary days.
const validAsOf = (value: unknown) => {
  const asOf = str(value, 10);
  return asOf && isIsoDate(asOf) && Math.abs(daysBetween(todayUtc(), asOf)) <= 1 ? asOf : null;
};

const http = httpRouter();

http.route({
  path: "/n8n/overdue-loans",
  method: "POST",
  handler: signedRoute(async (ctx, body) => {
    const asOf = validAsOf(body.asOf);
    if (!asOf) return json(400, { error: "asOf must be today's date (YYYY-MM-DD)" });
    const cursor = body.cursor == null ? null : str(body.cursor, 2000);
    if (body.cursor != null && cursor === null) return json(400, { error: "invalid cursor" });
    return json(200, await ctx.runQuery(internal.automation.overduePage, { asOf, cursor }));
  }),
});

http.route({
  path: "/n8n/reminder-status",
  method: "POST",
  handler: signedRoute(async (ctx, body) => {
    const asOf = validAsOf(body.asOf);
    const loanId = str(body.loanId, 64);
    const status = body.status === "sent" || body.status === "failed" ? body.status : null;
    if (!asOf || !loanId || !status) return json(400, { error: "expected { loanId, asOf, status: sent|failed }" });
    const detail = str(body.detail, 500) ?? undefined;
    const result = await ctx.runMutation(internal.automation.recordReminder, {
      loanId: loanId as Id<"loans">, // re-validated by the mutation's v.id("loans") validator
      asOf,
      status,
      detail,
    });
    return json(result.result === "unknown_loan" ? 404 : 200, result);
  }),
});

http.route({
  path: "/n8n/workflow-error",
  method: "POST",
  handler: signedRoute(async (ctx, body) => {
    const executionId = str(body.executionId, 100);
    const workflowName = str(body.workflowName) ?? "unknown workflow";
    const nodeName = str(body.nodeName) ?? "unknown node";
    const message = typeof body.message === "string" ? body.message.slice(0, 400) : "no message";
    if (!executionId) return json(400, { error: "executionId is required" });
    return json(200, await ctx.runMutation(internal.automation.recordWorkflowError, { executionId, workflowName, nodeName, message }));
  }),
});

export default http;
