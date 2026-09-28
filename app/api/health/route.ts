import { getPool } from "@/lib/backend/db/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reports process readiness separately from source coverage or feed freshness.
export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    const pool = getPool("web");
    const { rows } = await pool.query<{ active: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM worker_heartbeats
          WHERE build_id = $1 AND shutdown_at IS NULL
            AND last_heartbeat_at > now() - interval '120 seconds'
       ) AS active`,
      [process.env.ECHIS_BUILD_ID ?? "dev"],
    );
    const feeds = await pool.query(
      `SELECT payload_type AS feed, state, generated_at AS "generatedAt",
              greatest(0, extract(epoch FROM now() - generated_at)::integer) AS "ageSeconds"
         FROM derived_payloads WHERE slot = 'current' ORDER BY payload_type`,
    );
    const workerReady = rows[0]?.active === true;
    return Response.json({
      status: workerReady ? "ready" : "degraded",
      storage: "ready", worker: workerReady ? "running" : "unavailable",
      feeds: feeds.rows.map(({ state, ...feed }) => ({ ...feed, generatedState: state })),
    }, { status: workerReady ? 200 : 503, headers });
  } catch {
    return Response.json({ status: "unavailable", storage: "unavailable" }, { status: 503, headers });
  }
}
