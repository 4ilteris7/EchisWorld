// Read access to the worldwide administrative-outline table.
//
// Two jobs, both deliberately narrow:
//   1. name search for the search box (no geometry — results stay tiny)
//   2. fetch one outline by id, or resolve one from a clicked label
//
// Geometry is never selected in bulk. A search returns names and bounding
// boxes only; the outline itself is a separate single-row read. That is what
// keeps the web process flat in memory no matter how large the table grows.

import type { Pool } from "pg";

export type AdminLevel = 1 | 2;

export type AdminBoundarySummary = {
  id: string;
  level: AdminLevel;
  name: string;
  countryIso: string;
  countryName: string;
  center: [number, number];
  bbox: [number, number, number, number];
};

export type AdminBoundaryOutline = AdminBoundarySummary & {
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};

const SUMMARY_COLUMNS = `
  id, level, name, country_iso, country_name,
  center_lng, center_lat, min_lng, min_lat, max_lng, max_lat
`;

type SummaryRow = {
  id: string;
  level: number;
  name: string;
  country_iso: string;
  country_name: string;
  center_lng: number;
  center_lat: number;
  min_lng: number;
  min_lat: number;
  max_lng: number;
  max_lat: number;
};

function toSummary(row: SummaryRow): AdminBoundarySummary {
  return {
    id: row.id,
    level: row.level as AdminLevel,
    name: row.name,
    countryIso: row.country_iso,
    countryName: row.country_name,
    center: [row.center_lng, row.center_lat],
    bbox: [row.min_lng, row.min_lat, row.max_lng, row.max_lat],
  };
}

/**
 * Fold a query the same way the loader folded stored names, so an analyst can
 * type "sanli" and match "Şanlıurfa". Must stay in step with `normalizeName`
 * in scripts/build-admin-boundaries.mjs.
 */
export function normalizeQuery(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ğ/gi, "g")
    .replace(/ş/gi, "s")
    .replace(/ç/gi, "c")
    .replace(/ö/gi, "o")
    .replace(/ü/gi, "u")
    .replace(/ø/gi, "o")
    .replace(/æ/gi, "ae")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Escape LIKE wildcards so a typed "%" searches for a literal percent sign. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Search administrative units by name prefix.
 *
 * Prefix rather than substring: it is index-backed through
 * `text_pattern_ops` and needs no extension on the database image. Larger
 * units are returned first so typing "kon" surfaces the province before the
 * villages.
 */
export async function searchAdminBoundaries(
  pool: Pool,
  query: string,
  limit = 12,
): Promise<AdminBoundarySummary[]> {
  const normalized = normalizeQuery(query);
  if (normalized.length < 2) return [];

  const { rows } = await pool.query<SummaryRow>(
    `SELECT ${SUMMARY_COLUMNS}
       FROM admin_boundaries
      WHERE name_norm LIKE $1 ESCAPE '\\'
      ORDER BY
        -- exact match first, then shortest name, then larger unit
        (name_norm = $2) DESC,
        level ASC,
        length(name_norm) ASC,
        name ASC
      LIMIT $3`,
    [`${escapeLike(normalized)}%`, normalized, limit],
  );
  return rows.map(toSummary);
}

/**
 * Search, returning the outlines with the results.
 *
 * The search box draws the selected area immediately, so the geometry has to
 * travel with the hit rather than costing a second round trip. Kept to a short
 * result list because every row carries an outline: median 2.4 KB, and the
 * build-time vertex budget caps the worst single outline at ~72 KB.
 */
export async function searchAdminBoundariesWithOutline(
  pool: Pool,
  query: string,
  limit = 6,
): Promise<AdminBoundaryOutline[]> {
  const normalized = normalizeQuery(query);
  if (normalized.length < 2) return [];

  const { rows } = await pool.query<SummaryRow & { geometry: AdminBoundaryOutline["geometry"] }>(
    `SELECT ${SUMMARY_COLUMNS}, geometry
       FROM admin_boundaries
      WHERE name_norm LIKE $1 ESCAPE '\\'
      ORDER BY
        (name_norm = $2) DESC,
        level ASC,
        length(name_norm) ASC,
        name ASC
      LIMIT $3`,
    [`${escapeLike(normalized)}%`, normalized, limit],
  );
  return rows.map((row) => ({ ...toSummary(row), geometry: row.geometry }));
}

/** Fetch one outline by its stable geoBoundaries id. */
export async function getAdminBoundary(
  pool: Pool,
  id: string,
): Promise<AdminBoundaryOutline | null> {
  const { rows } = await pool.query<SummaryRow & { geometry: AdminBoundaryOutline["geometry"] }>(
    `SELECT ${SUMMARY_COLUMNS}, geometry FROM admin_boundaries WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return { ...toSummary(row), geometry: row.geometry };
}

/**
 * Resolve the unit an analyst clicked.
 *
 * The map hands over the label's text and where it sits. Matching on the name
 * alone is ambiguous worldwide — there are dozens of "Camden" and "San
 * Antonio" — so candidates are restricted to those whose bounding box contains
 * the click, then ranked by how close their centre is to it. The bbox test is
 * a plain comparison rather than PostGIS: enough for this, and it keeps the
 * database image stock.
 */
export async function resolveAdminBoundaryAt(
  pool: Pool,
  { name, lng, lat, level }: { name: string; lng: number; lat: number; level?: AdminLevel },
): Promise<AdminBoundaryOutline | null> {
  const normalized = normalizeQuery(name);
  if (!normalized) return null;

  const { rows } = await pool.query<SummaryRow & { geometry: AdminBoundaryOutline["geometry"] }>(
    `SELECT ${SUMMARY_COLUMNS}, geometry
       FROM admin_boundaries
      WHERE name_norm = $1
        AND min_lng <= $2 AND max_lng >= $2
        AND min_lat <= $3 AND max_lat >= $3
        AND ($4::smallint IS NULL OR level = $4)
      ORDER BY
        ((center_lng - $2) * (center_lng - $2) + (center_lat - $3) * (center_lat - $3)) ASC
      LIMIT 1`,
    [normalized, lng, lat, level ?? null],
  );
  const row = rows[0];
  if (!row) return null;
  return { ...toSummary(row), geometry: row.geometry };
}
