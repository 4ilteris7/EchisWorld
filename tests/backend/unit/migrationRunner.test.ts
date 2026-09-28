import { describe, expect, it } from "vitest";
import {
  checksumOf,
  loadMigrationFiles,
  planMigrations,
} from "../../../scripts/db-migrate.mjs";

type MigrationFile = { version: string; sql: string; checksum: string };
type AppliedRow = { version: string; checksum: string };

function file(version: string, sql: string): MigrationFile {
  return { version, sql, checksum: checksumOf(sql) };
}

describe("migration planning contract (F1B)", () => {
  const m1 = file("0001_init.sql", "CREATE TABLE a (id int);");
  const m2 = file("0002_next.sql", "CREATE TABLE b (id int);");

  it("applies everything on an empty database", () => {
    const plan = planMigrations([m1, m2], []);
    expect(plan.errors).toEqual([]);
    expect(plan.pending.map((f: MigrationFile) => f.version)).toEqual([
      "0001_init.sql",
      "0002_next.sql",
    ]);
  });

  it("is idempotent: second run has nothing pending", () => {
    const appliedRows: AppliedRow[] = [
      { version: m1.version, checksum: m1.checksum },
      { version: m2.version, checksum: m2.checksum },
    ];
    const plan = planMigrations([m1, m2], appliedRows);
    expect(plan.errors).toEqual([]);
    expect(plan.pending).toEqual([]);
    expect(plan.applied).toEqual(["0001_init.sql", "0002_next.sql"]);
  });

  it("rejects a modified applied migration (checksum mismatch)", () => {
    const tampered = file("0001_init.sql", "CREATE TABLE a (id bigint);");
    const plan = planMigrations(
      [tampered, m2],
      [{ version: m1.version, checksum: m1.checksum }],
    );
    expect(plan.errors.some((e: string) => e.includes("was modified"))).toBe(true);
  });

  it("rejects an applied migration that disappeared from disk", () => {
    const plan = planMigrations(
      [m2],
      [{ version: m1.version, checksum: m1.checksum }],
    );
    expect(plan.errors.some((e: string) => e.includes("missing on disk"))).toBe(
      true,
    );
  });

  it("only picks up correctly numbered .sql files from db/migrations", () => {
    const files = loadMigrationFiles() as MigrationFile[];
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files[0].version).toBe("0001_init.sql");
    for (const f of files) {
      expect(f.version).toMatch(/^\d{4}_[\w-]+\.sql$/);
      expect(f.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
    // Sorted by version prefix — apply order is deterministic.
    const versions = files.map((f) => f.version);
    expect(versions).toEqual([...versions].sort());
  });
});

describe("0001_init.sql schema contract (static)", () => {
  const initSql = (loadMigrationFiles() as MigrationFile[])[0].sql;

  it("creates every table of the canonical data model (§6)", () => {
    for (const table of [
      "source_runtime_state",
      "collected_items",
      "processed_events",
      "dedupe_tombstones",
      "collector_runs",
      "collector_source_results",
      "derived_payloads",
    ]) {
      expect(initSql).toMatch(new RegExp(`CREATE TABLE ${table}`));
    }
  });

  it("keeps the tombstone table content-free (no title/summary/url columns)", () => {
    const tombstone = initSql.slice(
      initSql.indexOf("CREATE TABLE dedupe_tombstones"),
      initSql.indexOf("CREATE INDEX dedupe_tombstones_expires_idx"),
    );
    for (const forbidden of ["title", "summary", "url "]) {
      expect(tombstone).not.toContain(forbidden);
    }
  });

  it("declares the three dedupe uniqueness tiers", () => {
    expect(initSql).toContain("collected_items_source_upstream_uidx");
    expect(initSql).toContain("collected_items_source_canonical_url_uidx");
    expect(initSql).toContain("collected_items_source_fingerprint_uidx");
  });

  it("grants the web role SELECT only (no write verbs)", () => {
    const webGrant = initSql.slice(initSql.lastIndexOf("GRANT SELECT ON"));
    expect(webGrant).toContain("TO echis_web");
    expect(webGrant).not.toMatch(/INSERT|UPDATE|DELETE/);
  });
});
