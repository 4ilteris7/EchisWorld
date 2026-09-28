// Read-only Defense Industry feed endpoint (F4A). Same contract as
// /api/feeds/cyber: worker-built payload only, stale served openly,
// explicit unavailable, never an upstream fetch.

import { getPool } from "@/lib/backend/db/pool";
import { rateLimit } from "@/lib/backend/http/rateLimit";
import {
  readDefensePayload,
  DEFENSE_PAYLOAD_STALE_AFTER_SECONDS,
} from "@/lib/backend/payloads/defensePayload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADER = "public, max-age=60";

export async function GET(request: Request): Promise<Response> {
  const limited = rateLimit(request, {
    bucket: "feeds-defense",
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  let stored;
  try {
    stored = await readDefensePayload(getPool("web"));
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

  const etag = `"defense-${stored.generatedAt}"`;
  const ageSeconds = Math.max(
    0,
    Math.round((Date.now() - new Date(stored.generatedAt).getTime()) / 1000),
  );
  const isStale =
    stored.slot === "previous" ||
    ageSeconds > DEFENSE_PAYLOAD_STALE_AFTER_SECONDS;

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
      state: isStale ? "stale" : stored.payload.state,
      ageSeconds,
      servedFromSlot: stored.slot,
    },
    { status: 200, headers },
  );
}
