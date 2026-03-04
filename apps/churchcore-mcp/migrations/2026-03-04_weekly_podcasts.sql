-- Weekly Podcast (The Weekly) – episodes + cached analysis.
-- Ship as explicit migration for remote D1.

CREATE TABLE IF NOT EXISTS weekly_podcasts (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  episode_number INTEGER,
  title TEXT NOT NULL,
  speaker TEXT,
  published_at TEXT,
  passage TEXT,
  source_url TEXT,
  watch_url TEXT,
  listen_url TEXT,
  image_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weekly_podcasts ON weekly_podcasts(church_id, published_at, is_active);

CREATE TABLE IF NOT EXISTS weekly_podcast_analysis (
  podcast_id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  summary_markdown TEXT,
  topics_json TEXT,
  verses_json TEXT,
  model TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weekly_podcast_analysis ON weekly_podcast_analysis(church_id, updated_at);

