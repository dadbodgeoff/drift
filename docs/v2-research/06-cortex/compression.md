# Cortex Compression System

## Location
`packages/cortex/src/compression/`

## Purpose
4-level hierarchical compression system for token-efficient memory retrieval. Memories are compressed to different levels based on available token budget.

## Files
- `compressor/hierarchical.ts` — `HierarchicalCompressorV2`: main orchestrator
- `compressor/level-0.ts` — `Level0Compressor`: IDs only (~5 tokens)
- `compressor/level-1.ts` — `Level1Compressor`: one-liners (~50 tokens)
- `compressor/level-2.ts` — `Level2Compressor`: with examples (~200 tokens)
- `compressor/level-3.ts` — `Level3Compressor`: full context (~500+ tokens)
- `budget/estimator.ts` — Token estimation
- `budget/manager-v2.ts` — `TokenBudgetManagerV2`: budget allocation
- `budget/packer.ts` — Bin-packing for optimal memory selection
- `types.ts` — Re-exports from `types/compressed-memory.ts`

## Compression Levels

### Level 0: IDs Only (~5 tokens)
```typescript
interface Level0Output {
  id: string;
  type: string;
  importance: string;
  tokens: number;
}
```
Use: Memory exists, but no details. For counting/referencing.

### Level 1: One-Liners (~50 tokens)
```typescript
interface Level1Output extends Level0Output {
  oneLiner: string;
  tags: string[];       // Max 3
  confidence: number;
}
```
Use: Quick scan of what's available.

### Level 2: With Examples (~200 tokens)
```typescript
interface Level2Output extends Level1Output {
  details: {
    knowledge: string;
    example?: string;
    evidence: string[];  // Max 2
  };
}
```
Use: Enough to act on for most tasks.

### Level 3: Full Context (~500+ tokens)
```typescript
interface Level3Output extends Level2Output {
  full: {
    completeKnowledge: string;
    allExamples: CodeSnippet[];
    allEvidence: Evidence[];
    relatedMemories: string[];
    causalChain: string[];
    linkedPatterns?: string[];
    linkedConstraints?: string[];
    linkedFiles?: string[];
    linkedFunctions?: string[];
  };
}
```
Use: Deep dive, full context needed.

## Default Token Targets

| Level | Target | Max |
|-------|--------|-----|
| 0 | 5 | 10 |
| 1 | 50 | 75 |
| 2 | 200 | 300 |
| 3 | 500 | 1000 |

## HierarchicalCompressorV2

### `compress(memory, level)` → `CompressedMemory`
Compress a single memory to a specific level.

### `compressToFit(memory, maxTokens, options?)` → `CompressedMemory`
Compress to the highest level that fits within the token budget. Tries level 3 → 2 → 1 → 0.

### `compressBatchToFit(memories[], totalBudget, options?)` → `CompressedMemory[]`
Compress multiple memories to fit a total budget. Greedy approach: sorts by importance (critical first), compresses each to fit remaining budget.

### `suggestLevel(memory, budget)` → `CompressionLevel`
Returns the highest level that fits the budget.

## Token Budget Management

### TokenBudget
```typescript
interface TokenBudget {
  total: number;
  used: number;
  remaining: number;
  reserved: number;           // For system prompts
  availableForMemories: number;
}
```

## Rust Rebuild Considerations
- Compression is string manipulation + token counting — straightforward in Rust
- The bin-packing algorithm benefits from Rust's performance for large memory sets
- Token estimation could use a Rust tokenizer (tiktoken-rs) for accuracy
- Level configs are static data — zero-cost in Rust
