// Administrative outline endpoint.
//
// Three shapes, one route:
//   ?q=kadikoy                       → name search, summaries only (no geometry)
//   ?id=<shapeID>                    → one outline
//   ?name=Kadıköy&lng=29.03&lat=40.99 → resolve a clicked label to its outline
//
// A search response is a few hundred bytes; an outline is 0.5-72 KB, capped at
// build time. Nothing here loads the table into memory — every request is one
// indexed read.

import { getPool } from "@/lib/backend/db/pool";
import { rateLimit } from "@/lib/backend/http/rateLimit";
import {
  getAdminBoundary,
  resolveAdminBoundaryAt,
  searchAdminBoundaries,
  type AdminLevel,
} from "@/lib/backend/repositories/adminBoundaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Administrative borders effectively never move. A long browser cache means a
// second click on the same unit costs the server nothing at all.
const OUTLINE_CACHE = "public, max-age=86400, stale-while-revalidate=604800";
const SEARCH_CACHE = "public, max-age=300";

function badRequest(reason: string): Response {
  return Response.json({ error: reason }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const limited = rateLimit(request, { bucket: "geo-admin", limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const pool = getPool("web");

  try {
    const id = params.get("id");
    if (id) {
      const outline = await getAdminBoundary(pool, id);
      if (!outline) {
        return Response.json(
          { state: "not_found" },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        );
      }
      return Response.json(outline, { headers: { "Cache-Control": OUTLINE_CACHE } });
    }

    const name = params.get("name");
    if (name) {
      const lng = Number(params.get("lng"));
      const lat = Number(params.get("lat"));
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return badRequest("lng and lat are required with name");
      }
      const rawLevel = params.get("level");
      const level = rawLevel ? (Number(rawLevel) as AdminLevel) : undefined;
      if (level !== undefined && level !== 1 && level !== 2) return badRequest("level must be 1 or 2");

      const outline = await resolveAdminBoundaryAt(pool, { name, lng, lat, level });
      if (!outline) {
        // Not an error: plenty of place labels have no administrative area
        // behind them. The caller shows "no boundary data" rather than failing.
        return Response.json(
          { state: "no_boundary" },
          { status: 200, headers: { "Cache-Control": OUTLINE_CACHE } },
        );
      }
      return Response.json(outline, { headers: { "Cache-Control": OUTLINE_CACHE } });
    }

    const query = params.get("q");
    if (query) {
      const results = await searchAdminBoundaries(pool, query);
      return Response.json({ results }, { headers: { "Cache-Control": SEARCH_CACHE } });
    }

    return badRequest("one of q, id or name is required");
  } catch (error) {
    console.warn("[api/geo/admin] query failed:", error);
    return Response.json(
      { state: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
