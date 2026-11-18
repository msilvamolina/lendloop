"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { CATEGORY_LABELS, CONDITION_LABELS, errorMessage, formatDate } from "@/lib/ui";
import { LoadMore } from "@/components/load-more";
import { ToolForm } from "@/components/tool-form";

export default function ListingsPage() {
  const tools = usePaginatedQuery(api.tools.mine, {}, { initialNumItems: 12 });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My listings</h1>
          <p>The tools you lend to the neighborhood.</p>
        </div>
      </div>

      <details className="card" open={tools.status !== "LoadingFirstPage" && tools.results.length === 0}>
        <summary>List a new tool</summary>
        <ToolForm />
      </details>

      <section className="section" aria-label="Your tools">
        {tools.status === "LoadingFirstPage" ? (
          <p className="muted" role="status">Loading…</p>
        ) : tools.results.length === 0 ? (
          <p className="empty">You haven’t listed anything yet.</p>
        ) : (
          <ul className="grid">
            {tools.results.map((tool) => (
              <Listing key={tool._id} tool={tool} />
            ))}
          </ul>
        )}
        <LoadMore query={tools} />
      </section>
    </>
  );
}

function Listing({ tool }: { tool: Doc<"tools"> & { availableAgain: string | null } }) {
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (!confirm(`Delete “${tool.name}”? Open requests for it will be declined.`)) return;
    try {
      await remove({ toolId: tool._id });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <li className="card">
      <h2>{tool.name}</h2>
      <div className="meta">
        <span>{CATEGORY_LABELS[tool.category]}</span>
        <span aria-hidden>·</span>
        <span>{CONDITION_LABELS[tool.condition]}</span>
        {tool.availableAgain ? (
          <span className="badge warn">Lent out until {formatDate(tool.availableAgain)}</span>
        ) : (
          <span className="badge ok">Available</span>
        )}
      </div>
      {editing ? (
        <ToolForm toolId={tool._id} initial={tool} onDone={() => setEditing(false)} />
      ) : (
        tool.description && <p className="small-text">{tool.description}</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button className="button small secondary" onClick={() => setEditing(!editing)}>
          {editing ? "Cancel" : "Edit"}
        </button>
        <button className="button small danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}
