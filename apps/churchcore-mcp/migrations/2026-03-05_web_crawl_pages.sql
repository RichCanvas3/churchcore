-- Website crawl metadata (change detection for scheduled scraping).

CREATE TABLE IF NOT EXISTS web_crawl_pages (
  url TEXT PRIMARY KEY,
  church_id TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  content_hash TEXT,
  title TEXT,
  status_code INTEGER,
  last_fetched_at TEXT,
  last_changed_at TEXT,
  error TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_web_crawl_pages ON web_crawl_pages(church_id, updated_at);

