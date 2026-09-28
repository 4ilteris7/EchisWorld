// Read-only Cyber News feed endpoint (F3A).
//
// Serves the worker-built derived payload from PostgreSQL. Never touches any
// upstream source: if the worker is down, the last valid payload is served as
// stale; if nothing exists yet, 503 with an explicit unavailable state — no
// invented data (roadmap §9.4, §22.4).

import { getPool } from "@/lib/backend/db/pool";
import { rateLimit } from "@/lib/backend/http/rateLimit";
import {
  readCyberPayload,
  CYBER_PAYLOAD_STALE_AFTER_SECONDS,
} from "@/lib/backend/payloads/cyberPayload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADER = "public, max-age=60";

export async function GET(request: Request): Promise<Response> {
  const limited = rateLimit(request, {
    bucket: "feeds-cyber",
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  let stored;
  try {
    stored = await readCyberPayload(getPool("web"));
  } catch {
    return Response.json(
      { state: "unavailable", reason: "storage_unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!stored) {
    return Response.json(
      { state: "unavailable", reason: "no_payload_yet" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const etag = `"cyber-${stored.generatedAt}"`;
  const ageSeconds = Math.max(
    0,
    Math.round((Date.now() - new Date(stored.generatedAt).getTime()) / 1000),
  );
  const isStale =
    stored.slot === "previous" ||
    ageSeconds > CYBER_PAYLOAD_STALE_AFTER_SECONDS;

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
      // Read-time state overrides build-time state when the data has aged out.
      state: isStale ? "stale" : stored.payload.state,
      ageSeconds,
      servedFromSlot: stored.slot,
    },
    { status: 200, headers },
  );
}
