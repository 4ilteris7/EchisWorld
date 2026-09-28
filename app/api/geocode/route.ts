// Administrative-area search.
//
// Answers from the SELF-HOSTED boundary table first (geoBoundaries ADM1/ADM2,
// 52k units, every country), and only falls through to Nominatim for what that
// table does not carry — chiefly neighbourhood level, which no global open
// dataset publishes. The site runs on a single VPS, so every request to a
// public geocoder leaves from one IP and shares one quota; keeping the common
// case local is what makes this feature safe to publish.
//
// The fallback is deliberately left intact rather than removed: it is the only
// thing that answers a mahalle query, and it degrades gracefully when the
// local table is missing (before the migration has been applied, everything
// simply behaves as it did before).

import { getPool } from "@/lib/backend/db/pool";
import { rateLimit } from "@/lib/backend/http/rateLimit";
import {
  searchAdminBoundariesWithOutline,
  type AdminBoundaryOutline,
} from "@/lib/backend/repositories/adminBoundaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdministrativeLevel =
  | "province"
  | "district"
  | "neighbourhood"
  | "settlement";

type GeocodeGeometry = {
  type: "Point" | "Polygon" | "MultiPolygon";
  coordinates: unknown[];
};

type GeocodeResult = {
  id: string;
  name: string;
  displayName: string;
  level: AdministrativeLevel;
  context: string;
  center: [number, number];
  bbox: [number, number, number, number];
  geometry: GeocodeGeometry;
};

type CacheEntry = {
  expiresAt: number;
  results: GeocodeResult[];
};

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const UPSTREAM_INTERVAL_MS = 1100;
const UPSTREAM_TIMEOUT_MS = 8000;
const geocodeCache = new Map<string, CacheEntry>();
let lastUpstreamRequestAt = 0;
let upstreamQueue: Promise<void> = Promise.resolve();

