# Intent (cc/intent) — explicit + inferred intent

Sources:

- wrapper: `ontology/churchcore-upper-intent.ttl`
- T-Box: `ontology/tbox/intent.ttl`

This module is the missing “intent layer” from the website narrative:

- **Intent as a first-class artifact** (provenance-carrying, attributable)
- **Strategic intent** (purpose/mission/vision/strategy/goals/values/beliefs) typed via C-Box
- **Inferred intent** (evidence + confidence + inference provenance)

## Class hierarchy

```mermaid
classDiagram
direction TB

class prov_Entity["prov:Entity"]
class ccintent_Intent["ccintent:Intent"]
class ccintent_StrategicIntent["ccintent:StrategicIntent"]
class ccintent_Goal["ccintent:Goal"]
class ccintent_Belief["ccintent:Belief"]
class ccintent_InferredIntent["ccintent:InferredIntent"]

prov_Entity <|-- ccintent_Intent
ccintent_Intent <|-- ccintent_StrategicIntent
ccintent_Intent <|-- ccintent_Goal
ccintent_Intent <|-- ccintent_Belief
ccintent_Intent <|-- ccintent_InferredIntent
```

## Relationship diagram (intent → spec/exec + state)

```mermaid
classDiagram
direction LR

class ccintent_Intent["ccintent:Intent"]
class prov_Agent["prov:Agent"]
class ccsit_ChurchSituation["ccsit:ChurchSituation"]
class cc_ActivityRole["cc:ActivityRole"]
class prov_Activity["prov:Activity"]
class cc_State["cc:State"]

ccintent_Intent --> prov_Agent : aboutAgent
ccintent_Intent --> ccsit_ChurchSituation : aboutSituation
ccintent_Intent --> cc_ActivityRole : relatesToActivityRole
ccintent_Intent --> prov_Activity : relatesToActivity
ccintent_Intent --> cc_State : targetsState
```

## How this uses C-Box

The upper C-Box already includes:

- `ccclass:StrategicIntentTypeScheme` (purpose/mission/vision/…)
- `ccclass:StrategicIntentLinkTypeScheme` (supports/drives/implements/measures)

`ccintent:StrategicIntent` instances should be categorized using these schemes via:

- `ccintent:hasStrategicIntentType`
- (optionally) reified linking with `ccintent:hasIntentLinkType`

## SPARQL: list inferred intents with confidence + evidence

```sparql
PREFIX ccintent: <https://ontology.churchcore.ai/cc/intent#>

SELECT ?intent ?confidence ?e ?a
WHERE {
  ?intent a ccintent:InferredIntent .
  OPTIONAL { ?intent ccintent:confidence ?confidence }
  OPTIONAL { ?intent ccintent:inferredFromEntity ?e }
  OPTIONAL { ?intent ccintent:inferredFromActivity ?a }
}
ORDER BY DESC(?confidence) ?intent
LIMIT 200
```

## SPARQL: intents targeting a state category

```sparql
PREFIX ccintent: <https://ontology.churchcore.ai/cc/intent#>
PREFIX cc: <https://ontology.churchcore.ai/cc#>

SELECT ?intent ?state
WHERE {
  ?intent a ccintent:Intent ;
          ccintent:targetsState ?state .
  ?state a cc:State .
}
ORDER BY ?intent
LIMIT 200
```

