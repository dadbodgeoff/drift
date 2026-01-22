/**
 * @drift/core - Core pattern detection and analysis engine
 *
 * This package provides the foundational components for Drift:
 * - Scanner: File system analysis and dependency graph
 * - Parsers: Multi-language AST parsing via Tree-sitter
 * - Analyzers: AST, type, semantic, and flow analysis
 * - Matcher: Pattern matching and confidence scoring
 * - Store: Pattern persistence and history tracking
 * - Rules: Violation evaluation and quick fix generation
 * - Config: Configuration loading and validation
 */

// Export version
export const VERSION = '0.0.1';

// Type exports (main public API)
export * from './types/index.js';

// Scanner exports
export * from './scanner/index.js';

// Parser exports (selective to avoid Position conflict)
export type {
  Language,
  AST,
  ASTNode,
  ParseResult,
  ParseError,
  Position as ParserPosition,
} from './parsers/types.js';
export { BaseParser } from './parsers/base-parser.js';
export { ParserManager } from './parsers/parser-manager.js';
export { TypeScriptParser } from './parsers/typescript-parser.js';
export { PythonParser } from './parsers/python-parser.js';
export { CSSParser } from './parsers/css-parser.js';
export { JSONParser } from './parsers/json-parser.js';
export { MarkdownParser } from './parsers/markdown-parser.js';

// Tree-sitter parser exports
export {
  TreeSitterPythonParser,
  TreeSitterCSharpParser,
  TreeSitterJavaParser,
  TreeSitterPhpParser,
  isTreeSitterAvailable,
  getLoadingError,
  isCSharpTreeSitterAvailable,
  getCSharpLoadingError,
  isJavaTreeSitterAvailable,
  getJavaLoadingError,
  resetJavaLoader,
  isPhpTreeSitterAvailable,
  getPhpLoadingError,
  resetPhpLoader,
} from './parsers/tree-sitter/index.js';
export type {
  TreeSitterPythonParseResult,
  TreeSitterCSharpParseResult,
  CSharpUsingInfo,
  CSharpNamespaceInfo,
  CSharpAttributeInfo,
  CSharpParameterInfo,
  CSharpMethodInfo,
  CSharpPropertyInfo,
  CSharpFieldInfo,
  CSharpConstructorInfo,
  CSharpClassInfo,
  CSharpRecordInfo,
  CSharpStructInfo,
  CSharpInterfaceInfo,
  CSharpEnumInfo,
  // Java types
  JavaParseResult,
  JavaClassInfo,
  JavaInterfaceInfo,
  JavaEnumInfo,
  JavaRecordInfo,
  JavaMethodInfo,
  JavaFieldInfo,
  JavaConstructorInfo,
  JavaParameterInfo,
  AnnotationUsage,
  AnnotationArgument,
  PackageInfo,
  JavaImportInfo,
  // PHP types
  PhpParseResult,
  PhpNamespaceInfo,
  PhpUseStatementInfo,
  PhpAttributeInfo,
  PhpParameterInfo,
  PhpMethodInfo,
  PhpPropertyInfo,
  PhpClassInfo,
  PhpInterfaceInfo,
  PhpTraitInfo,
  PhpEnumInfo,
} from './parsers/tree-sitter/index.js';

// Java type mapping exports
export {
  JAVA_TYPE_MAP,
  JAVA_COLLECTION_TYPES,
  JAVA_MAP_TYPES,
  mapJavaType,
  extractGenericType,
  isCollectionType,
  isMapType,
  isOptionalType,
  isWrapperType,
  unwrapType,
} from './types/java-type-mapping.js';

// Analyzer exports
export * from './analyzers/index.js';