const ADMINISTRATIVE_TYPES = new Set([
  "administrative",
  "borough",
  "city",
  "city_district",
  "county",
  "district",
  "hamlet",
  "municipality",
  "neighbourhood",
  "province",
  "quarter",
  "region",
  "state",
  "state_district",
  "suburb",
  "town",
  "village",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericField(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeQuery(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 120);
}

function administrativeLevel(type: string, category: string): AdministrativeLevel {
  if (["state", "province", "region"].includes(type)) return "province";
  if (
    [
      "borough",
      "city_district",
      "county",
      "district",
      "municipality",
      "state_district",
    ].includes(type)
  ) {
    return "district";
  }
  if (["neighbourhood", "quarter", "suburb"].includes(type)) {
    return "neighbourhood";
  }
  // OSM commonly exposes Turkish ilçe relations (for example Çankaya) with
  // address type `town`. The boundary category distinguishes them from a town
  // settlement node, which should remain a settlement result.
  if (category === "boundary" && ["city", "town"].includes(type)) {
    return "district";
  }
  return "settlement";
}

function contextLabel(address: Record<string, unknown>, resultName: string): string {
  const candidates = [
    address.neighbourhood,
    address.quarter,
    address.suburb,
    address.city_district,
    address.district,
    address.county,
    address.city,
    address.town,
    address.state,
    address.province,
    address.country,
  ];
  const seen = new Set([resultName.toLocaleLowerCase("tr-TR")]);
  return candidates
    .flatMap((value) => {
      const text = stringField(value);
      if (!text) return [];
      const key = text.toLocaleLowerCase("tr-TR");
      if (seen.has(key)) return [];
      seen.add(key);
      return [text];
    })
    .slice(0, 3)
    .join(" · ");
}

function parseGeometry(value: unknown): GeocodeGeometry | null {
  if (!isRecord(value) || !Array.isArray(value.coordinates)) return null;
  if (!(["Point", "Polygon", "MultiPolygon"] as unknown[]).includes(value.type)) {
    return null;
  }
  // Protect the map from an unexpectedly huge upstream geometry. Nominatim's
  // polygon simplification keeps normal administrative boundaries far below it.
  if (JSON.stringify(value.coordinates).length > 1_000_000) return null;
  return {
    type: value.type as GeocodeGeometry["type"],
    coordinates: value.coordinates,
  };
}

function parseResult(value: unknown): GeocodeResult | null {
  if (!isRecord(value)) return null;
  const type = stringField(value.addresstype) ?? stringField(value.type) ?? "";
  const category = stringField(value.category) ?? stringField(value.class) ?? "";
  if (!ADMINISTRATIVE_TYPES.has(type) && category !== "boundary" && category !== "place") {
    return null;
  }

  const lat = numericField(value.lat);
  const lng = numericField(value.lon);
  const displayName = stringField(value.display_name);
  const rawBbox = value.boundingbox;
  const geometry = parseGeometry(value.geojson);
  if (
    lat === null ||
    lng === null ||
    !displayName ||
    !geometry ||
    !Array.isArray(rawBbox) ||
    rawBbox.length !== 4
  ) {
    return null;
  }

  const south = numericField(rawBbox[0]);
  const north = numericField(rawBbox[1]);
  const west = numericField(rawBbox[2]);
  const east = numericField(rawBbox[3]);
  if (south === null || north === null || west === null || east === null) return null;

  const name = stringField(value.name) ?? displayName.split(",")[0]?.trim();
  if (!name) return null;
  const address = isRecord(value.address) ? value.address : {};

  return {
    id: String(value.place_id ?? `${type}-${lng}-${lat}`),
    name,
    displayName,
    level: administrativeLevel(type, category),
    context: contextLabel(address, name),
    center: [lng, lat],
    bbox: [west, south, east, north],
    geometry,
  };
}

async function reserveUpstreamSlot(): Promise<void> {
  const reservation = upstreamQueue.then(async () => {
    const waitMs = Math.max(
      0,
      lastUpstreamRequestAt + UPSTREAM_INTERVAL_MS - Date.now(),
    );
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastUpstreamRequestAt = Date.now();
  });
  upstreamQueue = reservation.catch(() => undefined);
  return reservation;
}

const LOCAL_ATTRIBUTION = "© geoBoundaries (CC BY 4.0)";

/** Map a stored outline onto the shape the client already consumes. */
function fromLocal(row: AdminBoundaryOutline): GeocodeResult {
  const [west, south, east, north] = row.bbox;
  return {
    id: row.id,
    name: row.name,
    displayName: `${row.name}, ${row.countryName}`,
    // ADM1 is the province/state tier, ADM2 the district tier.
    level: row.level === 1 ? "province" : "district",
    context: row.countryName,
    center: row.center,
    bbox: [west, south, east, north],
    geometry: row.geometry as GeocodeGeometry,
  };
}

/**
 * Look the query up in the local table.
 *
 * Any failure here — table not migrated yet, database briefly unreachable —
 * is swallowed on purpose so the endpoint silently reverts to its previous
 * upstream-only behaviour instead of breaking the search box.
 */
async function searchLocal(query: string): Promise<GeocodeResult[]> {
  try {
    const rows = await searchAdminBoundariesWithOutline(getPool("web"), query);
    return rows.map(fromLocal);
  } catch (error) {
    console.warn("[api/geocode] local boundary lookup unavailable:", error);
    return [];
  }
}

function remember(cacheKey: string, results: GeocodeResult[]): void {
  if (geocodeCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = geocodeCache.keys().next().value;
    if (oldestKey !== undefined) geocodeCache.delete(oldestKey);
  }
  geocodeCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, results });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = normalizeQuery(url.searchParams.get("q") ?? "");
  if (query.length < 2) {
    return Response.json(
      { error: "invalid_query", results: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const cacheKey = query.toLocaleLowerCase("tr-TR");
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json(
      { results: cached.results, attribution: "© OpenStreetMap contributors" },
      { headers: { "Cache-Control": "private, max-age=3600" } },
    );
  }

  // Local table first. This answers province and district for every country
  // with no external call, no quota and no network latency.
  const localResults = await searchLocal(query);
  if (localResults.length) {
    remember(cacheKey, localResults);
    return Response.json(
      { results: localResults, attribution: LOCAL_ATTRIBUTION },
      { headers: { "Cache-Control": "private, max-age=3600" } },
    );
  }

  // Nothing locally — mahalle, a street, or a name the dataset spells
  // differently. Only now is the shared upstream quota spent, so the strict
  // limiter guards the fallback rather than the whole endpoint.
  const limited = rateLimit(request, {
    bucket: "administrative-geocode",
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  await reserveUpstreamSlot();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const acceptLanguage =
    request.headers.get("accept-language")?.slice(0, 96) || "tr-TR,tr;q=0.9,en;q=0.7";

  const upstreamUrl = new URL(NOMINATIM_SEARCH_URL);
  upstreamUrl.searchParams.set("q", query);
  upstreamUrl.searchParams.set("format", "jsonv2");
  upstreamUrl.searchParams.set("addressdetails", "1");
  upstreamUrl.searchParams.set("polygon_geojson", "1");
  upstreamUrl.searchParams.set("polygon_threshold", "0.002");
  upstreamUrl.searchParams.set("dedupe", "1");
  upstreamUrl.searchParams.set("limit", "8");

  try {
    const response = await fetch(upstreamUrl, {
      headers: {
        Accept: "application/json",
        "Accept-Language": acceptLanguage,
        Referer: url.origin,
        "User-Agent": "EchisWorld-Monitor/0.2 (administrative-area-search)",
      },
      next: { revalidate: CACHE_TTL_MS / 1000 },
      signal: controller.signal,
    });
    if (!response.ok) {
      return Response.json(
        { error: "geocoder_unavailable", results: [] },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const payload: unknown = await response.json();
    const results = Array.isArray(payload)
      ? payload.flatMap((entry) => {
          const parsed = parseResult(entry);
          return parsed ? [parsed] : [];
        })
      : [];
    const primaryQuery = query.split(",")[0]?.trim().toLocaleLowerCase("tr-TR");
    results.sort((left, right) => {
      const leftExact = left.name.toLocaleLowerCase("tr-TR") === primaryQuery ? 0 : 1;
      const rightExact = right.name.toLocaleLowerCase("tr-TR") === primaryQuery ? 0 : 1;
      return leftExact - rightExact;
    });
    results.splice(6);
    remember(cacheKey, results);

    return Response.json(
      { results, attribution: "© OpenStreetMap contributors" },
      { headers: { "Cache-Control": "private, max-age=3600" } },
    );
  } catch (error) {
    console.warn(
      "[geocode] upstream request failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json(
      { error: "geocoder_unavailable", results: [] },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
