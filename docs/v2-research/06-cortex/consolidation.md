# Cortex Consolidation Engine

## Location
`packages/cortex/src/consolidation/`

## Purpose
Sleep-inspired memory consolidation that compresses episodic memories into semantic knowledge. Runs periodically to reduce memory count while preserving important knowledge.

## Files
- `engine.ts` — `ConsolidationEngine`: main orchestrator
- `replay.ts` — `ReplayPhase`: select episodes for consolidation
- `abstraction.ts` — `AbstractionPhase`: extract patterns from episodes
- `integration.ts` — `IntegrationPhase`: merge with existing semantic memory
- `pruning.ts` — `PruningPhase`: remove redundant episodes
- `strengthening.ts` — `StrengtheningPhase`: boost frequently accessed memories
- `scheduler.ts` — `ConsolidationScheduler`: basic time-based scheduling
- `adaptive-scheduler.ts` — `AdaptiveConsolidationScheduler`: V2 token-aware scheduling

## The 5 Phases (inspired by sleep neuroscience)

### Phase 1: Replay
- Selects episodic memories eligible for consolidation
- Criteria: age > `maxEpisodeAge` (default 7 days), status = `pending`
- Groups related episodes by topic/context

### Phase 2: Abstraction
- Extracts generalizable patterns from episode groups
- Identifies recurring themes, preferences, and knowledge
- Creates candidate semantic memories

### Phase 3: Integration
- Merges new semantic candidates with existing semantic memories
- Updates existing memories if new info supports them
- Creates new semantic memories for novel knowledge

### Phase 4: Pruning
- Removes consolidated episodic memories
- Frees tokens and storage
- Tracks `tokensFreed` metric

### Phase 5: Strengthening
- Boosts confidence of frequently accessed memories
- Reinforces memories that were validated by usage

## Configuration
```typescript
interface ConsolidationConfig {
  minEpisodes: number;              // Default: 5
  maxEpisodeAge: number;            // Default: 7 (days)
  consolidationThreshold: number;   // Default: 3 (min similar episodes)
  pruneAfterConsolidation: boolean; // Default: true
}
```

## ConsolidationResult
```typescript
interface ConsolidationResult {
  episodesProcessed: number;
  memoriesCreated: number;
  memoriesUpdated: number;
  memoriesPruned: number;
  tokensFreed: number;
  duration: number;  // ms
}
```

## Basic Scheduler
Time-based scheduling with configurable interval. Runs consolidation when enough episodes have accumulated.

## Adaptive Scheduler (V2)
Token-aware scheduling that triggers consolidation based on multiple signals:

### Trigger Types
1. **Token Pressure** — When token usage exceeds threshold
2. **Memory Count** — When episodic memory count is too high
3. **Confidence Degradation** — When average confidence drops
4. **Contradiction Density** — When too many contradictions detected
5. **Scheduled Fallback** — Time-based fallback if no other trigger fires

### Metrics Tracked
```typescript
interface TokenUsage {
  totalMemories: number;
  totalTokens: number;
  averageTokensPerMemory: number;
  tokensByType: Record<string, number>;
  budgetUtilization: number;
}

interface QualityMetrics {
  averageConfidence: number;
  staleMemoryCount: number;
  contradictionCount: number;
  validationPassRate: number;
}
```

## Rust Rebuild Considerations
- The 5-phase pipeline maps well to Rust's iterator/pipeline patterns
- Episode grouping (phase 1) involves text similarity — benefits from Rust perf
- Abstraction (phase 2) is the most complex phase — may need LLM integration
- Pruning (phase 4) is pure database operations — straightforward in Rust
- The adaptive scheduler's trigger system is a good fit for Rust's enum + match
