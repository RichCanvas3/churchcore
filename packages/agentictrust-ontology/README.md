# `@churchcore/agentictrust-ontology`

Vendored copy of the **AgenticTrust upper ontology** (Turtle TTL).

## What’s inside

- `ontology/`: the TTL files (downloaded and stored locally)
- `src/manifest.mjs`: upstream file list + source location
- `src/download.mjs`: downloader
- `src/verify.mjs`: verifier used by `pnpm lint`

## Commands

Download/update the upstream TTL files:

```bash
pnpm -C packages/agentictrust-ontology download
```

Verify required files exist:

```bash
pnpm -C packages/agentictrust-ontology lint
```

## Ontology docs

See `docs/ontology/README.md`.

