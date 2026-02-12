# Cortex Contradiction Detection & Propagation

## Location
`packages/cortex/src/contradiction/`

## Purpose
Detects when new memories contradict existing ones and propagates confidence changes through the memory graph.

## Files
- `detector.ts` — `ContradictionDetector`: finds contradictions
- `propagator.ts` — `ConfidencePropagator`: propagates confidence changes

## Contradiction Detector

### Detection Strategies
1. **Semantic Similarity** — Finds memories with high similarity but opposing content
2. **Negation Patterns** — Detects negation words (not, never, don't, avoid, instead, etc.)
3. **Absolute Statement Conflicts** — Flags when "always" meets "never" on same topic
4. **Temporal Supersession** — Detects when newer info replaces older
5. **Feedback Contradictions** — Identifies conflicting feedback memories
6. **Topic Conflicts** — Same topic, different conclusions

### Contradiction Types
```typescript
type ContradictionType =
  | 'direct'      // A says X, B says not X
  | 'partial'     // A says X always, B says X sometimes
  | 'supersedes'  // A is outdated version of B
  | 'temporal';   // Was true then, not true now
```

### Configuration
```typescript
interface ContradictionDetectorConfig {
  minSimilarityThreshold: number;        // Default: 0.6
  minContradictionConfidence: number;    // Default: 0.5
  maxCandidates: number;                 // Default: 50
  checkTypes: MemoryType[];              // Types to check
}
```

### Checked Types (default)
tribal, semantic, procedural, pattern_rationale, decision_context, feedback, skill, workflow

### ContradictionResult
```typescript
interface ContradictionResult {
  existingMemoryId: string;
  contradictionType: ContradictionType;
  confidence: number;
  evidence: string;
  suggestedAction: 'lower_confidence' | 'archive' | 'merge' | 'flag_for_review';
  similarityScore: number;
}
```

## Confidence Propagator

### What It Does
When a contradiction is detected, confidence changes ripple through the memory graph:
1. The contradicted memory's confidence drops
2. Memories that *support* the contradicted memory also lose confidence (at reduced rate)
3. If confidence drops below threshold, memory is archived
4. Relationships are created to track the contradiction

### Propagation Rules
```typescript
interface PropagationRules {
  directContradictionDelta: -0.3;       // Direct contradiction
  partialContradictionDelta: -0.15;     // Partial contradiction
  supersessionDelta: -0.5;              // Full replacement
  confirmationDelta: +0.1;             // Confirmation boost
  supportingPropagationFactor: 0.5;    // Propagation to supporters
  archivalThreshold: 0.15;            // Archive below this
  consensusThreshold: 3;              // Feedbacks needed for consensus
  consensusBoost: 0.2;                // Boost when consensus reached
}
```

### Key Operations

#### `applyContradiction(contradiction, newMemoryId)`
- Reduces contradicted memory's confidence
- Creates `contradicts` relationship
- Propagates to supporting memories
- Archives if below threshold

#### `applyConfirmation(memoryId, confirmingMemoryId, context)`
- Boosts confirmed memory's confidence by +0.1
- Creates `supports` relationship
- Increments access count

#### `checkConsensus(memoryId)`
- Counts supporting feedback memories
- If ≥ 3 supporters → consensus boost of +0.2

#### `applySupersession(newMemoryId, oldMemoryId, reason)`
- Drops old memory confidence by -0.5
- Creates `supersedes` relationship
- Archives old memory if below threshold

### Batch Recalculation
`recalculateConfidences(storage, memoryIds?)` — Recalculates confidence for all memories based on their relationship balance (supporters vs contradictors).

## Rust Rebuild Considerations
- Graph traversal for propagation is a natural fit for Rust
- The propagation rules are pure arithmetic — trivial to port
- Batch recalculation benefits from parallel processing
- Consider using petgraph for the relationship graph in Rust
