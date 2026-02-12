# Confidence Scoring

## Location
`packages/core/src/matcher/confidence-scorer.ts`

## Purpose
Calculates a weighted composite confidence score for each pattern based on four factors: frequency, consistency, age, and spread. This is the heart of Drift's learning — it determines how "established" a pattern is.

## Files
- `confidence-scorer.ts` — `ConfidenceScorer` class + `createConfidenceScore()` + `calculateConfidence()` helpers
- `types.ts` — `ConfidenceScore`, `ConfidenceWeights`, `ConfidenceInput`, `ConfidenceLevel`

---

## Algorithm

```
score = frequency × W_f + consistency × W_c + ageFactor × W_a + spread × W_s
```

All factors are normalized to [0.0, 1.0]. The weighted sum is clamped to [0.0, 1.0].

### Default Weights (must sum to 1.0)

```typescript
const DEFAULT_CONFIDENCE_WEIGHTS: ConfidenceWeights = {
  frequency: 0.4,
  consistency: 0.3,
  age: 0.15,
  spread: 0.15,
};
```

> **Note**: The gap analysis doc lists weights as 0.35/0.25/0.15/0.25. The actual code uses 0.4/0.3/0.15/0.15. The code is authoritative.

### Weight Validation
Constructor validates that weights sum to 1.0 (±0.001 tolerance). Throws if invalid.

---

## Factor Calculations

### Factor 1: Frequency
```
frequency = occurrences / totalLocations
```
- How often the pattern appears relative to all applicable locations
- 0 occurrences or 0 total → 0.0
- Clamped to [0.0, 1.0]

### Factor 2: Consistency
```
consistency = 1 - variance
```
- Inverted variance — higher means more uniform implementation
- Negative variance treated as 0 (returns 1.0)
- Variance clamped to [0.0, 1.0] before inversion

### Factor 3: Age Factor
```
if daysSinceFirstSeen <= 0:
  return minAgeFactor (default: 0.1)

if daysSinceFirstSeen >= maxAgeDays (default: 30):
  return 1.0

normalizedAge = daysSinceFirstSeen / maxAgeDays
ageFactor = minAgeFactor + normalizedAge × (1.0 - minAgeFactor)
```
- Linear scaling from `minAgeFactor` (0.1) to 1.0 over `maxAgeDays` (30)
- Brand new patterns start at 0.1
- Patterns older than 30 days get 1.0
- This prevents new patterns from immediately becoming high-confidence

### Factor 4: Spread
```
spread = fileCount / totalFiles
```
- How widely the pattern is used across the codebase
- 0 files or 0 total → 0.0
- Clamped to [0.0, 1.0]

---

## Confidence Levels

```typescript
classifyLevel(score: number): ConfidenceLevel {
  if (score >= 0.85) return 'high';
  if (score >= 0.70) return 'medium';
  if (score >= 0.50) return 'low';
  return 'uncertain';
}
```

| Level | Threshold | Meaning |
|-------|-----------|---------|
| high | >= 0.85 | Well-established pattern, safe to enforce |
| medium | >= 0.70 | Likely pattern, worth flagging |
| low | >= 0.50 | Emerging pattern, informational |
| uncertain | < 0.50 | Not enough evidence yet |

---

## ConfidenceInput

```typescript
interface ConfidenceInput {
  occurrences: number;         // Number of pattern occurrences
  totalLocations: number;      // Total applicable locations
  variance: number;            // Implementation variance (0 = perfectly consistent)
  daysSinceFirstSeen: number;  // Age in days
  fileCount: number;           // Files containing the pattern
  totalFiles: number;          // Total files in scope
}
```

---

## AgeNormalizationConfig

```typescript
interface AgeNormalizationConfig {
  minAgeFactor: number;   // Default: 0.1 — minimum age contribution
  maxAgeDays: number;     // Default: 30 — days to reach full age factor
}
```

---

## Usage

### Class-based
```typescript
const scorer = new ConfidenceScorer(
  { frequency: 0.4, consistency: 0.3, age: 0.15, spread: 0.15 },
  { minAgeFactor: 0.1, maxAgeDays: 30 }
);
const score = scorer.calculateScore(input);
```

### Functional helpers
```typescript
// Quick creation from pre-calculated values
const score = createConfidenceScore(frequency, consistency, age, spread, score, level);

// Full calculation from raw input
const score = calculateConfidence(input);
```

---

## Rust Rebuild Considerations
- Pure math — trivially portable to Rust
- The scorer is called for every pattern on every scan — Rust's speed helps at scale
- Weight validation is a one-time check — zero runtime cost in Rust
- Consider SIMD for batch scoring across many patterns
- The weights (0.4/0.3/0.15/0.15) are tuned — preserve exactly in Rust port
