-- Group invites: expiry + status tracking.
-- NOTE: D1 does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
-- To avoid "duplicate column name" failures and ordering dependencies, we ensure the
-- table shape here using CREATE TABLE IF NOT EXISTS (safe) and then create indexes.

CREATE TABLE IF NOT EXISTS group_invites (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  invited_by_person_id TEXT NOT NULL,
  invitee_person_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|declined|cancelled|expired
  expires_at TEXT, -- ISO timestamp (UTC)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (church_id, group_id, invitee_person_id)
);

CREATE INDEX IF NOT EXISTS idx_group_invites_outgoing ON group_invites(church_id, group_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_group_invites_expiry ON group_invites(church_id, status, expires_at);

