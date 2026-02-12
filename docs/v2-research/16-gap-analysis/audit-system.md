# Audit System

## Location
`packages/core/src/audit/`

## What It Does
Pattern validation, deduplication detection, cross-validation, health scoring, and degradation tracking. This is the feedback loop that tells users "your codebase is drifting."

## Architecture

### AuditEngine (`audit-engine.ts`)
Core engine that runs full audits on discovered patterns.

**Audit pipeline:**
1. Filter patterns by category (optional)
2. Detect duplicates (location overlap analysis)
3. Cross-validate patterns (call graph, constraints, test coverage)
4. Generate per-pattern recommendations
5. Calculate health score
6. Build summary

### Duplicate Detection
Uses Jaccard similarity on file:line location sets.

```
similarity = |intersection(locationsA, locationsB)| / |union(locationsA, locationsB)|
```

- Threshold: 0.85 (configurable)
- Only compares patterns in the same category
- Recommendation: `merge` if similarity > 0.9, else `review`

### Cross-Validation
Validates patterns against other data sources:
- **Orphan patterns**: Patterns with no locations
- **High outlier ratio**: Outliers > 50% of total (configurable)
- **Low confidence approved**: Approved patterns with confidence < 0.5
- Constraint alignment score: 1 - (issue_count / total_patterns)

### Recommendation Engine
Per-pattern recommendations based on:

| Recommendation | Criteria |
|---|---|
| `auto-approve` | confidence >= 0.90 AND outlierRatio <= 0.50 AND locations >= 3 AND no error-level issues |
| `review` | confidence >= 0.70 (but doesn't meet auto-approve) |
| `likely-false-positive` | confidence < 0.70 OR outlierRatio > 0.50 |

Duplicate group membership downgrades `auto-approve` to `review`.

### Health Score
Weighted combination (0-100):

```
score = (avgConfidence × 0.30 + approvalRatio × 0.20 + complianceRate × 0.20 + crossValidationRate × 0.15 + duplicateFreeRate × 0.15) × 100
```

- **avgConfidence**: Average pattern confidence
- **approvalRatio**: approved / total patterns
- **complianceRate**: locations / (locations + outliers)
- **crossValidationRate**: patterns in call graph / total
- **duplicateFreeRate**: 1 - (patterns in duplicate groups / total)

### AuditStore (`audit-store.ts`)
Persistence and degradation tracking.

**Storage structure:**
```
.drift/audit/
├── latest.json           # Current audit state
├── snapshots/            # Historical audits (30-day retention)
│   └── YYYY-MM-DD.json
└── degradation.json      # Quality trends
```

### Degradation Tracking
Compares audits over time to detect quality regression.

**Alerts:**
| Alert | Warning Threshold | Critical Threshold |
|---|---|---|
| Health drop | -5 points | -15 points |
| Confidence drop | -5% | -15% |
| New false positives | > 5 | > 10 |
| Duplicate increase | > 3 groups | — |

**Trends (7-day rolling average vs previous 7 days):**
- Health trend: improving / stable / declining (±2 point threshold)
- Confidence trend: improving / stable / declining (±2% threshold)
- Pattern growth: healthy / rapid (>5/day) / stagnant (<0.5/day)

**History retention:** 90 days of daily entries.

## Configuration
```typescript
{
  autoApproveThreshold: 0.90,           // Confidence for auto-approval
  reviewThreshold: 0.70,                // Confidence for review
  duplicateSimilarityThreshold: 0.85,   // Jaccard similarity for duplicates
  minLocationsForEstablished: 3,        // Min locations for established pattern
  maxOutlierRatio: 0.5,                 // Max outlier ratio before flagging
}
```

## v2 Notes
- The health score formula and weights are tuned — preserve exactly.
- Degradation tracking is the "drift detection" feature — core value prop.
- Duplicate detection should move to Rust for large pattern sets.
- The 90-day history with 7-day rolling averages is a good design — keep it.
