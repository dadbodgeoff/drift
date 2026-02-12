# Core Analyzers

## Location
`packages/core/src/analyzers/` — 5 source files + 3 test files

## What They Are
Four foundational analysis engines that operate on tree-sitter ASTs. They provide the building blocks that detectors, rules, and pattern matching consume. Every file scanned by Drift passes through one or more of these analyzers.

## Files
- `ast-analyzer.ts` — `ASTAnalyzer`: structural pattern matching, subtree comparison, traversal
- `type-analyzer.ts` — `TypeAnalyzer`: type extraction, subtyping, compatibility, coverage
- `semantic-analyzer.ts` — `SemanticAnalyzer`: scope analysis, symbol resolution, reference tracking
- `flow-analyzer.ts` — `FlowAnalyzer`: control flow graphs, data flow, unreachable code detection
- `types.ts` — Shared types (~50 interfaces across all analyzers)

---

## AST Analyzer (`ast-analyzer.ts`)
~800 lines. Structural analysis of tree-sitter ASTs.

### Key Methods
| Method | Purpose |
|--------|---------|
| `findPattern(ast, pattern, options)` | Find AST nodes matching a structural pattern |
| `compareSubtrees(node1, node2, options)` | Compare two AST subtrees for similarity |
| `getStats(ast)` | Node count, depth, leaf count, type distribution |
| `traverse(ast, visitor)` | Walk AST with visitor callback |
| `findNodesByType(ast, type)` | Find all nodes of a given type |
| `findNodeAtPosition(ast, position)` | Find node at cursor position |
| `getDescendants(node)` | All descendants of a node |
| `getNodeDepth(ast, node)` | Depth of a node in the tree |
| `getParentChain(ast, node)` | Ancestors from root to node |
| `analyze(ast, patterns)` | Run multiple patterns, return matches with confidence |

### ASTPattern Interface
```typescript
interface ASTPattern {
  nodeType: string;              // Required tree-sitter node type
  text?: string | RegExp;        // Text content match
  children?: ASTPattern[];       // Child pattern requirements
  minChildren?: number;
  maxChildren?: number;
  hasChild?: string;             // Must have child of this type
  notHasChild?: string;          // Must NOT have child of this type
  depth?: number;                // Expected depth
  metadata?: Record<string, unknown>;
}
```

### Subtree Comparison
Compares two AST subtrees structurally. Returns similarity score (0-1), list of differences, and whether they're structurally equivalent. Used by pattern detection to find code that follows the same structural pattern.

---

## Type Analyzer (`type-analyzer.ts`)
~1600 lines. Full type system analysis for TypeScript ASTs.

### Key Methods
| Method | Purpose |
|--------|---------|
| `extractType(node, options)` | Extract TypeInfo from an AST node |
| `analyzeTypes(ast, options)` | Full type analysis of a file |
| `isSubtypeOf(type1, type2)` | Structural subtype check |
| `areTypesCompatible(type1, type2)` | Compatibility check (looser than subtype) |
| `getTypeCoverage(ast)` | Percentage of typed locations |
| `analyzeTypeRelationships(ast)` | Inheritance, implementation, composition relationships |
| `areTypesEquivalent(type1, type2)` | Structural equivalence check |

### Type Extraction
Handles all TypeScript type constructs:
- Primitives (string, number, boolean, etc.)
- Type references (named types, generics)
- Union types (`A | B`)
- Intersection types (`A & B`)
- Array types (`T[]`, `Array<T>`)
- Tuple types (`[A, B, C]`)
- Function types (`(a: A) => B`)
- Object types (inline `{ key: Type }`)
- Literal types (`"hello"`, `42`, `true`)
- Type parameters (generics `<T extends Base>`)

### TypeInfo Structure
```typescript
interface TypeInfo {
  kind: TypeKind;                // primitive, reference, union, intersection, array, tuple, function, object, literal, parameter, unknown
  text: string;                  // Original text representation
  name?: string;                 // Type name (for references)
  members?: TypePropertyInfo[];  // Object members
  parameters?: TypeInfo[];       // Function parameters
  returnType?: TypeInfo;         // Function return type
  elementType?: TypeInfo;        // Array element type
  types?: TypeInfo[];            // Union/intersection members
  typeArguments?: TypeInfo[];    // Generic type arguments
  constraint?: TypeInfo;         // Type parameter constraint
  defaultType?: TypeInfo;        // Type parameter default
  isOptional?: boolean;
  isReadonly?: boolean;
  isExported?: boolean;
}
```

### Type Coverage
Calculates what percentage of typeable locations (parameters, return types, variables) have explicit type annotations. Returns `TypeCoverageInfo` with total locations, typed count, untyped count, and percentage.

---

## Semantic Analyzer (`semantic-analyzer.ts`)
~1350 lines. Scope analysis, symbol resolution, and reference tracking.

### Key Methods
| Method | Purpose |
|--------|---------|
| `analyze(ast, options)` | Full semantic analysis of a file |
| `resolveSymbol(name, scopeId)` | Resolve a symbol name in a scope chain |
| `getVisibleSymbols(scopeId)` | All symbols visible in a scope |
| `getScopeAtPosition(position)` | Find scope at cursor position |

