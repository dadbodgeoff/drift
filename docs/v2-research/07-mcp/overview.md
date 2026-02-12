# MCP Server — Overview

## Location
`packages/mcp/` — 100% TypeScript (~90 source files across 10 tool categories + infrastructure)

## What It Is
The MCP server is how AI agents interact with Drift. It exposes 50+ tools via the Model Context Protocol, giving AI structured, token-efficient access to codebase patterns, call graphs, security boundaries, memory, and analysis — without the AI needing to grep through files or build a mental model from scratch.

This is the payoff of Drift's offline indexing. The scan happens once. The MCP server lets AI query the results thousands of times, each query returning exactly the context needed for the task at hand.

## Core Design Principles
1. Layered tool architecture — orchestration → discovery → surgical → exploration → detail → analysis → generation → memory
2. Token budget awareness — every response includes `tokenEstimate`, responses are compressed to fit budgets
3. Progressive disclosure — start with `drift_context` (~2000 tokens), drill down only if needed
4. Dual-path storage — tools prefer SQLite (UnifiedStore) when available, fall back to JSON stores
5. Intelligent tool filtering — auto-detects project languages, only exposes relevant tools
6. Anti-hallucination — curation system verifies AI claims against actual code before approving patterns

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                    Entry Points                          │
│  bin/server.ts (stdio)  │  bin/http-server.ts (SSE/HTTP)│
├─────────────────────────────────────────────────────────┤
│              Enterprise Server (enterprise-server.ts)     │
│  createEnterpriseMCPServer() → Server                    │
│  - Store initialization (pattern, manifest, boundary...) │
│  - Tool registration (ALL_TOOLS from registry)           │
│  - Request routing (routeToolCall switch cascade)        │
│  - Dynamic project resolution                            │
├─────────────────────────────────────────────────────────┤
│              Infrastructure Layer                        │
│  Cache │ RateLimiter │ Metrics │ TokenEstimator          │
│  CursorManager │ ResponseBuilder │ ErrorHandler          │
│  ProjectResolver │ StartupWarmer │ ToolFilter            │
├──────────┬──────────┬──────────┬────────────────────────┤
│ Orchestr.│ Discovery│ Surgical │  Exploration            │
│ (2 tools)│ (3 tools)│(12 tools)│  (5 tools)             │
├──────────┼──────────┼──────────┼────────────────────────┤
│ Detail   │ Analysis │ Generatn │  Memory                 │
│ (8 tools)│(18 tools)│ (3 tools)│  (33 tools)            │
├──────────┼──────────┼──────────┼────────────────────────┤
│ Setup    │ Curation │          │                         │
│ (2 tools)│ (1 tool) │          │                         │
├──────────┴──────────┴──────────┴────────────────────────┤
│              Data Access Layer                           │
│  PatternStore │ UnifiedStore (SQLite) │ Legacy JSON stores│
│  IPatternService │ DataLake │ CortexV2                   │
└─────────────────────────────────────────────────────────┘
```

## Entry Points

### stdio (`bin/server.ts`)
Standard MCP transport for Claude Desktop, Cursor, Windsurf, Kiro, VS Code. Connects via stdin/stdout.

Project detection priority:
1. Explicit path argument (`drift-mcp /path/to/project`)
2. Active project from `~/.drift/projects.json`
3. Auto-detect: walk up from cwd looking for `.git`, `package.json`, `Cargo.toml`, etc. (13 project markers)
4. Fall back to cwd

### HTTP/SSE (`bin/http-server.ts`)
HTTP server with SSE transport for containerized deployments (Docker).

Endpoints:
- `GET /health` — Health check
- `GET /sse` — SSE endpoint for MCP communication
- `POST /message` — Send messages to MCP server

Supports CORS, active transport tracking, graceful shutdown.

## Subsystem Directory Map

| Directory | Purpose | Doc |
|-----------|---------|-----|
| `enterprise-server.ts` | Main server: store init, tool registration, request routing | [server.md](./server.md) |
| `tools/registry.ts` | Central tool registry, category mapping | [tools-inventory.md](./tools-inventory.md) |
| `tools/orchestration/` | Meta-tools: `drift_context`, `drift_package_context` | [tools-by-category.md](./tools-by-category.md) |
| `tools/discovery/` | Health checks: `drift_status`, `drift_capabilities`, `drift_projects` | [tools-by-category.md](./tools-by-category.md) |
| `tools/surgical/` | Precision lookups: callers, signature, type, imports (12 tools) | [tools-by-category.md](./tools-by-category.md) |
| `tools/exploration/` | Filtered browsing: patterns_list, security_summary, contracts | [tools-by-category.md](./tools-by-category.md) |
| `tools/detail/` | Deep inspection: pattern_get, code_examples, impact_analysis | [tools-by-category.md](./tools-by-category.md) |
| `tools/analysis/` | Heavy analysis: coupling, test_topology, quality_gate + 8 language tools | [tools-by-category.md](./tools-by-category.md) |
| `tools/generation/` | AI-powered: explain, validate_change, suggest_changes | [tools-by-category.md](./tools-by-category.md) |
| `tools/memory/` | Cortex V2: 33 memory tools | [tools-by-category.md](./tools-by-category.md) |
| `tools/setup/` | Project init: drift_setup, drift_telemetry | [tools-by-category.md](./tools-by-category.md) |
| `tools/curation/` | Pattern approval with anti-hallucination verification | [curation.md](./curation.md) |
| `infrastructure/` | Cache, rate limiter, metrics, cursors, errors, etc. | [infrastructure.md](./infrastructure.md) |
| `packs.ts` | Task-oriented pattern bundles with caching | [feedback-and-packs.md](./feedback-and-packs.md) |
| `feedback.ts` | Example quality feedback (reinforcement learning) | [feedback-and-packs.md](./feedback-and-packs.md) |

## Request Flow

```
1. Client connects (stdio or HTTP/SSE)
2. Server receives CallToolRequest { name, arguments }
3. Rate limiter checks request quota (global + per-tool + expensive-tool limits)
4. Project resolver determines effective project root:
   - Check args.project parameter
   - Special handling for drift_setup (path, not name)
   - Registry lookup for other tools
   - Fall back to config.projectRoot
