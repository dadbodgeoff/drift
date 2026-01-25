/**
 * Unified Language Provider - Core Types
 *
 * Universal type definitions for language-agnostic code extraction.
 * These types enable pattern matching across all supported languages
 * through a normalized representation.
 */

import type { DataOperation } from '../boundaries/types.js';

// ============================================================================
// Language Configuration
// ============================================================================

/**
 * Supported languages for unified extraction
 */
export type UnifiedLanguage = 'typescript' | 'javascript' | 'python' | 'java' | 'csharp' | 'php' | 'go' | 'rust' | 'cpp';

/**
 * Language configuration for parser and normalizer selection
 */
export interface LanguageConfig {
  /** Language identifier */
  language: UnifiedLanguage;
  /** File extensions this language handles */
  extensions: string[];
  /** Tree-sitter grammar name */
  treeSitterGrammar: string;
  /** Node types that represent function definitions */
  functionNodeTypes: string[];
  /** Node types that represent class definitions */
  classNodeTypes: string[];
  /** Node types that represent call expressions */
  callNodeTypes: string[];
  /** Node types that represent import statements */
  importNodeTypes: string[];
}

// ============================================================================
// Unified Call Chain - The Core Abstraction
// ============================================================================

/**
 * A normalized argument in a call chain
 *
 * Represents any argument passed to a function call in a language-agnostic way.
 * This enables pattern matchers to work with arguments without knowing
 * the source language's AST structure.
 */
export interface NormalizedArg {
  /** Argument type */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'identifier' | 'call' | 'unknown';
  /** Raw text value */
  value: string;
  /** Parsed string value (for string literals) */
  stringValue?: string;
  /** Parsed number value (for numeric literals) */
  numberValue?: number;
  /** Parsed boolean value (for boolean literals) */
  booleanValue?: boolean;
  /** Object properties (for object literals) */
  properties?: Record<string, NormalizedArg>;
  /** Array elements (for array literals) */
  elements?: NormalizedArg[];
  /** Nested call chain (for call expressions as arguments) */
  callChain?: UnifiedCallChain;
  /** Position in source */
  line: number;
  column: number;
}

/**
 * A segment in a call chain
 *
 * Represents a single step in a method chain like:
 * supabase.from('users').select('*').eq('id', 1)
 *         ^^^^^^^^^^^^^ ^^^^^^^^^^^ ^^^^^^^^^^^^
 *         segment 1     segment 2   segment 3
 */
export interface CallChainSegment {
  /** Method/property name */
  name: string;
  /** Whether this is a method call (has arguments) vs property access */
  isCall: boolean;
  /** Normalized arguments (empty for property access) */
  args: NormalizedArg[];
  /** Position in source */
  line: number;
  column: number;
}

/**
 * A unified call chain representation
 *
 * This is the key abstraction that enables language-agnostic pattern matching.
 * Any method chain in any language can be normalized to this format:
 *
 * TypeScript: supabase.from('users').select('*')
 * Python:     supabase.from_('users').select('*')
 * Java:       supabase.from("users").select("*")
 *
 * All normalize to the same UnifiedCallChain structure.
 */
export interface UnifiedCallChain {
  /** The root receiver (e.g., 'supabase', 'prisma', 'db') */
  receiver: string;
  /** Chain of method calls/property accesses */
  segments: CallChainSegment[];
  /** Full expression text for context */
  fullExpression: string;
  /** Source file */
  file: string;
  /** Start position */
  line: number;
  column: number;
  /** End position */
  endLine: number;
  endColumn: number;
  /** Language this was extracted from */
  language: UnifiedLanguage;
  /** Raw AST node reference for fallback (optional) */
  rawNode?: unknown;
}

// ============================================================================
// Pattern Matching Types
// ============================================================================

/**
 * Result of pattern matching against a call chain
 */
export interface PatternMatchResult {
  /** Whether the pattern matched */
  matched: boolean;
  /** ORM/database client that matched */
  orm: string;
  /** Detected table name */
  table: string;
  /** Detected field names */
  fields: string[];
  /** Detected operation type */
  operation: DataOperation;
  /** Confidence score (0-1) */
  confidence: number;
  /** Whether this is raw SQL */
  isRawSql: boolean;
  /** Additional metadata */
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Pattern matcher interface
 *
 * Each ORM/database client has a matcher that implements this interface.
 * Matchers receive normalized call chains and return match results.
 */
export interface PatternMatcher {
  /** Unique identifier for this matcher */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Languages this matcher supports */
  readonly languages: UnifiedLanguage[];
  /** Priority (higher = checked first) */
  readonly priority: number;

