# Decision Mining Types

## Location
`packages/core/src/decisions/types.ts`

## Core Enums

```typescript
type DecisionLanguage = 'typescript' | 'javascript' | 'python' | 'java'
  | 'csharp' | 'php' | 'rust' | 'cpp';

type DecisionConfidence = 'high' | 'medium' | 'low';
type DecisionStatus = 'draft' | 'confirmed' | 'superseded' | 'rejected';

type DecisionCategory =
  | 'technology-adoption' | 'technology-removal'
  | 'pattern-introduction' | 'pattern-migration'
  | 'architecture-change' | 'api-change'
  | 'security-enhancement' | 'performance-optimization'
  | 'refactoring' | 'testing-strategy'
  | 'infrastructure' | 'other';
```

## Delta Types (extraction output)

```typescript
interface PatternDelta {
  // Pattern added, removed, or modified in a commit
}

interface FunctionDelta {
  // Function added, removed, modified, or renamed
}

interface DependencyDelta {
  // Package added, removed, or version changed
}

interface MessageSignal {
  // Keyword extracted from commit message (breaking, deprecation, etc.)
}

interface ArchitecturalSignal {
  // Structural change detected from diffs
}
```

## Clustering Types

```typescript
interface CommitCluster {
  commits: GitCommit[];
  reasons: ClusterReason[];     // Why these commits were grouped
  similarityScore: number;
  aggregatedChanges: {
    patterns: PatternDelta[];
    functions: FunctionDelta[];
    dependencies: DependencyDelta[];
  };
}

interface ClusterReason {
  type: 'temporal' | 'file-overlap' | 'pattern-similarity';
  description: string;
  score: number;
}
```

## Decision Types

```typescript
interface MinedDecision {
  id: string;
  title: string;
  status: DecisionStatus;
  category: DecisionCategory;
  confidence: DecisionConfidence;
  cluster: CommitCluster;
  adr: SynthesizedADR;
  codeLocations: CodeLocation[];
  tags: string[];
}

interface SynthesizedADR {
  context: string;              // Why the decision was needed
  decision: string;             // What was decided
  consequences: string[];       // Positive and negative outcomes
  alternatives: string[];       // Other approaches considered
  references: ADRReference[];
  evidence: ADREvidence[];
}

interface CodeLocation {
  file: string;
  line?: number;
  description: string;
}
```

## Result Types

```typescript
interface DecisionMiningResult {
  decisions: MinedDecision[];
  summary: DecisionMiningSummary;
  errors: MiningError[];
  warnings: string[];
}

interface DecisionMiningSummary {
  totalCommitsAnalyzed: number;
  totalClustersFound: number;
  totalDecisionsMined: number;
  byCategory: Record<DecisionCategory, number>;
  byConfidence: Record<DecisionConfidence, number>;
  timeRange: { from: Date; to: Date };
}

interface MiningError {
  type: 'git-error' | 'extraction-error' | 'clustering-error' | 'synthesis-error';
  message: string;
  stack?: string;
}
```

## Store Types

```typescript
interface DecisionStoreConfig {
  rootDir: string;
}

interface DecisionIndex {
  decisions: MinedDecision[];
  lastMined: string;
}
```
