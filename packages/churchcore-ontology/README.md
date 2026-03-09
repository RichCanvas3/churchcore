# `@churchcore/churchcore-ontology`

ChurchCore **upper ontology** (Turtle TTL modules).

Design goals:

- Align to **PROV-O** (as-executed), **P-Plan** / **EP-PLAN** (as-planned)
- Keep “upper” concepts church-agnostic (no Calvary-specific instance data here)
- Provide stable namespaces under `https://ontology.churchcore.ai/`

## What’s inside

- `ontology/`: modular TTL files
  - `churchcore-upper-core.ttl`
  - `churchcore-upper-planning.ttl`
  - `churchcore-upper-provenance.ttl`
  - `churchcore-upper-situations.ttl`
  - `churchcore-upper-community.ttl`
  - `churchcore-upper-discipleship.ttl`
  - `churchcore-upper-commerce.ttl`
  - `churchcore-upper-classifications.ttl`
  - `churchcore-all.ttl` (master import)
  - `tbox/`: schema (classes + properties)
  - `cbox/`: controlled vocabularies / category instances
  - `abox/`: placeholder (instance data lives in GraphDB)
- `src/ns.mjs`: namespace constants used by scripts/tools
- `src/verify.mjs`: verifier used by `pnpm lint`

## Commands

Verify ontology files are present:

```bash
pnpm -C packages/churchcore-ontology lint
```

## Ontology docs

See `docs/ontology/README.md`.

