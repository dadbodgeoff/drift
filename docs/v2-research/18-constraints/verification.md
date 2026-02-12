# Constraints — Verification

## Location
`packages/core/src/constraints/verification/constraint-verifier.ts`

## Purpose
Validates code against applicable constraints. Used by quality gates, MCP tools (`drift_validate_change`, `drift_prevalidate`), and CI pipelines. Produces violation reports with severity, suggestions, and code snippets.

## Class: ConstraintVerifier

### Key Methods

| Method | Purpose |
|--------|---------|
| `verifyFile(filePath, content, constraints)` | Verify a file against constraints |
| `verifyChange(filePath, oldContent, newContent, constraints)` | Verify a code change (only checks changed lines) |

### Verification Flow
```
1. Determine file language from extension
2. Filter constraints applicable to this file (scope, language)
3. For each applicable constraint:
   a. Extract relevant code elements (functions, classes, entry points, imports)
   b. Evaluate predicate against extracted elements
   c. Record pass/fail with violation details
4. Build summary with pass/fail/skip counts
5. Return VerificationResult
```

### Predicate Evaluation

| Predicate Type | What It Checks |
|---------------|----------------|
| **Function** | Functions matching a pattern must have/not have certain properties (error handling, decorators, return types) |
| **Class** | Classes matching a pattern must contain certain methods/properties |
| **Entry Point** | API endpoints must have authentication, validation, etc. |
| **Naming** | Files/functions/classes must match naming conventions |
| **File Structure** | Modules must contain certain files (index.ts, types.ts, etc.) |

### Code Element Extraction
The verifier extracts code elements using language-aware patterns:
- **Functions**: Detected via language-specific regex (function declarations, arrow functions, methods)
- **Classes**: Class declarations with methods and properties
- **Entry Points**: Route decorators, controller methods, exported handlers
- **Imports**: Import/require statements

### Change-Aware Verification
`verifyChange()` only checks constraints against changed lines:
1. Diff old vs new content to find changed line numbers
2. Only evaluate constraints where violations fall on changed lines
3. Reduces noise — existing violations don't block new changes

### Violation Output
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

### Language Support
Verifier supports all 8 languages with language-specific patterns for:
- Function detection (def, func, fn, function, etc.)
- Class detection (class, struct, interface)
- Error handling detection (try/catch, try/except, defer, etc.)

## V2 Notes
- Predicate evaluation is regex-heavy — Rust would be significantly faster
- Code element extraction duplicates work done by parsers — should use AST from Rust
- Change-aware verification (diffing) is lightweight — can stay TS
- The verification result format is good — keep as-is
