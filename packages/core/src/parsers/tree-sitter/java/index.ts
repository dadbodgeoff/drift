/**
 * Java Parser Module
 *
 * Exports all Java parsing types and utilities for tree-sitter-java integration.
 * This module provides the foundation for Java/Spring Boot pattern detection.
 *
 * @requirements Java/Spring Boot Language Support
 */

// ============================================
// Type Exports
// ============================================

export type {
  // Modifiers
  JavaModifier,
  JavaAccessibility,
  
  // Package and Imports
  PackageInfo,
  JavaImportInfo,
  
  // Annotations - CRITICAL for Spring
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
  
  // Records (Java 16+)
  JavaRecordComponent,
  JavaRecordInfo,
  
  // Annotation Definitions
  AnnotationElement,
  AnnotationDefinition,
  
  // Parse Result
  JavaParseResult,
  
  // Options
  AnnotationExtractionOptions,
} from './types.js';

// ============================================
// Constant Exports
// ============================================

export {
  DEFAULT_ANNOTATION_OPTIONS,
  COMMON_SPRING_ANNOTATIONS,
} from './types.js';

// ============================================
// Annotation Extractor Exports
// ============================================

export {
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
} from './annotation-extractor.js';

// ============================================
// Class Extractor Exports
// ============================================

export {
  extractModifiers,
  deriveAccessibility,
  extractClasses,
  extractInterfaces,
  extractEnums,
  extractRecords,
  extractAnnotationDefinitions,
} from './class-extractor.js';

// ============================================
// Method Extractor Exports
// ============================================

export {
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
} from './method-extractor.js';
