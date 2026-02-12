# Security — Data Access Learning

## Location
`packages/core/src/boundaries/data-access-learner.ts`

## Purpose
The `DataAccessLearner` implements the LEARN phase of boundary scanning. It analyzes source files to discover which frameworks, tables, and naming conventions your codebase uses — so detection is based on real patterns, not assumptions.

## Class: DataAccessLearner

### What It Learns

| Aspect | How |
|--------|-----|
| **Frameworks** | Detects ORM imports, decorators, and usage patterns |
| **Table names** | Extracts from model definitions, query strings, schema files |
| **Naming conventions** | Analyzes table names → snake_case, camelCase, PascalCase, mixed |
| **Variable patterns** | Maps variable names to tables (e.g., `userRepo` → `users`) |
| **Access patterns** | Records which files access which tables |

### Learning Flow
```
1. For each source file:
   a. Detect frameworks used (ORM imports, decorators)
   b. Extract table names from model definitions
   c. Record table access with file and framework
   d. Learn variable-to-table patterns
2. After all files processed:
   a. Finalize learning (calculate conventions)
   b. Detect naming convention from table names
   c. Build variable inference rules
```

### Framework Detection
Detects 28+ frameworks via signature patterns:
```typescript
interface FrameworkSignature {
  name: string;
  patterns: RegExp[];
  language: string;
}
```

### Learned Conventions
```typescript
interface LearnedDataAccessConventions {
  frameworks: string[];
  tableNamingConvention: 'snake_case' | 'camelCase' | 'PascalCase' | 'mixed';
  knownTables: Map<string, LearnedDataAccessPattern>;
  variablePatterns: Map<string, string>;  // variable name → table name
  filesAnalyzed: number;
}
```

### Variable Inference
After learning, the learner can infer table names from variable names:
- `userRepo` → `users`
- `orderService` → `orders`
- `productModel` → `products`

This improves detection accuracy for indirect data access patterns.

## V2 Notes
- Learning phase is I/O bound (reading files) — Rust parallelism helps
- Framework detection is pattern matching — Rust regex is faster
- Convention detection is pure logic — can go either way
- The learned state should be cached and reused across scans
