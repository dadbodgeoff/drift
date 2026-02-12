# Rules Engine & Violation Generation

## Location
`packages/core/src/rules/`

## Purpose
Takes patterns + file content, runs the pattern matcher, identifies outliers, and generates violations with severity, messages, and quick fixes. This is the final stage of the pattern pipeline — where patterns become actionable feedback.

## Files
- `evaluator.ts` — `Evaluator` class: main evaluation pipeline
- `rule-engine.ts` — `RuleEngine`: higher-level orchestration with pattern context
- `variant-manager.ts` — `VariantManager`: scoped pattern overrides
- `severity-manager.ts` — Severity classification and escalation

---

## Evaluator

### Pipeline

```
Input: EvaluationInput { file, content, ast?, imports, exports }
     + Pattern

1. checkMatch(input, pattern) → boolean
   Uses PatternMatcher to check if pattern applies to this file

2. getMatchDetails(input, pattern) → MatchDetails[]
   Gets specific match locations and confidence

3. evaluate(input, pattern) → EvaluationResult
   - Runs pattern matcher
   - Runs outlier detector on matches
   - Converts outliers to violations
   - Checks for missing patterns (file should have pattern but doesn't)
   - Determines severity
   - Generates quick fixes

4. evaluateAll(input, patterns[]) → EvaluationResult[]
   Evaluates all patterns against a file

5. evaluateFiles(files[], patterns[]) → EvaluationSummary
   Batch evaluation across files
```

### EvaluationInput
```typescript
interface EvaluationInput {
  file: string;
  content: string;
  ast?: AST;
  imports?: ImportInfo[];
  exports?: ExportInfo[];
  language?: string;
}
```

### EvaluationResult
```typescript
interface EvaluationResult {
  file: string;
  patternId: string;
  matches: PatternMatchResult[];
  violations: Violation[];
  confidence: number;
  timestamp: Date;
  duration?: number;
  error?: EvaluationError;
}
```

### EvaluationSummary
```typescript
interface EvaluationSummary {
  totalFiles: number;
  totalPatterns: number;
  totalMatches: number;
  totalViolations: number;
  results: EvaluationResult[];
  duration: number;
  errors: EvaluationError[];
}
```

---

## Violation Generation

Violations are generated from three sources:

### 1. Outlier Locations
Statistical deviations detected by the OutlierDetector:
```
For each outlier in OutlierDetectionResult:
  Create violation with:
    - severity from pattern or severity manager
    - message: "Inconsistent {pattern}: {actual} but project uses {expected}"
    - range from outlier location
    - expected/actual values
```

### 2. Missing Patterns
Files that should have a pattern but don't:
```
shouldHavePattern(input, pattern) → boolean
  Checks if the file type/location suggests the pattern should be present
  e.g., a React component file should have component-structure patterns

If missing:
  Create violation with severity "info"
  Message: "Expected {pattern} not found in {file}"
```

### 3. Rule-Based Checks
Custom rules from the rule engine that produce violations directly.

---

## Violation Structure

```typescript
interface Violation {
  id: string;                    // Generated unique ID
  patternId: string;
  severity: "error" | "warning" | "info" | "hint";
  file: string;
  range: { start: Position; end: Position };
  message: string;
  expected: string;
  actual: string;
  explanation: string;
  quickFixes?: QuickFix[];
  aiExplainAvailable: boolean;
  aiFixAvailable: boolean;
}
```

---

## Severity System

### Default Severity per Category
Each pattern category has a default severity. Security patterns default to "warning", structural to "info", etc.

### Severity Escalation
- Security patterns escalate to "error" when confidence is high
- Configurable via `drift.config.json` severity map
- CI mode can fail builds on specific severity levels

### Severity Override
```typescript
createEvaluatorWithSeverity(severityMap: Record<string, Severity>): Evaluator
```
Allows overriding severity per pattern ID or category.

---

## Variant Manager

Manages scoped pattern overrides (variants):

### Variant Scopes
- **Global** — Apply everywhere
- **Directory** — Apply to specific directories
- **File** — Apply to specific files

### Variant Properties
- Can override: severity, enabled, threshold, custom config
- Can expire (`expires_at` timestamp)
- Stored in `pattern_variants` table

### Resolution Order
File variant > Directory variant > Global variant > Pattern default

---

## EvaluatorConfig

```typescript
interface EvaluatorConfig {
  patternMatcher?: PatternMatcher;
  outlierDetector?: OutlierDetector;
  severityManager?: SeverityManager;
  enableAI?: boolean;                  // Enable AI-powered explanations/fixes
  enableQuickFixes?: boolean;          // Generate quick fixes
  maxViolationsPerFile?: number;       // Limit violations per file
  minConfidence?: number;              // Skip patterns below this confidence
}
```

---

## Quick Fixes

Generated for auto-fixable violations:

```typescript
interface QuickFix {
  title: string;
  edits: WorkspaceEdit[];
}

interface WorkspaceEdit {
  file: string;
  range: { start: Position; end: Position };
  newText: string;
}
```

Each detector can implement `generateQuickFix(violation)` to provide fixes. Not all violations are auto-fixable.

---

## Factory Functions

```typescript
createEvaluator(): Evaluator                              // Default config
createEvaluatorWithConfig(config): Evaluator              // Custom config
createEvaluatorWithAI(): Evaluator                        // AI features enabled
createEvaluatorWithSeverity(severityMap): Evaluator       // Custom severity
```

---

## Rust Rebuild Considerations
- The evaluator pipeline is orchestration — keep as TypeScript or thin Rust wrapper
- Pattern matching (the hot path) should be in Rust
- Outlier detection (math) should be in Rust
- Violation generation is data transformation — straightforward in either language
- Quick fix generation involves text manipulation — Rust's `ropey` crate for large files
- The variant manager's scope resolution is a simple priority lookup — trivial in Rust
- Severity escalation rules are static config — zero-cost in Rust
