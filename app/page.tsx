"use client";

import Link from "next/link";
import { Show, SignInButton } from "@clerk/nextjs";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS } from "@/lib/ui";
import { LoadMore } from "@/components/load-more";

export default function HomePage() {
  const tools = usePaginatedQuery(api.tools.listPublic, {}, { initialNumItems: 12 });

  return (
    <>
      <section className="hero">
        <h1>LendLoop</h1>
        <p>Borrow what you need. Lend what you don’t. A tool-lending board for your neighborhood.</p>
        <Show when="signed-out">
          <SignInButton mode="modal" forceRedirectUrl="/tools">
            <button className="button">Sign in to lend or borrow</button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          <Link href="/tools" className="button">
            Go to the board
          </Link>
        </Show>
      </section>

      <section aria-labelledby="available">
        <h2 id="available">Available tools</h2>
        {tools.status === "LoadingFirstPage" ? (
          <p className="muted" role="status">Loading tools…</p>
        ) : tools.results.length === 0 ? (
          <p className="empty">No tools listed yet. Be the first to lend one.</p>
        ) : (
          <ul className="grid">
            {tools.results.map((tool) => (
              <li key={tool._id} className="card">
                <h3>{tool.name}</h3>
                <span className="meta">{CATEGORY_LABELS[tool.category]}</span>
              </li>
            ))}
          </ul>
        )}
        <LoadMore query={tools} />
      </section>
    </>
  );
}
