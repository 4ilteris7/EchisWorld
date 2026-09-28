"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useSourceIntelligenceStore } from "@/components/source-intelligence/SourceIntelligenceProvider";
import { PersonalSourceManager } from "@/components/sources/PersonalSourceManager";
import type {
  CollectionMethod,
  SourceDefinition,
  SourceStatus,
  SourceType,
} from "@/data/source-intelligence/sourceIntelligenceTypes";

const METHOD_LABELS: Record<CollectionMethod, string> = {
  rss: "RSS",
  api: "API Route",
  aggregator_api: "Aggregator API",
  official_page: "Official Page",
  scraping: "Scraping",
  script_import: "Script Import",
  dataset: "Dataset",
};

const TYPE_LABELS: Record<SourceType, string> = {
  official_government: "Official Government",
  intergovernmental_org: "Intergovernmental Org",
  wire_agency: "Wire Agency",
  regional_news: "Regional News",
  global_news: "Global News",
  crisis_humanitarian: "Crisis / Humanitarian",
  conflict_dataset: "Conflict Dataset",
  aggregator: "Aggregator",
  scraped_official_page: "Scraped Official Page",
  script_import: "Script Import",
};

const STATUS_LABELS: Record<SourceStatus, string> = {
  active: "Active",
  test: "Test",
  candidate: "Candidate",
  disabled: "Disabled",
};

// Collection methods in display order (matches METHOD_LABELS key order).
const METHODS: CollectionMethod[] = [
  "rss",
  "api",
  "aggregator_api",
  "official_page",
  "scraping",
  "script_import",
  "dataset",
];

const CONFIGS: SourceStatus[] = ["active", "test", "candidate", "disabled"];

type RuntimeState = "ok" | "warn" | "error" | "idle";

const RUNTIME_STYLES: Record<
  RuntimeState,
  { dot: string; bg: string; border: string; text: string; label: string }
> = {
  ok: {
    dot: "#34d399",
    bg: "rgba(52,211,153,0.10)",
    border: "rgba(52,211,153,0.28)",
    text: "rgba(52,211,153,0.95)",
    label: "OK",
  },
  warn: {
    dot: "#fbbf24",
    bg: "rgba(251,191,36,0.10)",
    border: "rgba(251,191,36,0.28)",
    text: "rgba(251,191,36,0.95)",
    label: "WARN",
  },
  error: {
    dot: "#ff2b3d",
    bg: "rgba(225,40,52,0.10)",
    border: "rgba(240,64,76,0.32)",
    text: "rgba(255,86,96,0.95)",
    label: "ERROR",
  },
  idle: {
    dot: "rgba(176,184,196,0.7)",
    bg: "rgba(255,255,255,0.03)",
    border: "rgba(255,255,255,0.08)",
    text: "rgba(176,184,196,0.82)",
    label: "IDLE",
  },
};

// UI uses the app font (Hanken Grotesk via --font-ui); mono cells, eyebrows,
// counts and timestamps use the app mono font (JetBrains Mono via --font-mono).
const FONT = {
  ui: 'var(--font-ui), "Hanken Grotesk", system-ui, sans-serif',
  mono: 'var(--font-mono), "JetBrains Mono", ui-monospace, monospace',
};

const ACCENT = "#ff2b3d";
const ACCENT_TEXT = "rgba(255,86,96,1)";
const ACCENT_BORDER = "rgba(255,72,84,0.42)";

