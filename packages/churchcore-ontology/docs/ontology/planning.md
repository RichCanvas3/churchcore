# Planning (cc/plan) — as-planned vs as-executed

Sources:

- wrapper: `ontology/churchcore-upper-planning.ttl`
- T-Box: `ontology/tbox/plan.ttl`

ChurchCore aligns:

- `ccplan:Plan` with `p-plan:Plan` and `ep-plan:Plan`
- `cc:ActivityRole` with `p-plan:Step` and `ep-plan:Step`
- `cc:Activity` with `prov:Activity` and `ep-plan:Activity`

## Diagram: plan/execution correspondence

```mermaid
classDiagram
direction LR

class pplan_Plan["p-plan:Plan"]
class ccplan_Plan["ccplan:Plan"]
class cc_ActivityRole["cc:ActivityRole"]
class cc_Activity["cc:Activity"]

pplan_Plan <|-- ccplan_Plan
ccplan_Plan --> cc_ActivityRole : ccplan:hasPlannedStep
cc_Activity --> cc_ActivityRole : cc:correspondsToRole
```

## Practical query idea

You can model a church workflow as:

- a durable plan (what should happen)
- step roles (the “way things are done”)
- executed activities linked back to those roles

Then query “what’s missing” by finding planned steps with no corresponding executed activity in a time window.

