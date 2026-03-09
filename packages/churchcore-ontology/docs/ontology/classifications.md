# Classifications (cc/class) — controlled vocabularies (SKOS)

Sources:

- wrapper: `ontology/churchcore-upper-classifications.ttl`
- C-Box: `ontology/cbox/classifications.ttl`

This module is a library of **shared classification schemes** (SKOS ConceptSchemes + Concepts) meant to be used by:

- instance data in GraphDB (linking data to a stable concept)
- D1 enum-like fields (status/type/role)
- knowledge base curation and retrieval filters

## Pattern

- A scheme is a `skos:ConceptScheme`
- Items are `skos:Concept`
- Use `skos:broader` to build hierarchies (e.g., tradition → denomination)

## Query patterns

### List all concept schemes

```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?scheme
WHERE {
  ?scheme a skos:ConceptScheme .
}
ORDER BY ?scheme
LIMIT 500
```

### List concepts in a given scheme

```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?concept ?prefLabel ?broader
WHERE {
  ?concept a skos:Concept ;
           skos:inScheme <https://ontology.churchcore.ai/cc/class#JourneyNodeTypeScheme> .
  OPTIONAL { ?concept skos:prefLabel ?prefLabel }
  OPTIONAL { ?concept skos:broader ?broader }
}
ORDER BY ?prefLabel
LIMIT 500
```

