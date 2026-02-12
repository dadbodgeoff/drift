# What Is Drift — The Complete Picture

## For the AI Agent Reading This

This document exists so you can understand Drift deeply enough to build it. Not surface-level "it's a linter" — the real thing. Why it exists, what problem it solves, how it thinks, and how every subsystem connects. Read this first. Everything else in v2-research is implementation detail.

---

## The Problem Drift Solves

Every codebase has conventions. Not the ones in the style guide — the real ones. The way your team actually writes API handlers. The pattern your auth middleware follows. How errors propagate through your service layer. The naming convention for database models that nobody wrote down but everyone follows.

When an AI writes code for your project, it doesn't know any of this. It writes generic, textbook code. You spend 20 minutes fixing it to match your patterns. Multiply that by every AI interaction, every developer, every day.

The current "solution" is `AGENTS.md` or `CLAUDE.md` — a static file someone wrote once and forgot about. It goes stale immediately. It's a dump of everything, not context-aware. It doesn't learn.

**Drift's thesis: if you can automatically discover and index a codebase's conventions offline — no AI required — then you can expose those conventions to AI at query time through MCP, giving it exactly the context it needs without wasting the context window on 20-30 grep calls to figure out how your codebase works.**

That's the entire product in one sentence.

## How It Works (The 30-Second Version)

```
1. SCAN    — Parse your codebase with tree-sitter (AST) + regex fallback
             Discover conventions across 16 categories, 10 languages
             Score each pattern statistically (frequency, consistency, spread)

2. INDEX   — Store everything in SQLite (patterns, call graph, boundaries, etc.)
             Build a queryable map of your codebase's conventions
             No AI involved — pure static analysis

3. EXPOSE  — MCP server with 50+ tools lets AI query what it needs
             "What's the auth pattern?" → exact code examples + locations
             "Who calls this function?" → call graph traversal
             "What data can this code reach?" → reachability analysis

4. LEARN   — Cortex memory system replaces static AGENTS.md
             Stores tribal knowledge, learns from corrections
             Confidence decays over time like human memory
             Intent-aware retrieval (different context for "fix bug" vs "add feature")
```

## Why This Architecture

The key insight is **offline indexing + online querying**. 

Traditional approach: AI reads files, greps around, builds mental model in the context window. This burns 50-80% of the context window on discovery before any useful work happens. Every new conversation starts from scratch.

Drift's approach: Index once (during `drift scan`), query many times (via MCP). The AI asks `drift_context intent="add_feature" focus="authentication"` and gets back curated patterns, relevant files, code examples, and warnings — in ~2000 tokens instead of 50,000.

The scanning is designed to capture 85-90% of a codebase's conventions through AST parsing with regex fallback for the hard parts. It's not trying to be perfect — it's trying to be good enough that the AI writes code matching your patterns on the first try instead of the third.

