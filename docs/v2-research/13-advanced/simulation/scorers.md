# Simulation Scorers

## Location
`packages/core/src/simulation/scorers/`

## Purpose
4 independent scoring dimensions that evaluate each candidate approach. Each scorer returns a 0–100 score plus detailed metrics.

## Files
- `friction-scorer.ts` — `FrictionScorer`: development friction estimation
- `impact-scorer.ts` — `ImpactScorer`: change impact scoring
- `pattern-alignment-scorer.ts` — `PatternAlignmentScorer`: pattern compliance
- `security-scorer.ts` — `SecurityScorer`: security risk assessment
- `index.ts` — Exports + factory functions

---

## Friction Scorer

### Purpose
Estimates how much friction a developer would encounter implementing this approach.

### 5 Friction Factors

| Factor | Weight | What It Measures |
|--------|--------|------------------|
| Code churn | — | Lines added + modified, new files created |
| Pattern deviation | — | How far the approach deviates from established patterns |
| Testing effort | — | Estimated test code needed |
| Refactoring required | — | Existing code that needs restructuring |
| Learning curve | — | Familiarity with the strategy/framework |

### FrictionMetrics
```typescript
interface FrictionMetrics {
  codeChurn: number;           // 0–100
  patternDeviation: number;    // 0–100
  testingEffort: number;       // 0–100
  refactoringRequired: number; // 0–100
  learningCurve: number;       // 0–100
  overallScore: number;        // 0–100 (composite)
  reasoning: string[];         // Per-factor explanations
}
```

### Key Heuristics
- Code churn scales with `estimatedLinesAdded + estimatedLinesModified`
- Pattern deviation checks if the approach's strategy matches existing patterns
- Testing effort estimates based on strategy type (middleware = lower, distributed = higher)
- Refactoring scales with number of existing files modified
- Learning curve considers strategy familiarity (common patterns = lower)

---

## Impact Scorer

### Purpose
Calculates the blast radius of implementing an approach using the call graph.

### With Call Graph
Uses `ImpactAnalyzer` from the call graph module to analyze each target file:
- Traces callers/callees to find affected functions
- Identifies affected entry points (API endpoints)
- Counts sensitive data paths
- Measures max depth of impact propagation

### Without Call Graph
Falls back to estimation based on approach metadata:
- Files affected = target files + new files
- Functions estimated at 3× file count
- Entry points estimated via strategy-specific multipliers

### ImpactMetrics
```typescript
interface ImpactMetrics {
  filesAffected: number;
  functionsAffected: number;
  entryPointsAffected: number;
  sensitiveDataPaths: number;
  riskScore: number;           // 0–100
  riskLevel: RiskLevel;        // 'low' | 'medium' | 'high' | 'critical'
  breakingChanges: boolean;
  breakingChangeRisks: string[];
  maxDepthAffected: number;
}
```

### Risk Score Calculation (0–100)
| Component | Max Points | Thresholds |
|-----------|-----------|------------|
| Files affected | 25 | >20=25, >10=20, >5=15, else files×2 |
| Entry points | 30 | >10=30, >5=25, >2=15, else entries×5 |
| Sensitive data paths | 30 | >5=30, >2=20, >0=10 |
| Strategy risk | 15 | Per-strategy lookup (middleware=5, distributed=12, etc.) |

### Risk Levels
- `low`: score < 25
- `medium`: score 25–49
- `high`: score 50–74
- `critical`: score ≥ 75

### Breaking Change Detection
Flags risks when:
- Entry points are affected
- Sensitive data paths are affected
- Strategy is `per-route` or `per-function` (distributed changes)
- Strategy is `wrapper` (may change signatures)
- Impact depth > 5 levels

---

## Pattern Alignment Scorer

### Purpose
Evaluates how well an approach aligns with established codebase patterns.

### Algorithm
1. Get relevant patterns for the task category from `PatternService`
2. Find aligned patterns (approach strategy matches pattern keywords)
3. Find conflicting patterns (approach contradicts established patterns)
4. Calculate alignment score from aligned vs. conflicting counts
5. Check if approach would create a new pattern or be an outlier

### PatternAlignmentMetrics
```typescript
interface PatternAlignmentMetrics {
  alignmentScore: number;      // 0–100
  alignedPatterns: string[];   // Patterns the approach follows
  conflictingPatterns: string[]; // Patterns the approach violates
  outlierRisk: boolean;        // Would this be an outlier?
  suggestedPatterns: string[]; // Patterns to consider following
}
```

---

## Security Scorer

### Purpose
Assesses security implications of an approach.

### Analysis
1. **Data access implications** — which functions in target files access sensitive data, classified by sensitivity level
2. **Auth implications** — whether the approach affects authentication/authorization flows
3. **Warning generation** — specific security warnings based on strategy + data access + auth impact

### SecurityMetrics
```typescript
interface SecurityMetrics {
  securityRisk: number;        // 0–100
  dataAccessImplications: DataAccessImplication[];
  authImplications: string[];
  warnings: string[];
}
```

### Without Call Graph
Falls back to estimation based on approach metadata (strategy type, target file names, task category).

## Rust Rebuild Considerations
- Impact scorer's call graph traversal is the heaviest computation — benefits most from Rust
- Pattern alignment's pattern matching could use Rust for large pattern sets
- Friction and security scorers are mostly heuristic — lightweight either way
- All scorers are independent — can be parallelized in Rust
