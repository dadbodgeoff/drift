# Decision Mining Analyzer

## Location
`packages/core/src/decisions/analyzer/decision-mining-analyzer.ts`

## Purpose
Main orchestrator for the decision mining pipeline. Coordinates git walking, semantic extraction, clustering, and ADR synthesis.

## Configuration

```typescript
interface DecisionMiningOptions {
  rootDir: string;
  since?: Date;                  // Start date for git history
  until?: Date;                  // End date
  maxCommits?: number;           // Default: 1000
  minClusterSize?: number;       // Default: 2 (minimum commits to form a cluster)
  minConfidence?: number;        // Default: 0.5
  includeMergeCommits?: boolean; // Default: false
  excludePaths?: string[];       // Glob patterns to skip
  usePatternData?: boolean;      // Use existing pattern data for richer extraction
  verbose?: boolean;
}
```

## Pipeline: `mine() → DecisionMiningResult`

### Step 1: Walk Git History
Creates a `GitWalker` with configured options and calls `walk()`. Returns `GitWalkResult` with an array of `GitCommit` objects.

On failure, returns an error result with `type: 'git-error'`.

### Step 2: Semantic Extraction
For each commit, selects the appropriate language extractor based on file extensions. Creates all extractors upfront via `createAllCommitExtractors()`.

Each extractor produces a `CommitSemanticExtraction`:
- `patterns` — patterns added, removed, or modified
- `functions` — functions added, removed, modified, renamed
- `dependencies` — packages added, removed, version changes
- `messageSignals` — keywords from commit message
- `architecturalSignals` — structural changes from diffs
- `significance` — overall significance score

### Step 3: Clustering
Groups related commits into `CommitCluster` objects based on:
- **Temporal proximity** — commits close in time
- **File overlap** — commits touching the same files
- **Pattern similarity** — commits affecting the same patterns

Each cluster has `ClusterReason[]` explaining the grouping and a similarity score.

### Step 4: Decision Synthesis
Each cluster is synthesized into a `MinedDecision` with a `SynthesizedADR`:

```typescript
interface SynthesizedADR {
  context: string;          // Why the decision was needed
  decision: string;         // What was decided
  consequences: string[];   // Positive and negative outcomes
  alternatives: string[];   // Other approaches considered
  references: ADRReference[];
  evidence: ADREvidence[];
}
```

## Result

```typescript
interface DecisionMiningResult {
  decisions: MinedDecision[];
  summary: DecisionMiningSummary;
  errors: MiningError[];
  warnings: string[];
}
```

## Usage

```typescript
import { createDecisionMiningAnalyzer } from '@drift/core/decisions';

const analyzer = createDecisionMiningAnalyzer({
  rootDir: '/path/to/repo',
  since: new Date('2024-01-01'),
  minConfidence: 0.5,
});

const result = await analyzer.mine();
console.log(`Found ${result.decisions.length} architectural decisions`);
```

## Rust Rebuild Considerations
- The orchestration logic is lightweight — could stay in TypeScript
- The clustering algorithm is compute-light — either side
- ADR synthesis may involve AI — stays in TypeScript
