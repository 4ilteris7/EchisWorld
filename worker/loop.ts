// Worker lifecycle (F2A): single-instance ownership, persistent heartbeat,
// graceful shutdown. The collector tick itself lands in F2B–F2D; this loop
// only guarantees the process contract the roadmap requires:
//   - separate long-lived process, never an interval inside the web server
//   - a second instance must refuse to run against the same database
//   - restart-safe: all durable state lives in PostgreSQL, none in memory
//   - stop must be clean: final heartbeat, released lock, closed pool

import type { PoolClient } from "pg";
import { getPool, closePools } from "@/lib/backend/db/pool";
import { log } from "@/lib/backend/observability/log";
import { runCollectorCycle } from "@/lib/backend/collector/collector";
import { pilotManifestEntries } from "@/lib/backend/collector/pilot";
import { ensureSourceStateRows } from "@/lib/backend/repositories/sourceStateRepo";
import { purgeExpired } from "@/lib/backend/repositories/itemsRepo";
import { maybeRebuildCyberPayload } from "@/lib/backend/payloads/cyberPayload";
import { maybeRebuildDefensePayload } from "@/lib/backend/payloads/defensePayload";
import { maybeRebuildPolicyPayload } from "@/lib/backend/payloads/policyPayload";
import { maybeRebuildGlobalPayload } from "@/lib/backend/payloads/globalPayload";

// Session-scoped advisory lock key for "the collector worker" ("ECHW").
const WORKER_LOCK_KEY = 0x45434857;

export type WorkerLoopOptions = {
  workerId?: string;
  heartbeatSeconds?: number;
  /** Idle tick cadence until the real collector lands (F2B+). */
  tickSeconds?: number;
  /** Stop by itself after this many seconds (bounded dev/proof runs). */
  runSeconds?: number;
  buildId?: string;
};

export class WorkerLoop {
  private readonly workerId: string;
  private readonly heartbeatMs: number;
  private readonly tickMs: number;
  private readonly runMs?: number;
  private readonly buildId: string;

  private lockClient: PoolClient | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private runTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private resolveDone: (() => void) | null = null;

  constructor(options: WorkerLoopOptions = {}) {
    this.workerId = options.workerId ?? "collector";
    this.heartbeatMs = (options.heartbeatSeconds ?? 30) * 1000;
    this.tickMs = (options.tickSeconds ?? 60) * 1000;
    this.runMs = options.runSeconds ? options.runSeconds * 1000 : undefined;
    this.buildId = options.buildId ?? process.env.ECHIS_BUILD_ID ?? "dev";
  }

  /**
   * Run until stop() is called (or runSeconds elapses).
   * Returns "lock_busy" without looping when another instance owns the lock.
   */
  async run(): Promise<"completed" | "lock_busy"> {
    const pool = getPool("worker");
    this.lockClient = await pool.connect();

    const { rows } = await this.lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [WORKER_LOCK_KEY],
    );
    if (!rows[0].locked) {
      log("error", "worker_lock_busy", {
        workerId: this.workerId,
        detail: "another worker instance holds the collector lock",
      });
      this.lockClient.release();
      this.lockClient = null;
      return "lock_busy";
    }

    await this.writeStartupHeartbeat();

    // Bootstrap runtime rows for the pilot scope; existing rows keep their
    // learned state (restart safety). Non-pilot sources have no rows and are
    // therefore never collected until the 7-day report unlocks them.
    const created = await ensureSourceStateRows(pool, pilotManifestEntries());
    log("info", "worker_started", {
      workerId: this.workerId,
      pid: process.pid,
      buildId: this.buildId,
      heartbeatSeconds: this.heartbeatMs / 1000,
      pilotStateRowsCreated: created,
    });

    this.heartbeatTimer = setInterval(() => {
      void this.beat();
    }, this.heartbeatMs);
    this.tickTimer = setInterval(() => {
      void this.tick();
    }, this.tickMs);
    // First cycle immediately — a restart must resume collecting without
    // waiting a full tick.
    void this.tick();
    if (this.runMs) {
      this.runTimer = setTimeout(() => {
        void this.stop("run_seconds_elapsed");
      }, this.runMs);
    }

