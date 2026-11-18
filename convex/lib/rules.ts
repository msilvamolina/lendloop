// Pure business rules, kept free of Convex context so they are easy to unit test.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LOAN_DAYS = 30;

export const todayUtc = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// Returns an error message, or null when the range is acceptable.
export function validateRange(startDate: string, endDate: string, today: string): string | null {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return "Dates must be valid YYYY-MM-DD dates.";
  // One day of slack: the server runs in UTC, the borrower may be a day behind.
  if (daysBetween(today, startDate) < -1) return "The loan cannot start in the past.";
  if (endDate < startDate) return "The end date must be on or after the start date.";
  if (daysBetween(startDate, endDate) + 1 > MAX_LOAN_DAYS) return `Loans can last at most ${MAX_LOAN_DAYS} days.`;
  return null;
}

// Inclusive date ranges overlap when each starts on or before the other ends.
export function overlaps(a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }) {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export type Role = "admin" | "user";
export type Viewer = { _id: string; role: Role };
export type LoanAction = "approve" | "decline" | "markReturned" | "cancel";
type LoanStatus = "requested" | "approved" | "declined" | "cancelled" | "returned";

// Owners manage their own listings; admins may remove any listing (but not edit someone else's text).
export function canManageTool(viewer: Viewer, tool: { ownerId: string }, action: "edit" | "remove"): boolean {
  if (tool.ownerId === viewer._id) return true;
  return action === "remove" && viewer.role === "admin";
}

export function canViewLoan(viewer: Viewer, loan: { ownerId: string; borrowerId: string }): boolean {
  return viewer.role === "admin" || loan.ownerId === viewer._id || loan.borrowerId === viewer._id;
}

// Who may move a loan, and from which status. Admins get no shortcut here: lending decisions stay with the parties.
const TRANSITIONS: Record<LoanAction, { actor: "owner" | "borrower"; from: LoanStatus; to: LoanStatus }> = {
  approve: { actor: "owner", from: "requested", to: "approved" },
  decline: { actor: "owner", from: "requested", to: "declined" },
  markReturned: { actor: "owner", from: "approved", to: "returned" },
  cancel: { actor: "borrower", from: "requested", to: "cancelled" },
};

export function nextLoanStatus(
  viewer: Viewer,
  loan: { ownerId: string; borrowerId: string; status: LoanStatus },
  action: LoanAction,
): { ok: true; status: LoanStatus } | { ok: false; error: string } {
  const rule = TRANSITIONS[action];
  const actorId = rule.actor === "owner" ? loan.ownerId : loan.borrowerId;
  if (actorId !== viewer._id) return { ok: false, error: "You are not allowed to do that." };
  if (loan.status !== rule.from) return { ok: false, error: `This request is already ${loan.status}.` };
  return { ok: true, status: rule.to };
}
