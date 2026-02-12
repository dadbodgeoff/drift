# Quality Gates — Gate Implementations

## Location
`packages/core/src/quality-gates/gates/`

## Base Gate (`base-gate.ts`)
Abstract base class all gates extend. Provides:
- Execution wrapper with error handling and timing
- Config validation interface
- Score calculation from violations (error=10, warning=3, info=1 penalty)
- Status determination (failed/warned/passed)
- Helper methods for creating passed/failed/warned/skipped/error results
- Violation ID generation: `{gateId}-{file}-{line}-{ruleId}`

**Fail-safe design:** Errored gates return `passed: true` — they don't block.

---

## 1. Pattern Compliance Gate
`gates/pattern-compliance/pattern-compliance-gate.ts`

**What it checks:** Are approved patterns being followed? Are there new outliers?

**Config:**
```typescript
interface PatternComplianceConfig {
  enabled: boolean;
  blocking: boolean;
  minComplianceRate: number;      // 0-100, default: 80
  maxNewOutliers: number;         // default: 0
  categories: string[];           // empty = all
  minPatternConfidence: number;   // default: 0.7
  approvedOnly: boolean;          // default: true
}
```

**Algorithm:**
1. Filter patterns by config (categories, confidence, approved-only)
2. Calculate compliance rate per pattern: `locations / (locations + outliers)`
3. Detect new outliers (outliers in changed files not in previous snapshot)
4. Evaluate thresholds: compliance rate vs minimum, new outliers vs maximum
5. Generate violations for non-compliant patterns and new outliers

**Score:** Based on overall compliance rate across all patterns.

---

## 2. Constraint Verification Gate
`gates/constraint-verification/constraint-verification-gate.ts`

**What it checks:** Do code changes satisfy architectural constraints?

**Config:**
```typescript
interface ConstraintVerificationConfig {
  enabled: boolean;
  blocking: boolean;
  enforceApproved: boolean;       // default: true
  enforceDiscovered: boolean;     // default: false
  minConfidence: number;          // default: 0.9
  categories: string[];           // empty = all
}
```

**Algorithm:**
1. Filter constraints by status (approved, optionally discovered), confidence, categories
2. For each constraint, find applicable files from the changed file set
3. Verify each constraint against applicable files using ConstraintVerifier
4. Collect violations with severity from constraint enforcement level

---

## 3. Regression Detection Gate
`gates/regression-detection/regression-detection-gate.ts`

**What it checks:** Has pattern confidence or compliance dropped compared to a baseline?

**Config:**
```typescript
interface RegressionDetectionConfig {
  enabled: boolean;
  blocking: boolean;
  maxConfidenceDrop: number;      // percentage points, default: 5
  maxComplianceDrop: number;      // percentage points, default: 10
  maxNewOutliersPerPattern: number; // default: 3
  criticalCategories: string[];   // default: ['auth', 'security']
  baseline: 'branch-base' | 'previous-run' | 'snapshot';
}
```

**Algorithm:**
1. Load baseline snapshot (previous run on same branch, or branch-base)
2. Compare current patterns against baseline:
   - Confidence drops per pattern
   - Compliance rate drops per pattern
   - New outlier counts per pattern
3. Classify regression severity:
   - Critical: confidence drop > 2× threshold, or in critical category
   - High: confidence drop > threshold
   - Medium: compliance drop > threshold
   - Low: new outliers > threshold
4. Calculate per-category deltas and overall delta
5. Generate violations for regressions exceeding thresholds

**Improvements tracked:** Patterns that improved (confidence up, outliers down) are reported as positive signals.

---

## 4. Impact Simulation Gate
`gates/impact-simulation/impact-simulation-gate.ts`

**What it checks:** How large is the blast radius of the change?

**Config:**
```typescript
interface ImpactSimulationConfig {
  enabled: boolean;
  blocking: boolean;
  maxFilesAffected: number;       // default: 20
  maxFunctionsAffected: number;   // default: 50
  maxEntryPointsAffected: number; // default: 10
  maxFrictionScore: number;       // 0-100, default: 60
  analyzeSensitiveData: boolean;  // default: true
}
```

**Algorithm:**
1. For each changed file, find functions in the call graph
2. Trace callers (reverse reachability) to find affected functions
3. Identify affected entry points (API handlers, exported functions)
4. If `analyzeSensitiveData`: trace data access paths through affected functions
5. Calculate friction score based on: files affected, functions affected, entry points, sensitive data paths
6. Classify breaking risk: critical (>80 friction), high (>60), medium (>40), low

**Friction Score:**
```
frictionScore = (filesAffected/maxFiles × 25) + (functionsAffected/maxFunctions × 25) 
              + (entryPointsAffected/maxEntryPoints × 30) + (sensitiveDataPaths × 20)
```

---

## 5. Security Boundary Gate
`gates/security-boundary/security-boundary-gate.ts`

**What it checks:** Is sensitive data accessed without authentication? Are there unauthorized access paths?

**Config:**
```typescript
interface SecurityBoundaryConfig {
  enabled: boolean;
  blocking: boolean;
  allowNewSensitiveAccess: boolean;  // default: false
  protectedTables: string[];         // default: ['users', 'payments', 'credentials', 'tokens']
  maxDataFlowDepth: number;          // default: 5
  requiredAuthPatterns: string[];    // default: ['authenticate', 'authorize', 'checkAuth', 'requireAuth']
}
```

**Algorithm:**
1. For each changed file, detect data access points (table/field access)
2. Filter for protected tables
3. For each access point, check if auth exists in the call chain:
   - Walk callers up the call graph
   - Look for functions matching `requiredAuthPatterns`
   - Track depth of auth check
4. Identify unauthorized paths (data access without auth in call chain)
5. Check for new sensitive data access (not in previous snapshot)

---

## 6. Custom Rules Gate
`gates/custom-rules/custom-rules-gate.ts`

**What it checks:** User-defined rules with 6 condition types.

**Config:**
```typescript
interface CustomRulesConfig {
  enabled: boolean;
  blocking: boolean;
  ruleFiles: string[];            // Paths to rule JSON files
  inlineRules: CustomRule[];      // Inline rule definitions
  useBuiltInRules: boolean;      // default: false
}
```

**Rule Structure:**
```typescript
interface CustomRule {
  id: string;
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  condition: RuleCondition;
  message: string;
  suggestion?: string;
}
```

**6 Condition Types:**

| Type | What It Checks |
|------|---------------|
| `file-pattern` | Files matching glob must/must-not exist |
| `content-pattern` | File content must/must-not match regex |
| `dependency` | Package must/must-not be in dependencies |
| `naming` | Files/functions must follow naming convention |
| `structure` | Directory must contain required files |
| `composite` | AND/OR/NOT combinations of other conditions |

**Built-in Rules (when `useBuiltInRules: true`):**
- No `console.log` in production code
- No `TODO` or `FIXME` in committed code
- Test files must exist for source files
- No hardcoded secrets (API keys, passwords)

## V2 Notes
- Pattern compliance and security boundary do heavy analysis — should call Rust
- Regression detection is comparison logic — can stay TS
- Impact simulation uses call graph traversal — should call Rust
- Custom rules condition evaluation is regex/glob — could go either way
- The base gate pattern (error handling, scoring, fail-safe) is solid — preserve
