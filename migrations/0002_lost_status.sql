-- Loss reasons (Clint "lost status") and the reason of each lost deal.
CREATE TABLE lost_statuses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
ALTER TABLE deals ADD COLUMN lost_status_id TEXT;
CREATE INDEX deals_status_created ON deals(status, created_day_sp);
-- Re-pull every deal once so existing rows get their lost_status_id.
DELETE FROM sync_state WHERE key = 'deals_cursor';
