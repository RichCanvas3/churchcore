-- Topic templates for the "New topic" chooser + thread metadata.
-- NOTE: SQLite/D1 does not support `ADD COLUMN IF NOT EXISTS`.
-- Some environments already have `chat_threads.metadata_json`, so we avoid ALTER TABLE
-- here and only ensure the table exists for fresh databases.

CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  metadata_json TEXT, -- template_id, tool_ids, etc.
  status TEXT NOT NULL DEFAULT 'active', -- active|archived
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_threads ON chat_threads(church_id, user_id, status, updated_at);

CREATE TABLE IF NOT EXISTS topic_templates (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  tool_ids_json TEXT NOT NULL, -- JSON array of tool ids for quick actions
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (church_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_topic_templates ON topic_templates(church_id, is_active, sort_order, updated_at);

