/**
 * Unified Language Provider
 *
 * A composable extraction pipeline that normalizes AST differences
 * into a universal representation, enabling language-agnostic pattern
 * matching while preserving the proven hybrid tree-sitter + regex approach.
 *
 * @example
 * ```typescript
 * import { createUnifiedProvider } from './unified-provider';
 *
 * const provider = createUnifiedProvider({ projectRoot: '/path/to/project' });
 * const result = await provider.extract(sourceCode, 'src/api/users.ts');
 *
 * // Access extracted data
 * console.log(result.functions);    // All functions/methods
 * console.log(result.callChains);   // Normalized call chains
 * console.log(result.dataAccess);   // Detected data access points
 * ```
 */

// Main provider
export {
  UnifiedLanguageProvider,
  createUnifiedProvider,
} from './provider/index.js';

// Types
export type {
  // Core types
  UnifiedLanguage,
  UnifiedProviderOptions,
  UnifiedExtractionResult,
  ExtractionStats,

  // Call chain types
  UnifiedCallChain,
  CallChainSegment,
  NormalizedArg,

  // Extraction types
  UnifiedFunction,
  UnifiedClass,
  UnifiedImport,
  UnifiedExport,
  UnifiedParameter,
  UnifiedImportedName,
  UnifiedDataAccess,

  // Pattern matching types
  PatternMatchResult,
  PatternMatcher,

  // Normalizer interface
  CallChainNormalizer,
  LanguageConfig,
} from './types.js';

// Parsing utilities
export {
  getParserRegistry,
  detectLanguage,
  getLanguageExtensions,
  ParserRegistry,
  type ParserAvailability,
} from './parsing/index.js';

// Normalization
export {
  getNormalizer,
  getAvailableNormalizers,
  resetNormalizers,
  BaseNormalizer,
  TypeScriptNormalizer,
  PythonNormalizer,
  JavaNormalizer,
  PhpNormalizer,
  CSharpNormalizer,
} from './normalization/index.js';

// Pattern matching
export {
  getMatcherRegistry,
  resetMatcherRegistry,
  MatcherRegistry,
  BaseMatcher,
  // JavaScript/TypeScript ORMs
  SupabaseMatcher,
  PrismaMatcher,
  DrizzleMatcher,
  TypeORMMatcher,
  SequelizeMatcher,
  MongooseMatcher,
  KnexMatcher,
  RawSqlMatcher,
  // Python ORMs
  DjangoMatcher,
  SQLAlchemyMatcher,
  // C# ORMs
  EFCoreMatcher,
  // PHP ORMs
  EloquentMatcher,
  // Java ORMs
  SpringDataMatcher,
} from './matching/index.js';

// Integration adapters (for compatibility with existing systems)
export {
  // Unified Data Access Adapter
  UnifiedDataAccessAdapter,
  createUnifiedDataAccessAdapter,
  toDataAccessPoint,
  toFunctionExtraction,
  toClassExtraction,
  toImportExtraction,
  toExportExtraction,
  toFileExtractionResult,
  // Unified Scanner (replacement for SemanticDataAccessScanner)
  UnifiedScanner,
  createUnifiedScanner,
  detectProjectStack,
  type UnifiedScannerConfig,
  type UnifiedScanResult,
  type DetectedStack,
} from './integration/index.js';

// Backward compatibility aliases (old API names that delegate to unified provider)
export {
  SemanticDataAccessScanner,
  createSemanticDataAccessScanner,
  type SemanticScannerConfig,
  type SemanticScanResult,
  TypeScriptDataAccessExtractor,
  PythonDataAccessExtractor,
  CSharpDataAccessExtractor,
  JavaDataAccessExtractor,
  PhpDataAccessExtractor,
  createTypeScriptDataAccessExtractor,
  createPythonDataAccessExtractor,
  createCSharpDataAccessExtractor,
  createJavaDataAccessExtractor,
  createPhpDataAccessExtractor,
  createDataAccessExtractors,
  type DataAccessExtractionResult,
} from './compat/index.js';
