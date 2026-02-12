# Cortex Retrieval Engine

## Location
`packages/cortex/src/retrieval/`

## Purpose
Intent-aware memory retrieval that gathers candidates from multiple sources, scores them, applies intent weighting, and fits results to a token budget.

## Files
- `engine.ts` — `RetrievalEngine`: main orchestrator
- `scoring.ts` — `RelevanceScorer`: multi-factor relevance scoring
- `weighting.ts` — `IntentWeighter`: intent-based type weighting
- `budget.ts` — `TokenBudgetManager`: token budget allocation
- `ranking.ts` — `ResultRanker`: final result ranking
- `compression.ts` — Result compression for token efficiency

## Retrieval Flow

```
1. Receive RetrievalContext (intent, focus, active file, etc.)
2. Gather candidates from multiple sources:
   - By pattern (linked patterns)
   - By constraint (linked constraints)
   - By file (active/recent files)
   - By function (call graph context)
   - By topic (semantic search on focus)
3. Score each candidate (relevance scorer)
4. Apply intent weighting (boost types relevant to intent)
5. Rank results
6. Compress to fit token budget
7. Return CompressedMemory[] with metadata
```

## Intent Types

### Domain-Agnostic
- `create` — Creating something new
- `investigate` — Understanding/researching
- `decide` — Making a decision
- `recall` — Finding past knowledge
- `learn` — Adding new knowledge

### Code-Specific
- `add_feature`, `fix_bug`, `refactor`, `security_audit`, `understand_code`, `add_test`

### Universal (v2)
- `spawn_agent` — Looking for agent configs
- `execute_workflow` — Running a workflow
- `track_progress` — Checking goal progress
- `diagnose_issue` — Investigating a problem

## RetrievalContext
```typescript
interface RetrievalContext {
  intent: Intent;
  focus: string;
  activeFile?: string;
  activeFunction?: string;
  recentFiles?: string[];
  relevantPatterns?: string[];
  relevantConstraints?: string[];
  callGraphContext?: string[];
  securityContext?: string[];
  maxTokens?: number;       // Default: 2000
  maxMemories?: number;
}
```

## Scoring Factors
The relevance scorer considers:
- Semantic similarity to focus query
- File proximity (same file/directory)
- Pattern alignment
- Recency of access
- Confidence level
- Importance level
- Intent-type match

## Intent Weighting
Each intent boosts certain memory types. For example:
- `fix_bug` boosts: tribal, episodic, code_smell, incident
- `security_audit` boosts: tribal (security), constraint_override, incident
- `add_feature` boosts: pattern_rationale, procedural, tribal

## Token Budget Management
- Default budget: 2000 tokens
- Memories compressed to fit using hierarchical compression
- Higher-importance memories get more token allocation
- Budget tracks: total, used, remaining, reserved

## V2 Retrieval Orchestrator
`orchestrators/retrieval-orchestrator.ts` adds:
- Session deduplication (skip already-sent memories)
- Prediction integration (pre-scored candidates)
- Compression level tracking per memory
- Token efficiency metrics

## Rust Rebuild Considerations
- Scoring is pure math — ideal for Rust
- Vector similarity search benefits from SIMD
- Token budget packing is a variant of the knapsack problem — Rust's performance helps
- The candidate gathering phase involves many SQLite queries — batch them in Rust
