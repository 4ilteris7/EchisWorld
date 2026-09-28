-- 0001_init.sql — first schema per roadmap §6 (canonical data model).
-- Applied migrations are immutable: never edit this file, add a new one.
-- All timestamps are timestamptz (UTC). No raw feed bodies, no full articles.

-- ── source_runtime_state (§6.1) ─────────────────────────────────────────────

CREATE TABLE source_runtime_state (
  source_id                         text PRIMARY KEY,
  enabled                           boolean NOT NULL DEFAULT true,
  schedule_mode                     text NOT NULL DEFAULT 'adaptive'
    CHECK (schedule_mode IN ('adaptive', 'fixed', 'quota_limited')),
  min_poll_interval_seconds         integer NOT NULL CHECK (min_poll_interval_seconds > 0),
  base_poll_interval_seconds        integer NOT NULL CHECK (base_poll_interval_seconds > 0),
  max_poll_interval_seconds         integer NOT NULL CHECK (max_poll_interval_seconds > 0),
  effective_poll_interval_seconds   integer NOT NULL CHECK (effective_poll_interval_seconds > 0),
  schedule_reason                   text NOT NULL DEFAULT 'bootstrap'
    CHECK (schedule_reason IN
      ('bootstrap', 'observed_cadence', 'rss_hint', 'quota', 'backoff', 'manual_override')),
  next_poll_at                      timestamptz NOT NULL DEFAULT now(),
  last_attempt_at                   timestamptz,
  last_success_at                   timestamptz,
  last_content_change_at            timestamptz,
  unchanged_streak                  integer NOT NULL DEFAULT 0 CHECK (unchanged_streak >= 0),
  observed_publish_interval_seconds integer CHECK (observed_publish_interval_seconds > 0),
  rss_ttl_hint_seconds              integer CHECK (rss_ttl_hint_seconds > 0),
  cache_control_max_age_seconds     integer CHECK (cache_control_max_age_seconds >= 0),
  etag                              text,
  last_modified                     text,
  daily_request_budget              integer CHECK (daily_request_budget > 0),
  requests_in_current_budget_window integer NOT NULL DEFAULT 0
    CHECK (requests_in_current_budget_window >= 0),
  budget_window_started_at          timestamptz,
  consecutive_failures              integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  backoff_until                     timestamptz,
  last_http_status                  integer,
  last_error_code                   text,
  last_duration_ms                  integer CHECK (last_duration_ms >= 0),
  last_new_item_count               integer CHECK (last_new_item_count >= 0),
  updated_at                        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interval_order CHECK (
    min_poll_interval_seconds <= base_poll_interval_seconds
    AND base_poll_interval_seconds <= max_poll_interval_seconds
  ),
  CONSTRAINT effective_within_bounds CHECK (
    min_poll_interval_seconds <= effective_poll_interval_seconds
    AND effective_poll_interval_seconds <= max_poll_interval_seconds
  )
);

CREATE INDEX source_runtime_state_due_idx
  ON source_runtime_state (enabled, next_poll_at);

-- ── collected_items (§6.2) ──────────────────────────────────────────────────

CREATE TABLE collected_items (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id        text NOT NULL,
  upstream_item_id text,
  url              text,
  canonical_url    text,
  fingerprint      text NOT NULL,
  title            text NOT NULL,
  summary          text,
  language         text,
  published_at     timestamptz,
  collected_at     timestamptz NOT NULL,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  verification     text NOT NULL,
  basis            text NOT NULL,
  extraction       text NOT NULL,
  processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processed', 'rejected')),
  analysis_version integer,
  expires_at       timestamptz NOT NULL,
  metadata         jsonb
);

-- Dedupe tiers (§6.8): upstream id → canonical URL → fingerprint.
CREATE UNIQUE INDEX collected_items_source_upstream_uidx
  ON collected_items (source_id, upstream_item_id)
  WHERE upstream_item_id IS NOT NULL;
CREATE UNIQUE INDEX collected_items_source_canonical_url_uidx
  ON collected_items (source_id, canonical_url)
  WHERE canonical_url IS NOT NULL;
CREATE UNIQUE INDEX collected_items_source_fingerprint_uidx
  ON collected_items (source_id, fingerprint);

CREATE INDEX collected_items_published_idx
  ON collected_items (published_at DESC);
CREATE INDEX collected_items_source_published_idx
  ON collected_items (source_id, published_at DESC);
CREATE INDEX collected_items_expires_idx
  ON collected_items (expires_at);
CREATE INDEX collected_items_pending_idx
  ON collected_items (id)
  WHERE processing_status = 'pending';

-- ── processed_events (§6.3) ─────────────────────────────────────────────────

