# Audience (congregation) — local targeting segments

Sources:

- T-Box: `ontology/tbox/audience.ttl`
- C-Box: `ontology/cbox/audience-segments.ttl`

This module provides **congregation-local audience segmentation** for:

- ministry/program targeting
- local communications
- filtering and routing (e.g., “new here” vs “volunteers”)

## Diagram

```mermaid
classDiagram
direction LR

class prov_Entity["prov:Entity"]
class cccong_AudienceSegment["cccong:AudienceSegment"]

prov_Entity --> "0..*" cccong_AudienceSegment : cccong:hasAudienceSegment
```

## SPARQL: list all congregation audience segments

```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX cccongclass: <https://ontology.churchcore.ai/cc/congregation/class#>

SELECT ?segment ?label ?notation
WHERE {
  ?segment a skos:Concept ;
           skos:inScheme cccongclass:AudienceSegmentScheme .
  OPTIONAL { ?segment skos:prefLabel ?label }
  OPTIONAL { ?segment skos:notation ?notation }
}
ORDER BY ?notation
LIMIT 500
```

## SPARQL: find local ops entities tagged to a segment

```sparql
PREFIX cccong: <https://ontology.churchcore.ai/cc/congregation#>
PREFIX cccongclass: <https://ontology.churchcore.ai/cc/congregation/class#>

SELECT ?entity
WHERE {
  ?entity cccong:hasAudienceSegment cccongclass:audience_new_here .
}
ORDER BY ?entity
LIMIT 200
```

