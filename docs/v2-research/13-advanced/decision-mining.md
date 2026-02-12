# Decision Mining — Overview

## Location
`packages/core/src/decisions/` — 100% TypeScript (~15 source files)

## What It Is
Mines architectural decisions from git history. Walks commits, extracts semantic signals per language, clusters related changes, and synthesizes Architecture Decision Records (ADRs). The goal: automatically surface "why was this done?" from commit history so teams don't lose institutional knowledge.

## Core Design Principles
1. Decisions are mined, not declared — they emerge from commit patterns
2. Multi-language extraction (5 dedicated extractors + 2 generic)
3. Clustering groups related commits by time, files, and patterns
4. ADRs are synthesized with context, decision, consequences, and evidence
5. Confidence scoring filters noise from signal

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│              DecisionMiningAnalyzer                       │
│  (analyzer/decision-mining-analyzer.ts — orchestrator)   │
├──────────┬──────────┬──────────┬────────────────────────┤
│ Git      │ Semantic │Clustering│   ADR Synthesis         │
│ Walking  │Extraction│          │                         │
├──────────┴──────────┴──────────┴────────────────────────┤
│                  Git Integration (git/)                   │
│  GitWalker  │  CommitParser  │  DiffAnalyzer             │
├─────────────────────────────────────────────────────────┤
│              Language Extractors (extractors/)            │
│  TS │ Python │ Java │ C# │ PHP │ BaseCommitExtractor     │
├─────────────────────────────────────────────────────────┤
│                  Output                                   │
│  MinedDecision → SynthesizedADR                          │
└─────────────────────────────────────────────────────────┘
```

## Entry Points
- `analyzer/decision-mining-analyzer.ts` — `DecisionMiningAnalyzer` class
- `index.ts` — Public exports (all extractors, git tools, types)

## Subsystem Directory Map

| Directory / File | Purpose | Doc |
|------------------|---------|-----|
| `analyzer/` | Main mining pipeline orchestrator | [analyzer.md](./decisions/analyzer.md) |
| `git/` | Git history traversal, commit parsing, diff analysis | [git.md](./decisions/git.md) |
| `extractors/` | 5 language-specific commit extractors | [extractors.md](./decisions/extractors.md) |
| `types.ts` | All type definitions (30+ interfaces) | [types.md](./decisions/types.md) |

## Mining Pipeline

```
1. Walk git history (GitWalker) → GitCommit[]
2. Extract semantics per commit (language extractors) → CommitSemanticExtraction[]
3. Cluster related commits → CommitCluster[]
4. Synthesize decisions from clusters → MinedDecision[] with ADRs
```

## Decision Categories (12)

| Category | Description |
|----------|-------------|
| `technology-adoption` | New framework/library added |
| `technology-removal` | Removing a dependency |
| `pattern-introduction` | New coding pattern introduced |
| `pattern-migration` | Changing from one pattern to another |
| `architecture-change` | Structural/architectural changes |
| `api-change` | API modifications (breaking or non-breaking) |
| `security-enhancement` | Security improvements |
| `performance-optimization` | Performance-related changes |
| `refactoring` | Code restructuring without behavior change |
| `testing-strategy` | Changes to testing approach |
| `infrastructure` | Build, deploy, CI/CD changes |
| `other` | Uncategorized |

## Supported Languages

| Language | Dedicated Extractor | File Extensions |
|----------|-------------------|-----------------|
| TypeScript | ✅ `TypeScriptCommitExtractor` | `.ts`, `.tsx` |
| JavaScript | ✅ (shares TS extractor) | `.js`, `.jsx` |
| Python | ✅ `PythonCommitExtractor` | `.py` |
| Java | ✅ `JavaCommitExtractor` | `.java` |
| C# | ✅ `CSharpCommitExtractor` | `.cs` |
| PHP | ✅ `PhpCommitExtractor` | `.php` |
| Rust | ❌ (generic analysis) | `.rs` |
| C++ | ❌ (generic analysis) | `.cpp`, `.h` |

## MCP Integration
Exposed via decision-related drift tools for querying mined decisions and ADRs.

## Connections to Other Subsystems
- **Call Graph** — impact analysis of detected changes
- **Pattern Service** — pattern change detection enriches extraction
- **Audit System** — mined decisions tracked in audit history
- **Cortex Memory** — decisions stored as institutional knowledge

## v2 Migration Notes
- Git operations stay in TypeScript (`simple-git` library)
- Commit parsing and diff analysis could move to Rust for speed on large repos (10k+ commits)
- ADR synthesis is AI-assisted → stays in TypeScript
- Language extractors are pattern matching → good Rust candidates
