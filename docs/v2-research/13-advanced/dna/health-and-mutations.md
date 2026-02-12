# Health Calculator & Mutation Detector

## Location
- `packages/core/src/dna/health-calculator.ts`
- `packages/core/src/dna/mutation-detector.ts`

---

## Health Calculator

### Purpose
Computes a 0–100 health score and genetic diversity metric for a DNA profile.

### Health Score Formula

```
healthScore = consistency(40%) + confidence(30%) + mutations(20%) + coverage(10%)
```

| Component | Weight | Calculation |
|-----------|--------|-------------|
| Consistency | 40% | `avgConsistency * 40` — average consistency across all genes |
| Confidence | 30% | `avgConfidence * 30` — average dominant allele frequency |
| Mutation penalty | 20% | `(1 - mutationPenalty) * 20` — penalty scales with mutation count relative to gene count |
| Dominant coverage | 10% | `dominantCoverage * 10` — proportion of genes that have a dominant allele |

Result is clamped to [0, 100] and rounded.

### Genetic Diversity
Measures how many distinct alleles exist across all genes, normalized. Higher diversity means more competing approaches (not necessarily bad — it's informational).

### Thresholds
```typescript
const DEFAULT_DNA_THRESHOLDS = {
  dominantMinFrequency: 0.6,   // Minimum to be considered "dominant"
  mutationImpactHigh: 0.1,     // Below this frequency = high impact
  mutationImpactMedium: 0.3,   // Below this = medium impact
  healthScoreWarning: 70,      // Below = warning
  healthScoreCritical: 50,     // Below = critical
};
```

---

## Mutation Detector

### Purpose
Identifies files that deviate from the dominant allele for each gene. Every occurrence of a non-dominant allele in a gene with an established dominant becomes a mutation.

### Algorithm

```
For each gene with a dominant allele:
  For each non-dominant allele:
    For each example of that allele:
      Create a Mutation record
Sort by impact (high → medium → low), then by file path
```

### Impact Classification

| Impact | Condition |
|--------|-----------|
| `high` | Allele frequency < 10% AND dominant frequency > 80% |
| `medium` | Allele frequency < 30% |
| `low` | Everything else |

### Mutation Record
```typescript
interface Mutation {
  id: string;           // Deterministic SHA-256 hash of file + geneId + alleleId (16 chars)
  file: string;
  line: number;
  gene: GeneId;
  expected: AlleleId;   // The dominant allele
  actual: AlleleId;     // What was found
  impact: 'high' | 'medium' | 'low';
  code: string;
  suggestion: string;   // "Refactor to use {dominant} instead of {actual}"
  detectedAt: string;   // ISO timestamp
  resolved: boolean;
  resolvedAt?: string;
}
```

### Filter Methods
- `filterByGene(mutations, geneId)` — filter to a specific gene
- `filterByImpact(mutations, impact)` — filter by severity level

## Rust Rebuild Considerations
- Health calculation is pure arithmetic — trivial to port
- Mutation detection is iteration + comparison — straightforward in Rust
- SHA-256 hashing available via `sha2` crate
- Both are CPU-light — the benefit is more about consistency with a Rust pipeline than raw speed
