# Confidence Scoring & Pattern Matching

## Location
`packages/core/src/matcher/`

## Files
- `confidence-scorer.ts` — Weighted confidence calculation
- `pattern-matcher.ts` — Multi-strategy pattern matching engine
- `outlier-detector.ts` — Statistical outlier detection (documented in existing docs)
- `types.ts` — All matcher types

## Confidence Scorer

### Algorithm
Weighted combination of four factors:

```
score = frequency × W_f + consistency × W_c + age × W_a + spread × W_s
```

**Default weights (must sum to 1.0):**
- frequency: 0.35
- consistency: 0.25
- age: 0.15
- spread: 0.25

### Factor Calculations

**Frequency** = occurrences / totalLocations
- How often the pattern appears relative to applicable locations

**Consistency** = 1 - variance
- Inverted variance (higher = more consistent implementation)
- Variance clamped to [0.0, 1.0]

**Age** = linear scaling from minAgeFactor to 1.0 over maxAgeDays
- Default: minAgeFactor=0.1, maxAgeDays=30
- New patterns start at 0.1, reach 1.0 after 30 days
- Patterns older than maxAgeDays get 1.0

**Spread** = fileCount / totalFiles
- How widely the pattern is used across the codebase

### Confidence Levels
- **High**: score >= 0.85
- **Medium**: score >= 0.70 and < 0.85
- **Low**: score >= 0.50 and < 0.70
- **Uncertain**: score < 0.50

### Output
```typescript
ConfidenceScore {
  frequency: number;    // 0.0-1.0
  consistency: number;  // 0.0-1.0
  age: number;          // days since first seen
  spread: number;       // file count
  score: number;        // 0.0-1.0 weighted score
  level: 'high' | 'medium' | 'low' | 'uncertain';
}
```

## Pattern Matcher

### Match Types
1. **AST** — Tree-sitter AST node matching with depth constraints, property matching, child pattern matching, descendant search
2. **Regex** — Regular expression matching with capture groups, multiline support, global matching
3. **Structural** — File path/directory/naming convention matching (PascalCase, camelCase, kebab-case, snake_case, SCREAMING_SNAKE_CASE)
4. **Semantic** — Falls back to AST matching currently
5. **Custom** — Not implemented yet

### Caching
- LRU cache with configurable max size (default: 1000 entries)
- TTL-based expiration (default: 60 seconds)
- Content hash validation (cache invalidated if file content changes)
- Cache key: `{file}:{patternId}`

### AST Matching Details
- Traverses AST depth-first
- Matches node type, properties (including regex property values), and child patterns
- Supports `matchDescendants` for deep child search
- Confidence calculated as: matched checks / total checks × child confidence
- Configurable min/max depth constraints

### Regex Matching Details
- Always uses global flag for multiple matches
- Supports named capture groups
- Converts string index to line:column location
- Confidence is always 1.0 (binary match)

### Structural Matching Details
- Glob pattern matching for paths and directories
- Named convention matching (PascalCase, camelCase, etc.)
- Extension matching
- All checks must pass (AND logic)

### Filtering
- Language filter (pattern only applies to specific languages)
- File include/exclude glob patterns
- Minimum confidence threshold
- Maximum matches per pattern

## v2 Notes
- The confidence scoring algorithm is the heart of Drift's learning. Must be preserved exactly.
- The weights (0.35/0.25/0.15/0.25) are tuned — don't change without testing.
- Pattern matching should move to Rust for performance.
- The caching layer can be replaced by Rust's built-in performance.
- AST matching maps naturally to tree-sitter queries in Rust.
