-- Meta Ads daily insights per ad (Marketing API, ads_read). Dates are the ad account day (America/Sao_Paulo).
CREATE TABLE meta_insights (
  ad_id TEXT NOT NULL,
  date TEXT NOT NULL,
  account_id TEXT NOT NULL,
  campaign_id TEXT,
  campaign_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  ad_name TEXT,
  spend REAL NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ad_id, date)
);
CREATE INDEX meta_insights_campaign_date ON meta_insights(campaign_id, date);
CREATE INDEX meta_insights_date ON meta_insights(date);
