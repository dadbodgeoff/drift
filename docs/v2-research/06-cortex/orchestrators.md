# Cortex Orchestrators

## Location
`packages/cortex/src/orchestrators/`

## Purpose
High-level workflow orchestrators that coordinate multiple subsystems for complex operations. These are the primary API surface for external consumers.

## Files
- `cortex-v2.ts` — `CortexV2`: unified API for all operations
- `retrieval-orchestrator.ts` — `RetrievalOrchestrator`: V2 retrieval with session + prediction
- `learning-orchestrator.ts` — `LearningOrchestrator`: correction analysis + memory creation
- `generation-orchestrator.ts` — `GenerationOrchestrator`: code generation context building

---

## CortexV2 (Main Entry Point)

The unified API that external consumers (MCP tools) interact with.

### Key Methods

#### `getContext(intent, focus, options?)` → `ContextResult`
Gets curated context for a task. Combines retrieval + session deduplication + compression.

#### `getWhy(intent, focus)` → `WhyResult`
Gets "why" context with causal narratives. Combines Why system + Causal system.

#### `learn(original, feedback, correctedCode?, context?)` → `LearnResult`
Learns from a correction. Analyzes, categorizes, creates memories, infers causal links.

#### `processFeedback(memoryId, feedback, outcome)` → `FeedbackResult`
Processes feedback on a specific memory.

#### `getValidationCandidates(limit)` → `ValidationCandidate[]`
Gets memories that need user validation.

#### `buildGenerationContext(intent, focus, targetFile, options?)` → `GenerationContext`
Builds rich context for code generation.

#### `trackGenerationOutcome(requestId, outcome, feedback?)` → `void`
Records whether generated code was accepted/modified/rejected.

#### `predict(activeFile)` → `PredictedMemory[]`
Predicts which memories will be needed.

#### `getHealth()` → `HealthReport`
Comprehensive health report including memory counts, confidence stats, storage size, validation status, and recommendations.

#### `consolidate(options?)` → `ConsolidateResult`
Triggers memory consolidation.

#### `validate(options?)` → `ValidateResult`
Triggers memory validation.

### HealthReport
```typescript
interface HealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  totalMemories: number;
  memoriesByType: Record<string, number>;
  averageConfidence: number;
  staleMemories: number;
  storageSize: string;
  lastConsolidation?: string;
  lastValidation?: string;
  recommendations: string[];
}
```

---

## RetrievalOrchestrator

Extends the base retrieval engine with V2 features:
- Session-based deduplication
- Prediction integration (pre-scored candidates)
- Hierarchical compression with budget management
- Token efficiency metrics
- Intent-to-type mapping

### Flow
```
1. Gather candidates (by type, file, pattern, semantic search)
2. Score and rank
3. Deduplicate with session context
4. Compress to fit token budget
5. Return with metadata
```

---

## LearningOrchestrator

Coordinates the full learning pipeline:

### `learnFromCorrection(original, feedback, correctedCode?, context?)`
1. Analyze the correction (categorize, diff, extract principle)
2. Create memories from the correction
3. Infer causal relationships
4. Return created memories + analysis

### `processFeedback(memoryId, feedback, outcome)`
1. Read the memory
2. Apply confidence adjustment based on outcome
3. Create feedback memory
4. Check for consensus
5. Return updated confidence

### `applyDecay()`
Applies decay to all memories, returns count of updated/decayed.

### Category → Memory Type Mapping
```
pattern_violation    → pattern_rationale
tribal_miss          → tribal
constraint_violation → constraint_override
style_preference     → preference (feedback)
naming_convention    → tribal
architecture_mismatch → decision_context
security_issue       → tribal (critical)
performance_issue    → code_smell
api_misuse           → tribal
```

---

## GenerationOrchestrator

Builds context for code generation with budget management:

### `buildContext(intent, focus, targetFile, options?)`
1. Allocate token budget across categories
2. Gather patterns, tribal, constraints, anti-patterns, related memories
3. Trim each category to budget
4. Return GenerationContext with provenance

### `validateGenerated(code, context)`
Validates generated code against patterns, tribal knowledge, and anti-patterns.

### `trackOutcome(requestId, outcome, feedback?)`
Records generation outcome and adjusts confidence of influencing memories.

### Budget Allocation (default)
- Patterns: 30%
- Tribal: 25%
- Constraints: 20%
- Anti-patterns: 15%
- Related: 10%

---

## Rust Rebuild Considerations
- Orchestrators are coordination logic — could remain in TypeScript as the "glue" layer
- Or: expose Rust subsystems via FFI/NAPI and keep orchestrators in TS
- Or: full Rust with the orchestrators as the public API
- The CortexV2 class maps to a Rust struct with methods
- Health reporting involves aggregation queries — benefits from Rust's speed on large datasets
