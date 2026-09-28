// Build the worldwide administrative-outline dataset (ADM1 + ADM2).
//
// Downloads geoBoundaries gbOpen per-country SIMPLIFIED files and emits one
// NDJSON line per unit, ready for scripts/load-admin-boundaries.mjs.
//
// Deliberately per-country rather than the single global CGAZ file: the global
// ADM2 file is 525 MB and JSON.parse on it needs several GB of heap, which
// would OOM the 4 GB production box. Per-country files are a few MB each, so
// this runs safely anywhere and is resumable if the network drops.
//
// Run this on a workstation, not on the VPS. The server only ever receives the
// finished NDJSON.
//
// Usage:
//   node scripts/build-admin-boundaries.mjs
//   node scripts/build-admin-boundaries.mjs --only=TUR,DEU --out=data/sample.ndjson
//   node scripts/build-admin-boundaries.mjs --resume

import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { createReadStream } from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://www.geoboundaries.org/api/current/gbOpen";
const LEVELS = [
  { tag: "ADM1", level: 1 },
  { tag: "ADM2", level: 2 },
];

/** Coordinate precision. 4 decimals ≈ 11 m, far finer than these outlines. */
const COORD_DECIMALS = 4;
/** Politeness delay between requests to geoboundaries.org. */
const REQUEST_DELAY_MS = 300;
/**
 * Vertex budget per unit. Measured on the raw source: 118 units exceed 100 KB
 * and Nunavut alone is 5.98 MB across 319,451 vertices — almost all of it
 * Arctic islands invisible at any zoom this feature is used at. Shipping that
 * on a click would be absurd, so oversized outlines are simplified down until
 * they fit. 4000 vertices lands around 70 KB, which is the worst case a click
 * can cost.
 */
const MAX_POINTS = 4000;

const args = process.argv.slice(2);
const argValue = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const OUT_PATH = path.resolve(ROOT, argValue("out") ?? "data/admin-boundaries.ndjson");
const ONLY = argValue("only")?.split(",").map((s) => s.trim().toUpperCase()) ?? null;
const RESUME = args.includes("--resume");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Repair UTF-8 that was decoded as Latin-1 somewhere upstream.
 *
 * Some source files ship names like "RegiÃ³n de Magallanes" instead of
 * "Región de Magallanes". Left alone, those names are unsearchable — nobody
 * types "Ã³". The fix is to re-interpret the bytes as UTF-8; it is only kept
 * if the result is clean, so correctly-encoded names pass through untouched.
 */
function repairEncoding(text) {
  if (!/[ÃÂ]/.test(text)) return text;
  try {
    const repaired = Buffer.from(text, "latin1").toString("utf8");
    if (repaired.includes("�")) return text;
    // Only accept if it actually removed the tell-tale sequences.
    return /[ÃÂ]/.test(repaired) ? text : repaired;
  } catch {
    return text;
  }
}

/** Squared perpendicular distance from p to the segment a-b, in degrees². */
function segmentDistanceSq(p, a, b) {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/**
 * Douglas-Peucker, iterative so a 300k-vertex ring cannot blow the call stack.
 * Endpoints are always kept, which keeps the ring closed.
 */
function simplifyRing(ring, toleranceSq) {
  if (ring.length <= 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const dist = segmentDistanceSq(ring[i], ring[first], ring[last]);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (index !== -1 && maxDist > toleranceSq) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out = [];
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i]);
  // A polygon ring needs at least 4 positions (closed triangle).
  return out.length >= 4 ? out : ring.slice(0, 4);
}

/** Longest bbox side of a ring, in degrees. */
function ringExtent(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return Math.max(maxX - minX, maxY - minY);
}

function countPoints(coordinates) {
  const walk = (node) =>
    typeof node[0] === "number" ? 1 : node.reduce((sum, child) => sum + walk(child), 0);
  return walk(coordinates);
}

/**
 * Shrink an outline until it fits the vertex budget.
 *
 * Two passes per round: whole rings smaller than the tolerance are dropped
 * (this is what removes the thousands of Arctic islets that dominate Nunavut),
 * then the survivors are simplified. The outer ring of each polygon is never
 * dropped, so a unit can never vanish entirely.
 */
function simplifyGeometry(geometry, maxPoints) {
  if (!geometry?.coordinates) return geometry;
  if (countPoints(geometry.coordinates) <= maxPoints) return geometry;

  const isMulti = geometry.type === "MultiPolygon";
  let polygons = isMulti ? geometry.coordinates : [geometry.coordinates];
  let tolerance = 0.0005; // ~55 m

  for (let round = 0; round < 12; round++) {
    const toleranceSq = tolerance * tolerance;
    const next = [];
    for (const polygon of polygons) {
      const rings = [];
      for (const [index, ring] of polygon.entries()) {
        // Keep every outer ring; drop holes and islands below the tolerance.
        if (index > 0 && ringExtent(ring) < tolerance * 4) continue;
        rings.push(simplifyRing(ring, toleranceSq));
      }
      if (rings.length) next.push(rings);
    }
    // Drop whole islands that have shrunk below the tolerance, but never the
    // largest one — a unit must always keep a body.
    const survivors =
      next.length > 1
        ? next.filter((p, i) => i === 0 || ringExtent(p[0]) >= tolerance * 4)
        : next;
    polygons = survivors.length ? survivors : next;

    if (countPoints(isMulti ? polygons : polygons[0]) <= maxPoints) break;
    tolerance *= 2;
  }

  return isMulti
    ? { type: "MultiPolygon", coordinates: polygons }
    : { type: "Polygon", coordinates: polygons[0] };
}

