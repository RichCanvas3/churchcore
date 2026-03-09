# Website → repo crosswalk (concepts → ontology packages)

This page maps the **conceptual model** from the ChurchCore ontology website into the repo’s **formal ontology packages**, and clarifies which foundational model(s) each concept overlaps:

- **PROV-O**: operational occurrences (what happened)
- **p-plan / EP-PLAN**: specifications (plans, steps) + plan/execution correspondence
- **AgenticTrust**: DnS-style situations/roles/participation + trust patterns

It also indicates where concepts belong in the Semantic Arts boxes:

- **T-Box**: schema (classes + properties)
- **C-Box**: controlled vocabularies (SKOS schemes + concepts)
- **A-Box**: instance assertions (kept out of repo; stored per-church in GraphDB named graphs)

## Quick mapping table

| Website concept cluster | Target package | Box | Primary overlap |
|---|---|---|---|
| Organization / org graphs / org-to-org | `churchcore-ontology` (base), + `churchcore-global` / `churchcore-congregation` (specializations) | T-Box + C-Box | PROV-O (agents) + AgenticTrust (relationship situations) |
| Membership | `churchcore-ontology` (pattern), + `churchcore-congregation` (local membership vocabularies) | T-Box + C-Box | AgenticTrust situations + PROV-O (agents) |
| Activities (“doing of things”) | `churchcore-ontology` | T-Box | PROV-O activities |
| Activity Role (“way things are done”) | `churchcore-ontology` | T-Box | p-plan/EP-PLAN steps |
| Participation / roles | `churchcore-ontology` | T-Box (+ C-Box for role types) | AgenticTrust participation + PROV-O association hooks |
| Faith journey (graph + per-person state) | `churchcore-ontology` (schema), + C-Box for stage/state types | T-Box + C-Box | PROV-O (events/activities) + situation/state modeling |
| State-Based Behavioristics (State/Manifestation/TimeVaryingConcept) | `churchcore-ontology` | T-Box (+ C-Box for reusable state categories) | iCity-style pattern + PROV-O entities + situation bridge |
| Process Role / Process | `churchcore-ontology` | T-Box | p-plan/EP-PLAN (role/spec) + PROV-O bundles (process/exec) |
| Intent / inferred intent / purpose / mission / goals / beliefs | `churchcore-ontology` | T-Box + C-Box | PROV provenance for inference + plan/spec linkage |
| Audience / segmentation | `churchcore-global` (macro), `churchcore-congregation` (local targeting) | T-Box + C-Box | classification-heavy; links to org/activity/situations |
| Situation taxonomy (membership/relationship/participation/usage/effect/enablement/…) | `churchcore-ontology` | T-Box | AgenticTrust situations + PROV relation motifs |

## Where each layer fits

### ChurchCore Upper (`packages/churchcore-ontology`)

This is the **shared grammar** used everywhere.

- **T-Box**:
  - `cc:Activity` (execution) and `cc:ActivityRole` (specification)
  - `ccsit:*Situation` (reified contexts with optional validity bounds)
  - journey graph vs per-person journey state/events
  - provenance hooks for derived/inferred statements
- **C-Box**:
  - reusable categories (roles, statuses, node/edge/event types, strategic intent types, etc.)

### ChurchCore-Global (`packages/churchcore-global`)

“Big-C ecosystem” extensions: denominations, mission agencies, initiatives, movements, people groups, benchmarking/measurement, etc.

- Prefer **C-Box** schemes for:
  - initiative types, partnership types, people group status, traditions/theology, flourishing dimensions
- Prefer **T-Box** for:
  - reusable schema needed across the ecosystem (e.g., measurements, assessments, audience segments)

### ChurchCore-Congregation (`packages/churchcore-congregation`)

“Local-C operations” extensions: ministries, facilities, rooms, services, local small groups, check-in/attendance statuses, etc.

- Prefer **C-Box** schemes for:
  - service types, ministry categories, attendance statuses, audience segments (local targeting)
- Prefer **T-Box** for:
  - local operational schema (small groups, facilities, rooms, ministry)

## “Which model am I using?” (overlap map)

### PROV-O (operations)

- **Activities**: the executed “doing of things”.
- **Entities**: operational artifacts, measurements, and (in our state model) manifestations/snapshots.
- **Agents**: people and organizations as actors.

### p-plan / EP-PLAN (specification + correspondence)

- **Steps / variables**: reusable *roles/specifications* for how activities are done.
- **Correspondence**: connect an executed `cc:Activity` to its `cc:ActivityRole`.

### AgenticTrust (situations/roles/participation)

- **Situations are first-class entities**: membership, relationship, participation, etc.
- **Roles**: attach role semantics in a context (DnS-style).

## Notes on “website terms vs repo terms”

- The repo keeps a smaller set of stable **upper patterns** (spec/exec, situations, journey, provenance) and then builds richness primarily by:
  - adding new situation subtypes and connecting properties (T-Box),
  - adding more controlled vocabularies (C-Box).
- The website’s terminology is treated as a **design backlog**; the repo mints ChurchCore terms only where the existing stack (PROV-O, p-plan/EP-PLAN, AgenticTrust) doesn’t already cover the needed semantics cleanly.

