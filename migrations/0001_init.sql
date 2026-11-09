-- Local mirror of Clint CRM data (specs/001-crm-dashboard/data-model.md).
-- Timestamps are UTC ISO-8601 text; *_day_sp columns are YYYY-MM-DD in America/Sao_Paulo.

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
