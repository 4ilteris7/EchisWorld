"use client";

import { useMemo, useSyncExternalStore } from "react";

// Live source-intelligence items are transient (the feed rotates), so their
const SOURCE_STORAGE_KEY = "echis.bookmarks.sources";

const EMPTY_BOOKMARK_IDS: string[] = [];
const bookmarkSnapshots = new Map<string, { raw: string | null; ids: string[] }>();
const bookmarkListeners = new Map<string, Set<() => void>>();

function parseStoredBookmarkIds(raw: string | null) {
  if (!raw) return EMPTY_BOOKMARK_IDS;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_BOOKMARK_IDS;
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return EMPTY_BOOKMARK_IDS;
  }
}

function readStoredBookmarkIds(storageKey: string) {
  if (typeof window === "undefined") return [];

  const raw = window.localStorage.getItem(storageKey);
  const snapshot = bookmarkSnapshots.get(storageKey);
  if (snapshot?.raw === raw) {
    return snapshot.ids;
  }

  const ids = parseStoredBookmarkIds(raw);
  bookmarkSnapshots.set(storageKey, { raw, ids });
  return ids;
}

function subscribeToBookmarkIds(storageKey: string, listener: () => void) {
  const listeners = bookmarkListeners.get(storageKey) ?? new Set<() => void>();
  listeners.add(listener);
  bookmarkListeners.set(storageKey, listeners);

  return () => {
    listeners.delete(listener);
  };
}

function writeStoredBookmarkIds(storageKey: string, ids: string[]) {
  if (typeof window === "undefined") return;

  const raw = JSON.stringify(ids);
  window.localStorage.setItem(storageKey, raw);
  bookmarkSnapshots.set(storageKey, { raw, ids });
  bookmarkListeners.get(storageKey)?.forEach((listener) => listener());
}

export function useBookmarkIds(storageKey = SOURCE_STORAGE_KEY) {
  const bookmarkedIds = useSyncExternalStore(
    (listener) => subscribeToBookmarkIds(storageKey, listener),
    () => readStoredBookmarkIds(storageKey),
    () => EMPTY_BOOKMARK_IDS,
  );

  const bookmarkedIdSet = useMemo(() => new Set(bookmarkedIds), [bookmarkedIds]);

  function isBookmarked(eventId: string) {
    return bookmarkedIdSet.has(eventId);
  }

  function toggleBookmark(eventId: string) {
    const current = readStoredBookmarkIds(storageKey);
    const next = current.includes(eventId)
      ? current.filter((id) => id !== eventId)
      : [...current, eventId];

    writeStoredBookmarkIds(storageKey, next);
  }

  function removeBookmark(eventId: string) {
    writeStoredBookmarkIds(
      storageKey,
      readStoredBookmarkIds(storageKey).filter((id) => id !== eventId),
    );
  }

  function clearBookmarks() {
    writeStoredBookmarkIds(storageKey, EMPTY_BOOKMARK_IDS);
  }

  return {
    bookmarkedIds,
    isBookmarked,
    toggleBookmark,
    removeBookmark,
    clearBookmarks,
  };
}

// ── Live source-item bookmarks (persisted snapshots) ────────────────────────

export type SourceBookmarkSnapshot = {
  id: string;
  title: string;
  summary?: string;
  sourceName: string;
  url?: string;
  publishedAt?: string;
  domainLabel?: string;
  /** ISO timestamp of when the user saved the item. */
  savedAt: string;
};

const EMPTY_SOURCE_BOOKMARKS: SourceBookmarkSnapshot[] = [];
let sourceSnapshotCache: { raw: string | null; items: SourceBookmarkSnapshot[] } | null =
  null;

