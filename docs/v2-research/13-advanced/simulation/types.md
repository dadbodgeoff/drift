# Simulation Engine Types

## Location
`packages/core/src/simulation/types.ts`

## Task Types

```typescript
type TaskCategory =
  | 'rate-limiting' | 'authentication' | 'authorization'
  | 'api-endpoint' | 'data-access' | 'error-handling'
  | 'caching' | 'logging' | 'testing'
  | 'validation' | 'middleware' | 'refactoring' | 'generic';

interface SimulationTask {
  description: string;
  category?: TaskCategory;
  target?: string;
  constraints?: SimulationConstraint[];
  scope?: 'function' | 'file' | 'module' | 'codebase';
}

type ConstraintType = 'must-work-with' | 'avoid-changing' | 'max-files'
  | 'pattern-required' | 'framework-required' | 'custom';

interface SimulationConstraint {
  type: ConstraintType;
  value: string;
  description?: string;
  required?: boolean;
}
```

## Approach Types

```typescript
type ApproachStrategy =
  | 'middleware' | 'decorator' | 'wrapper' | 'per-route' | 'per-function'
  | 'centralized' | 'distributed' | 'aspect' | 'filter' | 'interceptor'
  | 'guard' | 'policy' | 'dependency' | 'mixin' | 'custom';

interface SimulationApproach {
  id: string;
  name: string;
  description: string;
  strategy: ApproachStrategy;
  language: CallGraphLanguage;
  framework?: string;
  targetFiles: string[];
  targetFunctions?: string[];
  newFiles?: string[];
  followsPatterns?: string[];
  estimatedLinesAdded?: number;
  estimatedLinesModified?: number;
  template?: string;
  frameworkNotes?: string;
}
```

## Scoring Types

```typescript
interface ScoringWeights {
  friction: number;            // Default: 0.30
  impact: number;              // Default: 0.25
  patternAlignment: number;    // Default: 0.30
  security: number;            // Default: 0.15
}

interface SimulationOptions {
  maxApproaches: number;       // Default: 5
  maxDepth: number;            // Default: 10
  includeSecurityAnalysis: boolean;
  minPatternConfidence: number;
  timeout: number;             // Default: 30000ms
  enableCache: boolean;
}
```

## Metric Types

```typescript
interface FrictionMetrics {
  codeChurn: number;
  patternDeviation: number;
  testingEffort: number;
  refactoringRequired: number;
  learningCurve: number;
  overallScore: number;
  reasoning: string[];
}

interface ImpactMetrics {
  filesAffected: number;
  functionsAffected: number;
  entryPointsAffected: number;
  sensitiveDataPaths: number;
  riskScore: number;
  riskLevel: RiskLevel;        // 'low' | 'medium' | 'high' | 'critical'
  breakingChanges: boolean;
  breakingChangeRisks: string[];
  maxDepthAffected: number;
}

interface PatternAlignmentMetrics {
  alignmentScore: number;
  alignedPatterns: string[];
  conflictingPatterns: string[];
  outlierRisk: boolean;
  suggestedPatterns: string[];
}

interface SecurityMetrics {
  securityRisk: number;
  dataAccessImplications: DataAccessImplication[];
  authImplications: string[];
  warnings: string[];
}
```

## Result Types

```typescript
interface SimulatedApproach {
  approach: SimulationApproach;
  friction: FrictionMetrics;
  impact: ImpactMetrics;
  patternAlignment: PatternAlignmentMetrics;
  security: SecurityMetrics;
  compositeScore: number;
  rank: number;
  reasoning: string;
  pros: string[];
  cons: string[];
  warnings: string[];
  nextSteps: string[];
}

interface SimulationResult {
  task: SimulationTask;
  approaches: SimulatedApproach[];
  recommended: SimulatedApproach;
  summary: string;
  tradeoffs: ApproachTradeoff[];
  confidence: number;
  metadata: {
    duration: number;
    callGraphAvailable: boolean;
    patternsAvailable: boolean;
  };
}

interface ApproachTradeoff {
  approach1: string;
  approach2: string;
  comparison: string;
  winner?: string;
}
```
