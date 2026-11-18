"use client";

const PAGE_SIZE = 12;

export function LoadMore({ query }: { query: { status: string; loadMore: (n: number) => void } }) {
  if (query.status !== "CanLoadMore" && query.status !== "LoadingMore") return null;
  return (
    <div className="load-more">
      <button
        className="button secondary"
        onClick={() => query.loadMore(PAGE_SIZE)}
        disabled={query.status === "LoadingMore"}
      >
        {query.status === "LoadingMore" ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}
