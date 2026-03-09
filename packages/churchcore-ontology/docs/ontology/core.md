# Core (cc) — people, orgs, resources, activities

Sources:

- wrapper: `ontology/churchcore-upper-core.ttl`
- T-Box: `ontology/tbox/core.ttl`

## Key idea: “way things are done” vs “doing the thing”

RichCanvas-style separation:

- **Specification / template**: `cc:ActivityRole` (a Step in a plan)
- **Execution / occurrence**: `cc:Activity` (a PROV Activity)

This is the backbone for “plans vs actuals”, and for connecting church processes to outcomes.

## Class hierarchy (subset)

```mermaid
classDiagram
direction TB

class prov_Person["prov:Person"]
class prov_Organization["prov:Organization"]
class prov_Entity["prov:Entity"]
class prov_Activity["prov:Activity"]
class pplan_Step["p-plan:Step"]
class epplan_Step["ep-plan:Step"]

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
pplan_Step <|-- cc_ActivityRole
epplan_Step <|-- cc_ActivityRole
```

## Core relationships

```mermaid
classDiagram
direction LR

class cc_Activity["cc:Activity"]
class cc_ActivityRole["cc:ActivityRole"]

cc_Activity --> cc_ActivityRole : cc:correspondsToRole
```

## Data-facing properties (currently used by sync/export)

ChurchCore instance export uses (at least):

- `cc:name`
- `cc:description`

The Cloudflare D1→GraphDB sync also emits some application-friendly properties (email/phone/city/region, etc.). Those can be promoted into the ontology once stabilized.

