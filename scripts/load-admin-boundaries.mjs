// Load the administrative-outline NDJSON into PostgreSQL.
//
// Streams the file line by line and inserts in batches, so peak memory stays
// flat regardless of dataset size — the 4 GB production box never holds more
// than one batch. Safe to re-run: rows are upserted on their stable
// geoBoundaries shapeID.
//
// Usage:
//   node scripts/load-admin-boundaries.mjs data/admin-boundaries.ndjson
//   node scripts/load-admin-boundaries.mjs data/admin-boundaries.ndjson --truncate

import { createReadStream } from "node:fs";
import readline from "node:readline";
import pg from "pg";

const BATCH_SIZE = 500;
const COLUMNS = [
  "id",
  "level",
  "name",
  "name_norm",
  "country_iso",
  "country_name",
  "center_lng",
  "center_lat",
  "min_lng",
  "min_lat",
  "max_lng",
  "max_lat",
  "point_count",
  "geometry",
];

const file = process.argv[2];
const truncate = process.argv.includes("--truncate");

if (!file) {
  console.error("usage: node scripts/load-admin-boundaries.mjs <file.ndjson> [--truncate]");
  process.exit(1);
}

const connectionString =
  process.env.ECHIS_DATABASE_URL_OWNER ??
  "postgres://echis_owner:echis_local_owner_dev@127.0.0.1:5432/echis";

/** One multi-row INSERT ... ON CONFLICT per batch. */
async function flush(client, rows) {
  if (!rows.length) return;
  const values = [];
  const tuples = rows.map((row, i) => {
    const base = i * COLUMNS.length;
    values.push(
      row.id,
      row.level,
      row.name,
      row.name_norm,
      row.country_iso,
      row.country_name,
      row.center_lng,
      row.center_lat,
      row.min_lng,
      row.min_lat,
      row.max_lng,
      row.max_lat,
      row.point_count,
      JSON.stringify(row.geometry),
    );
    return `(${COLUMNS.map((_, c) => `$${base + c + 1}`).join(",")})`;
  });

  await client.query(
    `INSERT INTO admin_boundaries (${COLUMNS.join(",")})
     VALUES ${tuples.join(",")}
     ON CONFLICT (id) DO UPDATE SET
       level = EXCLUDED.level,
       name = EXCLUDED.name,
       name_norm = EXCLUDED.name_norm,
       country_iso = EXCLUDED.country_iso,
       country_name = EXCLUDED.country_name,
       center_lng = EXCLUDED.center_lng,
       center_lat = EXCLUDED.center_lat,
       min_lng = EXCLUDED.min_lng,
       min_lat = EXCLUDED.min_lat,
       max_lng = EXCLUDED.max_lng,
       max_lat = EXCLUDED.max_lat,
       point_count = EXCLUDED.point_count,
       geometry = EXCLUDED.geometry`,
    values,
  );
}

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();

  if (truncate) {
    await client.query("TRUNCATE admin_boundaries");
    console.log("truncated admin_boundaries");
  }

  const rl = readline.createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity,
  });

  let batch = [];
  let loaded = 0;
  let skipped = 0;
  let duplicates = 0;
  // PostgreSQL rejects an INSERT ... ON CONFLICT that touches the same row
  // twice in one statement, and the source does contain repeats: the
  // geoBoundaries country index lists India under ADM1 twice, so its 36 states
  // arrive duplicated. Dedupe across the whole file rather than per batch, so
  // a repeat that straddles a batch boundary is caught too.
  const seen = new Set();

  for await (const line of rl) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if (seen.has(row.id)) {
      duplicates++;
      continue;
    }
    seen.add(row.id);
    batch.push(row);
    if (batch.length >= BATCH_SIZE) {
      await flush(client, batch);
      loaded += batch.length;
      batch = [];
      process.stdout.write(`\r  loaded ${loaded} units`);
    }
  }
  await flush(client, batch);
  loaded += batch.length;

  const { rows } = await client.query(
    `SELECT level, count(*)::int AS units, count(DISTINCT country_iso)::int AS countries
       FROM admin_boundaries GROUP BY level ORDER BY level`,
  );
  const { rows: size } = await client.query(
    `SELECT pg_size_pretty(pg_total_relation_size('admin_boundaries')) AS total`,
  );

  console.log(
    `\r  loaded ${loaded} units` +
      (duplicates ? `, ${duplicates} duplicate ids skipped` : "") +
      (skipped ? `, ${skipped} unparseable lines skipped` : "") +
      "                    ",
  );
  for (const r of rows) {
    console.log(`  ADM${r.level}: ${r.units} units across ${r.countries} countries`);
  }
  console.log(`  table size on disk: ${size[0].total}`);

  await client.end();
}

main().catch((error) => {
  console.error("\nload failed:", error.message);
  process.exitCode = 1;
});
