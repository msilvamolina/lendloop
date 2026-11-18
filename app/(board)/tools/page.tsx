"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "nextjs-toploader/app";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORY_LABELS, CONDITION_LABELS, errorMessage, formatDate, isCategory, localToday } from "@/lib/ui";
import { LoadMore } from "@/components/load-more";

export default function ToolsPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Tools />
    </Suspense>
  );
}

function Tools() {
  const router = useRouter();
  const param = useSearchParams().get("category");
  const category = isCategory(param) ? param : undefined;
  const tools = usePaginatedQuery(api.tools.list, { category }, { initialNumItems: 12 });
  const isAdmin = useQuery(api.users.me)?.role === "admin";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>All tools</h1>
          <p>Everything your neighbors are lending right now.</p>
        </div>
        <label className="filter">
          Category
          <select
            value={category ?? ""}
            onChange={(e) => router.replace(e.target.value ? `/tools?category=${e.target.value}` : "/tools")}
          >
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tools.status === "LoadingFirstPage" ? (
        <p className="muted" role="status">Loading tools…</p>
      ) : tools.results.length === 0 ? (
        <p className="empty">No tools in this category yet.</p>
      ) : (
        <ul className="grid">
          {tools.results.map((tool) => (
            <li key={tool._id} className="card">
              <h2>{tool.name}</h2>
              <div className="meta">
                <span>{CATEGORY_LABELS[tool.category]}</span>
                <span aria-hidden>·</span>
                <span>{CONDITION_LABELS[tool.condition]}</span>
              </div>
              {tool.description && <p className="small-text">{tool.description}</p>}
              <div className="meta">
                {tool.availableAgain ? (
                  <span className="badge warn">Lent out until {formatDate(tool.availableAgain)}</span>
                ) : (
                  <span className="badge ok">Available</span>
                )}
                <span>
                  Lent by {tool.isMine ? "you" : tool.ownerName}
                </span>
                {tool.ownerTrusted && <span className="badge trusted">Trusted Lender</span>}
              </div>
              {!tool.isMine && <RequestForm toolId={tool._id} />}
              {isAdmin && !tool.isMine && <AdminRemove toolId={tool._id} name={tool.name} />}
            </li>
          ))}
        </ul>
      )}
      <LoadMore query={tools} />
    </>
  );
}

function RequestForm({ toolId }: { toolId: Id<"tools"> }) {
  const request = useMutation(api.loans.request);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [startDate, setStartDate] = useState("");
  const today = localToday();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(null);
    try {
      await request({ toolId, startDate: String(data.get("startDate")), endDate: String(data.get("endDate")) });
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (sent) return <p className="small-text" role="status">Request sent. You’ll see it under My requests.</p>;
  return (
    <details>
      <summary>Request to borrow</summary>
      <form className="form" onSubmit={onSubmit}>
        <div className="form-row">
          <label className="field">
            From
            <input type="date" name="startDate" required min={today} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="field">
            Until
            <input type="date" name="endDate" required min={startDate || today} />
          </label>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="button small">Send request</button>
        </div>
      </form>
    </details>
  );
}

function AdminRemove({ toolId, name }: { toolId: Id<"tools">; name: string }) {
  const remove = useMutation(api.tools.remove);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (!confirm(`Remove “${name}” from LendLoop? Open requests will be declined.`)) return;
    try {
      await remove({ toolId });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="actions">
      <button className="button small danger" onClick={onClick}>
        Remove listing (admin)
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
