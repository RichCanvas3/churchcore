-- Groups: long-lived membership groups (Life Groups, Men's/Women's, Bible study groups)
-- NOTE: D1 does not support ALTER TABLE ... ADD COLUMN IF NOT EXISTS; keep this migration additive/new tables.

CREATE TABLE IF NOT EXISTS group_invites (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  invited_by_person_id TEXT NOT NULL,
  invitee_person_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|declined|cancelled
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (church_id, group_id, invitee_person_id),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by_person_id) REFERENCES people(id) ON DELETE CASCADE,
  FOREIGN KEY (invitee_person_id) REFERENCES people(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_group_invites_lookup ON group_invites(church_id, group_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_group_invites_invitee ON group_invites(church_id, invitee_person_id, status, updated_at);

CREATE TABLE IF NOT EXISTS group_events (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT,
  created_by_person_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'members', -- members|leaders
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_person_id) REFERENCES people(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_group_events ON group_events(church_id, group_id, start_at);

CREATE TABLE IF NOT EXISTS group_bible_studies (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active|archived
  created_by_person_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_person_id) REFERENCES people(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_group_bible_studies ON group_bible_studies(church_id, group_id, status, updated_at);

CREATE TABLE IF NOT EXISTS group_bible_study_sessions (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  bible_study_id TEXT NOT NULL,
  session_at TEXT NOT NULL,
  title TEXT,
  agenda TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (bible_study_id) REFERENCES group_bible_studies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_group_bible_study_sessions ON group_bible_study_sessions(church_id, bible_study_id, session_at);

CREATE TABLE IF NOT EXISTS group_bible_study_readings (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  bible_study_id TEXT NOT NULL,
  ref TEXT NOT NULL, -- scripture reference only
  order_index INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (bible_study_id) REFERENCES group_bible_studies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_group_bible_study_readings ON group_bible_study_readings(church_id, bible_study_id, order_index);

CREATE TABLE IF NOT EXISTS group_bible_study_notes (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  bible_study_id TEXT NOT NULL,
  author_person_id TEXT,
  content_markdown TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'members', -- members|leaders
  created_at TEXT NOT NULL,
  FOREIGN KEY (bible_study_id) REFERENCES group_bible_studies(id) ON DELETE CASCADE,
  FOREIGN KEY (author_person_id) REFERENCES people(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_group_bible_study_notes ON group_bible_study_notes(church_id, bible_study_id, created_at);

