# ChurchCore MCP (Cloudflare Worker + D1)

Modeled after the MCP Worker pattern used in [`RichCanvas3/gym`](https://github.com/RichCanvas3/gym) (e.g. `apps/gym-core-mcp`, `apps/sendgrid-mcp`) but **stores all data locally in D1** (no Planning Center integration).

## Local dev

```bash
pnpm -C apps/churchcore-mcp install
pnpm dev:mcp
```

## D1 setup

```bash
# create DB
wrangler d1 create churchcore

# update apps/churchcore-mcp/wrangler.jsonc with the database_id

# apply schema + seed (remote)
wrangler d1 execute churchcore --remote --file apps/churchcore-mcp/schema.sql
wrangler d1 execute churchcore --remote --file apps/churchcore-mcp/seed.sql
```

## MCP endpoint

- Default route: `/mcp`
- Optional auth: set Worker secret `MCP_API_KEY` and send header `x-api-key`.

