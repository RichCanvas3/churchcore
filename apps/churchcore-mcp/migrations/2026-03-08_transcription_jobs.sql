-- Transcription job queue for long audio (AssemblyAI, etc.)

CREATE TABLE IF NOT EXISTS transcription_jobs (
  id TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  provider TEXT NOT NULL, -- assemblyai|openai|other
  audio_url TEXT NOT NULL,
  provider_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued', -- queued|processing|completed|failed
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_transcription_jobs ON transcription_jobs(church_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_message ON transcription_jobs(church_id, message_id, provider);

