import { describe, expect, test } from "vitest";
import { sign, timingSafeEqual, verify } from "../convex/lib/hmac";
import { canManageTool, nextLoanStatus, overlaps, validateRange } from "../convex/lib/rules";
import { roleFor } from "../convex/lib/auth";

describe("HMAC verification", () => {
  const secret = "test-secret";
  const now = 1_800_000_000;
  const ts = String(now);

  test("accepts a correct signature inside the window", async () => {
    const signature = await sign(secret, ts, '{"a":1}');
    expect(await verify({ secret, timestamp: ts, signature, body: '{"a":1}', nowSeconds: now + 60 })).toEqual({ ok: true });
  });

  test("rejects a tampered body, wrong secret, or missing headers", async () => {
    const signature = await sign(secret, ts, '{"a":1}');
    expect((await verify({ secret, timestamp: ts, signature, body: '{"a":2}', nowSeconds: now })).ok).toBe(false);
    expect((await verify({ secret: "other", timestamp: ts, signature, body: '{"a":1}', nowSeconds: now })).ok).toBe(false);
    expect((await verify({ secret, timestamp: null, signature, body: "", nowSeconds: now })).ok).toBe(false);
    expect((await verify({ secret: undefined, timestamp: ts, signature, body: '{"a":1}', nowSeconds: now })).ok).toBe(false);
  });

  test("rejects replays outside the 5 minute window", async () => {
    const signature = await sign(secret, ts, "{}");
    const result = await verify({ secret, timestamp: ts, signature, body: "{}", nowSeconds: now + 301 });
    expect(result).toEqual({ ok: false, reason: "timestamp outside replay window" });
  });

  test("signature binds the timestamp", async () => {
    const signature = await sign(secret, ts, "{}");
    const later = String(now + 10);
    expect((await verify({ secret, timestamp: later, signature, body: "{}", nowSeconds: now + 10 })).ok).toBe(false);
  });

  test("timingSafeEqual", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("date rules", () => {
  test("inclusive ranges overlap when they share a day", () => {
    const a = { startDate: "2026-06-01", endDate: "2026-06-05" };
    expect(overlaps(a, { startDate: "2026-06-05", endDate: "2026-06-07" })).toBe(true);
    expect(overlaps(a, { startDate: "2026-05-28", endDate: "2026-06-01" })).toBe(true);
    expect(overlaps(a, { startDate: "2026-06-02", endDate: "2026-06-03" })).toBe(true);
    expect(overlaps(a, { startDate: "2026-06-06", endDate: "2026-06-09" })).toBe(false);
    expect(overlaps(a, { startDate: "2026-05-01", endDate: "2026-05-31" })).toBe(false);
  });

  test("validateRange", () => {
    const today = "2026-06-10";
    expect(validateRange("2026-06-10", "2026-06-12", today)).toBeNull();
    expect(validateRange("2026-06-09", "2026-06-12", today)).toBeNull(); // one day of timezone slack
    expect(validateRange("2026-06-01", "2026-06-12", today)).toMatch(/past/);
    expect(validateRange("2026-06-12", "2026-06-11", today)).toMatch(/after/);
    expect(validateRange("2026-02-30", "2026-03-01", today)).toMatch(/valid/);
    expect(validateRange("2026-06-10", "2026-08-10", today)).toMatch(/at most/);
  });
});

describe("RBAC rules", () => {
  const owner = { _id: "u1", role: "user" as const };
  const other = { _id: "u2", role: "user" as const };
  const admin = { _id: "u3", role: "admin" as const };
  const tool = { ownerId: "u1" };

  test("only owners edit; owners and admins remove", () => {
    expect(canManageTool(owner, tool, "edit")).toBe(true);
    expect(canManageTool(other, tool, "edit")).toBe(false);
    expect(canManageTool(admin, tool, "edit")).toBe(false);
    expect(canManageTool(other, tool, "remove")).toBe(false);
    expect(canManageTool(admin, tool, "remove")).toBe(true);
  });

  test("loan transitions check actor and current status", () => {
    const loan = { ownerId: "u1", borrowerId: "u2", status: "requested" as const };
    expect(nextLoanStatus(owner, loan, "approve")).toEqual({ ok: true, status: "approved" });
    expect(nextLoanStatus(other, loan, "approve").ok).toBe(false); // borrower cannot approve
    expect(nextLoanStatus(admin, loan, "approve").ok).toBe(false); // admin has no shortcut
    expect(nextLoanStatus(other, loan, "cancel")).toEqual({ ok: true, status: "cancelled" });
    expect(nextLoanStatus(owner, loan, "markReturned").ok).toBe(false); // not approved yet
  });

  test("admin role needs a verified email on the allow list", () => {
    expect(roleFor("Ana@Example.com", true, "ana@example.com, bo@example.com")).toBe("admin");
    expect(roleFor("ana@example.com", false, "ana@example.com")).toBe("user");
    expect(roleFor("eve@example.com", true, "ana@example.com")).toBe("user");
    expect(roleFor(undefined, true, "ana@example.com")).toBe("user");
  });
});
