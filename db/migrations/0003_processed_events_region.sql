-- 0003_processed_events_region.sql — density support (F6B).
-- Adds a resolved macro-region to processed_events so the news-volume density
-- API can aggregate by region + domain over 6/12/24/48h windows.

ALTER TABLE processed_events ADD COLUMN region text;

-- Density query index: region + time and domain + time are the two group-bys.
CREATE INDEX processed_events_region_published_idx
  ON processed_events (region, published_at DESC);
