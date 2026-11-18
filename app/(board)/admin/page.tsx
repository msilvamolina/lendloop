"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorMessage, timeAgo } from "@/lib/ui";
import { LoadMore } from "@/components/load-more";
import { LoanList } from "@/components/loan-list";

export default function AdminPage() {
  const me = useQuery(api.users.me);
  if (me === undefined) return <p className="muted" role="status">Loading…</p>;
  // The UI check is only a courtesy; every admin query and mutation re-checks the role in Convex.
  if (me?.role !== "admin") return <p className="empty">This page is for admins.</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p>All loans, lenders and automation runs. Remove listings from the All tools page.</p>
        </div>
      </div>
      <section className="section" aria-labelledby="loans">
        <h2 id="loans">All loans</h2>
        <LoanList perspective="admin" empty="No loans yet." />
      </section>
      <section className="section" aria-labelledby="lenders">
        <h2 id="lenders">Members</h2>
        <Members />
      </section>
      <section className="section" aria-labelledby="automation">
        <h2 id="automation">Automation log</h2>
        <AutomationLog />
      </section>
    </>
  );
}

function Members() {
  const users = usePaginatedQuery(api.users.list, {}, { initialNumItems: 10 });
  const setTrusted = useMutation(api.users.setTrusted);
  const [error, setError] = useState<string | null>(null);

  if (users.status === "LoadingFirstPage") return <p className="muted">Loading…</p>;
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="stack">
        {users.results.map((user) => (
          <li key={user._id} className="card">
            <div className="meta">
              <strong>{user.name}</strong>
              {user.role === "admin" && <span className="badge">admin</span>}
              {user.trusted && <span className="badge trusted">Trusted Lender</span>}
            </div>
            <div className="actions">
              <button
                className="button small secondary"
                onClick={() => setTrusted({ userId: user._id, trusted: !user.trusted }).catch((e) => setError(errorMessage(e)))}
              >
                {user.trusted ? "Remove Trusted Lender" : "Mark as Trusted Lender"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <LoadMore query={users} />
    </>
  );
}

function AutomationLog() {
  const [onlyFailed, setOnlyFailed] = useState(false);
  const events = usePaginatedQuery(api.automation.log, { onlyFailed }, { initialNumItems: 15 });

  return (
    <>
      <label className="filter" style={{ marginBottom: "1rem" }}>
        <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} />
        Only failures
      </label>
      {events.status === "LoadingFirstPage" ? (
        <p className="muted">Loading…</p>
      ) : events.results.length === 0 ? (
        <p className="empty">Nothing here yet.</p>
      ) : (
        <ul className="stack">
          {events.results.map((event) => (
            <li key={event._id} className="card">
              <div className="meta">
                <strong>{event.kind.replace("_", " ")}</strong>
                <span className={event.status === "failed" ? "badge bad" : event.status === "sent" ? "badge ok" : "badge"}>
                  {event.status}
                </span>
                <span>{timeAgo(event.updatedAt)}</span>
                <span aria-hidden>·</span>
                <span>
                  {event.attempts} attempt{event.attempts === 1 ? "" : "s"}
                </span>
              </div>
              <code className="small-text muted">{event.idempotencyKey}</code>
              {event.detail && <p className="small-text">{event.detail}</p>}
            </li>
          ))}
        </ul>
      )}
      <LoadMore query={events} />
    </>
  );
}
