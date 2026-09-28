"use client";

import { Bookmark } from "lucide-react";

export function BookmarkToggleButton({
  bookmarked,
  onToggle,
  size = 11,
}: {
  bookmarked: boolean;
  onToggle: () => void;
  size?: number;
}) {
  return (
    <button
      type="button"
      aria-label={bookmarked ? "Remove event from bookmarks" : "Save event to bookmarks"}
      aria-pressed={bookmarked}
      className="flex-shrink-0 rounded p-0.5 outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-[#ec2f3b]/45"
      style={{
        color: bookmarked ? "var(--accent-blue-text)" : "rgba(85,85,85,0.8)",
        background: bookmarked ? "var(--accent-blue-bg)" : "transparent",
        boxShadow: bookmarked ? "0 0 10px var(--accent-blue-glow)" : "none",
      }}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.color = "var(--accent-blue-text)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.color = bookmarked
          ? "var(--accent-blue-text)"
          : "rgba(85,85,85,0.8)";
      }}
    >
      <Bookmark size={size} fill={bookmarked ? "currentColor" : "none"} />
    </button>
  );
}
