# Environment Variable Analysis (TypeScript)

## Location
`packages/core/src/environment/` — 4 source files + extractors subdirectory

## What It Is
Scans codebases for environment variable usage, detects access patterns across languages, classifies sensitivity, and cross-references with `.env` files to find missing or inconsistent variables.

## Directory Structure
```
environment/
├── extractors/          # Per-language env var extractors
├── env-scanner.ts       # Main scanner orchestrating extraction
├── env-store.ts         # Persistence to .drift/environment/
├── types.ts             # All environment types
└── index.ts             # Exports
```

## Architecture
```
Source Files
  │
  ├─ Rust Core (crates/drift-core/src/environment/)
  │   ├─ EnvironmentAnalyzer → EnvAccess[]
  │   └─ EnvExtractor → extraction from AST + regex
  │
  └─ TypeScript Layer (packages/core/src/environment/)
      ├─ EnvScanner — Orchestrates extraction + .env parsing
      ├─ Per-language extractors — Enhanced extraction
      ├─ .env file parsing — Reads .env, .env.local, .env.production, etc.
      ├─ Missing variable detection — Used in code but not in .env
      ├─ Consistency checking — Same var, different values across environments
      └─ EnvStore — Persistence
```

## Key Differences from Rust Core
| Aspect | Rust | TypeScript |
|--------|------|-----------|
| Extraction | AST + regex patterns | Same (delegates to Rust) |
| .env parsing | Not implemented | Full .env file parsing |
| Missing detection | Not implemented | Cross-references code vs .env |
| Consistency | Not implemented | Checks across .env variants |
| Storage | None (returns results) | File-based persistence |

## Rust Core Reference
See [01-rust-core/environment.md](../01-rust-core/environment.md) for the Rust extraction patterns and sensitivity classification.

## v2 Notes
- Rust core handles extraction (parallel, fast)
- TS adds .env parsing and cross-referencing (not performance-critical)
- Framework-specific detection (Next.js NEXT_PUBLIC_*, Vite VITE_*) should be added
- .env parsing could stay TS — it's simple file I/O
