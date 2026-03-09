# SPARQL queries (ChurchCore-Congregation)

These queries assume instance data is loaded into a named graph like:

- `https://churchcore.ai/graph/d1/<churchId>`

## List small groups (one row per group)

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>
PREFIX cccomm: <https://ontology.churchcore.ai/cc/community#>
PREFIX cccong: <https://ontology.churchcore.ai/cc/congregation#>

SELECT ?group (SAMPLE(?name) AS ?name)
WHERE {
  GRAPH <https://churchcore.ai/graph/d1/calvarybible> {
    ?group a cccomm:Group, cccong:SmallGroup .
    OPTIONAL { ?group cc:name ?name }
  }
}
GROUP BY ?group
ORDER BY LCASE(STR(SAMPLE(?name)))
LIMIT 500
```