CREATE TABLE processed_events (
  item_id            bigint PRIMARY KEY
    REFERENCES collected_items (id) ON DELETE CASCADE,
  accepted           boolean NOT NULL,
  primary_domain     text,
  tags               text[] NOT NULL DEFAULT '{}',
  event_type         text,
  event_subtype      text,
  relevance_score    integer,
  priority_score     integer,
  verification       text,
  basis              text,
  published_at       timestamptz,
  marker_eligibility text NOT NULL DEFAULT 'feed_only'
    CHECK (marker_eligibility IN ('eligible', 'needs_location', 'feed_only', 'rejected')),
  latitude           double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude          double precision CHECK (longitude BETWEEN -180 AND 180),
  location_label     text,
  geo_confidence     text,
  geo_evidence       jsonb,
  analysis_version   integer NOT NULL,
  processed_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  details            jsonb,
  -- Marker-eligible events must carry resolved coordinates (§6.8).
  CONSTRAINT eligible_needs_coordinates CHECK (
    marker_eligibility <> 'eligible'
    OR (latitude IS NOT NULL AND longitude IS NOT NULL)
  )
);

CREATE INDEX processed_events_domain_published_idx
  ON processed_events (primary_domain, published_at DESC);
CREATE INDEX processed_events_marker_published_idx
  ON processed_events (marker_eligibility, published_at DESC);
CREATE INDEX processed_events_expires_idx
  ON processed_events (expires_at);

-- ── dedupe_tombstones (§6.8, §7) ────────────────────────────────────────────
-- Only hash/identity + expiry: never title, summary, URL or content.

CREATE TABLE dedupe_tombstones (
  source_id        text NOT NULL,
  fingerprint      text NOT NULL,
  upstream_item_id text,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, fingerprint)
);

CREATE INDEX dedupe_tombstones_expires_idx
  ON dedupe_tombstones (expires_at);

-- ── collector_runs (§6.4) ───────────────────────────────────────────────────

CREATE TABLE collector_runs (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  status            text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed')),
  attempted_sources integer NOT NULL DEFAULT 0 CHECK (attempted_sources >= 0),
  succeeded_sources integer NOT NULL DEFAULT 0 CHECK (succeeded_sources >= 0),
  new_items         integer NOT NULL DEFAULT 0 CHECK (new_items >= 0),
  duplicate_items   integer NOT NULL DEFAULT 0 CHECK (duplicate_items >= 0),
  rejected_items    integer NOT NULL DEFAULT 0 CHECK (rejected_items >= 0),
  total_duration_ms integer CHECK (total_duration_ms >= 0),
  build_id          text,
  -- completed_at is set exactly when the run has finished (§6.8).
  CONSTRAINT completed_iff_finished CHECK (
    (status = 'running') = (completed_at IS NULL)
  )
);

-- ── collector_source_results (§6.5) ─────────────────────────────────────────
-- Short technical record only; response bodies and secrets are never stored.

CREATE TABLE collector_source_results (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id          bigint NOT NULL REFERENCES collector_runs (id) ON DELETE CASCADE,
  source_id       text NOT NULL,
  http_status     integer,
  duration_ms     integer CHECK (duration_ms >= 0),
  parsed_items    integer NOT NULL DEFAULT 0 CHECK (parsed_items >= 0),
  new_items       integer NOT NULL DEFAULT 0 CHECK (new_items >= 0),
  duplicate_items integer NOT NULL DEFAULT 0 CHECK (duplicate_items >= 0),
  not_modified    boolean NOT NULL DEFAULT false,
  error_code      text,
  retry_count     integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX collector_source_results_source_idx
  ON collector_source_results (source_id, created_at DESC);

-- ── derived_payloads (§6.6, §6.8) ───────────────────────────────────────────

CREATE TABLE derived_payloads (
  payload_type   text NOT NULL
    CHECK (payload_type IN ('global', 'cyber', 'defense', 'policy', 'sources', 'globe')),
  slot           text NOT NULL CHECK (slot IN ('current', 'previous')),
  schema_version integer NOT NULL,
  state          text NOT NULL
    CHECK (state IN ('fresh', 'partial', 'stale', 'unavailable')),
  generated_at   timestamptz NOT NULL,
  expires_at     timestamptz,
  payload        jsonb NOT NULL,
  build_id       text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payload_type, slot)
);

-- ── Role grants (§10.2) ─────────────────────────────────────────────────────
-- Roles are created with LOGIN+password by infra/initdb (never in git).
-- Guard here so migrations also apply on databases prepared differently.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'echis_worker') THEN
    CREATE ROLE echis_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'echis_web') THEN
    CREATE ROLE echis_web NOLOGIN;
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  source_runtime_state,
  collected_items,
  processed_events,
  dedupe_tombstones,
  collector_runs,
  collector_source_results,
  derived_payloads
TO echis_worker;

-- Web is read-only and sees only what the public API needs; it never reads
-- per-source technical failure details (§9.1 transparency contract).
GRANT SELECT ON
  collected_items,
  processed_events,
  derived_payloads,
  source_runtime_state,
  collector_runs
TO echis_web;
