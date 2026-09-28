// F4B exit evidence: policy payload contract + API behavior + the
// state-affiliation transparency flag, against the disposable test database.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  composePolicyPayload,
  maybeRebuildPolicyPayload,
} from "@/lib/backend/payloads/policyPayload";
import { STATE_AFFILIATED_SOURCE_IDS } from "@/lib/policy/stateAffiliation";
import { GET } from "@/app/api/feeds/policy/route";

const TEST_URL = process.env.ECHIS_TEST_DATABASE_URL;
const hasDb = Boolean(TEST_URL);
if (hasDb) {
  process.env.ECHIS_DATABASE_URL_OWNER = TEST_URL;
  process.env.ECHIS_DATABASE_URL_WEB = TEST_URL;
  process.env.ECHIS_DATABASE_URL_WORKER = TEST_URL;
}

const REQ = () => new Request("http://localhost/api/feeds/policy");

// One documented state-affiliated outlet + one that is not.
const AFFILIATED_SOURCE = "tass-world";
const INDEPENDENT_SOURCE = "bbc-world";

describe.skipIf(!hasDb)("policy derived payload (F4B)", () => {
  let pg: typeof import("pg");
  let pool: Pool;

  beforeAll(async () => {
    pg = await import("pg");
    pool = new pg.Pool({ connectionString: TEST_URL, max: 3 });
    const { migrate } = await import("../../../scripts/db-migrate.mjs");
    await migrate({ log: () => {} });
    await pool.query(
      "TRUNCATE collected_items, derived_payloads RESTART IDENTITY CASCADE",
    );
    await pool.query("DELETE FROM source_runtime_state");

    const { ensureSourceStateRows } = await import(
      "@/lib/backend/repositories/sourceStateRepo"
    );
    const { pilotManifestEntries } = await import(
      "@/lib/backend/collector/pilot"
    );
    await ensureSourceStateRows(pool, pilotManifestEntries());
    await pool.query("UPDATE source_runtime_state SET last_success_at = now()");

    // Policy-relevant synthetic items (diplomacy/sanctions phrasing so the
    // relevance gate accepts them).
    const titles = [
      "Foreign ministers meet for ceasefire negotiations at summit",
      "Security council weighs new sanctions package against regime",
      "President signs defense cooperation agreement with ally",
      "Parliament debates energy policy amid supply crisis",
      "Diplomatic delegation visits capital for peace talks",
    ];
    let n = 0;
    for (const sourceId of [AFFILIATED_SOURCE, INDEPENDENT_SOURCE]) {
      for (const [i, title] of titles.entries()) {
        n += 1;
        await pool.query(
          `INSERT INTO collected_items
             (source_id, upstream_item_id, url, canonical_url, fingerprint, title,
              summary, published_at, collected_at, verification, basis, extraction,
              expires_at)
           VALUES ($1, $2, $3, $3, $4, $5, $6,
                   now() - make_interval(mins => $7), now(), 'reported',
                   'single_public_source', 'rss_summary', now() + interval '47 hours')`,
          [
            sourceId,
            `pguid-${n}`,
            `https://x.example/${sourceId}/${i}`,
            `pfp-${sourceId}-${i}`,
            `${title} (${sourceId})`,
            `Synthetic policy summary ${n} about diplomacy and sanctions talks.`,
            n * 9,
          ],
        );
      }
    }
  });

  afterAll(async () => {
    await pool?.end();
    const { closePools } = await import("@/lib/backend/db/pool");
    await closePools();
  });

  it("composes the payload with the finished screen analysis", async () => {
    const payload = await composePolicyPayload(pool);
    expect(payload.analysis.totalItems).toBe(10);
    expect(payload.analysis.relevantItems).toBeGreaterThan(0);
    expect(payload.analysis.topics.length).toBeGreaterThan(0);
    expect(payload.analysis.provenance).toBe("derived_from_rss_text");
    // All 17 policy sources enabled since F4B → coverage complete.
    expect(payload.coverage.manifestSources).toBe(17);
    expect(payload.coverage.enabledSources).toBe(17);
    expect(payload.state).toBe("fresh");
    expect(JSON.stringify(payload).length).toBeLessThan(1024 * 1024);
  });

  it("stamps stateAffiliated ONLY on documented state-linked outlets", async () => {
    expect(STATE_AFFILIATED_SOURCE_IDS.has(AFFILIATED_SOURCE)).toBe(true);
    expect(STATE_AFFILIATED_SOURCE_IDS.has(INDEPENDENT_SOURCE)).toBe(false);

    const payload = await composePolicyPayload(pool);
    const affiliated = payload.analysis.items.filter((i) =>
      i.id.startsWith(`${AFFILIATED_SOURCE}::`),
    );
    const independent = payload.analysis.items.filter((i) =>
      i.id.startsWith(`${INDEPENDENT_SOURCE}::`),
    );
    expect(affiliated.length).toBeGreaterThan(0);
    expect(independent.length).toBeGreaterThan(0);
    expect(affiliated.every((i) => i.stateAffiliated === true)).toBe(true);
    expect(independent.every((i) => i.stateAffiliated !== true)).toBe(true);
  });

  it("worker hook stores and the API serves with ETag → 304", async () => {
    const built = await maybeRebuildPolicyPayload(pool, true, "p1");
    expect(built).toBe(true);

    const res = await GET(REQ());
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"policy-/);
    const body = await res.json();
    expect(body.state).toBe("fresh");
    expect(
      body.analysis.items.some(
        (i: { stateAffiliated?: boolean }) => i.stateAffiliated === true,
      ),
    ).toBe(true);

    const res304 = await GET(
      new Request("http://localhost/api/feeds/policy", {
        headers: { "If-None-Match": etag! },
      }),
    );
    expect(res304.status).toBe(304);
  });

  it("aged payload serves as stale; missing payload returns 503", async () => {
    await pool.query(
      `UPDATE derived_payloads SET generated_at = now() - interval '2 hours'
        WHERE payload_type = 'policy' AND slot = 'current'`,
    );
    const stale = await GET(REQ());
    expect((await stale.json()).state).toBe("stale");

    await pool.query("DELETE FROM derived_payloads WHERE payload_type = 'policy'");
    const gone = await GET(REQ());
    expect(gone.status).toBe(503);
  });
});