// Matcher exports (selective to avoid conflicts with other modules)
export type {
  // Core match types
  PatternMatch,
  PatternMatchResult,
  AggregatedMatchResult,
  Location as MatchLocation,
  SourceRange,

  // Match type enums
  MatchType,
  ExtendedMatchType,

  // Confidence types
  ConfidenceLevel,
  ConfidenceScore,
  ConfidenceWeights,
  ConfidenceInput,

  // Pattern definition types
  PatternDefinition,
  ASTMatchConfig,
  RegexMatchConfig,
  StructuralMatchConfig,
  PatternMetadata as MatcherPatternMetadata,

  // Outlier types
  OutlierInfo,
  OutlierType,
  OutlierSignificance,
  OutlierContext,
  OutlierStatistics,
  OutlierDetectionResult,
  OutlierDetectionMethod,

  // Configuration types
  MatcherConfig,
  MatcherCacheConfig,
  MatcherContext,
  MatchingResult,
  MatchingError,
} from './matcher/types.js';

// Matcher constants
export {
  CONFIDENCE_THRESHOLDS,
  DEFAULT_CONFIDENCE_WEIGHTS,
} from './matcher/types.js';

// Store exports (selective to avoid conflicts)
export type { PatternFile, StoredPattern, DetectorConfig, ConfidenceInfo, PatternLocation, OutlierLocation, PatternStoreConfig, PatternCategory, PatternStatus, Pattern, VariantScope, PatternVariant } from './store/types.js';
export { CacheManager } from './store/cache-manager.js';
export type { CacheManagerOptions, CacheEntry, CacheStats } from './store/cache-manager.js';
export { PatternStore, PatternNotFoundError, InvalidStateTransitionError, PatternStoreError } from './store/pattern-store.js';

// Project Registry exports (multi-project management)
export {
  ProjectRegistry,
  getProjectRegistry,
  createProjectRegistry,
} from './store/project-registry.js';
export type {
  RegisteredProject,
  ProjectRegistryFile,
  ProjectRegistryConfig,
  ProjectRegistrationOptions,
  ProjectFramework,
  ProjectLanguage,
  ProjectHealth,
  RegistryEventType,
  RegistryEvent,
} from './store/project-registry.js';

// Project Config exports (enhanced project configuration)
export {
  ProjectConfigManager,
  createProjectConfigManager,
  loadProjectConfig,
  createDefaultConfig,
} from './store/project-config.js';
export type {
  ProjectConfig,
  ProjectMetadata,
  CIConfig,
  LearningConfig,
  PerformanceConfig,
  LegacyConfig,
} from './store/project-config.js';

// History store exports (pattern regression tracking)
export { HistoryStore } from './store/history-store.js';
export type { PatternSnapshot, HistorySnapshot, PatternTrend, TrendSummary, CategorySummary, HistoryStoreConfig } from './store/history-store.js';

// Contract exports (BE↔FE mismatch detection)
export * from './types/contracts.js';
export { ContractStore, ContractNotFoundError, InvalidContractTransitionError, ContractStoreError } from './store/contract-store.js';
export type { ContractStoreConfig, ContractStoreEvent, ContractStoreEventType } from './store/contract-store.js';

// Rules exports (selective to avoid conflicts)
export type { Position as RulePosition, Violation, QuickFix, Range, Severity, ViolationInput, RuleEvaluationResult, RuleEvaluationSummary, RuleEvaluationError } from './rules/types.js';
export { Evaluator, createEvaluator, createEvaluatorWithConfig, createEvaluatorWithAI, type EvaluatorConfig, type EvaluationInput, type EvaluationResult, type EvaluationSummary } from './rules/evaluator.js';
export { RuleEngine, createRuleEngine, createRuleEngineWithConfig, createRuleEngineWithAI, type RuleEngineConfig, type RuleEvaluationInput, type PatternWithContext } from './rules/rule-engine.js';
export { VariantManager, VariantNotFoundError, VariantManagerError, InvalidVariantInputError, type CreateVariantInput, type UpdateVariantInput, type VariantQuery, type VariantManagerEvent, type VariantManagerEventType, type VariantManagerConfig } from './rules/variant-manager.js';

