"use client";

import { ArrowLeft, Bookmark, Database } from "lucide-react";
import { useState } from "react";
import { BookmarksView } from "@/components/events/BookmarksView";
import { useBookmarks } from "@/components/events/useBookmarks";
import { MonitorWorkspace } from "@/components/monitor/MonitorWorkspace";
import { SourcesScreen } from "@/components/sources/SourcesScreen";

type WorkspaceView = "monitor" | "sources" | "bookmarks";

export function AppShell() {
  const [view, setView] = useState<WorkspaceView>("monitor");
  const bookmarks = useBookmarks();

  return (
    <>
      <div
        aria-hidden={view !== "monitor"}
        style={{
          position: "fixed",
          inset: 0,
          visibility: view === "monitor" ? "visible" : "hidden",
          pointerEvents: view === "monitor" ? "auto" : "none",
        }}
      >
        <MonitorWorkspace
          isActive={view === "monitor"}
          bookmarkCount={bookmarks.bookmarkedItems.length}
          onOpenBookmarks={() => setView("bookmarks")}
          onOpenSources={() => setView("sources")}
          isReportBookmarked={bookmarks.isSourceBookmarked}
          onToggleReportBookmark={bookmarks.toggleSourceBookmark}
        />
      </div>

      {view !== "monitor" && (
        <div
          className="relative flex h-screen w-screen flex-col overflow-hidden"
          style={{ color: "#e4e1dc", background: "#09090a" }}
        >
          <header
            className="z-20 flex h-[58px] flex-shrink-0 items-center gap-3 px-4"
            style={{ borderBottom: "1px solid #2b292a", background: "rgba(14,14,15,.98)" }}
          >
            <button
              type="button"
              onClick={() => setView("monitor")}
              className="flex h-9 items-center gap-2 rounded-lg px-3 text-[11px]"
              style={{ color: "#b9b4ae", border: "1px solid #2b292a", background: "#141415" }}
            >
              <ArrowLeft size={15} />
              Back to Monitor
            </button>
            <span className="h-6 w-px" style={{ background: "#2b292a" }} />
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              {view === "sources" ? <Database size={15} /> : <Bookmark size={15} />}
              {view === "sources" ? "Sources" : "Saved reports"}
            </div>
          </header>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {view === "sources" ? (
              <SourcesScreen />
            ) : (
              <BookmarksView
                items={bookmarks.bookmarkedItems}
                onRemoveBookmark={bookmarks.removeBookmark}
                onClearBookmarks={bookmarks.clearBookmarks}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
