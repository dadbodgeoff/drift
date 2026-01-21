/**
 * Java Parser Type Definitions
 *
 * TypeScript types for Java parsing using tree-sitter-java.
 * Annotations are FIRST-CLASS CITIZENS - they're the primary signal
 * for Spring pattern detection.
 *
 * @requirements Java/Spring Boot Language Support
 */

import type { Position, ParseResult } from '../../types.js';

// ============================================
// Java Modifiers
// ============================================

/**
 * Java access and non-access modifiers.
 * Used on classes, methods, fields, and constructors.
 */
export type JavaModifier =
  | 'public'
  | 'private'
  | 'protected'
  | 'static'
  | 'final'
  | 'abstract'
  | 'synchronized'
  | 'volatile'
  | 'transient'
  | 'native'
  | 'strictfp'
  | 'default'
  | 'sealed'
  | 'non-sealed';

/**
 * Java accessibility levels derived from modifiers.
 */
export type JavaAccessibility = 'public' | 'private' | 'protected' | 'package-private';

// ============================================
// Package and Import Types
// ============================================

/**
 * Package declaration information.
 * 
 * @example
 * package com.example.service;
 */
export interface PackageInfo {
  /** Full package name (e.g., "com.example.service") */
  name: string;
  /** Start position in source */
  startPosition: Position;
  /** End position in source */
  endPosition: Position;
}

/**
 * Import statement information.
 * 
 * @example
 * import org.springframework.web.bind.annotation.GetMapping;
 * import static org.junit.Assert.*;
 */
export interface JavaImportInfo {
  /** Full import path (e.g., "org.springframework.web.bind.annotation.GetMapping") */
  path: string;
  /** Whether this is a static import */
  isStatic: boolean;
  /** Whether this is a wildcard import (e.g., import java.util.*) */
  isWildcard: boolean;
  /** Start position in source */
  startPosition: Position;
  /** End position in source */
  endPosition: Position;
}

// ============================================
// Annotation Types - CRITICAL for Spring Detection
// ============================================

/**
 * Annotation argument value types.
 * Used to understand the structure of annotation arguments.
 */
export type AnnotationValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'class'
  | 'array'
  | 'annotation';

/**
 * Annotation argument information.
 * 
 * @example
 * @RequestMapping(value = "/api", method = RequestMethod.GET)
 *                 ^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^^^^^^^^
 *                 name="value"   name="method"
 *                 value="/api"   value="RequestMethod.GET"
 */
export interface AnnotationArgument {
  /** 
   * Argument name (null for single-value annotations).
   * @example "value", "method", "roles", null (for @GetMapping("/api"))
   */
  name: string | null;
  
  /** 
   * Argument value as string representation.
   * @example "/users", "RequestMethod.GET", "ADMIN", "true"
   */
  value: string;
  
  /** 
   * Value type hint for semantic understanding.
   */
  valueType: AnnotationValueType;
  
  /**
   * For array values, the individual elements.
   * @example ["ADMIN", "USER"] for roles = {"ADMIN", "USER"}
   */
  arrayElements?: string[];
}

/**
 * Target of an annotation - what element it's applied to.
 */
export type AnnotationTarget =
  | 'class'
  | 'interface'
  | 'enum'
  | 'record'
  | 'method'
  | 'constructor'
  | 'field'
  | 'parameter'
  | 'local_variable'
  | 'annotation_type';

/**
 * Annotation usage information.
 * 
 * This is THE KEY TYPE for Spring pattern detection.
 * Annotations drive everything in Spring: DI, security, web, data, etc.
 * 
 * @example
 * @GetMapping("/users/{id}")
 * @PreAuthorize("hasRole('ADMIN')")
 * @Transactional(readOnly = true, propagation = Propagation.REQUIRED)
 */
export interface AnnotationUsage {
  /** 
   * Simple annotation name without @ symbol.
   * @example "GetMapping", "Service", "Transactional"
   */
  name: string;
  
  /** 
   * Fully qualified name if resolvable from imports.
   * @example "org.springframework.web.bind.annotation.GetMapping"
   */
  fullName: string | null;
  
  /** 
   * Annotation arguments (empty for marker annotations).
   */
  arguments: AnnotationArgument[];
  
  /** 
   * What element this annotation is applied to.
   */
  target: AnnotationTarget;
  
