# Cortex Validation Engine

## Location
`packages/cortex/src/validation/`

## Purpose
Periodically validates memories across 4 dimensions and applies healing strategies to maintain knowledge quality.

## Files
- `engine.ts` — `ValidationEngine`: main orchestrator
- `citation-validator.ts` — `CitationValidator`: checks file citation freshness
- `temporal-validator.ts` — `TemporalValidator`: checks temporal staleness
- `contradiction-detector.ts` — `ContradictionDetector`: finds conflicting memories (validation-layer version)
- `pattern-alignment.ts` — `PatternAlignmentValidator`: checks pattern alignment
- `healing.ts` — `HealingEngine`: applies fixes to invalid memories

## Validation Dimensions

### 1. Citation Validation
- Checks if linked files still exist
- Compares content hashes to detect drift
- Validates line number references
- Stale citations → confidence reduction

### 2. Temporal Validation
- Checks if `validUntil` has passed
- Identifies memories that reference outdated information
- Flags memories older than their type's expected lifetime

### 3. Contradiction Detection
- Finds memories that conflict with each other
- Uses semantic similarity + rule-based heuristics
- Flags for review or auto-resolves based on confidence

### 4. Pattern Alignment
- Checks if memories still align with current patterns
- Detects when patterns have changed but memories haven't
- Flags misaligned memories for update

## Validation Result
```typescript
interface ValidationResult {
  total: number;
  valid: number;
  stale: number;
  healed: number;
  flaggedForReview: number;
  details: ValidationDetail[];
  duration: number;  // ms
}
```

## ValidationDetail (per memory)
```typescript
interface ValidationDetail {
  memoryId: string;
  memoryType: string;
  status: 'valid' | 'stale' | 'healed' | 'flagged';
  issues: ValidationIssue[];
  newConfidence?: number;
}
```

## ValidationIssue
```typescript
interface ValidationIssue {
  dimension: 'citation' | 'temporal' | 'contradiction' | 'pattern';
  severity: 'minor' | 'moderate' | 'severe';
  description: string;
  suggestion?: string;
}
```

## Healing Strategies
The `HealingEngine` applies automatic fixes:
- **Confidence adjustment** — Lower confidence for stale memories
- **Citation update** — Re-link to moved files
- **Archival** — Archive memories below threshold
- **Flagging** — Mark for human review when auto-fix isn't safe

## Rust Rebuild Considerations
- Citation validation requires filesystem access — Rust's `std::fs` is fine
- Content hashing (for drift detection) benefits from Rust's speed
- The healing engine's decision logic is straightforward pattern matching
- Batch validation of 500+ memories is a good parallelization target