5. If different project: create temporary stores for that project
6. Cache check (project-isolated key: projectRoot + tool + args hash)
7. routeToolCall() dispatches to category-specific handler
8. Handler executes, returns { content: [{ type: 'text', text: JSON }] }
9. Cache result (skip for project management ops)
10. Record metrics (tool, duration, success/error)
11. Return response to client
```

## Tool Count Summary
- 10 categories
- ~87 tool files across categories
- 33 memory tools (largest category)
- 12 surgical tools (most frequently called)
- 18 analysis tools (including 8 language-specific)
- Core tools always available regardless of language detection

## Dependencies
- `@modelcontextprotocol/sdk` — MCP protocol implementation
- `driftdetect-core` — All stores, data lake, pattern service
- `driftdetect-cortex` — Cortex V2 memory system
- `driftdetect-core/storage` — UnifiedStore, createPatternStore

## Rust Rebuild Considerations
- The MCP server stays in TypeScript — it's an orchestration/presentation layer
- MCP protocol is JSON-RPC — language-agnostic
- Tools are thin wrappers around store queries — they call Rust via NAPI for analysis
- Infrastructure (caching, rate limiting, token estimation) is solid and stays
- Post-migration: tools call Rust NAPI directly instead of TS stores
- Tool definitions (JSON schemas) are static — no performance concern
- Consider: consolidating 87 tools to ~40-50 for v2 (many are thin wrappers)
- The dual-path architecture (JSON vs SQLite) simplifies to SQLite-only in v2
