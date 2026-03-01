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

## Deploy (high level)

- **LangSmith Deployments**: uses `langgraph.json` and `apps/api`
- **Cloudflare Workers**: deploy `apps/churchcore-mcp` and configure `MCP_SERVERS_JSON` in the LangSmith Deployment
- **Vercel**: deploy `apps/web` and set `LANGGRAPH_DEPLOYMENT_URL`, `LANGSMITH_API_KEY`, `LANGGRAPH_ASSISTANT_ID`

