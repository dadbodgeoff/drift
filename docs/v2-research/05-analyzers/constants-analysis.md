# Constants & Secrets Analysis (TypeScript)

## Location
`packages/core/src/constants/` — ~10 source files across 4 subdirectories

## What It Is
Orchestrates constant extraction, secret detection, magic number finding, inconsistency detection, and dead constant analysis. The TS side adds storage, per-language extractors, and integration on top of the Rust core detection.

## Directory Structure
```
constants/
├── analysis/            # Analysis orchestration
├── extractors/          # Per-language constant extractors
├── store/               # Persistence (constants store)
├── integration/         # Integration with pattern store
├── __tests__/           # Tests
├── types.ts             # All constants types
└── index.ts             # Exports
```

## Architecture
```
Source Files
  │
  ├─ Rust Core (crates/drift-core/src/constants/)
  │   ├─ ConstantExtractor → ConstantInfo[]
  │   ├─ SecretDetector (21 patterns) → SecretCandidate[]
  │   ├─ Magic number detection → MagicNumber[]
  │   └─ Inconsistency detection → InconsistentValue[]
  │
  └─ TypeScript Layer (packages/core/src/constants/)
      ├─ Per-language extractors — Enhanced extraction per language
      ├─ Analysis — Dead constant detection (requires usage analysis)
      ├─ Store — Persistence to .drift/constants/
      └─ Integration — Pattern store integration
```

## Key Differences from Rust Core
| Aspect | Rust | TypeScript |
|--------|------|-----------|
| Secret patterns | 21 regex patterns | Same (delegates to Rust) |
| Constant extraction | Basic AST extraction | Per-language enhanced extraction |
| Dead constants | Not implemented | Usage analysis via call graph |
| Storage | None (returns results) | File-based persistence |
| Integration | None | Pattern store integration |

## Rust Core Reference
See [01-rust-core/constants.md](../01-rust-core/constants.md) for the complete secret detection patterns, confidence scoring algorithm, magic number detection, and inconsistency detection.

## v2 Notes
- Rust core handles the heavy lifting (parallel file processing, regex matching)
- TS adds dead constant detection (needs call graph) and persistence
- For v2, dead constant detection should move to Rust when call graph is available
- Secret patterns should be expanded (Azure, GCP, npm tokens, PyPI tokens)
