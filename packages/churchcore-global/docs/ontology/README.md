# ChurchCore-Global ontology docs (Big-C)

This package defines the **Big‑C** Christian ecosystem layer that derives from the ChurchCore upper ontology.

## What belongs here

- Denominations / tradition families (as categories)
- Mission agencies, networks, movements, global initiatives (schema + categories)
- Shared Christian reference structures (e.g., Bible reference sets)

## T-Box / C-Box / A-Box layout

- **T-Box** (`ontology/tbox/`): schema (classes + properties)
- **C-Box** (`ontology/cbox/`): category instances / controlled vocabularies
- **A-Box** (`ontology/abox/`): placeholder (real instance data lives in GraphDB named graphs)

## Quick navigation

- `overview.md`: design patterns + layering + query patterns
- `ecosystem.md`: Big-C ecosystem schema (denomination, mission agency, initiative, people group)
- `mission.md`: Great Commission mission schema + MissionSituation bridge
- `audience.md`: audience/segment schema + global segment taxonomies
- `bible.md`: Bible reference set schema
- `classifications.md`: global C-Box categories (traditions, theology, initiative types)
- `measurement.md`: ecosystem measurement + benchmarking schema + categories
- `sparql-queries.md`: practical GraphDB queries (patterns)

