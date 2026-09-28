import { clusterCorroboratedItems } from "@/lib/sourceintel/feedInsights";
import { COUNTRY_COORDS } from "@/lib/sources/countryCoords";

export type MonitorReportLayer = "global" | "cyber" | "defense" | "policy";
export type MonitorTimeWindow = "all" | 1 | 6 | 12 | 24;

export type MonitorReportLink = {
  id: string;
  title: string;
  source: string;
  url?: string;
  publishedAt?: string;
};

export type MonitorProvenanceField = {
  label: string;
  value: string;
};

export type MonitorReportEntry = {
  id: string;
  layer: MonitorReportLayer;
  title: string;
  summary: string;
  source: string;
  time: string;
  countryKeys: string[];
  url?: string;
  tone?: string;
  publishedAt?: string;
  coordinates?: [number, number];
  priorityScore?: number;
  provenance?: MonitorProvenanceField[];
  evidence?: string[];
  reportCount?: number;
  sourceCount?: number;
  sourceNames?: string[];
  relatedReports?: MonitorReportLink[];
};

export type MonitorViewFilters = {
  query: string;
  source: string;
  order: "newest" | "oldest";
  timeWindow: MonitorTimeWindow;
  layers: Record<MonitorReportLayer, boolean>;
  countryKey?: string;
  geography?: {
    id: string;
    name: string;
    lng: number;
    lat: number;
    bbox?: [number, number, number, number];
    boundaryCode?: string;
  };
};

export type ReportExportFormat = "csv" | "json" | "geojson";

const COUNTRY_COORDS_BY_KEY = new Map(
  Object.entries(COUNTRY_COORDS).map(([name, coordinates]) => [
    name.toLocaleLowerCase("en-US"),
    [coordinates.lng, coordinates.lat] as [number, number],
  ]),
);

function sourceKey(source: string): string {
  return source.trim().toLocaleLowerCase("en-US").replace(/\s+/g, "-");
}

/**
 * Presentation-only grouping for near-identical reports. It reuses the
 * conservative title/domain/time matcher already covered by unit tests and
 * never upgrades a group to "verified".
 */
export function clusterMonitorReports(
  entries: readonly MonitorReportEntry[],
): MonitorReportEntry[] {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const clusters = clusterCorroboratedItems(
    entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      sourceId: sourceKey(entry.source),
      sourceName: entry.source,
      primaryDomain: entry.layer,
      priorityScore: entry.priorityScore ?? 50,
      publishedAt: entry.publishedAt,
      geoBasis: { region: entry.countryKeys[0] },
    })),
  );

  return clusters.flatMap((cluster) => {
    const primary = entriesById.get(cluster.primary.id);
    if (!primary) return [];
    const members = cluster.members
      .map((member) => entriesById.get(member.id))
      .filter((member): member is MonitorReportEntry => Boolean(member));
    return [{
      ...primary,
      reportCount: members.length,
      sourceCount: cluster.sourceCount,
      sourceNames: cluster.sourceNames,
      relatedReports: members.map((member) => ({
        id: member.id,
        title: member.title,
        source: member.source,
        url: member.url,
        publishedAt: member.publishedAt,
      })),
    }];
  });
}

export function matchesMonitorView(
  entry: MonitorReportEntry,
  filters: MonitorViewFilters,
  now = Date.now(),
): boolean {
  if (!filters.layers[entry.layer]) return false;
  if (filters.source && entry.source !== filters.source) return false;
  if (filters.countryKey && !entry.countryKeys.includes(filters.countryKey)) return false;

  const query = filters.query.trim().toLocaleLowerCase();
  if (
    query &&
    !`${entry.title} ${entry.summary} ${entry.source} ${entry.tone ?? ""}`
      .toLocaleLowerCase()
      .includes(query)
  ) {
    return false;
  }

  if (filters.timeWindow !== "all") {
    if (!entry.publishedAt) return false;
    const timestamp = new Date(entry.publishedAt).getTime();
    if (!Number.isFinite(timestamp)) return false;
    if (timestamp < now - filters.timeWindow * 60 * 60 * 1000) return false;
  }
  return true;
}

function coordinatesFor(entry: MonitorReportEntry): [number, number] | null {
  if (entry.coordinates) return entry.coordinates;
  for (const key of entry.countryKeys) {
    const coordinates = COUNTRY_COORDS_BY_KEY.get(key);
    if (coordinates) return coordinates;
  }
  return null;
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function exportRows(entries: readonly MonitorReportEntry[]) {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    source: entry.source,
    url: entry.url ?? "",
    publishedAt: entry.publishedAt ?? "",
    layer: entry.layer,
    category: entry.tone ?? "",
    countries: entry.countryKeys.join(" | "),
    reportCount: entry.reportCount ?? 1,
    sourceCount: entry.sourceCount ?? 1,
    sourceNames: (entry.sourceNames ?? [entry.source]).join(" | "),
  }));
}

export function serializeReportExport(
  format: ReportExportFormat,
  entries: readonly MonitorReportEntry[],
): { content: string; mimeType: string; extension: string } {
  const rows = exportRows(entries);
  if (format === "json") {
    return {
      content: JSON.stringify({
        exportedAt: new Date().toISOString(),
        note: "Public-source reports; not a count of independently verified incidents.",
        reports: rows,
      }, null, 2),
      mimeType: "application/json;charset=utf-8",
      extension: "json",
    };
  }

  if (format === "geojson") {
    return {
      content: JSON.stringify({
        type: "FeatureCollection",
        features: entries.flatMap((entry) => {
          const coordinates = coordinatesFor(entry);
          if (!coordinates) return [];
          return [{
            type: "Feature",
            id: entry.id,
            geometry: { type: "Point", coordinates },
            properties: exportRows([entry])[0],
          }];
        }),
      }, null, 2),
      mimeType: "application/geo+json;charset=utf-8",
      extension: "geojson",
    };
  }

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [
    "id", "title", "summary", "source", "url", "publishedAt", "layer",
    "category", "countries", "reportCount", "sourceCount", "sourceNames",
  ];
  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header as keyof typeof row])).join(",")),
  ];
  return {
    content: `\uFEFF${lines.join("\r\n")}`,
    mimeType: "text/csv;charset=utf-8",
    extension: "csv",
  };
}

export function downloadReportExport(
  format: ReportExportFormat,
  entries: readonly MonitorReportEntry[],
): void {
  if (typeof window === "undefined") return;
  const file = serializeReportExport(format, entries);
  const blob = new Blob([file.content], { type: file.mimeType });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `echisworld-reports-${new Date().toISOString().slice(0, 10)}.${file.extension}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}
