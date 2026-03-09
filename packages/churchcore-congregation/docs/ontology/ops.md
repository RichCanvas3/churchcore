# Ops (cc/congregation) — small groups, ministries, facilities

Sources:

- wrapper: `ontology/churchcore-congregation.ttl` / `ontology/churchcore-congregation-all.ttl`
- T-Box: `ontology/tbox/ops.ttl`
- C-Box: `ontology/cbox/*` (ministry categories, service types, attendance statuses)

## Key classes (current)

- `cccong:SmallGroup` ⊑ `cccomm:Group`
- `cccong:Ministry` ⊑ `cc:Organization`
- `cccong:Facility` ⊑ `cc:Resource`
- `cccong:Room` ⊑ `cc:Resource`

## Diagram (subset)

```mermaid
classDiagram
direction TB

class cccomm_Group["cccomm:Group"]
class cccong_SmallGroup["cccong:SmallGroup"]
class cc_Organization["cc:Organization"]
class cccong_Ministry["cccong:Ministry"]

cccomm_Group <|-- cccong_SmallGroup
cc_Organization <|-- cccong_Ministry
```

## C-Box (starter)

Congregation categories are modeled as **instances** (SKOS Concepts) in the C-Box so they can evolve without changing schema.

Current schemes:

- `cc/congregation/cbox/ministry-categories`
- `cc/congregation/cbox/service-types`
- `cc/congregation/cbox/attendance-statuses`