## The Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACES                          │
│  CLI (drift)  │  MCP Server (50+ tools)  │  VSCode  │  Dashboard│
├───────────────┴──────────────────────────┴──────────┴───────────┤
│                     ORCHESTRATION LAYER (TypeScript)             │
│  Commands │ Services │ Quality Gates │ Reporters │ Workspace Mgr │
├─────────────────────────────────────────────────────────────────┤
│                     INTELLIGENCE LAYER                          │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  Detectors   │  │  Analyzers   │  │  Cortex Memory System  │ │
│  │  (350+ files)│  │  (AST, Type, │  │  (retrieval, learning, │ │
│  │  16 categories│  │   Semantic,  │  │   consolidation,       │ │
│  │  3 variants  │  │   Flow)      │  │   causal inference)    │ │
│  │  each        │  │              │  │                        │ │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬───────────┘ │
│         │                 │                        │             │
├─────────┴─────────────────┴────────────────────────┴─────────────┤
│                     ANALYSIS ENGINES                             │
│  Call Graph │ Boundaries │ Reachability │ Coupling │ Test Topo   │
│  Error Handling │ Constraints │ DNA │ Constants │ Environment   │
│  Simulation │ Decision Mining │ Contracts                        │
├─────────────────────────────────────────────────────────────────┤
│                     PARSING LAYER                                │
│  Tree-sitter (10 languages) │ Regex fallback │ Hybrid extraction│
├─────────────────────────────────────────────────────────────────┤
│                     STORAGE LAYER                                │
│  drift.db (SQLite — patterns, call graph, all analysis data)    │
│  cortex.db (SQLite + sqlite-vec — memories, embeddings)         │
├─────────────────────────────────────────────────────────────────┤
│                     RUST CORE (crates/drift-core)                │
│  Native parsers │ Scanner │ Call graph │ Boundaries │ Coupling  │
│  Reachability │ Constants │ Environment │ Wrappers │ NAPI bridge│
└─────────────────────────────────────────────────────────────────┘
```

## The Subsystems and How They Connect

### 1. Parsing (Foundation)

Everything starts with parsing. Drift uses tree-sitter for AST parsing across 10 languages (TypeScript, JavaScript, Python, Java, C#, PHP, Go, Rust, C, C++) with regex fallback for constructs tree-sitter misses.

The parser extracts: functions, classes, imports, exports, call sites, decorators, type annotations, doc comments. This is the raw material everything else builds on.

Dual implementation: Rust (fast, used for scanning) and TypeScript (feature-rich, used for deep analysis). V2 consolidates to Rust-only.

**Connects to**: Every other subsystem. Detectors consume parse results. Call graph uses function/call extraction. Boundaries use data access patterns from parsed code.

### 2. Detectors (Pattern Discovery)

The detector system is the core intelligence. 350+ detector files across 16 categories discover conventions in your codebase.

Each detector category has up to 3 variants:
- **Base** — Fast regex/AST matching. Deterministic.
- **Learning** — Adapts to your codebase's conventions. Learns what the dominant pattern is and flags deviations.
- **Semantic** — Deep AST analysis with context awareness.

Categories: security, auth, errors, api, components, config, contracts, data-access, documentation, logging, performance, structural, styling, testing, types, accessibility.

The key concept: detectors don't enforce rules. They discover what your codebase already does. If 90% of your API handlers use try-catch with a specific error format, that becomes a pattern. The 10% that don't become outliers (potential violations).

**Connects to**: Patterns (output), Parsers (input), Rules Engine (violation generation), MCP (exposed via tools).

### 3. Patterns (The Central Entity)

A Pattern is the core data model. It represents a discovered convention with:
- Statistical confidence (frequency × 0.40 + consistency × 0.30 + age × 0.15 + spread × 0.15)
- Locations (every file/line where the pattern appears)
- Outliers (deviations from the pattern)
- Lifecycle: discovered → approved/ignored
- Only approved patterns generate violations

The confidence scoring is statistical, not binary. A pattern seen in 95% of files with consistent implementation scores higher than one seen in 60% of files with variations.

**Connects to**: Detectors (created by), Rules Engine (violations from), Storage (persisted in), MCP (queried via), Cortex (linked to memories).

### 4. Call Graph (Relationship Mapping)

Maps every function call relationship in the codebase. Supports 9 languages with hybrid extraction (tree-sitter primary, regex fallback).

Enables:
- **Reachability**: "From this API handler, what database tables can it reach?"
- **Impact analysis**: "If I change this function, what breaks?"
- **Dead code detection**: Functions never called
- **Test coverage mapping**: Which tests cover which functions

Call resolution uses multiple strategies: same-file (high confidence), import-based (medium), fuzzy name matching (low). Typical resolution rate: 60-85%.

**Connects to**: Parsers (function/call extraction), Boundaries (data access paths), Security (reachability analysis), Test Topology (coverage mapping), MCP (drift_callers, drift_impact_analysis, drift_reachability).

### 5. Boundaries & Security (Data Flow)

Answers: "What sensitive data can this code reach?" 

Two-phase approach:
1. **Learn**: Discover your data access patterns — which ORMs, which tables, which fields. Supports 28+ ORM frameworks across 8 languages.
2. **Detect**: Use learned patterns to find all data access points, classify sensitive fields (PII, credentials, financial, health), trace reachability through the call graph.

Boundary rules define allowed access patterns. Violations flag unauthorized data access.

**Connects to**: Call Graph (reachability traversal), Parsers (ORM pattern extraction), Detectors (security category), MCP (drift_security_summary, drift_reachability, drift_boundaries).

### 6. Cortex Memory System (Persistent AI Memory)

Replaces static `AGENTS.md` with living memory. 23 memory types including tribal knowledge, procedural memory, pattern rationales, decision context, code smells, incidents, goals, workflows.

Key capabilities:
- **Intent-aware retrieval**: Different context for "fix bug" vs "add feature" vs "security audit"
- **Confidence decay**: Memories lose confidence over time (type-specific half-lives)
- **Contradiction detection**: Finds conflicting memories
- **Causal inference**: Builds "why" graphs explaining decisions
- **Session deduplication**: Doesn't re-send context already in the conversation
- **Hierarchical compression**: Fits memories into token budgets
- **Learning from corrections**: When AI gets corrected, Cortex learns the principle

Storage: SQLite + sqlite-vec for 384-dimensional vector embeddings. Local embedding generation via transformers.js (no external API calls).

**Connects to**: MCP (33 memory tools), Patterns (linked memories), Call Graph (linked functions), Storage (cortex.db).

### 7. MCP Server (AI Interface)

The MCP server is how AI agents interact with Drift. 50+ tools organized by token efficiency:

- **Orchestration** (start here): `drift_context` — curated context for any task. One call replaces 3-5 discovery calls.
- **Surgical** (low tokens): `drift_callers`, `drift_signature`, `drift_type`, `drift_imports` — precise lookups.
- **Exploration** (medium tokens): `drift_patterns_list`, `drift_security_summary` — filtered browsing.
- **Detail** (high tokens): `drift_code_examples`, `drift_impact_analysis` — deep inspection.
- **Memory** (33 tools): Full Cortex access — `drift_why`, `drift_memory_add`, `drift_memory_search`.

The server includes: response caching, rate limiting, token estimation, pagination cursors, tool packs (subsets for different use cases), and a feedback system for example quality.

**Connects to**: Every subsystem. The MCP server is the presentation layer for AI consumption.

### 8. Quality Gates (Enforcement)

6 gate types that can block CI/CD:
- Pattern compliance (are patterns being followed?)
- Constraint verification (are architectural constraints met?)
- Regression detection (are patterns degrading?)
- Impact analysis (is the change blast radius acceptable?)
- Security boundaries (is data access within bounds?)
- Custom rules (user-defined checks)

Policy engine with 4 built-in policies (default, strict, lenient, custom). Supports SARIF, GitHub, GitLab output formats.

**Connects to**: Patterns (compliance checking), Constraints (verification), Call Graph (impact), Boundaries (security), CLI (drift gate), CI (GitHub Action).

### 9. Storage (Persistence)

V1 has 6 fragmented backends (JSON files, SQLite, hybrid stores, data lake, Rust SQLite, Cortex SQLite). V2 consolidates to 2:
- `drift.db` — All analysis data (patterns, call graph, boundaries, audit, etc.)
- `cortex.db` — Memory system + vector embeddings

The SQLite schema has 40+ tables, 50+ indexes, triggers, and materialized views. WAL mode for concurrent reads during writes.

Rust core owns writes to drift.db. TypeScript has read-only access via NAPI. Cortex owns cortex.db entirely.

**Connects to**: Everything. Storage is the persistence layer for all subsystems.

### 10. CLI (User Interface)

50+ commands organized as thin wrappers around core services. Commander.js framework. Key commands:
- `drift setup` — Guided onboarding wizard (8 phases, 13 runners)
- `drift scan` — Full codebase scan
- `drift check` — Violation checking (supports `--staged` for pre-commit)
- `drift memory` — 20+ subcommands for Cortex
- `drift callgraph` — Call graph analysis
- `drift gate` — Quality gate execution

Pluggable reporters (text, JSON, GitHub, GitLab, SARIF). Git hook integration (pre-commit, pre-push with Husky support).

**Connects to**: Core services, Detectors, Cortex, Storage, Git.

## The Data Flow

### Scan Flow (Offline Indexing)
```
Files on disk
  → Scanner walks filesystem (parallel, respects .driftignore)
  → Parser extracts AST per file (tree-sitter + regex fallback)
  → Detectors run against each file (350+ detectors, filtered by language)
  → Patterns aggregated, deduplicated, scored (confidence algorithm)
  → Call graph built (function nodes + call edges + data access)
  → Boundaries detected (ORM patterns, sensitive fields)
  → Everything persisted to drift.db
  → History snapshot created
  → Audit health score computed
