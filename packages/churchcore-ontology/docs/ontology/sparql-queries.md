# SPARQL queries (ChurchCore)

These queries assume instance data is loaded into a named graph like:

- `https://churchcore.ai/graph/d1/calvarybible`

## Prefixes

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>
PREFIX cccomm: <https://ontology.churchcore.ai/cc/community#>
PREFIX ccsit: <https://ontology.churchcore.ai/cc/situation#>
PREFIX ccprov: <https://ontology.churchcore.ai/cc/prov#>
PREFIX at: <https://agentictrust.io/ontology/core#>
```

## One row per person

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>

SELECT ?person (SAMPLE(?name) AS ?name)
WHERE {
  GRAPH <https://churchcore.ai/graph/d1/calvarybible> {
    ?person a cc:Person .
    OPTIONAL { ?person cc:name ?name }
  }
}
GROUP BY ?person
ORDER BY LCASE(STR(SAMPLE(?name)))
LIMIT 500
```

## One row per group membership

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>
PREFIX cccomm: <https://ontology.churchcore.ai/cc/community#>

SELECT ?person ?personName ?group ?groupName (SAMPLE(?status) AS ?status)
WHERE {
  GRAPH <https://churchcore.ai/graph/d1/calvarybible> {
    ?m a cccomm:GroupMembershipSituation ;
       cccomm:membershipPerson ?person ;
       cccomm:membershipGroup ?group .
    OPTIONAL { ?m cccomm:membershipStatus ?status }
    OPTIONAL { ?person cc:name ?personName }
    OPTIONAL { ?group cc:name ?groupName }
  }
}
GROUP BY ?person ?personName ?group ?groupName
ORDER BY LCASE(STR(?personName)) LCASE(STR(?groupName))
LIMIT 1000
```

## One row per situation (any subtype of at:Situation)

```sparql
PREFIX at: <https://agentictrust.io/ontology/core#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?s (SAMPLE(?type) AS ?type)
WHERE {
  GRAPH <https://churchcore.ai/graph/d1/calvarybible> {
    ?s a ?type .
    ?type rdfs:subClassOf* at:Situation .
  }
}
GROUP BY ?s
ORDER BY ?type ?s
LIMIT 500
```

