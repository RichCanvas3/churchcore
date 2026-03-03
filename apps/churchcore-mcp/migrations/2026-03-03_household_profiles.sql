-- Household profile (household-level notes/preferences).

CREATE TABLE IF NOT EXISTS household_profiles (
  household_id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  allergy_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_household_profiles ON household_profiles(church_id, household_id);

