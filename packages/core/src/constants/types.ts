/**
 * Constant & Enum Extraction Types
 *
 * Core types for extracting and tracking constants, enums, and exported values
 * across all supported languages.
 */

// ============================================================================
// Language & Kind Types
// ============================================================================

/**
 * Supported languages for constant extraction
 */
export type ConstantLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'java'
  | 'csharp'
  | 'php'
  | 'go'
  | 'rust'
  | 'cpp';

/**
 * What kind of constant this is
 */
export type ConstantKind =
  | 'primitive' // string, number, boolean
  | 'enum' // enum declaration
  | 'enum_member' // individual enum value
  | 'object' // const object/frozen object
  | 'array' // const array
  | 'computed' // value derived from expression
  | 'class_constant' // class-level constant (PHP, Java)
  | 'interface_constant'; // interface constant (Java, TS)

/**
 * Inferred category for the constant
 */
export type ConstantCategory =
  | 'config' // configuration values
  | 'api' // API endpoints, keys, headers
  | 'status' // status codes, states
  | 'error' // error codes, messages
  | 'feature_flag' // feature toggles
  | 'limit' // limits, thresholds, timeouts
  | 'regex' // regex patterns
  | 'path' // file paths, routes
  | 'env' // environment variable names
  | 'security' // security-related (potential secrets)
  | 'uncategorized'; // default

/**
 * Severity level for issues
 */
export type IssueSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

// ============================================================================
// Core Extraction Types
// ============================================================================

/**
 * A constant definition extracted from source code
 */
export interface ConstantExtraction {
  /** Unique ID: "file:name:line" */
  id: string;

  /** Constant name */
  name: string;

  /** Qualified name (Class.CONST or module.CONST) */
  qualifiedName: string;

  /** Source file path */
  file: string;

  /** Line number */
  line: number;

  /** Column number */
  column: number;

  /** End line */
  endLine: number;

  /** Language */
  language: ConstantLanguage;

  /** What kind of constant */
  kind: ConstantKind;

  /** Inferred category */
  category: ConstantCategory;

  /** Value if extractable (primitives, up to 500 chars) */
  value?: string | number | boolean | null;

  /** Raw value text from source */
  rawValue?: string;

  /** Type annotation if present */
  type?: string;

  /** Is exported/public */
  isExported: boolean;

  /** Parent class/enum/interface name */
  parentName?: string;

  /** Parent type (class, interface, enum, module) */
  parentType?: 'class' | 'interface' | 'enum' | 'module' | 'namespace';

  /** Documentation comment */
  docComment?: string;

  /** Decorators/attributes */
  decorators: string[];

  /** Modifiers (static, final, readonly, etc.) */
  modifiers: string[];

  /** Extraction confidence (0-1) */
  confidence: number;
}

/**
 * An enum definition extracted from source code
 */
export interface EnumExtraction {
  /** Unique ID: "file:name:line" */
  id: string;

  /** Enum name */
  name: string;

  /** Qualified name */
  qualifiedName: string;

  /** Source file path */
  file: string;

  /** Line number */
  line: number;

  /** End line */
  endLine: number;

  /** Language */
  language: ConstantLanguage;

  /** Is exported/public */
  isExported: boolean;

  /** Enum members */
  members: EnumMember[];

  /** Is flags enum (C# [Flags]) */
  isFlags: boolean;

  /** Is string enum */
  isStringEnum: boolean;

  /** Backing type (string, int, etc.) */
  backingType?: string;

  /** Documentation comment */
  docComment?: string;

  /** Decorators/attributes */
  decorators: string[];

  /** Modifiers */
  modifiers: string[];

  /** Extraction confidence (0-1) */
  confidence: number;
}

/**
 * An individual enum member
 */
export interface EnumMember {
  /** Member name */
  name: string;

  /** Value if specified */
  value?: string | number;

  /** Line number */
  line: number;

  /** Documentation comment */
  docComment?: string;

  /** Is auto-generated value */
  isAutoValue: boolean;
}

/**
 * A reference to a constant in code
 */
export interface ConstantReference {
  /** The constant being referenced */
  constantId: string;

  /** Constant name (for display) */
  constantName: string;

  /** File containing the reference */
  file: string;

  /** Line number */
  line: number;

  /** Column number */
  column: number;

