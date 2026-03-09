# ChurchCore Upper Ontology (deprecated)

This file is kept for backward links. Use `docs/ontology/README.md` instead.

This package defines the **ChurchCore upper ontology** (church-agnostic), aligned with:

- **PROV-O**: as-executed activities/entities/agents
- **P-Plan / EP-PLAN**: as-planned steps/variables, and correspondence between plan and execution
- **AgenticTrust**: DnS-style situations (membership, relationship) as reified contexts

## Namespaces

- `cc:` → `https://ontology.churchcore.ai/cc#`
- `ccplan:` → `https://ontology.churchcore.ai/cc/plan#`
- `ccsit:` → `https://ontology.churchcore.ai/cc/situation#`
- `cccomm:` → `https://ontology.churchcore.ai/cc/community#`
- `ccjourney:` → `https://ontology.churchcore.ai/cc/journey#`
- `ccprov:` → `https://ontology.churchcore.ai/cc/prov#`
- `prov:` → `http://www.w3.org/ns/prov#`
- `p-plan:` → `http://purl.org/net/p-plan#`
- `ep-plan:` → `https://w3id.org/ep-plan#`
- `at:` → `https://agentictrust.io/ontology/core#`

## Core classes (current)

From `churchcore-upper-core.ttl`:

- `cc:Person` ⊑ `prov:Person`
- `cc:Organization` ⊑ `prov:Organization`, `at:Organization`
  - `cc:Church` ⊑ `cc:Organization`
  - `cc:Campus` ⊑ `cc:Organization`
- `cc:Resource` ⊑ `prov:Entity`
- `cc:Activity` ⊑ `prov:Activity`, `ep-plan:Activity`
- `cc:ActivityRole` ⊑ `p-plan:Step`, `ep-plan:Step`

Key properties:

- `cc:correspondsToRole` (`cc:Activity → cc:ActivityRole`) ⊑ `ep-plan:correspondsToStep`
- `cc:name` (datatype string)
- `cc:description` (datatype string)

## Community modeling (groups + membership)

From `churchcore-upper-situations.ttl` + `churchcore-upper-community.ttl`:

- `ccsit:ChurchSituation` ⊑ `at:Situation`
  - `ccsit:MembershipSituation` ⊑ `ccsit:ChurchSituation`
  - `ccsit:RelationshipSituation` ⊑ `ccsit:ChurchSituation`, `at:RelationshipSituation`
- `cccomm:Group` ⊑ `cc:Organization`
- `cccomm:GroupMembershipSituation` ⊑ `ccsit:MembershipSituation`
  - convenience links:
    - `cccomm:membershipPerson` (`GroupMembershipSituation → cc:Person`) ⊑ `at:isAboutAgent`
    - `cccomm:membershipGroup` (`GroupMembershipSituation → cccomm:Group`) ⊑ `at:isAboutAgent`
    - `cccomm:membershipStatus` (string)

## Discipleship / journey modeling (canonical + per-person)

From `churchcore-upper-discipleship.ttl` (wrapper) + `ontology/tbox/journey.ttl` (T-Box):

- `ccjourney:JourneyGraph` ⊑ `cc:Resource`
- `ccjourney:JourneyNode` ⊑ `cc:Resource`
- `ccjourney:JourneyEdge` ⊑ `cc:Resource`
  - `ccjourney:fromNode`, `ccjourney:toNode`
  - `ccjourney:edgeKind` (string)
- `ccjourney:PersonJourneyState` ⊑ `cc:Resource`
  - `ccjourney:forPerson`, `ccjourney:currentNode`, `ccjourney:updatedAt`
- `ccjourney:PersonJourneyEvent` ⊑ `prov:Activity`
- `ccjourney:hasReferenceSet` (`JourneyNode → cc:Resource`)

## Class inheritance + relationship diagrams (subset)

