## Scheduled website scraping → ChurchCore KB

This worker runs scheduled crawls (Cloudflare Cron Triggers) to ingest public pages from `calvarybible.com` into ChurchCore D1 and keep the **persisted KB embeddings** (`kb_chunks`) fresh for LangSmith deployments.

### What it does

- **Crawl metadata**: stores change detection in `web_crawl_pages` (etag/last-modified/hash).
- **Page content**: stores extracted text in `content_docs` as:
  - `entity_type='web_page'`
  - `entity_id=<canonical URL>`
- **Campus messages**: discovers recent campus messages from:
  - `https://calvarybible.com/messages/boulder/`
  - `https://calvarybible.com/messages/erie/`
  - `https://calvarybible.com/messages/thornton/`
  Then ingests each `?enmse_mid=...` message into:
  - `campus_messages` (+ `campus_message_analysis` if `OPENAI_API_KEY` is set)
  - `content_docs` as `entity_type='campus_message'` (used for KB)
- **Weekly guides**: parses `https://calvarybible.com/discussion/john/` and upserts current/previous week PDF links into `weekly_guides`.
- **KB refresh**: on changed pages, chunks + embeds and replaces `kb_chunks` for that page’s `source_id`.
- **Budget**: default **50 pages/day** from sitemap + a small set of “key pages” every 6 hours.

### Cron schedules

Defined in `wrangler.jsonc`:

- `0 */6 * * *` key pages (weekly, locations, message archive, events, mission/vision)
- `15 3 * * *` daily sitemap crawl (capped by `CRAWL_BUDGET`)

### Configuration

#### Secrets (required for embeddings refresh)

- `OPENAI_API_KEY`
- `OPENAI_EMBEDDINGS_MODEL` (optional, default `text-embedding-3-large`)
- `OPENAI_SUMMARY_MODEL` (optional, default `gpt-4o-mini`) for message summaries/extraction

Set remote secrets:

```bash
cd apps/churchcore-mcp
wrangler secret put OPENAI_API_KEY
wrangler secret put OPENAI_EMBEDDINGS_MODEL
wrangler secret put OPENAI_SUMMARY_MODEL
```

#### Vars (optional)

- `CRAWL_CHURCH_ID` (default `calvarybible`)
- `CRAWL_BUDGET` (default `50`)
- `CRAWL_DOMAIN_ALLOWLIST` (default `calvarybible.com,calvarybible.s3.us-west-1.amazonaws.com`)

### Deploy / migrate

```bash
cd apps/churchcore-mcp
wrangler d1 migrations apply churchcore --remote
wrangler deploy
```

### Local testing

Apply migrations:

```bash
cd apps/churchcore-mcp
wrangler d1 migrations apply churchcore --local
```

Run the worker and trigger scheduled events:

```bash
wrangler dev --test-scheduled
```

### Verification queries

```bash
# rows crawled
wrangler d1 execute churchcore --remote --command "SELECT count(*) AS n FROM web_crawl_pages;"

# scraped docs in content_docs
wrangler d1 execute churchcore --remote --command "SELECT count(*) AS n FROM content_docs WHERE entity_type='web_page';"

# scraped docs for campus messages (KB)
wrangler d1 execute churchcore --remote --command "SELECT count(*) AS n FROM content_docs WHERE entity_type='campus_message';"

# persisted KB chunks for web pages
wrangler d1 execute churchcore --remote --command "SELECT count(*) AS n FROM kb_chunks WHERE source_id LIKE 'content/web_page/%';"

# persisted KB chunks for campus messages
wrangler d1 execute churchcore --remote --command "SELECT count(*) AS n FROM kb_chunks WHERE source_id LIKE 'content/campus_message/%';"
```

