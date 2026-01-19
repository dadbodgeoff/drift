/**
 * Analyzer type definitions
 *
 * Provides types for AST analysis, type analysis, semantic analysis,
 * and control flow analysis. These types support the unified AST query
 * interface across all languages.
 *
 * @requirements 3.5 - Parser SHALL provide a unified AST query interface across all languages
 */

import type { AST, ASTNode, Position, Language } from '../parsers/types.js';
import type { Violation } from '../rules/types.js';

// ============================================================================
// Analysis Context Types
// ============================================================================

/**
 * Context provided to analyzers for performing analysis
 */
export interface AnalysisContext {
  /** Absolute path to the file being analyzed */
  file: string;

  /** Path relative to project root */
  relativePath: string;

  /** File content as string */
  content: string;

  /** Parsed AST (null if parsing failed) */
  ast: AST | null;

  /** Detected language of the file */
  language: Language;

  /** Import information extracted from the file */
  imports: AnalysisImportInfo[];

  /** Export information extracted from the file */
  exports: AnalysisExportInfo[];

  /** Project-wide context for cross-file analysis */
  projectContext: ProjectContext;
}

/**
 * Project-wide context for cross-file analysis
 */
export interface ProjectContext {
  /** Root directory of the project */
  rootDir: string;

  /** All project files (relative paths) */
  files: string[];

  /** Dependency graph: file -> files it imports */
  dependencies: Map<string, string[]>;

  /** Reverse dependency graph: file -> files that import it */
  dependents: Map<string, string[]>;

  /** Configuration options affecting analysis */
  config?: AnalysisConfig;
}

/**
 * Configuration options for analysis
 */
export interface AnalysisConfig {
  /** Whether to perform deep type analysis */
  deepTypeAnalysis?: boolean;

  /** Whether to track data flow */
  trackDataFlow?: boolean;

  /** Maximum depth for recursive analysis */
  maxAnalysisDepth?: number;

  /** Languages to analyze */
  languages?: Language[];
}

// ============================================================================
// Import/Export Information (for Analysis Context)
// ============================================================================

/**
 * Information about an import statement for analysis context
 * Note: This is distinct from scanner's ImportInfo which tracks dependency graph
 */
export interface AnalysisImportInfo {
  /** Module specifier (e.g., './utils', 'lodash') */
  source: string;

  /** Whether this is a relative import */
  isRelative: boolean;

  /** Imported symbols */
  symbols: ImportedSymbol[];

  /** Whether this is a default import */
  hasDefault: boolean;

  /** Whether this is a namespace import (import * as x) */
  isNamespace: boolean;

  /** Location in source */
  location: SourceLocation;
}

/**
 * Information about an imported symbol
 */
export interface ImportedSymbol {
  /** Original name in the source module */
  name: string;

  /** Local alias (if renamed) */
  alias?: string;

  /** Whether this is the default export */
  isDefault: boolean;
}

/**
 * Information about an export statement for analysis context
 * Note: This is distinct from scanner's ExportInfo which tracks dependency graph
 */
export interface AnalysisExportInfo {
  /** Exported symbol name */
  name: string;

  /** Local name (if different from exported name) */
  localName?: string;

  /** Whether this is the default export */
  isDefault: boolean;

  /** Whether this is a re-export from another module */
  isReExport: boolean;

  /** Source module for re-exports */
  source?: string;

  /** Kind of exported entity */
  kind: ExportKind;

  /** Location in source */
  location: SourceLocation;
}

/**
 * Kind of exported entity
 */
export type ExportKind =
  | 'function'
  | 'class'
  | 'variable'
  | 'type'
  | 'interface'
  | 'enum'
  | 'namespace'
  | 'unknown';

// ============================================================================
// Analysis Result Types
// ============================================================================

/**
 * Detailed result of analyzing a single file
 * Note: This extends the basic AnalysisResult from types/analysis.ts with
 * additional analyzer-specific information
 */
export interface FileAnalysisResult {
  /** File that was analyzed */
  file: string;

  /** Pattern matches found in the file */
  patterns: PatternMatch[];

  /** Violations detected in the file */
  violations: Violation[];

  /** Symbols defined in the file */
  symbols: SymbolInfo[];

