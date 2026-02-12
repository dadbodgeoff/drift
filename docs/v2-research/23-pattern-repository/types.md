# Pattern Repository — Unified Pattern Type

> `packages/core/src/patterns/types.ts` — ~350 lines
> The single source of truth for pattern data across the entire Drift system.

## Purpose

Consolidates the previously separate `Pattern` (from `PatternStore`) and `PatternShardEntry` (from `PatternShardStore`) types into a single unified type. All consumers should use this type.

## Pattern Categories

```typescript
type PatternCategory =
  | 'api' | 'auth' | 'security' | 'errors' | 'logging'
  | 'data-access' | 'config' | 'testing' | 'performance'
  | 'components' | 'styling' | 'structural' | 'types'
  | 'accessibility' | 'documentation';
```

15 categories total. Each corresponds to a detector category.

## Pattern Status

```typescript
type PatternStatus = 'discovered' | 'approved' | 'ignored';
```

Valid transitions:
- `discovered → approved`
- `discovered → ignored`
- `approved → ignored`
- `ignored → approved`

## Confidence

```typescript
type ConfidenceLevel = 'high' | 'medium' | 'low' | 'uncertain';
```

Thresholds:
- `high`: score ≥ 0.85
- `medium`: score ≥ 0.70
- `low`: score ≥ 0.50
- `uncertain`: score < 0.50

## Severity

```typescript
type Severity = 'error' | 'warning' | 'info' | 'hint';
```

Ordering: `error (4) > warning (3) > info (2) > hint (1)`

## Detection Methods

```typescript
type DetectionMethod = 'ast' | 'regex' | 'semantic' | 'learning' | 'structural';
```

## Unified Pattern Type

```typescript
interface Pattern {
  // Identity
  id: string;

  // Classification
  category: PatternCategory;
  subcategory: string;

  // Metadata
  name: string;
  description: string;

  // Detection Info
  detectorId: string;
  detectorName: string;
  detectionMethod: DetectionMethod;
  detector: DetectorConfig;

  // Confidence
  confidence: number;              // 0.0 to 1.0
  confidenceLevel: ConfidenceLevel; // Computed from score

  // Locations
  locations: PatternLocation[];
  outliers: OutlierLocation[];

  // Status & Severity
  status: PatternStatus;
  severity: Severity;

  // Timestamps
  firstSeen: string;               // ISO timestamp
  lastSeen: string;                // ISO timestamp
  approvedAt?: string;
  approvedBy?: string;

  // Additional
  tags: string[];
  autoFixable: boolean;
  metadata: PatternMetadata;
}
```

## Location Types

```typescript
interface PatternLocation {
  file: string;        // Relative to project root
  line: number;        // 1-indexed
  column: number;      // 1-indexed
  endLine?: number;
  endColumn?: number;
  snippet?: string;    // Code context
}

interface OutlierLocation extends PatternLocation {
  reason: string;
  deviationScore?: number;  // 0.0 to 1.0
}
```

## PatternSummary (Lightweight)

For listings and indexes — contains only essential display fields:

```typescript
interface PatternSummary {
  id: string;
  name: string;
  category: PatternCategory;
  subcategory: string;
  status: PatternStatus;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  severity: Severity;
  locationCount: number;
  outlierCount: number;
}
```

## Helper Functions

```typescript
// Compute confidence level from numeric score
computeConfidenceLevel(score: number): ConfidenceLevel

// Convert full Pattern to lightweight PatternSummary
toPatternSummary(pattern: Pattern): PatternSummary

// Create a new Pattern with defaults (status='discovered', timestamps=now)
createPattern(input: CreatePatternInput): Pattern
```

## Error Classes

> `errors.ts`

```typescript
class PatternNotFoundError extends Error {
  constructor(patternId: string)
}

class InvalidStatusTransitionError extends Error {
  constructor(patternId: string, fromStatus: PatternStatus, toStatus: PatternStatus)
}

class PatternAlreadyExistsError extends Error {
  constructor(patternId: string)
}
```
