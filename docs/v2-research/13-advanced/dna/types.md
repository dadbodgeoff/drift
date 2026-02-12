# DNA Types

## Location
`packages/core/src/dna/types.ts`

## Gene ID Types

```typescript
// Frontend styling genes
type FrontendGeneId = 'variant-handling' | 'responsive-approach' | 'state-styling'
  | 'theming' | 'spacing-philosophy' | 'animation-approach';

// Backend pattern genes
type BackendGeneId = 'api-response-format' | 'error-response-format'
  | 'logging-format' | 'config-pattern';

// Combined
type GeneId = FrontendGeneId | BackendGeneId;
```

## Framework Types
```typescript
type StylingFramework = 'tailwind' | 'css-modules' | 'styled-components'
  | 'emotion' | 'vanilla-css' | 'scss' | 'mixed';

type BackendFramework = 'fastapi' | 'flask' | 'django' | 'express' | 'nestjs'
  | 'spring' | 'laravel' | 'gin' | 'actix' | 'unknown';
```

## Core Types

### Gene
```typescript
interface Gene {
  id: GeneId;
  name: string;
  description: string;
  dominant: Allele | null;    // Most common variant (≥30% frequency)
  alleles: Allele[];          // All detected variants, sorted by frequency
  confidence: number;         // Dominant allele frequency (0–1)
  consistency: number;        // Gap between dominant and second (0–1)
  exemplars: string[];        // Up to 5 files demonstrating dominant
}
```

### Allele
```typescript
interface Allele {
  id: AlleleId;
  name: string;
  description: string;
  frequency: number;          // Proportion of occurrences (0–1)
  fileCount: number;
  pattern: string;            // Regex source(s) joined by |
  examples: AlleleExample[];  // Up to 5 code examples
  isDominant: boolean;
}
```

### AlleleExample
```typescript
interface AlleleExample {
  file: string;
  line: number;
  code: string;
  context: string;
}
```

### Mutation
```typescript
interface Mutation {
  id: string;                 // SHA-256 hash (16 chars)
  file: string;
  line: number;
  gene: GeneId;
  expected: AlleleId;
  actual: AlleleId;
  impact: MutationImpact;     // 'low' | 'medium' | 'high'
  code: string;
  suggestion: string;
  detectedAt: string;
  resolved: boolean;
  resolvedAt?: string;
}
```

### StylingDNAProfile
```typescript
interface StylingDNAProfile {
  version: '1.0.0';
  generatedAt: string;
  projectRoot: string;
  summary: DNASummary;
  genes: Record<GeneId, Gene>;
  mutations: Mutation[];
  evolution: EvolutionEntry[];
}
```

### DNASummary
```typescript
interface DNASummary {
  totalComponentsAnalyzed: number;
  totalFilesAnalyzed: number;
  healthScore: number;
  geneticDiversity: number;
  dominantFramework: StylingFramework;
  dominantBackendFramework?: BackendFramework;
  lastUpdated: string;
}
```

### EvolutionEntry
```typescript
interface EvolutionEntry {
  timestamp: string;
  commitHash?: string;
  healthScore: number;
  geneticDiversity: number;
  changes: EvolutionChange[];
}

interface EvolutionChange {
  type: 'gene_shift' | 'mutation_introduced' | 'mutation_resolved' | 'new_allele';
  gene?: GeneId;
  description: string;
  files?: string[];
}
```

## Constants
```typescript
const DNA_VERSION = '1.0.0';
const FRONTEND_GENE_IDS: readonly FrontendGeneId[] = [6 IDs];
const BACKEND_GENE_IDS: readonly BackendGeneId[] = [4 IDs];
const GENE_IDS: readonly GeneId[] = [...FRONTEND, ...BACKEND];  // 10 total
```
