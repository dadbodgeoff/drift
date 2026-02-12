# Infrastructure — Overview

## What It Covers
Infrastructure encompasses everything that isn't a core analysis subsystem: CI/CD pipelines, build system, deployment, telemetry, AI providers, visualization, benchmarking, native compilation, and developer tooling. It's the operational backbone that makes Drift shippable, testable, and deployable.

## Core Design Principles
1. Monorepo with pnpm workspaces + Turborepo for orchestration
2. Rust core compiled to native Node.js addons via NAPI-RS (cross-platform)
3. TypeScript for orchestration, presentation, and API layers
4. Docker for containerized MCP server deployment
5. Cloudflare Workers for serverless telemetry
6. GitHub Actions for CI, native builds, and releases
7. CIBench as a novel benchmark framework for measuring codebase intelligence

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────┐
│                     GitHub Actions CI/CD                         │
│  ci.yml │ native-build.yml │ release.yml │ drift-check.yml      │
├─────────────────────────────────────────────────────────────────┤
│                     Build System                                 │
│  pnpm 8 │ Turborepo │ tsconfig.base │ ESLint │ Vitest │ Prettier│
├──────────────┬──────────────┬───────────────────────────────────┤
│  Rust Core   │  NAPI Bridge │  TypeScript Packages              │
│  drift-core  │  drift-napi  │  core│detectors│cortex│mcp│cli    │
├──────────────┴──────────────┴───────────────────────────────────┤
│                     Deployment                                   │
│  Docker (MCP Server) │ npm publish │ Native binaries             │
├─────────────────────────────────────────────────────────────────┤
│                     Supporting Packages                          │
│  CI Agent │ AI Providers │ Galaxy Viz │ CIBench │ Telemetry      │
└─────────────────────────────────────────────────────────────────┘
```

## Subsystem Directory Map

| Directory / Package | Purpose | Doc |
|---------------------|---------|-----|
| `.github/workflows/` | CI, native builds, releases | [ci-cd.md](./ci-cd.md) |
| `actions/drift-action/` | GitHub Action for PR analysis | [github-action.md](./github-action.md) |
| `packages/ci/` | Autonomous CI agent | [ci-agent.md](./ci-agent.md) |
| `packages/ai/` | AI provider abstraction | [ai-providers.md](./ai-providers.md) |
| `packages/galaxy/` | 3D visualization library | [galaxy.md](./galaxy.md) |
| `packages/cibench/` | Codebase intelligence benchmark | [cibench.md](./cibench.md) |
| `infrastructure/telemetry-worker/` | Cloudflare telemetry worker | [telemetry.md](./telemetry.md) |
| `crates/` | Rust workspace (drift-core + drift-napi) | [rust-build.md](./rust-build.md) |
| Root configs | Build system, linting, testing | [build-system.md](./build-system.md) |
| `Dockerfile` / `docker-compose.yml` | Container deployment | [docker.md](./docker.md) |
| `scripts/` | Publish, validation, generation | [scripts.md](./scripts.md) |

## Package Dependency Graph

```
driftdetect (CLI)
├── driftdetect-core
│   ├── driftdetect-detectors
│   └── drift-native (optional, NAPI)
├── driftdetect-detectors
├── driftdetect-cortex
│   └── driftdetect-core
├── driftdetect-dashboard
│   ├── driftdetect-core
│   └── driftdetect-galaxy
└── driftdetect-mcp
    ├── driftdetect-core
    ├── driftdetect-detectors
    └── driftdetect-cortex

driftdetect-ci
├── driftdetect-core
├── driftdetect-cortex
└── driftdetect-detectors

@drift/ai
└── driftdetect-core
```

## Publish Order
1. `driftdetect-core` (no internal deps)
2. `driftdetect-detectors` (depends on core)
3. `driftdetect-galaxy` (no internal deps)
4. `driftdetect-dashboard` (depends on core, galaxy)
5. `driftdetect` CLI (depends on core, detectors, dashboard)
6. `driftdetect-mcp` (depends on core, detectors, cortex)

## v2 Considerations
- CI package stays TS — calls Rust for analysis via NAPI
- GitHub Action needs updating for v2 binary distribution
- Benchmarking framework is valuable — keep and extend for v2
- AI package stays TS (API calls to external services)
- Galaxy stays TS/React (visualization)
- Telemetry worker is independent — no changes needed
- Docker image needs updating for Rust binary inclusion
- Native build workflow is the template for v2 cross-compilation
