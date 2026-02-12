# Quality Gates — Types

## Location
`packages/core/src/quality-gates/types.ts` (~1300 lines, 40+ interfaces)

## Gate IDs
```typescript
type GateId = 
  | 'pattern-compliance'
  | 'constraint-verification'
  | 'regression-detection'
  | 'impact-simulation'
  | 'security-boundary'
  | 'custom-rules';
```

## Gate Statuses
```typescript
type GateStatus = 'passed' | 'failed' | 'warned' | 'skipped' | 'errored';
```

## Output Formats
```typescript
type OutputFormat = 'json' | 'text' | 'sarif' | 'github' | 'gitlab';
```

## Core Types

### Gate Interface
```typescript
interface Gate {
  readonly id: GateId;
  readonly name: string;
  readonly description: string;
  execute(input: GateInput): Promise<GateResult>;
  validateConfig(config: GateConfig): { valid: boolean; errors: string[] };
  getDefaultConfig(): GateConfig;
}
```

### GateInput
```typescript
interface GateInput {
  files: string[];                    // Files to check
  config: GateConfig;                 // Gate-specific configuration
  context: GateContext;               // Shared context (patterns, constraints, call graph)
  previousSnapshot?: HealthSnapshot;  // For regression detection
}
```

### GateContext
```typescript
interface GateContext {
  projectRoot: string;
  patterns: Pattern[];
  constraints: Constraint[];
  callGraph?: CallGraph;
  customRules?: CustomRule[];
}
```

### GateResult
```typescript
interface GateResult {
  gateId: GateId;
  gateName: string;
  status: GateStatus;
  passed: boolean;
  score: number;                      // 0-100
  summary: string;
  violations: GateViolation[];
  warnings: string[];
  executionTimeMs: number;
  details: Record<string, unknown>;   // Gate-specific details
  error?: string;
}
```

### GateViolation
```typescript
interface GateViolation {
  id: string;                         // "{gateId}-{file}-{line}-{ruleId}"
  gateId: GateId;
  ruleId: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  file: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  suggestion?: string;
  details?: Record<string, unknown>;
}
```

## Per-Gate Detail Types

### PatternComplianceDetails
```typescript
interface PatternComplianceDetails {
  totalPatterns: number;
  checkedPatterns: number;
  complianceRate: number;
  newOutliers: number;
  outlierDetails: OutlierDetail[];
  byCategory: Record<string, { patterns: number; compliance: number }>;
}
```

### RegressionDetectionDetails
```typescript
interface RegressionDetectionDetails {
  baselineSource: string;
  regressions: PatternRegression[];
  improvements: PatternImprovement[];
  categoryDeltas: Record<string, number>;
  overallDelta: number;
}

interface PatternRegression {
  patternId: string;
  patternName: string;
  category: string;
  previousConfidence: number;
  currentConfidence: number;
  confidenceDelta: number;
  previousCompliance: number;
  currentCompliance: number;
  complianceDelta: number;
  newOutliers: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
}
```

### ImpactSimulationDetails
```typescript
interface ImpactSimulationDetails {
  filesAffected: number;
  functionsAffected: number;
  entryPointsAffected: number;
  sensitiveDataPaths: SensitiveDataPath[];
  frictionScore: number;
  breakingRisk: 'critical' | 'high' | 'medium' | 'low';
  affectedFiles: AffectedFile[];
}
```

### SecurityBoundaryDetails
```typescript
interface SecurityBoundaryDetails {
  dataAccessPoints: DataAccessPoint[];
  unauthorizedPaths: UnauthorizedPath[];
  newSensitiveAccess: number;
  protectedTablesAccessed: string[];
  authCoverage: number;
}
```

### CustomRulesDetails
```typescript
interface CustomRulesDetails {
  totalRules: number;
  rulesEvaluated: number;
  rulesPassed: number;
  rulesFailed: number;
  results: RuleResult[];
}
```

## Custom Rule Condition Types
```typescript
type RuleCondition =
  | FilePatternCondition      // Glob matching on file paths
  | ContentPatternCondition   // Regex matching on file content
  | DependencyCondition       // Package dependency checks
  | NamingCondition           // Naming convention enforcement
  | StructureCondition        // Directory structure requirements
  | CompositeCondition;       // AND/OR/NOT combinations
```

## V2 Notes
- The type system is comprehensive (~1300 lines) — preserve the interfaces
- Per-gate detail types enable rich reporting — keep them
- Custom rule conditions are extensible — consider adding AST-based conditions in v2
- The GateViolation format aligns with SARIF — good for compliance