function parseStoredSourceBookmarks(raw: string | null): SourceBookmarkSnapshot[] {
  if (!raw) return EMPTY_SOURCE_BOOKMARKS;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_SOURCE_BOOKMARKS;
    return parsed.filter(
      (entry): entry is SourceBookmarkSnapshot =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as SourceBookmarkSnapshot).id === "string" &&
        typeof (entry as SourceBookmarkSnapshot).title === "string" &&
        typeof (entry as SourceBookmarkSnapshot).sourceName === "string" &&
        typeof (entry as SourceBookmarkSnapshot).savedAt === "string",
    );
  } catch {
    return EMPTY_SOURCE_BOOKMARKS;
  }
}

function readStoredSourceBookmarks(): SourceBookmarkSnapshot[] {
  if (typeof window === "undefined") return EMPTY_SOURCE_BOOKMARKS;

  const raw = window.localStorage.getItem(SOURCE_STORAGE_KEY);
  if (sourceSnapshotCache?.raw === raw) {
    return sourceSnapshotCache.items;
  }

  const items = parseStoredSourceBookmarks(raw);
  sourceSnapshotCache = { raw, items };
  return items;
}

function writeStoredSourceBookmarks(items: SourceBookmarkSnapshot[]) {
  if (typeof window === "undefined") return;

  const raw = JSON.stringify(items);
  window.localStorage.setItem(SOURCE_STORAGE_KEY, raw);
  sourceSnapshotCache = { raw, items };
  bookmarkListeners.get(SOURCE_STORAGE_KEY)?.forEach((listener) => listener());
}

export function useSourceBookmarks() {
  const sourceBookmarks = useSyncExternalStore(
    (listener) => subscribeToBookmarkIds(SOURCE_STORAGE_KEY, listener),
    () => readStoredSourceBookmarks(),
    () => EMPTY_SOURCE_BOOKMARKS,
  );

  const sourceBookmarkIdSet = useMemo(
    () => new Set(sourceBookmarks.map((item) => item.id)),
    [sourceBookmarks],
  );

  function isSourceBookmarked(itemId: string) {
    return sourceBookmarkIdSet.has(itemId);
  }

  function toggleSourceBookmark(snapshot: Omit<SourceBookmarkSnapshot, "savedAt">) {
    const current = readStoredSourceBookmarks();
    const next = current.some((item) => item.id === snapshot.id)
      ? current.filter((item) => item.id !== snapshot.id)
      : [...current, { ...snapshot, savedAt: new Date().toISOString() }];
    writeStoredSourceBookmarks(next);
  }

  function removeSourceBookmark(itemId: string) {
    writeStoredSourceBookmarks(
      readStoredSourceBookmarks().filter((item) => item.id !== itemId),
    );
  }

  function clearSourceBookmarks() {
    writeStoredSourceBookmarks(EMPTY_SOURCE_BOOKMARKS);
  }

  return {
    sourceBookmarks,
    isSourceBookmarked,
    toggleSourceBookmark,
    removeSourceBookmark,
    clearSourceBookmarks,
  };
}

// ── Combined view for the Bookmarks screen ──────────────────────────────────

export type BookmarkedItem =
  { type: "source"; item: SourceBookmarkSnapshot };

export function useBookmarks() {
  const {
    sourceBookmarks,
    isSourceBookmarked,
    toggleSourceBookmark,
    removeSourceBookmark,
    clearSourceBookmarks,
  } = useSourceBookmarks();

  const bookmarkedItems = useMemo<BookmarkedItem[]>(
    () => sourceBookmarks.map((item) => ({ type: "source" as const, item })),
    [sourceBookmarks],
  );

  // Id-based removal works across both stores (ids never collide: SOCMINT ids
  // are soc-*, source ids come from the pipeline).
  function removeAnyBookmark(id: string) {
    removeSourceBookmark(id);
  }

  function clearAllBookmarks() {
    clearSourceBookmarks();
  }

  return {
    isSourceBookmarked,
    toggleSourceBookmark,
    removeBookmark: removeAnyBookmark,
    clearBookmarks: clearAllBookmarks,
    bookmarkedItems,
  };
}
