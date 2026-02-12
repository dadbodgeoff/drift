# Parser Integration Points

## Purpose
Documents how the parser subsystem connects to every other Drift subsystem. Parsers are the foundation — everything depends on their output.

## Dependency Graph

```
                         ┌──────────────┐
                         │   Parsers    │
                         └──────┬───────┘
                                │
            ┌───────────────────┼───────────────────┐
            │                   │                   │
     ┌──────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐
     │  Call Graph  │    │  Detectors  │    │  Analyzers  │
     └──────┬───────┘    └──────┬──────┘    └──────┬──────┘
            │                   │                   │
     ┌──────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐
     │ Reachability │    │  Patterns   │    │  Quality    │
     │ Impact       │    │  Violations │    │  Gates      │
     └──────┬───────┘    └─────────────┘    └─────────────┘
            │
     ┌──────▼──────┐
     │  Security   │
     │  Boundaries │
     └─────────────┘
```

## 1. Call Graph Extractors

**Location**: `packages/core/src/call-graph/extractors/`

Call graph extractors consume parser output to build function-level dependency graphs.

### BaseCallGraphExtractor
```typescript
abstract class BaseCallGraphExtractor {
  abstract readonly language: CallGraphLanguage;
  abstract readonly extensions: string[];
  abstract extract(source: string, filePath: string): FileExtractionResult;
}
```

### What They Use from Parsers
- `FunctionInfo` → `FunctionExtraction` (nodes in the graph)
- `CallSite` → `CallExtraction` (edges in the graph)
- `ImportInfo` → `ImportExtraction` (cross-file resolution)
- `ExportInfo` → `ExportExtraction` (public API surface)
- `ClassInfo` → `ClassExtraction` (method grouping)

### Per-Language Extractors
8 language-specific extractors (TypeScript, Python, Java, C#, PHP, Go, Rust, C++) each use the corresponding parser. Some use hybrid extraction (AST + regex) for robustness.

## 2. Pattern Detectors

**Location**: `packages/detectors/src/`

22 detector categories consume parser output to identify codebase patterns.

### What They Use
- `FunctionInfo.decorators` → Framework pattern detection (Spring, Django, NestJS)
- `ClassInfo.extends/implements` → Inheritance pattern detection
- `ImportInfo` → Dependency pattern detection
- `FunctionInfo.parameters` → API signature patterns
- `ClassInfo.properties` → Data model patterns

### Key Detectors That Depend on Parsers
- **API Detector**: Uses decorators/annotations to find route handlers
- **Auth Detector**: Uses decorators to find auth middleware
- **Data Access Detector**: Uses imports + class properties to find ORM models
- **Component Detector**: Uses class hierarchy to detect component patterns
- **Error Detector**: Uses call sites to find error handling patterns

## 3. Analyzers

**Location**: `packages/core/src/analyzers/`

### AST Analyzer
Directly consumes `ParseResult.ast` for structural analysis.

### Type Analyzer
Uses `FunctionInfo.parameters`, `ClassInfo.properties` for type coverage analysis.

### Semantic Analyzer
Uses full `ParseResult` for semantic understanding of code structure.

### Flow Analyzer
Uses `CallSite` data combined with call graph for data flow analysis.

## 4. Boundary Scanner

**Location**: `crates/drift-core/src/boundaries/`

Uses parser output to detect data access points:
- `ImportInfo` → ORM library detection (Prisma, Django, SQLAlchemy, Supabase, GORM, Diesel)
- `ClassInfo.decorators` → Entity/Model annotation detection
- `ClassInfo.properties` → Sensitive field detection
- `FunctionInfo` → Data access function identification

## 5. Security System

**Location**: `packages/core/src/security/`

### DataAccessLearner
Uses parser output to learn data access conventions:
- Framework detection from imports
- Convention learning from function names + decorators
- Sensitive data identification from property types

### Reachability Engine
Uses call graph (which uses parsers) to trace data flow from sensitive sources to public endpoints.

## 6. Test Topology

**Location**: `packages/core/src/test-topology/`

Uses parser output to:
- Detect test frameworks from imports
- Extract test function definitions
- Map test coverage to source functions
- Analyze mock usage patterns

## 7. Contract Tracker

**Location**: `packages/core/src/contracts/`

Uses parser output (especially Pydantic models) to:
- Extract API request/response shapes
- Detect backend ↔ frontend type mismatches
- Track field-level contract changes

## 8. Constraint System

**Location**: `packages/core/src/constraints/`

Uses parser output to:
- Detect architectural invariants from code structure
- Verify constraints against current code
- Synthesize new constraints from patterns

## v2 Impact
When Rust parsers reach full parity:
- All integration points can consume Rust output directly via NAPI
- No more dual-path (Rust vs TS) parsing decisions
- Consistent extraction depth across all consumers
- Performance improvement for all downstream systems
