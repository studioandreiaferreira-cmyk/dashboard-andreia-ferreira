-- Postgres mirror of the D1 schema (migrations/0001-0003). Same column names and TEXT timestamps,
-- so the sync code (src/sync) runs unchanged on both. RLS on, no policies: only the service role reads it.


CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE origins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_id TEXT REFERENCES groups(id),
  archived_at TEXT
);

CREATE TABLE stages (
  id TEXT PRIMARY KEY,
  origin_id TEXT NOT NULL REFERENCES origins(id),
  label TEXT NOT NULL,
  "order" INTEGER,
  type TEXT
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE channel_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  status TEXT
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  email TEXT,
  fields_json TEXT,
  updated_at TEXT
);

CREATE TABLE deals (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  stage_id TEXT,
  user_id TEXT,
  contact_id TEXT,
  status TEXT NOT NULL,
  value REAL,
  created_at TEXT NOT NULL,
  created_day_sp TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_stage_at TEXT,
  won_at TEXT,
  lost_at TEXT,
  campaign_name TEXT,
  campaign_id TEXT,
  ad_name TEXT,
  ad_id TEXT,
  form_name TEXT,
  form_id TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  fields_json TEXT,
  last_seen_at TEXT,             -- set on every upsert; nightly reconcile flags rows not seen as deleted
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX deals_origin_day ON deals(origin_id, created_day_sp);
CREATE INDEX deals_status_origin ON deals(status, origin_id);
CREATE INDEX deals_campaign ON deals(campaign_name);
CREATE INDEX deals_contact_status ON deals(contact_id, status);
CREATE INDEX deals_user ON deals(user_id);

CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  contact_id TEXT,
  channel_account_id TEXT,
  user_id TEXT,
  status TEXT,
  last_message_at TEXT,
  last_response_at TEXT,
  messages_synced_until TEXT
);
CREATE INDEX chats_contact ON chats(contact_id);

-- Message metadata only (no content): rolling MESSAGE_WINDOW_DAYS window.
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  type TEXT NOT NULL,            -- USER (seller) / CUSTOMER (lead) / EVENT (ignored in metrics)
  content_type TEXT,             -- TEXT / IMAGE / AUDIO / VIDEO / DOCUMENT / REACTION / ... (REACTION ignored in metrics)
  sender_user_id TEXT,
  attributed_user_id TEXT,
  attribution TEXT NOT NULL,     -- direct / chat / deal / none
  created_at TEXT NOT NULL,
  created_day_sp TEXT NOT NULL
);
CREATE INDEX messages_user_day ON messages(attributed_user_id, created_day_sp);
CREATE INDEX messages_chat_created ON messages(chat_id, created_at);

CREATE TABLE chat_reply_state (
  chat_id TEXT PRIMARY KEY,
  awaiting_since TEXT,
  has_open_deal INTEGER NOT NULL DEFAULT 0,
  responsible_user_id TEXT
);

CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE login_attempts (
  ip TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);
CREATE INDEX login_attempts_ip ON login_attempts(ip, attempted_at);
-- Loss reasons (Clint "lost status") and the reason of each lost deal.
CREATE TABLE lost_statuses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
ALTER TABLE deals ADD COLUMN lost_status_id TEXT;
CREATE INDEX deals_status_created ON deals(status, created_day_sp);
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

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Public bucket for the dashboard snapshot; the object name is the secret part of the link.
INSERT INTO storage.buckets (id, name, public) VALUES ('dash', 'dash', true) ON CONFLICT (id) DO NOTHING;
