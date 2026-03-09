# Process (cc/process) — ProcessRole vs Process

Sources:

- wrapper: `ontology/churchcore-upper-process.ttl`
- T-Box: `ontology/tbox/process.ttl`

This module models the website’s “ProcessRole vs Process” distinction:

- **ProcessRole**: a *specification* (plan-level) bundle of `cc:ActivityRole` + required/target `cc:State` categories
- **Process**: an *execution* (run-level) bundle of activities and entities (including `cc:Manifestation`)

## Class hierarchy

```mermaid
classDiagram
direction TB

class ccplan_Plan["ccplan:Plan"]
class prov_Bundle["prov:Bundle"]
class ccproc_ProcessRole["ccproc:ProcessRole"]
class ccproc_Process["ccproc:Process"]

ccplan_Plan <|-- ccproc_ProcessRole
prov_Bundle <|-- ccproc_Process
```

## Relationship diagram

```mermaid
classDiagram
direction LR

class ccproc_ProcessRole["ccproc:ProcessRole"]
class ccproc_Process["ccproc:Process"]
class cc_ActivityRole["cc:ActivityRole"]
class cc_State["cc:State"]
class prov_Activity["prov:Activity"]
class cc_Manifestation["cc:Manifestation"]

ccproc_Process --> ccproc_ProcessRole : correspondsToProcessRole

ccproc_ProcessRole --> cc_ActivityRole : hasActivityRole
ccproc_ProcessRole --> cc_State : hasRequiredState
ccproc_ProcessRole --> cc_State : hasTargetState

ccproc_Process --> prov_Activity : hasActivity
ccproc_Process --> cc_Manifestation : hasManifestation
```

## SPARQL: list processes and their roles

```sparql
PREFIX ccproc: <https://ontology.churchcore.ai/cc/process#>

SELECT ?process ?role
WHERE {
  ?process a ccproc:Process .
  OPTIONAL { ?process ccproc:correspondsToProcessRole ?role }
}
ORDER BY ?process
LIMIT 200
```

## SPARQL: what states are required/targeted by a process role?

```sparql
PREFIX ccproc: <https://ontology.churchcore.ai/cc/process#>

SELECT ?role ?required ?target
WHERE {
  ?role a ccproc:ProcessRole .
  OPTIONAL { ?role ccproc:hasRequiredState ?required }
  OPTIONAL { ?role ccproc:hasTargetState ?target }
}
ORDER BY ?role ?required ?target
LIMIT 200
```

# Process (cc/process) — ProcessRole vs Process

Sources:

- wrapper: `ontology/churchcore-upper-process.ttl`
- T-Box: `ontology/tbox/process.ttl`

This module extends the repo’s “specification vs execution” pattern to the **process** level:

- **ProcessRole**: specification (plan) that bundles steps (`cc:ActivityRole`) and relevant state categories
- **Process**: execution (bundle/run) that groups activities and produced/used entities (including manifestations)

## Class hierarchy

```mermaid
classDiagram
direction TB

class ccplan_Plan["ccplan:Plan"]
class ccproc_ProcessRole["ccproc:ProcessRole"]
class prov_Bundle["prov:Bundle"]
class ccproc_Process["ccproc:Process"]

ccplan_Plan <|-- ccproc_ProcessRole
prov_Bundle <|-- ccproc_Process
```

## Relationship diagram

```mermaid
classDiagram
direction LR

class ccproc_ProcessRole["ccproc:ProcessRole"]
class cc_ActivityRole["cc:ActivityRole"]
class cc_State["cc:State"]

ccproc_ProcessRole --> "0..*" cc_ActivityRole : hasActivityRole
ccproc_ProcessRole --> "0..*" cc_State : hasRequiredState
ccproc_ProcessRole --> "0..*" cc_State : hasTargetState

class ccproc_Process["ccproc:Process"]
class prov_Activity["prov:Activity"]
class cc_Manifestation["cc:Manifestation"]

ccproc_Process --> "0..1" ccproc_ProcessRole : correspondsToProcessRole
ccproc_Process --> "0..*" prov_Activity : hasActivity
ccproc_Process --> "0..*" cc_Manifestation : hasManifestation
```

## SPARQL: find processes and their process roles

```sparql
PREFIX ccproc: <https://ontology.churchcore.ai/cc/process#>

SELECT ?process ?role
WHERE {
  ?process a ccproc:Process .
  OPTIONAL { ?process ccproc:correspondsToProcessRole ?role }
}
ORDER BY ?process
LIMIT 200
```

## SPARQL: process runs with included activities

```sparql
PREFIX ccproc: <https://ontology.churchcore.ai/cc/process#>

SELECT ?process ?activity
WHERE {
  ?process a ccproc:Process ;
           ccproc:hasActivity ?activity .
}
ORDER BY ?process ?activity
LIMIT 200
```

