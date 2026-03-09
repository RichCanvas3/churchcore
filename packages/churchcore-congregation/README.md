# `@churchcore/churchcore-congregation`

ChurchCore **congregation (Local-C) ontology**: local church operations that extend the ChurchCore upper ontology.

This is where congregation-level vocabularies for small groups, ministries, facilities/rooms, services, etc. live.

## What’s inside

- `ontology/churchcore-congregation.ttl`: package root wrapper
- `ontology/tbox/`: congregation schema
- `ontology/cbox/`: congregation categories
- `src/verify.mjs`: verifier used by `pnpm lint`

## Commands

Verify required local ontology files exist:

```bash
pnpm -C packages/churchcore-congregation lint
```

## Ontology docs

See `docs/ontology/README.md`.

