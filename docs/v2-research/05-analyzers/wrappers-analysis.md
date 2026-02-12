# Wrappers Analysis (TypeScript)

## Location
`packages/core/src/wrappers/` — ~8 source files across 5 subdirectories

## What It Is
Detects functions that wrap framework primitives (React hooks, fetch APIs, validation libraries, etc.), clusters related wrappers, and exports wrapper documentation. The TS side adds clustering, primitive registries, and integration on top of the Rust core detection.

## Directory Structure
```
wrappers/
├── detection/           # Wrapper detection logic
├── clustering/          # Groups related wrappers
├── primitives/          # Known primitive registries per framework
├── export/              # Wrapper documentation export
├── integration/         # Integration with pattern store
├── __tests__/           # Tests
├── types.ts             # All wrapper types
└── index.ts             # Exports
```

## Architecture
```
Source Files
  │
  ├─ Rust Core (crates/drift-core/src/wrappers/)
  │   └─ Basic detection: function calls → known primitives → WrapperInfo
  │
  └─ TypeScript Layer (packages/core/src/wrappers/)
      ├─ Primitive Registry — Expanded framework-specific primitive lists
      ├─ Detection — Enhanced detection with call graph integration
      ├─ Clustering — Groups related wrappers by category/primitive
      ├─ Export — Generates wrapper documentation
      └─ Integration — Persists to pattern store
```

## Key Differences from Rust Core
| Aspect | Rust | TypeScript |
|--------|------|-----------|
| Primitive registry | 6 categories, ~20 primitives | Expanded per-framework registries |
| Detection | Single-file, call-site based | Cross-file with call graph |
| Usage counting | Always 0 (no cross-file) | Actual usage count from call graph |
| Clustering | None | Full clustering with similarity |
| Export | None | Documentation generation |
| Integration | None | Pattern store persistence |

## Rust Core Reference
See [01-rust-core/wrappers.md](../01-rust-core/wrappers.md) for the Rust detection algorithm, confidence scoring formula, and primitive registry.

## v2 Notes
- Rust core handles the hot path (detection per file)
- TS adds orchestration (clustering, cross-file usage, export)
- For v2, expand Rust primitive registry and add clustering in Rust
- Usage counting requires call graph — will be available when call graph is fully Rust
