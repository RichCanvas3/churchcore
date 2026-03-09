# SPARQL queries (ChurchCore-Global)

These queries assume instance data is loaded into a named graph like:

- `https://churchcore.ai/graph/d1/<churchId>`

## List global categories used by a congregation

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>
PREFIX ccglobal: <https://ontology.churchcore.ai/cc/global#>

SELECT ?org ?orgName (COUNT(DISTINCT ?pg) AS ?peopleGroupsPrayedFor)
WHERE {
  GRAPH <https://churchcore.ai/graph/d1/example> {
    ?org a cc:Church .
    OPTIONAL { ?org cc:name ?orgName }
    OPTIONAL { ?org ccglobal:praysForPeopleGroup ?pg }
  }
}
GROUP BY ?org ?orgName
LIMIT 50
```

