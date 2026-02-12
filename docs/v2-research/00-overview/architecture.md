# Architecture Overview

## Start Here
If you're an AI agent about to build or modify Drift, read these overview docs in order:

1. **[what-is-drift.md](./what-is-drift.md)** — What Drift is, why it exists, how it thinks, every subsystem explained
2. **[subsystem-connections.md](./subsystem-connections.md)** — How every subsystem connects to every other
3. **[pipelines.md](./pipelines.md)** — End-to-end flows traced through the system (scan, check, MCP query, etc.)
4. **This file** — Package layout, dependency graph summary, key observations
5. **[data-models.md](./data-models.md)** — Core data types (Pattern, Violation, Memory, etc.)
6. **[configuration.md](./configuration.md)** — Config files, .driftignore, .drift/ directory structure
7. **[dependency-graph.md](./dependency-graph.md)** — Package dependencies, external deps, versions
8. **[language-split.md](./language-split.md)** — What's in Rust vs TypeScript, migration priority

## Monorepo Layout

Drift is a pnpm + Turborepo monorepo. Two Rust crates handle performance-critical parsing and analysis. Twelve TypeScript packages handle orchestration, UI, memory, and integrations.

## Package Map

### Rust Crates (Performance-Critical)
| Package | Purpose |
|---------|---------|
| `crates/drift-core` | Core engine: tree-sitter parsers (10 languages), parallel scanner, call graph builder, boundary detection, coupling, reachability, constants, environment, wrappers, test topology, error handling |
| `crates/drift-napi` | N-API bridge: 27 exported functions exposing Rust to Node.js via NAPI-RS |

### TypeScript Packages (Orchestration & Presentation)
| Package | Purpose |
|---------|---------|
| `packages/core` | Main engine: patterns, analyzers, storage, language support, rules engine, quality gates, simulation, workspace management, licensing (~40+ subdirectories) |
| `packages/detectors` | 350+ detector files across 16 categories — pattern recognition engine |
| `packages/cortex` | AI memory system: 23 memory types, embeddings, retrieval, consolidation, causal inference, learning, compression, session management (~150 files) |
| `packages/mcp` | MCP server: 50+ tools for AI agents, caching, rate limiting, token estimation, tool packs |
| `packages/cli` | CLI interface: 50+ commands, services, reporters, UI components, git integration |
| `packages/lsp` | Language Server Protocol server for IDE integration |
| `packages/vscode` | VSCode extension: commands, views, diagnostics, code actions |
| `packages/dashboard` | Web dashboard: Vite + React + Tailwind |
| `packages/ai` | AI provider abstraction: Anthropic, OpenAI, Ollama |
| `packages/ci` | CI/CD integration: GitHub Action, GitLab CI |
| `packages/cibench` | Benchmarking framework |
| `packages/galaxy` | Visualization component library (React) |

### Supporting Infrastructure
| Directory | Purpose |
|-----------|---------|
| `actions/drift-action/` | GitHub Action (composite action for PR analysis) |
| `infrastructure/telemetry-worker/` | Cloudflare Worker for anonymous telemetry |
| `skills/` | 73 architectural skill templates (knowledge base) |
| `demo/` | 8 reference implementations across languages |
| `wiki/` | 58 user-facing documentation pages |

## Key Observations

1. **Dual implementation**: Many systems exist in both Rust and TypeScript (parsers, call graph, boundaries, coupling, test topology, error handling). TS versions are more feature-rich but slower. V2 consolidates to Rust.

2. **The TS core is massive**: `packages/core/src/` has 40+ subdirectories. This is the primary migration target.

3. **Detectors are 100% TypeScript**: All 350+ files, all 16 categories. Prime Rust candidates for v2.

4. **Storage is fragmented**: 6 backends in v1 (JSON files, SQLite unified, data lake, Rust SQLite, Cortex SQLite, hybrid stores). V2 consolidates to 2 (drift.db + cortex.db).

5. **The NAPI bridge works but is thin**: 27 functions exposing raw analysis. V2 expands to full coverage.

6. **Cortex is entirely TS**: Uses better-sqlite3 + sqlite-vec + transformers.js. Stays in TS (AI orchestration layer).

7. **Event-driven architecture**: Nearly every store extends EventEmitter. Pub/sub patterns propagate changes through the system.

8. **Open core licensing**: Community (Apache 2.0) vs Team/Enterprise (BSL 1.1). Runtime feature gating via `packages/core/src/licensing/`.

## Version Info
- Monorepo: `drift-v2` v0.9.47
- CLI: `driftdetect` v0.9.48
- MCP: `driftdetect-mcp` v0.9.48
- Rust crates: v0.1.0
- Node: >=18, pnpm >=8
- Rust edition: 2021
