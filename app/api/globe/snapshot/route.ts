// Read-only globe activity snapshot endpoint (F6A). Serves the worker-built
// snapshot from PostgreSQL so the welcome globe reads persisted data instead of
// triggering a visitor pipeline (AGENTS.md §6). Same contract as /api/feeds/*.

import { getPool } from "@/lib/backend/db/pool";
import { rateLimit } from "@/lib/backend/http/rateLimit";
import {
  readGlobeSnapshot,
  GLOBE_SNAPSHOT_STALE_AFTER_SECONDS,
} from "@/lib/backend/payloads/globeSnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADER = "public, max-age=60";

export async function GET(request: Request): Promise<Response> {
  const limited = rateLimit(request, {
    bucket: "globe-snapshot",
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  let stored;
  try {
    stored = await readGlobeSnapshot(getPool("web"));
  } catch {
    return Response.json(
      { state: "unavailable", reason: "storage_unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!stored) {
    return Response.json(
      { state: "unavailable", reason: "no_snapshot_yet" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const etag = `"globe-${stored.generatedAt}"`;
  const ageSeconds = Math.max(
    0,
    Math.round((Date.now() - new Date(stored.generatedAt).getTime()) / 1000),
  );
  const isStale =
    stored.slot === "previous" ||
    ageSeconds > GLOBE_SNAPSHOT_STALE_AFTER_SECONDS;

  const headers: Record<string, string> = {
    ETag: etag,
    "Cache-Control": CACHE_HEADER,
  };

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  return Response.json(
    {
      ...stored.payload,
      // Read-time state overrides the stored fresh/partial when data has aged.
      state: isStale ? "stale" : stored.payload.state,
      ageSeconds,
      servedFromSlot: stored.slot,
    },
    { status: 200, headers },
  );
}
