/**
 * Tree-sitter Parser Module
 *
 * Public exports for tree-sitter parser integrations.
 * Provides AST parsing for Python (with Pydantic support) and C# (with ASP.NET support).
 *
 * @requirements 3.5 - Unified AST query interface
 */

// ============================================
// Python Parser Exports
// ============================================

export { TreeSitterPythonParser } from './tree-sitter-python-parser.js';
export type { TreeSitterPythonParseResult } from './tree-sitter-python-parser.js';

// ============================================
// C# Parser Exports
// ============================================

export { TreeSitterCSharpParser } from './tree-sitter-csharp-parser.js';
export type {
  TreeSitterCSharpParseResult,
  CSharpUsingInfo,
  CSharpNamespaceInfo,
  CSharpAttributeInfo,
  CSharpParameterInfo,
  CSharpMethodInfo,
  CSharpPropertyInfo,
  CSharpFieldInfo,
  CSharpConstructorInfo,
  CSharpClassInfo,
  CSharpRecordInfo,
  CSharpStructInfo,
  CSharpInterfaceInfo,
  CSharpEnumInfo,
} from './tree-sitter-csharp-parser.js';

// ============================================
// Python Loader Exports
// ============================================

export {
  isTreeSitterAvailable,
  getTreeSitter,
  getPythonLanguage,
  createPythonParser,
  getLoadingError,
} from './loader.js';

// ============================================
// C# Loader Exports
// ============================================

export {
  isCSharpTreeSitterAvailable,
  getCSharpLanguage,
  createCSharpParser,
  getCSharpLoadingError,
  resetCSharpLoader,
} from './csharp-loader.js';

// ============================================
// Configuration Exports
// ============================================

export type { PythonParserConfig } from './config.js';
export {
  DEFAULT_PYTHON_PARSER_CONFIG,
  validateConfig,
  mergeConfig,
  configFromEnv,
} from './config.js';

// ============================================
// Type Exports
// ============================================

export type {
  // Tree-sitter core types
  TreeSitterNode,
  TreeSitterTree,
  TreeSitterParser,
  TreeSitterLanguage,
  TreeSitterPoint,
  TreeSitterQuery,
  TreeSitterQueryMatch,
  TreeSitterQueryCapture,
  // Pydantic types
  PydanticModelInfo,
  PydanticFieldInfo,
  PydanticValidatorInfo,
  PydanticConfigInfo,
  TypeInfo,
  FieldConstraints,
} from './types.js';

// ============================================
// AST Converter Exports
// ============================================

export { PythonASTConverter, convertPoint, convertNodeType } from './python-ast-converter.js';
export type { ConversionOptions } from './python-ast-converter.js';

export { CSharpASTConverter, convertCSharpPoint, convertCSharpNodeType } from './csharp-ast-converter.js';
export type { CSharpConversionOptions } from './csharp-ast-converter.js';

// ============================================
// Pydantic Module Exports
// ============================================

export {
  PydanticExtractor,
  FieldExtractor,
  TypeResolver,
  ConstraintParser,
  ValidatorExtractor,
  ConfigExtractor,
  InheritanceResolver,
  modelsToContractFields,
  findModel,
  getModelNames,
  hasNumericConstraints,
  hasStringConstraints,
  hasAnyConstraints,
  mergeConstraints,
  createExtractionContext,
  PYTHON_TYPE_MAP,
  PYDANTIC_BASE_CLASSES,
} from './pydantic/index.js';

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
} from './pydantic/index.js';