  /** Context snippet */
  context?: string;

  /** Function/method containing the reference */
  containingFunction?: string;

  /** Class containing the reference */
  containingClass?: string;

  /** Reference type */
  referenceType: 'read' | 'assignment' | 'parameter' | 'comparison';
}

// ============================================================================
// File Result Types
// ============================================================================

/**
 * Result of extracting constants from a single file
 */
export interface FileConstantResult {
  /** File path */
  file: string;

  /** Language */
  language: ConstantLanguage;

  /** Extracted constants */
  constants: ConstantExtraction[];

  /** Extracted enums */
  enums: EnumExtraction[];

  /** Constant references (if tracking enabled) */
  references: ConstantReference[];

  /** Extraction errors */
  errors: string[];

  /** Extraction quality metrics */
  quality: ConstantExtractionQuality;
}

/**
 * Quality metrics for constant extraction
 */
export interface ConstantExtractionQuality {
  /** Extraction method used */
  method: 'tree-sitter' | 'regex' | 'hybrid';

  /** Confidence score (0-1) */
  confidence: number;

  /** Coverage estimate (0-100) */
  coveragePercent: number;

  /** Number of items extracted */
  itemsExtracted: number;

  /** Number of parse errors */
  parseErrors: number;

  /** Warnings */
  warnings: string[];

  /** Whether fallback was used */
  usedFallback: boolean;

  /** Extraction time in ms */
  extractionTimeMs: number;
}

// ============================================================================
// Analysis Types
// ============================================================================

/**
 * A magic value detected in code
 */
export interface MagicValue {
  /** The literal value */
  value: string | number;

  /** Value type */
  type: 'string' | 'number';

  /** All occurrences */
  occurrences: MagicValueOccurrence[];

  /** Suggested constant name */
  suggestedName: string;

  /** Suggested category */
  suggestedCategory: ConstantCategory;

  /** Severity */
  severity: IssueSeverity;
}

/**
 * A single occurrence of a magic value
 */
export interface MagicValueOccurrence {
  /** File path */
  file: string;

  /** Line number */
  line: number;

  /** Column */
  column: number;

  /** Context snippet */
  context: string;

  /** Containing function */
  containingFunction?: string;
}

/**
 * A potential hardcoded secret
 */
export interface PotentialSecret {
  /** Constant ID if it's a constant */
  constantId?: string;

  /** Name */
  name: string;

  /** File path */
  file: string;

  /** Line number */
  line: number;

  /** Masked value (first/last chars visible) */
  maskedValue: string;

  /** Secret type detected */
  secretType: SecretType;

  /** Severity */
  severity: IssueSeverity;

  /** Recommendation */
  recommendation: string;

  /** Confidence (0-1) */
  confidence: number;
}

/**
 * Types of secrets we detect
 */
export type SecretType =
  | 'api_key'
  | 'secret_key'
  | 'password'
  | 'private_key'
  | 'connection_string'
  | 'token'
  | 'certificate'
  | 'aws_key'
  | 'stripe_key'
  | 'github_token'
  | 'generic_secret';

/**
 * An inconsistent constant (same name, different values)
 */
export interface InconsistentConstant {
  /** Constant name */
  name: string;

  /** All instances with different values */
  instances: ConstantInstance[];

  /** Recommendation */
  recommendation: string;
}

/**
 * A single instance of a constant
 */
export interface ConstantInstance {
  /** Constant ID */
  id: string;

  /** File path */
  file: string;

  /** Line number */
  line: number;

  /** Value */
  value: string | number | boolean | null;
}

/**
 * A dead (unused) constant
 */
export interface DeadConstant {
  /** Constant ID */
  id: string;

  /** Constant name */
  name: string;

  /** File path */
  file: string;

  /** Line number */
  line: number;

  /** Last modified date (from git) */
  lastModified?: string;

  /** Confidence that it's unused (0-1) */
  confidence: number;

  /** Reason for flagging */
  reason: 'no_references' | 'only_test_references' | 'deprecated_annotation';
}

// ============================================================================
// Store Types
// ============================================================================

/**
 * Per-file shard stored in .drift/lake/constants/files/
 */
export interface ConstantFileShard {
  /** Schema version */
  version: '1.0';

  /** File path */
  file: string;

