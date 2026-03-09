# Global classifications (C-Box)

Sources:

- `ontology/cbox/traditions.ttl`
- `ontology/cbox/theology.ttl`
- `ontology/cbox/initiative-types.ttl`
- `ontology/cbox/denominations.ttl` (starter typed individuals)
- `ontology/cbox/people-group-status.ttl`
- `ontology/cbox/organization-service-categories.ttl`
- `ontology/cbox/partnership-types.ttl`
- `ontology/cbox/ecosystem-relationship-types.ttl`

This package intentionally keeps **Big‑C** category vocabularies here, rather than in the ChurchCore upper layer.

## SPARQL: list concepts in the tradition scheme

```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?concept ?label ?broader
WHERE {
  ?concept a skos:Concept ;
           skos:inScheme <https://ontology.churchcore.ai/cc/global/class#FaithTraditionScheme> .
  OPTIONAL { ?concept skos:prefLabel ?label }
  OPTIONAL { ?concept skos:broader ?broader }
}
ORDER BY ?label
LIMIT 200
```

