# Module Coupling Analysis

## Location
- `packages/core/src/module-coupling/` — TypeScript (3 files)
- `crates/drift-core/src/coupling/` — Rust (3 files)

## What It Is
Analyzes import/call dependencies between modules to detect coupling hotspots, dependency cycles, and unused exports. Integrates with the call graph for transitive dependency analysis and provides refactoring impact assessment.

---

## TypeScript Implementation (`packages/core/src/module-coupling/`)

### Files
- `coupling-analyzer.ts` — `ModuleCouplingAnalyzer`: main analysis engine (~900 lines)
- `types.ts` — All coupling types
- `index.ts` — Exports

### Class: ModuleCouplingAnalyzer

#### Construction
Takes `ModuleCouplingOptions` with root directory and optional call graph. When call graph is available, uses it for transitive dependency analysis and caller lookup.

#### Key Methods
| Method | Purpose |
|--------|---------|
| `build()` | Build the full coupling graph from call graph data |
| `analyzeModule(path)` | Detailed analysis of a single module |
| `analyzeRefactorImpact(path)` | Estimate impact of refactoring a module |
| `getCycles(options)` | Detect dependency cycles |
| `getHotspots(options)` | Find high-coupling modules |
| `getUnusedExports()` | Find exports with no consumers |

### Graph Building Algorithm (`build()`)
```
1. For each file in call graph:
   a. Create ModuleNode with path, language, exports
   b. Infer export kinds (function, class, type, constant)
2. For each function in call graph:
   a. Find cross-file calls → create ImportEdge
   b. Track: source module, target module, imported symbols
3. Calculate metrics per module:
   - afferentCoupling (Ca): modules that depend on this one
   - efferentCoupling (Ce): modules this one depends on
   - instability: Ce / (Ca + Ce)  — 0=stable, 1=unstable
   - abstractness: abstract exports / total exports
4. Determine module role: hub, leaf, bridge, isolated
5. Detect unused exports
6. Detect dependency cycles
7. Calculate aggregate metrics
```

### Coupling Metrics
```typescript
interface CouplingMetrics {
  afferentCoupling: number;      // Incoming dependencies (Ca)
  efferentCoupling: number;      // Outgoing dependencies (Ce)
  instability: number;           // Ce / (Ca + Ce), 0-1
  abstractness: number;          // Abstract exports / total
  totalExports: number;
  usedExports: number;
  unusedExports: number;
}
```

### Module Roles
| Role | Criteria |
|------|----------|
| `hub` | High afferent AND efferent coupling |
| `leaf` | Low afferent, some efferent |
| `bridge` | Connects otherwise disconnected modules |
| `isolated` | No dependencies in or out |

### Cycle Detection Algorithm
Uses DFS with path tracking:
```
1. For each unvisited module:
   a. DFS through dependencies
   b. Track current path
   c. If we revisit a node in current path → cycle found
   d. Record cycle path
2. For each cycle:
   a. Calculate severity (critical if >5 modules, high if >3, medium if >2, low otherwise)
   b. Suggest break points (edges with lowest coupling)
   c. Estimate break effort per edge
   d. Generate rationale and approach
```

### Cycle Severity
```typescript
type CycleSeverity = 'critical' | 'high' | 'medium' | 'low';
// critical: >5 modules in cycle
// high: >3 modules
// medium: >2 modules
// low: 2 modules
```

### Break Point Suggestion
For each edge in a cycle:
- Estimates effort: `low` (simple re-export), `medium` (interface extraction), `high` (major refactor)
- Generates rationale based on module roles
- Suggests approach (dependency inversion, extract interface, merge modules)

### Unused Export Analysis
```typescript
interface UnusedExportAnalysis {
  file: string;
  symbol: string;
  kind: string;                  // function, class, type, constant
  line: number;
  reasons: string[];             // Inferred reasons: dead-code, test-only, internal, deprecated
  confidence: number;
}
```

Inferred reasons for non-usage:
- `dead-code` — No references anywhere
- `test-only` — Only referenced from test files
- `internal` — Only used within same directory
- `deprecated` — Marked with @deprecated

### Refactor Impact Assessment
```typescript
interface RefactorImpact {
  module: string;
  directDependents: string[];
  transitiveDependents: string[];
  affectedTests: string[];
  health: ModuleHealth;
  effort: RefactorEffort;
  risk: RefactorRisk;
  suggestions: string[];
}
```

- **Health** — Based on coupling metrics, cycle involvement, unused exports
- **Effort** — Estimated from dependent count and coupling depth
- **Risk** — Based on transitive impact and test coverage

---

## Rust Implementation (`crates/drift-core/src/coupling/`)

### Files
- `analyzer.rs` — `CouplingAnalyzer`: basic coupling analysis
- `types.rs` — `ModuleMetrics`, `DependencyCycle`, `CouplingHotspot`, `UnusedExport`, `CouplingResult`
- `mod.rs` — Module exports

### NAPI Exposure
- `analyze_coupling(files: Vec<String>) -> JsCouplingResult`

### What Rust Handles
- Basic import/export dependency extraction from parsed files
- Module metrics calculation (afferent, efferent, instability)
- Cycle detection
- Hotspot identification

### What's Missing in Rust (vs TS)
- Refactor impact assessment
- Break point suggestion with effort estimation
- Unused export reason inference
- Module role classification
- Transitive dependency analysis (needs call graph integration)
- Module health scoring

---

## Types

### ModuleNode
```typescript
interface ModuleNode {
  path: string;
  language: string;
  exports: ExportedSymbol[];
  role: ModuleRole;
  metrics: CouplingMetrics;
}
```

### ImportEdge
```typescript
interface ImportEdge {
  source: string;                // Importing module
  target: string;                // Imported module
  symbols: string[];             // Imported symbol names
  isTypeOnly: boolean;
}
```

### DependencyCycle
```typescript
interface DependencyCycle {
  path: string[];                // Module paths in cycle
  severity: CycleSeverity;
  breakPoints: BreakPoint[];
}

interface BreakPoint {
  from: string;
  to: string;
  effort: BreakEffort;           // low, medium, high
  rationale: string;
  approach: string;
}
```

---

## MCP Integration
- `drift_coupling` — Module coupling analysis with cycle detection and hotspot identification

## Consumers
- **Quality Gates** — Coupling gate checks for new cycles and hotspot thresholds
- **Constraints** — Structural constraints can enforce coupling limits
- **CLI** — `drift coupling` command with cycle and hotspot reporting

## v2 Notes
- Cycle detection and metrics are ideal for Rust (graph algorithms)
- Refactor impact needs call graph integration — move to Rust when call graph is fully Rust
- Break point suggestion is heuristic — can stay TS
- The instability metric (Robert C. Martin) is the key metric to preserve
