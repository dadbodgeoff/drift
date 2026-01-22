/**
 * Integration Module Exports
 *
 * Provides adapters and bridges between the UnifiedLanguageProvider
 * and existing systems (SemanticDataAccessScanner, CallGraphAnalyzer).
 */

// Unified Data Access Adapter
export {
  UnifiedDataAccessAdapter,
  createUnifiedDataAccessAdapter,
  toDataAccessPoint,
  toFunctionExtraction,
  toClassExtraction,
  toImportExtraction,
  toExportExtraction,
  toFileExtractionResult,
} from './unified-data-access-adapter.js';

// Unified Scanner (replacement for SemanticDataAccessScanner)
export {
  UnifiedScanner,
  createUnifiedScanner,
  detectProjectStack,
  type UnifiedScannerConfig,
  type UnifiedScanResult,
  type DetectedStack,
} from './unified-scanner.js';
