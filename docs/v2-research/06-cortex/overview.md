# Cortex Memory System — Overview

## Location
`packages/cortex/` — 100% TypeScript (~150 source files)

## What It Is
Cortex is a persistent AI memory system that maintains knowledge across sessions. It understands code as code (not text), provides tribal knowledge, pattern rationales, procedural memory, causal reasoning, and self-healing validation. It's the "brain" of Drift — everything the system learns, remembers, and reasons about flows through Cortex.

## Core Design Principles
1. Memories are typed, scored, and decay over time (like human memory)
2. Bitemporal tracking separates "when we learned it" from "when it was true"
3. Hierarchical compression fits memories into token budgets
4. Causal graphs explain WHY things are the way they are
5. Contradiction detection prevents conflicting knowledge
6. Session deduplication avoids re-sending the same context

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                    CortexV2 Orchestrator                 │
│  (cortex-v2.ts — unified API for all operations)        │
├──────────┬──────────┬──────────┬────────────────────────┤
│ Retrieval│ Learning │Generation│   Why / Narrative       │
│ Orch.    │ Orch.    │ Orch.    │   Synthesizer           │
├──────────┴──────────┴──────────┴────────────────────────┤
│                    Core Engines                          │
│  Retrieval │ Consolidation │ Validation │ Prediction     │
├─────────────────────────────────────────────────────────┤
│                  Support Systems                         │
│  Decay │ Contradiction │ Compression │ Session │ Privacy │
├─────────────────────────────────────────────────────────┤
│                  Causal System                           │
│  Inference │ Traversal │ Narrative │ Causal Storage      │
├─────────────────────────────────────────────────────────┤
│                  Embedding Layer                         │
│  Local │ OpenAI │ Ollama │ Hybrid (Lex+Sem+Struct)      │
├─────────────────────────────────────────────────────────┤
│                  Storage Layer                           │
│  SQLite + sqlite-vec (384-dim vectors)                  │
└─────────────────────────────────────────────────────────┘
```

## Entry Points
- `cortex.ts` — `Cortex` class: low-level access to all engines
- `orchestrators/cortex-v2.ts` — `CortexV2` class: high-level unified API
- `index.ts` — Public exports

## Subsystem Directory Map

| Directory | Purpose | Doc |
|-----------|---------|-----|
| `types/` | 23 memory types + supporting types | [memory-types.md](./memory-types.md) |
| `storage/` | SQLite persistence, schema, migrations | [storage.md](./storage.md) |
| `embeddings/` | Multi-strategy embedding system | [embeddings.md](./embeddings.md) |
| `retrieval/` | Intent-aware memory retrieval | [retrieval.md](./retrieval.md) |
| `consolidation/` | Sleep-inspired memory consolidation | [consolidation.md](./consolidation.md) |
| `decay/` | Confidence decay with half-lives | [decay.md](./decay.md) |
| `validation/` | 4-dimension memory validation | [validation.md](./validation.md) |
| `contradiction/` | Contradiction detection + propagation | [contradiction.md](./contradiction.md) |
| `causal/` | Causal inference, traversal, narratives | [causal.md](./causal.md) |
| `compression/` | 4-level hierarchical compression | [compression.md](./compression.md) |
| `learning/` | Correction analysis, active learning | [learning.md](./learning.md) |
| `prediction/` | Predictive memory preloading | [prediction.md](./prediction.md) |
| `session/` | Session tracking + deduplication | [session.md](./session.md) |
| `generation/` | Code generation context building | [generation.md](./generation.md) |
| `privacy/` | PII/secret sanitization | [privacy.md](./privacy.md) |
| `linking/` | Memory-to-entity linking | [linking.md](./linking.md) |
| `why/` | "Why" context synthesis | [why.md](./why.md) |
| `orchestrators/` | High-level workflow orchestrators | [orchestrators.md](./orchestrators.md) |
| `cache/` | L1/L2/L3 caching | [cache.md](./cache.md) |
| `utils/` | Hashing, IDs, time, tokens | [utils.md](./utils.md) |

## Memory Lifecycle

```
Create → Embed → Link → [Causal Infer] → Access → Validate → Consolidate → Decay → Archive
```

1. Memory created with initial confidence (1.0)
2. Text embedded via multi-strategy embedder
3. Linked to patterns, constraints, files, functions
4. Causal relationships automatically inferred
5. Access tracked (boosts decay resistance)
6. Periodically validated across 4 dimensions
7. Episodic memories consolidated into semantic knowledge
8. Confidence decays based on type-specific half-lives
9. Below-threshold memories archived

## MCP Integration
33 MCP tools in `packages/mcp/src/tools/memory/` expose Cortex to AI agents. See [mcp-tools.md](./mcp-tools.md).

## V1 vs V2 Additions
V2 added: causal inference, narrative generation, adaptive consolidation, session deduplication, contradiction propagation, 10 universal memory types, active learning loop, prediction system, hierarchical compression, and generation context building.
