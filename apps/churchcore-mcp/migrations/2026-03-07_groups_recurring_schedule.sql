-- Groups: recurring schedule fields (weekly/biweekly) + location.
--
-- This migration must handle production DBs that may already have a `groups` table
-- but be missing some of the newer `meeting_*` columns. Since D1 doesn't support
-- `ADD COLUMN IF NOT EXISTS`, we use a table-rebuild pattern to converge to the
-- canonical schema without duplicate-column failures.

PRAGMA foreign_keys=OFF;

-- Ensure a baseline `groups` table exists so the SELECT below is always valid.
-- (If `groups` already exists, this is a no-op.)
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  leader_person_id TEXT,
  meeting_details TEXT,
  is_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (leader_person_id) REFERENCES people(id) ON DELETE SET NULL
);

-- Canonical schema (with meeting_* columns).
CREATE TABLE IF NOT EXISTS groups__new (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  leader_person_id TEXT,
  meeting_details TEXT,
  meeting_frequency TEXT,        -- weekly|biweekly|null
  meeting_day_of_week INTEGER,   -- 0=Sun..6=Sat
  meeting_time_local TEXT,       -- HH:MM (local)
  meeting_timezone TEXT,         -- IANA tz (e.g. America/Denver)
  meeting_location_name TEXT,
  meeting_location_address TEXT,
  is_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (leader_person_id) REFERENCES people(id) ON DELETE SET NULL
);

-- Copy baseline columns; new columns default to NULL.
INSERT OR REPLACE INTO groups__new (
  id, church_id, campus_id, name, description, leader_person_id,
  meeting_details, meeting_frequency, meeting_day_of_week, meeting_time_local, meeting_timezone, meeting_location_name, meeting_location_address,
  is_open, created_at, updated_at
)
SELECT
  id, church_id, campus_id, name, description, leader_person_id,
  meeting_details,
  NULL AS meeting_frequency,
  NULL AS meeting_day_of_week,
  NULL AS meeting_time_local,
  NULL AS meeting_timezone,
  NULL AS meeting_location_name,
  NULL AS meeting_location_address,
  is_open, created_at, updated_at
FROM groups;

DROP TABLE groups;
ALTER TABLE groups__new RENAME TO groups;

PRAGMA foreign_keys=ON;

CREATE INDEX IF NOT EXISTS idx_groups_church ON groups(church_id, campus_id);
CREATE INDEX IF NOT EXISTS idx_groups_meeting ON groups(church_id, campus_id, meeting_day_of_week, meeting_time_local);