  /** Start position in source */
  startPosition: Position;
  /** End position in source */
  endPosition: Position;
}

// ============================================
// Method and Parameter Types
// ============================================

/**
 * Method parameter information.
 * 
 * @example
 * public User getUser(@PathVariable Long id, @RequestBody UserDto dto)
 *                     ^^^^^^^^^^^^^^^^^^     ^^^^^^^^^^^^^^^^^^^^
 */
export interface JavaParameterInfo {
  /** Parameter name */
  name: string;
  
  /** Parameter type as string (e.g., "Long", "List<String>") */
  type: string;
  
  /** 
   * Annotations on the parameter.
   * Critical for @PathVariable, @RequestBody, @RequestParam, etc.
   */
  annotations: AnnotationUsage[];
  
  /** Whether this is a varargs parameter (String... args) */
  isVarargs: boolean;
  
  /** Whether this parameter has the final modifier */
  isFinal: boolean;
}

/**
 * Method information.
 * 
 * @example
 * @GetMapping("/users/{id}")
 * @PreAuthorize("hasRole('USER')")
 * public ResponseEntity<UserDto> getUser(@PathVariable Long id) throws NotFoundException {
 *     ...
 * }
 */
export interface JavaMethodInfo {
  /** Method name */
  name: string;
  
  /** 
   * Annotations on the method.
   * Critical for @GetMapping, @Transactional, @PreAuthorize, etc.
   */
  annotations: AnnotationUsage[];
  
  /** Return type as string (e.g., "ResponseEntity<UserDto>", "void") */
  returnType: string;
  
  /** Method parameters with their annotations */
  parameters: JavaParameterInfo[];
  
  /** Modifiers (public, static, final, etc.) */
  modifiers: JavaModifier[];
  
  /** Generic type parameters (e.g., ["T", "U"] for <T, U>) */
  typeParameters: string[];
  
  /** Exception types in throws clause */
  throwsTypes: string[];
  
  /** Accessibility level derived from modifiers */
  accessibility: JavaAccessibility;
  
  /** Whether method is static */
  isStatic: boolean;
  
  /** Whether method is abstract */
  isAbstract: boolean;
  
  /** Whether method is final */
  isFinal: boolean;
  
  /** Whether method is synchronized */
  isSynchronized: boolean;
  
  /** Whether method is native */
  isNative: boolean;
  
  /** Whether method is a default interface method */
  isDefault: boolean;
  
  /** Start position in source */
  startPosition: Position;
  /** End position in source */
  endPosition: Position;
}

/**
 * Constructor information.
 * 
 * @example
 * @Autowired
 * public UserService(UserRepository userRepo, EmailService emailService) {
 *     this.userRepo = userRepo;
 *     this.emailService = emailService;
 * }
 */
export interface JavaConstructorInfo {
  /** Annotations on the constructor (e.g., @Autowired) */
  annotations: AnnotationUsage[];
  
  /** Constructor parameters */
  parameters: JavaParameterInfo[];
  
  /** Modifiers (public, private, protected) */
  modifiers: JavaModifier[];
  
  /** Exception types in throws clause */
  throwsTypes: string[];
  
  /** Accessibility level */
  accessibility: JavaAccessibility;
  
  /** Start position in source */
  startPosition: Position;
  /** End position in source */
  endPosition: Position;
}

// ============================================
// Field Types
// ============================================

/**
 * Field information.
 * 
 * @example
 * @Autowired
 * private UserRepository userRepository;
 * 
 * @Value("${app.name}")
 * private String appName;
 */
export interface JavaFieldInfo {
  /** Field name */
  name: string;
  
  /** Field type as string */
  type: string;
  
  /** 
   * Annotations on the field.
   * Critical for @Autowired, @Value, @Id, @Column, etc.
   */
  annotations: AnnotationUsage[];
  
  /** Modifiers (private, static, final, etc.) */
  modifiers: JavaModifier[];
  
  /** Initial value if present (as string) */
  initializer: string | null;
  
  /** Accessibility level */
  accessibility: JavaAccessibility;
  
  /** Whether field is static */
  isStatic: boolean;
  
  /** Whether field is final */
  isFinal: boolean;
  
  /** Whether field is volatile */
  isVolatile: boolean;
  
