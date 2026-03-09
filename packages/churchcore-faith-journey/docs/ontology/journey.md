# Journey (faith journey) — faith journey graph + stage states

Sources:

- Upper (schema): `../../churchcore-ontology/ontology/tbox/journey.ttl`
- C-Box (states): `../../churchcore-faith-journey/ontology/cbox/faith-journey-states.ttl`
- C-Box (graph): `../../churchcore-faith-journey/ontology/cbox/faith-journey-graph.ttl`

This package includes a **set of canonical journey graphs** (not per church) plus matching **state schemes** so applications can align:

- **Journey graph (nodes/edges)**: “what are the possible paths?”
- **State categories**: “what stage is represented by this node?” and “what stage should hold now?”

## Graph pack (v2)

Evangelical ministry data tends to describe growth along multiple dimensions. ChurchCore models this as **four connected graphs** plus a macro-stage graph for compatibility:

- **Macro stages** (legacy-compatible): 9-stage ladder (Seeker → … → Leader)
- **Openness**: spiritual openness / conversion (A-graph)
- **Formation**: spiritual formation / maturity (B-graph)
- **Belonging**: church integration / participation (C-graph)
- **Multiplication**: disciple-maker / multiplication (D-graph)

Each graph has a corresponding state scheme (SKOS concepts typed as `cc:State`) and the graph nodes link to those state categories via `representsState`.

## Macro stages (1–9) graph

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

## Dimension graphs (A–D)

### A) Openness / conversion

Sources:

- states: `ontology/cbox/openness-states.ttl`
- graph: `ontology/cbox/openness-graph.ttl`

### B) Formation / maturity

Sources:

- states: `ontology/cbox/formation-states.ttl`
- graph: `ontology/cbox/formation-graph.ttl`

### C) Belonging / integration

Sources:

- states: `ontology/cbox/belonging-states.ttl`
- graph: `ontology/cbox/belonging-graph.ttl`

### D) Multiplication / disciple-maker

Sources:

- states: `ontology/cbox/multiplication-states.ttl`
- graph: `ontology/cbox/multiplication-graph.ttl`

## Signals (C-Box)

Signals are modeled as controlled vocabularies so different churches/systems can map their measurements consistently:

- signal types: `ontology/cbox/signal-types.ttl`
- signal levels: `ontology/cbox/signal-levels.ttl`

In A-Box, attach signals using simple events/records (e.g., `ccjourney:PersonJourneyEvent`) that reference a signal type and level in your application graph.

## Per-person “you are here” (A-Box)

The repo does **not** store per-person state.

In GraphDB, represent a person’s current position with:

- `ccjourney:PersonJourneyState`
  - `ccjourney:forPerson` → the person
  - `ccjourney:currentNode` → a node in the canonical graph
  - `ccjourney:updatedAt` → timestamp

Recommendation: represent a person’s profile as **multiple** `PersonJourneyState` resources, one per graph (MacroStages, Openness, Formation, Belonging, Multiplication).

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

