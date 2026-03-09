# Provenance (cc/prov) — sources + extraction timestamps

Sources:

- wrapper: `ontology/churchcore-upper-provenance.ttl`
- T-Box: `ontology/tbox/prov.ttl`

This module defines lightweight provenance hooks for ChurchCore resources, aligned to:

- `prov:hadPrimarySource`
- `dcterms:source`
- `prov:generatedAtTime`

## Key properties

- `ccprov:hasSourceEntity` ⊑ `prov:hadPrimarySource`
- `ccprov:sourceUrl` ⊑ `dcterms:source`
- `ccprov:extractedAtTime` ⊑ `prov:generatedAtTime`

## Diagram

```mermaid
classDiagram
direction LR

class cc_Resource["cc:Resource"]
class prov_Entity["prov:Entity"]

cc_Resource --> prov_Entity : hasSourceEntity
cc_Resource --> xsd_anyURI["xsd:anyURI"] : sourceUrl
cc_Resource --> xsd_dateTime["xsd:dateTime"] : extractedAtTime
```

## SPARQL: find resources with a source URL

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>
PREFIX ccprov: <https://ontology.churchcore.ai/cc/prov#>

SELECT ?r ?name ?url
WHERE {
  GRAPH <https://churchcore.ai/graph/d1/example> {
    ?r a cc:Resource .
    OPTIONAL { ?r cc:name ?name }
    ?r ccprov:sourceUrl ?url .
  }
}
LIMIT 200
```

