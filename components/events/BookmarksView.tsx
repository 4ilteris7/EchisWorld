"use client";

import { Bookmark, ExternalLink } from "lucide-react";
import { BookmarkToggleButton } from "./BookmarkToggleButton";
import type { BookmarkedItem, SourceBookmarkSnapshot } from "./useBookmarks";

function formatSavedDate(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SourceBookmarkCard({
  item,
  index,
  onRemove,
}: {
  item: SourceBookmarkSnapshot;
  index: number;
  onRemove: () => void;
}) {
  return (
    <article
      className="relative rounded-lg transition-all duration-150"
      style={{
        padding: "10px 11px",
        border: "1px solid rgba(255,255,255,0.055)",
        background: "rgba(255,255,255,0.018)",
      }}
    >
      <div className="mb-1.5 flex items-start gap-2">
        <span
          className="mt-px flex h-4 w-4 flex-shrink-0 items-center justify-center rounded"
          style={{
            fontSize: "9px",
            fontWeight: 700,
            background: "rgba(255,255,255,0.07)",
            color: "var(--c-t5)",
          }}
        >
          {index}
        </span>
        <p
          className="flex-1 pr-1 font-medium leading-snug"
          style={{ fontSize: "12.5px", color: "var(--c-t3)" }}
        >
          {item.title}
        </p>
        {item.url && (
          <button
            type="button"
            aria-label="Open source in new tab"
            onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
            className="mt-0.5 flex flex-shrink-0 items-center justify-center rounded p-0.5"
            style={{ color: "var(--c-t6)" }}
          >
            <ExternalLink size={11} />
          </button>
        )}
        <div className="mt-0.5">
          <BookmarkToggleButton bookmarked onToggle={onRemove} />
        </div>
      </div>

      <div
        className="mb-1.5 flex flex-wrap items-center gap-2"
        style={{ fontSize: "10.5px", color: "var(--c-t5)" }}
      >
        <span style={{ color: "var(--c-silver-dim)", fontWeight: 500 }}>
          {item.sourceName}
        </span>
        {item.publishedAt && <span>{formatSavedDate(item.publishedAt)}</span>}
        <span>Saved {formatSavedDate(item.savedAt)}</span>
      </div>

      <div className="mb-1.5 flex flex-wrap gap-1">
        <span
          className="rounded px-1.5 py-0.5 uppercase tracking-wide"
          style={{
            fontSize: "9px",
            fontWeight: 700,
            background: "var(--accent-blue-bg)",
            color: "var(--accent-blue-text)",
          }}
        >
          Source Intel
        </span>
        {item.domainLabel && (
          <span
            className="rounded px-1.5 py-0.5 uppercase tracking-wide"
            style={{
              fontSize: "9px",
              fontWeight: 700,
              background: "rgba(255,255,255,0.045)",
              color: "var(--c-t4)",
            }}
          >
            {item.domainLabel}
          </span>
        )}
      </div>

      {item.summary && (
        <p
          className="line-clamp-2 leading-relaxed"
          style={{ fontSize: "11.5px", color: "var(--c-t5)" }}
        >
          {item.summary}
        </p>
      )}
    </article>
  );
}

export function BookmarksView({
  items,
  onRemoveBookmark,
  onClearBookmarks,
}: {
  items: BookmarkedItem[];
  onRemoveBookmark: (eventId: string) => void;
  onClearBookmarks: () => void;
}) {
  const hasBookmarks = items.length > 0;

  return (
    <main
      className="flex min-h-0 flex-1 overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at 24% 18%, rgba(255,43,61,0.035), rgba(10,10,10,0) 32%), var(--c-bg-base)",
      }}
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1180px] flex-col gap-3 px-6 py-4">
        <section className="flex flex-shrink-0 items-start gap-4">
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <Bookmark size={15} style={{ color: "var(--accent-blue-text)" }} />
              <span
                className="font-semibold uppercase"
                style={{ color: "var(--c-t4)", fontSize: "10.5px", letterSpacing: "0.12em" }}
              >
                Saved Items
              </span>
            </div>
            <h1 className="font-semibold" style={{ color: "var(--c-t1)", fontSize: "22px" }}>
              Bookmarks
            </h1>
          </div>
        </section>

        <section
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px]"
          style={{
            background: "var(--bg-panel)",
            border: "1px solid var(--c-border-1)",
            boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.035)",
          }}
        >
          <div
            className="flex flex-shrink-0 items-center justify-between px-4 py-2.5"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.055)" }}
          >
            <span
              className="font-semibold uppercase"
              style={{ color: "var(--c-t4)", fontSize: "10px", letterSpacing: "0.12em" }}
            >
              Bookmarked Items
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!hasBookmarks}
                onClick={onClearBookmarks}
                className="rounded-md px-2.5 py-1 font-semibold uppercase outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-[#ec2f3b]/45"
                style={{
                  background: hasBookmarks ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.018)",
                  border: "1px solid rgba(255,255,255,0.065)",
                  color: hasBookmarks ? "var(--c-t4)" : "var(--c-t6)",
                  cursor: hasBookmarks ? "pointer" : "default",
                  fontSize: "9.5px",
                  letterSpacing: "0.08em",
                }}
              >
                Clear
              </button>
              <span
                className="rounded-md px-2.5 py-1 font-semibold"
                style={{
                  background: "rgba(255,255,255,0.035)",
                  border: "1px solid rgba(255,255,255,0.065)",
                  color: "var(--c-t4)",
                  fontSize: "10.5px",
                }}
              >
                {items.length} Saved
              </span>
            </div>
          </div>

          {items.length === 0 ? (
            <div
              className="flex flex-1 items-center justify-center text-center"
              style={{ color: "var(--c-t5)", fontSize: "12px" }}
            >
              No bookmarked items yet.
            </div>
          ) : (
            <div
              className="tm-scrollbar politics-feed-scrollbar grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto p-3 lg:grid-cols-2"
            >
              {items.map((item, index) => (
                <SourceBookmarkCard
                  key={item.item.id}
                  item={item.item}
                  index={index + 1}
                  onRemove={() => onRemoveBookmark(item.item.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
