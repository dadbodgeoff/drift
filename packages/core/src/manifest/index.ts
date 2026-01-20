/**
 * Manifest module - Pattern location discovery and storage
 *
 * This module provides:
 * - SemanticLocation: Rich location data with class/function names, signatures
 * - ManifestStore: Storage and querying of pattern locations
 * - Exporter: Export manifest in various formats (JSON, AI context, etc.)
 *
 * @requirements PATTERN-LOCATION-DISCOVERY.md
 */

// Types
export type {
  SemanticType,
  SemanticLocation,
  ManifestPattern,
  ManifestFile,
  Manifest,
  ManifestSummary,
  ExportFormat,
  ExportOptions,
  TokenEstimate,
  PatternQuery,
  PatternQueryResult,
  FileQuery,
  FileQueryResult,
} from './types.js';

// ManifestStore
export { ManifestStore, hashContent, createSemanticLocation } from './manifest-store.js';

// Exporter
export { exportManifest, estimateTokens } from './exporter.js';
