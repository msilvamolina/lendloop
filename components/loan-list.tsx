"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { errorMessage, formatDate, timeAgo } from "@/lib/ui";
import { LoadMore } from "@/components/load-more";

type Loan = FunctionReturnType<typeof api.loans.myRequests>["page"][number];
type Perspective = "borrower" | "lender" | "admin";

const QUERIES = { borrower: api.loans.myRequests, lender: api.loans.incoming, admin: api.loans.all };

const STATUS_BADGE: Record<Loan["status"], string> = {
  requested: "badge",
  approved: "badge ok",
  declined: "badge",
  cancelled: "badge",
  returned: "badge",
};

export function LoanList({ perspective, empty }: { perspective: Perspective; empty: string }) {
  const loans = usePaginatedQuery(QUERIES[perspective], {}, { initialNumItems: 10 });
  if (loans.status === "LoadingFirstPage") return <p className="muted" role="status">Loading…</p>;
  if (loans.results.length === 0) return <p className="empty">{empty}</p>;
  return (
    <>
      <ul className="stack">
        {loans.results.map((loan) => (
          <LoanCard key={loan._id} loan={loan} perspective={perspective} />
        ))}
      </ul>
      <LoadMore query={loans} />
    </>
  );
}

function automationLine(a: NonNullable<Loan["lastAutomation"]>) {
  const what = a.kind === "reminder" ? "Reminder" : "Notification";
  return a.status === "sent" ? `${what} sent ${timeAgo(a.at)}` : `${what} failed ${timeAgo(a.at)}`;
}

function LoanCard({ loan, perspective }: { loan: Loan; perspective: Perspective }) {
  const act = useMutation(api.loans.act);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: "approve" | "decline" | "markReturned" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      await act({ loanId: loan._id, action });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const who =
    perspective === "borrower"
      ? `from ${loan.ownerName}`
      : perspective === "lender"
        ? `requested by ${loan.borrowerName}`
        : `${loan.borrowerName} borrows from ${loan.ownerName}`;

  return (
    <li className="card">
      <h2>{loan.toolName}</h2>
      <div className="meta">
        <span>
          {formatDate(loan.startDate)} – {formatDate(loan.endDate)}
        </span>
        <span aria-hidden>·</span>
        <span>{who}</span>
        <span className={STATUS_BADGE[loan.status]}>{loan.status}</span>
        {loan.overdue && <span className="badge bad">Overdue</span>}
      </div>
      {loan.lastAutomation && <p className="small-text muted">{automationLine(loan.lastAutomation)}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {perspective === "lender" && loan.status === "requested" && (
          <>
            <button className="button small" disabled={busy} onClick={() => run("approve")}>
              Approve
            </button>
            <button className="button small secondary" disabled={busy} onClick={() => run("decline")}>
              Decline
            </button>
          </>
        )}
        {perspective === "lender" && loan.status === "approved" && (
          <button className="button small" disabled={busy} onClick={() => run("markReturned")}>
            Mark returned
          </button>
        )}
        {perspective === "borrower" && loan.status === "requested" && (
          <button className="button small secondary" disabled={busy} onClick={() => run("cancel")}>
            Cancel request
          </button>
        )}
      </div>
    </li>
  );
}