### What It Builds
1. **Scope tree** — Nested scopes (global → module → function → block → etc.)
2. **Symbol table** — All declarations with type, visibility, mutability, references
3. **Reference resolution** — Links identifier uses to their declarations
4. **Shadowed variable detection** — Finds variables that shadow outer scope names

### Scope Types
Global, module, function, method, class, block, for-loop, if-branch, switch-case, try, catch

### Symbol Collection
Collects declarations from:
- Function declarations (including async, generator)
- Arrow functions
- Method definitions
- Class declarations (with members)
- Field definitions
- Variable declarations (const/let/var with mutability tracking)
- Destructuring patterns (object and array)
- Import declarations (named, default, namespace)
- Export declarations
- Interface declarations
- Type alias declarations
- Enum declarations

### Reference Resolution
After collecting all declarations, resolves identifier references:
- Walks the AST looking for identifier nodes
- Skips declaration contexts and property access
- Resolves through scope chain (inner → outer)
- Tracks read vs write references
- Records unresolved references

### SemanticAnalysisResult
```typescript
interface SemanticAnalysisResult {
  scopes: ScopeInfo[];
  symbols: SymbolInfo[];
  references: SymbolReference[];
  unresolvedReferences: SymbolReference[];
  shadowedVariables: ShadowedVariable[];
  errors: AnalysisError[];
}
```

---

## Flow Analyzer (`flow-analyzer.ts`)
~1600 lines. Control flow graph construction and data flow analysis.

### Key Methods
| Method | Purpose |
|--------|---------|
| `analyze(ast, options)` | Full flow analysis of a file |
| `analyzeFunction(node, options)` | Flow analysis of a single function |
| `getNodes()` | All CFG nodes |
| `getEdges()` | All CFG edges |
| `isNodeReachable(nodeId)` | Check if a node is reachable |
| `getPredecessors(nodeId)` | Predecessor nodes in CFG |
| `getSuccessors(nodeId)` | Successor nodes in CFG |

### Control Flow Graph Construction
Builds a CFG from AST with nodes for:
- Entry/exit points
- Statements (expression, declaration, assignment)
- Branches (if/else, switch/case)
- Loops (for, for-in/of, while, do-while)
- Exception handling (try/catch/finally)
- Returns, throws, breaks, continues

Edge types: `normal`, `true-branch`, `false-branch`, `exception`, `break`, `continue`, `return`, `throw`

### Data Flow Analysis
Tracks variable definitions and uses through the CFG:
- Variable definitions (where assigned)
- Variable uses (where read)
- Reaching definitions (which definitions reach each use)
- Null dereference detection (potentially null variables used without check)

### Issue Detection
- **Unreachable code** — Nodes not reachable from entry
- **Infinite loops** — Loops without break/return in body
- **Missing returns** — Functions that don't return on all paths
- **Null dereferences** — Potentially null variables used without null check

### FlowAnalysisResult
```typescript
interface FlowAnalysisResult {
  cfg: ControlFlowGraph;
  dataFlow: DataFlowInfo;
  unreachableCode: SourceLocation[];
  infiniteLoops: SourceLocation[];
  missingReturns: SourceLocation[];
  nullDereferences: SourceLocation[];
}
```

---

## Shared Types (`types.ts`)
~830 lines. Defines ~50 interfaces used across all analyzers.

Key type groups:
- **Analysis context**: `AnalysisContext`, `ProjectContext`, `AnalysisConfig`
- **Import/Export**: `AnalysisImportInfo`, `ImportedSymbol`, `AnalysisExportInfo`
- **Results**: `FileAnalysisResult`, `PatternMatch`, `AnalysisMetrics`, `AnalysisError`
- **Symbols**: `SymbolInfo` (with kind, visibility, mutability, decorators, type), `SymbolReference`, `ParameterInfo`, `DecoratorInfo`
- **Scopes**: `ScopeInfo` (with parent, children, symbols, references)
- **Types**: `TypeInfo`, `TypePropertyInfo`, `TypeParameterInfo`
- **Control flow**: `ControlFlowGraph`, `ControlFlowNode`, `ControlFlowEdge`
- **Data flow**: `DataFlowInfo`, `DataFlowVariable`, `SourceLocation`
- **Results**: `ASTAnalysisResult`, `ASTStats`, `TypeAnalysisResult`, `SemanticAnalysisResult`, `FlowAnalysisResult`

## Consumers
These analyzers are consumed by:
- **Detectors** — Pattern detection uses AST analyzer for structural matching
- **Rules engine** — Evaluator uses semantic analyzer for context
- **Quality gates** — Type coverage gate uses type analyzer
- **Call graph** — Function extraction uses AST traversal
- **Error handling** — Uses flow analyzer for control flow analysis

## v2 Notes
- All four analyzers should move to Rust for performance
- AST analyzer maps directly to tree-sitter query patterns (already partially in Rust unified analyzer)
- Type analyzer is TypeScript-specific — needs per-language variants in Rust
- Semantic analyzer (scope/symbol resolution) is critical for call resolution accuracy
- Flow analyzer (CFG construction) is needed for error handling and data flow analysis in Rust
