-- Campus messages (sermons) + weekly guides (discussion PDFs).

CREATE TABLE IF NOT EXISTS weekly_guides (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  series_slug TEXT NOT NULL, -- e.g. john
  week_number INTEGER,
  passage TEXT,
  passage_key TEXT,
  discussion_url TEXT,
  leader_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (church_id, series_slug, week_number)
);
CREATE INDEX IF NOT EXISTS idx_weekly_guides ON weekly_guides(church_id, series_slug, week_number);
CREATE INDEX IF NOT EXISTS idx_weekly_guides_passage ON weekly_guides(church_id, passage_key);

CREATE TABLE IF NOT EXISTS campus_messages (
  id TEXT PRIMARY KEY, -- e.g. msg_2479
  church_id TEXT NOT NULL,
  campus_id TEXT,
  title TEXT NOT NULL,
  speaker TEXT,
  preached_at TEXT, -- ISO date/time
  passage TEXT,
  passage_key TEXT,
  series_title TEXT,
  series_id TEXT, -- enmse_sid
  campus_feed_id TEXT, -- enmse_tid
  source_url TEXT NOT NULL,
  watch_url TEXT,
  listen_url TEXT,
  download_url TEXT,
  guide_series_slug TEXT,
  guide_week_number INTEGER,
  guide_discussion_url TEXT,
  guide_leader_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campus_messages ON campus_messages(church_id, campus_id, preached_at);
CREATE INDEX IF NOT EXISTS idx_campus_messages_series ON campus_messages(church_id, series_title, preached_at);

CREATE TABLE IF NOT EXISTS campus_message_analysis (
  message_id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  summary_markdown TEXT,
  topics_json TEXT,
  verses_json TEXT,
  key_points_json TEXT,
  model TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES campus_messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_campus_message_analysis ON campus_message_analysis(church_id, updated_at);