  /**
   * Attempt to match a call chain against this pattern
   * @returns Match result if pattern matches, null otherwise
   */
  match(chain: UnifiedCallChain): PatternMatchResult | null;
}

// ============================================================================
// Extraction Types
// ============================================================================

/**
 * Unified function extraction
 */
export interface UnifiedFunction {
  /** Function/method name */
  name: string;
  /** Qualified name (Class.method or module.function) */
  qualifiedName: string;
  /** Source file */
  file: string;
  /** Start line */
  startLine: number;
  /** End line */
  endLine: number;
  /** Start column */
  startColumn: number;
  /** End column */
  endColumn: number;
  /** Parameters */
  parameters: UnifiedParameter[];
  /** Return type (if available) */
  returnType?: string | undefined;
  /** Whether this is a method */
  isMethod: boolean;
  /** Whether this is static */
  isStatic: boolean;
  /** Whether this is exported/public */
  isExported: boolean;
  /** Whether this is a constructor */
  isConstructor: boolean;
  /** Whether this is async */
  isAsync: boolean;
  /** Class name (if method) */
  className?: string | undefined;
  /** Decorators/annotations */
  decorators: string[];
  /** Body start line */
  bodyStartLine: number;
  /** Body end line */
  bodyEndLine: number;
  /** Language */
  language: UnifiedLanguage;
}

/**
 * Unified parameter
 */
export interface UnifiedParameter {
  name: string;
  type?: string | undefined;
  hasDefault: boolean;
  isRest: boolean;
}

/**
 * Unified class extraction
 */
export interface UnifiedClass {
  /** Class name */
  name: string;
  /** Source file */
  file: string;
  /** Start line */
  startLine: number;
  /** End line */
  endLine: number;
  /** Base classes/interfaces */
  baseClasses: string[];
  /** Method names */
  methods: string[];
  /** Whether exported/public */
  isExported: boolean;
  /** Language */
  language: UnifiedLanguage;
}

/**
 * Unified import extraction
 */
export interface UnifiedImport {
  /** Source module/file */
  source: string;
  /** Imported names */
  names: UnifiedImportedName[];
  /** Line number */
  line: number;
  /** Whether type-only import */
  isTypeOnly: boolean;
  /** Language */
  language: UnifiedLanguage;
}

/**
 * Unified imported name
 */
export interface UnifiedImportedName {
  /** Name as exported */
  imported: string;
  /** Local alias */
  local: string;
  /** Is default import */
  isDefault: boolean;
  /** Is namespace import */
  isNamespace: boolean;
}

/**
 * Unified export extraction
 */
export interface UnifiedExport {
  name: string;
  isDefault: boolean;
  isReExport: boolean;
  source?: string | undefined;
  line: number;
  language: UnifiedLanguage;
}

/**
 * Unified data access point
 */
export interface UnifiedDataAccess {
  /** Unique ID */
  id: string;
  /** Table/collection name */
  table: string;
  /** Field names accessed */
  fields: string[];
  /** Operation type */
  operation: DataOperation;
  /** Source file */
  file: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Context snippet */
  context: string;
  /** Whether raw SQL */
  isRawSql: boolean;
  /** Confidence score */
  confidence: number;
  /** ORM/client that was detected */
  orm: string;
  /** Language */
  language: UnifiedLanguage;
  /** The call chain that produced this access */
  callChain?: UnifiedCallChain;
}

// ============================================================================
// Extraction Result Types
// ============================================================================

/**
 * Complete extraction result from a single file
 */
export interface UnifiedExtractionResult {
  /** Source file path */
  file: string;
  /** Detected language */
  language: UnifiedLanguage;
  /** Extracted functions */
  functions: UnifiedFunction[];
  /** Extracted call chains */
  callChains: UnifiedCallChain[];
  /** Extracted data access points */
  dataAccess: UnifiedDataAccess[];
  /** Extracted classes */
  classes: UnifiedClass[];
  /** Extracted imports */
  imports: UnifiedImport[];
  /** Extracted exports */
  exports: UnifiedExport[];
  /** Extraction errors */
  errors: string[];
  /** Extraction statistics */
  stats: ExtractionStats;
}

/**
 * Extraction statistics
 */
export interface ExtractionStats {
  /** Parse time in ms */
  parseTimeMs: number;
  /** Normalization time in ms */
  normalizeTimeMs: number;
  /** Pattern matching time in ms */
  matchTimeMs: number;
  /** Total time in ms */
  totalTimeMs: number;
  /** Number of AST nodes visited */
  nodesVisited: number;
  /** Number of call chains extracted */
  callChainsExtracted: number;
  /** Number of patterns matched */
  patternsMatched: number;
}

// ============================================================================
// Provider Options
// ============================================================================

/**
 * Options for the unified language provider
 */
export interface UnifiedProviderOptions {
  /** Project root directory */
  projectRoot?: string | undefined;
  /** Languages to enable (default: all) */
  languages?: UnifiedLanguage[] | undefined;
  /** Pattern matchers to enable (default: all) */
  matchers?: string[] | undefined;
  /** Whether to include raw AST nodes in results */
  includeRawNodes?: boolean | undefined;
  /** Maximum call chain depth to extract */
  maxChainDepth?: number | undefined;
  /** Whether to extract data access points */
  extractDataAccess?: boolean | undefined;
  /** Whether to extract call graph info */
  extractCallGraph?: boolean | undefined;
}

// ============================================================================
// Normalizer Interface
// ============================================================================

/**
 * Call chain normalizer interface
 *
 * Each language implements this interface to convert its AST
 * into unified call chains.
 */
export interface CallChainNormalizer {
  /** Language this normalizer handles */
  readonly language: UnifiedLanguage;

  /**
   * Extract and normalize call chains from an AST node
   */
  normalizeCallChains(
    rootNode: unknown,
    source: string,
    filePath: string
  ): UnifiedCallChain[];

  /**
   * Extract functions from an AST node
   */
  extractFunctions(
    rootNode: unknown,
    source: string,
    filePath: string
  ): UnifiedFunction[];

  /**
   * Extract classes from an AST node
   */
  extractClasses(
    rootNode: unknown,
    source: string,
    filePath: string
  ): UnifiedClass[];

  /**
   * Extract imports from an AST node
   */
  extractImports(
    rootNode: unknown,
    source: string,
    filePath: string
  ): UnifiedImport[];

  /**
   * Extract exports from an AST node
   */
  extractExports(
    rootNode: unknown,
    source: string,
    filePath: string
  ): UnifiedExport[];
}
