-- (Postgres copy of migrations/0004_meta_more.sql) More Meta Ads metrics per ad/day (creative ranking, CTR, hook, pixel purchases) and the ads
-- themselves (thumbnail + shareable preview link).
ALTER TABLE meta_insights ADD COLUMN link_clicks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meta_insights ADD COLUMN landing_page_views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meta_insights ADD COLUMN video_3s INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meta_insights ADD COLUMN purchases INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meta_insights ADD COLUMN purchase_value REAL NOT NULL DEFAULT 0;

CREATE TABLE meta_ads (
  ad_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT,
  adset_id TEXT,
  campaign_id TEXT,
  status TEXT,
  thumbnail_url TEXT,
  preview_url TEXT
);

-- Re-read the 90-day window so the new columns get filled.
DELETE FROM sync_state WHERE key = 'meta_last_sync';
ALTER TABLE public.meta_ads ENABLE ROW LEVEL SECURITY;