// Config exports
export * from './config/index.js';

// Manifest exports (pattern location discovery)
export * from './manifest/index.js';

// Learning exports (pattern learning system)
export * from './learning/index.js';

// DNA exports (Styling DNA analysis system)
export * from './dna/index.js';

// Boundaries exports (Data access boundary tracking)
export * from './boundaries/index.js';

// Data Lake exports (Enterprise data storage with materialized views)
export * from './lake/index.js';

// Call Graph exports (Call graph analysis and reachability)
export {
  CallGraphAnalyzer,
  createCallGraphAnalyzer,
  BaseCallGraphExtractor,
  TypeScriptCallGraphExtractor,
  PythonCallGraphExtractor,
  CSharpCallGraphExtractor,
  JavaCallGraphExtractor,
  PhpCallGraphExtractor,
  GraphBuilder,
  ReachabilityEngine,
  CallGraphStore,
  createCallGraphStore,
  ImpactAnalyzer,
  createImpactAnalyzer,
  DeadCodeDetector,
  createDeadCodeDetector,
  CoverageAnalyzer,
  createCoverageAnalyzer,
  BaseDataAccessExtractor,
  // Unified Provider (main extraction pipeline)
  UnifiedScanner,
  createUnifiedScanner,
  detectProjectStack,
  // Backward compatibility aliases
  TypeScriptDataAccessExtractor,
  createTypeScriptDataAccessExtractor,
  PythonDataAccessExtractor,
  createPythonDataAccessExtractor,
  createDataAccessExtractors,
  SemanticDataAccessScanner,
  createSemanticDataAccessScanner,
} from './call-graph/index.js';
export type {
  // Unified scanner types
  UnifiedScannerConfig,
  UnifiedScanResult,
  DetectedStack,
  // Backward compatibility type aliases
  SemanticScannerConfig,
  SemanticScanResult,
} from './call-graph/index.js';
export type {
  CallGraph,
  CallGraphLanguage,
  FunctionNode,
  CallSite,
  CallGraphStats,
  FileExtractionResult,
  FunctionExtraction,
  CallExtraction,
  ImportExtraction as CallGraphImportExtraction,
  ExportExtraction,
  ClassExtraction as CallGraphClassExtraction,
  ReachabilityResult,
  ReachabilityOptions,
  ReachableDataAccess,
  CallPathNode,
  CodeLocation,
  SensitiveFieldAccess,
  InverseReachabilityOptions,
  InverseReachabilityResult,
  InverseAccessPath,
  SerializedCallGraph,
  CallGraphStoreConfig,
  CallGraphAnalyzerConfig,
  ParameterInfo as CallGraphParameterInfo,
  // Enrichment types
  PriorityTier,
  DataRegulation,
  // Impact analysis types
  ImpactRisk,
  AffectedFunction,
  AffectedDataPath,
  ImpactAnalysisResult,
  ImpactAnalysisOptions,
  // Dead code types
  DeadCodeConfidence,
  FalsePositiveReason,
  DeadCodeCandidate,
  DeadCodeResult,
  DeadCodeOptions,
  // Coverage types
  CoverageStatus,
  SensitiveAccessPath,
  FieldCoverage,
  CoverageAnalysisResult,
  CoverageAnalysisOptions,
  SensitivityPatternConfig,
  // Data Access Extraction types
  DataAccessExtractionResult,
} from './call-graph/index.js';

