/**
 * Pydantic Module
 *
 * Public exports for Pydantic model extraction functionality.
 * Provides comprehensive parsing of Pydantic v1 and v2 models.
 *
 * @module pydantic
 */

// ============================================
// Main Extractor
// ============================================

export { PydanticExtractor, modelsToContractFields, findModel, getModelNames } from './pydantic-extractor.js';

// ============================================
// Individual Extractors
// ============================================

export { FieldExtractor } from './field-extractor.js';
export { TypeResolver } from './type-resolver.js';
export { ConstraintParser, hasNumericConstraints, hasStringConstraints, hasAnyConstraints, mergeConstraints } from './constraint-parser.js';
export { ValidatorExtractor } from './validator-extractor.js';
export { ConfigExtractor } from './config-extractor.js';
export { InheritanceResolver } from './inheritance-resolver.js';

// ============================================
// Types
// ============================================

export type {
  ExtractionContext,
  RawFieldData,
  FieldArgument,
  ParsedType,
  RawValidatorData,
  ValidatorDecoratorType,
  ValidatorMode,
  RawConfigData,
  ConfigValue,
  BaseClassInfo,
} from './types.js';

export {
  createExtractionContext,
  PYTHON_TYPE_MAP,
  NUMERIC_CONSTRAINTS,
  STRING_CONSTRAINTS,
  ALL_CONSTRAINTS,
  PYDANTIC_BASE_CLASSES,
  extractPosition,
  extractPositionRange,
} from './types.js';
