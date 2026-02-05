/**
 * Call Graph Extractors
 *
 * Language-specific extractors for building call graphs.
 * 
 * NOTE: Data access extraction now uses the unified provider system.
 * The legacy *DataAccessExtractor classes are re-exported from the compat layer
 * for backward compatibility, but internally delegate to UnifiedLanguageProvider.
 * 
 * ENTERPRISE FALLBACK: All extractors now support regex fallback when tree-sitter
 * is unavailable. Use the hybrid extractors for maximum extraction coverage.
 */

// Call Graph Extractors (still language-specific - needed for function/call extraction)
export { BaseCallGraphExtractor } from './base-extractor.js';
export { TypeScriptCallGraphExtractor } from './typescript-extractor.js';
export { PythonCallGraphExtractor } from './python-extractor.js';
export { CSharpCallGraphExtractor } from './csharp-extractor.js';
export { JavaCallGraphExtractor } from './java-extractor.js';
export { PhpCallGraphExtractor } from './php-extractor.js';
export { GoCallGraphExtractor, createGoExtractor } from './go-extractor.js';
export { RustCallGraphExtractor, createRustExtractor } from './rust-extractor.js';
export { STCallGraphExtractor } from './st-extractor.js';

// Hybrid Extractors (tree-sitter + regex fallback)
export { HybridExtractorBase, type HybridExtractionResult } from './hybrid-extractor-base.js';
export { PythonHybridExtractor, createPythonHybridExtractor } from './python-hybrid-extractor.js';
export { TypeScriptHybridExtractor, createTypeScriptHybridExtractor } from './typescript-hybrid-extractor.js';
export { PhpHybridExtractor, createPhpHybridExtractor } from './php-hybrid-extractor.js';
export { JavaHybridExtractor, createJavaHybridExtractor } from './java-hybrid-extractor.js';
export { CSharpHybridExtractor, createCSharpHybridExtractor } from './csharp-hybrid-extractor.js';
export { GoHybridExtractor, createGoHybridExtractor } from './go-hybrid-extractor.js';
export { RustHybridExtractor, createRustHybridExtractor } from './rust-hybrid-extractor.js';
export { CppHybridExtractor, createCppHybridExtractor } from './cpp-hybrid-extractor.js';

// Regex Fallback Extractors
export {
  BaseRegexExtractor,
  TypeScriptRegexExtractor,
  PythonRegexExtractor,
  PhpRegexExtractor,
  JavaRegexExtractor,
  CSharpRegexExtractor,
  GoRegexExtractor,
  RustRegexExtractor,
  CppRegexExtractor,
  createCppRegexExtractor,
  getRegexExtractor,
  getRegexExtractorForFile,
} from './regex/index.js';

// Extraction Types
export {
  type ExtractionQuality,
  type ExtractionMethod,
  type RegexPattern,
  type LanguagePatterns,
  type HybridExtractorConfig,
  EXTRACTION_CONFIDENCE,
  DEFAULT_HYBRID_CONFIG,
  createDefaultQuality,
  mergeQualities,
} from './types.js';

// Data Access Extractors - now use unified provider via compat layer
export { 
  BaseDataAccessExtractor,
  type DataAccessExtractionResult,
} from './data-access-extractor.js';

// Re-export from compat layer (delegates to UnifiedLanguageProvider)
export { 
  TypeScriptDataAccessExtractor,
  createTypeScriptDataAccessExtractor,
  PythonDataAccessExtractor,
  createPythonDataAccessExtractor,
  CSharpDataAccessExtractor,
  createCSharpDataAccessExtractor,
  JavaDataAccessExtractor,
  createJavaDataAccessExtractor,
  PhpDataAccessExtractor,
  createPhpDataAccessExtractor,
  createDataAccessExtractors,
  SemanticDataAccessScanner,
  createSemanticDataAccessScanner,
  type SemanticScannerConfig,
  type SemanticScanResult,
  type DetectedStack,
} from '../../unified-provider/compat/index.js';

// Also export detectProjectStack from unified provider
export { detectProjectStack } from '../../unified-provider/integration/unified-scanner.js';

// Standalone language-specific data access extractors
export {
  extractRustDataAccess,
  detectRustDatabaseFrameworks,
  hasRustDataAccess,
  type RustDataAccessResult,
  type RustDataAccessOptions,
} from './rust-data-access-extractor.js';

export {
  extractCppDataAccess,
  detectCppDatabaseFrameworks,
  hasCppDataAccess,
  type CppDataAccessResult,
  type CppDataAccessOptions,
} from './cpp-data-access-extractor.js';