// Language Intelligence exports (Cross-language semantic analysis)
export {
  // Main class
  LanguageIntelligence,
  createLanguageIntelligence,
  // Framework registry
  FrameworkRegistry,
  getFrameworkRegistry,
  registerFramework,
  registerFrameworks,
  // Framework patterns
  SPRING_PATTERNS,
  FASTAPI_PATTERNS,
  NESTJS_PATTERNS,
  LARAVEL_PATTERNS,
  ASPNET_PATTERNS,
  ALL_FRAMEWORK_PATTERNS,
  registerAllFrameworks,
  getFrameworkPattern,
  getFrameworksForLanguage,
  // Normalizers
  BaseLanguageNormalizer,
  JavaNormalizer,
  PythonNormalizer,
  TypeScriptNormalizer,
  CSharpNormalizer,
  PhpNormalizer,
  createNormalizer,
  createAllNormalizers,
  getNormalizerForFile,
} from './language-intelligence/index.js';
export type {
  // Core types
  SemanticCategory,
  HttpMethod,
  DataAccessMode,
  DecoratorSemantics,
  NormalizedDecorator,
  DecoratorArguments,
  FunctionSemantics,
  NormalizedFunction,
  NormalizedExtractionResult,
  DecoratorMapping,
  FrameworkPattern,
  LanguageNormalizer,
  QueryOptions,
  QueryResult,
  LanguageIntelligenceConfig,
} from './language-intelligence/index.js';

// ============================================================================
// Unified Pattern System (NEW - Phase 1 of Pattern System Consolidation)
// ============================================================================

// Pattern types and utilities
export type {
  // Core pattern types (unified)
  Pattern as UnifiedPattern,
  PatternSummary as UnifiedPatternSummary,
  PatternLocation as UnifiedPatternLocation,
  OutlierLocation as UnifiedOutlierLocation,
  PatternMetadata as UnifiedPatternMetadata,
  DetectorConfig as UnifiedDetectorConfig,
  CreatePatternInput,
  // Type aliases (for disambiguation from existing types)
  PatternCategory as UnifiedPatternCategory,
  PatternStatus as UnifiedPatternStatus,
  ConfidenceLevel as UnifiedConfidenceLevel,
  Severity as UnifiedSeverity,
  DetectionMethod,
} from './patterns/index.js';

export {
  // Constants
  PATTERN_CATEGORIES as UNIFIED_PATTERN_CATEGORIES,
  VALID_STATUS_TRANSITIONS,
  CONFIDENCE_THRESHOLDS as UNIFIED_CONFIDENCE_THRESHOLDS,
  SEVERITY_ORDER,
  // Utility functions
  computeConfidenceLevel,
  toPatternSummary,
  createPattern,
} from './patterns/index.js';

// Pattern repository interface and implementations
export type {
  IPatternRepository,
  PatternFilter,
  PatternSort,
  PatternPagination,
  PatternQueryOptions as UnifiedPatternQueryOptions,
  PatternQueryResult as UnifiedPatternQueryResult,
  PatternRepositoryEventType,
  PatternRepositoryEventHandler,
  PatternRepositoryConfig,
} from './patterns/index.js';

export {
  DEFAULT_REPOSITORY_CONFIG,
  FilePatternRepository,
  InMemoryPatternRepository,
  CachedPatternRepository,
  UnifiedFilePatternRepository,
  createUnifiedFilePatternRepository,
  createPatternRepository,
  createPatternRepositorySync,
  detectStorageFormat,
  PatternNotFoundError as UnifiedPatternNotFoundError,
  InvalidStatusTransitionError as UnifiedInvalidStatusTransitionError,
  PatternAlreadyExistsError,
} from './patterns/index.js';

export type {
  UnifiedRepositoryConfig,
  StorageFormat,
  RepositoryFactoryConfig,
} from './patterns/index.js';

// Pattern service interface and implementation
export type {
  IPatternService,
  PatternSystemStatus,
  CategorySummary as PatternCategorySummary,
  PatternWithExamples,
  CodeExample,
  ListOptions,
  PaginatedResult,
  SearchOptions,
  PatternServiceConfig,
} from './patterns/index.js';

export {
  DEFAULT_SERVICE_CONFIG,
  PatternService,
  createPatternService,
} from './patterns/index.js';

// Pattern store adapter (for backward compatibility during migration)
export {
  PatternStoreAdapter,
  createPatternStoreAdapter,
  createPatternServiceFromStore,
} from './patterns/index.js';
