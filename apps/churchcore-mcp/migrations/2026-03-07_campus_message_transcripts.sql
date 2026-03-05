-- Campus message transcripts (audio -> text).

CREATE TABLE IF NOT EXISTS campus_message_transcripts (
  message_id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  transcript_text TEXT NOT NULL,
  source_url TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES campus_messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_campus_message_transcripts ON campus_message_transcripts(church_id, updated_at);

