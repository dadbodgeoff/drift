/**
 * Scanner Compatibility Alias
 *
 * Provides the old SemanticDataAccessScanner name that delegates to UnifiedScanner.
 * This exists purely for backward compatibility with existing code.
 */

import {
  UnifiedScanner,
  createUnifiedScanner,
  detectProjectStack,
  type UnifiedScannerConfig,
  type UnifiedScanResult,
  type DetectedStack,
} from '../integration/unified-scanner.js';

// Type aliases
export type SemanticScannerConfig = UnifiedScannerConfig;
export type SemanticScanResult = UnifiedScanResult;
export { type DetectedStack };

/**
 * SemanticDataAccessScanner - alias for UnifiedScanner
 */
export class SemanticDataAccessScanner {
  private readonly scanner: UnifiedScanner;

  constructor(config: SemanticScannerConfig) {
    this.scanner = createUnifiedScanner(config);
  }

  async scanFiles(files: string[]): Promise<SemanticScanResult> {
    return this.scanner.scanFiles(files);
  }

  async scanDirectory(options: {
    patterns?: string[];
    ignorePatterns?: string[];
  } = {}): Promise<SemanticScanResult> {
    return this.scanner.scanDirectory(options);
  }
}

/**
 * createSemanticDataAccessScanner - alias for createUnifiedScanner
 */
export function createSemanticDataAccessScanner(config: SemanticScannerConfig): SemanticDataAccessScanner {
  return new SemanticDataAccessScanner(config);
}

export { detectProjectStack };
