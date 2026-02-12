# Constraints — Invariant Detection & Synthesis

## Location
`packages/core/src/constraints/extraction/`

## Invariant Detector
`invariant-detector.ts` — `InvariantDetector`

### Purpose
Analyzes Drift's existing data (patterns, call graphs, boundaries, test topology, error handling) to discover architectural invariants that can become constraints. This is the semantic analysis layer that mines invariants from real codebase behavior.

### Dependencies
```typescript
interface InvariantDetectorConfig {
  rootDir: string;
  patternStore?: PatternStore;
  callGraphStore?: CallGraphStore;
  boundaryStore?: BoundaryStore;
  testTopologyAnalyzer?: TestTopologyAnalyzer;
  errorHandlingAnalyzer?: ErrorHandlingAnalyzer;
}
```

### Detection Sources

| Source | What It Detects | Categories |
|--------|----------------|------------|
| **Patterns** | High-confidence approved patterns → invariants | api, auth, data, error, test, security, structural |
| **Call Graph** | Auth-before-data-access, validation patterns | auth, security, data |
| **Boundaries** | Data access layer invariants, sensitive data rules | data, security |
| **Test Topology** | Coverage requirements, test patterns | test |
| **Error Handling** | Error boundary patterns, propagation rules | error |

### Detection Algorithm
```
1. For each data source:
   a. Query for high-confidence, approved patterns/data
   b. Identify recurring invariants (>= threshold conforming instances)
   c. Check for violations (instances that break the invariant)
   d. Calculate confidence: conforming / (conforming + violating)
   e. Produce DetectedInvariant with evidence
2. Merge invariants from all sources
3. Return sorted by confidence
```

### DetectedInvariant
```typescript
interface DetectedInvariant {
  constraint: Omit<Constraint, 'id' | 'metadata'>;
  evidence: InvariantEvidence;
  violations: ConstraintViolationDetail[];
}

interface InvariantEvidence {
  conforming: number;
  violating: number;
  conformingLocations: string[];
  violatingLocations: string[];
  sources: string[];
}
```

## Constraint Synthesizer
`constraint-synthesizer.ts` — `ConstraintSynthesizer`

### Purpose
Converts detected invariants into full Constraint objects. Handles ID generation, deduplication, merging of similar constraints, and comparison with existing constraints.

### Synthesis Pipeline
```
1. Detect invariants (via InvariantDetector)
2. Convert each invariant → Constraint (with generated ID, metadata)
3. Merge similar constraints (if enabled, using similarity threshold)
4. Diff against existing constraints in store
5. Save new/updated constraints
6. Return ExtractionResult with stats
```

### Configuration
```typescript
interface SynthesisOptions {
  categories?: ConstraintCategory[];
  minConfidence?: number;
  autoApproveThreshold?: number;   // Auto-approve above this confidence
  mergeSimilar?: boolean;           // Merge similar constraints
  similarityThreshold?: number;     // 0-1, default 0.8
}
```

### Deduplication
- Constraints are hashed by: category + invariant type + predicate + scope
- Existing constraints with same hash are updated (confidence refreshed)
- New constraints are added as `discovered`
- Constraints no longer detected are flagged for review

### Auto-Approval
When `autoApproveThreshold` is set (e.g., 0.95), constraints with confidence above the threshold are automatically set to `approved` status, reducing manual review burden.

## V2 Notes
- Pattern-based detection is I/O bound (reading pattern store) — stays TS
- Call graph-based detection involves graph traversal — move to Rust
- Boundary-based detection is straightforward — can go either way
- Synthesis/merging is complex logic but not hot-path — stays TS
