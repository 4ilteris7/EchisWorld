// Repeatable local ECHIS baseline measurement.
//
// Measures only current read-only web routes. It never contacts upstream
// providers directly, reads API keys, or mutates application/database state.
//
// Usage:
//   node scripts/measure-baseline.mjs [--base http://127.0.0.1:3000]
//     [--concurrency 4] [--json docs/evidence/baseline.json]

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const BASE = argValue("--base", "http://127.0.0.1:3000").replace(/\/$/, "");
const CONCURRENCY = Math.max(1, Number(argValue("--concurrency", "4")) || 4);
const JSON_OUT = argValue("--json", "");
const TIMEOUT_MS = 30_000;

const targets = [
  { id: "home", path: "/", kind: "page" },
  { id: "health", path: "/api/health", kind: "api" },
  { id: "global", path: "/api/feeds/global", kind: "api" },
  { id: "cyber", path: "/api/feeds/cyber", kind: "api" },
  { id: "defense", path: "/api/feeds/defense", kind: "api" },
  { id: "policy", path: "/api/feeds/policy", kind: "api" },
  { id: "globe", path: "/api/globe/snapshot", kind: "api" },
];

function payloadCounts(body) {
  if (!body || typeof body !== "object") return null;
  const counts = {};
  for (const key of ["items", "events", "markers", "points"]) {
    if (Array.isArray(body[key])) counts[key] = body[key].length;
  }
  for (const key of ["totalWindowItems", "totalItemCount", "geolocatedItemCount"]) {
    if (Number.isFinite(body[key])) counts[key] = body[key];
  }
  return Object.keys(counts).length ? counts : null;
}

async function measure(target) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${target.path}`, {
      headers: { Accept: target.kind === "api" ? "application/json" : "text/html" },
      signal: controller.signal,
    });
    const bodyText = await response.text();
    let body = null;
    if (response.headers.get("content-type")?.includes("application/json")) {
      try { body = JSON.parse(bodyText); } catch { /* body size still counts */ }
    }
    return {
      ...target,
      ok: response.ok,
      status: response.status,
      ms: Math.round(performance.now() - started),
      bytes: Buffer.byteLength(bodyText, "utf8"),
      contentType: response.headers.get("content-type"),
      state: body?.state ?? body?.status ?? null,
      generatedAt: body?.generatedAt ?? null,
      counts: payloadCounts(body),
      reason: response.ok ? null : body?.reason ?? body?.error ?? null,
    };
  } catch (error) {
    return {
      ...target,
      ok: false,
      status: 0,
      ms: Math.round(performance.now() - started),
      bytes: 0,
      contentType: null,
      state: null,
      generatedAt: null,
      counts: null,
      reason: error?.name === "AbortError" ? "client_timeout" : String(error?.message ?? error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runPool(items, worker, size) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
  return results;
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return Math.round(sorted[low] + (sorted[high] - sorted[low]) * (position - low));
}

const startedAt = new Date().toISOString();
const wallStart = performance.now();
const results = await runPool(targets, measure, CONCURRENCY);
const wallMs = Math.round(performance.now() - wallStart);
const okResults = results.filter((result) => result.ok);
const latencies = okResults.map((result) => result.ms).sort((a, b) => a - b);
const summary = {
  startedAt,
  base: BASE,
  requestCount: results.length,
  okCount: okResults.length,
  failedCount: results.length - okResults.length,
  wallMs,
  latencyMsP50: quantile(latencies, 0.5),
  latencyMsP95: quantile(latencies, 0.95),
  latencyMsMax: latencies.at(-1) ?? 0,
  totalPayloadBytes: results.reduce((sum, result) => sum + result.bytes, 0),
};

console.log("\n=== EchisWorld local baseline ===");
for (const [key, value] of Object.entries(summary)) {
  console.log(`${key.padEnd(18)} ${value}`);
}
console.log("\n--- routes ---");
for (const result of results) {
  console.log(`${result.id.padEnd(10)} ${String(result.status).padStart(3)} ${String(result.ms).padStart(5)} ms ${String(result.bytes).padStart(8)} B ${result.state ?? "-"}`);
}

if (JSON_OUT) {
  const outputPath = path.resolve(JSON_OUT);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({ summary, results }, null, 2));
  console.log(`\nJSON detail written: ${outputPath}`);
}

if (summary.failedCount) process.exitCode = 1;
