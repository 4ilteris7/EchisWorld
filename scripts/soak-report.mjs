// F2D soak/cadence report — read-only summary of collector behavior.
// Usage: npm run soak:report   (env: ECHIS_DATABASE_URL_OWNER optional)

import pg from "pg";

const client = new pg.Client({
  connectionString:
    process.env.ECHIS_DATABASE_URL_OWNER ??
    "postgres://echis_owner:echis_local_owner_dev@127.0.0.1:5432/echis",
});
await client.connect();

const q = async (sql, params = []) => (await client.query(sql, params)).rows;

const [hb] = await q(
  `SELECT pid, started_at, last_heartbeat_at,
          EXTRACT(EPOCH FROM now() - last_heartbeat_at)::int AS stale_seconds,
          shutdown_at, shutdown_reason
     FROM worker_heartbeats WHERE worker_id = 'collector'`,
);
console.log("=== worker ===");
if (!hb) console.log("no heartbeat row");
else
  console.log(
    `pid=${hb.pid} started=${hb.started_at.toISOString()} ` +
      `heartbeat_stale=${hb.stale_seconds}s ` +
      (hb.shutdown_at ? `SHUTDOWN(${hb.shutdown_reason})` : "running"),
  );

const [runs] = await q(
  `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE status = 'success')::int AS ok,
          count(*) FILTER (WHERE status = 'partial')::int AS partial,
          count(*) FILTER (WHERE status = 'failed')::int AS failed,
          min(started_at) AS first_run, max(started_at) AS last_run,
          COALESCE(sum(new_items), 0)::int AS new_items,
          COALESCE(sum(duplicate_items), 0)::int AS duplicates
     FROM collector_runs WHERE attempted_sources > 0`,
);
console.log("\n=== runs (non-empty cycles) ===");
console.log(
  `total=${runs.total} ok=${runs.ok} partial=${runs.partial} failed=${runs.failed}`,
);
if (runs.first_run) {
  console.log(
    `window=${runs.first_run.toISOString()} → ${runs.last_run.toISOString()}`,
  );
  console.log(`new_items=${runs.new_items} duplicates=${runs.duplicates}`);
}

console.log("\n=== per source (window totals) ===");
const perSource = await q(
  `SELECT source_id,
          count(*)::int AS attempts,
          count(*) FILTER (WHERE error_code IS NULL)::int AS ok,
          count(*) FILTER (WHERE not_modified)::int AS http304,
          COALESCE(sum(new_items), 0)::int AS new_items,
          round(avg(duration_ms))::int AS avg_ms,
          round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_ms,
          max(created_at) FILTER (WHERE error_code IS NOT NULL) AS last_error_at,
          (array_agg(error_code ORDER BY created_at DESC)
             FILTER (WHERE error_code IS NOT NULL))[1] AS last_error
     FROM collector_source_results
    GROUP BY source_id ORDER BY source_id`,
);
for (const r of perSource) {
  const okRate = r.attempts ? Math.round((100 * r.ok) / r.attempts) : 0;
  console.log(
    `${r.source_id.padEnd(20)} attempts=${String(r.attempts).padStart(4)} ` +
      `ok=${String(okRate).padStart(3)}% 304=${String(r.http304).padStart(4)} ` +
      `new=${String(r.new_items).padStart(5)} avg=${String(r.avg_ms ?? "-").padStart(5)}ms ` +
      `p95=${String(r.p95_ms ?? "-").padStart(5)}ms` +
      (r.last_error ? ` last_error=${r.last_error}` : ""),
  );
}

console.log("\n=== schedule state ===");
const state = await q(
  `SELECT source_id, effective_poll_interval_seconds AS eff, schedule_reason,
          unchanged_streak, consecutive_failures,
          rss_ttl_hint_seconds AS ttl,
          observed_publish_interval_seconds AS observed,
          GREATEST(0, EXTRACT(EPOCH FROM now() - next_poll_at))::int AS overdue_s
     FROM source_runtime_state WHERE enabled ORDER BY source_id`,
);
for (const r of state) {
  console.log(
    `${r.source_id.padEnd(20)} eff=${String(r.eff).padStart(5)}s ` +
      `reason=${String(r.schedule_reason).padEnd(16)} streak=${r.unchanged_streak} ` +
      `fails=${r.consecutive_failures} ttl=${r.ttl ?? "-"} obs=${r.observed ?? "-"} ` +
      (r.overdue_s > 120 ? `OVERDUE ${r.overdue_s}s` : ""),
  );
}

const [items] = await q(
  `SELECT count(*)::int AS total,
          min(published_at) AS oldest_pub, max(published_at) AS newest_pub,
          pg_size_pretty(pg_total_relation_size('collected_items')) AS table_size
     FROM collected_items`,
);
const [tomb] = await q(
  "SELECT count(*)::int AS n FROM dedupe_tombstones",
);
console.log("\n=== items ===");
console.log(
  `collected=${items.total} tombstones=${tomb.n} size=${items.table_size}`,
);
if (items.oldest_pub) {
  console.log(
    `published window: ${items.oldest_pub.toISOString()} → ${items.newest_pub.toISOString()}`,
  );
}

await client.end();
