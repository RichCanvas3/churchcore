-- Add outdoor/weather fields to events.
-- D1 does not apply CREATE TABLE changes to existing tables, so use ALTER TABLE.

ALTER TABLE events ADD COLUMN is_outdoor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN lat REAL;
ALTER TABLE events ADD COLUMN lon REAL;

-- Optional: basic backfill from common campus addresses could be done here,
-- but we keep it manual to avoid overwriting real data.

