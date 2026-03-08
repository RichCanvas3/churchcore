# Packages

Workspace packages used by ChurchCore apps.

- `agentictrust-ontology`: downloads + bundles the AgenticTrust upper ontology (Turtle TTL) used as-is.
- `churchcore-ontology`: ChurchCore upper ontology (new), based on RichCanvas ChurchCore Ontology principles.
- `churchcore-local-ontology`: local/lower ontology for a specific church (Calvary seed first), extending ChurchCore.
- `churchcore-graphdb-client`: GraphDB (Ontotext) HTTP client utilities (SPARQL query/update + uploads).
- `churchcore-kb-sync`: one-time D1(SQLite) → GraphDB loader (full rebuild).

