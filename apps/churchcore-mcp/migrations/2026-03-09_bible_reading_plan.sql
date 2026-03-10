-- Sermon-anchored Bible reading plan (week + daily items) + guide check-ins.
-- NOTE: `campus_messages.preached_date/week_start_date/week_end_date` are defined
-- in the base `campus_messages` table schema (see `2026-03-06_messages_and_guides.sql`).
-- We avoid `ALTER TABLE ... ADD COLUMN` here because D1 does not support
-- `ADD COLUMN IF NOT EXISTS` and production DBs may already have the columns.

-- Bible reading plan weeks (per campus).
CREATE TABLE IF NOT EXISTS bible_reading_weeks (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT NOT NULL,
  anchor_message_id TEXT NOT NULL,
  preached_date TEXT NOT NULL,   -- YYYY-MM-DD
  week_start_date TEXT NOT NULL, -- YYYY-MM-DD
  week_end_date TEXT NOT NULL,   -- YYYY-MM-DD
  title TEXT,
  passage TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (church_id, campus_id, week_start_date),
  FOREIGN KEY (anchor_message_id) REFERENCES campus_messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bible_reading_weeks ON bible_reading_weeks(church_id, campus_id, week_start_date);
CREATE INDEX IF NOT EXISTS idx_bible_reading_weeks_anchor ON bible_reading_weeks(church_id, anchor_message_id);

-- Individual reading items (daily readings + daily verses + reflections).
CREATE TABLE IF NOT EXISTS bible_reading_items (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  week_id TEXT NOT NULL,
  day_date TEXT NOT NULL, -- YYYY-MM-DD
  kind TEXT NOT NULL, -- reading|daily_verse|reflection
  ref TEXT, -- scripture reference string
  label TEXT,
  notes_markdown TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (church_id, week_id, day_date, kind, ref),
  FOREIGN KEY (week_id) REFERENCES bible_reading_weeks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bible_reading_items_week ON bible_reading_items(church_id, week_id, day_date);
CREATE INDEX IF NOT EXISTS idx_bible_reading_items_ref ON bible_reading_items(church_id, ref);

-- Per-person completion tracking.
CREATE TABLE IF NOT EXISTS bible_reading_progress (
  church_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL, -- started|completed
  completed_at TEXT,
  notes_markdown TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (church_id, person_id, item_id),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES bible_reading_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bible_reading_progress_person ON bible_reading_progress(church_id, person_id, updated_at);

-- Manual guide encouragement/check-ins tied to a week (optional day).
CREATE TABLE IF NOT EXISTS bible_reading_checkins (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  week_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  guide_user_id TEXT NOT NULL,
  day_date TEXT, -- YYYY-MM-DD, nullable for week-level
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (week_id) REFERENCES bible_reading_weeks(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bible_reading_checkins_week ON bible_reading_checkins(church_id, person_id, week_id, day_date, created_at);