  /** Whether field is transient */
  isTransient: boolean;
  
  /** Start position in source */
  startPosition: Position;
  /** End position in source */
  endPosition: Position;
}

// ============================================
// Class Types
// ============================================

/**
 * Class information.
 * 
 * @example
 * @Service
 * @Transactional
 * public class UserService implements IUserService {
 *     ...
 * }
 */
export interface JavaClassInfo {
  /** Class name */
  name: string;
  
  /** Containing package (null if in default package) */
  packageName: string | null;
  
  /** 
   * Annotations on the class.
   * Critical for @Service, @Controller, @Entity, @Configuration, etc.
   */
  annotations: AnnotationUsage[];
  
  /** Modifiers (public, abstract, final, etc.) */
  modifiers: JavaModifier[];
  
  /** Superclass name if extends another class */
  superclass: string | null;
  
  /** Implemented interface names */
  interfaces: string[];
  
  /** Generic type parameters */
  typeParameters: string[];
  
  /** Permitted subclasses for sealed classes (Java 17+) */
  permittedSubclasses: string[];
  
  /** Fields declared in the class */
  fields: JavaFieldInfo[];
  
  /** Methods declared in the class */
  methods: JavaMethodInfo[];
  
  /** Constructors declared in the class */
  constructors: JavaConstructorInfo[];
  
  /** Nested/inner class names */
  innerClasses: string[];
  
  /** Accessibility level */
  accessibility: JavaAccessibility;
  
  /** Whether class is abstract */
  isAbstract: boolean;
  
  /** Whether class is final */
  isFinal: boolean;
  
  /** Whether class is static (for inner classes) */
  isStatic: boolean;
  
  /** Whether class is sealed (Java 17+) */
  isSealed: boolean;
  
  /** Whether class is non-sealed (Java 17+) */
  isNonSealed: boolean;
  
  /** Start position in source */
  startPosition: Position;
  /** End position in source */
  endPosition: Position;
}

// ============================================
// Interface Types
// ============================================

/**
 * Interface information.
 * 
 * @example
 * @Repository
 * public interface UserRepository extends JpaRepository<User, Long> {
 *     @Query("SELECT u FROM User u WHERE u.email = :email")
 *     Optional<User> findByEmail(@Param("email") String email);
 * }
 */
export interface JavaInterfaceInfo {
  /** Interface name */
  name: string;
  
  /** Containing package */
  packageName: string | null;
  
  /** Annotations on the interface */
  annotations: AnnotationUsage[];
  
  /** Modifiers */
  modifiers: JavaModifier[];
  
  /** Extended interface names */
  extendsInterfaces: string[];
  
  /** Generic type parameters */
  typeParameters: string[];
  
  /** Permitted subclasses for sealed interfaces (Java 17+) */
  permittedSubclasses: string[];
  
  /** Method signatures (including default methods) */
  methods: JavaMethodInfo[];
  
  /** Constant fields (implicitly public static final) */
  fields: JavaFieldInfo[];
  
  /** Accessibility level */
  accessibility: JavaAccessibility;
  
  /** Whether interface is sealed (Java 17+) */
  isSealed: boolean;
  
  /** Whether interface is non-sealed (Java 17+) */
  isNonSealed: boolean;
  
  /** Start position in source */
  startPosition: Position;
  /** End position in source */
  endPosition: Position;
}

// ============================================
// Enum Types
// ============================================

/**
 * Enum constant information.
 */
export interface JavaEnumConstant {
  /** Constant name */
  name: string;
  
  /** Annotations on the constant */
  annotations: AnnotationUsage[];
  
  /** Constructor arguments if any */
  arguments: string[];
  
  /** Start position in source */
  startPosition: Position;
  /** End position in source */
  endPosition: Position;
}

/**
 * Enum information.
 * 
 * @example
 * public enum OrderStatus {
 *     PENDING("Pending"),
 *     COMPLETED("Completed"),
 *     CANCELLED("Cancelled");
 *     
 *     private final String displayName;
 *     OrderStatus(String displayName) { this.displayName = displayName; }
 * }
 */
export interface JavaEnumInfo {
  /** Enum name */
  name: string;
  
  /** Containing package */
  packageName: string | null;
  
  /** Annotations on the enum */
  annotations: AnnotationUsage[];
  
