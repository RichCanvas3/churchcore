-- Topic templates for the "New topic" chooser + thread metadata.
-- NOTE: SQLite/D1 does not support `ADD COLUMN IF NOT EXISTS`.
-- If re-running after applied, comment out the ALTER TABLE line.

ALTER TABLE chat_threads ADD COLUMN metadata_json TEXT;

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

