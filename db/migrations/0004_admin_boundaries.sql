-- 0004_admin_boundaries.sql — worldwide administrative outlines.
--
-- Backs the "click or search an administrative unit, draw its outline" feature.
-- Source: geoBoundaries gbOpen (CC-BY 4.0, commercial use permitted with
-- attribution), levels ADM1 (state / province / il) and ADM2 (district /
-- county / ilçe), for every country that publishes them.
--
-- Sizing, measured before writing this: the simplified per-country files
-- average ~0.6 MB at ADM1 and ~1.3 MB at ADM2, so the loaded table lands in
-- the low hundreds of MB against a 128 GB disk. Geometry is stored per row and
-- read one row at a time — the web process never holds the set in memory, and
-- a single lookup ships 1-6 KB to the browser.
--
-- No PostGIS. Point-in-unit resolution is done with a plain bounding-box
-- filter plus the clicked name, which is all this feature needs and keeps the
-- database image unchanged.

CREATE TABLE admin_boundaries (
  -- geoBoundaries shapeID, stable across releases.
  id           text PRIMARY KEY,
  -- 1 = state / province / il, 2 = district / county / ilçe.
  level        smallint NOT NULL CHECK (level IN (1, 2)),
  name         text NOT NULL,
  -- Lower-cased, diacritics folded, for accent-insensitive prefix search.
  name_norm    text NOT NULL,
  country_iso  char(3) NOT NULL,
  country_name text NOT NULL,
  -- Label anchor, used to pick between same-named units near a click.
  center_lng   double precision NOT NULL,
  center_lat   double precision NOT NULL,
  -- Bounding box, used as the cheap first-pass containment test.
  min_lng      double precision NOT NULL,
  min_lat      double precision NOT NULL,
  max_lng      double precision NOT NULL,
  max_lat      double precision NOT NULL,
  point_count  integer NOT NULL,
  -- GeoJSON Polygon or MultiPolygon, already simplified at build time.
  geometry     jsonb NOT NULL
);

-- Search box: accent-folded prefix matching ("sanli" → "Şanlıurfa").
-- text_pattern_ops makes LIKE 'x%' index-backed without needing pg_trgm, so
-- no extension has to be installed on the production image.
CREATE INDEX admin_boundaries_name_norm_idx
  ON admin_boundaries (name_norm text_pattern_ops);

-- Click resolution: narrow by longitude span first, then filter the rest.
CREATE INDEX admin_boundaries_bbox_idx
  ON admin_boundaries (min_lng, max_lng);

CREATE INDEX admin_boundaries_level_idx
  ON admin_boundaries (level);

-- The web role only ever reads. Loading is done by the owner via
-- scripts/load-admin-boundaries.mjs.
GRANT SELECT ON admin_boundaries TO echis_web;
