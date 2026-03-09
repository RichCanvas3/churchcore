# Measurement + benchmarking (ecosystem model)

Sources:

- T-Box: `ontology/tbox/measurement.ttl`
- C-Box: `ontology/cbox/flourishing-dimensions.ttl`
- C-Box: `ontology/cbox/congregation-thriving-dimensions.ttl`

This module models **ecosystem measurement** as first-class schema so that:

- organizations can be compared via **cohorts** and **circles**
- assessments can produce **metrics**
- metrics can be interpreted against **dimensions**
- dashboards/reports can be derived without baking product-specific semantics into the upper ontology

## Concept map

```mermaid
classDiagram
direction LR

class cc_Organization["cc:Organization"]
class ccglobal_Circle["ccglobal:Circle"]
class ccglobal_BenchmarkCohort["ccglobal:BenchmarkCohort"]
class ccglobal_AssessmentInstrument["ccglobal:AssessmentInstrument"]
class ccglobal_AssessmentRun["ccglobal:AssessmentRun"]
class ccglobal_Metric["ccglobal:Metric"]
class ccglobal_Dimension["ccglobal:Dimension"]

ccglobal_Circle --> cc_Organization : ccglobal:memberOrganization
cc_Organization --> ccglobal_BenchmarkCohort : ccglobal:inCohort
ccglobal_AssessmentRun --> ccglobal_Metric : ccglobal:producedMetric
ccglobal_Metric --> ccglobal_Dimension : ccglobal:measuresDimension
```

## SPARQL: metrics for a church grouped by dimension

```sparql
PREFIX cc: <https://ontology.churchcore.ai/cc#>
PREFIX ccglobal: <https://ontology.churchcore.ai/cc/global#>

SELECT ?dimension (COUNT(DISTINCT ?metric) AS ?metricCount) (SAMPLE(?score) AS ?sampleScore)
WHERE {
  GRAPH <https://churchcore.ai/graph/d1/calvarybible> {
    ?metric a ccglobal:Metric ;
            ccglobal:measuresDimension ?dimension .
    OPTIONAL { ?metric ccglobal:scoreValue ?score }
  }
}
GROUP BY ?dimension
ORDER BY DESC(?metricCount)
LIMIT 200
```

