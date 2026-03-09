# State (cc/state) — time-varying concepts + manifestations

Sources:

- wrapper: `ontology/churchcore-upper-state.ttl`
- T-Box: `ontology/tbox/state.ttl`

This module provides the “state-based behavioristics” primitives described on the website:

- **Specification-side categories**: `cc:State` (plus terminal/non-terminal/conjunctive)
- **Operational snapshots**: `cc:Manifestation`
- **Identity-through-time**: `cc:TimeVaryingConcept`

## Class hierarchy

```mermaid
classDiagram
direction TB

class prov_Entity["prov:Entity"]
class cc_TimeVaryingConcept["cc:TimeVaryingConcept"]
class cc_Manifestation["cc:Manifestation"]
class cc_State["cc:State"]
class cc_TerminalState["cc:TerminalState"]
class cc_NonTerminalState["cc:NonTerminalState"]
class cc_ConjunctiveState["cc:ConjunctiveState"]

prov_Entity <|-- cc_TimeVaryingConcept
prov_Entity <|-- cc_Manifestation
prov_Entity <|-- cc_State
cc_State <|-- cc_TerminalState
cc_State <|-- cc_NonTerminalState
cc_State <|-- cc_ConjunctiveState
```

## Relationship diagram

```mermaid
classDiagram
direction LR

class cc_TimeVaryingConcept["cc:TimeVaryingConcept"]
class cc_Manifestation["cc:Manifestation"]
class cc_State["cc:State"]
class xsd_dateTime["xsd:dateTime"]

cc_TimeVaryingConcept --> "0..*" cc_Manifestation : hasManifestation
cc_Manifestation --> "1" cc_TimeVaryingConcept : manifestationOf
cc_Manifestation --> "0..*" cc_State : hasState
cc_Manifestation --> "0..1" xsd_dateTime : manifestedAtTime
```

## How this connects to situations

The situations module defines:

- `ccsit:EffectSituation` (Activity → outcome Entity)
- `ccsit:EnablementSituation` (enabling Entity → Activity)

In practice, the “outcome/enabling Entity” is often a `cc:Manifestation`.

## SPARQL: list manifestations and their states

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>

SELECT ?m ?tvc ?state ?t
WHERE {
  ?m a cc:Manifestation ;
     cc:manifestationOf ?tvc .
  OPTIONAL { ?m cc:hasState ?state }
  OPTIONAL { ?m cc:manifestedAtTime ?t }
}
ORDER BY ?tvc ?t ?m
LIMIT 200
```

## SPARQL: terminal vs non-terminal state categories used

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>

SELECT ?stateClass (COUNT(?state) AS ?count)
WHERE {
  ?m a cc:Manifestation ;
     cc:hasState ?state .
  ?state a ?stateClass .
  FILTER(?stateClass IN (cc:TerminalState, cc:NonTerminalState, cc:ConjunctiveState))
}
GROUP BY ?stateClass
ORDER BY DESC(?count)
```

