// Read-only news-volume density endpoint (F6B).
//
// GET /api/analytics/density?window=6|12|24|48
//
// Returns how many accepted open-source news events fall in the last N hours,
// grouped by region and by domain. The `metric` block makes the semantics
// explicit: this is NEWS VOLUME inferred from open-source items — a coverage
// signal, not a count of verified incidents (roadmap §6.6 / §9.1).

import { getPool } from "@/lib/backend/db/pool";
import { rateLimit } from "@/lib/backend/http/rateLimit";
import {
  densityForWindow,
  DENSITY_WINDOWS,
  type DensityWindow,
} from "@/lib/backend/repositories/processedEventsRepo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_WINDOW: DensityWindow = 24;

const METRIC = {
  id: "news_volume",
  label: "News volume",
  unit: "items",
  note:
    "Number of accepted open-source news items in the window, inferred from " +
    "public RSS/API text. A coverage/attention signal — not a count of " +
    "verified incidents.",
  provenance: "derived_from_open_source_news",
} as const;

function parseWindow(raw: string | null): DensityWindow | null {
  if (raw === null) return DEFAULT_WINDOW;
  const value = Number(raw);
  return (DENSITY_WINDOWS as readonly number[]).includes(value)
    ? (value as DensityWindow)
    : null;
}

export async function GET(request: Request): Promise<Response> {
  const limited = rateLimit(request, {
    bucket: "analytics-density",
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const window = parseWindow(searchParams.get("window"));
  if (window === null) {
    return Response.json(
      {
        error: "invalid_window",
        allowedWindows: DENSITY_WINDOWS,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  let density;
  try {
    density = await densityForWindow(getPool("web"), window);
  } catch {
    return Response.json(
      { error: "storage_unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { metric: METRIC, ...density },
    { status: 200, headers: { "Cache-Control": "public, max-age=60" } },
  );
}
