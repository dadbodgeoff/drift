# Subsystem Connection Map

## Purpose
This document maps how every subsystem in Drift connects to every other subsystem. When building or modifying any part of the system, consult this to understand what you'll affect.

## Connection Matrix

```
                    Parse  Detect  Pattern  CallGr  Bound  Cortex  MCP   Gates  Store  CLI
Parsers              —      OUT     —        OUT     OUT     —      —      —      —     —
Detectors           IN      —      OUT       —       —      —      —      —      —     —
Patterns             —      IN      —        —       —     LINK    OUT    IN     IN/OUT  OUT
Call Graph          IN      —       —        —      OUT     LINK   OUT    IN     IN/OUT  OUT
Boundaries          IN      —       —        IN      —      —      OUT    IN     IN/OUT  OUT
Cortex               —      —      LINK     LINK     —      —      OUT    —      IN/OUT  OUT
MCP Server           —      —       IN       IN      IN     IN      —     IN      IN     —
Quality Gates        —      —       IN       IN      IN     —       IN     —      IN     OUT
Storage              —      —      IN/OUT   IN/OUT  IN/OUT  IN/OUT  OUT    IN     —      —
CLI                  —      —       IN       IN      IN     IN      —      IN     IN     —
```

Legend: IN = consumes from, OUT = produces for, LINK = bidirectional linking, IN/OUT = reads and writes

## Dependency Chains

### Scan Pipeline (sequential)
```
Scanner → Parsers → Detectors → Patterns → Storage
                  → Call Graph Builder → Storage
                  → Boundary Scanner → Storage
                  → Constants/Environment/DNA/etc → Storage
```

### Query Pipeline (parallel, any entry point)
```
MCP Tool Request
  ├→ Pattern queries (drift_patterns_list, drift_code_examples)
  ├→ Call graph queries (drift_callers, drift_impact_analysis)
  ├→ Boundary queries (drift_security_summary, drift_reachability)
  ├→ Cortex queries (drift_why, drift_memory_search)
  └→ Orchestration (drift_context — combines all of the above)
```

### Enforcement Pipeline (sequential)
```
Quality Gates → Pattern Store (compliance check)
             → Constraint Store (verification)
             → Call Graph (impact analysis)
             → Boundary Store (security check)
             → Reporters (text/JSON/SARIF/GitHub/GitLab)
             → Exit code (pass/fail)
```

## Data Flow Between Subsystems

### Patterns ↔ Cortex
Bidirectional linking. Patterns can have linked memories (rationales, tribal knowledge). Memories can reference patterns. When a pattern is approved, Cortex can store the rationale. When Cortex retrieves context, it includes relevant pattern information.

```
Pattern approved → drift_memory_add type="pattern_rationale" linkedPatterns=[patternId]
Cortex retrieval → includes patterns linked to relevant memories
```

### Call Graph ↔ Boundaries
The call graph provides the traversal structure. Boundaries provide the data access points. Together they answer "what sensitive data can this code reach?"

```
Call Graph: function A calls function B calls function C
Boundaries: function C accesses table "users" field "ssn" (PII)
Reachability: function A can reach PII data through 2 hops
```

### Call Graph ↔ Test Topology
Test topology maps test files to source files. The call graph maps function relationships. Together they answer "which tests cover this function?" and "if I change this function, which tests should I run?"

```
Test Topology: test_auth.py covers auth_service.py
Call Graph: auth_service.login() calls user_repo.find_by_email()
Combined: test_auth.py transitively covers user_repo.find_by_email()
```

### Detectors → Patterns → Rules Engine → Violations
The detection pipeline:
```
Detector.detect(file, ast) → PatternMatch[]
PatternMatcher.aggregate(matches) → Pattern[] (with confidence scores)
OutlierDetector.detect(pattern) → Outlier[] (statistical deviations)
Evaluator.evaluate(patterns) → Violation[] (for approved patterns with outliers)
```

### MCP ↔ Everything
The MCP server is the universal query interface. It doesn't own data — it queries other subsystems:

| MCP Tool | Subsystem Queried |
|----------|-------------------|
| `drift_context` | Patterns + Call Graph + Boundaries + Cortex (orchestrated) |
| `drift_patterns_list` | Pattern Store |
| `drift_callers` | Call Graph |
| `drift_security_summary` | Boundaries + Call Graph |
| `drift_why` | Cortex (memories + causal graphs) |
| `drift_impact_analysis` | Call Graph + Boundaries |
| `drift_validate_change` | Patterns + Rules Engine |
| `drift_quality_gate` | Quality Gates (which queries Patterns + Constraints + Call Graph + Boundaries) |

### Storage ↔ Everything
Storage is the persistence layer. Every subsystem reads from and/or writes to storage:

| Subsystem | Writes To | Reads From |
|-----------|-----------|------------|
| Scanner/Detectors | patterns, pattern_locations | — |
| Call Graph Builder | functions, function_calls, function_data_access | — |
| Boundary Scanner | data_models, sensitive_fields, data_access_points | — |
| Cortex | memories, memory_relationships, memory_embeddings | memories, embeddings |
| MCP Server | — (read-only) | All tables |
| CLI | — (via services) | All tables |
| Quality Gates | gate_runs, gate_results | patterns, constraints, functions |
| Audit Engine | audit_snapshots, health_trends | patterns, scan_history |

## Circular Dependencies (None by Design)

The architecture is strictly layered:
```
Layer 1 (Foundation): Parsers, Storage
Layer 2 (Analysis): Detectors, Call Graph, Boundaries, Constants, Environment, DNA, etc.
Layer 3 (Intelligence): Patterns (aggregated), Cortex, Constraints, Test Topology
Layer 4 (Enforcement): Rules Engine, Quality Gates, Audit
Layer 5 (Presentation): MCP, CLI, VSCode, Dashboard
```

Each layer only depends on layers below it. No circular dependencies.

## Event-Driven Architecture

Nearly every store extends EventEmitter. Key events:

| Event | Emitted By | Consumed By |
|-------|-----------|-------------|
| `pattern:added` | PatternStore | Data Lake, Audit |
| `pattern:approved` | PatternStore | Rules Engine, Cortex |
| `pattern:removed` | PatternStore | Data Lake, Audit |
| `patterns:loaded` | PatternStore | MCP cache warming |
| `scan:complete` | ScannerService | History, Audit, Views |
| `memory:created` | CortexV2 | Session tracker |
| `memory:accessed` | CortexV2 | Decay engine |

This pub/sub architecture means subsystems are loosely coupled — they communicate through events, not direct calls.
