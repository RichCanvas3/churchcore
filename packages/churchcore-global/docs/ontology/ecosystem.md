# Ecosystem (cc/global) — denominations, agencies, initiatives

Sources:

- wrapper: `ontology/churchcore-global.ttl` / `ontology/churchcore-global-all.ttl`
- T-Box: `ontology/tbox/ecosystem.ttl`

## Key classes

- `ccglobal:Denomination` ⊑ `cc:Organization`
- `ccglobal:MissionAgency` ⊑ `cc:Organization`
- `ccglobal:GlobalInitiative` ⊑ `cc:Organization`
- `ccglobal:Movement` ⊑ `cc:Organization`
- `ccglobal:Network` ⊑ `cc:Organization`
- `ccglobal:PeopleGroup` ⊑ `cc:Resource`

## Diagram (subset)

```mermaid
classDiagram
direction TB

class cc_Organization["cc:Organization"]
class cc_Resource["cc:Resource"]

class ccglobal_Denomination["ccglobal:Denomination"]
class ccglobal_MissionAgency["ccglobal:MissionAgency"]
class ccglobal_GlobalInitiative["ccglobal:GlobalInitiative"]
class ccglobal_PeopleGroup["ccglobal:PeopleGroup"]

cc_Organization <|-- ccglobal_Denomination
cc_Organization <|-- ccglobal_MissionAgency
cc_Organization <|-- ccglobal_GlobalInitiative
cc_Resource <|-- ccglobal_PeopleGroup
```