function labelFor(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatSourceError(error?: string | null): string | null {
  if (!error) return null;
  if (error === "source_route_not_found") {
    return "Source route was not found. The source may be stale, removed, or still open from an older browser session.";
  }
  if (error.endsWith("_key_not_configured")) {
    return `${labelFor(error.replace("_key_not_configured", ""))} API key is not configured.`;
  }
  if (error.endsWith("_source_not_configured")) {
    return `${labelFor(error.replace("_source_not_configured", ""))} source is not configured in the runtime registry.`;
  }
  if (error === "missing_feed_url") return "Feed URL is missing.";
  if (error === "timeout") return "Request timed out.";
  if (error === "network_access_denied") return "Network access was denied for this source route.";
  if (error === "network_connection_reset") return "Source connection was reset.";
  if (error === "network_fetch_failed") return "Source network request failed.";
  if (error === "tls_certificate_error") return "TLS certificate verification failed for this source.";
  if (error === "parse_failed") return "Source response could not be parsed.";
  if (error.startsWith("source_route_")) {
    const detail = error.slice("source_route_".length);
    if (detail === "404") {
      return "Source route was not found. The local runtime endpoint or stale source id should be checked.";
    }
    return `Source runtime route returned HTTP ${detail}.`;
  }
  if (error.startsWith("upstream_")) {
    const detail = error.slice("upstream_".length);
    if (detail.startsWith("429")) {
      return "Source rate limit reached. Wait a few seconds before refreshing again.";
    }
    if (detail.startsWith("400")) {
      return "Source request was rejected by the upstream API. Check the request parameters for this adapter.";
    }
    if (detail.startsWith("401") || detail.startsWith("403")) {
      return "Source authentication or access was rejected by the upstream service.";
    }
    if (detail.startsWith("404")) {
      return "Upstream source endpoint was not found. The external API path or feed URL may have changed.";
    }
    if (detail.includes("approved appname")) {
      return "ReliefWeb API requires an approved appname; this source now uses the RSS adapter in the active pipeline.";
    }
    return `Upstream HTTP ${detail}.`;
  }
  return labelFor(error);
}

// HTTP-ish status code parsed out of the runtime error code, when present.
function statusCodeFor(error?: string | null): string {
  if (!error) return "—";
  const match = error.match(/(\d{3})/);
  return match ? match[1] : "—";
}

function regionOf(source: SourceDefinition): string {
  return (
    source.institutionLocation?.label ??
    source.institutionLocation?.city ??
    source.countryCode ??
    ""
  );
}

function fmtAgo(mins: number | null): string {
  if (mins == null) return "—";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type SortKey =
  | "name"
  | "type"
  | "method"
  | "items"
  | "accepted"
  | "markers"
  | "lastCheck"
  | "runtime";
type SortDir = "asc" | "desc";

type Tab = "all" | "errors" | "needsLocation" | "personal";

type Row = {
  source: SourceDefinition;
  status: SourceStatus;
  region: string;
  items: number;
  accepted: number;
  markers: number;
  domains: string[];
  lastCheckMins: number | null;
  runtime: RuntimeState;
  errorText: string | null;
  rawError: string | null;
  loading: boolean;
};

function currentSignalQuality(row: Row): string {
  if (row.loading) return "Checking";
  if (row.runtime === "error") return "Needs review";
  if (row.items === 0) return "Unrated";
  if (row.accepted === 0) return "Low yield";
  const acceptanceRate = row.accepted / row.items;
  if (row.runtime === "ok" && acceptanceRate >= 0.25 && row.markers > 0) return "Strong now";
  return "Usable now";
}

function percentage(part: number, total: number): string {
  if (total <= 0) return "â€”";
  return `${Math.round((part / total) * 100)}%`;
}

const COLS: { key: SortKey; label: string; align: "flex-start" | "flex-end" }[] =
  [
    { key: "name", label: "Source", align: "flex-start" },
    { key: "type", label: "Type", align: "flex-start" },
    { key: "method", label: "Method", align: "flex-start" },
    { key: "items", label: "Items", align: "flex-end" },
    { key: "accepted", label: "Accepted", align: "flex-end" },
    { key: "markers", label: "Markers", align: "flex-end" },
    { key: "lastCheck", label: "Last Check", align: "flex-start" },
    { key: "runtime", label: "Runtime", align: "flex-start" },
  ];

const GRID_COLS = "34px 2fr 1fr 0.95fr 0.7fr 0.7fr 0.7fr 1fr 1.2fr 86px";

// ─── small components ───
function KpiTile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: number | string;
  sub: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "0 0 0 12px",
        borderLeft: "1px solid var(--border-dim)",
      }}
    >
      <span
        style={{
          fontFamily: FONT.mono,
          fontSize: 8.5,
          letterSpacing: ".16em",
          textTransform: "uppercase",
          color: "var(--c-t5)",
        }}
      >
        {label}
      </span>
      <span
        style={{ fontFamily: FONT.mono, fontSize: 21, fontWeight: 600, color, lineHeight: 1.1 }}
      >
        {value}
      </span>
      <span style={{ fontFamily: FONT.mono, fontSize: 9, color: "var(--c-t4)" }}>{sub}</span>
    </div>
  );
}

function TopTab({
  active,
  label,
  count,
  dotColor,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  dotColor?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 42,
        padding: "0 16px",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: "transparent",
        border: "none",
        borderBottom: `2px solid ${active ? ACCENT : "transparent"}`,
        color: active ? "var(--c-t1)" : "var(--c-t4)",
        fontFamily: FONT.ui,
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        letterSpacing: ".01em",
        cursor: "pointer",
      }}
    >
      {dotColor && (
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: dotColor,
          }}
        />
      )}
      {label}
      <span
        style={{
          fontFamily: FONT.mono,
          fontSize: 9.5,
          padding: "1px 6px",
          borderRadius: 8,
          background: active ? "rgba(255,43,61,0.14)" : "rgba(255,255,255,0.04)",
          color: active ? ACCENT_TEXT : "var(--c-t5)",
        }}
      >
        {count}
      </span>
    </button>
  );
}