```mermaid
classDiagram
direction TB

class prov_Agent["prov:Agent"]
class prov_Person["prov:Person"]
class prov_Organization["prov:Organization"]
class prov_Entity["prov:Entity"]
class prov_Activity["prov:Activity"]

class cc_Person["cc:Person"]
class cc_Organization["cc:Organization"]
class cc_Church["cc:Church"]
class cc_Campus["cc:Campus"]
class cc_Resource["cc:Resource"]
class cc_Activity["cc:Activity"]
class cc_ActivityRole["cc:ActivityRole"]

prov_Person <|-- cc_Person
prov_Organization <|-- cc_Organization
cc_Organization <|-- cc_Church
cc_Organization <|-- cc_Campus
prov_Entity <|-- cc_Resource
prov_Activity <|-- cc_Activity

cc_Activity --> cc_ActivityRole : cc:correspondsToRole
```

```mermaid
classDiagram
direction TB

class at_Situation["at:Situation"]
class ccsit_ChurchSituation["ccsit:ChurchSituation"]
class ccsit_MembershipSituation["ccsit:MembershipSituation"]
class cccomm_GroupMembershipSituation["cccomm:GroupMembershipSituation"]
class cc_Person["cc:Person"]
class cccomm_Group["cccomm:Group"]

at_Situation <|-- ccsit_ChurchSituation
ccsit_ChurchSituation <|-- ccsit_MembershipSituation
ccsit_MembershipSituation <|-- cccomm_GroupMembershipSituation

cccomm_GroupMembershipSituation --> cc_Person : cccomm:membershipPerson
cccomm_GroupMembershipSituation --> cccomm_Group : cccomm:membershipGroup
```

```mermaid
classDiagram
direction LR

class ccjourney_JourneyNode["ccjourney:JourneyNode"]
class ccjourney_JourneyEdge["ccjourney:JourneyEdge"]
class ccjourney_PersonJourneyState["ccjourney:PersonJourneyState"]
class cc_Person["cc:Person"]

ccjourney_JourneyEdge --> ccjourney_JourneyNode : ccjourney:fromNode
ccjourney_JourneyEdge --> ccjourney_JourneyNode : ccjourney:toNode

ccjourney_PersonJourneyState --> cc_Person : ccjourney:forPerson
ccjourney_PersonJourneyState --> ccjourney_JourneyNode : ccjourney:currentNode
```

## Example SPARQL queries (against ChurchCore GraphDB)

These assume you load into a named graph like:

- `https://churchcore.ai/graph/d1/calvarybible`

### One row per person

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>

SELECT ?person ?name
WHERE {
  GRAPH <https://churchcore.ai/graph/d1/calvarybible> {
    ?person a cc:Person ;
            cc:name ?name .
  }
}
ORDER BY LCASE(STR(?name))
```

### People + group memberships (one row per membership)

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>
PREFIX cccomm: <https://ontology.churchcore.ai/cc/community#>

SELECT ?person ?personName ?group ?groupName ?status
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
ORDER BY LCASE(STR(?personName)) LCASE(STR(?groupName))
```

### Journey edges (from → to)

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>
PREFIX ccjourney: <https://ontology.churchcore.ai/cc/journey#>

SELECT ?edge ?from ?fromName ?to ?toName ?edgeType
WHERE {
  GRAPH <https://churchcore.ai/graph/d1/calvarybible> {
    ?edge ccjourney:fromNode ?from ;
          ccjourney:toNode ?to ;
          ccjourney:edgeKind ?edgeType .
    OPTIONAL { ?from cc:name ?fromName }
    OPTIONAL { ?to cc:name ?toName }
  }
}
LIMIT 200
```

## Note on application-exported properties

The Cloudflare D1 → GraphDB sync currently emits some pragmatic properties (e.g. `cc:email`, `cc:phone`, `cc:city`, `cc:region`, `cc:summary`, `cc:fromNode`, `cc:toNode`, `cc:edgeType`) that are not all formalized in the upper ontology yet. Treat those as **application vocabulary** until we promote them into a TTL module.