  /** Scopes in the file */
  scopes: ScopeInfo[];

  /** Type information (for typed languages) */
  types: TypeInfo[];

  /** Control flow information */
  controlFlow?: ControlFlowGraph;

  /** Data flow information */
  dataFlow?: DataFlowInfo;

  /** Analysis metrics */
  metrics: AnalysisMetrics;

  /** Timestamp of analysis */
  timestamp: Date;

  /** Whether analysis completed successfully */
  success: boolean;

  /** Errors encountered during analysis */
  errors: AnalysisError[];
}

/**
 * A pattern match found during analysis
 */
export interface PatternMatch {
  /** ID of the matched pattern */
  patternId: string;

  /** Location of the match */
  location: SourceLocation;

  /** Confidence score for this match (0-1) */
  confidence: number;

  /** Whether this match is an outlier (deviates from pattern) */
  isOutlier: boolean;

  /** Reason for outlier classification */
  outlierReason?: string;

  /** AST node that matched */
  node?: ASTNode;

  /** Additional match metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Metrics about the analysis process
 */
export interface AnalysisMetrics {
  /** Analysis duration in milliseconds */
  duration: number;

  /** Number of patterns found */
  patternCount: number;

  /** Number of violations found */
  violationCount: number;

  /** Number of symbols analyzed */
  symbolCount: number;

  /** Number of scopes analyzed */
  scopeCount: number;

  /** Lines of code analyzed */
  linesOfCode: number;

  /** AST nodes visited */
  nodesVisited: number;
}

/**
 * Error encountered during analysis
 */
export interface AnalysisError {
  /** Error message */
  message: string;

  /** Error code */
  code?: string;

  /** Location where error occurred */
  location?: SourceLocation;

  /** Whether analysis can continue */
  recoverable: boolean;
}

// ============================================================================
// Symbol Information Types
// ============================================================================

/**
 * Information about a symbol (variable, function, class, etc.)
 */
export interface SymbolInfo {
  /** Symbol name */
  name: string;

  /** Kind of symbol */
  kind: SymbolKind;

  /** Location where symbol is defined */
  location: SourceLocation;

  /** Scope containing this symbol */
  scopeId: string;

  /** Type information (if available) */
  type?: TypeInfo;

  /** Documentation/JSDoc comment */
  documentation?: string;

  /** Visibility/access modifier */
  visibility: SymbolVisibility;

  /** Whether symbol is exported */
  isExported: boolean;

  /** Whether symbol is imported */
  isImported: boolean;

  /** References to this symbol */
  references: SymbolReference[];

  /** For functions/methods: parameter information */
  parameters?: ParameterInfo[];

  /** For functions/methods: return type */
  returnType?: TypeInfo;

  /** For classes: member information */
  members?: SymbolInfo[];

  /** Decorators/attributes applied to symbol */
  decorators?: DecoratorInfo[];
}

/**
 * Kind of symbol
 */
export type SymbolKind =
  | 'variable'
  | 'constant'
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'enumMember'
  | 'property'
  | 'method'
  | 'constructor'
  | 'parameter'
  | 'typeParameter'
  | 'namespace'
  | 'module'
  | 'unknown';

/**
 * Symbol visibility/access modifier
 */
export type SymbolVisibility =
  | 'public'
  | 'private'
  | 'protected'
  | 'internal'
  | 'default';

/**
 * Reference to a symbol
 */
export interface SymbolReference {
  /** Location of the reference */
  location: SourceLocation;

  /** Kind of reference */
  kind: ReferenceKind;

  /** Whether this is a write (assignment) */
  isWrite: boolean;
}

/**
 * Kind of symbol reference
 */
export type ReferenceKind =
  | 'read'
  | 'write'
  | 'call'
  | 'type'
  | 'import'
  | 'export';

/**
 * Information about a function/method parameter
 */
export interface ParameterInfo {
  /** Parameter name */
  name: string;

  /** Parameter type */
  type?: TypeInfo;

  /** Whether parameter is optional */
  isOptional: boolean;

  /** Whether parameter is rest/variadic */
  isRest: boolean;

  /** Default value (as string) */
  defaultValue?: string;

