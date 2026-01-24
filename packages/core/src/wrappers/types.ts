/**
 * Framework Wrapper Detection Types
 *
 * Types for detecting custom abstractions built on top of framework primitives.
 */

// =============================================================================
// Primitive Types
// =============================================================================

export type PrimitiveSourceType = 'bootstrap' | 'import' | 'frequency' | 'decorator';

export interface PrimitiveSource {
  type: PrimitiveSourceType;
  confidence: number;
}

export interface DetectedPrimitive {
  name: string;
  framework: string;
  category: string;
  source: PrimitiveSource;
  importPath?: string;
  usageCount: number;
  language: SupportedLanguage;
}

export type SupportedLanguage = 'typescript' | 'python' | 'java' | 'csharp' | 'php';

// =============================================================================
// Wrapper Types
// =============================================================================

export interface WrapperFunction {
  name: string;
  qualifiedName: string;
  file: string;
  line: number;
  language: SupportedLanguage;

  /** Primitives directly called by this function */
  directPrimitives: string[];

  /** Primitives called through other wrappers */
  transitivePrimitives: string[];

  /** Sorted, deduplicated list of all primitives */
  primitiveSignature: string[];

  /** 1 = direct wrapper, 2+ = transitive */
  depth: number;

  /** Other wrappers this function calls */
  callsWrappers: string[];

  /** Functions that call this wrapper */
  calledBy: string[];

  /** Returns a function */
  isFactory: boolean;

  /** Takes function as parameter */
  isHigherOrder: boolean;

  /** Python/TS decorator pattern */
  isDecorator: boolean;

  /** Async function */
  isAsync: boolean;

  /** Inferred return type */
  returnType?: string;

  /** Parameter types/names */
  parameterSignature?: string[];
}


// =============================================================================
// Cluster Types
// =============================================================================

export type WrapperCategory =
  | 'state-management'
  | 'data-fetching'
  | 'side-effects'
  | 'authentication'
  | 'authorization'
  | 'validation'
  | 'dependency-injection'
  | 'middleware'
  | 'testing'
  | 'logging'
  | 'caching'
  | 'error-handling'
  | 'async-utilities'
  | 'form-handling'
  | 'routing'
  | 'factory'
  | 'decorator'
  | 'utility'
  | 'other';

export interface WrapperCluster {
  id: string;
  name: string;
  description: string;

  /** Primitives that define this cluster */
  primitiveSignature: string[];

  /** Members of this cluster */
  wrappers: WrapperFunction[];

  /** Confidence score 0-1 */
  confidence: number;

  /** Inferred category */
  category: WrapperCategory;

  /** Average wrapper depth */
  avgDepth: number;

  /** Maximum wrapper depth */
  maxDepth: number;

  /** Total times wrappers are called */
  totalUsages: number;

  /** Number of files containing wrappers */
  fileSpread: number;

  /** Suggested pattern names */
  suggestedNames: string[];
}

// =============================================================================
// Factory & Decorator Types
// =============================================================================

export type FactoryType = 'hook-factory' | 'decorator-factory' | 'bean-factory' | 'service-factory';

export interface FactoryFunction {
  name: string;
  qualifiedName: string;
  factoryType: FactoryType;
  producedType: string;
  primitiveSignature: string[];
  usages: string[];
}

export interface DecoratorWrapper {
  name: string;
  wrappedDecorators: string[];
  appliedTo: string[];
  isParameterized: boolean;
}

// =============================================================================
// Async Wrapper Types
// =============================================================================

export type AsyncType = 'promise' | 'async-await' | 'observable' | 'task' | 'future';
export type ErrorHandlingPattern = 'retry' | 'timeout' | 'fallback' | 'circuit-breaker' | 'none';

export interface AsyncWrapper {
  name: string;
  asyncType: AsyncType;
  wrappedPrimitives: string[];
  errorHandling: ErrorHandlingPattern;
  usages: string[];
}

// =============================================================================
// Analysis Result Types
// =============================================================================

export interface WrapperAnalysisResult {
  frameworks: FrameworkInfo[];
  primitives: DetectedPrimitive[];
  wrappers: WrapperFunction[];
  clusters: WrapperCluster[];
  factories: FactoryFunction[];
  decoratorWrappers: DecoratorWrapper[];
  asyncWrappers: AsyncWrapper[];
  summary: WrapperSummary;
}

export interface FrameworkInfo {
  name: string;
  version?: string;
  primitiveCount: number;
  language: SupportedLanguage;
}

export interface WrapperSummary {
  totalWrappers: number;
  totalClusters: number;
  avgDepth: number;
  maxDepth: number;
  mostWrappedPrimitive: string;
  mostUsedWrapper: string;
  wrappersByLanguage: Record<SupportedLanguage, number>;
  wrappersByCategory: Record<WrapperCategory, number>;
}

// =============================================================================
// Registry Types
// =============================================================================

export interface PrimitiveRegistry {
  [framework: string]: {
    [category: string]: string[];
  };
}

export interface FrameworkDetectionResult {
  framework: string;
  version?: string;
  confidence: number;
  detectedVia: 'package.json' | 'import' | 'decorator' | 'inference';
}
