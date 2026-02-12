# Detector Semantic System

## Location
`packages/detectors/src/base/semantic-detector.ts` + `*-semantic.ts` files in each category

## Core Concept
Semantic detectors perform keyword-based analysis that understands context. They find occurrences of domain-specific keywords, classify each by context type (function call, import, assignment, etc.), learn the dominant usage patterns, and flag deviations.

## How It Works

### Phase 1: Keyword Scanning
Each semantic detector defines keywords relevant to its domain:
```typescript
// SQL Injection Semantic Detector
getSemanticKeywords(): string[] {
  return ['query', 'sql', 'execute', 'prepare', 'parameterize', 'bind', 'statement', 'database', 'db'];
}
```

### Phase 2: Context Classification
For each keyword match, the detector classifies the context:
```typescript
detectContextType(line, keyword): ContextType
// Returns: 'function_call' | 'import' | 'assignment' | 'declaration' | 'comment' | 'string' | 'other'
```

### Phase 3: Learning (`learnFromProject`)
Aggregates usage patterns across the project:
```typescript
interface UsagePattern {
  contextType: string;      // e.g. 'function_call'
  count: number;            // How many times this pattern appears
  percentage: number;       // What % of total occurrences
  files: string[];          // Which files use this pattern
  examples: string[];       // Example code snippets
}
```

Finds the dominant pattern (highest percentage with minimum occurrences).

### Phase 4: Detection
Compares each occurrence against the dominant pattern. Deviations become violations with explanations like:
> "Inconsistent SQL pattern: using 'string_concatenation' but project primarily uses 'parameterized_query' (85% of cases, 42 occurrences across 12 files)"

## SemanticMatch
```typescript
interface SemanticMatch {
  keyword: string;
  matchedText: string;
  line: number;
  column: number;
  file: string;
  contextType: string;
  surroundingContext: string;   // 2 lines above/below
  confidence: number;
}
```

## Confidence Scoring
```
base = keyword match strength (exact match = 1.0, partial = 0.7)
+ boost for surrounding context relevance
+ boost for import/export alignment
- penalty for generic/ambiguous matches (e.g., 'db' in a comment)
```

## Configuration
```typescript
interface SemanticDetectorConfig {
  minOccurrences: number;       // Default: 2
  dominanceThreshold: number;   // Default: 0.3 (30%)
  minFiles: number;             // Default: 1
  includeComments: boolean;     // Default: false
  includeStrings: boolean;      // Default: false
}
```

## Semantic Detectors by Category

Every category has semantic variants. The semantic detector is language-agnostic — it works on any language that uses the relevant keywords.

| Category | Keywords (examples) |
|----------|-------------------|
| `security/sql-injection-semantic` | query, sql, execute, prepare, bind |
| `auth/middleware-semantic` | middleware, authenticate, authorize, guard |
| `auth/token-handling-semantic` | token, jwt, bearer, refresh, session |
| `errors/circuit-breaker-semantic` | circuit, breaker, fallback, retry, timeout |
| `logging/structured-logging-semantic` | logger, log, info, warn, error, debug |
| `performance/memoization-semantic` | memo, useMemo, useCallback, cache |
| `components/composition-semantic` | compose, HOC, render, children, slot |
| `data-access/transaction-semantic` | transaction, commit, rollback, savepoint |

## Data Boundary Semantic Detectors

Special semantic detectors in `data-access/boundaries/`:
- `ORMModelSemanticDetector` — Detects ORM model usage patterns
- `QueryAccessSemanticDetector` — Detects direct query access patterns
- `SensitiveFieldSemanticDetector` — Detects sensitive data field patterns

These help enforce data access boundaries (e.g., "don't access the database directly from controllers").
