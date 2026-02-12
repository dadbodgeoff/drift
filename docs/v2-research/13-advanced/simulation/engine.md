# Simulation Engine

## Location
`packages/core/src/simulation/simulation-engine.ts`

## Purpose
Main orchestrator for the speculative execution engine. Coordinates approach generation, multi-dimensional scoring, ranking, and recommendation.

## Configuration

```typescript
interface SimulationEngineConfig {
  projectRoot: string;
  callGraph?: CallGraph;           // Optional — degrades gracefully without it
  patternService?: IPatternService; // Optional — for alignment scoring
  weights?: Partial<ScoringWeights>;
  options?: Partial<SimulationOptions>;
}
```

### Default Weights
```typescript
{
  friction: 0.30,
  impact: 0.25,
  patternAlignment: 0.30,
  security: 0.15,
}
```

### Default Options
```typescript
{
  maxApproaches: 5,
  maxDepth: 10,
  includeSecurityAnalysis: true,
  minPatternConfidence: 0.5,
  timeout: 30000,
  enableCache: true,
}
```

## Internal Components

On construction, the engine initializes:
- `ApproachGenerator` — generates candidate approaches
- `FrictionScorer` — development friction estimation
- `ImpactScorer` — change impact scoring (uses call graph)
- `PatternAlignmentScorer` — pattern compliance scoring (uses pattern service)
- `SecurityScorer` — security risk scoring (uses call graph)

## Pipeline: `simulate(task) → SimulationResult`

### Step 1: Generate Approaches
`ApproachGenerator.generate(task)` produces up to `maxApproaches` candidate `SimulationApproach` objects, each with a strategy, target files, and estimated effort.

### Step 2: Score Each Approach
For each approach, all 4 scorers run in parallel:
- `FrictionScorer.score(approach) → FrictionMetrics`
- `ImpactScorer.score(approach) → ImpactMetrics`
- `PatternAlignmentScorer.score(approach) → PatternAlignmentMetrics`
- `SecurityScorer.score(approach) → SecurityMetrics`

### Step 3: Compute Composite Score
```
compositeScore = friction * 0.30 + impact * 0.25 + alignment * 0.30 + security * 0.15
```
Each scorer returns a 0–100 score. The composite is a weighted average.

### Step 4: Rank and Recommend
Approaches are sorted by composite score (highest first). The top approach becomes the recommendation. Each `SimulatedApproach` includes:
- All 4 score breakdowns
- Rank position
- Reasoning text
- Pros and cons
- Warnings
- Suggested next steps

### Step 5: Generate Tradeoffs
Pairwise comparison between top approaches, highlighting where each excels.

### Step 6: Calculate Confidence
Overall confidence in the recommendation based on score gap between #1 and #2, pattern alignment strength, and data availability (call graph present vs. estimated).

## Result

```typescript
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
```

## Rust Rebuild Considerations
- The orchestration logic is lightweight — stays in TypeScript
- Individual scorers could call Rust for heavy computation (impact analysis, pattern matching)
- The composite scoring is arithmetic — trivial either way
