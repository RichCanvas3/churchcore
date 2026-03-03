-- Community catalog + per-person participation.
-- D1 does not apply CREATE TABLE changes to existing tables automatically,
-- so ship as an explicit migration for remote DBs.

CREATE TABLE IF NOT EXISTS community_catalog (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  campus_id TEXT,
  kind TEXT NOT NULL, -- lifegroup|class|ministry|outreach_local|outreach_global|trip|serving_team|bible_study|other
  title TEXT NOT NULL,
  description TEXT,
  source_url TEXT,
  signup_url TEXT,
  start_at TEXT,
  end_at TEXT,
  tags_json TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_catalog ON community_catalog(church_id, campus_id, kind, is_active);

CREATE TABLE IF NOT EXISTS person_community (
  church_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  community_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- pending|active|inactive|attended|completed
  role TEXT NOT NULL DEFAULT 'participant', -- participant|leader
  joined_at TEXT,
  left_at TEXT,
  notes_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (church_id, person_id, community_id)
);
CREATE INDEX IF NOT EXISTS idx_person_community ON person_community(church_id, person_id, status, updated_at);

