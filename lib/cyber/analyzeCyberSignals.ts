// ---------------------------------------------------------------------------
// Orchestrator: live RSS Cyber News items → region + sector metrics.
//
// This is the single entry point the UI calls. Everything it returns is
// INFERRED from RSS title+summary text (provenance flag set accordingly).
//
//   analyzeCyberSignals(items) → {
//     regions: RegionMetric[]   // "Most Mentioned Regions" panel
//     sectors: SectorMetric[]   // "Affected Sectors" panel
//     …provenance/inferred…
//   }
//
// Counting rules:
//   • A region counts AT MOST ONCE per item, even if several of its countries
//     are named (so "Chinese hackers target Taiwan" = East Asia ×1, not ×2).
//   • Role tallies CAN double inside one region/item: that same item adds +1 to
//     East Asia.origin (China) AND +1 to East Asia.target (Taiwan).
//   • A sector counts at most once per item; share = items / totalItems.
// ---------------------------------------------------------------------------

import type {
  AnalyzeOptions,
  CyberSignalInput,
  CyberSignalResult,
  GeoRole,
  ItemAnnotation,
  RegionId,
  RegionMetric,
  SectorId,
  SectorMetric,
} from "./types";
import { detectGeoSignals } from "./regionDetection";
import { detectSectors } from "./sectorDetection";
import { regionLabel } from "./geoLexicon";
import { SECTOR_LABELS } from "./sectorLexicon";

interface RegionAcc {
  regionId: RegionId;
  itemCount: number;
  roleBreakdown: Record<GeoRole, number>;
  countryCounts: Map<string, number>;
}

interface SectorAcc {
  sectorId: SectorId;
  itemCount: number;
  termCounts: Map<string, number>;
}

function dominantRole(breakdown: Record<GeoRole, number>): GeoRole {
  // Highest count wins; tie-break target > origin > neutral.
  const order: GeoRole[] = ["target", "origin", "neutral"];
  let best: GeoRole = "neutral";
  let bestCount = -1;
  for (const role of order) {
    if (breakdown[role] > bestCount) {
      bestCount = breakdown[role];
      best = role;
    }
  }
  return best;
}

function topCountries(counts: Map<string, number>, limit = 3): string[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

export function analyzeCyberSignals(
  items: readonly CyberSignalInput[],
  options: AnalyzeOptions = {},
): CyberSignalResult {
  const regionAcc = new Map<RegionId, RegionAcc>();
  const sectorAcc = new Map<SectorId, SectorAcc>();
  const annotations: ItemAnnotation[] = [];

  let analyzedItems = 0;
  let unspecifiedRegionItems = 0;

  items.forEach((item, index) => {
    const id = item.id ?? `item-${index}`;
    const geo = detectGeoSignals(item.title ?? "", item.summary ?? "");
    const sectors = detectSectors(item.title ?? "", item.summary ?? "");

    // ── Per-item region rollup (region counts once; roles can stack) ─────────
    // regionId → roles present in THIS item.
    const itemRegions = new Map<RegionId, { roles: Set<GeoRole>; countries: string[] }>();

    const ensure = (regionId: RegionId) => {
      let r = itemRegions.get(regionId);
      if (!r) {
        r = { roles: new Set<GeoRole>(), countries: [] };
        itemRegions.set(regionId, r);
      }
      return r;
    };

    for (const c of geo.countries) {
      const r = ensure(c.regionId);
      for (const role of c.roles) r.roles.add(role);
      r.countries.push(c.country);
    }
    for (const rd of geo.regionDirect) {
      const r = ensure(rd.regionId);
      for (const role of rd.roles) r.roles.add(role);
    }

    for (const [regionId, info] of itemRegions) {
      let acc = regionAcc.get(regionId);
      if (!acc) {
        acc = {
          regionId,
          itemCount: 0,
          roleBreakdown: { target: 0, origin: 0, neutral: 0 },
          countryCounts: new Map(),
        };
        regionAcc.set(regionId, acc);
      }
      acc.itemCount += 1;
      // Each distinct role this region played in this item adds one.
      // If only "neutral" is present, count neutral; otherwise count the
      // meaningful roles and ignore a redundant neutral.
      const roles = info.roles;
      const meaningful = [...roles].filter((r) => r !== "neutral");
      const rolesToCount = meaningful.length > 0 ? meaningful : (["neutral"] as GeoRole[]);
      for (const role of rolesToCount) acc.roleBreakdown[role] += 1;
      for (const name of info.countries) {
        acc.countryCounts.set(name, (acc.countryCounts.get(name) ?? 0) + 1);
      }
    }

    // ── Per-item sector rollup (sector counts once) ──────────────────────────
    for (const s of sectors) {
      let acc = sectorAcc.get(s.sectorId);
      if (!acc) {
        acc = { sectorId: s.sectorId, itemCount: 0, termCounts: new Map() };
        sectorAcc.set(s.sectorId, acc);
      }
      acc.itemCount += 1;
      for (const term of s.matchedTerms) {
        acc.termCounts.set(term, (acc.termCounts.get(term) ?? 0) + 1);
      }
    }

    const hasRegion = itemRegions.size > 0;
    const hasSector = sectors.length > 0;
    if (!hasRegion) unspecifiedRegionItems += 1;
    if (hasRegion || hasSector) analyzedItems += 1;

    if (options.includeAnnotations) {
      annotations.push({
        id,
        countries: geo.countries,
        actors: geo.actors,
        sectors,
        unresolved: !hasRegion && !hasSector,
      });
    }
  });

  const totalItems = items.length;
  const safeShare = (n: number) => (totalItems > 0 ? n / totalItems : 0);

  let regions: RegionMetric[] = Array.from(regionAcc.values()).map((acc) => ({
    regionId: acc.regionId,
    label: regionLabel(acc.regionId),
    itemCount: acc.itemCount,
    share: safeShare(acc.itemCount),
    roleBreakdown: acc.roleBreakdown,
    dominantRole: dominantRole(acc.roleBreakdown),
    sampleCountries: topCountries(acc.countryCounts),
  }));
  regions.sort((a, b) => b.itemCount - a.itemCount || a.label.localeCompare(b.label));
  if (options.maxRegions != null) regions = regions.slice(0, options.maxRegions);

  let sectors: SectorMetric[] = Array.from(sectorAcc.values()).map((acc) => ({
    sectorId: acc.sectorId,
    label: SECTOR_LABELS[acc.sectorId],
    itemCount: acc.itemCount,
    share: safeShare(acc.itemCount),
    sampleTerms: topCountries(acc.termCounts), // reuse top-N-by-count helper
  }));
  sectors.sort((a, b) => b.itemCount - a.itemCount || a.label.localeCompare(b.label));
  if (options.maxSectors != null) sectors = sectors.slice(0, options.maxSectors);

  return {
    totalItems,
    analyzedItems,
    unspecifiedRegionItems,
    regions,
    sectors,
    annotations: options.includeAnnotations ? annotations : undefined,
    provenance: "derived_from_rss_text",
    inferred: true,
  };
}
