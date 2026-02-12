# Rules Engine & Evaluator

## Location
`packages/core/src/rules/` — 5 source files + 5 test files (including property-based tests)

## What It Is
The rules engine takes detected patterns and evaluates them against source files to produce violations. It's the enforcement layer — patterns describe "what IS", the rules engine determines "what SHOULD be" and flags deviations. Includes severity management, quick-fix generation, and pattern variant support.

## Files
- `evaluator.ts` — `Evaluator`: core evaluation pipeline (pattern → violations)
- `rule-engine.ts` — `RuleEngine`: higher-level orchestration with violation tracking and limits
- `variant-manager.ts` — `VariantManager`: scoped pattern overrides (global/directory/file)
- `severity-manager.ts` — `SeverityManager`: severity resolution, escalation, overrides
- `quick-fix-generator.ts` — `QuickFixGenerator`: automated fix generation (7 strategies)
- `types.ts` — All types: Violation, QuickFix, WorkspaceEdit, TextEdit, SeverityConfig

---

## Evaluator (`evaluator.ts`)
~900 lines. The core evaluation pipeline.

### Pipeline
```
Input: EvaluationInput { file, content, ast?, imports, exports }
       + Pattern (from pattern store)

1. checkMatch(input, pattern) → boolean
   Uses PatternMatcher to check if pattern applies to this file

2. getMatchDetails(input, pattern) → MatchDetails[]
   Gets specific match locations with confidence scores

3. evaluate(input, pattern) → EvaluationResult
   a. Create matcher context from input
   b. Convert pattern to PatternDefinition
   c. Run pattern matcher → PatternMatchResult[]
   d. Find violations (outliers from established pattern)
   e. Determine severity
   f. Generate quick fixes (if enabled)
   g. Return EvaluationResult

4. evaluateAll(input, patterns[]) → EvaluationResult[]
   Evaluates all patterns against a file

5. evaluateFiles(files[], patterns[]) → EvaluationSummary
   Batch evaluation across files with aggregated stats
```

### Violation Generation
Violations come from three sources:
1. **Outlier locations** — Statistical deviations from the pattern (locations where the pattern is NOT followed but should be)
2. **Missing patterns** — File should have the pattern (based on file type/location) but doesn't
3. **Outlier location details** — Specific code locations that deviate from the pattern's expected form

### EvaluationResult
```typescript
interface EvaluationResult {
  file: string;
  patternId: string;
  patternName: string;
  category: PatternCategory;
  matches: PatternMatchResult[];
  violations: Violation[];
  confidence: number;
  timestamp: string;
  error?: EvaluationError;
}
```

### Factory Functions
- `createEvaluator()` — Default evaluator
- `createEvaluatorWithConfig(config)` — Custom config
- `createEvaluatorWithAI()` — AI-enhanced evaluation
- `createEvaluatorWithSeverity(overrides, escalation)` — Custom severity

---

## Rule Engine (`rule-engine.ts`)
~900 lines. Higher-level orchestration wrapping the Evaluator.

### Additions Over Evaluator
- **Violation tracking** — Deduplicates violations by `patternId:file:range` key
- **Violation limits** — Configurable max violations per pattern and per file
- **Blocking detection** — `hasBlockingViolations()`, `getBlockingViolations()`
- **File filtering** — `shouldEvaluateFile()` pre-filter
- **Pattern context** — Wraps patterns with additional context for evaluation

### RuleEngineConfig
```typescript
interface RuleEngineConfig {
  evaluator?: EvaluatorConfig;
  severity?: SeverityConfig;
  maxViolationsPerPattern?: number;  // Default: 100
  maxViolationsPerFile?: number;     // Default: 50
  enableQuickFixes?: boolean;        // Default: true
  enableAI?: boolean;                // Default: false
  deduplicateViolations?: boolean;   // Default: true
}
```

---

## Severity Manager (`severity-manager.ts`)
~760 lines. Resolves effective severity for violations.

### Severity Resolution Order
```
1. Pattern-specific override (setPatternOverride)
2. Category-specific override (setCategoryOverride)
3. Config-level severity map
4. Default category severity
```

### Default Category Severities
| Category | Default Severity |
|----------|-----------------|
| security | error |
| auth | error |
| errors | warning |
| api | warning |
| data-access | warning |
| testing | info |
| logging | info |
| documentation | hint |
| styling | hint |
| (all others) | warning |

### Escalation System
When enabled, violations can be escalated based on rules:
```typescript
interface SeverityEscalationRule {
  condition: 'count' | 'category' | 'pattern' | 'file';
  threshold?: number;            // For count-based
  category?: PatternCategory;    // For category-based
  pattern?: string;              // For pattern-based (regex)
  file?: string;                 // For file-based (glob)
  escalateTo: Severity;
}
```

Example: "If security violations exceed 5, escalate remaining to error"

