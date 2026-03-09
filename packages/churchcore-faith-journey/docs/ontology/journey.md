# Journey (faith journey) — faith journey graph + stage states

Sources:

- Upper (schema): `../../churchcore-ontology/ontology/tbox/journey.ttl`
- C-Box (states): `../../churchcore-faith-journey/ontology/cbox/faith-journey-states.ttl`
- C-Box (graph): `../../churchcore-faith-journey/ontology/cbox/faith-journey-graph.ttl`

This package includes a **canonical faith journey graph** (not per church) plus a matching **stage state** scheme so applications can align:

- **Journey graph (nodes/edges)**: “what are the possible paths?”
- **State categories**: “what stage is represented by this node?” and “what stage should hold now?”

## Macro stages (1–9)

- Seeker
- Gospel clarity
- Conversion
- New believer
- Connected
- Growing disciple
- Serving
- Multiplying
- Leader

Each macro stage node links to a stage-state category using `representsState` (JourneyNode → State).

## Fine-grained expansion (v1)

Version 1 expands stages **1–3** (Seeker → Gospel clarity → Conversion) into finer-grained nodes including common:

- steps/actions (conversation, attend, pray, read scripture)
- barriers (misconceptions, hurt, confusion)
- understanding milestones (who Jesus is, cross/resurrection, sin/grace, response)

Edges use `edgeKind` values aligned with the journey edge type notations in the upper C-Box (e.g., `NEXT_STAGE`, `REQUIRES`, `RECOMMENDS`, `BLOCKED_BY`, `RESOLVED_BY`).

## Per-person “you are here” (A-Box)

The repo does **not** store per-person state.

In GraphDB, represent a person’s current position with:

- `ccjourney:PersonJourneyState`
  - `ccjourney:forPerson` → the person
  - `ccjourney:currentNode` → a node in the canonical graph
  - `ccjourney:updatedAt` → timestamp

## SPARQL: show current node + next aims

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>
PREFIX ccjourney: <https://ontology.churchcore.ai/cc/journey#>

SELECT ?state ?currentNode ?currentName ?edge ?nextNode ?nextName
WHERE {
  ?state a ccjourney:PersonJourneyState ;
         ccjourney:currentNode ?currentNode .
  OPTIONAL { ?currentNode cc:name ?currentName }

  OPTIONAL {
    ?edge ccjourney:fromNode ?currentNode ;
          ccjourney:toNode ?nextNode ;
          ccjourney:edgeKind "NEXT_STAGE" .
    OPTIONAL { ?nextNode cc:name ?nextName }
  }
}
LIMIT 200
```

