# Constraints — Types

## Location
`packages/core/src/constraints/types.ts`

## Core Type: Constraint

```typescript
interface Constraint {
  id: string;
  name: string;
  description: string;
  category: ConstraintCategory;
  derivedFrom: ConstraintSource;
  invariant: ConstraintInvariant;
  scope: ConstraintScope;
  confidence: ConstraintConfidence;
  enforcement: ConstraintEnforcement;
  status: ConstraintStatus;
  language: ConstraintLanguage;
  metadata: ConstraintMetadata;
}
```

## Categories
`api` | `auth` | `data` | `error` | `test` | `security` | `structural` | `performance` | `logging` | `validation`

## Status Lifecycle
- `discovered` — Auto-discovered, pending review
- `approved` — User-approved, actively enforced
- `ignored` — User-ignored, not enforced
- `custom` — User-defined constraint

## Languages
`typescript` | `javascript` | `python` | `java` | `csharp` | `php` | `rust` | `cpp` | `all`

## ConstraintSource
Tracks what Drift analysis data the constraint was derived from:
- Source type: `pattern`, `call_graph`, `boundary`, `test_topology`, `error_handling`, `manual`
- Source IDs (pattern IDs, function IDs, etc.)
- Evidence: conforming/violating instance counts and locations

## ConstraintInvariant
The actual rule being enforced:
```typescript
interface ConstraintInvariant {
  type: ConstraintType;        // must_have, must_not_have, must_precede, etc.
  predicate: ConstraintPredicate;
  description: string;
}
```

### Predicate Types
Predicates define what to check:
- **Function predicates**: "functions matching X must have Y"
- **Class predicates**: "classes matching X must contain Y"
- **Entry point predicates**: "API endpoints must have Z"
- **Naming predicates**: "files/functions must match pattern"
- **File structure predicates**: "modules must contain X"

## ConstraintScope
Where the constraint applies:
```typescript
interface ConstraintScope {
  files?: string[];           // Glob patterns
  directories?: string[];     // Directory patterns
  functions?: string[];       // Function name patterns
  classes?: string[];         // Class name patterns
  entryPoints?: boolean;      // Only entry points
}
```

## ConstraintConfidence
```typescript
interface ConstraintConfidence {
  score: number;              // 0.0-1.0
  conformingInstances: number;
  violatingInstances: number;
  lastVerified: string;       // ISO timestamp
}
```

## ConstraintEnforcement
```typescript
interface ConstraintEnforcement {
  level: 'error' | 'warning' | 'info';
  autoFix?: boolean;
  message: string;
  suggestion?: string;
}
```

## Query Types

### ConstraintQueryOptions
```typescript
interface ConstraintQueryOptions {
  filter?: {
    categories?: ConstraintCategory[];
    status?: ConstraintStatus[];
    language?: ConstraintLanguage;
    minConfidence?: number;
    search?: string;
  };
  sort?: { field: string; direction: 'asc' | 'desc' };
  pagination?: { offset?: number; limit?: number };
}
```

## Verification Types

### VerificationResult
```typescript
interface VerificationResult {
  file: string;
  violations: ConstraintViolation[];
  passed: number;
  failed: number;
  skipped: number;
  summary: VerificationSummary;
}
```

### ConstraintViolation
```typescript
interface ConstraintViolation {
  constraintId: string;
  constraintName: string;
  file: string;
  line: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  suggestion?: string;
  snippet?: string;
}
```