### Utility Functions
- `isBlockingSeverity(severity)` — error and warning are blocking
- `compareSeverity(a, b)` — Numeric comparison (error=3, warning=2, info=1, hint=0)
- `sortViolationsBySeverity(violations)` — Sort most severe first
- `getSeveritySummary(violations)` — Count by severity level

---

## Quick Fix Generator (`quick-fix-generator.ts`)
~1320 lines. Generates automated fixes for violations.

### 7 Fix Strategies

| Strategy | What It Does | Confidence |
|----------|-------------|------------|
| `ReplaceFixStrategy` | Replace code at violation range with expected code | Based on pattern confidence |
| `WrapFixStrategy` | Wrap code in try/catch, if-check, or function | 0.6 base |
| `ExtractFixStrategy` | Extract code into a named function/variable | 0.5 base |
| `ImportFixStrategy` | Add missing import statement | 0.7 base |
| `RenameFixStrategy` | Rename to match naming convention | 0.7 base |
| `MoveFixStrategy` | Move code to different location | 0.4 base |
| `DeleteFixStrategy` | Remove unnecessary code | 0.5 base |

### Fix Generation Pipeline
```
1. For each registered strategy:
   a. Check canHandle(violation)
   b. Calculate confidence
   c. If confidence >= minConfidence: generate fix
2. Sort fixes by confidence (highest first)
3. Return FixGenerationResult with all applicable fixes
```

### QuickFix Structure
```typescript
interface QuickFix {
  title: string;
  fixType: FixType;              // replace, wrap, extract, import, rename, move, delete
  edit: WorkspaceEdit;
  isPreferred: boolean;
  confidence: number;
  preview?: string;
}
```

### WorkspaceEdit / TextEdit
```typescript
interface WorkspaceEdit {
  changes: DocumentChange[];
}
interface DocumentChange {
  file: string;
  edits: TextEdit[];
}
interface TextEdit {
  range: Range;
  newText: string;
}
```

### Additional Capabilities
- `generatePreview(fix, content)` — Show what the fix would look like
- `applyFix(fix, content)` — Apply fix to content string
- `isIdempotent(fix, content)` — Check if fix is already applied
- `validateFix(fix, content)` — Validate fix won't break code
- `calculateImpact(fix, content)` — Lines changed, characters changed, breaking risk

### RenameFixStrategy Details
Supports convention conversion:
- `toCamelCase`, `toPascalCase`, `toSnakeCase`, `toKebabCase`
- Infers target convention from pattern's expected value

---

## Variant Manager (`variant-manager.ts`)
~1100 lines. Manages scoped pattern overrides.

### What Variants Are
A variant is a scoped override of a pattern's behavior. For example: "In the `legacy/` directory, allow the old naming convention" or "For `config.ts`, suppress the auth pattern requirement."

### Variant Scopes
```typescript
type VariantScope = 'global' | 'directory' | 'file';
```
- **Global** — Applies everywhere
- **Directory** — Applies to files in a specific directory (and subdirectories)
- **File** — Applies to a specific file

### Variant Lifecycle
```
Create → [Activate/Deactivate] → Query → [Expire] → Delete
```

### Key Methods
| Method | Purpose |
|--------|---------|
| `create(input)` | Create a new variant |
| `activate(id)` / `deactivate(id)` | Toggle variant |
| `query(query)` | Find variants by pattern, scope, file, status |
| `getActiveByFile(filePath)` | Get active variants for a file |
| `isLocationCovered(patternId, location)` | Check if a location is covered by a variant |
| `getCoveringVariant(patternId, location)` | Get the variant covering a location |

### Persistence
- Stored in `.drift/variants/` as JSON
- Auto-save with configurable interval (default: 30s)
- Backup before save (keeps last 3 backups)
- Loads all variants on `initialize()`

### Expiration
Variants can have `expires_at` timestamp. Expired variants are automatically filtered out during queries.

### Events
Emits events: `variant:created`, `variant:updated`, `variant:deleted`, `variant:activated`, `variant:deactivated`

---

## Violation Type
```typescript
interface Violation {
  id: string;
  patternId: string;
  patternName: string;
  category: PatternCategory;
  severity: Severity;            // error, warning, info, hint
  message: string;
  file: string;
  range: Range;
  expected: string;
  actual: string;
  quickFixes?: QuickFix[];
  source: string;                // 'drift'
  code?: string;
}
```

---

## Integration Points
- **Quality Gates** — `pattern-check` gate uses RuleEngine to evaluate patterns
- **CLI** — `drift check` runs the rule engine on changed files
- **LSP** — Provides diagnostics (violations) and code actions (quick fixes)
- **MCP** — `drift_validate_change` and `drift_prevalidate` use the evaluator
- **CI** — `drift-ci analyze` runs rule engine with blocking severity check

## v2 Notes
- Evaluator core logic is pure computation — ideal for Rust
- Quick fix generation involves text manipulation — can stay TS (presentation layer)
- Severity manager is configuration — stays TS
- Variant manager is persistence + querying — stays TS
- The pattern matcher (consumed by evaluator) should move to Rust for performance
