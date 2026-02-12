# Gene Extractors

## Location
`packages/core/src/dna/gene-extractors/`

## Purpose
10 regex-based extractors that identify coding convention variants (alleles) within source files. Each extractor targets a single "gene" — one concern like "how do we handle component variants?" or "what logging format do we use?"

## Files
- `base-extractor.ts` — `BaseGeneExtractor`: abstract base class
- `variant-handling.ts` — `VariantHandlingExtractor`
- `responsive-approach.ts` — `ResponsiveApproachExtractor`
- `state-styling.ts` — `StateStylingExtractor`
- `theming.ts` — `ThemingExtractor`
- `spacing-philosophy.ts` — `SpacingPhilosophyExtractor`
- `animation-approach.ts` — `AnimationApproachExtractor`
- `api-response-format.ts` — `ApiResponseFormatExtractor`
- `error-response-format.ts` — `ErrorResponseFormatExtractor`
- `logging-format.ts` — `LoggingFormatExtractor`
- `config-pattern.ts` — `ConfigPatternExtractor`
- `index.ts` — Factory functions

## BaseGeneExtractor

Abstract base class that all extractors extend. Provides the full extraction → aggregation → gene-building pipeline.

### Abstract Methods (each extractor implements)
```typescript
abstract readonly geneId: GeneId;
abstract readonly geneName: string;
abstract readonly geneDescription: string;
abstract getAlleleDefinitions(): AlleleDefinition[];
abstract extractFromFile(filePath: string, content: string, imports: string[]): FileExtractionResult;
```

### AlleleDefinition
```typescript
interface AlleleDefinition {
  id: AlleleId;           // e.g., 'cva-variants'
  name: string;           // e.g., 'CVA (Class Variance Authority)'
  description: string;
  patterns: RegExp[];     // Regex patterns to detect this allele
  keywords?: string[];    // Additional keyword matching
  importPatterns?: RegExp[];  // Import-based detection
  priority?: number;
}
```

### Pipeline: `analyze(files) → Gene`

1. **`aggregateResults(files)`** — iterates all files:
   - Calls `extractFromFile()` per file
   - Tallies `alleleCounts` (Map<AlleleId, number>)
   - Tracks `alleleFiles` (Map<AlleleId, Set<string>>)
   - Collects `alleleExamples` (up to 5 per allele)

2. **`buildGene(aggregated)`** — converts counts into a Gene:
   - Calculates frequency per allele: `count / totalOccurrences`
   - Sorts alleles by frequency descending
   - Selects dominant: top allele if frequency ≥ 0.3
   - Confidence = dominant allele's frequency
   - Consistency = `0.5 + (dominant - second) * 0.5`, clamped to [0, 1]
   - Exemplars = up to 5 files from the dominant allele's file set

### DetectedAllele (per-file output)
```typescript
interface DetectedAllele {
  alleleId: AlleleId;
  line: number;
  code: string;
  confidence: number;
  context?: string;
}
```

### FileExtractionResult
```typescript
interface FileExtractionResult {
  file: string;
  detectedAlleles: DetectedAllele[];
  isComponent: boolean;
  errors?: string[];
}
```

### Helper Methods
- `isComponentFile(filePath, content)` — checks extension (.tsx, .jsx, .vue, .svelte) + export pattern
- `extractImports(content)` — regex extraction of import statements
- `extractContext(content, matchIndex)` — gets line number + surrounding 5 lines for a regex match

## Factory Functions

```typescript
createAllGeneExtractors()        → Map<GeneId, BaseGeneExtractor>  // All 10
createFrontendGeneExtractors()   → Map<GeneId, BaseGeneExtractor>  // 6 frontend
createBackendGeneExtractors()    → Map<GeneId, BaseGeneExtractor>  // 4 backend
createGeneExtractor(geneId)      → BaseGeneExtractor | null        // Single by ID
```

## Rust Rebuild Considerations
- All extraction is regex-based — Rust's `regex` crate is significantly faster
- The aggregation/gene-building is pure data transformation — straightforward port
- AlleleDefinitions are static config — zero-cost Rust structs
- The `isComponentFile` heuristic is simple string matching — trivial in Rust