    await new Promise<void>((resolve) => {
      this.resolveDone = resolve;
    });
    return "completed";
  }

  /** Idempotent graceful shutdown; safe to call from signal handlers. */
  async stop(reason: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    log("info", "worker_stopping", { workerId: this.workerId, reason });

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.runTimer) clearTimeout(this.runTimer);

    try {
      await getPool("worker").query(
        `UPDATE worker_heartbeats
           SET shutdown_at = now(), shutdown_reason = $2, last_heartbeat_at = now()
         WHERE worker_id = $1`,
        [this.workerId, reason.slice(0, 200)],
      );
    } catch {
      // Shutdown must not fail because the final heartbeat could not be
      // written (e.g. the database is the thing that went away).
      log("warn", "worker_final_heartbeat_failed", { workerId: this.workerId });
    }

    try {
      if (this.lockClient) {
        await this.lockClient.query("SELECT pg_advisory_unlock($1)", [
          WORKER_LOCK_KEY,
        ]);
        this.lockClient.release();
        this.lockClient = null;
      }
    } catch {
      log("warn", "worker_lock_release_failed", { workerId: this.workerId });
    }

    await closePools();
    log("info", "worker_stopped", { workerId: this.workerId, reason });
    this.resolveDone?.();
  }

  private async writeStartupHeartbeat(): Promise<void> {
    const { hostname } = await import("node:os");
    await getPool("worker").query(
      `INSERT INTO worker_heartbeats
         (worker_id, pid, hostname, build_id, started_at, last_heartbeat_at)
       VALUES ($1, $2, $3, $4, now(), now())
       ON CONFLICT (worker_id) DO UPDATE SET
         pid = EXCLUDED.pid,
         hostname = EXCLUDED.hostname,
         build_id = EXCLUDED.build_id,
         started_at = EXCLUDED.started_at,
         last_heartbeat_at = EXCLUDED.last_heartbeat_at,
         shutdown_at = NULL,
         shutdown_reason = NULL`,
      [this.workerId, process.pid, hostname(), this.buildId],
    );
  }

  private async beat(): Promise<void> {
    if (this.stopping) return;
    try {
      await getPool("worker").query(
        "UPDATE worker_heartbeats SET last_heartbeat_at = now() WHERE worker_id = $1",
        [this.workerId],
      );
    } catch {
      log("warn", "worker_heartbeat_failed", { workerId: this.workerId });
    }
  }

  private tickBusy = false;
  private lastRetentionAt = 0;

  private async tick(): Promise<void> {
    if (this.stopping || this.tickBusy) return;
    this.tickBusy = true;
    try {
      const cycle = await runCollectorCycle(getPool("worker"), {
        buildId: this.buildId,
      });
      await maybeRebuildCyberPayload(
        getPool("worker"),
        cycle.newItems > 0,
        this.buildId,
      );
      await maybeRebuildDefensePayload(
        getPool("worker"),
        cycle.newItems > 0,
        this.buildId,
      );
      await maybeRebuildPolicyPayload(
        getPool("worker"),
        cycle.newItems > 0,
        this.buildId,
      );
      await maybeRebuildGlobalPayload(
        getPool("worker"),
        cycle.newItems > 0,
        this.buildId,
      );

      // Rolling-window cleanup roughly once an hour (§7).
      if (Date.now() - this.lastRetentionAt > 60 * 60 * 1000) {
        this.lastRetentionAt = Date.now();
        const retention = await purgeExpired(getPool("worker"));
        if (retention.expiredItems > 0 || retention.tombstonesPurged > 0) {
          log("info", "retention_cycle", {
            workerId: this.workerId,
            expiredItems: retention.expiredItems,
            tombstonesWritten: retention.tombstonesWritten,
            tombstonesPurged: retention.tombstonesPurged,
          });
        }
      }
    } catch (err) {
      log("error", "collector_cycle_failed", {
        workerId: this.workerId,
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.tickBusy = false;
    }
  }
}
