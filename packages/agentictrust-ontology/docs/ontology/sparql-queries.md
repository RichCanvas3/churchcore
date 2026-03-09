# SPARQL queries (re-usable patterns)

These queries are intentionally “shape-based” and meant to work across many graphs.

## Prefixes

```sparql
PREFIX at: <https://agentictrust.io/ontology/core#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
```

## Situations: one row per situation with basic context

```sparql
PREFIX at: <https://agentictrust.io/ontology/core#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT
  ?situation
  (SAMPLE(?type) AS ?type)
  (SAMPLE(?about) AS ?aboutAgent)
  (COUNT(DISTINCT ?participant) AS ?participantCount)
WHERE {
  ?situation a ?type .
  ?type rdfs:subClassOf* at:Situation .
  OPTIONAL { ?situation at:isAboutAgent ?about . }
  OPTIONAL { ?situation at:hasSituationParticipant ?participant . }
}
GROUP BY ?situation
ORDER BY ?type ?situation
LIMIT 200
```

## Participation: one row per (situation, participant)

```sparql
PREFIX at: <https://agentictrust.io/ontology/core#>

SELECT ?situation ?participant (SAMPLE(?role) AS ?role)
WHERE {
  ?situation at:qualifiedSituationParticipation ?p .
  ?p at:situationParticipant ?participant .
  OPTIONAL { ?p at:situationParticipantRole ?role }
}
GROUP BY ?situation ?participant
ORDER BY ?situation ?participant
LIMIT 500
```