function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 9px",
        borderRadius: 4,
        fontFamily: FONT.mono,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        background: active ? "rgba(255,43,61,0.10)" : "rgba(255,255,255,0.022)",
        border: `1px solid ${active ? ACCENT_BORDER : "var(--border-primary)"}`,
        color: active ? ACCENT_TEXT : "var(--c-t3)",
        cursor: "pointer",
      }}
    >
      {label}
      <span style={{ fontFamily: FONT.mono, fontSize: 9, color: "rgba(132,142,156,0.6)" }}>
        {count}
      </span>
    </button>
  );
}

function SortHeader({
  label,
  columnKey,
  sortKey,
  sortDir,
  onSort,
  align,
}: {
  label: string;
  columnKey: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  align: "flex-start" | "flex-end";
}) {
  const active = sortKey === columnKey;
  return (
    <button
      type="button"
      onClick={() => onSort(columnKey)}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        fontFamily: FONT.mono,
        fontSize: 9.5,
        letterSpacing: ".14em",
        textTransform: "uppercase",
        color: active ? "var(--c-t2)" : "var(--c-t4)",
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        justifyContent: align,
        width: "100%",
        textAlign: align === "flex-end" ? "right" : "left",
        cursor: "pointer",
      }}
    >
      {label}
      {active && (
        <span style={{ color: "rgba(255,86,96,0.95)" }}>
          {sortDir === "asc" ? "▲" : "▼"}
        </span>
      )}
    </button>
  );
}

function MethodChip({ method }: { method: CollectionMethod }) {
  return (
    <span
      style={{
        fontFamily: FONT.mono,
        fontSize: 10,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        padding: "2px 7px",
        borderRadius: 3,
        background: "rgba(225,40,52,0.10)",
        border: "1px solid rgba(240,64,76,0.32)",
        color: "rgba(250,86,96,0.95)",
        whiteSpace: "nowrap",
      }}
    >
      {METHOD_LABELS[method]}
    </span>
  );
}

function RuntimeBadge({ runtime }: { runtime: RuntimeState }) {
  const s = RUNTIME_STYLES[runtime];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2.5px 7px",
        borderRadius: 4,
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.text,
        fontFamily: FONT.mono,
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: ".1em",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: s.dot,
          boxShadow: `0 0 6px ${s.dot}80`,
        }}
      />
      {s.label}
    </span>
  );
}

