# DNA Analyzer

## Location
`packages/core/src/dna/dna-analyzer.ts`

## Purpose
Main orchestrator for DNA analysis. Discovers files, runs gene extractors, detects mutations, calculates health, and assembles the complete `StylingDNAProfile`.

## Configuration

```typescript
interface DNAAnalyzerConfig {
  rootDir: string;
  componentPaths?: string[];   // Default: ['src/components', 'src/features']
  backendPaths?: string[];     // Default: ['src', 'app', 'api', 'routes', 'handlers', 'controllers', 'services']
  excludePaths?: string[];     // Default: ['**/*.test.*', '**/*.stories.*', '**/index.ts']
  thresholds?: Partial<DNAThresholds>;
  verbose?: boolean;
  mode?: 'frontend' | 'backend' | 'all';  // Default: 'all'
}
```

## Pipeline

### 1. Initialize
Creates gene extractors based on `mode`:
- `'frontend'` → `createFrontendGeneExtractors()` (6 extractors)
- `'backend'` → `createBackendGeneExtractors()` (4 extractors)
- `'all'` → `createAllGeneExtractors()` (10 extractors)

Also initializes `HealthCalculator` and `MutationDetector` with configured thresholds.

### 2. Discover Files
Walks `componentPaths` (frontend) and `backendPaths` (backend) relative to `rootDir`. Applies `excludePaths` glob filters.

### 3. Extract Genes
For each extractor in the map, calls `extractor.analyze(files)` which:
1. Iterates all files, calling `extractFromFile()` per file
2. Aggregates allele counts, file sets, and examples
3. Builds a `Gene` with dominant selection, confidence, and consistency

### 4. Detect Mutations
`MutationDetector.detectMutations(genes, files)` — for each gene with a dominant allele, every occurrence of a non-dominant allele becomes a mutation.

### 5. Calculate Health
`HealthCalculator.calculateHealthScore(genes, mutations)` — weighted composite score.

### 6. Assemble Profile
Returns `AnalysisResult`:

```typescript
interface AnalysisResult {
  profile: StylingDNAProfile;
  stats: {
    totalFiles: number;
    componentFiles: number;
    backendFiles: number;
    filesAnalyzed: number;
    duration: number;
    genesAnalyzed: number;
  };
  errors: string[];
}
```

## Rust Rebuild Considerations
- File discovery is I/O-bound — Rust's parallel walker would help on large codebases
- The orchestration logic is straightforward — direct port
- Gene extraction is the hot path — regex matching benefits most from Rust
