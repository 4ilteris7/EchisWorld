"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  matchesMonitorView,
  type MonitorReportEntry,
  type MonitorViewFilters,
} from "./monitorReportTools";

const STORAGE_KEY = "echis.monitor.savedViews";
const MAX_TRACKED_IDS = 600;
const EMPTY_VIEWS: SavedMonitorView[] = [];
const listeners = new Set<() => void>();
let viewCache: { raw: string | null; views: SavedMonitorView[] } | null = null;

export type SavedMonitorView = MonitorViewFilters & {
  id: string;
  name: string;
  createdAt: string;
  alertsEnabled: boolean;
  seenEntryIds: string[];
  unreadEntryIds: string[];
};

function parseViews(raw: string | null): SavedMonitorView[] {
  if (!raw) return EMPTY_VIEWS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_VIEWS;
    return parsed.filter((view): view is SavedMonitorView => (
      view &&
      typeof view === "object" &&
      typeof view.id === "string" &&
      typeof view.name === "string" &&
      typeof view.layers === "object" &&
      Array.isArray(view.seenEntryIds) &&
      Array.isArray(view.unreadEntryIds)
    ));
  } catch {
    return EMPTY_VIEWS;
  }
}

function readStoredViews(): SavedMonitorView[] {
  if (typeof window === "undefined") return EMPTY_VIEWS;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (viewCache?.raw === raw) return viewCache.views;
  const views = parseViews(raw);
  viewCache = { raw, views };
  return views;
}

function writeStoredViews(views: SavedMonitorView[]): void {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(views);
  window.localStorage.setItem(STORAGE_KEY, raw);
  viewCache = { raw, views };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    viewCache = null;
    listener();
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function defaultName(filters: MonitorViewFilters): string {
  if (filters.query.trim()) return `“${filters.query.trim().slice(0, 28)}”`;
  if (filters.source) return filters.source;
  if (filters.geography?.name) return filters.geography.name;
  const active = Object.entries(filters.layers)
    .filter(([, enabled]) => enabled)
    .map(([layer]) => layer);
  const scope = active.length === 1 ? active[0] : `${active.length} layers`;
  return `${scope} · ${filters.timeWindow === "all" ? "all" : `${filters.timeWindow}h`}`;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useMonitorViews() {
  const views = useSyncExternalStore(subscribe, readStoredViews, () => EMPTY_VIEWS);

  const saveView = useCallback((
    filters: MonitorViewFilters,
    matchingEntryIds: string[],
  ): SavedMonitorView => {
    const view: SavedMonitorView = {
      ...filters,
      id: createId(),
      name: defaultName(filters),
      createdAt: new Date().toISOString(),
      alertsEnabled: false,
      seenEntryIds: matchingEntryIds.slice(-MAX_TRACKED_IDS),
      unreadEntryIds: [],
    };
    writeStoredViews([...readStoredViews(), view]);
    return view;
  }, []);

  const removeView = useCallback((id: string) => {
    writeStoredViews(readStoredViews().filter((view) => view.id !== id));
  }, []);

  const markRead = useCallback((id: string) => {
    const current = readStoredViews();
    const next = current.map((view) => (
      view.id === id && view.unreadEntryIds.length > 0
        ? { ...view, unreadEntryIds: [] }
        : view
    ));
    if (next.some((view, index) => view !== current[index])) writeStoredViews(next);
  }, []);

  const toggleAlerts = useCallback(async (id: string) => {
    const enabling = views.some((view) => view.id === id && !view.alertsEnabled);
    if (
      enabling &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
    }
    writeStoredViews(readStoredViews().map((view) => (
      view.id === id ? { ...view, alertsEnabled: !view.alertsEnabled } : view
    )));
  }, [views]);

  const evaluateAlerts = useCallback((entries: readonly MonitorReportEntry[]) => {
    const current = readStoredViews();
    let changed = false;
    const notifications: Array<{ name: string; count: number }> = [];
    const next = current.map((view) => {
      if (!view.alertsEnabled) return view;
      const matchedIds = entries
        .filter((entry) => matchesMonitorView(entry, view))
        .map((entry) => entry.id);
      const seen = new Set(view.seenEntryIds);
      const unread = new Set(view.unreadEntryIds);
      const added = matchedIds.filter((id) => !seen.has(id));
      if (added.length === 0) return view;
      changed = true;
      for (const id of added) unread.add(id);
      notifications.push({ name: view.name, count: added.length });
      return {
        ...view,
        seenEntryIds: [...view.seenEntryIds, ...added].slice(-MAX_TRACKED_IDS),
        unreadEntryIds: Array.from(unread).slice(-MAX_TRACKED_IDS),
      };
    });
    if (changed) writeStoredViews(next);
    if (
      notifications.length > 0 &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      for (const notification of notifications) {
        new Notification("EchisWorld Monitor", {
          body: `${notification.name}: ${notification.count} new public-source ${notification.count === 1 ? "report" : "reports"}.`,
        });
      }
    }
  }, []);

  return {
    views,
    saveView,
    removeView,
    markRead,
    toggleAlerts,
    evaluateAlerts,
  };
}