```

### Query Flow (Online — MCP)
```
AI asks: drift_context intent="add_feature" focus="authentication"
  → Context generator loads relevant patterns (auth category)
  → Retrieves code examples from pattern locations
  → Checks Cortex for tribal knowledge about auth
  → Checks call graph for auth-related functions
  → Checks boundaries for auth-related data access
  → Compresses to fit token budget
  → Returns curated context (~2000 tokens)
```

### Enforcement Flow (CI/CD)
```
Developer pushes code
  → GitHub Action runs drift-ci analyze
  → Quality gates execute (pattern compliance, security, constraints)
  → Violations reported as PR annotations
  → Exit code determines pass/fail
```

## The Language Split (Rust vs TypeScript)

**In Rust today** (~65 files): Scanner, parsers (10 languages), call graph builder, boundary detection, coupling analysis, test topology, error handling, reachability, constants, environment, wrappers. All performance-critical paths.

**In TypeScript today** (~500+ files needing migration): Detectors (all 350+), TS-side parsers, call graph extractors, core analyzers, pattern matching, storage orchestration, language intelligence.

**Stays in TypeScript forever**: CLI, MCP server, VSCode extension, Dashboard, Cortex (AI orchestration), Simulation engine.

**V2 vision**: All parsing, detection, and analysis in Rust. TypeScript becomes a thin orchestration/presentation layer. The NAPI bridge expands from ~25 functions to full coverage.

## The Business Model

Open core with 3 tiers:
- **Community** (free, Apache 2.0): All scanning, detection, analysis, CI, MCP, VSCode
- **Team** (BSL 1.1): Policy engine, regression detection, custom rules, trends, exports
- **Enterprise** (BSL 1.1): Multi-repo governance, impact simulation, security boundaries, audit trails, integrations

License gating via `packages/core/src/licensing/` — runtime feature checks before allowing gated operations. BSL code converts to Apache 2.0 after 4 years.

## Privacy

100% local. No code leaves the machine. All analysis happens locally. Cortex embeddings generated locally via transformers.js. Optional anonymous telemetry (opt-in, disable with `drift telemetry disable`).

## What Makes This Different

1. **Learns, doesn't prescribe** — Discovers YOUR conventions, doesn't enforce someone else's rules
2. **Statistical, not binary** — Confidence scores, not pass/fail. Outlier detection, not rule matching.
3. **Offline indexing** — No AI needed for scanning. Pure static analysis. Fast.
4. **MCP-native** — Built for AI consumption from day one. Token-efficient. Intent-aware.
5. **Living memory** — Cortex replaces static docs with memory that decays, learns, and contradicts itself
6. **Multi-language** — 10 languages, 28+ ORMs, 21+ web frameworks. One tool.
7. **Call graph aware** — Understands function relationships, data flow, reachability. Not just file-level.