  /** Modifiers */
  modifiers: JavaModifier[];
  
  /** Implemented interface names */
  interfaces: string[];
  
  /** Enum constants */
  constants: JavaEnumConstant[];
  
  /** Fields declared in the enum */
  fields: JavaFieldInfo[];
  
  /** Methods declared in the enum */
  methods: JavaMethodInfo[];
  
  /** Constructors declared in the enum */
  constructors: JavaConstructorInfo[];
  
  /** Accessibility level */
  accessibility: JavaAccessibility;
  
  /** Start position in source */
  startPosition: Position;
  /** End position in source */
  endPosition: Position;
}

// ============================================
// Record Types (Java 16+)
// ============================================

/**
 * Record component information (the parameters in record declaration).
 * 
 * @example
 * public record UserDto(Long id, String name, @Email String email) {}
 *                       ^^^^^^  ^^^^^^^^^^^  ^^^^^^^^^^^^^^^^^^^^
 */
export interface JavaRecordComponent {
  /** Component name */
  name: string;
  
  /** Component type */
  type: string;
  
  /** Annotations on the component */
  annotations: AnnotationUsage[];
}

/**
 * Record information (Java 16+).
 * 
 * @example
 * @JsonSerialize
 * public record UserDto(
 *     Long id,
 *     @NotBlank String name,
 *     @Email String email
 * ) implements Serializable {
 *     // Compact constructor
 *     public UserDto {
 *         Objects.requireNonNull(name);
 *     }
 * }
 */
export interface JavaRecordInfo {
  /** Record name */
  name: string;
  
  /** Containing package */
  packageName: string | null;
  
  /** Annotations on the record */
  annotations: AnnotationUsage[];
  
  /** Modifiers */
  modifiers: JavaModifier[];
  
  /** Record components (the primary constructor parameters) */
  components: JavaRecordComponent[];
  
  /** Implemented interface names */
  interfaces: string[];
  
  /** Generic type parameters */
  typeParameters: string[];
  
  /** Additional methods (beyond auto-generated ones) */
  methods: JavaMethodInfo[];
  
  /** Additional constructors (compact or canonical) */
  constructors: JavaConstructorInfo[];
  
  /** Accessibility level */
  accessibility: JavaAccessibility;
  
  /** Start position in source */
  startPosition: Position;
  /** End position in source */
  endPosition: Position;
}

// ============================================
// Annotation Definition Types
// ============================================

/**
 * Annotation element (method in annotation type).
 */
export interface AnnotationElement {
  /** Element name */
  name: string;
  
  /** Element type */
  type: string;
  
  /** Default value if specified */
  defaultValue: string | null;
}

/**
 * Annotation type definition (@interface).
 * 
 * @example
 * @Retention(RetentionPolicy.RUNTIME)
 * @Target(ElementType.METHOD)
 * public @interface Cacheable {
 *     String value() default "";
 *     String key() default "";
 * }
 */
export interface AnnotationDefinition {
  /** Annotation type name */
  name: string;
  
  /** Containing package */
  packageName: string | null;
  
  /** Meta-annotations on this annotation type */
  annotations: AnnotationUsage[];
  
  /** Annotation elements (methods) */
  elements: AnnotationElement[];
  
  /** Accessibility level */
  accessibility: JavaAccessibility;
  
  /** Start position in source */
  startPosition: Position;
  /** End position in source */
  endPosition: Position;
}

// ============================================
// Parse Result
// ============================================

/**
 * Extended parse result with Java-specific semantic information.
 * 
 * This is the main output of the Java parser, containing all
 * extracted semantic information needed for pattern detection.
 */
export interface JavaParseResult extends ParseResult {
  /** Package declaration (null if default package) */
  package: PackageInfo | null;
  
  /** Import statements */
  imports: JavaImportInfo[];
  
  /** Class declarations */
  classes: JavaClassInfo[];
  
  /** Interface declarations */
  interfaces: JavaInterfaceInfo[];
  
  /** Enum declarations */
  enums: JavaEnumInfo[];
  
  /** Record declarations (Java 16+) */
  records: JavaRecordInfo[];
  
  /** Annotation type definitions (@interface) */
  annotationDefinitions: AnnotationDefinition[];
}

// ============================================
// Utility Types
// ============================================

/**
 * Options for annotation extraction.
 */
