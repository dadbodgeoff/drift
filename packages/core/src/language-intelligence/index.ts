/**
 * Language Intelligence Layer
 *
 * Unified semantic model for cross-language code analysis.
 * Provides semantic normalization of decorators/annotations across
 * TypeScript, Python, Java, C#, and PHP.
 *
 * @example
 * ```typescript
 * import { LanguageIntelligence, registerFrameworks } from './language-intelligence';
 * import { SPRING_PATTERNS, FASTAPI_PATTERNS } from './language-intelligence/frameworks';
 *
 * // Register framework patterns
 * registerFrameworks([SPRING_PATTERNS, FASTAPI_PATTERNS]);
 *
 * // Create intelligence instance
 * const intelligence = new LanguageIntelligence({ rootDir: '/my/project' });
 *
 * // Normalize a file
 * const result = intelligence.normalizeFile(source, 'UserController.java');
 *
 * // Query across languages
 * const entryPoints = intelligence.findEntryPoints(results);
 * const dataAccessors = intelligence.findDataAccessors(results, 'users');
 * ```
 */

// Core types
export type {
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
} from './types.js';

// Framework registry
export {
  FrameworkRegistry,
  getFrameworkRegistry,
  registerFramework,
  registerFrameworks,
} from './framework-registry.js';

// Base normalizer
export { BaseLanguageNormalizer } from './base-normalizer.js';

// Framework patterns
export {
  SPRING_PATTERNS,
  FASTAPI_PATTERNS,
  NESTJS_PATTERNS,
  LARAVEL_PATTERNS,
  ASPNET_PATTERNS,
  ALL_FRAMEWORK_PATTERNS,
  registerAllFrameworks,
  getFrameworkPattern,
  getFrameworksForLanguage,
} from './frameworks/index.js';

// Language normalizers
export {
  JavaNormalizer,
  PythonNormalizer,
  TypeScriptNormalizer,
  CSharpNormalizer,
  PhpNormalizer,
  createNormalizer,
  createAllNormalizers,
  getNormalizerForFile,
} from './normalizers/index.js';

// Main Language Intelligence class
export {
  LanguageIntelligence,
  createLanguageIntelligence,
} from './language-intelligence.js';
