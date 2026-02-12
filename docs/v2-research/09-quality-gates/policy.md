# Quality Gates — Policy Engine

## Location
`packages/core/src/quality-gates/policy/`

## Purpose
Policies control which gates run, their thresholds, blocking behavior, and how results are aggregated. The policy engine supports built-in defaults, custom policies, and context-aware policy selection based on branch, path, and author.

## Components

### PolicyLoader (`policy-loader.ts`)
Loads policies from multiple sources.

**Resolution order:**
1. Inline `QualityPolicy` object (passed directly)
2. Built-in policy by ID (`default`, `strict`, `relaxed`, `ci-fast`)
3. Custom policy from `.drift/quality-gates/policies/custom/{id}.json`
4. Context-based matching (branch, paths, author)
5. Fallback to `default` policy

**Context-based loading:**
```typescript
await loader.loadForContext({
  branch: 'feature/auth-refactor',
  paths: ['src/auth/'],
  author: 'dev@example.com'
});
```

Policies are ranked by scope specificity:
- Branch patterns: +10 specificity
- Path patterns: +5
- Author patterns: +3
- Include file patterns: +2
- Exclude file patterns: +1

Most specific matching policy wins.

**Custom policy storage:**
`.drift/quality-gates/policies/custom/{policy-id}.json`

### PolicyEvaluator (`policy-evaluator.ts`)
Evaluates gate results against a policy to determine overall pass/fail.

**4 Aggregation Modes:**

#### `any` (default)
Any blocking gate failure = overall failure. Most common mode.
```
if any gate.status === 'failed' → overall failed
else if any gate.status === 'warned' → overall warned
else → overall passed
```

#### `all`
All gates must fail for overall failure. Lenient mode.
```
if any gate.passed → overall passed
else → overall failed
```

#### `weighted`
Weighted average of gate scores compared to minimum threshold.
```
score = Σ(gate.score × weight) / Σ(weight)
passed = score >= minScore (default: 70)
```

Weights are per-gate, defaulting to 1 if not specified.

#### `threshold`
Simple overall score threshold.
```
score = average of all gate scores
passed = score >= minScore (default: 70)
```

**Required gates:** Specified in `aggregation.requiredGates`. These always block regardless of aggregation mode. If a required gate fails, the overall result is failed.

### Default Policies (`default-policies.ts`)

#### `default` — Balanced
- Pattern compliance: blocking, 80% min compliance, 0.7 min confidence
- Constraint verification: blocking, approved only, 0.9 min confidence
- Regression detection: warning only, 5% max confidence drop, 10% max compliance drop
- Impact simulation: warning only, 20 max files, 50 max functions
- Security boundary: blocking, no new sensitive access, protected tables: users/payments/credentials/tokens
- Custom rules: disabled

#### `strict` — Main/Release Branches
Scope: `main`, `master`, `release/*`
- Everything blocking with tighter thresholds
- 90% min compliance, 0.8 min confidence
- Regression blocks at 2% confidence drop
- Impact blocks at 15 files, 30 functions
- Custom rules enabled with built-in rules

#### `relaxed` — Feature Branches
Scope: `feature/*`, `fix/*`, `chore/*`
- 70% min compliance, allows 3 new outliers
- Constraints warn only
- Regression detection skipped
- Impact warns only with loose thresholds
- Security still blocks but allows new access
- Custom rules skipped

#### `ci-fast` — Minimal CI
- Only pattern compliance enabled (70% threshold)
- Everything else skipped
- Fastest possible CI feedback

## Policy Structure
```typescript
interface QualityPolicy {
  id: string;
  name: string;
  description: string;
  version: string;
  scope: PolicyScope;
  gates: PolicyGateConfigs;       // Per-gate config or 'skip'
  aggregation: AggregationConfig;
  actions: PolicyActions;         // onPass, onFail, onWarn hooks
  metadata: { createdAt, updatedAt };
}

interface PolicyScope {
  branches?: string[];            // Glob patterns
  paths?: string[];               // Path patterns
  authors?: string[];             // Author patterns
  includeFiles?: string[];
  excludeFiles?: string[];
}

interface AggregationConfig {
  mode: 'any' | 'all' | 'weighted' | 'threshold';
  requiredGates?: GateId[];
  weights?: Record<GateId, number>;
  minScore?: number;              // For weighted/threshold modes
}
```

## V2 Notes
- Policy engine is pure configuration logic — stays TS
- Context-based policy selection is a nice feature — preserve
- The 4 aggregation modes cover all common CI patterns
- Custom policies should support YAML in addition to JSON
- Consider: policy inheritance (extend a built-in policy with overrides)