  /** Location in source */
  location: SourceLocation;
}

/**
 * Information about a decorator/attribute
 */
export interface DecoratorInfo {
  /** Decorator name */
  name: string;

  /** Decorator arguments */
  arguments: string[];

  /** Location in source */
  location: SourceLocation;
}

// ============================================================================
// Scope Information Types
// ============================================================================

/**
 * Information about a scope (block, function, class, etc.)
 */
export interface ScopeInfo {
  /** Unique scope identifier */
  id: string;

  /** Kind of scope */
  kind: ScopeKind;

  /** Parent scope ID (null for global scope) */
  parentId: string | null;

  /** Child scope IDs */
  childIds: string[];

  /** Symbols defined in this scope */
  symbols: string[];

  /** Location of scope in source */
  location: SourceLocation;

  /** Depth from global scope (0 = global) */
  depth: number;
}

/**
 * Kind of scope
 */
export type ScopeKind =
  | 'global'
  | 'module'
  | 'function'
  | 'class'
  | 'block'
  | 'loop'
  | 'conditional'
  | 'switch'
  | 'catch'
  | 'with';

// ============================================================================
// Type Information Types
// ============================================================================

/**
 * Information about a type
 */
export interface TypeInfo {
  /** Type kind */
  kind: TypeKind;

  /** Type name (for named types) */
  name?: string;

  /** String representation of the type */
  text: string;

  /** For union types: constituent types */
  unionTypes?: TypeInfo[];

  /** For intersection types: constituent types */
  intersectionTypes?: TypeInfo[];

  /** For array types: element type */
  elementType?: TypeInfo;

  /** For object types: properties */
  properties?: TypePropertyInfo[];

  /** For function types: parameters */
  parameters?: TypeInfo[];

  /** For function types: return type */
  returnType?: TypeInfo;

  /** For generic types: type arguments */
  typeArguments?: TypeInfo[];

  /** For generic types: type parameters */
  typeParameters?: TypeParameterInfo[];

  /** Whether type is nullable */
  isNullable: boolean;

  /** Whether type is optional */
  isOptional: boolean;

  /** Location where type is defined (for named types) */
  location?: SourceLocation;
}

/**
 * Kind of type
 */
export type TypeKind =
  | 'primitive'      // string, number, boolean, etc.
  | 'literal'        // literal types like 'hello' or 42
  | 'object'         // object types
  | 'array'          // array types
  | 'tuple'          // tuple types
  | 'function'       // function types
  | 'class'          // class types
  | 'interface'      // interface types
  | 'enum'           // enum types
  | 'union'          // union types (A | B)
  | 'intersection'   // intersection types (A & B)
  | 'generic'        // generic types
  | 'typeParameter'  // type parameters (T, K, etc.)
  | 'conditional'    // conditional types
  | 'mapped'         // mapped types
  | 'indexed'        // indexed access types
  | 'infer'          // infer types
  | 'any'            // any type
  | 'unknown'        // unknown type
  | 'void'           // void type
  | 'never'          // never type
  | 'null'           // null type
  | 'undefined';     // undefined type

/**
 * Information about a type property
 */
export interface TypePropertyInfo {
  /** Property name */
  name: string;

  /** Property type */
  type: TypeInfo;

  /** Whether property is optional */
  isOptional: boolean;

  /** Whether property is readonly */
  isReadonly: boolean;
}

/**
 * Information about a type parameter
 */
export interface TypeParameterInfo {
  /** Parameter name */
  name: string;

  /** Constraint type */
  constraint?: TypeInfo;

  /** Default type */
  default?: TypeInfo;
}

// ============================================================================
// Control Flow Analysis Types
// ============================================================================

/**
 * Control flow graph for a function/method
 */
export interface ControlFlowGraph {
  /** Entry node */
  entry: ControlFlowNode;

  /** Exit node(s) */
  exits: ControlFlowNode[];

  /** All nodes in the graph */
  nodes: ControlFlowNode[];

  /** All edges in the graph */
  edges: ControlFlowEdge[];
}

/**
 * Node in a control flow graph
 */
export interface ControlFlowNode {
  /** Unique node identifier */
  id: string;

  /** Kind of control flow node */
  kind: ControlFlowNodeKind;