export interface AnnotationExtractionOptions {
  /** Whether to resolve full annotation names from imports */
  resolveFullNames: boolean;
  
  /** Whether to parse array values into individual elements */
  parseArrayElements: boolean;
}

/**
 * Default annotation extraction options.
 */
export const DEFAULT_ANNOTATION_OPTIONS: AnnotationExtractionOptions = {
  resolveFullNames: true,
  parseArrayElements: true,
};

/**
 * Map of simple annotation names to their common full qualified names.
 * Used for resolution when imports are not available.
 */
export const COMMON_SPRING_ANNOTATIONS: Record<string, string> = {
  // Stereotype annotations
  'Component': 'org.springframework.stereotype.Component',
  'Service': 'org.springframework.stereotype.Service',
  'Repository': 'org.springframework.stereotype.Repository',
  'Controller': 'org.springframework.stereotype.Controller',
  'RestController': 'org.springframework.web.bind.annotation.RestController',
  'Configuration': 'org.springframework.context.annotation.Configuration',
  
  // Web annotations
  'RequestMapping': 'org.springframework.web.bind.annotation.RequestMapping',
  'GetMapping': 'org.springframework.web.bind.annotation.GetMapping',
  'PostMapping': 'org.springframework.web.bind.annotation.PostMapping',
  'PutMapping': 'org.springframework.web.bind.annotation.PutMapping',
  'DeleteMapping': 'org.springframework.web.bind.annotation.DeleteMapping',
  'PatchMapping': 'org.springframework.web.bind.annotation.PatchMapping',
  'PathVariable': 'org.springframework.web.bind.annotation.PathVariable',
  'RequestParam': 'org.springframework.web.bind.annotation.RequestParam',
  'RequestBody': 'org.springframework.web.bind.annotation.RequestBody',
  'ResponseBody': 'org.springframework.web.bind.annotation.ResponseBody',
  
  // DI annotations
  'Autowired': 'org.springframework.beans.factory.annotation.Autowired',
  'Qualifier': 'org.springframework.beans.factory.annotation.Qualifier',
  'Value': 'org.springframework.beans.factory.annotation.Value',
  'Bean': 'org.springframework.context.annotation.Bean',
  
  // Security annotations
  'PreAuthorize': 'org.springframework.security.access.prepost.PreAuthorize',
  'PostAuthorize': 'org.springframework.security.access.prepost.PostAuthorize',
  'Secured': 'org.springframework.security.access.annotation.Secured',
  
  // Data annotations
  'Transactional': 'org.springframework.transaction.annotation.Transactional',
  'Query': 'org.springframework.data.jpa.repository.Query',
  'Param': 'org.springframework.data.repository.query.Param',
  
  // JPA annotations
  'Entity': 'jakarta.persistence.Entity',
  'Table': 'jakarta.persistence.Table',
  'Id': 'jakarta.persistence.Id',
  'Column': 'jakarta.persistence.Column',
  'GeneratedValue': 'jakarta.persistence.GeneratedValue',
  'ManyToOne': 'jakarta.persistence.ManyToOne',
  'OneToMany': 'jakarta.persistence.OneToMany',
  'ManyToMany': 'jakarta.persistence.ManyToMany',
  'OneToOne': 'jakarta.persistence.OneToOne',
  'JoinColumn': 'jakarta.persistence.JoinColumn',
  
  // Validation annotations
  'Valid': 'jakarta.validation.Valid',
  'NotNull': 'jakarta.validation.constraints.NotNull',
  'NotBlank': 'jakarta.validation.constraints.NotBlank',
  'NotEmpty': 'jakarta.validation.constraints.NotEmpty',
  'Size': 'jakarta.validation.constraints.Size',
  'Email': 'jakarta.validation.constraints.Email',
  'Min': 'jakarta.validation.constraints.Min',
  'Max': 'jakarta.validation.constraints.Max',
  'Pattern': 'jakarta.validation.constraints.Pattern',
  
  // Test annotations
  'Test': 'org.junit.jupiter.api.Test',
  'SpringBootTest': 'org.springframework.boot.test.context.SpringBootTest',
  'MockBean': 'org.springframework.boot.test.mock.mockito.MockBean',
  'WebMvcTest': 'org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest',
  'DataJpaTest': 'org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest',
};
