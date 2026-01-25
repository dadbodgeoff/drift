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
// Java Parser Exports
// ============================================

export { TreeSitterJavaParser } from './tree-sitter-java-parser.js';

// ============================================
// Java Loader Exports
// ============================================

export {
  isJavaTreeSitterAvailable,
  getJavaLanguage,
  getJavaTreeSitter,
  createJavaParser,
  getJavaLoadingError,
  resetJavaLoader,
} from './java-loader.js';

// ============================================
// PHP Parser Exports
// ============================================

export { TreeSitterPhpParser } from './tree-sitter-php-parser.js';
export type {
  PhpParseResult,
  PhpNamespaceInfo,
  PhpUseStatementInfo,
  PhpAttributeInfo,
  PhpParameterInfo,
  PhpMethodInfo,
  PhpPropertyInfo,
  PhpClassInfo,
  PhpInterfaceInfo,
  PhpTraitInfo,
  PhpEnumInfo,
} from './tree-sitter-php-parser.js';

// ============================================
// PHP Loader Exports
// ============================================

export {
  isPhpTreeSitterAvailable,
  getPhpLanguage,
  getPhpTreeSitter,
  createPhpParser,
  getPhpLoadingError,
  resetPhpLoader,
} from './php-loader.js';

// ============================================
// TypeScript/JavaScript Loader Exports
// ============================================

export {
  isTypeScriptTreeSitterAvailable,
  isJavaScriptTreeSitterAvailable,
  getTypeScriptLanguage,
  getTsxLanguage,
  getJavaScriptLanguage,
  getTypeScriptTreeSitter,
  createTypeScriptParser,
  createTsxParser,
  createJavaScriptParser,
  createParserForFile,
  getTypeScriptLoadingError,
  resetTypeScriptLoader,
} from './typescript-loader.js';

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
// Go Loader Exports
// ============================================

export {
  isGoTreeSitterAvailable,
  getGoLanguage,
  getGoTreeSitter,
  createGoParser,
  getGoLoadingError,
  resetGoLoader,
} from './go-loader.js';

// ============================================
// Go Parser Exports
// ============================================

export { TreeSitterGoParser } from './tree-sitter-go-parser.js';
export type {
  GoParseResult,
  GoPackageInfo,
  GoImportInfo,
  GoParameterInfo,
  GoReturnInfo,
  GoFunctionInfo,
  GoMethodInfo,
  GoReceiverInfo,
  GoFieldInfo,
  GoStructInfo,
  GoInterfaceMethodInfo,
  GoInterfaceInfo,
  GoTypeAliasInfo,
} from './tree-sitter-go-parser.js';

// ============================================
// Rust Loader Exports
// ============================================

export {
  isRustTreeSitterAvailable,
  getRustLanguage,
  getRustTreeSitter,
  createRustParser,
  getRustLoadingError,
  resetRustLoader,
} from './rust-loader.js';

// ============================================
// Rust Parser Exports
// ============================================

export { RustTreeSitterParser, createRustTreeSitterParser } from './tree-sitter-rust-parser.js';
export type {
  RustParseResult,
  RustFunction,
  RustParameter,
  RustGeneric,
  RustStruct,
  RustField,
  RustEnum,
  RustEnumVariant,
  RustTrait,
  RustTraitMethod,
  RustImpl,
  RustUse,
  RustMacroCall,
} from './tree-sitter-rust-parser.js';

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

// ============================================
// Java Module Exports
// ============================================

export {
  // Annotation utilities
  extractAnnotations,
  extractParameterAnnotations,
  resolveAnnotationFullName,
  buildImportMap,
  findChildrenByType,
  hasAnnotationArgument,
  getAnnotationArgument,
  getAnnotationValue,
  isWebMappingAnnotation,
  isStereotypeAnnotation,
  isValidationAnnotation,
  // Class extraction
  extractModifiers,
  deriveAccessibility,
  extractClasses,
  extractInterfaces,
  extractEnums,
  extractRecords,
  extractAnnotationDefinitions,
  // Method extraction
  extractMethod,
  extractConstructor,
  extractField,
  hasAnnotation,
  getAnnotation,
  isRequestHandler,
  isTransactional,
  hasSecurityAnnotation,
  getHttpMethod,
  getRequestPath,
  getPathVariables,
  getRequestBody,
  getQueryParameters,
  // Constants
  DEFAULT_ANNOTATION_OPTIONS,
  COMMON_SPRING_ANNOTATIONS,
} from './java/index.js';

export type {
  // Modifiers
  JavaModifier,
  JavaAccessibility,
  // Package and Imports
  PackageInfo,
  JavaImportInfo,
  // Annotations
  AnnotationValueType,
  AnnotationArgument,
  AnnotationTarget,
  AnnotationUsage,
  // Methods and Parameters
  JavaParameterInfo,
  JavaMethodInfo,
  JavaConstructorInfo,
  // Fields
  JavaFieldInfo,
  // Classes
  JavaClassInfo,
  // Interfaces
  JavaInterfaceInfo,
  // Enums
  JavaEnumConstant,
  JavaEnumInfo,
  // Records
  JavaRecordComponent,
  JavaRecordInfo,
  // Annotation Definitions
  AnnotationElement,
  AnnotationDefinition,
  // Parse Result
  JavaParseResult,
  // Options
  AnnotationExtractionOptions,
} from './java/index.js';
