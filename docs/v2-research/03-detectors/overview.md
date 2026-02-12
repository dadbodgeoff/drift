# Detectors — Overview

## Location
`packages/detectors/` — 100% TypeScript, ~350+ source files

## What It Is
The detector system is Drift's pattern recognition engine. It scans codebases to discover conventions, detect violations, and learn project-specific patterns. Every detector category has up to 3 variants (base, learning, semantic) and the system supports 7 languages and 6 frameworks.

## Core Design Principles
1. Learn from the codebase, don't enforce arbitrary rules
2. Every detector has a base (fast regex), learning (adapts to conventions), and semantic (deep AST) variant
3. Framework-specific detectors extend the base patterns for Laravel, Spring, ASP.NET, Django, Go, Rust, C++
4. The registry system enables dynamic loading, enable/disable, and querying
5. Unified detectors can combine multiple strategies and merge results

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   DetectorRegistry                       │
│  register / query / enable / disable / events            │
├──────────────────────────────────────────────────────────┤
│                   DetectorLoader                         │
│  lazy loading / factory functions / module management     │
├──────────────────────────────────────────────────────────┤
│                   Base Classes                            │
│  BaseDetector → RegexDetector                            │
│              → ASTDetector                               │
│              → StructuralDetector                        │
│              → LearningDetector (ValueDistribution)      │
│              → SemanticDetector                          │
│              → SemanticLearningDetector                  │
│              → UnifiedDetector (multi-strategy)          │
├──────────────────────────────────────────────────────────┤
│              16 Detector Categories                       │
│  security │ auth │ errors │ api │ components │ config    │
│  contracts │ data-access │ documentation │ logging       │
│  performance │ structural │ styling │ testing │ types    │
│  accessibility                                           │
├──────────────────────────────────────────────────────────┤
│              Framework-Specific Extensions                │
│  Laravel │ Spring │ ASP.NET │ Django │ Go │ Rust │ C++   │
├──────────────────────────────────────────────────────────┤
│              PHP Utilities                                │
│  class/method/attribute/docblock extractors               │
└──────────────────────────────────────────────────────────┘
```

## Detector Variant Pattern (per detector)
Each detector typically has 3 files:
- `{name}.ts` — Base detector (regex/AST, fast, deterministic)
- `{name}-learning.ts` — Learning detector (adapts to codebase conventions)
- `{name}-semantic.ts` — Semantic detector (keyword-based, context-aware)

Example: `sql-injection.ts` + `sql-injection-learning.ts` + `sql-injection-semantic.ts`

## Documentation Index

| Document | Content |
|----------|---------|
| [base-classes.md](./base-classes.md) | All 7 base classes with APIs |
| [categories.md](./categories.md) | All 16 categories with every detector |
| [detector-contracts.md](./detector-contracts.md) | Input/output contracts, algorithms |
| [registry.md](./registry.md) | Registry + loader system |
| [framework-detectors.md](./framework-detectors.md) | All framework-specific detectors |
| [contracts-system.md](./contracts-system.md) | BE↔FE contract matching |
| [learning-system.md](./learning-system.md) | How learning detectors work |
| [semantic-system.md](./semantic-system.md) | How semantic detectors work |
| [php-utilities.md](./php-utilities.md) | PHP extraction utilities |

### Pattern System (deep dive)

| Document | Content |
|----------|---------|
| [patterns/overview.md](./patterns/overview.md) | Architecture, pipeline, categories, lifecycle |
| [patterns/data-model.md](./patterns/data-model.md) | Pattern JSON schema, all types, full data model |
| [patterns/confidence-scoring.md](./patterns/confidence-scoring.md) | Weighted scoring algorithm, factors, thresholds |
| [patterns/outlier-detection.md](./patterns/outlier-detection.md) | Z-score, IQR, rule-based detection |
| [patterns/pattern-matching.md](./patterns/pattern-matching.md) | AST, regex, structural matching engine |
| [patterns/rules-engine.md](./patterns/rules-engine.md) | Violation generation, severity, variants |
| [patterns/storage.md](./patterns/storage.md) | SQLite schema, JSON shards, indexes, backups |
| [patterns/pipeline.md](./patterns/pipeline.md) | End-to-end detection pipeline (8 phases) |

## Detector Count Summary
- 16 categories
- ~100+ individual detectors (base variants)
- ~100+ learning variants
- ~100+ semantic variants
- ~350+ total source files
- 7 supported languages: TypeScript, JavaScript, Python, Go, Rust, C++, PHP/C#
- 6 framework integrations: Laravel, Spring, ASP.NET, Django, Go frameworks, Rust frameworks
