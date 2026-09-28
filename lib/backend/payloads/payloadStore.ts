// Shared derived-payload storage (§6.6): atomic current/previous swap and
// slot-aware read for every screen payload type. SQL for derived_payloads
// lives only here.

import type { Pool, PoolClient } from "pg";

export type DerivedPayloadType =
  | "global"
  | "cyber"
  | "defense"
  | "policy"
  | "sources"
  | "globe";

export type StorablePayload = {
  schemaVersion: number;
  generatedAt: string;
  state: "fresh" | "partial";
};

/** Atomic swap: previous is dropped, current becomes previous, new is current. */
export async function storeDerivedPayload(
  pool: Pool,
  payloadType: DerivedPayloadType,
  payload: StorablePayload,
  buildId = "dev",
): Promise<void> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM derived_payloads WHERE payload_type = $1 AND slot = 'previous'",
      [payloadType],
    );
    await client.query(
      `UPDATE derived_payloads SET slot = 'previous', updated_at = now()
        WHERE payload_type = $1 AND slot = 'current'`,
      [payloadType],
    );
    await client.query(
      `INSERT INTO derived_payloads
         (payload_type, slot, schema_version, state, generated_at, payload, build_id)
       VALUES ($1, 'current', $2, $3, $4, $5, $6)`,
      [
        payloadType,
        payload.schemaVersion,
        payload.state,
        payload.generatedAt,
        JSON.stringify(payload),
        buildId,
      ],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client?.query("ROLLBACK");
    throw err;
  } finally {
    client?.release();
  }
}

export type StoredDerivedPayload<T> = {
  payload: T;
  slot: "current" | "previous";
  generatedAt: string;
};

/** Read for the API: current first, previous as stale fallback. */
export async function readDerivedPayload<T>(
  pool: Pool,
  payloadType: DerivedPayloadType,
): Promise<StoredDerivedPayload<T> | null> {
  const { rows } = await pool.query(
    `SELECT slot, generated_at, payload FROM derived_payloads
      WHERE payload_type = $1 AND slot IN ('current', 'previous')
      ORDER BY CASE slot WHEN 'current' THEN 0 ELSE 1 END
      LIMIT 1`,
    [payloadType],
  );
  if (rows.length === 0) return null;
  return {
    payload: rows[0].payload as T,
    slot: rows[0].slot,
    generatedAt: rows[0].generated_at.toISOString(),
  };
}

/** True when the current slot exists and is younger than maxAgeSeconds. */
export async function hasFreshCurrentPayload(
  pool: Pool,
  payloadType: DerivedPayloadType,
  maxAgeSeconds: number,
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT generated_at > now() - make_interval(secs => $2) AS young
       FROM derived_payloads WHERE payload_type = $1 AND slot = 'current'`,
    [payloadType, maxAgeSeconds],
  );
  return rows.length > 0 && rows[0].young === true;
}
