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

// Outlier detection exports
export {
  OutlierDetector,
  detectOutliers,
  calculateStatistics,
  DEFAULT_OUTLIER_CONFIG,
} from './matcher/outlier-detector.js';
export type {
  OutlierDetectorConfig,
  DataPoint,
  OutlierRule,
} from './matcher/outlier-detector.js';

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
/** @deprecated Use HybridContractStore from storage module instead */
export { ContractStore, ContractNotFoundError, InvalidContractTransitionError, ContractStoreError } from './store/contract-store.js';
export type { ContractStoreConfig, ContractStoreEvent, ContractStoreEventType } from './store/contract-store.js';

// Storage exports (SQLite-backed stores - Phase 4)
export {
  createPatternStore,
  createContractStore,
  detectStorageBackend,
  hasSqliteDatabase,
  hasJsonPatterns,
  getStorageInfo,
  HybridPatternStore,
  HybridContractStore,
} from './storage/index.js';
export type {
  StorageBackend,
  CreatePatternStoreOptions,
  CreateContractStoreOptions,
  PatternStoreInterface,
  ContractStoreInterface,
  HybridPatternStoreConfig,
  HybridContractStoreConfig,
} from './storage/index.js';

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
  // Streaming builder for large codebases
  StreamingCallGraphBuilder,
  createStreamingCallGraphBuilder,
  // Unified call graph provider (supports legacy and sharded storage)
  UnifiedCallGraphProvider,
  createUnifiedCallGraphProvider,
} from './call-graph/index.js';
export type {
  // Unified scanner types
  UnifiedScannerConfig,
  UnifiedScanResult,
  DetectedStack,
  // Backward compatibility type aliases
  SemanticScannerConfig,
  SemanticScanResult,
  // Streaming builder types
  StreamingBuilderConfig,
  StreamingBuildResult,
  // Unified provider types
  UnifiedCallGraphProviderConfig,
  CallGraphStorageFormat,
  ProviderStats,
  UnifiedFunction,
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


// ============================================================================
// Test Topology (L5 - Test-to-code mapping and quality analysis)
// ============================================================================

export {
  // Main analyzer
  TestTopologyAnalyzer,
  createTestTopologyAnalyzer,
  // Extractors
  BaseTestExtractor,
  TypeScriptTestExtractor,
  createTypeScriptTestExtractor,
  PythonTestExtractor,
  createPythonTestExtractor,
  JavaTestExtractor,
  createJavaTestExtractor,
  CSharpTestExtractor,
  createCSharpTestExtractor,
  PHPTestExtractor,
  createPHPTestExtractor,
} from './test-topology/index.js';

export type {
  // Core types
  TestFramework,
  ReachType,
  TestCase,
  AssertionInfo,
  TestQualitySignals,
  MockStatement,
  MockAnalysis,
  TestCoverage,
  TestCoverageInfo,
  FunctionCoverageInfo,
  UncoveredFunction,
  UncoveredReason,
  TestExtraction,
  SetupBlock,
  FixtureInfo,
  MinimumTestSet,
  TestTopologySummary,
  TestTopologyOptions,
  UncoveredOptions,
  // Analyzer result type
  TestTopologyResult,
} from './test-topology/index.js';


// ============================================================================
// Module Coupling (L6 - Dependency graphs and coupling metrics)
// ============================================================================

export {
  // Main analyzer
  ModuleCouplingAnalyzer,
  createModuleCouplingAnalyzer,
} from './module-coupling/index.js';

export type {
  // Core types
  ModuleRole,
  CycleSeverity,
  BreakEffort,
  CouplingMetrics,
  ExportedSymbol,
  ModuleNode,
  ImportEdge,
  CycleBreakSuggestion,
  DependencyCycle,
  AggregateCouplingMetrics,
  ModuleCouplingGraph,
  ModuleCouplingAnalysis,
  RefactorImpact,
  UnusedExportAnalysis,
  ModuleCouplingOptions,
  CycleDetectionOptions,
  HotspotOptions,
} from './module-coupling/index.js';


// ============================================================================
// Error Handling Coverage (L7 - Error handling patterns and gaps)
// ============================================================================

export {
  // Main analyzer
  ErrorHandlingAnalyzer,
  createErrorHandlingAnalyzer,
} from './error-handling/index.js';

export type {
  // Core types
  CatchAction,
  ErrorSeverity,
  ErrorHandlingQuality,
  CatchClause,
  AsyncErrorHandling,
  ErrorHandlingProfile,
  ErrorBoundary,
  UnhandledErrorPath,
  ErrorTransformation,
  ErrorPropagationChain,
  ErrorHandlingTopology,
  ErrorHandlingMetrics,
  ErrorHandlingSummary,
  FunctionErrorAnalysis,
  ErrorHandlingGap,
  ErrorHandlingOptions,
  GapDetectionOptions,
  BoundaryAnalysisOptions,
} from './error-handling/index.js';


// ============================================================================
// Decision Mining (L8 - Architectural decision mining from git history)
// ============================================================================

export {
  // Main analyzer
  DecisionMiningAnalyzer,
  createDecisionMiningAnalyzer,

  // Git integration
  GitWalker,
  createGitWalker,
  detectLanguage,
  classifyFile,
  CommitParser,
  createCommitParser,
  parseCommitMessage,
  extractMessageSignals,
  parseDiff,
  analyzeArchitecturalSignals,
  analyzeDependencyChanges,
  analyzeDependencyChangesSync,
  compareManifests,

  // Extractors
  BaseCommitExtractor,
  TypeScriptCommitExtractor,
  createTypeScriptCommitExtractor,
  PythonCommitExtractor,
  createPythonCommitExtractor,
  JavaCommitExtractor,
  createJavaCommitExtractor,
  CSharpCommitExtractor,
  createCSharpCommitExtractor,
  PhpCommitExtractor,
  createPhpCommitExtractor,
  createCommitExtractor,
  createAllCommitExtractors,
  getExtractorForFile,
} from './decisions/index.js';

export type {
  // Core types
  DecisionLanguage,
  DecisionConfidence,
  DecisionStatus,
  DecisionCategory,

  // Git types
  GitCommit,
  GitFileChange,
  PullRequestInfo,

  // Extraction types
  CommitSemanticExtraction,
  PatternDelta,
  FunctionDelta,
  DependencyDelta,
  MessageSignal,
  ArchitecturalSignal,

  // Clustering types
  CommitCluster,
  ClusterReason,

  // Decision types
  MinedDecision,
  SynthesizedADR,
  ADRReference,
  ADREvidence,
  CodeLocation as DecisionCodeLocation,

  // Summary types
  DecisionMiningSummary,

  // Options types
  DecisionMiningOptions,
  ClusteringOptions,
  SynthesisOptions as DecisionSynthesisOptions,

  // Result types
  DecisionMiningResult,
  MiningError,

  // Store types
  DecisionStoreConfig,
  DecisionIndex,

  // Git integration types
  GitWalkerOptions,
  GitWalkResult,
  ParsedDiff,
  DiffHunk,
  DiffLine,
  ParsedCommitMessage,
  ConventionalCommitType,
  FooterToken,
  MessageReference,
  LanguageDetection,
  FileClassification,
  ParsedManifest,
  ManifestDependency,
  ManifestDiff,

  // Extractor types
  CommitExtractorOptions,
  ExtractionContext,
} from './decisions/index.js';


// ============================================================================
// Speculative Execution Engine (Pre-flight simulation)
// ============================================================================

export {
  // Main engine
  SimulationEngine,
  createSimulationEngine,

  // Approach generator
  ApproachGenerator,
  createApproachGenerator,

  // Scorers
  FrictionScorer,
  createFrictionScorer,
  ImpactScorer,
  createImpactScorer,
  PatternAlignmentScorer,
  createPatternAlignmentScorer,
  SecurityScorer,
  createSecurityScorer,

  // Language strategies
  getStrategyProvider,
  getStrategiesForTask,
  detectTaskCategory,
  detectFramework as detectProjectFramework,
  getSupportedLanguages,
  getFrameworksForLanguage as getSimulationFrameworksForLanguage,
  typescriptStrategyProvider,
  pythonStrategyProvider,
  javaStrategyProvider,
  csharpStrategyProvider,
  phpStrategyProvider,

  // Constants
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_SIMULATION_OPTIONS,
} from './simulation/index.js';

export type {
  // Task types
  TaskCategory,
  ConstraintType as SimulationConstraintType,
  SimulationConstraint,
  SimulationTask,

  // Approach types
  ApproachStrategy,
  SimulationApproach,

  // Scoring types
  RiskLevel,
  Severity as SimulationSeverity,
  FrictionBreakdown,
  FrictionMetrics,
  ImpactMetrics,
  AlignedPattern,
  ConflictingPattern,
  PatternAlignmentMetrics,
  DataAccessImplication,
  SecurityWarning,
  SecurityMetrics,

  // Result types
  SimulatedApproach,
  ApproachTradeoff,
  SimulationConfidence,
  SimulationMetadata,
  SimulationResult,

  // Configuration types
  SimulationOptions,
  ScoringWeights,

  // Engine config
  SimulationEngineConfig,

  // Generator types
  ApproachGeneratorConfig,
  GeneratedApproaches,

  // Scorer configs
  FrictionScorerConfig,
  ImpactScorerConfig,
  PatternAlignmentScorerConfig,
  SecurityScorerConfig,

  // Strategy types
  StrategyTemplate,
  FrameworkDefinition,
  LanguageStrategyProvider,
  CategoryKeywords,
} from './simulation/index.js';


// ============================================================================
// Constraint Protocol (Learned architectural invariants)
// ============================================================================

export {
  // Store
  ConstraintStore,
  createConstraintStore,
  // Extraction
  InvariantDetector,
  createInvariantDetector,
  ConstraintSynthesizer,
  createConstraintSynthesizer,
  // Verification
  ConstraintVerifier,
  createConstraintVerifier,
} from './constraints/index.js';

export type {
  // Store config
  ConstraintStoreConfig,

  // Core types
  Constraint,
  ConstraintCategory,
  ConstraintLanguage,
  ConstraintStatus,
  ConstraintType,
  ConstraintSource,
  ConstraintInvariant,
  ConstraintScope,
  ConstraintConfidence,
  ConstraintViolationDetail,
  ConstraintEnforcement,
  ConstraintFix,
  ConstraintFixType,
  ConstraintExample,
  ConstraintMetadata,

  // Predicate types
  ConstraintPredicate,
  EntryPointPredicate,
  FunctionPredicate,
  ClassPredicate,
  DataAccessPredicate,
  CallChainPredicate,
  TestCoveragePredicate,
  NamingPredicate,
  FileStructurePredicate,

  // Verification types
  VerificationResult,
  SatisfiedConstraint,
  ConstraintViolation,
  ViolationLocation,
  ViolationFix,
  SkippedConstraint,
  VerificationMetadata,

  // Index types
  ConstraintIndex,
  ConstraintCounts,
  ConstraintSummary,

  // Query types
  ConstraintQueryOptions,
  ConstraintQueryResult,

  // Extraction types
  ExtractionOptions,
  ExtractionResult,
  ExtractionStats,

  // Extraction module types
  InvariantDetectorConfig,
  DetectedInvariant,
  InvariantEvidence,
  ConstraintSynthesizerConfig,
  SynthesisOptions as ConstraintSynthesisOptions,

  // Verification module types
  ConstraintVerifierConfig,
  VerifyOptions,
  FileContext,
} from './constraints/index.js';

// Constraint constants
export {
  CONSTRAINT_SCHEMA_VERSION,
  CONSTRAINT_CATEGORIES,
  CONSTRAINT_LANGUAGES,
  CONSTRAINT_STATUSES,
  CONSTRAINT_TYPES,
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_ENFORCEMENT_LEVEL,
} from './constraints/index.js';


// ============================================================================
// WPF Framework Support (XAML parsing, ViewModel linking, MVVM analysis)
// ============================================================================

export {
  // Main analyzer
  WpfAnalyzer,
  createWpfAnalyzer,

  // Extractors
  XamlHybridExtractor,
  createXamlHybridExtractor,
  ViewModelHybridExtractor,
  createViewModelHybridExtractor,
  CodeBehindLinker,
  createCodeBehindLinker,
  ResourceDictionaryParser,
  createResourceDictionaryParser,
  DependencyPropertyExtractor,
  createDependencyPropertyExtractor,
  DEPENDENCY_PROPERTY_PATTERNS,
  ValueConverterExtractor,
  createValueConverterExtractor,
  VALUE_CONVERTER_PATTERNS,
  BindingErrorDetector,
  createBindingErrorDetector,

  // Regex extractors (for direct use or testing)
  XamlRegexExtractor,
  XAML_REGEX_PATTERNS,
  ViewModelRegexExtractor,
  VIEWMODEL_REGEX_PATTERNS,

  // Linkers
  DataContextResolver,
  createDataContextResolver,
  ViewModelLinker,
  createViewModelLinker,

  // Integration
  WpfCallGraphAdapter,
  createWpfCallGraphAdapter,
  WpfDataFlowTracer,
  createWpfDataFlowTracer,
} from './wpf/index.js';

export type {
  // Configuration types
  WpfAnalyzerConfig,
  XamlExtractorConfig,
  ViewModelExtractorConfig,

  // Result types
  WpfAnalysisResult,
  WpfAnalysisStats,
  LinkingResult,
  UnresolvedBinding,
  LinkingStats,

  // XAML types
  XamlElement,
  XamlBinding,
  XamlCommand,
  XamlFile,
  XamlResource,
  XamlResourceType,
  XamlExtractionResult,
  ExtractedBinding,
  ExtractedCommand,
  BindingMode,
  BindingSourceType,
  UpdateSourceTrigger,

  // ViewModel types
  ViewModelAnalysis,
  ViewModelProperty,
  ViewModelCommand,
  DependencyPropertyInfo,
  DependencyPropertyCallback,

  // Linking types
  ViewModelLink,
  CodeBehindLink,
  EventHandlerLink,
  NamedElementLink,
  DataContextResolution,
  DataContextStep,

  // Call graph integration types
  WpfNodeType,
  WpfCallGraphNode,
  WpfNodeMetadata,
  WpfEdgeType,
  WpfCallGraphEdge,
  WpfCallGraphIntegration,
  WpfCallGraphStats,

  // Data flow types
  DataFlowTrace,
  DataFlowStep,
  DataFlowStepType,
  DataFlowStepDetails,
  DataFlowAnalysisResult,
  SensitiveDataSummary,
  DataFlowStats,

  // Pattern detection types
  MvvmComplianceResult,
  MvvmViolation,
  MvvmViolationType,
  BindingError,
  BindingErrorType,
  BindingValidationResult,
  BindingWarning,
  BindingWarningType,
  BindingValidationStats,

  // Resource dictionary types
  ResourceDictionary,
  ResourceResolution,

  // Value converter types
  ValueConverterInfo,
  ConverterUsage,
  ConverterMethodInfo,
  ValueConverterExtractionResult,

  // Dependency property types
  DependencyPropertyExtractionResult,

  // Project detection types
  WpfProjectInfo,

  // Common types
  SourceLocation as WpfSourceLocation,
  WpfExtractionQuality,
} from './wpf/index.js';


// ============================================================================
// Go Language Support (Go analysis, routes, error handling, data access)
// ============================================================================

export {
  // Main analyzer
  GoAnalyzer,
  createGoAnalyzer,
} from './go/index.js';

export type {
  // Configuration types
  GoAnalyzerConfig,

  // Result types
  GoAnalysisResult,
  GoAnalysisStats,
  GoPackage,
  GoRoute,
  GoRoutesResult,
  GoErrorHandlingResult,
  GoErrorPattern,
  GoErrorIssue,
  GoSentinelError,
  GoCustomError,
  GoInterfacesResult,
  GoInterface,
  GoImplementation,
  GoDataAccessResult,
  GoGoroutinesResult,
  GoGoroutine,
  GoConcurrencyIssue,
} from './go/index.js';


// ============================================================================
// Rust Language Support (Rust analysis, routes, error handling, data access)
// ============================================================================

export {
  // Main analyzer
  RustAnalyzer,
  createRustAnalyzer,
} from './rust/index.js';

export type {
  // Configuration types
  RustAnalyzerOptions,

  // Result types
  RustRoute,
  RustErrorPattern,
  RustCustomError,
  RustTrait,
  RustTraitImpl,
  RustAsyncFunction,
  RustCrate,
} from './rust/index.js';


// ============================================================================
// C++ Language Support (C++ analysis, classes, memory, templates, virtual)
// ============================================================================

export {
  // Main analyzer
  CppAnalyzer,
  createCppAnalyzer,
} from './cpp/index.js';

export type {
  // Configuration types
  CppAnalyzerOptions,

  // Result types
  CppAnalysisResult,
  CppModule,
  CppAnalysisStats,
  CppClass,
  CppClassesResult,
  CppMemoryPattern,
  CppMemoryResult,
  CppMemoryIssue,
  CppTemplate,
  CppTemplatesResult,
  CppVirtualMethod,
  CppVirtualResult,
  CppPolymorphicHierarchy,
} from './cpp/index.js';


// ============================================================================
// TypeScript/JavaScript Language Support (Routes, Components, Hooks, Data Access)
// ============================================================================

export {
  // Main analyzer
  TypeScriptAnalyzer,
  createTypeScriptAnalyzer,
} from './typescript/index.js';

export type {
  // Configuration types
  TypeScriptAnalyzerConfig,

  // Result types
  TypeScriptAnalysisResult,
  TypeScriptAnalysisStats,
  TSRoute,
  TSRoutesResult,
  TSComponent,
  TSComponentsResult,
  TSHook,
  TSHooksResult,
  TSErrorPattern,
  TSErrorIssue,
  TSErrorHandlingResult,
  TSDataAccessPoint,
  TSDataAccessResult,
  TSDecorator,
  TSDecoratorsResult,
} from './typescript/index.js';


// ============================================================================
// Python Language Support (Routes, Error Handling, Data Access, Async)
// ============================================================================

export {
  // Main analyzer
  PythonAnalyzer,
  createPythonAnalyzer,
} from './python/index.js';

export type {
  // Configuration types
  PythonAnalyzerConfig,

  // Result types
  PythonAnalysisResult,
  PythonAnalysisStats,
  PyRoute,
  PyRoutesResult,
  PyErrorPattern,
  PyErrorIssue,
  PyErrorHandlingResult,
  PyDataAccessPoint,
  PyDataAccessResult,
  PyDecorator,
  PyDecoratorsResult,
  PyAsyncFunction,
  PyAsyncResult,
} from './python/index.js';


// ============================================================================
// Java Language Support (Routes, Error Handling, Data Access, Annotations)
// ============================================================================

export {
  // Main analyzer
  JavaAnalyzer,
  createJavaAnalyzer,
} from './java/index.js';

export type {
  // Configuration types
  JavaAnalyzerConfig,

  // Result types
  JavaAnalysisResult,
  JavaAnalysisStats,
  JavaRoute,
  JavaRoutesResult,
  JavaErrorPattern,
  JavaErrorIssue,
  JavaErrorHandlingResult,
  JavaDataAccessPoint,
  JavaDataAccessResult,
  JavaAnnotation,
  JavaAnnotationsResult,
} from './java/index.js';


// ============================================================================
// PHP Language Support (Routes, Error Handling, Data Access, Traits)
// ============================================================================

export {
  // Main analyzer
  PhpAnalyzer,
  createPhpAnalyzer,
} from './php/index.js';

export type {
  // Configuration types
  PhpAnalyzerConfig,

  // Result types
  PhpAnalysisResult,
  PhpAnalysisStats,
  PhpRoute,
  PhpRoutesResult,
  PhpErrorPattern,
  PhpErrorIssue,
  PhpErrorHandlingResult,
  PhpDataAccessPoint,
  PhpDataAccessResult,
  PhpTrait,
  PhpTraitUsage,
  PhpTraitsResult,
} from './php/index.js';


// ============================================================================
// Environment Variable Detection (Config access pattern tracking)
// ============================================================================

export {
  // Scanner
  EnvScanner,
  createEnvScanner,
  // Store
  EnvStore,
  createEnvStore,
  // Extractors
  BaseEnvExtractor,
  TypeScriptEnvExtractor,
  createTypeScriptEnvExtractor,
  PythonEnvExtractor,
  createPythonEnvExtractor,
  JavaEnvExtractor,
  createJavaEnvExtractor,
  CSharpEnvExtractor,
  createCSharpEnvExtractor,
  PhpEnvExtractor,
  createPhpEnvExtractor,
  GoEnvExtractor,
  createGoEnvExtractor,
  RustEnvExtractor,
  createRustEnvExtractor,
  // Utilities
  classifyEnvSensitivity,
  SENSITIVE_VAR_PATTERNS,
} from './environment/index.js';

export type {
  // Core types
  EnvLanguage,
  EnvAccessMethod,
  EnvSensitivity,
  EnvAccessPoint,
  EnvVarInfo,
  FileEnvInfo,
  EnvAccessMap,
  EnvExtractionResult,
  EnvStoreConfig,
  EnvScanResult,
  // Scanner config
  EnvScannerConfig,
} from './environment/index.js';


// ============================================================================
// Constants Module (Constant/Enum extraction and tracking)
// ============================================================================

export {
  // Store
  ConstantStore,
  // Analysis - Categorizer
  inferCategory,
  getCategoryDisplayName,
  getCategoryDescription,
  isSecuritySensitive,
  suggestConstantName,
  // Analysis - Reference Finder
  ConstantReferenceFinder,
  findAllReferences,
  DEFAULT_REFERENCE_FIND_CONFIG,
  // Analysis - Magic Value Detector
  MagicValueDetector,
  DEFAULT_MAGIC_DETECTOR_CONFIG,
  // Analysis - Dead Constant Detector
  DeadConstantDetector,
  isLikelyDead,
  DEFAULT_DEAD_CONSTANT_CONFIG,
  // Analysis - Consistency Analyzer
  ConsistencyAnalyzer,
  hasPotentialInconsistency,
  DEFAULT_CONSISTENCY_CONFIG,
  // Analysis - Security Scanner
  ConstantSecurityScanner,
  DEFAULT_SECURITY_SCAN_CONFIG,
  // Extractors - Base
  BaseConstantExtractor,
  BaseConstantRegexExtractor,
  // Extractors - Language-specific
  TypeScriptConstantRegexExtractor,
  PythonConstantRegexExtractor,
  JavaConstantRegexExtractor,
  CSharpConstantRegexExtractor,
  PhpConstantRegexExtractor,
  GoConstantRegexExtractor,
  // Integration - Scanner Adapter
  ConstantScannerAdapter,
  createConstantScanner,
  getConstantLanguage,
  hashContent,
  processConstantTask,
  createDefaultConstantQuality,
  // Integration - Call Graph Adapter
  ConstantCallGraphAdapter,
  createCallGraphAdapter,
  // Integration - Pattern Adapter
  ConstantPatternAdapter,
  createPatternAdapter,
  severityToNumber,
  compareSeverity,
} from './constants/index.js';

export type {
  // Core types
  ConstantExtraction,
  EnumExtraction,
  EnumMember,
  ConstantReference,
  FileConstantResult,
  ConstantExtractionQuality,
  ConstantFileShard,
  ConstantIndex,
  ConstantStats,
  ConstantLanguage,
  ConstantKind,
  ConstantCategory,
  IssueSeverity,
  MagicValue,
  PotentialSecret,
  DeadConstant,
  InconsistentConstant,
  // Store config
  ConstantStoreConfig,
  // Analysis configs
  ReferenceFindConfig,
  ReferenceResult,
  MagicDetectorConfig,
  MagicDetectionResult,
  DeadConstantConfig,
  DeadConstantResult,
  ConsistencyConfig,
  ConsistencyResult,
  SecurityScanConfig,
  SecretPattern,
  SecurityScanResult,
  // Integration - Scanner types
  ConstantScannerConfig,
  ConstantScanResult,
  ConstantBatchScanResult,
  ConstantWorkerTask,
  ConstantWorkerResult,
  // Integration - Call graph types
  CallGraphAdapterConfig,
  CallGraphInterface,
  ConstantWithContext,
  ConstantImpactAnalysis,
  FunctionUsage,
  DataFlowPath,
  AffectedFunction as ConstantAffectedFunction,
  // Integration - Pattern types
  PatternAdapterConfig,
  ConstantPattern,
  ConstantPatternCategory,
  ConstantPatternResult,
  PatternLocation as ConstantPatternLocation,
  ManifestPattern as ConstantManifestPattern,
} from './constants/index.js';


// ============================================================================
// Licensing System (OSS vs Enterprise feature gating)
// ============================================================================

export {
  // License Manager
  LicenseManager,
  getLicenseManager,
  isFeatureAvailable,
  getCurrentTier,
  // License Validator
  LicenseValidator,
  generateTestKey,
  generateTestJWT,
  // Feature Guards
  requireFeature,
  checkFeature,
  guardFeature,
  withFeatureGate,
  RequiresFeature,
  FeatureNotLicensedError,
  formatFeatureError,
  formatFeatureCheck,
  createMCPFeatureError,
  guardMCPTool,
  requireTier,
  getLicenseStatus,
  // Constants
  FEATURE_TIERS,
  TIER_HIERARCHY,
} from './licensing/index.js';

export type {
  // Core types
  License,
  LicenseTier,
  LicenseSource,
  LicenseValidationResult,
  FeatureCheckResult,
  EnterpriseFeature,
  // Guard types
  FeatureGateOptions,
  GatedResult,
} from './licensing/index.js';


// ============================================================================
// Quality Gates System (Enterprise-grade code quality enforcement)
// ============================================================================

export {
  // Orchestrator
  GateOrchestrator,
  GateRegistry,
  getGateRegistry,
  ParallelExecutor,
  ResultAggregator,
  // Gates
  BaseGate,
  PatternComplianceGate,
  // Policy
  PolicyLoader,
  PolicyEvaluator,
  DEFAULT_POLICIES,
  // Reporters
  BaseReporter,
  TextReporter,
  JsonReporter,
  GitHubReporter,
  GitLabReporter,
  SarifReporter,
  // Store
  GateRunStore,
  SnapshotStore,
  // Factory
  createQualityGateOrchestrator,
} from './quality-gates/index.js';

export type {
  // Core types
  GateStatus,
  ViolationSeverity,
  GateId,
  OutputFormat,
  AggregationMode,
  // Input/Output types
  GateInput,
  GateContext,
  GateResult,
  GateViolation,
  // Gate configs
  BaseGateConfig,
  PatternComplianceConfig,
  ConstraintVerificationConfig,
  RegressionDetectionConfig,
  ImpactSimulationConfig,
  SecurityBoundaryConfig,
  CustomRulesConfig,
  GateConfig,
  // Gate result details
  PatternComplianceDetails,
  OutlierDetail,
  ConstraintVerificationDetails,
  ConstraintResult as GateConstraintResult,
  ConstraintViolationDetail as GateConstraintViolationDetail,
  SkippedConstraint as GateSkippedConstraint,
  RegressionDetectionDetails,
  PatternRegression,
  PatternImprovement,
  ImpactSimulationDetails,
  SensitiveDataPath,
  AffectedFile,
  SecurityBoundaryDetails,
  DataAccessPoint as GateDataAccessPoint,
  UnauthorizedPath,
  CustomRulesDetails,
  RuleResult,
  RuleViolation,
  // Custom rule types
  CustomRule,
  RuleCondition,
  FilePatternCondition,
  ContentPatternCondition,
  DependencyCondition,
  NamingCondition,
  StructureCondition,
  CompositeCondition,
  // Policy types
  QualityPolicy,
  PolicyScope,
  PolicyGateConfigs,
  AggregationConfig,
  PolicyActions,
  PolicyAction,
  // Orchestrator types
  QualityGateOptions,
  QualityGateResult,
  // Snapshot types
  HealthSnapshot,
  PatternHealthSnapshot,
  ConstraintHealthSnapshot,
  SecurityHealthSnapshot,
  // Reporter types
  ReporterOptions,
  Reporter,
  // Store types
  GateRunRecord,
  // Factory types
  GateFactory,
  GateFactoryContext,
  Logger,
  Gate,
} from './quality-gates/index.js';


// ============================================================================
// Package Context (Monorepo context minimization for AI)
// ============================================================================

export {
  // Package Detection
  PackageDetector,
  createPackageDetector,
  // Context Generation
  PackageContextGenerator,
  createPackageContextGenerator,
} from './context/index.js';

export type {
  // Package types
  PackageManager,
  DetectedPackage,
  MonorepoStructure,
  // Context options
  PackageContextOptions,
  // Context result types
  ContextPattern,
  ContextConstraint,
  ContextEntryPoint,
  ContextDataAccessor,
  PackageContext,
  PackageContextResult,
  // AI format
  AIContextFormat,
  // Cache
  ContextCacheEntry,
  // Events
  ContextEventType,
  ContextEvent,
} from './context/index.js';


// ============================================================================
// Telemetry System (Privacy-first, opt-in telemetry)
// ============================================================================

export {
  // Client
  TelemetryClient,
  createTelemetryClient,
  generateInstallationId,
  // Constants
  DEFAULT_TELEMETRY_CONFIG,
  DEFAULT_CLIENT_CONFIG,
} from './telemetry/index.js';

export type {
  // Config types
  TelemetryConfig,
  TelemetryClientConfig,
  // Event types
  TelemetryEvent,
  BaseTelemetryEvent,
  PatternSignatureEvent,
  AggregateStatsEvent,
  UserActionEvent,
  ScanCompletionEvent,
  // Result types
  TelemetrySubmitResult,
  TelemetryStatus,
} from './telemetry/index.js';


// ============================================================================
// Audit System (Pattern validation, deduplication, and approval workflows)
// ============================================================================

export {
  // Engine
  AuditEngine,
  // Store
  AuditStore,
  // Constants
  AUDIT_VERSION,
  DEFAULT_AUTO_APPROVE_THRESHOLD,
  DEFAULT_REVIEW_THRESHOLD,
  DEFAULT_DUPLICATE_SIMILARITY_THRESHOLD,
  DEFAULT_MIN_LOCATIONS_ESTABLISHED,
  DEFAULT_MAX_OUTLIER_RATIO,
  HEALTH_SCORE_WEIGHTS,
} from './audit/index.js';

export type {
  // Core types
  AuditResult,
  AuditSummary,
  AuditOptions,
  AuditEngineConfig,
  PatternAuditResult,
  PatternCrossValidation,
  DuplicateGroup,
  DuplicateRecommendation,
  CrossValidationResult,
  CrossValidationIssue,
  CrossValidationIssueType,
  CrossValidationSeverity,
  DegradationResult,
  DegradationTracking,
  DegradationAlert,
  DegradationAlertType,
  AuditHistoryEntry,
  CategoryAuditSummary,
  AuditRecommendation,
  TrendDirection as AuditTrendDirection,
  // Store config
  AuditStoreConfig,
} from './audit/index.js';


// ============================================================================
// Native Rust Integration (High-performance native addon with TS fallback)
// ============================================================================

export {
  // Status functions
  isNativeAvailable,
  getNativeLoadError,
  getNativeVersion,
  getSupportedLanguages as getNativeSupportedLanguages,
  // Direct native functions (throw if native unavailable)
  scan,
  parse,
  buildCallGraph,
  scanBoundaries,
  analyzeCoupling,
  analyzeTestTopology,
  analyzeErrorHandling,
  analyzeReachability,
  analyzeInverseReachability,
  analyzeUnified,
  analyzeConstants,
  analyzeEnvironment,
  analyzeWrappers,
  // Call graph query functions
  isCallGraphAvailable,
  getCallGraphStats,
  getCallGraphEntryPoints,
  getCallGraphDataAccessors,
  getCallGraphCallers,
  getCallGraphFileCallers,
  // Adapter functions with TypeScript fallback (recommended)
  parseWithFallback,
  analyzeCouplingWithFallback,
  analyzeTestTopologyWithFallback,
  analyzeErrorHandlingWithFallback,
  analyzeConstantsWithFallback,
  analyzeEnvironmentWithFallback,
  analyzeWrappersWithFallback,
  scanBoundariesWithFallback,
  nativeAdapters,
  // Convenience object
  native,
} from './native/index.js';

export type {
  // Scan types
  ScanConfig,
  FileInfo,
  ScanResult,
  // Call graph types (aliased to avoid conflict with call-graph module)
  CallGraphStats as NativeCallGraphStats,
  EntryPointInfo,
  DataAccessorInfo,
  CallerInfo,
  // Parse types (aliased to avoid conflict with parser types)
  ParseResult as NativeParseResult,
  FunctionInfo as NativeFunctionInfo,
  ClassInfo as NativeClassInfo,
  ImportInfo as NativeImportInfo,
  ExportInfo as NativeExportInfo,
  CallSite as NativeCallSite,
  ParseError as NativeParseError,
  // Build types
  BuildConfig,
  BuildResult,
  // Boundary types
  DataAccessPoint as NativeDataAccessPoint,
  SensitiveField as NativeSensitiveField,
  BoundaryScanResult as NativeBoundaryScanResult,
  ORMModel as NativeORMModel,
  // Coupling types
  CouplingResult,
  ModuleMetrics,
  DependencyCycle as NativeDependencyCycle,
  CouplingHotspot,
  UnusedExport as NativeUnusedExport,
  // Test topology types
  TestTopologyResult as NativeTestTopologyResult,
  TestFile,
  TestCoverage as NativeTestCoverage,
  // Error handling types
  ErrorHandlingResult as NativeErrorHandlingResult,
  ErrorBoundary as NativeErrorBoundary,
  ErrorGap,
  ErrorType,
  // Reachability types (aliased to avoid conflict with call-graph types)
  CodeLocation as NativeCodeLocation,
  CallPathNode as NativeCallPathNode,
  ReachableDataAccess as NativeReachableDataAccess,
  SensitiveFieldAccess as NativeSensitiveFieldAccess,
  ReachabilityResult as NativeReachabilityResult,
  ReachabilityOptions as NativeReachabilityOptions,
  InverseAccessPath as NativeInverseAccessPath,
  InverseReachabilityResult as NativeInverseReachabilityResult,
  CallGraphFunction,
  CallGraphCallSite,
  CallGraphDataAccess,
  CallGraphInput,
  // Unified types
  DetectedPattern,
  FilePatterns,
  ResolutionStats,
  CallGraphSummary,
  AnalysisMetrics,
  UnifiedResult,
  UnifiedOptions,
  // Constants types
  ConstantInfo,
  SecretCandidate,
  MagicNumber,
  ValueLocation,
  ValueInconsistency,
  ConstantsStats,
  ConstantsResult,
  // Environment types
  EnvAccess,
  EnvAccessLocation,
  EnvVariable,
  EnvironmentStats,
  EnvironmentResult,
  // Wrappers types
  WrapperInfo,
  WrapperCluster,
  WrappersStats,
  WrappersResult,
} from './native/index.js';


// ============================================================================
// Workspace Management (Enterprise-grade workspace operations)
// ============================================================================

export {
  // Backup Manager
  BackupManager,
  createBackupManager,
  // Context Loader
  ContextLoader,
  createContextLoader,
  // Project Switcher
  ProjectSwitcher,
  createProjectSwitcher,
  // Schema Migrator
  SchemaMigrator,
  createSchemaMigrator,
  // Workspace Manager (main orchestrator)
  WorkspaceManager,
  createWorkspaceManager,
  getWorkspaceManager,
  resetGlobalWorkspaceManager,
  // Config
  DEFAULT_WORKSPACE_CONFIG,
} from './workspace/index.js';

export type {
  // Backup types
  BackupMetadata,
  BackupReason,
  BackupResult,
  RestoreResult,
  SchemaMigration,
  // Context types
  WorkspaceContext,
  ProjectContext,
  LakeContext,
  AnalysisContext,
  PatternSummary as WorkspacePatternSummary,
  CallGraphSummary as WorkspaceCallGraphSummary,
  BoundarySummary,
  // Project types
  ActiveProjectIndicator,
  ProjectSwitchRequest,
  ProjectSwitchResult,
  ProjectRegistryLike,
  AgentProjectContext,
  // Migration types
  MigrationResult,
  MigrationHistoryEntry,
  MigrationHistory,
  // Workspace Manager types
  WorkspaceInitOptions,
  WorkspaceStatus,
  DestructiveOperationRequest,
  // Config types
  WorkspaceManagerConfig,
} from './workspace/index.js';


// ============================================================================
// Services (Shared between CLI and MCP)
// ============================================================================

export {
  // Scanner Service - Pattern detection with worker threads
  ScannerService,
  createScannerService,
} from './services/index.js';

export type {
  // Scanner Service types
  ProjectContext as ScannerProjectContext,
  ScannerServiceConfig,
  AggregatedPattern,
  AggregatedViolation,
  FileScanResult,
  ScanResults,
  // Detector Worker types
  WarmupTask,
  WarmupResult,
  DetectorWorkerTask,
  WorkerPatternMatch,
  WorkerViolation,
  DetectorWorkerResult,
} from './services/index.js';


// ============================================================================
// Unified Storage (SQLite-based cloud-ready storage)
// ============================================================================

export {
  // Main store
  UnifiedStore,
  // Factory and migration
  createUnifiedStore,
  migrateFromJson,
  // Repositories
  PatternRepository,
  ContractRepository,
  ConstraintRepository,
  BoundaryRepository,
  EnvironmentRepository,
  CallGraphRepository,
  AuditRepository,
  DNARepository,
  TestTopologyRepository,
} from './storage/index.js';

export type {
  // Configuration
  UnifiedStoreConfig,
  // Repository interfaces
  IUnifiedStore,
  IPatternRepository as IDbPatternRepository,
  IContractRepository as IDbContractRepository,
  IConstraintRepository as IDbConstraintRepository,
  IBoundaryRepository as IDbBoundaryRepository,
  IEnvironmentRepository as IDbEnvironmentRepository,
  ICallGraphRepository as IDbCallGraphRepository,
  IAuditRepository as IDbAuditRepository,
  IDNARepository as IDbDNARepository,
  ITestTopologyRepository as IDbTestTopologyRepository,
  // Database entity types
  DbPattern,
  DbPatternLocation,
  DbPatternExample,
  DbPatternVariant,
  DbContract,
  DbContractFrontend,
  DbConstraint,
  DbConstraintCounts,
  DbDataModel,
  DbSensitiveField,
  DbDataAccessPoint,
  DbTableAccess,
  DbSensitiveAccess,
  DbEnvVariable,
  DbEnvAccessPoint,
  DbFunction,
  DbFunctionCall,
  DbFunctionDataAccess,
  DbCallChainNode,
  DbAuditSnapshot,
  DbPatternHistoryEvent,
  DbHealthTrend,
  DbScanHistory,
  DbDNAProfile,
  DbDNAGene,
  DbDNAMutation,
  DbTestFile,
  DbTestCoverage,
  // Query types
  PatternSearchQuery,
  PaginationOptions,
  PaginatedResult as DbPaginatedResult,
  // Sync types
  SyncLogEntry,
  StoreStats,
  // Migration types
  MigrationOptions as StorageMigrationOptions,
  MigrationResult as StorageMigrationResult,
} from './storage/index.js';
