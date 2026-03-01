# Church Agent Platform (Seeker + Guide)

Monorepo modeled after [`RichCanvas3/gym`](https://github.com/RichCanvas3/gym):

- `apps/web`: Next.js web UI (Vercel + local dev)
- `apps/api`: Hosted LangGraph agent (LangSmith Deployments)
- `apps/churchcore-mcp`: Cloudflare Worker MCP server (D1-backed)

## Local dev (web)

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000/chat` (seeker) or `http://localhost:3000/guide` (guide).

## Local dev (A2A gateway + MCP + web)

The web UI calls `/api/a2a/*`, which proxies to an **A2A Gateway** that persists threads/messages in **ChurchCore D1** and calls the hosted LangGraph deployment.

```bash
# 1) MCP + D1
pnpm -C apps/churchcore-mcp d1:local:setup
pnpm dev:mcp

# 2) A2A gateway (Worker)
# Configure Worker secrets: LANGGRAPH_DEPLOYMENT_URL, LANGSMITH_API_KEY (and optional A2A_API_KEY).
pnpm -C apps/a2a-gateway-worker install
pnpm -C apps/a2a-gateway-worker dev

# 3) web
pnpm dev
```

## Deploy (high level)

- **LangSmith Deployments**: uses `langgraph.json` and `apps/api`
- **Cloudflare Workers**: deploy `apps/churchcore-mcp` and configure `MCP_SERVERS_JSON` in the LangSmith Deployment
- **Vercel**: deploy `apps/web` and set `LANGGRAPH_DEPLOYMENT_URL`, `LANGSMITH_API_KEY`, `LANGGRAPH_ASSISTANT_ID`