  /** AST node associated with this CFG node */
  astNode?: ASTNode;

  /** Location in source */
  location: SourceLocation;

  /** Outgoing edges */
  outgoing: string[];

  /** Incoming edges */
  incoming: string[];

  /** Whether this node is reachable from entry */
  isReachable: boolean;
}

/**
 * Kind of control flow node
 */
export type ControlFlowNodeKind =
  | 'entry'
  | 'exit'
  | 'statement'
  | 'expression'
  | 'branch'
  | 'merge'
  | 'loop'
  | 'return'
  | 'throw'
  | 'break'
  | 'continue';

/**
 * Edge in a control flow graph
 */
export interface ControlFlowEdge {
  /** Source node ID */
  from: string;

  /** Target node ID */
  to: string;

  /** Edge label/condition */
  label?: string;

  /** Whether this is a back edge (loop) */
  isBackEdge: boolean;
}

// ============================================================================
// Data Flow Analysis Types
// ============================================================================

/**
 * Data flow information for a scope
 */
export interface DataFlowInfo {
  /** Variables that are read */
  reads: DataFlowVariable[];

  /** Variables that are written */
  writes: DataFlowVariable[];

  /** Variables that are captured (closures) */
  captures: DataFlowVariable[];

  /** Potential null/undefined dereferences */
  nullDereferences: SourceLocation[];

  /** Unused variables */
  unusedVariables: string[];

  /** Uninitialized variable reads */
  uninitializedReads: DataFlowVariable[];
}

/**
 * Variable in data flow analysis
 */
export interface DataFlowVariable {
  /** Variable name */
  name: string;

  /** Symbol ID */
  symbolId?: string;

  /** Location of access */
  location: SourceLocation;
}

// ============================================================================
// Source Location Types
// ============================================================================

/**
 * Location in source code
 */
export interface SourceLocation {
  /** Start position */
  start: Position;

  /** End position */
  end: Position;

  /** File path (for cross-file references) */
  file?: string;
}

// ============================================================================
// Analyzer-Specific Result Types
// ============================================================================

/**
 * Result from AST pattern analysis
 */
export interface ASTAnalysisResult {
  /** Pattern matches found */
  matches: PatternMatch[];

  /** AST statistics */
  stats: ASTStats;
}

/**
 * Statistics about an AST
 */
export interface ASTStats {
  /** Total number of nodes */
  nodeCount: number;

  /** Nodes by type */
  nodesByType: Record<string, number>;

  /** Maximum tree depth */
  maxDepth: number;

  /** Average children per node */
  avgChildren: number;
}

/**
 * Result from type analysis
 */
export interface TypeAnalysisResult {
  /** Type information for symbols */
  types: Map<string, TypeInfo>;

  /** Type errors found */
  errors: TypeAnalysisError[];

  /** Type coverage percentage */
  coverage: number;
}

/**
 * Type analysis error
 */
export interface TypeAnalysisError {
  /** Error message */
  message: string;

  /** Location of error */
  location: SourceLocation;

  /** Expected type */
  expected?: TypeInfo;

  /** Actual type */
  actual?: TypeInfo;
}

/**
 * Result from semantic analysis
 */
export interface SemanticAnalysisResult {
  /** Symbol table */
  symbols: Map<string, SymbolInfo>;

  /** Scope tree */
  scopes: ScopeInfo[];

  /** Unresolved references */
  unresolvedReferences: SymbolReference[];

  /** Shadowed variables */
  shadowedVariables: ShadowedVariable[];
}

/**
 * Information about a shadowed variable
 */
export interface ShadowedVariable {
  /** Variable name */
  name: string;

  /** Location of shadowing declaration */
  shadowLocation: SourceLocation;

  /** Location of original declaration */
  originalLocation: SourceLocation;
}

/**
 * Result from control flow analysis
 */
export interface FlowAnalysisResult {
  /** Control flow graph */
  controlFlow: ControlFlowGraph;

  /** Data flow information */
  dataFlow: DataFlowInfo;

  /** Unreachable code locations */
  unreachableCode: SourceLocation[];

  /** Infinite loop locations */
  infiniteLoops: SourceLocation[];

  /** Missing return statements */
  missingReturns: SourceLocation[];
}
