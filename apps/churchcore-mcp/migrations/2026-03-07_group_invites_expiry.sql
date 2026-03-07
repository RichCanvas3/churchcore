-- Group invites: expiry + status tracking.
-- NOTE: D1 does not support ALTER TABLE ... ADD COLUMN IF NOT EXISTS; do not re-run after success.

ALTER TABLE group_invites ADD COLUMN expires_at TEXT; -- ISO timestamp (UTC)

CREATE INDEX IF NOT EXISTS idx_group_invites_outgoing ON group_invites(church_id, group_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_group_invites_expiry ON group_invites(church_id, status, expires_at);

