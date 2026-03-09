# People groups — model + Phase 0–7 progress

Sources:

- T-Box: `../../churchcore-people-groups/ontology/tbox/people-groups.ttl`
- C-Box (phases): `../../churchcore-people-groups/ontology/cbox/people-group-faith-phases.ttl`
- C-Box (graph): `../../churchcore-people-groups/ontology/cbox/people-group-faith-journey-graph.ttl`
- Upper (state primitives): `../../churchcore-ontology/ontology/tbox/state.ttl`

This package models **people groups** and a canonical **7-phase gospel progress** system.\n\nPhase is intended to be tracked over time using ChurchCore’s **TimeVaryingConcept → Manifestations → State categories** pattern.

## Phase model (0–7)

- Phase 0 — Unengaged
- Phase 1 — Adoption
- Phase 2 — Gospel presence
- Phase 3 — Disciples emerging
- Phase 4 — Local church
- Phase 5 — Reproducing churches
- Phase 6 — Multiplying movement
- Phase 7 — Cross-cultural sending

## How to represent “current phase” (A-Box)

The repo does **not** store per-people-group instances.\n\nIn GraphDB, represent a specific people group as a `ccpg:PeopleGroup` (a `cc:TimeVaryingConcept`), and track its gospel progress with manifestation snapshots:\n\n- `cc:hasManifestation` → `cc:Manifestation`\n- `cc:hasState` → one of the phase state categories (Phase 0–7)\n- `cc:manifestedAtTime` → timestamp\n\n## SPARQL: list people group manifestations and phases

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>

SELECT ?pg ?m ?phase ?t
WHERE {
  ?pg a cc:TimeVaryingConcept ;
      cc:hasManifestation ?m .
  ?m a cc:Manifestation .
  OPTIONAL { ?m cc:hasState ?phase }
  OPTIONAL { ?m cc:manifestedAtTime ?t }
}
ORDER BY ?pg ?t
LIMIT 200
```

