/**
 * Constants Module
 *
 * Comprehensive tracking of constants, enums, and exported values
 * across all supported languages.
 */

// Types
export * from './types.js';

// Store
export { ConstantStore, type ConstantStoreConfig } from './store/constant-store.js';

// Analysis
export {
  inferCategory,
  getCategoryDisplayName,
  getCategoryDescription,
  isSecuritySensitive,
  suggestConstantName,
} from './analysis/categorizer.js';

// Extractors - Base
export { BaseConstantExtractor } from './extractors/base-extractor.js';
export { BaseConstantRegexExtractor } from './extractors/regex/base-regex.js';

// Extractors - Language-specific regex
export { TypeScriptConstantRegexExtractor } from './extractors/regex/typescript-regex.js';

// Re-export commonly used types for convenience
export type {
  ConstantExtraction,
  EnumExtraction,
  EnumMember,
  ConstantReference,
  FileConstantResult,
  ConstantExtractionQuality,
  ConstantFileShard,
  ConstantIndex,
  ConstantStats,
  ConstantLanguage,
  ConstantKind,
  ConstantCategory,
  IssueSeverity,
  MagicValue,
  PotentialSecret,
  DeadConstant,
  InconsistentConstant,
} from './types.js';
