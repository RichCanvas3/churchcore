# Packages

Workspace packages used by ChurchCore apps.

## Ontologies

- `agentictrust-ontology`: vendored AgenticTrust upper ontology (TTL). Downloaded from AgenticTrust source and kept locally under `ontology/`.
- `churchcore-ontology`: ChurchCore **upper** ontology (TTL modules) aligned to PROV-O + P-Plan + EP-PLAN principles.
- `churchcore-global`: ChurchCore **global** (Big-C) ontology: denominations, initiatives, mission agencies, people groups, shared Christian reference structures.
- `churchcore-congregation`: ChurchCore **congregation** (Local-C) ontology: services, ministries, small groups, facilities, check-in.

## Runtime + tooling

- `churchcore-graphdb-client`: GraphDB (Ontotext) HTTP client helpers (SPARQL query + statement uploads).
- `churchcore-kb-sync`: one-time D1(SQLite export) → GraphDB loader CLI (full rebuild). Use when you have a SQLite dump of D1.

## Common commands

From repo root:

```bash
pnpm -C packages/agentictrust-ontology download
pnpm -C packages/agentictrust-ontology lint
pnpm -C packages/churchcore-ontology lint
pnpm -C packages/churchcore-global lint
pnpm -C packages/churchcore-congregation lint
```

## Cloudflare job sync (preferred)

If you’re using Cloudflare for the live system, `apps/churchcore-mcp` contains a scheduled D1 → GraphDB sync and an admin trigger:

- Manual trigger: `POST /admin/graphdb-sync` (requires `x-api-key: <MCP_API_KEY>`)
- Named graph: `https://churchcore.ai/graph/d1/<churchId>`


