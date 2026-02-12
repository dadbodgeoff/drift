# Context Generation — Token Management & AI Formatting

> Token budgeting and AI-optimized output formatting in `context-generator.ts`.

## Token Estimation

Simple character-based estimation:

```
tokens ≈ JSON.stringify(context).length × 0.25
```

Constants:
- `DEFAULT_MAX_TOKENS = 8000`
- `TOKENS_PER_CHAR = 0.25`
- `CONTEXT_VERSION = '1.0.0'`

## Trimming Strategy

When estimated tokens exceed the budget, context is trimmed in priority order (first to cut = least important):

| Priority | What Gets Cut | How |
|----------|--------------|-----|
| 1 (first) | Dependencies | Slice to 2 entries |
| 2 | Pattern examples | Delete all `example` fields |
| 3 | Patterns | Cap at 20 |
| 4 | Key files | Cap at 5 |
| 5 | Entry points | Cap at 10 |
| 6 (last) | Data accessors | Cap at 10 |

After each trim step, tokens are re-estimated. Trimming stops as soon as the budget is met.

## AI Context Format

The `formatForAI()` method converts structured `PackageContext` into four text sections:

### System Prompt
```
# Package: @drift/core

Language: typescript
Path: packages/core

## Summary
- 42 patterns detected
- 8 constraints apply
- 15 entry points
- 6 data accessors
```

### Conventions
Top 10 patterns with category, confidence percentage, and occurrence count. Includes code examples if available.

### Examples
Up to 5 patterns that have code snippets, formatted as fenced code blocks.

### Constraints
All applicable constraints with enforcement level, condition, and guidance.

### Combined Output
All four sections joined with `\n\n---\n\n` separators.

### Token Breakdown
The `AIContextFormat` includes per-section token counts:
```typescript
tokens: {
  systemPrompt: number;
  conventions: number;
  examples: number;
  constraints: number;
  total: number;
}
```

## Data Source Limits

Hard caps applied during extraction (before trimming):

| Data Source | Max Items |
|-------------|-----------|
| Entry points | 50 |
| Data accessors | 30 |
| Key files | 10 |
| Pattern file paths | 5 per pattern |
| Dependency patterns | 10 per dependency |

## Key File Scoring

Files are scored by pattern density:

```
score = Σ (pattern.confidence × pattern.occurrences) for each pattern in file
```

Top 10 files by score are included. Each key file entry includes:
- File path
- Reason string (e.g., "Contains 5 patterns")
- Up to 5 pattern names

## Guidance Generation

Synthesized from patterns and constraints:

- **Key insights:** Categories with 2+ patterns (e.g., "api: 5 patterns detected")
- **Common patterns:** Top 5 patterns with confidence ≥ 0.8, showing name and occurrence count
- **Warnings:** Up to 3 constraints with `enforcement: 'error'`, showing guidance text

## MCP Integration

### drift_package_context

Direct consumer of `PackageContextGenerator`. The MCP handler:
1. Creates a `PackageContextGenerator` with the project root
2. Calls `generate()` or lists packages via `PackageDetector.detect()`
3. Formats the result using the MCP response builder

### drift_context

Indirect consumer. The `drift_context` handler (`orchestration/context.ts`) is a ~1500-line intent-aware orchestrator that:
- Reads patterns, constraints, and call graph data directly from stores
- Uses intent strategies (add_feature, fix_bug, understand, refactor, security_review, etc.)
- Generates semantic insights, warnings, and suggested files
- Does NOT use `PackageContextGenerator` directly — it's a parallel, more sophisticated implementation

This means there are two context generation paths:
1. **Package-scoped** (`drift_package_context`) → uses `PackageContextGenerator`
2. **Intent-aware** (`drift_context`) → custom orchestration in MCP layer

## v2 Notes

- The 0.25 tokens-per-char estimate is rough but functional — consider using tiktoken for accuracy
- Trimming is greedy (cuts whole sections) — could be smarter with partial trimming
- The dual context generation paths (package-scoped vs intent-aware) should be unified in v2
- `drift_context` is the more powerful tool but doesn't benefit from `PackageContextGenerator`'s package detection
