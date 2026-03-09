# Bible references (cc/global/bible)

Sources:

- T-Box: `ontology/tbox/bible.ttl`

ChurchCore-Global models **reference sets**, not Bible text or translations.

## Key schema

- `ccbible:BibleReferenceSet` ⊑ `cc:Resource`
- `ccbible:reference` (string)
- `ccbible:topic` (string)

## Intended use

- Upper `ccjourney:hasReferenceSet` can link a `ccjourney:JourneyNode` to a `cc:Resource`.
- In Big‑C Christian deployments, use `ccbible:BibleReferenceSet` as one such `cc:Resource`.

