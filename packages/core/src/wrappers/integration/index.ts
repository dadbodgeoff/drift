/**
 * Wrapper Detection Integration
 *
 * Bridges wrapper detection with the call graph infrastructure.
 */

// Adapter - type conversions between call graph and wrapper detection
export {
  mapLanguage,
  convertFunction,
  convertImport,
  buildDiscoveryContext,
  buildDetectionContext,
  filterExtractions,
  calculateExtractionStats,
  type AdapterOptions,
  type ExtractionStats,
} from './adapter.js';

// Scanner - high-level scanning API
export {
  WrapperScanner,
  createWrapperScanner,
  type WrapperScannerConfig,
  type WrapperScanResult,
} from './scanner.js';

// Pattern adapter - convert wrapper clusters to Drift patterns
export {
  clusterToPattern,
  wrapperToLocation,
  clustersToPatterns,
  generatePatternId,
  extractPatternMetadata,
  isWrapperPattern,
  extractWrapperInfo,
  type WrapperToPatternOptions,
} from './pattern-adapter.js';
