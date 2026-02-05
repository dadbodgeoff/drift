/**
 * Call Graph Types
 *
 * Core types for building and querying the call graph.
 * Enables answering: "What data can this line of code ultimately access?"
 */

import type { DataAccessPoint, SensitiveField } from '../boundaries/types.js';

// ============================================================================
// Core Graph Types
// ============================================================================

/**
 * Supported languages for call graph extraction
 */
export type CallGraphLanguage = 'python' | 'typescript' | 'javascript' | 'java' | 'csharp' | 'php' | 'go' | 'rust' | 'cpp' | 'structured-text';

/**
 * A function/method definition in the codebase
 */
export interface FunctionNode {
  /** Unique ID: "file:name:line" */
  id: string;
  /** Function/method name */
  name: string;
  /** Qualified name (Class.method or module.function) */
  qualifiedName: string;
  /** Source file path */
  file: string;
  /** Start line number */
  startLine: number;
  /** End line number */
  endLine: number;
  /** Language */
  language: CallGraphLanguage;
  /** What this function calls */
  calls: CallSite[];
  /** What calls this function (reverse edges) */
  calledBy: CallSite[];
  /** Direct data access within this function */
  dataAccess: DataAccessPoint[];
  /** Class name if this is a method */
  className?: string | undefined;
  /** Module/namespace name */
  moduleName?: string | undefined;
  /** Whether this is exported/public */
  isExported: boolean;
  /** Whether this is a constructor */
  isConstructor: boolean;
  /** Whether this is async */
  isAsync: boolean;
  /** Decorators/attributes (e.g., @app.route, [HttpGet]) */
  decorators: string[];
  /** Parameters */
  parameters: ParameterInfo[];
  /** Return type if known */
  returnType?: string | undefined;
}

/**
 * Parameter information
 */
export interface ParameterInfo {
  name: string;
  type?: string | undefined;
  hasDefault: boolean;
  isRest: boolean;
}

/**
 * A call site - where a function is called
 */
export interface CallSite {
  /** Function making the call */
  callerId: string;
  /** Function being called (if resolved) */
  calleeId: string | null;
  /** Name as it appears in code */
  calleeName: string;
  /** Receiver/object if method call (e.g., "user_service" in user_service.get_user()) */
  receiver?: string | undefined;
  /** Source file */
  file: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Whether we could resolve the target */
  resolved: boolean;
  /** Multiple possible targets (polymorphism, dynamic dispatch) */
  resolvedCandidates: string[];
  /** Resolution confidence (0-1) */
  confidence: number;
  /** Why we resolved this way */
  resolutionReason?: string | undefined;
  /** Number of arguments */
  argumentCount: number;
}

/**
 * The complete call graph
 */
export interface CallGraph {
  /** Schema version */
  version: string;
  /** Generation timestamp */
  generatedAt: string;
  /** Project root */
  projectRoot: string;
  /** All functions indexed by ID */
  functions: Map<string, FunctionNode>;
  /** Entry points (exported functions, API handlers, main) */
  entryPoints: string[];
  /** Functions with direct data access */
  dataAccessors: string[];
  /** Statistics */
  stats: CallGraphStats;
  /** Internal flag: true when using SQLite storage (queries go through native module) */
  _sqliteAvailable?: boolean;
}

/**
 * Call graph statistics
 */
export interface CallGraphStats {
  totalFunctions: number;
  totalCallSites: number;
  resolvedCallSites: number;
  unresolvedCallSites: number;
  totalDataAccessors: number;
  byLanguage: Record<CallGraphLanguage, number>;
}

// ============================================================================
// Extraction Types
// ============================================================================

/**
 * Raw function extraction from parser
 */
export interface FunctionExtraction {
  name: string;
  qualifiedName: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  parameters: ParameterInfo[];
  returnType?: string | undefined;
  isMethod: boolean;
  isStatic: boolean;
  isExported: boolean;
  isConstructor: boolean;
  isAsync: boolean;
  className?: string | undefined;
  moduleName?: string | undefined;
  decorators: string[];
  /** Raw body text for further analysis */
  bodyStartLine: number;
  bodyEndLine: number;
}

/**
 * Raw call extraction from parser
 */
export interface CallExtraction {
  /** What's being called */
  calleeName: string;
  /** Object/class it's called on */
  receiver?: string | undefined;
  /** Full expression (e.g., "self.service.get_user") */
  fullExpression: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Argument count for overload resolution */
  argumentCount: number;
  /** Whether this is a method call vs function call */
  isMethodCall: boolean;
  /** Whether this is a constructor call (new Foo()) */
  isConstructorCall: boolean;
}

/**
 * Result of extracting from a single file
 */
