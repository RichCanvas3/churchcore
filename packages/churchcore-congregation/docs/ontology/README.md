# ChurchCore-Congregation ontology docs (Local-C)

This package defines **local church operations** concepts that derive from the ChurchCore upper ontology (things that vary between congregations, but are broadly reusable across churches).

## What belongs here

- Small groups, ministries, facilities/rooms, services, volunteer teams
- Local operational categories (service types, attendance statuses, etc.)

## T-Box / C-Box / A-Box layout

- **T-Box** (`ontology/tbox/`): schema (classes + properties)
- **C-Box** (`ontology/cbox/`): category instances / controlled vocabularies
- **A-Box** (`ontology/abox/`): placeholder (real instance data lives in GraphDB named graphs)

## Quick navigation

- `overview.md`: design patterns + layering + query patterns
- `ops.md`: local ops schema (small groups, ministries, facilities)
- `audience.md`: audience/segment schema + local segment taxonomies
- `sparql-queries.md`: practical GraphDB queries (patterns)

## GraphDB conventions

- **Named graph** per church: `https://churchcore.ai/graph/d1/<churchId>`
- **Instance IDs**: `https://id.churchcore.ai/...`

