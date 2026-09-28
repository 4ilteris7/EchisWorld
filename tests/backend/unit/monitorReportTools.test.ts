import { describe, expect, it } from "vitest";
import {
  clusterMonitorReports,
  matchesMonitorView,
  serializeReportExport,
  type MonitorReportEntry,
  type MonitorViewFilters,
} from "@/components/monitor/monitorReportTools";

function report(overrides: Partial<MonitorReportEntry> = {}): MonitorReportEntry {
  return {
    id: "report-a",
    layer: "global",
    title: "Airstrikes reported in southern Lebanon overnight",
    summary: "Public-source report summary",
    source: "Source A",
    time: "1h ago",
    countryKeys: ["lebanon"],
    publishedAt: "2026-09-28T12:00:00.000Z",
    ...overrides,
  };
}

const filters: MonitorViewFilters = {
  query: "airstrike",
  source: "",
  order: "newest",
  timeWindow: 24,
  layers: { global: true, cyber: false, defense: false, policy: false },
  countryKey: "lebanon",
};

describe("monitor report tools", () => {
  it("groups similar reports without calling them verified", () => {
    const grouped = clusterMonitorReports([
      report(),
      report({
        id: "report-b",
        source: "Source B",
        title: "Airstrike reported in southern Lebanon overnight",
        publishedAt: "2026-09-28T12:15:00.000Z",
      }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].reportCount).toBe(2);
    expect(grouped[0].sourceCount).toBe(2);
    expect(grouped[0].relatedReports).toHaveLength(2);
  });

  it("matches saved views by layer, query, geography and rolling time", () => {
    expect(matchesMonitorView(report(), filters, Date.parse("2026-09-28T13:00:00.000Z"))).toBe(true);
    expect(matchesMonitorView(
      report({ layer: "cyber" }),
      filters,
      Date.parse("2026-09-28T13:00:00.000Z"),
    )).toBe(false);
    expect(matchesMonitorView(
      report({ publishedAt: "2026-09-26T12:00:00.000Z" }),
      filters,
      Date.parse("2026-09-28T13:00:00.000Z"),
    )).toBe(false);
  });

  it("serializes filtered reports as CSV, JSON and GeoJSON", () => {
    const item = report({ url: "https://example.com/report" });
    const csv = serializeReportExport("csv", [item]);
    expect(csv.extension).toBe("csv");
    expect(csv.content).toContain("Airstrikes reported");

    const json = JSON.parse(serializeReportExport("json", [item]).content);
    expect(json.reports).toHaveLength(1);
    expect(json.note).toContain("not a count");

    const geojson = JSON.parse(serializeReportExport("geojson", [item]).content);
    expect(geojson.type).toBe("FeatureCollection");
    expect(geojson.features[0].geometry.type).toBe("Point");
  });
});
