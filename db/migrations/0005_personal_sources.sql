-- Installation-local source registry. These rows belong to one EchisWorld
-- installation and are never merged into the built-in source manifest.

CREATE TABLE personal_sources (
  source_id             text PRIMARY KEY
    CHECK (source_id ~ '^personal-[0-9a-f-]{36}$'),
  name                  text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  connector_type        text NOT NULL CHECK (connector_type IN ('rss', 'json')),
  endpoint              text NOT NULL CHECK (endpoint ~ '^https://'),
  category              text NOT NULL CHECK (category IN ('global', 'cyber', 'defense', 'policy')),
  language              text NOT NULL DEFAULT 'en'
    CHECK (language IN ('tr', 'en', 'ar', 'fr', 'es', 'ru', 'de', 'sr', 'el', 'az', 'zh', 'vi')),
  region_scope          text NOT NULL DEFAULT 'global'
    CHECK (region_scope IN ('global', 'north_america', 'middle_east', 'europe', 'asia_pacific', 'americas', 'africa')),
  enabled               boolean NOT NULL DEFAULT true,
  last_validated_at     timestamptz NOT NULL DEFAULT now(),
  validation_item_count integer NOT NULL DEFAULT 0 CHECK (validation_item_count >= 0),
  last_validation_error text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE UNIQUE INDEX personal_sources_endpoint_active_uidx
  ON personal_sources (endpoint) WHERE deleted_at IS NULL;
CREATE INDEX personal_sources_enabled_idx
  ON personal_sources (enabled) WHERE deleted_at IS NULL;

-- The local web process owns registry mutations; it still cannot write
-- collected content, derived payloads or worker scheduling state.
GRANT SELECT, INSERT, UPDATE, DELETE ON personal_sources TO echis_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON personal_sources TO echis_worker;

