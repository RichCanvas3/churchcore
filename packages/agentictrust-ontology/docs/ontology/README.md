# AgenticTrust ontology docs (vendored)

These docs are **ChurchCore-oriented** notes for the AgenticTrust ontology that we vendor in this repo.

The canonical documentation set (the “gold standard” template we’re following) lives here:

- `https://github.com/agentictrustlabs/agent-explorer/tree/main/docs/ontology`

## Quick navigation

- `situation.md`: why Situation is a `prov:Entity` (not an event) + assertion/attestation patterns
- `relationships-roles-participation.md`: participation + roles model used by ChurchCore situations
- `sparql-queries.md`: query patterns you’ll re-use against GraphDB

## Why this matters for ChurchCore

ChurchCore models “being in a context” (membership, relationship, participation) as a **reified Situation**:

- The Situation is a durable **Entity** you can cite and link to.
- Activities (assertion/attestation) generate/update those Entities, providing provenance.

This keeps “what is true / what is claimed” separate from “the act of claiming / recording”.