/** Lower-case and strip diacritics so "sanli" matches "Şanlıurfa". */
function normalizeName(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Turkish dotless/dotted i and a few letters NFD does not decompose.
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

/** Round every coordinate in place and collect bbox + point count. */
function reduceGeometry(geometry) {
  const f = 10 ** COORD_DECIMALS;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let count = 0;
  // Weighted centroid of the vertices — good enough to anchor a label and to
  // disambiguate same-named units; this is not a centre-of-mass calculation.
  let sumLng = 0;
  let sumLat = 0;

  const walk = (node) => {
    if (typeof node[0] === "number") {
      const lng = Math.round(node[0] * f) / f;
      const lat = Math.round(node[1] * f) / f;
      node[0] = lng;
      node[1] = lat;
      if (node.length > 2) node.length = 2; // drop any elevation
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
      sumLng += lng;
      sumLat += lat;
      count++;
      return;
    }
    for (const child of node) walk(child);
  };

  if (!geometry?.coordinates) return null;
  walk(geometry.coordinates);
  if (!count) return null;

  return {
    minLng,
    minLat,
    maxLng,
    maxLat,
    centerLng: Math.round((sumLng / count) * f) / f,
    centerLat: Math.round((sumLat / count) * f) / f,
    pointCount: count,
  };
}

async function fetchJson(url, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      if (i === attempts - 1) throw error;
      await sleep(1000 * (i + 1));
    }
  }
  return null;
}

/** Country codes already present in the output, so --resume can skip them. */
async function alreadyDone(outPath) {
  const done = new Set();
  if (!existsSync(outPath)) return done;
  const rl = readline.createInterface({
    input: createReadStream(outPath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      done.add(`${row.country_iso}:${row.level}`);
    } catch {
      // A truncated final line from an interrupted run — ignore it.
    }
  }
  return done;
}

async function main() {
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const done = RESUME ? await alreadyDone(OUT_PATH) : new Set();
  if (RESUME) console.log(`resuming — ${done.size} country/level pairs already written`);

  const out = createWriteStream(OUT_PATH, { flags: RESUME ? "a" : "w" });
  const write = (line) =>
    out.write(line) ? Promise.resolve() : new Promise((r) => out.once("drain", r));

  let units = 0;
  let bytes = 0;
  const missing = [];

  for (const { tag, level } of LEVELS) {
    const index = await fetchJson(`${API}/ALL/${tag}/`);
    if (!Array.isArray(index)) {
      console.error(`could not list countries for ${tag}`);
      continue;
    }
    // The upstream index repeats some countries (India is listed twice under
    // ADM1), which would emit the same units twice and break the loader's
    // upsert. Keep the first entry per ISO code.
    const byIso = new Map();
    for (const entry of index) {
      if (!byIso.has(entry.boundaryISO)) byIso.set(entry.boundaryISO, entry);
    }
    const deduped = [...byIso.values()];
    const countries = ONLY
      ? deduped.filter((c) => ONLY.includes(c.boundaryISO))
      : deduped;
    console.log(`\n${tag}: ${countries.length} countries`);

    for (const [i, meta] of countries.entries()) {
      const iso = meta.boundaryISO;
      if (done.has(`${iso}:${level}`)) continue;
      await sleep(REQUEST_DELAY_MS);

      const url = meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL;
      if (!url) {
        missing.push(`${iso} ${tag} (no download url)`);
        continue;
      }

      let fc;
      try {
        fc = await fetchJson(url);
      } catch (error) {
        missing.push(`${iso} ${tag} (${error.message})`);
        continue;
      }
      if (!fc?.features?.length) {
        missing.push(`${iso} ${tag} (empty)`);
        continue;
      }

      let written = 0;
      for (const feature of fc.features) {
        const props = feature.properties ?? {};
        const name = repairEncoding(props.shapeName?.trim() ?? "");
        const id = props.shapeID?.trim();
        if (!name || !id) continue;
        // Simplify BEFORE measuring, so bbox and centroid describe what is
        // actually stored.
        const geometry = simplifyGeometry(feature.geometry, MAX_POINTS);
        const box = reduceGeometry(geometry);
        if (!box) continue;

        const row = {
          id,
          level,
          name,
          name_norm: normalizeName(name),
          country_iso: iso,
          country_name: repairEncoding(meta.boundaryName ?? iso),
          center_lng: box.centerLng,
          center_lat: box.centerLat,
          min_lng: box.minLng,
          min_lat: box.minLat,
          max_lng: box.maxLng,
          max_lat: box.maxLat,
          point_count: box.pointCount,
          geometry,
        };
        const line = `${JSON.stringify(row)}\n`;
        bytes += Buffer.byteLength(line);
        await write(line);
        written++;
        units++;
      }

      const mb = (bytes / 1048576).toFixed(0);
      process.stdout.write(
        `\r  ${tag} ${String(i + 1).padStart(3)}/${countries.length}  ` +
          `${iso} +${String(written).padStart(5)}   total ${units} units, ${mb} MB   `,
      );
    }
    process.stdout.write("\n");
  }

  await new Promise((resolve) => out.end(resolve));
  console.log(`\nwrote ${units} units → ${OUT_PATH}`);
  console.log(`output size: ${(bytes / 1048576).toFixed(1)} MB`);
  if (missing.length) {
    console.log(`\n${missing.length} country/level pairs unavailable:`);
    for (const m of missing) console.log(`  - ${m}`);
  }
}

main().catch((error) => {
  console.error("\nbuild failed:", error);
  process.exitCode = 1;
});
