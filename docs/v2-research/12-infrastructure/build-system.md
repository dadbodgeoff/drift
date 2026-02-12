# Build System

## Package Manager
pnpm 8.10.0 with workspace protocol. Defined in `pnpm-workspace.yaml`:

### Workspace Members
```yaml
packages:
  - "packages/core"
  - "packages/cortex"
  - "packages/detectors"
  - "packages/lsp"
  - "packages/cli"
  - "packages/ai"
  - "packages/vscode"
  - "packages/dashboard"
  - "packages/mcp"
  - "packages/galaxy"
  - "packages/ci"
  - "packages/cibench"
```

## Turborepo (`turbo.json`)
Orchestrates builds with dependency-aware caching.

### Pipeline
| Task | Dependencies | Outputs | Cached |
|------|-------------|---------|--------|
| `build` | `^build` (upstream first) | `dist/**` | Yes |
| `typecheck` | `^build` | None | Yes |
| `lint` | `^build` | None | Yes |
| `lint:fix` | `^build` | None | No |
| `test` | `build` | `coverage/**` | Yes |
| `test:watch` | `build` | None | No (persistent) |
| `test:coverage` | `build` | `coverage/**` | Yes |
| `dev` | `^build` | None | No (persistent) |
| `clean` | None | None | No |

## TypeScript Configuration (`tsconfig.base.json`)

### Compiler Target
- Target: ES2022
- Module: NodeNext
- Module Resolution: NodeNext

### Strict Mode (All enabled)
- `strict`, `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`
- `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`
- `useUnknownInCatchVariables`, `alwaysStrict`
- `noUnusedLocals`, `noUnusedParameters`
- `exactOptionalPropertyTypes`, `noImplicitReturns`
- `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`
- `noImplicitOverride`, `noPropertyAccessFromIndexSignature`

### Path Aliases
All packages mapped as `@drift/<name>` → `packages/<name>/src/index.ts`

### Emit
- `declaration: true`, `declarationMap: true`, `sourceMap: true`
- `composite: true`, `incremental: true` (project references)

## ESLint (`eslint.config.mjs`)
Flat config format with TypeScript support.

### Key Rules
| Rule | Level | Purpose |
|------|-------|---------|
| `explicit-function-return-type` | warn | Type safety |
| `explicit-module-boundary-types` | warn | API contracts |
| `no-explicit-any` | warn | Type safety |
| `strict-boolean-expressions` | warn | Truthiness bugs |
| `no-floating-promises` | warn | Async safety |
| `no-misused-promises` | warn | Async safety |
| `await-thenable` | error | Async correctness |
| `import/order` | warn | Consistent imports |
| `no-console` | warn | Clean output |
| `eqeqeq` | error | Strict equality |

### Test File Relaxations
Tests disable: `no-explicit-any`, `no-non-null-assertion`, `no-unsafe-*`, `unbound-method`

## Vitest (`vitest.config.ts`)

### Configuration
- Environment: `node`
- Pool: `threads` (parallel)
- Timeout: 10s (test + hook)
- Coverage provider: `v8`
- Coverage reporters: text, json, html, lcov

### Coverage Thresholds
All at 80%: statements, branches, functions, lines

### Patterns
- Include: `**/*.{test,spec}.{ts,tsx}`
- Exclude: `node_modules`, `dist`, `.turbo`

## Prettier
- Print width: 100
- Single quotes
- Trailing commas: all
- Tab width: 2

## Root Scripts (`package.json`)
| Script | Command | Purpose |
|--------|---------|---------|
| `build` | `turbo run build` | Build all packages |
| `test` | `turbo run test` | Test all packages |
| `lint` | `turbo run lint` | Lint all packages |
| `format` | `prettier --write` | Format all files |
| `typecheck` | `turbo run typecheck` | Type check all |
| `drift` | `node packages/cli/dist/bin/drift.js` | Run Drift locally |
| `validate-docs` | `./scripts/validate-docs.sh` | Validate doc commands |

## Engine Requirements
- Node.js >= 18.0.0
- pnpm >= 8.0.0

## Rust Rebuild Considerations
- Turborepo pipeline stays — Rust builds integrate as a `^build` dependency
- TypeScript strict mode is the standard for all TS that remains
- Path aliases need updating if packages are consolidated
- Vitest config stays for TS-side testing; Rust uses `cargo test`
