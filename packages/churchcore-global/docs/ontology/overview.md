# ChurchCore-Global Ontology — overview

This package models the **supra-congregational Christian ecosystem** (Big‑C scope) that operates above a single congregation.

It is intentionally focused on:

- denominations, networks, movements, mission agencies, initiatives
- people groups and macro-scale mission concepts
- shared reference structures (e.g., Bible reference sets)
- ecosystem measurement and benchmarking schema + category systems

## T-Box / C-Box / A-Box layout

- **T-Box** (`ontology/tbox/`): classes + properties (schema)
- **C-Box** (`ontology/cbox/`): category instances (SKOS schemes + concepts; starter typed individuals)
- **A-Box** (`ontology/abox/`): placeholder (dataset instances belong in GraphDB named graphs)

## Key modules

- **Ecosystem core**: `ontology/tbox/ecosystem.ttl`
- **Bible references**: `ontology/tbox/bible.ttl`
- **Measurement + benchmarking**: `ontology/tbox/measurement.ttl`
- **Categories**: `ontology/cbox/*` (traditions, theology, initiative types, denominations, dimensions)

## How Local-C connects to Big-C

The primary connection is **participation/support** from a congregation:

- `ccglobal:participatesIn` (congregation → initiative)
- `ccglobal:supportsOrganization` (congregation → organization)
- `ccglobal:praysForPeopleGroup` (congregation → people group)

## Query patterns

### Organizations and their Big-C participation links

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>
PREFIX ccglobal: <https://ontology.churchcore.ai/cc/global#>

SELECT ?church ?churchName ?initiative
WHERE {
  GRAPH <https://churchcore.ai/graph/d1/example> {
    ?church a cc:Church .
    OPTIONAL { ?church cc:name ?churchName }
    OPTIONAL { ?church ccglobal:participatesIn ?initiative }
  }
}
LIMIT 200
```