  /** Content hash for change detection */
  contentHash: string;

  /** Extraction timestamp */
  extractedAt: string;

  /** Constants in this file */
  constants: ConstantExtraction[];

  /** Enums in this file */
  enums: EnumExtraction[];

  /** References in this file (if tracking enabled) */
  references: ConstantReference[];

  /** Extraction quality */
  quality: ConstantExtractionQuality;
}

/**
 * Main index stored in .drift/lake/constants/index.json
 */
export interface ConstantIndex {
  /** Schema version */
  version: '1.0';

  /** Generation timestamp */
  generatedAt: string;

  /** Project root */
  projectRoot: string;

  /** Constants by category */
  byCategory: Record<ConstantCategory, string[]>;

  /** Constants by file */
  byFile: Record<string, string[]>;

  /** Constants by name (for quick lookup) */
  byName: Record<string, string[]>;

  /** Enums by file */
  enumsByFile: Record<string, string[]>;

  /** Statistics */
  stats: ConstantStats;
}

/**
 * Statistics about constants in the codebase
 */
export interface ConstantStats {
  /** Total constants */
  totalConstants: number;

  /** Total enums */
  totalEnums: number;

  /** Total enum members */
  totalEnumMembers: number;

  /** By language */
  byLanguage: Record<ConstantLanguage, number>;

  /** By category */
  byCategory: Record<ConstantCategory, number>;

  /** By kind */
  byKind: Record<ConstantKind, number>;

  /** Issue counts */
  issues: {
    magicValues: number;
    deadConstants: number;
    potentialSecrets: number;
    inconsistentValues: number;
  };
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for constant extraction
 */
export interface ConstantExtractionConfig {
  /** Enable constant extraction */
  enabled: boolean;

  /** Track references to constants */
  trackReferences: boolean;

  /** Custom category patterns */
  categoryPatterns?: Record<string, RegExp[]>;

  /** Magic value detection settings */
  magicValues: {
    /** Minimum occurrences to flag */
    minOccurrences: number;

    /** Values to ignore */
    ignoreValues: (string | number)[];

    /** File patterns to ignore */
    ignorePatterns: string[];

    /** Include string literals */
    includeStrings: boolean;

    /** Include numeric literals */
    includeNumbers: boolean;
  };

  /** Secret detection settings */
  secrets: {
    /** Enable secret detection */
    enabled: boolean;

    /** Custom patterns */
    customPatterns: SecretPattern[];

    /** Files to allowlist */
    allowlist: string[];
  };
}

/**
 * A custom secret detection pattern
 */
export interface SecretPattern {
  /** Pattern to match */
  pattern: string;

  /** Secret type */
  type: SecretType;

  /** Severity */
  severity: IssueSeverity;
}

/**
 * Default configuration
 */
export const DEFAULT_CONSTANT_CONFIG: ConstantExtractionConfig = {
  enabled: true,
  trackReferences: true,
  magicValues: {
    minOccurrences: 2,
    ignoreValues: [0, 1, -1, '', 'true', 'false', 'null', 'undefined'],
    ignorePatterns: ['test', 'spec', 'mock', '__tests__', '__mocks__'],
    includeStrings: true,
    includeNumbers: true,
  },
  secrets: {
    enabled: true,
    customPatterns: [],
    allowlist: ['**/test/**', '**/*.test.*', '**/*.spec.*'],
  },
};

// ============================================================================
// Extractor Types
// ============================================================================

/**
 * Configuration for hybrid extractors
 */
export interface ConstantHybridConfig {
  /** Enable tree-sitter extraction */
  enableTreeSitter?: boolean;

  /** Enable regex fallback */
  enableRegexFallback?: boolean;

  /** Extract references */
  extractReferences?: boolean;
}

/**
 * Default hybrid config
 */
export const DEFAULT_CONSTANT_HYBRID_CONFIG: Required<ConstantHybridConfig> = {
  enableTreeSitter: true,
  enableRegexFallback: true,
  extractReferences: false, // Off by default for performance
};

/**
 * Confidence levels for extraction methods
 */
export const CONSTANT_EXTRACTION_CONFIDENCE = {
  TREE_SITTER: 0.95,
  REGEX: 0.75,
  HYBRID: 0.90,
  UNKNOWN: 0.5,
} as const;
