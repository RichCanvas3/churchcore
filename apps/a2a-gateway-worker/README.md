# A2A Gateway Worker (Cloudflare Worker + D1)

Implements an **A2A-style** API for threads + chat, backed by the same ChurchCore D1 database.

## Local dev

Prereqs:
- `apps/churchcore-mcp` schema/seed already applied to local D1

```bash
pnpm -C apps/a2a-gateway-worker install
# copy env template
cp apps/a2a-gateway-worker/.dev.vars.example apps/a2a-gateway-worker/.dev.vars
pnpm -C apps/a2a-gateway-worker dev
```

Default local URL: `http://localhost:8788`

## Secrets / env

Set Worker secrets:
- `LANGGRAPH_DEPLOYMENT_URL`
- `LANGSMITH_API_KEY`
- (optional) `A2A_API_KEY` (requires `x-api-key` header)

