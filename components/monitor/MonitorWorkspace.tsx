"use client";

import {
  Bell,
  Bookmark,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Globe2,
  Layers3,
  Map as MapIcon,
  MapPin,
  Minus,
  Plus,
  Search,
  Save,
  Shield,
  SlidersHorizontal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { GeoLiveClock } from "@/components/ui/GeoLiveClock";
import { useSourceIntelligenceItems } from "@/components/source-intelligence/useSourceIntelligenceItems";
import { useCyberNewsFeed } from "@/components/cyber/useCyberNewsFeed";
import { useDefenseIndustryFeed } from "@/components/defense-industry/useDefenseIndustryFeed";
import { usePolicyFeed } from "@/components/policy/usePolicyFeed";
import {
  MonitorMap,
  type MonitorGeography,
  type MonitorMapHandle,
  type MonitorMapEngineState,
  type MonitorMapMarker,
  type MonitorProjection,
} from "./MonitorMap";
import type { IntelligenceEventCandidate } from "@/data/source-intelligence/sourceIntelligenceTypes";
import type { SourceBookmarkSnapshot } from "@/components/events/useBookmarks";
import { confidenceTier } from "@/lib/sourceintel/feedInsights";
import {
  COUNTRY_COORDS,
  extractCountriesFromText,
} from "@/lib/sources/countryCoords";
import {
  clusterMonitorReports,
  downloadReportExport,
  matchesMonitorView,
  type MonitorReportEntry,
  type MonitorReportLayer,
  type MonitorTimeWindow,
  type MonitorViewFilters,
  type ReportExportFormat,
} from "./monitorReportTools";
import { useMonitorViews } from "./useMonitorViews";
import styles from "./MonitorWorkspace.module.css";

type LayerKey = MonitorReportLayer;
type FeedState = "fresh" | "partial" | "stale" | "unavailable" | "loading";
type MarkerCategory = MonitorMapMarker["category"];
type TimeWindowHours = MonitorTimeWindow;

type MonitorWorkspaceProps = {
  isActive: boolean;
  bookmarkCount: number;
  onOpenBookmarks: () => void;
  onOpenSources: () => void;
  isReportBookmarked: (id: string) => boolean;
  onToggleReportBookmark: (item: Omit<SourceBookmarkSnapshot, "savedAt">) => void;
};

type GeocodeResult = {
  id: string;
  name: string;
  displayName: string;
  level: string;
  context: string;
  center: [number, number];
  bbox: [number, number, number, number];
};

type ContextEntry = MonitorReportEntry;

type ArticleContentState = {
  entryKey: string;
  status: "loading" | "ready" | "unavailable";
  text?: string;
  byline?: string | null;
  siteName?: string | null;
  wordCount?: number;
};

const LAYER_META: Array<{
  key: LayerKey;
  label: string;
  group: "intelligence";
  icon: typeof Globe2;
}> = [
  { key: "global", label: "Global reports", group: "intelligence", icon: Globe2 },
  { key: "cyber", label: "Cyber", group: "intelligence", icon: Zap },
  { key: "defense", label: "Defense", group: "intelligence", icon: Shield },
  { key: "policy", label: "Policy", group: "intelligence", icon: Building2 },
];

const NETWORK_BRANCH_BASE = 12;
const NETWORK_BRANCH_MAX = 18;
const TIME_WINDOW_OPTIONS: readonly TimeWindowHours[] = [1, 6, 12, 24, "all"];
const HOUR_MS = 60 * 60 * 1000;

function timestampOf(...values: Array<string | null | undefined>): number | null {
  for (const value of values) {
    if (!value) continue;
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

function isWithinTimeWindow(
  cutoff: number | null,
  ...values: Array<string | null | undefined>
): boolean {
  if (cutoff === null) return true;
  const timestamp = timestampOf(...values);
  return timestamp !== null && timestamp >= cutoff;
}

function networkCardPosition(index: number, total: number): { x: number; y: number } {
  if (total <= 1) return { x: 50, y: 15 };
  if (total > NETWORK_BRANCH_BASE) {
    const outer = index % 2 === 0;
    const ringIndex = Math.floor(index / 2);
    const ringTotal = outer ? Math.ceil(total / 2) : Math.floor(total / 2);
    const angleOffset = outer ? -Math.PI / 2 : -Math.PI / 2 + Math.PI / ringTotal;
    const angle = angleOffset + (ringIndex * Math.PI * 2) / ringTotal;
    return {
      x: 50 + Math.cos(angle) * (outer ? 39 : 25.5),
      y: 50 + Math.sin(angle) * (outer ? 39 : 26.5),
    };
  }
  const startAngle = total === 2 ? Math.PI : -Math.PI / 2;
  const angle = startAngle + (index * Math.PI * 2) / total;
  return {
    x: 50 + Math.cos(angle) * 33,
    y: 50 + Math.sin(angle) * 34,
  };
}

function relativeTime(value?: string | null): string {
  if (!value) return "Time unavailable";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Time unavailable";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const LEVEL_RANK: Record<MonitorMapMarker["level"], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const COUNTRY_LABEL_BY_LOWERCASE = new Map(
  Object.keys(COUNTRY_COORDS).map((country) => [country.toLocaleLowerCase("en-US"), country]),
);

const MARKER_LABEL_ALIASES = new Map<string, string>([
  ["bolivia (plurinational state of)", "Bolivia"],
  ["bosnia and herz.", "Bosnia and Herzegovina"],
  ["central african rep.", "Central African Republic"],
  ["czech republic", "Czechia"],
  ["dem. rep. congo", "Democratic Republic of the Congo"],
  ["democratic republic of the congo", "Democratic Republic of the Congo"],
  ["dominican rep.", "Dominican Republic"],
  ["dr congo", "Democratic Republic of the Congo"],
  ["eq. guinea", "Equatorial Guinea"],
  ["gaza", "Palestine"],
  ["gaza strip", "Palestine"],
  ["macedonia", "North Macedonia"],
  ["n. cyprus", "Cyprus"],
  ["republic of korea", "South Korea"],
  ["russian federation", "Russia"],
  ["palestine / gaza", "Palestine"],
  ["palestinian territories", "Palestine"],
  ["s. sudan", "South Sudan"],
  ["solomon is.", "Solomon Islands"],
  ["state of palestine", "Palestine"],
  ["syrian arab republic", "Syria"],
  ["turkiye", "Turkey"],
  ["türkiye", "Turkey"],
  ["united republic of tanzania", "Tanzania"],
  ["united states of america", "United States"],
  ["venezuela (bolivarian republic of)", "Venezuela"],
  ["viet nam", "Vietnam"],
  ["w. sahara", "Western Sahara"],
  ["west bank", "Palestine"],
  ["eswatini", "Eswatini"],
]);

function canonicalMarkerLabel(label: string): string {
  const clean = label.trim().replace(/\s+/g, " ");
  const lowercase = clean.toLocaleLowerCase("en-US");
  return MARKER_LABEL_ALIASES.get(lowercase) ?? COUNTRY_LABEL_BY_LOWERCASE.get(lowercase) ?? clean;
}

const COUNTRY_DISPLAY_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

function countryNameFromCode(code?: string): string | null {
  if (!code || !/^[a-z]{2}$/i.test(code)) return null;
  const label = COUNTRY_DISPLAY_NAMES.of(code.toUpperCase());
  return label && label !== code.toUpperCase() ? label : null;
}

function countryKeysForEntry(labels: Array<string | null | undefined>, text: string): string[] {
  const assigned = labels.filter(
    (label): label is string => Boolean(label?.trim()) && label?.toLocaleLowerCase("en-US") !== "global",
  );
  // Structured feed/geo assignments take precedence. Text scanning is only a
  // fallback for records whose upstream payload carries no country metadata.
  const candidates = assigned.length > 0 ? assigned : extractCountriesFromText(text);
  return Array.from(
    new Set(
      candidates
        .map((label) => canonicalMarkerLabel(label).toLocaleLowerCase("en-US")),
    ),
  );
}

function strongestLevel(
  current: MonitorMapMarker["level"],
  next: MonitorMapMarker["level"],
): MonitorMapMarker["level"] {
  return LEVEL_RANK[next] > LEVEL_RANK[current] ? next : current;
}

type DerivedMarkerGroup = {
  category: "cyber" | "defense" | "policy";
  country: string;
  lng: number;
  lat: number;
  count: number;
  level: MonitorMapMarker["level"];
};

function addDerivedMarker(
  groups: Map<string, DerivedMarkerGroup>,
  category: DerivedMarkerGroup["category"],
  country: string | undefined,
  level: MonitorMapMarker["level"],
): void {
  if (!country) return;
  const coordinates = COUNTRY_COORDS[country];
  if (!coordinates) return;
  const key = `${category}:${country}`;
  const existing = groups.get(key);
  if (existing) {
    existing.count += 1;
    existing.level = strongestLevel(existing.level, level);
    return;
  }
  groups.set(key, {
    category,
    country,
    lng: coordinates.lng,
    lat: coordinates.lat,
    count: 1,
    level,
  });
}

function stateLabel(state: FeedState): string {
  if (state === "fresh") return "Live";
  if (state === "partial") return "Partial";
  if (state === "stale") return "Stale";
  if (state === "loading") return "Loading";
  return "Unavailable";
}

function readableToken(value?: string | null): string | null {
  if (!value) return null;
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function globalContextEntry(item: IntelligenceEventCandidate): ContextEntry {
  const summary = item.summary ?? "No summary supplied by the source.";
  const resolved = item.resolvedLocation;
  const coordinates = resolved &&
    typeof resolved.longitude === "number" &&
    typeof resolved.latitude === "number"
    ? [resolved.longitude, resolved.latitude] as [number, number]
    : undefined;
  const confidence = confidenceTier(item);
  const provenance = [
    { label: "Confidence", value: `${confidence.label} display confidence` },
    { label: "Verification", value: readableToken(item.verificationStatus) ?? "Not supplied" },
    { label: "Source basis", value: readableToken(item.sourceBasis) ?? "Not supplied" },
    { label: "Collection", value: readableToken(item.collectionMethod) ?? "Not supplied" },
    { label: "Extraction", value: readableToken(item.extractionMethod) ?? "Not supplied" },
    { label: "Event type", value: readableToken(item.eventType) ?? "Not classified" },
    { label: "Map decision", value: readableToken(item.markerReason ?? item.noMarkerReason) ?? "Feed only" },
    { label: "Geo method", value: readableToken(item.geoBasis?.resolutionMethod) ?? "Not resolved" },
  ];
  return {
    id: item.id,
    layer: "global",
    title: item.title,
    summary,
    source: item.sourceName,
    time: relativeTime(item.publishedAt ?? item.collectedAt),
    countryKeys: countryKeysForEntry(
      [
        item.geoBasis?.label,
        item.geoBasis?.region,
        countryNameFromCode(item.geoBasis?.countryCode),
        resolved?.label,
        resolved?.region,
        countryNameFromCode(resolved?.countryCode),
        item.item?.eventCountry,
        item.item?.sourceCountry,
        ...(item.item?.actorCountries ?? []),
        ...(item.item?.mentionedCountries ?? []),
      ],
      `${item.title} ${summary}`,
    ),
    url: item.url,
    tone: item.primaryDomain.replaceAll("_", " "),
    publishedAt: item.publishedAt ?? item.collectedAt,
    coordinates,
    priorityScore: item.priorityScore,
    provenance,
    evidence: item.geoBasis?.evidenceDetails
      ?.filter((evidence) => evidence.acceptedForMarker)
      .slice(0, 4)
      .map((evidence) => evidence.evidenceText),
  };
}

export function MonitorWorkspace({
  isActive,
  bookmarkCount,
  onOpenBookmarks,
  onOpenSources,
  isReportBookmarked,
  onToggleReportBookmark,
}: MonitorWorkspaceProps) {
  const mapRef = useRef<MonitorMapHandle | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const leftPanelCloseTimerRef = useRef<number | null>(null);
  const networkCloseTimerRef = useRef<number | null>(null);
  const articleRequestRef = useRef<AbortController | null>(null);
  const articleContentCacheRef = useRef(new Map<string, ArticleContentState>());
  const layerPanelRef = useRef<HTMLElement | null>(null);
  const sourceFeed = useSourceIntelligenceItems();
  const cyber = useCyberNewsFeed();
  const defense = useDefenseIndustryFeed();
  const policy = usePolicyFeed();
  const monitorViews = useMonitorViews();
  const evaluateMonitorAlerts = monitorViews.evaluateAlerts;
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    global: true,
    cyber: false,
    defense: false,
    policy: false,
  });
  const [activeLayer, setActiveLayer] = useState<LayerKey>("global");
  const [selectedMarker, setSelectedMarker] = useState<MonitorMapMarker | null>(null);
  const [selectedGeography, setSelectedGeography] = useState<MonitorGeography | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<ContextEntry | null>(null);
  const [articleContent, setArticleContent] = useState<ArticleContentState | null>(null);
  const [networkClosing, setNetworkClosing] = useState(false);
  const [networkCategoryFilter, setNetworkCategoryFilter] = useState<"all" | LayerKey>("global");
  const [networkNavigation, setNetworkNavigation] = useState({ key: "", page: 0 });
  const [projection, setProjection] = useState<MonitorProjection>("globe");
  const [showLabels, setShowLabels] = useState(true);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [showReportDensity, setShowReportDensity] = useState(false);
  const [mapEngineState, setMapEngineState] = useState<MonitorMapEngineState>("loading");
  const [layerQuery, setLayerQuery] = useState("");
  const [layerTab, setLayerTab] = useState<"all" | "enabled">("all");
  const [reportQuery, setReportQuery] = useState("");
  const [reportSource, setReportSource] = useState("");
  const [reportOrder, setReportOrder] = useState<"newest" | "oldest">("newest");
  const [exportFormat, setExportFormat] = useState<ReportExportFormat>("csv");
  const [selectedSavedViewId, setSelectedSavedViewId] = useState("");
  const [timeWindowHours, setTimeWindowHours] = useState<TimeWindowHours>("all");
  const [timeNow, setTimeNow] = useState(() => Date.now());
  const [searchQuery, setSearchQuery] = useState("");
  const [places, setPlaces] = useState<GeocodeResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [mapViewportPadding, setMapViewportPadding] = useState({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
  const sourceMarkers = sourceFeed.markers;
  const sourceItems = sourceFeed.items;
  const timeCutoff = timeWindowHours === "all" ? null : timeNow - timeWindowHours * HOUR_MS;
  const windowedSourceItems = useMemo(
    () => sourceItems.filter((item) => isWithinTimeWindow(timeCutoff, item.publishedAt, item.collectedAt)),
    [sourceItems, timeCutoff],
  );
  const windowedCyberItems = useMemo(
    () => cyber.items.filter((item) => isWithinTimeWindow(timeCutoff, item.publishedAt)),
    [cyber.items, timeCutoff],
  );
  const windowedDefenseItems = useMemo(
    () => defense.items.filter((item) => isWithinTimeWindow(timeCutoff, item.publishedAt)),
    [defense.items, timeCutoff],
  );
  const windowedPolicyItems = useMemo(
    () => policy.items.filter((item) => isWithinTimeWindow(timeCutoff, item.publishedAt, item.collectedAt)),
    [policy.items, timeCutoff],
  );

  const markers = useMemo<MonitorMapMarker[]>(() => {
    const next: MonitorMapMarker[] = [];
    if (layers.global) {
      for (const marker of sourceMarkers) {
        const recentItems = marker.items.filter((item) =>
          isWithinTimeWindow(timeCutoff, item.publishedAt, item.collectedAt),
        );
        if (recentItems.length === 0) continue;
        const sourceCount = new Set(recentItems.map((item) => item.sourceId)).size;
        const level = marker.candidate.severity === "high_interest"
          ? "high"
          : marker.candidate.severity === "important"
            ? "medium"
            : "low";
        next.push({
          id: `global-${marker.id}`,
          lng: marker.lng,
          lat: marker.lat,
          label: marker.locationName,
          reportCount: recentItems.length,
          detail: `${recentItems.length} ${recentItems.length === 1 ? "report" : "reports"} · ${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`,
          level,
          category: "global",
        });
      }
    }
    const derived = new Map<string, DerivedMarkerGroup>();

    if (layers.cyber) {
      const annotationById = new Map(
        (cyber.analysis?.annotations ?? []).map((annotation) => [annotation.id, annotation]),
      );
      for (const item of windowedCyberItems) {
        const countries = annotationById.get(item.id)?.countries ?? [];
        const primary =
          countries.find((hit) => hit.primaryRole === "target") ?? countries[0];
        addDerivedMarker(
          derived,
          "cyber",
          primary?.country,
          primary?.confidence === "high" ? "high" : "medium",
        );
      }
    }
    if (layers.defense) {
      for (const item of windowedDefenseItems) {
        const countries = item.countries ?? [];
        const primary =
          countries.find((hit) => hit.role === "buyer") ?? countries[0];
        const priority = item.priority.toLowerCase();
        addDerivedMarker(
          derived,
          "defense",
          primary?.country,
          priority.includes("critical")
            ? "critical"
            : priority.includes("high")
              ? "high"
              : "medium",
        );
      }
    }
    if (layers.policy) {
      for (const item of windowedPolicyItems) {
        addDerivedMarker(
          derived,
          "policy",
          item.countries?.[0]?.country,
          item.sev === "critical" || item.sev === "high"
            ? item.sev
            : item.sev === "medium"
              ? "medium"
              : "low",
        );
      }
    }
    for (const marker of derived.values()) {
      next.push({
        id: `${marker.category}-${marker.country}`,
        lng: marker.lng,
        lat: marker.lat,
        label: marker.country,
        reportCount: marker.count,
        detail: `${marker.count} ${marker.category} ${marker.count === 1 ? "report" : "reports"}`,
        level: marker.level,
        category: marker.category,
      });
    }
    const consolidated = new Map<string, {
      label: string;
      lng: number;
      lat: number;
      reportCount: number;
      level: MonitorMapMarker["level"];
      categoryCounts: Map<MarkerCategory, number>;
    }>();

    for (const marker of next) {
      const label = canonicalMarkerLabel(marker.label);
      const key = label.toLocaleLowerCase("en-US");
      const fixedCoordinates = COUNTRY_COORDS[label];
      const existing = consolidated.get(key);
      if (existing) {
        const total = existing.reportCount + marker.reportCount;
        if (!fixedCoordinates) {
          existing.lng = (existing.lng * existing.reportCount + marker.lng * marker.reportCount) / total;
          existing.lat = (existing.lat * existing.reportCount + marker.lat * marker.reportCount) / total;
        }
        existing.reportCount = total;
        existing.level = strongestLevel(existing.level, marker.level);
        existing.categoryCounts.set(
          marker.category,
          (existing.categoryCounts.get(marker.category) ?? 0) + marker.reportCount,
        );
        continue;
      }
      consolidated.set(key, {
        label,
        lng: fixedCoordinates?.lng ?? marker.lng,
        lat: fixedCoordinates?.lat ?? marker.lat,
        reportCount: marker.reportCount,
        level: marker.level,
        categoryCounts: new Map([[marker.category, marker.reportCount]]),
      });
    }

    return Array.from(consolidated.entries(), ([key, marker]) => {
      const categories = Array.from(marker.categoryCounts.keys());
      const category = categories.includes(activeLayer as MarkerCategory)
        ? activeLayer as MarkerCategory
        : categories[0];
      const breakdown = Array.from(marker.categoryCounts.entries())
        .map(([name, count]) => `${name} ${count}`)
        .join(" / ");
      return {
        id: `geo-${key}`,
        lng: marker.lng,
        lat: marker.lat,
        label: marker.label,
        detail: `${marker.reportCount} processed ${marker.reportCount === 1 ? "report" : "reports"} · ${breakdown}`,
        reportCount: marker.reportCount,
        level: marker.level,
        category,
      };
    });
  }, [activeLayer, cyber.analysis, layers, sourceMarkers, timeCutoff, windowedCyberItems, windowedDefenseItems, windowedPolicyItems]);

  const layerCounts: Record<LayerKey, number | null> = useMemo(() => ({
    global: windowedSourceItems.length,
    cyber: windowedCyberItems.length,
    defense: windowedDefenseItems.length,
    policy: windowedPolicyItems.length,
  }), [windowedCyberItems.length, windowedDefenseItems.length, windowedPolicyItems.length, windowedSourceItems.length]);

  const layerStates: Record<LayerKey, FeedState> = {
    global: sourceFeed.feedState === "loading" ? "loading" : sourceFeed.feedState,
    cyber: cyber.isLoading ? "loading" : cyber.feedState ?? "unavailable",
    defense: defense.isLoading ? "loading" : defense.feedState ?? "unavailable",
    policy: policy.isLoading ? "loading" : policy.feedState ?? "unavailable",
  };

  const entriesByLayer = useMemo<Record<LayerKey, ContextEntry[]>>(() => {
    const annotationById = new Map(
      (cyber.analysis?.annotations ?? []).map((annotation) => [annotation.id, annotation]),
    );
    const cyberEntries = windowedCyberItems.map((item): ContextEntry => {
      const text = `${item.headline} ${item.summary}`;
      const annotation = annotationById.get(item.id);
      return {
        id: item.id,
        layer: "cyber",
        title: item.headline,
        summary: item.summary,
        source: item.source,
        time: item.timeAgo,
        countryKeys: countryKeysForEntry(
          [
            item.context.country,
            ...(annotation?.countries.map((hit) => hit.country) ?? []),
          ],
          text,
        ),
        url: item.url,
        tone: item.categoryTag,
        publishedAt: item.publishedAt,
        provenance: [
          { label: "Basis", value: "Derived from public RSS text" },
          { label: "Classification", value: "Inferred from title and summary" },
          { label: "Geo signal", value: annotation?.unresolved ? "Unresolved" : "Text-derived" },
        ],
        evidence: annotation?.countries.slice(0, 4).map((hit) => (
          `${hit.country}: ${hit.primaryRole}, ${hit.confidence} confidence`
        )),
      };
    });
    const defenseEntries = windowedDefenseItems.map((item): ContextEntry => ({
      id: item.id,
      layer: "defense",
      title: item.headline,
      summary: item.summary,
      source: item.source,
      time: item.timeAgo,
      countryKeys: countryKeysForEntry(
        item.countries?.map((hit) => hit.country) ?? [],
        `${item.headline} ${item.summary}`,
      ),
      url: item.url,
      tone: item.activityType,
      publishedAt: item.publishedAt,
      provenance: [
        { label: "Basis", value: "Derived from public RSS text" },
        { label: "Priority", value: item.priority },
        { label: "Classification", value: "Inferred defense-industry signal" },
      ],
      evidence: item.countries?.slice(0, 4).map((hit) => `${hit.country}: ${hit.role}`),
    }));
    const policyEntries = windowedPolicyItems.map((item): ContextEntry => ({
      id: item.id,
      layer: "policy",
      title: item.title,
      summary: item.summary,
      source: item.source,
      time: relativeTime(item.publishedAt),
      countryKeys: countryKeysForEntry(
        item.countries?.map((hit) => hit.country) ?? [],
        `${item.title} ${item.summary}`,
      ),
      url: item.url,
      tone: item.topic,
      publishedAt: item.publishedAt,
      provenance: [
        { label: "Basis", value: "Derived from public RSS text" },
        { label: "Confidence", value: `${item.confidence} (${item.confidenceLevel})` },
        { label: "Classification", value: "Inferred policy signal" },
      ],
      evidence: item.countries?.slice(0, 4).map((hit) => `${hit.country}: ${hit.mentions} mentions`),
    }));
    const globalEntries = windowedSourceItems.map(globalContextEntry);
    return {
      global: clusterMonitorReports(globalEntries),
      cyber: clusterMonitorReports(cyberEntries),
      defense: clusterMonitorReports(defenseEntries),
      policy: clusterMonitorReports(policyEntries),
    };
  }, [cyber.analysis, windowedCyberItems, windowedDefenseItems, windowedPolicyItems, windowedSourceItems]);

  const activeNetworkLayers = useMemo(
    () => LAYER_META.filter((meta) => layers[meta.key]),
    [layers],
  );
  const activeNetworkLayerSignature = activeNetworkLayers.map((meta) => meta.key).join(":");
  const activeReportEntries = useMemo(
    () => activeNetworkLayers.flatMap((meta) => entriesByLayer[meta.key]),
    [activeNetworkLayers, entriesByLayer],
  );
  const allReportEntries = useMemo(
    () => LAYER_META.flatMap((meta) => entriesByLayer[meta.key]),
    [entriesByLayer],
  );
  const reportSources = useMemo(
    () => Array.from(new Set(activeReportEntries.map((entry) => entry.source))).sort((a, b) => a.localeCompare(b)),
    [activeReportEntries],
  );
  const effectiveReportSource = reportSources.includes(reportSource) ? reportSource : "";
  const selectedCountryLabel = selectedGeography
    ? canonicalMarkerLabel(selectedGeography.name)
    : null;
  const selectedCountryKey = selectedCountryLabel?.toLocaleLowerCase("en-US") ?? null;
  const currentViewFilters = useMemo<MonitorViewFilters>(() => ({
    query: reportQuery,
    source: effectiveReportSource,
    order: reportOrder,
    timeWindow: timeWindowHours,
    layers,
    countryKey: selectedCountryKey ?? undefined,
    geography: selectedGeography ? { ...selectedGeography } : undefined,
  }), [
    effectiveReportSource,
    layers,
    reportOrder,
    reportQuery,
    selectedCountryKey,
    selectedGeography,
    timeWindowHours,
  ]);
  const filteredEntries = useMemo(() => {
    const query = reportQuery.trim().toLocaleLowerCase();
    return activeReportEntries
      .filter((entry) => !effectiveReportSource || entry.source === effectiveReportSource)
      .filter((entry) => !query || `${entry.title} ${entry.summary} ${entry.source} ${entry.tone ?? ""}`.toLocaleLowerCase().includes(query))
      .sort((a, b) => {
        if (selectedCountryKey) {
          const aMatches = a.countryKeys.includes(selectedCountryKey);
          const bMatches = b.countryKeys.includes(selectedCountryKey);
          if (aMatches !== bMatches) return aMatches ? -1 : 1;
        }
        const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return reportOrder === "newest" ? bTime - aTime : aTime - bTime;
      });
  }, [activeReportEntries, effectiveReportSource, reportOrder, reportQuery, selectedCountryKey]);
  const filteredReportCount = useMemo(
    () => filteredEntries.reduce((sum, entry) => sum + (entry.reportCount ?? 1), 0),
    [filteredEntries],
  );
  const activeReportCount = useMemo(
    () => activeReportEntries.reduce((sum, entry) => sum + (entry.reportCount ?? 1), 0),
    [activeReportEntries],
  );
  const filteredCountryStats = useMemo(() => {
    const stats = new Map<string, { count: number; categoryCounts: Map<LayerKey, number> }>();
    for (const entry of filteredEntries) {
      for (const countryKey of entry.countryKeys) {
        const current = stats.get(countryKey) ?? { count: 0, categoryCounts: new Map<LayerKey, number>() };
        const reportCount = entry.reportCount ?? 1;
        current.count += reportCount;
        current.categoryCounts.set(entry.layer, (current.categoryCounts.get(entry.layer) ?? 0) + reportCount);
        stats.set(countryKey, current);
      }
    }
    return stats;
  }, [filteredEntries]);
  const reportFiltersActive = Boolean(reportQuery.trim() || effectiveReportSource);
  const visibleMarkers = useMemo(() => {
    if (!reportFiltersActive) return markers;
    return markers.flatMap((marker) => {
      const countryKey = canonicalMarkerLabel(marker.label).toLocaleLowerCase("en-US");
      const stats = filteredCountryStats.get(countryKey);
      if (!stats) return [];
      const categories = Array.from(stats.categoryCounts.keys());
      const category = categories.includes(activeLayer) ? activeLayer : categories[0] ?? marker.category;
      const breakdown = Array.from(stats.categoryCounts.entries())
        .map(([name, count]) => `${name} ${count}`)
        .join(" / ");
      return [{
        ...marker,
        category,
        reportCount: stats.count,
        detail: `${stats.count} matching ${stats.count === 1 ? "report" : "reports"} · ${breakdown}`,
      }];
    });
  }, [activeLayer, filteredCountryStats, markers, reportFiltersActive]);

  const networkEntries = useMemo(() => {
    const query = reportQuery.trim().toLocaleLowerCase();
    const visibleLayers = networkCategoryFilter === "all"
      ? activeNetworkLayers
      : activeNetworkLayers.filter((meta) => meta.key === networkCategoryFilter);
    const buckets = visibleLayers.map((meta) => (
      selectedCountryKey
        ? entriesByLayer[meta.key]
          .filter((entry) => entry.countryKeys.includes(selectedCountryKey))
          .filter((entry) => !effectiveReportSource || entry.source === effectiveReportSource)
          .filter((entry) => !query || `${entry.title} ${entry.summary} ${entry.source} ${entry.tone ?? ""}`.toLocaleLowerCase().includes(query))
          .sort((a, b) => {
            const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
            const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
            return reportOrder === "newest" ? bTime - aTime : aTime - bTime;
          })
        : []
    ));
    if (networkCategoryFilter !== "all") return buckets[0] ?? [];

    const balancedEntries: ContextEntry[] = [];
    const largestBucket = Math.max(0, ...buckets.map((bucket) => bucket.length));
    for (let index = 0; index < largestBucket; index += 1) {
      for (const bucket of buckets) {
        const entry = bucket[index];
        if (entry) balancedEntries.push(entry);
      }
    }
    return balancedEntries;
  }, [activeNetworkLayers, effectiveReportSource, entriesByLayer, networkCategoryFilter, reportOrder, reportQuery, selectedCountryKey]);
  const networkReportCount = networkEntries.reduce(
    (sum, entry) => sum + (entry.reportCount ?? 1),
    0,
  );
  const networkContextKey = [
    selectedCountryKey ?? "",
    activeLayer,
    activeNetworkLayerSignature,
    networkCategoryFilter,
    timeWindowHours,
    effectiveReportSource,
    reportQuery,
    reportOrder,
    networkEntries.length,
  ].join(":");
  const networkDensityLayerCount = networkCategoryFilter === "all" ? activeNetworkLayers.length : 1;
  const networkBranchLimit = Math.min(
    NETWORK_BRANCH_MAX,
    NETWORK_BRANCH_BASE + Math.max(0, networkDensityLayerCount - 1) * 2,
  );
  const networkPageCount = Math.max(1, Math.ceil(networkEntries.length / networkBranchLimit));
  const requestedNetworkPage = networkNavigation.key === networkContextKey ? networkNavigation.page : 0;
  const networkPage = Math.min(requestedNetworkPage, networkPageCount - 1);
  const networkStartIndex = networkPage * networkBranchLimit;
  const visibleNetworkEntries = networkEntries.slice(networkStartIndex, networkStartIndex + networkBranchLimit);
  const networkVisible = Boolean(
    selectedCountryLabel && activeNetworkLayers.length > 0 && selectedMarker,
  );
  const selectedArticleContent = selectedEntry && articleContent?.entryKey === `${selectedEntry.layer}:${selectedEntry.id}`
    ? articleContent
    : null;
  const selectedSavedView = monitorViews.views.find((view) => view.id === selectedSavedViewId) ?? null;

  useEffect(() => {
    evaluateMonitorAlerts(allReportEntries);
  }, [allReportEntries, evaluateMonitorAlerts]);

  const reportMatches = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (query.length < 2) return [] as IntelligenceEventCandidate[];
    return windowedSourceItems
      .filter((item) => `${item.title} ${item.summary ?? ""} ${item.sourceName}`.toLocaleLowerCase().includes(query));
  }, [searchQuery, windowedSourceItems]);

  useEffect(() => {
    if (!isActive || timeWindowHours === "all") return;
    const frame = window.requestAnimationFrame(() => setTimeNow(Date.now()));
    const interval = window.setInterval(() => setTimeNow(Date.now()), 60_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
    };
  }, [isActive, timeWindowHours]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchBusy(true);
      try {
        const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const body = response.ok ? await response.json() as { results?: GeocodeResult[] } : null;
        setPlaces(body?.results?.slice(0, 5) ?? []);
      } catch {
        if (!controller.signal.aborted) setPlaces([]);
      } finally {
        if (!controller.signal.aborted) setSearchBusy(false);
      }
    }, 320);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  const activateSearch = useCallback(() => {
    articleRequestRef.current?.abort();
    if (networkCloseTimerRef.current != null) {
      window.clearTimeout(networkCloseTimerRef.current);
      networkCloseTimerRef.current = null;
    }
    setNetworkClosing(false);
    setSelectedEntry(null);
    setSelectedMarker(null);
    setSelectedGeography(null);
    setSearchOpen(true);
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        activateSearch();
      }
      if (event.key === "Escape") {
        articleRequestRef.current?.abort();
        setSearchOpen(false);
        setSelectedEntry(null);
        setSelectedMarker(null);
        setSelectedGeography(null);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activateSearch]);

  useEffect(() => {
    const measurePanels = () => {
      const layer = layerPanelRef.current;
      const nextPadding = {
        top: 0,
        right: 0,
        bottom: 0,
        left: leftPanelOpen && layer ? layer.offsetWidth + 18 : 0,
      };
      setMapViewportPadding((current) =>
        current.top === nextPadding.top &&
        current.right === nextPadding.right &&
        current.bottom === nextPadding.bottom &&
        current.left === nextPadding.left
          ? current
          : nextPadding,
      );
    };
    measurePanels();
    const observer = new ResizeObserver(measurePanels);
    if (layerPanelRef.current) observer.observe(layerPanelRef.current);
    window.addEventListener("resize", measurePanels);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measurePanels);
    };
  }, [leftPanelOpen]);

  useEffect(() => () => {
    articleRequestRef.current?.abort();
    if (leftPanelCloseTimerRef.current != null) {
      window.clearTimeout(leftPanelCloseTimerRef.current);
    }
    if (networkCloseTimerRef.current != null) {
      window.clearTimeout(networkCloseTimerRef.current);
    }
  }, []);

  const openLeftPanel = useCallback(() => {
    if (leftPanelCloseTimerRef.current != null) {
      window.clearTimeout(leftPanelCloseTimerRef.current);
      leftPanelCloseTimerRef.current = null;
    }
    setLeftPanelOpen(true);
  }, []);

  const scheduleLeftPanelClose = useCallback(() => {
    if (leftPanelCloseTimerRef.current != null) {
      window.clearTimeout(leftPanelCloseTimerRef.current);
    }
    leftPanelCloseTimerRef.current = window.setTimeout(() => {
      setLeftPanelOpen(false);
      leftPanelCloseTimerRef.current = null;
    }, 120);
  }, []);

  const toggleLayer = useCallback((key: LayerKey) => {
    articleRequestRef.current?.abort();
    const enabling = !layers[key];
    const nextLayers = { ...layers, [key]: enabling };
    const nextActiveKeys = LAYER_META.filter((item) => nextLayers[item.key]).map((item) => item.key);
    setLayers(nextLayers);
    setNetworkCategoryFilter(nextActiveKeys.length === 1 ? nextActiveKeys[0] : "all");
    setNetworkNavigation({ key: "", page: 0 });
    if (
      reportSource &&
      !nextActiveKeys.some((layerKey) => entriesByLayer[layerKey].some((entry) => entry.source === reportSource))
    ) {
      setReportSource("");
    }
    if (enabling) {
      setActiveLayer(key);
    } else if (activeLayer === key) {
      const fallback = LAYER_META.find((item) => item.key !== key && layers[item.key]);
      if (fallback) setActiveLayer(fallback.key);
    }
    setSelectedEntry(null);
  }, [activeLayer, entriesByLayer, layers, reportSource]);

  const openEntryDetails = useCallback((entry: ContextEntry) => {
    articleRequestRef.current?.abort();
    setSelectedEntry(entry);
    const entryKey = `${entry.layer}:${entry.id}`;
    const cachedArticle = articleContentCacheRef.current.get(entryKey);
    if (cachedArticle) {
      setArticleContent(cachedArticle);
      return;
    }
    if (!entry.url) {
      setArticleContent({ entryKey, status: "unavailable" });
      return;
    }

    const controller = new AbortController();
    articleRequestRef.current = controller;
    setArticleContent({ entryKey, status: "loading" });
    void fetch("/api/report-content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: entry.url }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json() as {
          article?: {
            text?: string;
            byline?: string | null;
            siteName?: string | null;
            wordCount?: number;
          };
        };
        if (!response.ok || !body.article?.text) throw new Error("article_unavailable");
        if (controller.signal.aborted) return;
        const readyArticle: ArticleContentState = {
          entryKey,
          status: "ready",
          text: body.article.text,
          byline: body.article.byline,
          siteName: body.article.siteName,
          wordCount: body.article.wordCount,
        };
        articleContentCacheRef.current.set(entryKey, readyArticle);
        setArticleContent(readyArticle);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setArticleContent({ entryKey, status: "unavailable" });
        }
      });
  }, []);

  const chooseReport = useCallback((item: IntelligenceEventCandidate) => {
    setSelectedMarker(null);
    setSelectedGeography(null);
    openEntryDetails(globalContextEntry(item));
    const marker = sourceMarkers.find((candidate) => candidate.items.some((entry) => entry.id === item.id));
    if (marker) mapRef.current?.focus(marker.lng, marker.lat, 5.8);
    setSearchOpen(false);
  }, [openEntryDetails, sourceMarkers]);

  const openNetworkEntry = useCallback((entry: ContextEntry) => {
    openEntryDetails(entry);
  }, [openEntryDetails]);

  const closeReportNetwork = useCallback((soft: boolean) => {
    articleRequestRef.current?.abort();
    if (networkCloseTimerRef.current != null) {
      window.clearTimeout(networkCloseTimerRef.current);
      networkCloseTimerRef.current = null;
    }
    if (!soft) {
      setNetworkClosing(false);
      setSelectedEntry(null);
      setSelectedMarker(null);
      setSelectedGeography(null);
      return;
    }
    setNetworkClosing(true);
    networkCloseTimerRef.current = window.setTimeout(() => {
      setSelectedEntry(null);
      setSelectedMarker(null);
      setSelectedGeography(null);
      setNetworkClosing(false);
      networkCloseTimerRef.current = null;
    }, 420);
  }, []);

  const toggleProjection = useCallback(() => {
    const nextProjection: MonitorProjection = projection === "globe" ? "mercator" : "globe";
    setProjection(nextProjection);
    if (nextProjection === "globe") {
      window.requestAnimationFrame(() => mapRef.current?.reset());
    }
  }, [projection]);

  const chooseTimeWindow = useCallback((hours: TimeWindowHours) => {
    if (hours === timeWindowHours) return;
    articleRequestRef.current?.abort();
    setTimeNow(Date.now());
    setTimeWindowHours(hours);
    setNetworkNavigation({ key: "", page: 0 });
    setSelectedEntry(null);
    setSelectedMarker(null);
    setSelectedGeography(null);
  }, [timeWindowHours]);

  const saveCurrentView = useCallback(() => {
    const matchingIds = allReportEntries
      .filter((entry) => matchesMonitorView(entry, currentViewFilters))
      .map((entry) => entry.id);
    const view = monitorViews.saveView(currentViewFilters, matchingIds);
    setSelectedSavedViewId(view.id);
  }, [allReportEntries, currentViewFilters, monitorViews]);

  const applySavedView = useCallback((viewId: string) => {
    setSelectedSavedViewId(viewId);
    const view = monitorViews.views.find((candidate) => candidate.id === viewId);
    if (!view) return;
    articleRequestRef.current?.abort();
    const activeKeys = LAYER_META.filter((meta) => view.layers[meta.key]).map((meta) => meta.key);
    setLayers(view.layers);
    setActiveLayer(activeKeys[0] ?? "global");
    setNetworkCategoryFilter(activeKeys.length === 1 ? activeKeys[0] : "all");
    setReportQuery(view.query);
    setReportSource(view.source);
    setReportOrder(view.order);
    setTimeWindowHours(view.timeWindow);
    setTimeNow(Date.now());
    setSelectedGeography(view.geography ?? null);
    setSelectedMarker(null);
    setSelectedEntry(null);
    setNetworkNavigation({ key: "", page: 0 });
    monitorViews.markRead(view.id);
  }, [monitorViews]);

  const removeSelectedView = useCallback(() => {
    if (!selectedSavedViewId) return;
    monitorViews.removeView(selectedSavedViewId);
    setSelectedSavedViewId("");
  }, [monitorViews, selectedSavedViewId]);

  const exportReports = useCallback(() => {
    downloadReportExport(exportFormat, filteredEntries);
  }, [exportFormat, filteredEntries]);

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <button className={styles.brand} type="button" onClick={() => mapRef.current?.reset()} aria-label="EchisWorld Monitor home">
          <span>EchisWorld</span><i /><strong>Monitor</strong>
        </button>
        <div className={styles.searchWrap} data-open={searchOpen || undefined}>
          <Search size={16} aria-hidden />
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={(event) => {
              const value = event.target.value;
              activateSearch();
              setSearchQuery(value);
              if (value.trim().length < 2) {
                setPlaces([]);
                setSearchBusy(false);
              }
            }}
            onFocus={activateSearch}
            placeholder="Search places and reports"
            aria-label="Search places and reports"
          />
          {searchBusy ? <span className={styles.searchSpinner} /> : searchQuery ? (
            <button type="button" onClick={() => { setSearchQuery(""); setPlaces([]); }} aria-label="Clear search"><X size={14} /></button>
          ) : <kbd>Ctrl K</kbd>}
          {searchOpen && searchQuery.trim().length >= 2 && (
            <div className={styles.searchResults}>
              <div className={styles.resultSection}><span>Places</span><small>{places.length}</small></div>
              {places.map((place) => (
                <button key={place.id} type="button" onClick={() => {
                  setSelectedGeography({
                    id: place.id,
                    name: place.name,
                    lng: place.center[0],
                    lat: place.center[1],
                    bbox: place.bbox,
                  });
                  setSearchOpen(false);
                }}>
                  <MapPin size={14} /><span><strong>{place.name}</strong><small>{place.context || place.displayName}</small></span>
                </button>
              ))}
              <div className={styles.resultSection}><span>Reports</span><small>{reportMatches.length}</small></div>
              {reportMatches.map((item) => (
                <button key={item.id} type="button" onClick={() => chooseReport(item)}>
                  <Globe2 size={14} /><span><strong>{item.title}</strong><small>{item.sourceName}</small></span>
                </button>
              ))}
              {!searchBusy && places.length === 0 && reportMatches.length === 0 && <p>No matching place or report.</p>}
            </div>
          )}
        </div>
        <div className={styles.headerActions}>
          <button type="button" onClick={onOpenSources}><Database size={15} /><span>Sources</span></button>
          <div className={styles.clock}><GeoLiveClock /></div>
        </div>
      </header>

      <aside
        className={styles.rail}
        data-open={leftPanelOpen || undefined}
        onPointerEnter={openLeftPanel}
        onPointerLeave={scheduleLeftPanelClose}
        onFocusCapture={openLeftPanel}
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) scheduleLeftPanelClose();
        }}
        aria-label="Workspace navigation"
      >
        <button type="button" className={styles.railActive} aria-label="Layers"><Layers3 size={17} /></button>
        <button type="button" onClick={onOpenBookmarks} aria-label={`Saved items, ${bookmarkCount}`}><Bookmark size={17} />{bookmarkCount > 0 && <small>{bookmarkCount}</small>}</button>
        <button type="button" onClick={onOpenSources} aria-label="Sources"><Database size={17} /></button>
        <span />
      </aside>

      <main className={styles.mapArea}>
        <MonitorMap
          ref={mapRef}
          active={isActive}
          reportNetworkOpen={networkVisible}
          markers={visibleMarkers}
          selectedMarkerId={selectedMarker?.id ?? null}
          selectedGeography={selectedGeography}
          projection={projection}
          showLabels={showLabels}
          showBoundaries={showBoundaries}
          showReportDensity={showReportDensity}
          viewportPadding={mapViewportPadding}
          onMarkerSelect={(marker) => {
            closeReportNetwork(false);
            setSelectedMarker(marker);
            setSelectedEntry(null);
            setSelectedGeography(marker ? {
              id: `marker-${marker.id}`,
              name: marker.label,
              lng: marker.lng,
              lat: marker.lat,
            } : null);
            if (marker) {
              setActiveLayer(marker.category);
            }
          }}
          onGeographyChange={(geography) => {
            closeReportNetwork(false);
            if (!geography) return;
            const countryKey = canonicalMarkerLabel(geography.name).toLocaleLowerCase("en-US");
            const countryMarker = visibleMarkers.find(
              (marker) => canonicalMarkerLabel(marker.label).toLocaleLowerCase("en-US") === countryKey,
            ) ?? null;
            setSelectedGeography(geography);
            setSelectedMarker(countryMarker);
            setSelectedEntry(null);
            if (countryMarker) setActiveLayer(countryMarker.category);
          }}
          onAutoRotateStart={() => {
            if (networkVisible || selectedEntry) closeReportNetwork(true);
          }}
          onMapBackgroundClick={() => {
            if (networkVisible || selectedEntry) closeReportNetwork(true);
          }}
          onViewportInteraction={() => {
            if (networkVisible || selectedEntry) closeReportNetwork(true);
          }}
          onEngineStateChange={setMapEngineState}
        />

        {networkVisible && selectedCountryLabel && (
          <section
            className={styles.reportNetwork}
            data-closing={networkClosing || undefined}
            data-dense={visibleNetworkEntries.length > NETWORK_BRANCH_BASE || undefined}
            aria-label={`${selectedCountryLabel} report network`}
          >
            <svg className={styles.networkGraph} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                {visibleNetworkEntries.map((entry, index) => {
                  const position = networkCardPosition(index, visibleNetworkEntries.length);
                  const gradientId = `network-edge-${entry.layer}-${index}`;
                  return <linearGradient
                    key={`${entry.layer}-${entry.id}`}
                    id={gradientId}
                    gradientUnits="userSpaceOnUse"
                    x1={50}
                    y1={50}
                    x2={position.x}
                    y2={position.y}
                  >
                    <stop offset="0%" stopColor="#ff3152" />
                    <stop offset="50%" stopColor="#d92346" />
                    <stop offset="100%" stopColor="#641a2a" />
                  </linearGradient>;
                })}
              </defs>
              {visibleNetworkEntries.map((entry, index) => {
                const position = networkCardPosition(index, visibleNetworkEntries.length);
                return <g key={`${entry.layer}-${entry.id}`}>
                    <line
                      className={styles.networkEdgeGlow}
                      x1="50"
                      y1="50"
                      x2={position.x}
                      y2={position.y}
                    />
                    <line
                      className={styles.networkEdge}
                      x1="50"
                      y1="50"
                      x2={position.x}
                      y2={position.y}
                      stroke={`url(#network-edge-${entry.layer}-${index})`}
                    />
                  </g>;
              })}
            </svg>

            <div
              className={styles.networkHub}
              style={{
                "--network-hub-x": "50%",
                "--network-hub-y": "50%",
              } as CSSProperties}
            >
              <span className={styles.networkHubIcon}><Layers3 size={15} /></span>
              <small>Report network</small>
              <strong>{selectedCountryLabel}</strong>
              <p>
                <b>{networkReportCount}</b> linked reports
                <i />
                <span>{networkEntries.length < networkReportCount
                  ? `${networkEntries.length} grouped stories`
                  : networkCategoryFilter === "all"
                    ? "All active"
                    : LAYER_META.find((meta) => meta.key === networkCategoryFilter)?.label}</span>
              </p>
              <div className={styles.networkCategoryFilters} aria-label="Filter network reports by active category">
                {LAYER_META.map((meta) => {
                  const FilterIcon = meta.icon;
                  const enabled = layers[meta.key];
                  const selected = enabled && (networkCategoryFilter === "all" || networkCategoryFilter === meta.key);
                  const locked = enabled && activeNetworkLayers.length === 1;
                  return <button
                    key={meta.key}
                    type="button"
                    data-layer={meta.key}
                    data-selected={selected || undefined}
                    disabled={!enabled || locked}
                    aria-pressed={selected}
                    aria-label={`${meta.label}${!enabled ? " layer is inactive" : locked ? " is the only active category" : " filter"}`}
                    onClick={() => {
                      setNetworkCategoryFilter((current) => current === meta.key ? "all" : meta.key);
                      setNetworkNavigation({ key: "", page: 0 });
                    }}
                  >
                    <FilterIcon size={10} />
                    <span>{meta.key === "global" ? "Global" : meta.label}</span>
                  </button>;
                })}
              </div>
              {networkPageCount > 1 && (
                <div className={styles.networkPagination} aria-label="Report network pages">
                  <button
                    type="button"
                    disabled={networkPage === 0}
                    onClick={() => setNetworkNavigation({
                      key: networkContextKey,
                      page: Math.max(0, networkPage - 1),
                    })}
                    aria-label="Show previous reports"
                  ><ChevronLeft size={13} /></button>
                  <span>
                    {networkStartIndex + 1}–{Math.min(networkStartIndex + networkBranchLimit, networkEntries.length)}
                    <small>/ {networkEntries.length}</small>
                  </span>
                  <button
                    type="button"
                    disabled={networkPage >= networkPageCount - 1}
                    onClick={() => setNetworkNavigation({
                      key: networkContextKey,
                      page: Math.min(networkPageCount - 1, networkPage + 1),
                    })}
                    aria-label="Show next reports"
                  ><ChevronRight size={13} /></button>
                </div>
              )}
            </div>

            {visibleNetworkEntries.map((entry, index) => {
              const position = networkCardPosition(index, visibleNetworkEntries.length);
              const cardMeta = LAYER_META.find((meta) => meta.key === entry.layer) ?? LAYER_META[0];
              const CardIcon = cardMeta.icon;
              return <button
                key={`${entry.layer}-${entry.id}`}
                type="button"
                className={styles.networkCard}
                data-network-index={index}
                data-layer={entry.layer}
                onClick={() => openNetworkEntry(entry)}
                style={{
                  "--network-x": `${position.x}%`,
                  "--network-y": `${position.y}%`,
                  "--network-delay": `${index * 34}ms`,
                } as CSSProperties}
              >
                <span><small>{entry.source}</small><time>{entry.time}</time></span>
                <strong>{entry.title}</strong>
                <p>{entry.summary}</p>
                <footer className={styles.networkCardMeta}>
                  <span data-layer={entry.layer}><CardIcon size={9} />{cardMeta.label}</span>
                  <em>{(entry.reportCount ?? 1) > 1
                    ? `${entry.reportCount} reports · ${entry.sourceCount} sources`
                    : entry.tone ?? "Report"}</em>
                </footer>
              </button>;
            })}
          </section>
        )}

        <section
          ref={layerPanelRef}
          className={styles.layerPanel}
          data-open={leftPanelOpen || undefined}
          onPointerEnter={openLeftPanel}
          onPointerLeave={scheduleLeftPanelClose}
          onFocusCapture={openLeftPanel}
          onBlurCapture={(event) => {
            const nextTarget = event.relatedTarget;
            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) scheduleLeftPanelClose();
          }}
          aria-label="Map layers"
        >
          <div className={styles.panelHeading}><span><Layers3 size={15} />Layers</span><small>{Object.entries(layers).filter(([, enabled]) => enabled).length}</small></div>
          <label className={styles.layerSearch}><Search size={13} /><input value={layerQuery} onChange={(event) => setLayerQuery(event.target.value)} placeholder="Find a layer" aria-label="Find a map layer" /></label>
          <div className={styles.layerTabs}><button type="button" data-active={layerTab === "all" || undefined} onClick={() => setLayerTab("all")}>All</button><button type="button" data-active={layerTab === "enabled" || undefined} onClick={() => setLayerTab("enabled")}>Enabled</button></div>
          <div className={styles.timeWindowFilter}>
            <div className={styles.timeWindowHeading}>
              <span><CalendarDays size={12} />Time window</span>
              <small>{timeWindowHours === "all" ? "All collected" : `Last ${timeWindowHours} ${timeWindowHours === 1 ? "hour" : "hours"}`}</small>
            </div>
            <div className={styles.timeWindowOptions} aria-label="Report time window">
              {TIME_WINDOW_OPTIONS.map((hours) => (
                <button
                  key={hours}
                  type="button"
                  data-active={timeWindowHours === hours || undefined}
                  aria-pressed={timeWindowHours === hours}
                  aria-label={hours === "all" ? "Show all collected reports" : `Show reports from the last ${hours} ${hours === 1 ? "hour" : "hours"}`}
                  onClick={() => chooseTimeWindow(hours)}
                >
                  {hours === "all" ? "All" : `${hours}h`}
                </button>
              ))}
            </div>
          </div>
          {(["intelligence"] as const).map((group) => {
            const filtered = LAYER_META.filter((item) => item.group === group && item.label.toLowerCase().includes(layerQuery.toLowerCase()) && (layerTab === "all" || layers[item.key]));
            if (!filtered.length) return null;
            return <div className={styles.layerGroup} key={group}>
              <span>{group}</span>
              {filtered.map((item) => {
                const Icon = item.icon;
                const unavailable = false;
                return <button key={item.key} type="button" onClick={() => toggleLayer(item.key)} data-active={layers[item.key] || undefined} data-disabled={unavailable || undefined} aria-pressed={layers[item.key]}>
                  <Icon size={15} /><span><strong>{item.label}</strong>{unavailable && <small>Not connected</small>}</span>
                  {layerCounts[item.key] != null && <em>{layerCounts[item.key]}</em>}
                  <i aria-hidden><b /></i>
                </button>;
              })}
            </div>;
          })}
          <div className={styles.reportFilters}>
            <div className={styles.reportFilterHeading}>
              <span>Report filters</span>
              <small>{filteredReportCount === activeReportCount ? activeReportCount : `${filteredReportCount}/${activeReportCount}`}</small>
            </div>
            <label className={styles.reportFilterSearch}>
              <Search size={12} />
              <input
                value={reportQuery}
                onChange={(event) => {
                  setReportQuery(event.target.value);
                  setNetworkNavigation({ key: "", page: 0 });
                }}
                placeholder="Title, summary or source"
                aria-label="Filter reports"
              />
            </label>
            <label className={styles.reportSourceFilter}>
              <Database size={12} />
              <select
                value={effectiveReportSource}
                onChange={(event) => {
                  setReportSource(event.target.value);
                  setNetworkNavigation({ key: "", page: 0 });
                }}
                aria-label="Filter reports by source"
              >
                <option value="">All sources</option>
                {reportSources.map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
            </label>
            <div className={styles.reportOrder}>
              <button type="button" data-active={reportOrder === "newest" || undefined} onClick={() => { setReportOrder("newest"); setNetworkNavigation({ key: "", page: 0 }); }}>Newest</button>
              <button type="button" data-active={reportOrder === "oldest" || undefined} onClick={() => { setReportOrder("oldest"); setNetworkNavigation({ key: "", page: 0 }); }}>Oldest</button>
            </div>
            <div className={styles.reportFilterFeedback} aria-live="polite">
              <span><b>{filteredReportCount}</b> reports</span>
              {filteredEntries.length < filteredReportCount && <span><b>{filteredEntries.length}</b> grouped stories</span>}
              <span><b>{filteredCountryStats.size}</b> mapped countries</span>
              <span>{reportOrder === "newest" ? "Newest first" : "Oldest first"}</span>
            </div>
            <div className={styles.savedViewTools}>
              <label>
                <Save size={12} />
                <select
                  value={selectedSavedViewId}
                  onChange={(event) => applySavedView(event.target.value)}
                  aria-label="Open a saved monitor view"
                >
                  <option value="">Saved views</option>
                  {monitorViews.views.map((view) => (
                    <option key={view.id} value={view.id}>
                      {view.name}{view.unreadEntryIds.length > 0 ? ` · ${view.unreadEntryIds.length} new` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={saveCurrentView} title="Save current filters" aria-label="Save current monitor view"><Save size={12} /></button>
              <button
                type="button"
                disabled={!selectedSavedView}
                data-active={selectedSavedView?.alertsEnabled || undefined}
                onClick={() => selectedSavedView && void monitorViews.toggleAlerts(selectedSavedView.id)}
                title={selectedSavedView?.alertsEnabled ? "Disable alerts" : "Enable alerts for saved view"}
                aria-label={selectedSavedView?.alertsEnabled ? "Disable saved view alerts" : "Enable saved view alerts"}
              ><Bell size={12} />{selectedSavedView && selectedSavedView.unreadEntryIds.length > 0 && <small>{selectedSavedView.unreadEntryIds.length}</small>}</button>
              <button type="button" disabled={!selectedSavedView} onClick={removeSelectedView} title="Delete saved view" aria-label="Delete saved monitor view"><Trash2 size={12} /></button>
            </div>
            <div className={styles.exportTools}>
              <label>
                <Download size={12} />
                <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ReportExportFormat)} aria-label="Report export format">
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                  <option value="geojson">GeoJSON</option>
                </select>
              </label>
              <button type="button" onClick={exportReports} disabled={filteredEntries.length === 0}><Download size={12} />Export visible</button>
            </div>
            {(reportQuery || reportSource || reportOrder !== "newest") && <button type="button" className={styles.clearReportFilters} onClick={() => { setReportQuery(""); setReportSource(""); setReportOrder("newest"); setNetworkNavigation({ key: "", page: 0 }); }}><X size={12} />Reset filters</button>}
          </div>
          <div className={styles.mapOptions}>
            <span>Map</span>
            <button type="button" onClick={() => setShowLabels((value) => !value)} data-active={showLabels || undefined}><MapIcon size={15} /><strong>Place labels</strong><i><b /></i></button>
            <button type="button" onClick={() => setShowBoundaries((value) => !value)} data-active={showBoundaries || undefined}><MapPin size={15} /><strong>Boundaries</strong><i><b /></i></button>
            <button type="button" onClick={() => setShowReportDensity((value) => !value)} data-active={showReportDensity || undefined}><Layers3 size={15} /><strong>News volume</strong><i><b /></i></button>
            <button type="button" className={styles.appearance} onClick={toggleProjection}><SlidersHorizontal size={15} /><span><strong>Map projection</strong><small>Obsidian OSM · {mapEngineState} · {projection}</small></span><b>{projection === "globe" ? "2D" : "3D"}</b></button>
          </div>
        </section>

        {selectedEntry && (
          <div
            className={styles.intelDetailBackdrop}
            data-closing={networkClosing || undefined}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                articleRequestRef.current?.abort();
                setSelectedEntry(null);
              }
            }}
          >
            <article
              className={styles.intelDetailModal}
              role="dialog"
              aria-modal="true"
              aria-label="Report details"
            >
              <header className={styles.intelDetailHeader}>
                <span>
                  <Database size={15} />
                  Intelligence report
                </span>
                <button
                  type="button"
                  onClick={() => {
                    articleRequestRef.current?.abort();
                    setSelectedEntry(null);
                  }}
                  aria-label="Close details"
                >
                  <X size={15} />
                </button>
              </header>

              <div className={styles.reportDetailBody}>
                  <div className={styles.detailEyebrow}>
                    <span>{selectedEntry.source}</span>
                    <time>{selectedEntry.time}</time>
                  </div>
                  <h2>{selectedEntry.title}</h2>
                  {selectedArticleContent?.status === "ready" && selectedArticleContent.text ? (
                    <section className={styles.articleContent} aria-label="Original article text">
                      <div>
                        <span>Original source text</span>
                        <small>
                          {[selectedArticleContent.siteName, selectedArticleContent.byline]
                            .filter(Boolean)
                            .join(" · ")}
                          {selectedArticleContent.wordCount
                            ? `${selectedArticleContent.siteName || selectedArticleContent.byline ? " · " : ""}${selectedArticleContent.wordCount} words`
                            : ""}
                        </small>
                      </div>
                      <p>{selectedArticleContent.text}</p>
                    </section>
                  ) : (
                    <section className={styles.articleExcerpt} aria-label="Source feed excerpt">
                      <div>
                        <span>Source feed excerpt</span>
                        {selectedArticleContent?.status === "loading" && (
                          <small className={styles.articleFetchStatus} role="status">
                            <i />
                            <span>Checking full article</span>
                          </small>
                        )}
                      </div>
                      <p>{selectedEntry.summary}</p>
                      {selectedArticleContent?.status === "unavailable" && (
                        <div className={styles.articleFallback}>
                          The source page did not expose readable article text. Showing the complete feed excerpt instead.
                        </div>
                      )}
                    </section>
                  )}
                  <div className={styles.detailContext}>
                    {selectedCountryLabel && <span><MapPin size={12} />{selectedCountryLabel}</span>}
                    {selectedEntry.tone && <span>{selectedEntry.tone}</span>}
                    <span>{LAYER_META.find((item) => item.key === selectedEntry.layer)?.label}</span>
                    {(selectedEntry.reportCount ?? 1) > 1 && <span>{selectedEntry.reportCount} reports · {selectedEntry.sourceCount} sources</span>}
                  </div>
                  {(selectedEntry.provenance?.length || selectedEntry.evidence?.length) && (
                    <section className={styles.detailProvenance} aria-label="Report provenance">
                      <header>
                        <span>Report basis</span>
                        <small>Automated public-source context, not independent verification</small>
                      </header>
                      {selectedEntry.provenance && (
                        <div className={styles.provenanceGrid}>
                          {selectedEntry.provenance.map((field) => (
                            <div key={`${field.label}:${field.value}`}><small>{field.label}</small><strong>{field.value}</strong></div>
                          ))}
                        </div>
                      )}
                      {selectedEntry.evidence && selectedEntry.evidence.length > 0 && (
                        <div className={styles.provenanceEvidence}>
                          <small>Location / classification evidence</small>
                          {selectedEntry.evidence.map((evidence) => <span key={evidence}>{evidence}</span>)}
                        </div>
                      )}
                    </section>
                  )}
                  {selectedEntry.relatedReports && selectedEntry.relatedReports.length > 1 && (
                    <section className={styles.relatedReporting} aria-label="Related reporting">
                      <header><span>Related reporting</span><small>{selectedEntry.sourceCount} distinct sources</small></header>
                      <div>
                        {selectedEntry.relatedReports.map((report) => report.url ? (
                          <a key={report.id} href={report.url} target="_blank" rel="noreferrer"><span>{report.source}</span><strong>{report.title}</strong></a>
                        ) : (
                          <div key={report.id}><span>{report.source}</span><strong>{report.title}</strong></div>
                        ))}
                      </div>
                    </section>
                  )}
                  <footer className={styles.detailActions}>
                    {selectedEntry.url && (
                      <button
                        type="button"
                        onClick={() => onToggleReportBookmark({
                          id: selectedEntry.id,
                          title: selectedEntry.title,
                          summary: selectedEntry.summary,
                          sourceName: selectedEntry.source,
                          url: selectedEntry.url!,
                          publishedAt: selectedEntry.publishedAt,
                          domainLabel: selectedEntry.tone,
                        })}
                      >
                        <Bookmark size={13} />
                        {isReportBookmarked(selectedEntry.id) ? "Remove saved" : "Save report"}
                      </button>
                    )}
                    {selectedEntry.url && <a href={selectedEntry.url} target="_blank" rel="noreferrer">Open original source</a>}
                  </footer>
              </div>
            </article>
          </div>
        )}

        <div className={styles.mapControls}>
          <button type="button" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in"><Plus size={16} /></button>
          <button type="button" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out"><Minus size={16} /></button>
          <button type="button" className={styles.overviewControl} onClick={() => mapRef.current?.reset()} aria-label="Return to overview" title="Overview"><Globe2 size={16} /></button>
          <button type="button" onClick={toggleProjection}>{projection === "globe" ? "2D" : "3D"}</button>
        </div>

        <div className={styles.mapTitle}><span>Global overview</span><small>Public-source workspace</small></div>
        <div className={styles.statusPill} data-state={layerStates[activeLayer]}><i /><span>{stateLabel(layerStates[activeLayer])}</span><small>{activeLayer}</small></div>

      </main>
    </div>
  );
}
