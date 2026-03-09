# Relationships, roles, participation (pattern)

AgenticTrust provides a **DnS-style** participation pattern via:

- `at:Situation` (the context)
- `at:SituationParticipation` (reified participation node)
- `at:Role` (qualifier)

ChurchCore reuses this for:

- group membership (membership situation)
- relationships (relationship situation)

## Diagram

```mermaid
classDiagram
direction LR

class at_Situation["at:Situation"]
class at_SituationParticipation["at:SituationParticipation"]
class prov_Agent["prov:Agent"]
class at_Role["at:Role"]

at_Situation --> at_SituationParticipation : at:qualifiedSituationParticipation
at_SituationParticipation --> prov_Agent : at:situationParticipant
at_SituationParticipation --> at_Role : at:situationParticipantRole
at_Situation --> prov_Agent : at:hasSituationParticipant
```

## SPARQL: one row per (situation, participant, role)

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

