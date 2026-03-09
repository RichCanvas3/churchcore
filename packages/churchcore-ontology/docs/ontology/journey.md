# Journey (cc/journey) — canonical graph + per-person state

Source:

- wrapper: `ontology/churchcore-upper-discipleship.ttl`
- T-Box: `ontology/tbox/journey.ttl`

ChurchCore separates:

- **canonical journey graph**: nodes + edges (“what the church believes the path can look like”)
- **per-person instance**: where a person is now + what happened

## Canonical graph

```mermaid
classDiagram
direction LR

class ccjourney_JourneyNode["ccjourney:JourneyNode"]
class ccjourney_JourneyEdge["ccjourney:JourneyEdge"]

ccjourney_JourneyEdge --> ccjourney_JourneyNode : fromNode
ccjourney_JourneyEdge --> ccjourney_JourneyNode : toNode
```

## Per-person state

```mermaid
classDiagram
direction LR

class ccjourney_PersonJourneyState["ccjourney:PersonJourneyState"]
class cc_Person["cc:Person"]
class ccjourney_JourneyNode["ccjourney:JourneyNode"]

ccjourney_PersonJourneyState --> cc_Person : forPerson
ccjourney_PersonJourneyState --> ccjourney_JourneyNode : currentNode
```

## Mapping journey nodes to state categories

When you want a journey graph to drive state-based reasoning (preconditions/effects, progress, inferred next steps), link `ccjourney:JourneyNode` to `cc:State` categories using:

- `representsState` (JourneyNode → State)

This lets you align:

- **graph**: “where can someone go next?” (nodes/edges)\n+- **state**: “what is true about the person right now?” (manifestations classified by states)

## SPARQL: list journey nodes + their outgoing edges

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>
PREFIX ccjourney: <https://ontology.churchcore.ai/cc/journey#>

SELECT ?from ?fromName ?edge ?to ?toName
WHERE {
  GRAPH <https://churchcore.ai/graph/d1/example> {
    ?edge ccjourney:fromNode ?from ;
          ccjourney:toNode ?to .
    OPTIONAL { ?from cc:name ?fromName }
    OPTIONAL { ?to cc:name ?toName }
  }
}
LIMIT 500
```

