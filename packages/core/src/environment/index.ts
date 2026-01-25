/**
 * Environment Variable Detection Module
 *
 * Provides detection and tracking of environment variable access patterns
 * across all supported languages.
 */

// Types
export * from './types.js';

// Scanner
export { EnvScanner, createEnvScanner, type EnvScannerConfig } from './env-scanner.js';

// Store
export { EnvStore, createEnvStore } from './env-store.js';

// Extractors
export {
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
} from './extractors/index.js';
