/**
 * Core type definitions for Drift
 * 
 * Re-exports all types from submodules for convenient access.
 */

// Pattern types
export * from './patterns.js';

// Violation types (selective re-export to avoid conflicts)
export type {
  Violation,
  QuickFix,
  WorkspaceEdit,
  TextEdit,
  Range,
  Position,
  FixType,
} from './violations.js';

// Analysis types
export * from './analysis.js';

// Contract types (BE↔FE mismatch detection)
export * from './contracts.js';

// Common types (selective re-export to avoid conflicts)
export type { Severity, PatternCategory, PatternStatus } from './common.js';
export type { Language } from '../parsers/types.js';
export type { Location, ConfidenceLevel, ConfidenceScore } from '../matcher/types.js';

// Java type mapping
export * from './java-type-mapping.js';