function ExpandPanel({
  row,
  personalBusy,
  personalError,
  onTogglePersonal,
  onDeletePersonal,
}: {
  row: Row;
  personalBusy: boolean;
  personalError: string | null;
  onTogglePersonal: (source: SourceDefinition) => void;
  onDeletePersonal: (source: SourceDefinition) => void;
}) {
  const { source } = row;
  const fields: [string, string][] = [
    ["Route", source.endpoint ?? "—"],
    ["Runtime Endpoint", source.feedUrl ?? source.endpoint ?? "—"],
    ["Expected Language", (source.language ?? "").toUpperCase() || "—"],
    ["Region", row.region || "—"],
    ["Cadence", "On demand"],
    ["Status Code", statusCodeFor(row.rawError)],
    ["Current Items", String(row.items)],
    ["Accepted Count", String(row.accepted)],
    ["Current Signal", currentSignalQuality(row)],
    ["Acceptance Rate", percentage(row.accepted, row.items)],
    ["Marker Yield", percentage(row.markers, row.accepted)],
  ];
  return (
    <div
      style={{
        padding: "14px 24px 18px 76px",
        background: "rgba(255,43,61,0.03)",
        borderBottom: "1px solid var(--border-dim)",
      }}
    >
      {row.errorText && (
        <div
          style={{
            marginBottom: 12,
            padding: "9px 12px",
            borderRadius: 5,
            background: "rgba(127,29,29,0.12)",
            border: "1px solid rgba(248,113,113,0.18)",
            color: "rgba(252,165,165,0.9)",
            fontSize: 11.5,
            lineHeight: 1.5,
            display: "flex",
            gap: 8,
          }}
        >
          <span style={{ fontWeight: 700 }}>!</span>
          <span>{row.errorText}</span>
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: "14px 24px",
        }}
      >
        {fields.map(([label, value]) => (
          <div
            key={label}
            style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}
          >
            <span
              style={{
                fontFamily: FONT.mono,
                fontSize: 8.5,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "var(--c-t5)",
              }}
            >
              {label}
            </span>
            <span
              title={value}
              style={{
                fontFamily: FONT.ui,
                fontSize: 12,
                color: "var(--c-t2)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
      <p
        style={{
          margin: "11px 0 0",
          color: "var(--c-t5)",
          fontFamily: FONT.mono,
          fontSize: 8.5,
          lineHeight: 1.5,
        }}
      >
        Current signal is based on the loaded snapshot, acceptance yield and map output; it is not a long-term source rating.
      </p>
      {source.origin === "personal" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
          <span style={{ color: "var(--c-t5)", fontFamily: FONT.mono, fontSize: 8.5, letterSpacing: ".12em", textTransform: "uppercase", marginRight: 4 }}>Personal source</span>
          <button type="button" disabled={personalBusy} onClick={() => onTogglePersonal(source)} style={{ height: 27, padding: "0 10px", color: "var(--c-t3)", fontFamily: FONT.ui, fontSize: 9, border: "1px solid var(--border-primary)", borderRadius: 5, background: "rgba(255,255,255,.025)", cursor: personalBusy ? "not-allowed" : "pointer" }}>
            {source.sourceStatus === "disabled" ? "Enable" : "Pause"}
          </button>
          <button type="button" disabled={personalBusy} onClick={() => onDeletePersonal(source)} style={{ height: 27, padding: "0 10px", color: "rgba(252,165,165,.9)", fontFamily: FONT.ui, fontSize: 9, border: "1px solid rgba(248,113,113,.2)", borderRadius: 5, background: "rgba(127,29,29,.1)", cursor: personalBusy ? "not-allowed" : "pointer" }}>
            Remove
          </button>
          {personalError && <span style={{ color: "rgba(252,165,165,.9)", fontSize: 10 }}>{personalError}</span>}
        </div>
      )}
      <div
        style={{
          marginTop: 14,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 8.5,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: "var(--c-t5)",
            marginRight: 4,
          }}
        >
          Domains
        </span>
        {row.domains.length > 0 ? (
          row.domains.map((d) => (
            <span
              key={d}
              style={{
                fontFamily: FONT.mono,
                fontSize: 9.5,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                padding: "3px 8px",
                borderRadius: 4,
                background: "rgba(176,184,196,0.07)",
                border: "1px solid rgba(176,184,196,0.2)",
                color: "rgba(176,184,196,0.88)",
              }}
            >
              {d}
            </span>
          ))
        ) : (
          <span
            style={{
              fontFamily: FONT.mono,
              fontSize: 10,
              color: "var(--c-t4)",
              fontStyle: "italic",
            }}
          >
            Domain whitelist not configured
          </span>
        )}
      </div>
    </div>
  );
}

export function SourcesScreen() {
  const {
    sources,
    eventCandidates,
    markerCandidates,
    itemCountBySourceId,
    collectedAtBySourceId,
    loadingBySourceId,
    errorBySourceId,
    previewSource,
    refreshSources,
  } = useSourceIntelligenceStore();

  const [requestedAtBySourceId, setRequestedAtBySourceId] = useState<
    Record<string, string>
  >({});
  const [tab, setTab] = useState<Tab>("all");
  const [methods, setMethods] = useState<Set<CollectionMethod>>(() => new Set());
  const [configs, setConfigs] = useState<Set<SourceStatus>>(() => new Set());
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("lastCheck");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [personalBusyId, setPersonalBusyId] = useState<string | null>(null);
  const [personalActionError, setPersonalActionError] = useState<string | null>(null);
  // "Last check" is relative-to-now; keep a clock value out of render and tick
  // it once a minute so the relative timestamps stay fresh. (A source refresh
  // updates collectedAt, which recomputes the rows against the current value.)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);

  // ─── store-derived per-source aggregates ───
  const acceptedBySourceId = useMemo(() => {
    return eventCandidates.reduce<Record<string, number>>((acc, item) => {
      acc[item.sourceId] = (acc[item.sourceId] ?? 0) + 1;
      return acc;
    }, {});
  }, [eventCandidates]);

  const markersBySourceId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const marker of markerCandidates) {
      const sourceIds = new Set(marker.items.map((item) => item.sourceId));
      for (const sourceId of sourceIds) {
        counts[sourceId] = (counts[sourceId] ?? 0) + 1;
      }
    }
    return counts;
  }, [markerCandidates]);

  const domainsBySourceId = useMemo(() => {
    const domains: Record<string, Set<string>> = {};
    for (const item of eventCandidates) {
      domains[item.sourceId] ??= new Set<string>();
      domains[item.sourceId].add(labelFor(item.primaryDomain));
    }
    return Object.fromEntries(
      Object.entries(domains).map(([sourceId, values]) => [
        sourceId,
        Array.from(values),
      ]),
    ) as Record<string, string[]>;
  }, [eventCandidates]);

  // Filter chips are catalog-driven: only render methods / config statuses that
  // actually occur in the live source set, so there are no structurally-empty
  // chips. The set is based on the full (unfiltered) catalog so chips stay
  // stable while filtering — only their counts change.
  const presentMethods = useMemo(
    () => METHODS.filter((m) => sources.some((s) => s.collectionMethod === m)),
    [sources],
  );
  const presentConfigs = useMemo(
    () =>
      CONFIGS.filter((c) =>
        sources.some((s) => (s.sourceStatus ?? "candidate") === c),
      ),
    [sources],
  );

  const handleRefresh = useCallback(
    (sourceId: string) => {
      setRequestedAtBySourceId((prev) => ({
        ...prev,
        [sourceId]: new Date().toISOString(),
      }));
      void previewSource(sourceId);
    },
    [previewSource],
  );

  const onSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else {
        setSortKey(key);
        setSortDir(key === "lastCheck" ? "desc" : "asc");
      }
    },
    [sortKey],
  );

  const toggleMethod = useCallback((m: CollectionMethod) => {
    setMethods((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  }, []);

  const toggleConfig = useCallback((c: SourceStatus) => {
    setConfigs((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }, []);

  const derived = useMemo(() => {
    const base: Row[] = sources.map((source) => {
      const status = source.sourceStatus ?? "candidate";
      const items = itemCountBySourceId[source.id] ?? 0;
      const accepted = acceptedBySourceId[source.id] ?? 0;
      const markers = markersBySourceId[source.id] ?? 0;
      const rawError = errorBySourceId[source.id] ?? null;
      const errorText = formatSourceError(rawError);
      const loading = loadingBySourceId[source.id] ?? false;

      let runtime: RuntimeState;
      if (errorText) runtime = "error";
      else if (accepted === 0 && items > 0) runtime = "warn";
      else if (accepted > 0) runtime = "ok";
      else runtime = "idle";

      const stamp =
        collectedAtBySourceId[source.id] ?? requestedAtBySourceId[source.id];
      const lastCheckMins = stamp
        ? Math.max(0, Math.floor((now - new Date(stamp).getTime()) / 60000))
        : null;

      return {
        source,
        status,
        region: regionOf(source),
        items,
        accepted,
        markers,
        domains: domainsBySourceId[source.id] ?? [],
        lastCheckMins,
        runtime,
        errorText,
        rawError,
        loading,
      };
    });

    const ql = q.trim().toLowerCase();
    const matchesQ = (r: Row) =>
      !ql ||
      r.source.name.toLowerCase().includes(ql) ||
      (TYPE_LABELS[r.source.sourceType] || "").toLowerCase().includes(ql) ||
      (METHOD_LABELS[r.source.collectionMethod] || "").toLowerCase().includes(ql) ||
      r.region.toLowerCase().includes(ql) ||
      r.domains.join(" ").toLowerCase().includes(ql);
    const passesTab = (r: Row) => {
      if (tab === "all") return true;
      if (tab === "errors") return r.runtime === "error";
      if (tab === "needsLocation") return !r.region;
      if (tab === "personal") return r.source.origin === "personal";
      return true;
    };
    const passesMethods = (r: Row) =>
      methods.size === 0 || methods.has(r.source.collectionMethod);
    const passesConfigs = (r: Row) =>
      configs.size === 0 || configs.has(r.status);

    const filtered = base.filter(
      (r) => passesTab(r) && passesMethods(r) && passesConfigs(r) && matchesQ(r),
    );

    const dir = sortDir === "asc" ? 1 : -1;
    const accessors: Record<SortKey, (r: Row) => number | string> = {
      name: (r) => r.source.name.toLowerCase(),
      type: (r) => (TYPE_LABELS[r.source.sourceType] || "").toLowerCase(),
      method: (r) => (METHOD_LABELS[r.source.collectionMethod] || "").toLowerCase(),
      items: (r) => r.items,
      accepted: (r) => r.accepted,
      markers: (r) => r.markers,
      lastCheck: (r) =>
        r.lastCheckMins == null ? Number.POSITIVE_INFINITY : r.lastCheckMins,
      runtime: (r) => ["ok", "warn", "error", "idle"].indexOf(r.runtime),
    };
    const acc = accessors[sortKey];
    const rows = [...filtered].sort((a, b) => {
      const va = acc(a);
      const vb = acc(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });

    // KPIs over the filtered view.
    const minsList = rows
      .map((r) => r.lastCheckMins)
      .filter((v): v is number => v != null);
    const kpi = {
      total: rows.length,
      ok: rows.filter((r) => r.runtime === "ok").length,
      warn: rows.filter((r) => r.runtime === "warn").length,
      errors: rows.filter((r) => r.runtime === "error").length,
      needsLoc: rows.filter((r) => !r.region).length,
      lastSweep: minsList.length ? Math.min(...minsList) : null,
    };

    // Chip counts: what selecting that chip alone (with other surfaces) yields.
    const methodCounts: Record<string, number> = {};
    for (const m of METHODS) {
      methodCounts[m] = base.filter(
        (r) =>
          r.source.collectionMethod === m &&
          passesTab(r) &&
          passesConfigs(r) &&
          matchesQ(r),
      ).length;
    }
    const configCounts: Record<string, number> = {};
    for (const c of CONFIGS) {
      configCounts[c] = base.filter(
        (r) =>
          r.status === c && passesTab(r) && passesMethods(r) && matchesQ(r),
      ).length;
    }

    const tabBase = base.filter(
      (r) => passesMethods(r) && passesConfigs(r) && matchesQ(r),
    );
    const tabCounts = {
      all: tabBase.length,
      errors: tabBase.filter((r) => r.runtime === "error").length,
      needsLocation: tabBase.filter((r) => !r.region).length,
      personal: tabBase.filter((r) => r.source.origin === "personal")
        .length,
    };

    return { rows, kpi, methodCounts, configCounts, tabCounts };
  }, [
    now,
    sources,
    itemCountBySourceId,
    acceptedBySourceId,
    markersBySourceId,
    domainsBySourceId,
    collectedAtBySourceId,
    requestedAtBySourceId,
    errorBySourceId,
    loadingBySourceId,
    tab,
    methods,
    configs,
    q,
    sortKey,
    sortDir,
  ]);

  const handleRefreshAll = useCallback(() => {
    const now = new Date().toISOString();
    const ids = derived.rows.map((r) => r.source.id);
    if (ids.length === 0) return;
    setRequestedAtBySourceId((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = now;
      return next;
    });
    for (const id of ids) void previewSource(id);
  }, [derived.rows, previewSource]);

  const handleTogglePersonal = useCallback(async (source: SourceDefinition) => {
    setPersonalBusyId(source.id);
    setPersonalActionError(null);
    try {
      const response = await fetch("/api/sources/personal", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: source.id,
          enabled: source.sourceStatus === "disabled",
        }),
      });
      if (!response.ok) throw new Error("Source status could not be updated.");
      await refreshSources();
    } catch (error) {
      setPersonalActionError(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setPersonalBusyId(null);
    }
  }, [refreshSources]);

  const handleDeletePersonal = useCallback(async (source: SourceDefinition) => {
    if (!window.confirm(`Remove ${source.name} from this EchisWorld installation?`)) return;
    setPersonalBusyId(source.id);
    setPersonalActionError(null);
    try {
      const response = await fetch(`/api/sources/personal?sourceId=${encodeURIComponent(source.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Source could not be removed.");
      setExpandedId(null);
      await refreshSources();
    } catch (error) {
      setPersonalActionError(error instanceof Error ? error.message : "Remove failed.");
    } finally {
      setPersonalBusyId(null);
    }
  }, [refreshSources]);

  return (
    <main
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
      style={{ background: "var(--c-bg-base)", fontFamily: FONT.ui }}
    >
      {/* TITLE + KPI STRIP */}
      <div
        style={{
          flex: "none",
          padding: "18px 24px 14px 24px",
          borderBottom: "1px solid var(--border-dim)",
          display: "flex",
          alignItems: "flex-end",
          gap: 24,
        }}
      >
        <div style={{ minWidth: 230 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: ACCENT,
                boxShadow: "0 0 10px rgba(255,43,61,0.7)",
                animation: "pulseDot 2.4s ease-in-out infinite",
              }}
            />
            <span
              style={{
                fontFamily: FONT.mono,
                fontSize: 9.5,
                letterSpacing: ".18em",
                textTransform: "uppercase",
                color: "var(--c-t4)",
              }}
            >
              Source Intelligence Registry
            </span>
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 600,
              color: "var(--c-t1)",
              letterSpacing: "-0.005em",
            }}
          >
            Runtime Sources
          </h1>
        </div>
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "repeat(6,1fr)",
            gap: 14,
          }}
        >
          <KpiTile label="Total" value={derived.kpi.total} sub="in view" color="var(--c-t1)" />
          <KpiTile label="OK Now" value={derived.kpi.ok} sub="runtime" color="rgba(176,184,196,0.82)" />
          <KpiTile label="Warn" value={derived.kpi.warn} sub="filtered" color="rgba(251,191,36,0.95)" />
          <KpiTile label="Errors" value={derived.kpi.errors} sub="need fix" color="rgba(252,165,165,0.95)" />
          <KpiTile label="Needs Location" value={derived.kpi.needsLoc} sub="no region" color="rgba(251,191,36,0.95)" />
          <KpiTile
            label="Last Sweep"
            value={derived.kpi.lastSweep == null ? "—" : `${derived.kpi.lastSweep}m`}
            sub="most recent"
            color="rgba(214,219,226,0.92)"
          />
        </div>
      </div>

      {/* TAB BAR */}
      <div
        style={{
          flex: "none",
          height: 42,
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          borderBottom: "1px solid var(--border-dim)",
          background: "linear-gradient(180deg,rgba(20,16,18,0.18),rgba(7,5,7,0.3))",
        }}
      >
        <TopTab active={tab === "all"} label="All Sources" count={derived.tabCounts.all} onClick={() => setTab("all")} />
        <TopTab active={tab === "errors"} label="Errors" count={derived.tabCounts.errors} dotColor="#ff2b3d" onClick={() => setTab("errors")} />
        <TopTab active={tab === "needsLocation"} label="Needs Location" count={derived.tabCounts.needsLocation} dotColor="rgba(251,191,36,0.9)" onClick={() => setTab("needsLocation")} />
        <TopTab active={tab === "personal"} label="Personal" count={derived.tabCounts.personal} dotColor="rgba(176,184,196,0.7)" onClick={() => setTab("personal")} />
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ position: "relative", width: 240 }}>
            <span
              style={{
                position: "absolute",
                left: 11,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 12,
                color: "var(--c-t5)",
              }}
            >
              ⌕
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${sources.length} sources…`}
              style={{
                width: "100%",
                height: 28,
                padding: "0 12px 0 28px",
                background: "rgba(255,255,255,0.022)",
                border: "1px solid var(--border-primary)",
                borderRadius: 14,
                color: "var(--c-t2)",
                fontFamily: FONT.ui,
                fontSize: 11.5,
                outline: "none",
              }}
            />
          </div>
          <button
            type="button"
            onClick={handleRefreshAll}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: `1px solid ${ACCENT_BORDER}`,
              background: "linear-gradient(90deg,rgba(179,18,31,0.24),rgba(255,43,61,0.18))",
              color: ACCENT_TEXT,
              fontFamily: FONT.ui,
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Refresh All
          </button>
          <PersonalSourceManager onCreated={refreshSources} />
        </div>
      </div>

      {/* METHOD + CONFIG FILTER ROW */}
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 24px",
          borderBottom: "1px solid var(--border-dim)",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 9,
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: "var(--c-t5)",
          }}
        >
          Method
        </span>
        {presentMethods.map((m) => (
          <FilterChip
            key={m}
            label={METHOD_LABELS[m]}
            count={derived.methodCounts[m]}
            active={methods.has(m)}
            onClick={() => toggleMethod(m)}
          />
        ))}
        <span style={{ width: 1, height: 14, background: "var(--border-dim)", margin: "0 6px" }} />
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 9,
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: "var(--c-t5)",
          }}
        >
          Config
        </span>
        {presentConfigs.map((c) => (
          <FilterChip
            key={c}
            label={STATUS_LABELS[c]}
            count={derived.configCounts[c]}
            active={configs.has(c)}
            onClick={() => toggleConfig(c)}
          />
        ))}
      </div>

      {/* TABLE */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* Header */}
        <div
          style={{
            flex: "none",
            display: "grid",
            gridTemplateColumns: GRID_COLS,
            alignItems: "center",
            padding: "0 24px",
            height: 34,
            background: "rgba(255,255,255,0.012)",
            borderBottom: "1px solid var(--border-primary)",
          }}
        >
          <span />
          {COLS.map((c) => (
            <div key={c.key} style={{ paddingRight: c.align === "flex-end" ? 14 : 0 }}>
              <SortHeader
                label={c.label}
                columnKey={c.key}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                align={c.align}
              />
            </div>
          ))}
          <span />
        </div>

        {/* Body */}
        <div className="tm-scrollbar" style={{ flex: 1, overflowY: "auto" }}>
          {derived.rows.map((r) => {
            const expanded = expandedId === r.source.id;
            const rs = RUNTIME_STYLES[r.runtime];
            const href = r.source.feedUrl ?? r.source.endpoint;
            return (
              <Fragment key={r.source.id}>
                <div
                  onClick={() => setExpandedId(expanded ? null : r.source.id)}
                  className={expanded ? undefined : "sources-v2-row"}
                  style={{
                    display: "grid",
                    gridTemplateColumns: GRID_COLS,
                    alignItems: "center",
                    padding: "0 24px",
                    minHeight: 44,
                    borderBottom: "1px solid rgba(255,255,255,0.025)",
                    cursor: "pointer",
                    background: expanded ? "rgba(255,43,61,0.04)" : "transparent",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 18,
                      height: 18,
                      color: "rgba(132,142,156,0.6)",
                      fontSize: 9,
                      fontFamily: FONT.mono,
                    }}
                  >
                    {expanded ? "▾" : "▸"}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: rs.dot,
                        boxShadow: `0 0 6px ${rs.dot}80`,
                        flex: "none",
                      }}
                    />
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: 500,
                        color: "var(--c-t1)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.source.name}
                    </span>
                    {r.source.origin === "personal" && <span style={{ flex: "none", padding: "1px 5px", color: "rgba(176,184,196,.72)", fontFamily: FONT.mono, fontSize: 7.5, letterSpacing: ".08em", textTransform: "uppercase", border: "1px solid rgba(176,184,196,.16)", borderRadius: 3 }}>Personal</span>}
                  </span>
                  <span
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: 10.5,
                      color: "var(--c-t3)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {TYPE_LABELS[r.source.sourceType]}
                  </span>
                  <span>
                    <MethodChip method={r.source.collectionMethod} />
                  </span>
                  <span style={{ fontFamily: FONT.mono, fontSize: 12, color: "var(--c-t2)", textAlign: "right", paddingRight: 14 }}>
                    {r.items}
                  </span>
                  <span
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: 12,
                      color: r.accepted > 0 ? "rgba(255,86,96,0.95)" : "var(--c-t5)",
                      textAlign: "right",
                      paddingRight: 14,
                    }}
                  >
                    {r.accepted}
                  </span>
                  <span style={{ fontFamily: FONT.mono, fontSize: 12, color: "var(--c-t3)", textAlign: "right", paddingRight: 14 }}>
                    {r.markers}
                  </span>
                  <span
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: 10.5,
                      color: "var(--c-t4)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fmtAgo(r.lastCheckMins)}
                  </span>
                  <span>
                    <RuntimeBadge runtime={r.runtime} />
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRefresh(r.source.id);
                      }}
                      title="Refresh source"
                      className="sources-v2-iconbtn"
                      style={{
                        width: 26,
                        height: 26,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 5,
                        border: "1px solid var(--border-primary)",
                        background: "rgba(255,255,255,0.016)",
                        color: "var(--c-t3)",
                        cursor: "pointer",
                      }}
                    >
                      <span className={r.loading ? "animate-spin" : undefined} style={{ display: "inline-flex" }}>
                        ↻
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (href) window.open(href, "_blank", "noopener,noreferrer");
                      }}
                      disabled={!href}
                      title={href ? "Open source" : "No source URL"}
                      className="sources-v2-iconbtn"
                      style={{
                        width: 26,
                        height: 26,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 5,
                        border: "1px solid var(--border-primary)",
                        background: "rgba(255,255,255,0.016)",
                        color: "var(--c-t3)",
                        cursor: href ? "pointer" : "not-allowed",
                        opacity: href ? 1 : 0.45,
                      }}
                    >
                      ↗
                    </button>
                  </span>
                </div>

                {expanded && <ExpandPanel
                  row={r}
                  personalBusy={personalBusyId === r.source.id}
                  personalError={personalBusyId === r.source.id || r.source.origin !== "personal" ? null : personalActionError}
                  onTogglePersonal={(source) => void handleTogglePersonal(source)}
                  onDeletePersonal={(source) => void handleDeletePersonal(source)}
                />}
              </Fragment>
            );
          })}
          {derived.rows.length === 0 && (
            <div
              style={{
                padding: "40px 24px",
                textAlign: "center",
                color: "var(--c-t4)",
                fontFamily: FONT.mono,
                fontSize: 11,
                letterSpacing: ".1em",
                textTransform: "uppercase",
              }}
            >
              No sources match the current filter.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