export interface FileExtractionResult {
  file: string;
  language: CallGraphLanguage;
  functions: FunctionExtraction[];
  calls: CallExtraction[];
  imports: ImportExtraction[];
  exports: ExportExtraction[];
  classes: ClassExtraction[];
  errors: string[];
}

/**
 * Import extraction
 */
export interface ImportExtraction {
  /** Source module/file */
  source: string;
  /** Imported names */
  names: ImportedName[];
  /** Line number */
  line: number;
  /** Is this a type-only import */
  isTypeOnly: boolean;
}

/**
 * Individual imported name
 */
export interface ImportedName {
  /** Name as exported */
  imported: string;
  /** Local alias */
  local: string;
  /** Is default import */
  isDefault: boolean;
  /** Is namespace import (import * as foo) */
  isNamespace: boolean;
}

/**
 * Export extraction
 */
export interface ExportExtraction {
  name: string;
  isDefault: boolean;
  isReExport: boolean;
  source?: string | undefined;
  line: number;
}

/**
 * Class extraction
 */
export interface ClassExtraction {
  name: string;
  startLine: number;
  endLine: number;
  baseClasses: string[];
  methods: string[];
  isExported: boolean;
}

// ============================================================================
// Resolution Types
// ============================================================================

/**
 * Context for resolving calls
 */
export interface ResolutionContext {
  /** Imports in the current file */
  imports: ImportExtraction[];
  /** All known functions */
  allFunctions: Map<string, FunctionNode>;
  /** All known classes */
  allClasses: Map<string, ClassExtraction>;
  /** File being resolved */
  currentFile: string;
  /** Project root for path resolution */
  projectRoot: string;
}

/**
 * Result of resolving a call
 */
export interface ResolvedCall {
  resolved: boolean;
  /** Function IDs that could be the target */
  candidates: string[];
  /** Confidence score (0-1) */
  confidence: number;
  /** Why we resolved this way */
  reason: string;
}

// ============================================================================
// Reachability Types
// ============================================================================

/**
 * Result of reachability analysis
 */
export interface ReachabilityResult {
  /** Starting point */
  origin: CodeLocation;
  /** All reachable data access */
  reachableAccess: ReachableDataAccess[];
  /** Summary: tables that can be reached */
  tables: string[];
  /** Summary: sensitive fields that can be reached */
  sensitiveFields: SensitiveFieldAccess[];
  /** Maximum call depth to reach data */
  maxDepth: number;
  /** Total functions traversed */
  functionsTraversed: number;
}

/**
 * A code location
 */
export interface CodeLocation {
  file: string;
  line: number;
  column?: number;
  functionId?: string;
}

/**
 * A reachable data access point with path
 */
export interface ReachableDataAccess {
  /** The actual data access */
  access: DataAccessPoint;
  /** Call path to reach this access */
  path: CallPathNode[];
  /** Depth in call graph */
  depth: number;
}

/**
 * A node in a call path
 */
export interface CallPathNode {
  functionId: string;
  functionName: string;
  file: string;
  line: number;
}

/**
 * Sensitive field access info
 */
export interface SensitiveFieldAccess {
  field: SensitiveField;
  paths: CallPathNode[][];
  accessCount: number;
}

// ============================================================================
// Store Types
// ============================================================================

/**
 * Serializable call graph for storage
 */
export interface SerializedCallGraph {
  version: string;
  generatedAt: string;
  projectRoot: string;
  functions: Record<string, FunctionNode>;
  entryPoints: string[];
  dataAccessors: string[];
  stats: CallGraphStats;
}

/**
 * Call graph store configuration
 */
export interface CallGraphStoreConfig {
  rootDir: string;
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Options for reachability queries
 */
export interface ReachabilityOptions {
  /** Maximum depth to traverse (default: unlimited) */
  maxDepth?: number;
  /** Only include paths to sensitive data */
  sensitiveOnly?: boolean;
  /** Filter by table names */
  tables?: string[];
  /** Include unresolved calls in traversal */
  includeUnresolved?: boolean;
}

/**
 * Options for inverse queries ("who can reach this data?")
 */
export interface InverseReachabilityOptions {
  /** Table to query */
  table: string;
  /** Specific field (optional) */
  field?: string;
  /** Maximum depth */
  maxDepth?: number;
}

/**
 * Result of inverse reachability query
 */
export interface InverseReachabilityResult {
  /** The data being queried */
  target: {
    table: string;
    field?: string | undefined;
  };
  /** All code paths that can reach this data */
  accessPaths: InverseAccessPath[];
  /** Entry points that can reach this data */
  entryPoints: string[];
  /** Total unique functions that can access */
  totalAccessors: number;
}

/**
 * A path from entry point to data access
 */
export interface InverseAccessPath {
  /** Entry point function */
  entryPoint: string;
  /** Path to data access */
  path: CallPathNode[];
  /** The access point */
  accessPoint: DataAccessPoint;
}
