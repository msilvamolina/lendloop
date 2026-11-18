/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { sign } from "../convex/lib/hmac";
import { todayUtc } from "../convex/lib/rules";

const modules = import.meta.glob("../convex/**/*.ts");
const INBOUND_SECRET = "inbound-test-secret";

function addDays(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

async function setup() {
  const t = convexTest(schema, modules);
  const as = (name: string, email: string) => t.withIdentity({ name, givenName: name, email, emailVerified: true, subject: name });
  const ana = as("Ana", "ana@example.com");
  const bo = as("Bo", "bo@example.com");
  const cy = as("Cy", "cy@example.com");
  const admin = as("Ada", "admin@example.com");
  for (const user of [ana, bo, cy, admin]) await user.mutation(api.users.ensure, {});
  const toolId = await ana.mutation(api.tools.create, {
    name: "Ladder",
    category: "hand-tools",
    condition: "good",
    description: "6 ft",
  });
  return { t, ana, bo, cy, admin, toolId };
}

async function signedPost(t: ReturnType<typeof convexTest>, path: string, payload: unknown, secret = INBOUND_SECRET) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return t.fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lendloop-timestamp": timestamp,
      "x-lendloop-signature": await sign(secret, timestamp, body),
    },
    body,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  vi.stubEnv("N8N_INBOUND_SECRET", INBOUND_SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("RBAC enforced in Convex functions", () => {
  test("roles come from ADMIN_EMAILS, not the client", async () => {
    const { ana, admin } = await setup();
    expect((await ana.query(api.users.me, {}))?.role).toBe("user");
    expect((await admin.query(api.users.me, {}))?.role).toBe("admin");
  });

  test("users cannot edit or delete someone else's listing; admins can remove but not edit", async () => {
    const { bo, admin, toolId } = await setup();
    const edit = { toolId, name: "Mine now", category: "garden" as const, condition: "worn" as const, description: "" };
    await expect(bo.mutation(api.tools.update, edit)).rejects.toThrow(/only edit your own/);
    await expect(bo.mutation(api.tools.remove, { toolId })).rejects.toThrow(/only remove your own/);
    await expect(admin.mutation(api.tools.update, edit)).rejects.toThrow(/only edit your own/);
    await admin.mutation(api.tools.remove, { toolId });
  });

  test("admin-only queries and mutations reject regular users and anonymous callers", async () => {
    const { t, bo } = await setup();
    const paginationOpts = { numItems: 10, cursor: null };
    await expect(bo.query(api.loans.all, { paginationOpts })).rejects.toThrow(/Admins only/);
    await expect(bo.query(api.automation.log, { paginationOpts, onlyFailed: false })).rejects.toThrow(/Admins only/);
    const boId = (await bo.query(api.users.me, {}))!._id;
    await expect(bo.mutation(api.users.setTrusted, { userId: boId, trusted: true })).rejects.toThrow(/Admins only/);
    await expect(t.query(api.tools.list, { paginationOpts })).rejects.toThrow(/Sign in/);
  });

  test("only the lender approves; only the borrower cancels; strangers do nothing", async () => {
    const { ana, bo, cy, toolId } = await setup();
    const start = addDays(todayUtc(), 2);
    const loanId = await bo.mutation(api.loans.request, { toolId, startDate: start, endDate: addDays(start, 2) });
    await expect(bo.mutation(api.loans.act, { loanId, action: "approve" })).rejects.toThrow(/not allowed/);
    await expect(cy.mutation(api.loans.act, { loanId, action: "cancel" })).rejects.toThrow(/not allowed/);
    await ana.mutation(api.loans.act, { loanId, action: "approve" });
    await expect(ana.mutation(api.loans.act, { loanId, action: "approve" })).rejects.toThrow(/already approved/);
  });

  test("the public list exposes name and category only", async () => {
    const { t } = await setup();
    const { page } = await t.query(api.tools.listPublic, { paginationOpts: { numItems: 10, cursor: null } });
    expect(Object.keys(page[0]).sort()).toEqual(["_id", "category", "name"]);
  });
});

describe("date overlap", () => {
  test("requests overlapping an approved loan are rejected, and approval re-checks", async () => {
    const { ana, bo, cy, toolId } = await setup();
    const start = addDays(todayUtc(), 3);
    const first = await bo.mutation(api.loans.request, { toolId, startDate: start, endDate: addDays(start, 3) });
    const second = await cy.mutation(api.loans.request, { toolId, startDate: addDays(start, 2), endDate: addDays(start, 5) });
    await ana.mutation(api.loans.act, { loanId: first, action: "approve" });
    await expect(ana.mutation(api.loans.act, { loanId: second, action: "approve" })).rejects.toThrow(/already approved another/);
    await expect(
      cy.mutation(api.loans.request, { toolId, startDate: addDays(start, 3), endDate: addDays(start, 4) }),
    ).rejects.toThrow(/already lent out/);
    // The day after the approved loan ends is free.
    await cy.mutation(api.loans.request, { toolId, startDate: addDays(start, 4), endDate: addDays(start, 5) });
  });
});

describe("n8n integration", () => {
  async function overdueLoan() {
    const ctx = await setup();
    const { t, toolId, bo } = ctx;
    const loanId = await t.run(async (db) => {
      const borrower = (await bo.query(api.users.me, {}))!;
      const tool = (await db.db.get(toolId))!;
      return db.db.insert("loans", {
        toolId,
        toolName: tool.name,
        ownerId: tool.ownerId,
        borrowerId: borrower._id,
        startDate: addDays(todayUtc(), -5),
        endDate: addDays(todayUtc(), -2),
        status: "approved",
      });
    });
    return { ...ctx, loanId };
  }

  test("unsigned, badly signed and stale calls are rejected", async () => {
    const { t } = await setup();
    const asOf = todayUtc();
    expect((await t.fetch("/n8n/overdue-loans", { method: "POST", body: JSON.stringify({ asOf }) })).status).toBe(401);
    expect((await signedPost(t, "/n8n/overdue-loans", { asOf }, "wrong-secret")).status).toBe(401);
    const body = JSON.stringify({ asOf });
    const old = String(Math.floor(Date.now() / 1000) - 600);
    const stale = await t.fetch("/n8n/overdue-loans", {
      method: "POST",
      headers: { "x-lendloop-timestamp": old, "x-lendloop-signature": await sign(INBOUND_SECRET, old, body) },
      body,
    });
    expect(stale.status).toBe(401);
  });

  test("overdue endpoint returns only the fields n8n needs", async () => {
    const { t, loanId } = await overdueLoan();
    const res = await signedPost(t, "/n8n/overdue-loans", { asOf: todayUtc(), cursor: null });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isDone).toBe(true);
    expect(data.loans).toEqual([
      expect.objectContaining({ loanId, toolName: "Ladder", daysOverdue: 2, borrower: expect.objectContaining({ firstName: "Bo" }) }),
    ]);
    expect(JSON.stringify(data)).not.toMatch(/@/); // no email addresses
  });

  test("reminder write-back is idempotent per loan and day", async () => {
    const { t, admin, loanId } = await overdueLoan();
    const asOf = todayUtc();
    const first = await signedPost(t, "/n8n/reminder-status", { loanId, asOf, status: "sent" });
    const retry = await signedPost(t, "/n8n/reminder-status", { loanId, asOf, status: "sent" });
    expect(await first.json()).toEqual({ result: "recorded" });
    expect(await retry.json()).toEqual({ result: "duplicate" });

    const log = await admin.query(api.automation.log, { paginationOpts: { numItems: 50, cursor: null }, onlyFailed: false });
    expect(log.page.filter((e) => e.kind === "reminder")).toHaveLength(1);
    const loan = await t.run((ctx) => ctx.db.get(loanId));
    expect(loan?.lastAutomation).toMatchObject({ kind: "reminder", status: "sent" });

    // Once reminded today, a re-run of the workflow does not get the loan again.
    const again = await (await signedPost(t, "/n8n/overdue-loans", { asOf })).json();
    expect(again.loans).toEqual([]);
  });

  test("a failed reminder can be upgraded to sent by a later retry, never the other way", async () => {
    const { t, loanId } = await overdueLoan();
    const asOf = todayUtc();
    await signedPost(t, "/n8n/reminder-status", { loanId, asOf, status: "failed", detail: "smtp down" });
    expect(await (await signedPost(t, "/n8n/reminder-status", { loanId, asOf, status: "sent" })).json()).toEqual({ result: "recorded" });
    expect(await (await signedPost(t, "/n8n/reminder-status", { loanId, asOf, status: "failed" })).json()).toEqual({ result: "duplicate" });
  });

  test("write-backs for other days are refused", async () => {
    const { t, loanId } = await overdueLoan();
    const res = await signedPost(t, "/n8n/reminder-status", { loanId, asOf: "2020-01-01", status: "sent" });
    expect(res.status).toBe(400);
  });

  test("error workflow reports are stored once per execution", async () => {
    const { t, admin } = await setup();
    const report = { executionId: "42", workflowName: "Overdue reminders", nodeName: "Fetch", message: "timeout" };
    expect(await (await signedPost(t, "/n8n/workflow-error", report)).json()).toEqual({ result: "recorded" });
    expect(await (await signedPost(t, "/n8n/workflow-error", report)).json()).toEqual({ result: "duplicate" });
    const failed = await admin.query(api.automation.log, { paginationOpts: { numItems: 10, cursor: null }, onlyFailed: true });
    expect(failed.page).toHaveLength(1);
  });

  test("status changes queue one notification each, and an unconfigured webhook fails visibly", async () => {
    const { t, admin, bo, toolId } = await setup();
    const start = addDays(todayUtc(), 1);
    const loanId = await bo.mutation(api.loans.request, { toolId, startDate: start, endDate: start });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const log = await admin.query(api.automation.log, { paginationOpts: { numItems: 10, cursor: null }, onlyFailed: false });
    expect(log.page).toHaveLength(1);
    expect(log.page[0]).toMatchObject({ kind: "notification", status: "failed", idempotencyKey: `notify:${loanId}:requested` });
    expect(log.page[0].detail).toMatch(/N8N_WEBHOOK_URL/);
  });

  test("webhook delivery is signed and retried with backoff until n8n accepts it", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "https://n8n.test/webhook/lendloop");
    vi.stubEnv("N8N_WEBHOOK_SECRET", "outbound-secret");
    const calls: { headers: Headers; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push({ headers: new Headers(init.headers), body: String(init.body) });
        return new Response(null, { status: calls.length === 1 ? 503 : 200 });
      }),
    );
    const { t, admin, bo, toolId } = await setup();
    const start = addDays(todayUtc(), 1);
    await bo.mutation(api.loans.request, { toolId, startDate: start, endDate: start });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.unstubAllGlobals();

    expect(calls).toHaveLength(2);
    const { headers, body } = calls[1];
    const ts = headers.get("x-lendloop-timestamp")!;
    expect(headers.get("x-lendloop-signature")).toBe(await sign("outbound-secret", ts, body));
    const payload = JSON.parse(body);
    expect(payload).toMatchObject({ type: "loan.requested", recipient: { firstName: "Ana" } });
    expect(body).not.toMatch(/@/);
    const log = await admin.query(api.automation.log, { paginationOpts: { numItems: 10, cursor: null }, onlyFailed: false });
    expect(log.page[0]).toMatchObject({ status: "sent", attempts: 2 });
  });
});
