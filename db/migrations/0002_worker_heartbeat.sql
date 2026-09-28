-- 0002_worker_heartbeat.sql — worker liveness record (F2A, roadmap §9.5/§15.1).
-- One row per logical worker. The worker upserts last_heartbeat_at on an
-- interval; health checks and alerting read staleness from this row.

CREATE TABLE worker_heartbeats (
  worker_id         text PRIMARY KEY,
  pid               integer,
  hostname          text,
  build_id          text,
  started_at        timestamptz NOT NULL,
  last_heartbeat_at timestamptz NOT NULL,
  shutdown_at       timestamptz,
  shutdown_reason   text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON worker_heartbeats TO echis_worker;
GRANT SELECT ON worker_heartbeats TO echis_web;
