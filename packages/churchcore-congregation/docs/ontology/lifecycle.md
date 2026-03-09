# Congregation lifecycle — canonical stages

Sources:

- C-Box (states): `../../churchcore-congregation/ontology/cbox/congregation-lifecycle-states.ttl`
- C-Box (graph): `../../churchcore-congregation/ontology/cbox/congregation-lifecycle-graph.ttl`
- Upper (journey schema): `../../churchcore-ontology/ontology/tbox/journey.ttl`
- Upper (state primitives): `../../churchcore-ontology/ontology/tbox/state.ttl`

This package includes a **congregation lifecycle** model (church plant → growing → reproducing → sending), expressed as:

- a **canonical journey graph** (nodes/edges)
- a matching **state category** scheme (to classify congregation manifestations)

## Stages

- Church plant
- Growing church
- Reproducing church
- Sending church

## Per-congregation “current stage” (A-Box)

Track a specific congregation over time as a `cc:TimeVaryingConcept` with manifestation snapshots classified by lifecycle state categories.

