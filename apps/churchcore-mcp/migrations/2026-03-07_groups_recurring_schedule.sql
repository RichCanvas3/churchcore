-- Groups: recurring schedule fields (weekly/biweekly) + location.
-- NOTE: D1 does not support ALTER TABLE ... ADD COLUMN IF NOT EXISTS; do not re-run after success.

ALTER TABLE groups ADD COLUMN meeting_frequency TEXT;        -- weekly|biweekly|null
ALTER TABLE groups ADD COLUMN meeting_day_of_week INTEGER;   -- 0=Sun..6=Sat
ALTER TABLE groups ADD COLUMN meeting_time_local TEXT;       -- HH:MM (local)
ALTER TABLE groups ADD COLUMN meeting_timezone TEXT;         -- IANA tz (e.g. America/Denver)
ALTER TABLE groups ADD COLUMN meeting_location_name TEXT;
ALTER TABLE groups ADD COLUMN meeting_location_address TEXT;

CREATE INDEX IF NOT EXISTS idx_groups_meeting ON groups(church_id, campus_id, meeting_day_of_week, meeting_time_local);

