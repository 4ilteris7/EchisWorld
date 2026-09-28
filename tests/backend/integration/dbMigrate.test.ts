// DB integration tests (F1B/F1C exit evidence).
//
// These run ONLY when a disposable test database is provided:
//   ECHIS_TEST_DATABASE_URL=postgres://echis_owner:…@127.0.0.1:5432/echis_test
//
// They are destructive to that database (schema reset) and must never be
// pointed at a database whose data matters. Without the env var the suite is
// reported as skipped, keeping `npm run test` green on machines without Docker.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, status } from "../../../scripts/db-migrate.mjs";

const TEST_URL = process.env.ECHIS_TEST_DATABASE_URL;
const hasDb = Boolean(TEST_URL);

// The runner reads ECHIS_DATABASE_URL_OWNER; point it at the test database.
if (hasDb) process.env.ECHIS_DATABASE_URL_OWNER = TEST_URL;

const silent = { log: () => {} };

describe.skipIf(!hasDb)("db:migrate against a real PostgreSQL (F1B/F1C)", () => {
  let pg: typeof import("pg");
  let client: InstanceType<typeof import("pg").Client>;

  beforeAll(async () => {
    pg = await import("pg");
    client = new pg.Client({ connectionString: TEST_URL });
    await client.connect();
    // Fresh start: empty schema, so "empty DB → migrate" is really tested.
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  });

  afterAll(async () => {
    await client?.end();
  });

  it("applies the full schema to an empty database", async () => {
    const result = await migrate(silent);
    expect(result.appliedNow).toContain("0001_init.sql");

    const { rows } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    const tables = rows.map((r: { table_name: string }) => r.table_name);
    for (const expected of [
      "schema_migrations",
      "source_runtime_state",
      "collected_items",
      "processed_events",
      "dedupe_tombstones",
      "collector_runs",
      "collector_source_results",
      "derived_payloads",
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it("is idempotent on the second run", async () => {
    const result = await migrate(silent);
    expect(result.appliedNow).toEqual([]);
    expect(result.alreadyApplied).toContain("0001_init.sql");
  });

  it("reports a clean status", async () => {
    const plan = await status(silent);
    expect(plan.errors).toEqual([]);
    expect(plan.pending).toEqual([]);
  });

  it("enforces the interval-order constraint on source_runtime_state", async () => {
    await expect(
      client.query(`
        INSERT INTO source_runtime_state
          (source_id, min_poll_interval_seconds, base_poll_interval_seconds,
           max_poll_interval_seconds, effective_poll_interval_seconds)
        VALUES ('bad-source', 600, 300, 900, 600)
      `),
    ).rejects.toThrow(/interval_order/);
  });

  it("enforces dedupe uniqueness on (source_id, fingerprint)", async () => {
    const insert = `
      INSERT INTO collected_items
        (source_id, fingerprint, title, collected_at, verification, basis,
         extraction, expires_at)
      VALUES ('src-a', 'fp-1', 'Title', now(), 'reported',
              'single_public_source', 'rss_summary', now() + interval '48 hours')
    `;
    await client.query(insert);
    await expect(client.query(insert)).rejects.toThrow(/duplicate key/);
  });

  it("blocks marker-eligible events without coordinates", async () => {
    const { rows } = await client.query(
      "SELECT id FROM collected_items WHERE fingerprint = 'fp-1'",
    );
    await expect(
      client.query(
        `INSERT INTO processed_events
           (item_id, accepted, marker_eligibility, analysis_version, expires_at)
         VALUES ($1, true, 'eligible', 1, now() + interval '48 hours')`,
        [rows[0].id],
      ),
    ).rejects.toThrow(/eligible_needs_coordinates/);
  });
});

if (!hasDb) {
  describe("db integration", () => {
    it.skip("skipped — set ECHIS_TEST_DATABASE_URL to a disposable test DB", () => {});
  });
}
