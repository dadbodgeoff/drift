# Outlier Detection

## Location
`packages/core/src/matcher/outlier-detector.ts`

## Purpose
Statistical detection of code that deviates from established patterns. Uses Z-score analysis for large samples and IQR (Interquartile Range) for small samples. Also supports custom rule-based detection.

## Files
- `outlier-detector.ts` — `OutlierDetector` class + `detectOutliers()` + `calculateStatistics()` helpers
- `types.ts` — `OutlierInfo`, `OutlierStatistics`, `OutlierDetectionResult`, `OutlierType`, `OutlierSignificance`

---

## Detection Flow

```
1. Receive PatternMatchResult[] for a pattern
2. Convert to DataPoint[] (extract numeric confidence values)
3. Select method based on sample size:
   - n >= 30 → Z-Score
   - n < 30  → IQR
4. Run statistical detection → OutlierInfo[]
5. Run rule-based detection → OutlierInfo[]
6. Merge results, deduplicate
7. Return OutlierDetectionResult
```

---

## Configuration

```typescript
interface OutlierDetectorConfig {
  minSampleSize: number;       // Default: 3 — minimum data points needed
  zScoreThreshold: number;     // Default: 2.0 — Z-score cutoff
  iqrMultiplier: number;       // Default: 1.5 — IQR fence multiplier
  sensitivity: number;         // Default: 0.7 — 0.0 (lenient) to 1.0 (strict)
  enableStatistical: boolean;  // Default: true
  enableRuleBased: boolean;    // Default: true
}
```

### Sensitivity Adjustment
Both Z-score and IQR thresholds are adjusted by sensitivity:
```
adjustedThreshold = baseThreshold × (1 + (1 - sensitivity))
```
- sensitivity=1.0 → threshold unchanged (strictest)
- sensitivity=0.5 → threshold × 1.5 (more lenient)
- sensitivity=0.0 → threshold × 2.0 (most lenient)

---

## Method 1: Z-Score Detection (n >= 30)

For each data point:
```
zScore = (value - mean) / standardDeviation
adjustedThreshold = zScoreThreshold × (1 + (1 - sensitivity))

if |zScore| > adjustedThreshold → outlier
```

### Significance Classification (by |zScore|)
| |zScore| | Significance |
|----------|-------------|
| > 3.0 | high |
| > 2.5 | medium |
| > 2.0 | low |

### Outlier Reason
- `zScore < 0` → "Low confidence outlier"
- `zScore > 0` → "High confidence outlier"

### Deviation Score
```
deviationScore = min(1.0, (|zScore| - threshold) / threshold)
```
Normalized to [0.0, 1.0] — how far beyond the threshold.

---

## Method 2: IQR Detection (n < 30)

```
Q1 = 25th percentile
Q3 = 75th percentile
IQR = Q3 - Q1
adjustedMultiplier = iqrMultiplier × (1 + (1 - sensitivity))

lowerBound = Q1 - adjustedMultiplier × IQR
upperBound = Q3 + adjustedMultiplier × IQR

if value < lowerBound OR value > upperBound → outlier
```

### Significance Classification (by normalized distance from bound)
```
normalizedDistance = distanceFromBound / IQR
```
| normalizedDistance | Significance |
|-------------------|-------------|
| > 3.0 | high |
| > 2.0 | medium |
| > 1.0 | low |

### Outlier Reason
- `value < lowerBound` → "Value below IQR lower bound"
- `value > upperBound` → "Value above IQR upper bound"

### Deviation Score
```
deviationScore = clamp(normalizedDistance / 3, 0, 1)
```

---

## Method 3: Rule-Based Detection

Custom rules registered with the detector:

```typescript
interface OutlierRule {
  id: string;
  name: string;
  description: string;
  check: (match: PatternMatchResult) => boolean;  // Returns true if outlier
  reason: string;
  significance: OutlierSignificance;
}
```

### Default Rules
Registered automatically on construction. Custom rules can be added/removed:
```typescript
registerRule(rule: OutlierRule): void
unregisterRule(ruleId: string): boolean
getRules(): OutlierRule[]
```

---

## OutlierInfo (output)

```typescript
interface OutlierInfo {
  location: Location;
  patternId: string;
  reason: string;                    // Human-readable explanation
  deviationScore: number;           // 0.0-1.0 — severity of deviation
  deviationType: OutlierType;
  expected?: string;
  actual?: string;
  suggestedFix?: string;
  significance: OutlierSignificance; // "high" | "medium" | "low"
  context?: OutlierContext;
}
```

### OutlierType
```typescript
type OutlierType =
  | 'structural'      // File organization, naming
  | 'syntactic'       // Code structure
  | 'semantic'        // Meaning/behavior
  | 'stylistic'       // Formatting, conventions
  | 'missing'         // Missing expected element
  | 'extra'           // Extra unexpected element
  | 'inconsistent';   // Inconsistent with other occurrences
```

### Outlier Type Determination
Based on the pattern match and Z-score direction:
- Negative Z-score (below mean) → typically `inconsistent` or `missing`
- Positive Z-score (above mean) → typically `extra` or `stylistic`
- Specific logic varies by match type (AST, regex, structural)

---

## OutlierDetectionResult

```typescript
interface OutlierDetectionResult {
  patternId: string;
  file?: string;
  outliers: OutlierInfo[];
  totalAnalyzed: number;
  outlierRate: number;              // outliers / total
  timestamp: Date;
  method: "statistical" | "clustering" | "rule-based" | "ml-based";
}
```

---

## OutlierStatistics (per outlier)

```typescript
interface OutlierStatistics {
  mean: number;
  standardDeviation: number;
  zScore: number;
  percentile: number;
  sampleSize: number;
}
```

---

## Helper Functions

### `detectOutliers(matches, patternId, config?)` → `OutlierDetectionResult`
Convenience function that creates an `OutlierDetector` and runs detection.

### `calculateStatistics(values)` → `{ mean, standardDeviation }`
Standalone statistics calculator.

---

## Rust Rebuild Considerations
- Pure math — ideal for Rust
- Z-score and IQR calculations benefit from SIMD for large datasets
- The rule-based system maps to Rust closures or trait objects
- Percentile calculation involves sorting — Rust's `sort_unstable` is fast
- Consider `rayon` for parallel outlier detection across many patterns
- The `DataPoint` conversion from `PatternMatchResult` is a simple map operation
