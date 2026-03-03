-- Add outdoor/weather fields to events.
--
-- NOTE: Cloudflare D1 (SQLite) does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
-- This migration is written to be idempotent when columns already exist by rebuilding the table.
-- It will default `is_outdoor=0` and `lat/lon=NULL` during the copy.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS events_new;

CREATE TABLE IF NOT EXISTS events_new (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  start_at TEXT NOT NULL, -- ISO
  end_at TEXT,
  location_name TEXT,
  location_address TEXT,
  is_outdoor INTEGER NOT NULL DEFAULT 0,
  lat REAL,
  lon REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Copy core fields; set new columns to safe defaults.
INSERT INTO events_new (
  id, church_id, campus_id, title, description, start_at, end_at, location_name, location_address,
  is_outdoor, lat, lon,
  created_at, updated_at
)
SELECT
  id, church_id, campus_id, title, description, start_at, end_at, location_name, location_address,
  0, NULL, NULL,
  created_at, updated_at
FROM events;

DROP TABLE IF EXISTS events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX IF NOT EXISTS idx_events_church ON events(church_id, campus_id, start_at);

PRAGMA foreign_keys = ON;

