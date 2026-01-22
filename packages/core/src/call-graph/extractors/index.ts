/**
 * Call Graph Extractors
 *
 * Language-specific extractors for building call graphs.
 */

export { BaseCallGraphExtractor } from './base-extractor.js';
export { TypeScriptCallGraphExtractor } from './typescript-extractor.js';
export { PythonCallGraphExtractor } from './python-extractor.js';
export { CSharpCallGraphExtractor } from './csharp-extractor.js';
export { JavaCallGraphExtractor } from './java-extractor.js';
export { PhpCallGraphExtractor } from './php-extractor.js';

// Data Access Extractors (semantic parsing with tree-sitter)
export { 
  BaseDataAccessExtractor,
  type DataAccessExtractionResult,
} from './data-access-extractor.js';
export { 
  TypeScriptDataAccessExtractor,
  createTypeScriptDataAccessExtractor,
} from './typescript-data-access-extractor.js';
export { 
  PythonDataAccessExtractor,
  createPythonDataAccessExtractor,
} from './python-data-access-extractor.js';
export {
  CSharpDataAccessExtractor,
  createCSharpDataAccessExtractor,
} from './csharp-data-access-extractor.js';
export {
  JavaDataAccessExtractor,
  createJavaDataAccessExtractor,
} from './java-data-access-extractor.js';
export {
  PhpDataAccessExtractor,
  createPhpDataAccessExtractor,
} from './php-data-access-extractor.js';

// Semantic Data Access Scanner (unified scanner using tree-sitter extractors)
export {
  SemanticDataAccessScanner,
  createSemanticDataAccessScanner,
  detectProjectStack,
  type SemanticScannerConfig,
  type SemanticScanResult,
  type DetectedStack,
} from './semantic-data-access-scanner.js';

// Convenience factory for all data access extractors
import { createTypeScriptDataAccessExtractor } from './typescript-data-access-extractor.js';
import { createPythonDataAccessExtractor } from './python-data-access-extractor.js';
import { createCSharpDataAccessExtractor } from './csharp-data-access-extractor.js';
import { createJavaDataAccessExtractor } from './java-data-access-extractor.js';
import { createPhpDataAccessExtractor } from './php-data-access-extractor.js';

export function createDataAccessExtractors() {
  return {
    typescript: createTypeScriptDataAccessExtractor(),
    python: createPythonDataAccessExtractor(),
    csharp: createCSharpDataAccessExtractor(),
    java: createJavaDataAccessExtractor(),
    php: createPhpDataAccessExtractor(),
  };
}
