/**
 * Backward Compatibility Module
 *
 * Provides the old API names that delegate to the unified provider.
 * These exist purely for backward compatibility with existing code.
 *
 * The unified provider is the main extraction pipeline - these are just aliases.
 */

// Scanner alias
export {
  SemanticDataAccessScanner,
  createSemanticDataAccessScanner,
  detectProjectStack,
  type SemanticScannerConfig,
  type SemanticScanResult,
  type DetectedStack,
} from './legacy-scanner.js';

// Extractor aliases
export {
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
} from './legacy-extractors.js';
