# AgenticTrust Ontology (deprecated)

This file is kept for backward links. Use `docs/ontology/README.md` instead.

This package vendors the AgenticTrust ontology used by ChurchCore as the **upper-most layer**. ChurchCore imports:

- `https://agentictrust.io/ontology/core`
- `https://agentictrust.io/ontology/core/trust`

ChurchCore primarily relies on the **trust-layer DnS-style primitives** (Situation / Role / Participation) to model membership + relationship contexts as *Entities* (not events).

## Namespaces

- `at:` → `https://agentictrust.io/ontology/core#`
- `prov:` → `http://www.w3.org/ns/prov#`
- `p-plan:` → `http://purl.org/net/p-plan#`

## Core modeling pattern: Situation + Participation + Role

From `core/trust`:

- **`at:Situation`**: a reified context (PROV Entity) in which agents participate and roles are meaningful.
- **`at:Role`**: a role (PROV Entity, `p-plan:Role`) used to qualify participation in a situation.
- **`at:SituationParticipation`**: reified link from a situation to an agent, qualified by a role.

Key properties:

- **`at:qualifiedSituationParticipation`**: `at:Situation → at:SituationParticipation`
- **`at:situationParticipant`**: `at:SituationParticipation → prov:Agent`
- **`at:situationParticipantRole`**: `at:SituationParticipation → at:Role`
- **`at:isAboutAgent`**: convenience “aboutness” link: `at:Situation → prov:Agent`

## Class inheritance diagram (subset used by ChurchCore)

```mermaid
classDiagram
direction TB

class prov_Entity["prov:Entity"]
class prov_Activity["prov:Activity"]
class prov_Agent["prov:Agent"]
class prov_Plan["prov:Plan"]

class at_Situation["at:Situation"]
class at_SituationDescription["at:SituationDescription"]
class at_Role["at:Role"]
class at_SituationParticipation["at:SituationParticipation"]

prov_Entity <|-- at_Situation
prov_Plan <|-- at_SituationDescription
prov_Entity <|-- at_Role
prov_Entity <|-- at_SituationParticipation

class at_RelationshipSituation["at:RelationshipSituation"]
at_Situation <|-- at_RelationshipSituation

at_Situation "1" --> "0..*" at_SituationParticipation : at:qualifiedSituationParticipation
at_SituationParticipation --> prov_Agent : at:situationParticipant
at_SituationParticipation --> at_Role : at:situationParticipantRole
at_Situation --> prov_Agent : at:isAboutAgent
```

## How ChurchCore uses this

- **Group membership** is modeled as a ChurchCore specialization of `at:Situation` (`ccsit:MembershipSituation`), with convenience links plus (optionally) role-qualified participation.
- **Relationships** (guardian/spouse/etc.) are modeled as `ccsit:RelationshipSituation` which is also an `at:RelationshipSituation`.

## Example SPARQL queries (AgenticTrust pattern)

### List participation triples for a situation

```sparql
PREFIX at: <https://agentictrust.io/ontology/core#>

SELECT ?situation ?participant ?role
WHERE {
  ?situation at:qualifiedSituationParticipation ?p .
  ?p at:situationParticipant ?participant .
  OPTIONAL { ?p at:situationParticipantRole ?role }
}
LIMIT 100
```

### Find situations “about” a given agent

```sparql
PREFIX at: <https://agentictrust.io/ontology/core#>

SELECT ?situation
WHERE {
  ?situation at:isAboutAgent <https://id.churchcore.ai/person/p_demo_01> .
}
LIMIT 200
```

