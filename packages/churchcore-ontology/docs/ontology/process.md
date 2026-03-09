# Process (cc/process) — ProcessRole vs Process

Sources:

- wrapper: `ontology/churchcore-upper-process.ttl`
- T-Box: `ontology/tbox/process.ttl`

This module models the website’s “ProcessRole vs Process” distinction:

- **ProcessRole**: a *specification* (plan-level) bundle of `cc:Step` + required/target `cc:State` categories (a specialized `ccplan:Plan`)
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
class cc_Step["cc:Step"]
class cc_State["cc:State"]
class prov_Activity["prov:Activity"]
class cc_Manifestation["cc:Manifestation"]

ccproc_Process --> ccproc_ProcessRole : correspondsToProcessRole

ccproc_ProcessRole --> cc_Step : hasStep
ccproc_ProcessRole --> cc_State : hasRequiredState
ccproc_ProcessRole --> cc_State : hasTargetState

cc_Step --> cc_State : hasPreconditionState
cc_Step --> cc_State : hasEffectState

ccproc_Process --> prov_Activity : hasActivity
ccproc_Process --> cc_Manifestation : hasManifestation
```

## Step preconditions and effects

`ccproc:hasPreconditionState` and `ccproc:hasEffectState` attach state semantics directly to a specification-side `cc:Step` (mirroring the “precondition/effect of a step-type” concept on the website).

Execution-side, an `cc:Activity` that `cc:correspondsToStep` can make this provenance explicit by linking the input/output manifestations it used/generated:

- `ccproc:usedManifestation` (subproperty of `prov:used`)
- `ccproc:generatedManifestation` (subproperty of `prov:generated`)

## SPARQL: activities that generated manifestations

```sparql
PREFIX ccproc: <https://ontology.churchcore.ai/cc/process#>

SELECT ?activity ?m
WHERE {
  ?activity ccproc:generatedManifestation ?m .
}
ORDER BY ?activity ?m
LIMIT 200
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
