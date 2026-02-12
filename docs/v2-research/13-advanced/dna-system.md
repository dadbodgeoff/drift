# DNA System — Overview

## Location
`packages/core/src/dna/` — 100% TypeScript (~15 source files)

## What It Is
The DNA system extracts the "genetic fingerprint" of a codebase's styling and API conventions. It models conventions as **genes** (e.g., "variant-handling", "api-response-format"), each with competing **alleles** (variants). The dominant allele represents the team's established pattern. Files that deviate from the dominant allele are flagged as **mutations**. Think of it as a biological metaphor for code consistency — genes are concerns, alleles are approaches, mutations are deviations.

## Core Design Principles
1. Every convention is a gene with measurable frequency
2. Dominance is earned by frequency (≥30% to qualify)
3. Mutations are deviations, not errors — impact is graded
4. Health is a composite score, not a binary pass/fail
5. Evolution is tracked over time (last 50 snapshots)
6. AI context is generated at 4 detail levels for token efficiency

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                    DNAAnalyzer                           │
│  (dna-analyzer.ts — main orchestrator)                  │
├──────────┬──────────┬──────────┬────────────────────────┤
│ Gene     │ Health   │ Mutation │   Playbook / AI        │
│Extractors│Calculator│ Detector │   Context Builder       │
├──────────┴──────────┴──────────┴────────────────────────┤
│                  Gene Extractors (10)                    │
│  Frontend (6)  │  Backend (4)  │  BaseGeneExtractor     │
├─────────────────────────────────────────────────────────┤
│                  Persistence                             │
│  DNAStore → .drift/dna/styling.json                     │
└─────────────────────────────────────────────────────────┘
```

## Entry Points
- `dna-analyzer.ts` — `DNAAnalyzer` class: main orchestrator
- `dna-store.ts` — `DNAStore` class: persistence
- `index.ts` — Public exports (all extractors, factories, utilities)

## Subsystem Directory Map

| File / Directory | Purpose | Doc |
|------------------|---------|-----|
| `dna-analyzer.ts` | Main orchestrator: discover files → extract → score → assemble | [analyzer.md](./dna/analyzer.md) |
| `gene-extractors/` | 10 regex-based extractors (6 frontend + 4 backend) | [gene-extractors.md](./dna/gene-extractors.md) |
| `health-calculator.ts` | 4-factor weighted health score (0–100) | [health-and-mutations.md](./dna/health-and-mutations.md) |
| `mutation-detector.ts` | Deviation detection with impact grading | [health-and-mutations.md](./dna/health-and-mutations.md) |
| `playbook-generator.ts` | Human-readable Markdown playbook output | [output.md](./dna/output.md) |
| `ai-context.ts` | AI-ready context at 4 detail levels | [output.md](./dna/output.md) |
| `dna-store.ts` | JSON persistence with evolution tracking | [store.md](./dna/store.md) |
| `types.ts` | All type definitions | [types.md](./dna/types.md) |

## Analysis Pipeline

```
1. Discover files (componentPaths + backendPaths)
2. Read file contents → Map<string, string>
3. Run each gene extractor's analyze() against file map
4. MutationDetector.detectMutations() across all genes
5. HealthCalculator.calculateHealthScore() for summary
6. Assemble StylingDNAProfile
```

## Gene Inventory

### Frontend Genes (6)
| Gene ID | Extractor | What It Detects |
|---------|-----------|-----------------|
| `variant-handling` | `VariantHandlingExtractor` | cva, clsx, inline conditionals, CSS modules |
| `responsive-approach` | `ResponsiveApproachExtractor` | Tailwind breakpoints, media queries, container queries |
| `state-styling` | `StateStylingExtractor` | Data attributes, aria states, pseudo-classes |
| `theming` | `ThemingExtractor` | CSS variables, Tailwind config, theme providers |
| `spacing-philosophy` | `SpacingPhilosophyExtractor` | Tailwind spacing, CSS custom properties, design tokens |
| `animation-approach` | `AnimationApproachExtractor` | Framer Motion, CSS transitions, Tailwind animate |

### Backend Genes (4)
| Gene ID | Extractor | What It Detects |
|---------|-----------|-----------------|
| `api-response-format` | `ApiResponseFormatExtractor` | Envelope patterns, direct returns, status codes |
| `error-response-format` | `ErrorResponseFormatExtractor` | Error classes, error codes, HTTP status mapping |
| `logging-format` | `LoggingFormatExtractor` | Structured logging, console, winston, pino |
| `config-pattern` | `ConfigPatternExtractor` | Env vars, config files, dependency injection |

## Health Score Formula

| Component | Weight | Calculation |
|-----------|--------|-------------|
| Consistency | 40% | Average consistency across all genes |
| Confidence | 30% | Average dominant allele frequency |
| Mutation penalty | 20% | `(1 - penalty)` scaled by mutation count |
| Dominant coverage | 10% | Proportion of genes with a dominant allele |

## MCP Integration
Exposed via `drift_context` (DNA-aware context) and DNA-specific MCP tools.

## Connections to Other Subsystems
- **Audit System** — Health scores feed degradation tracking
- **Pattern Service** — Framework detection aligns with pattern categories
- **MCP Tools** — DNA context injected into AI responses
- **Storage** — Profile persisted in `.drift/dna/`

## v2 Migration Notes
- Gene extraction is pure regex → excellent Rust candidate
- Mutation detection is comparison logic → Rust
- Health calculation is arithmetic → Rust
- Playbook generation and AI context are text templating → stay in TypeScript
