/**
 * Java Annotation Extractor
 *
 * Extracts annotation information from Java AST nodes.
 * Annotations are FIRST-CLASS CITIZENS in Spring - they drive
 * DI, security, web, data, and virtually everything else.
 *
 * Handles:
 * - Marker annotations: @Service
 * - Single-value annotations: @RequestMapping("/api")
 * - Named argument annotations: @Transactional(readOnly = true)
 * - Array value annotations: @Secured({"ADMIN", "USER"})
 * - Nested annotations: @Caching(@Cacheable(...), @CacheEvict(...))
 *
 * @requirements Java/Spring Boot Language Support
 */

import { DEFAULT_ANNOTATION_OPTIONS, COMMON_SPRING_ANNOTATIONS } from './types.js';

import type { Position } from '../../types.js';
import type { TreeSitterNode } from '../types.js';
import type {
  AnnotationUsage,
  AnnotationArgument,
  AnnotationTarget,
  AnnotationValueType,
  AnnotationExtractionOptions,
  JavaImportInfo,
} from './types.js';

// ============================================
// Position Helpers
// ============================================

/**
 * Convert tree-sitter position to drift Position.
 */
function toPosition(point: { row: number; column: number }): Position {
  return {
    row: point.row,
    column: point.column,
  };
}

// ============================================
// Annotation Extraction
// ============================================

/**
 * Extract all annotations from a node and its preceding siblings.
 * 
 * In Java, annotations appear before the element they annotate,
 * either as siblings or as children of the parent node.
 * 
 * @param node - The AST node to extract annotations from
 * @param target - What type of element these annotations are on
 * @param imports - Import statements for resolving full names
 * @param options - Extraction options
 * @returns Array of extracted annotations
 */
export function extractAnnotations(
  node: TreeSitterNode,
  target: AnnotationTarget,
  imports: JavaImportInfo[] = [],
  options: AnnotationExtractionOptions = DEFAULT_ANNOTATION_OPTIONS
): AnnotationUsage[] {
  const annotations: AnnotationUsage[] = [];
  
  // Look for annotations in different places depending on node type
  // 1. Direct children named 'modifiers' that contain annotations
  // 2. Sibling nodes that are annotations
  // 3. Children that are annotation nodes
  
  // Check for modifiers node (common pattern in tree-sitter-java)
  const modifiersNode = findChildByType(node, 'modifiers');
  if (modifiersNode) {
    for (const child of modifiersNode.children) {
      if (isAnnotationNode(child)) {
        const annotation = parseAnnotationNode(child, target, imports, options);
        if (annotation) {
          annotations.push(annotation);
        }
      }
    }
  }
  
  // Check direct children for annotations
  for (const child of node.children) {
    if (isAnnotationNode(child)) {
      const annotation = parseAnnotationNode(child, target, imports, options);
      if (annotation) {
        annotations.push(annotation);
      }
    }
  }
  
  // Check preceding siblings for annotations
  let sibling = node.previousNamedSibling;
  while (sibling && isAnnotationNode(sibling)) {
    const annotation = parseAnnotationNode(sibling, target, imports, options);
    if (annotation) {
      // Prepend since we're going backwards
      annotations.unshift(annotation);
    }
    sibling = sibling.previousNamedSibling;
  }
  
  return annotations;
}

/**
 * Extract annotations specifically for a parameter node.
 * Parameters have a different structure in the AST.
 */
export function extractParameterAnnotations(
  paramNode: TreeSitterNode,
  imports: JavaImportInfo[] = [],
  options: AnnotationExtractionOptions = DEFAULT_ANNOTATION_OPTIONS
): AnnotationUsage[] {
  const annotations: AnnotationUsage[] = [];
  
  // In tree-sitter-java, parameter annotations are direct children
  for (const child of paramNode.children) {
    if (isAnnotationNode(child)) {
      const annotation = parseAnnotationNode(child, 'parameter', imports, options);
      if (annotation) {
        annotations.push(annotation);
      }
    }
  }
  
  return annotations;
}

/**
 * Check if a node is an annotation node.
 */
function isAnnotationNode(node: TreeSitterNode): boolean {
  return (
    node.type === 'annotation' ||
    node.type === 'marker_annotation' ||
    node.type === 'single_element_annotation' ||
    node.type === 'normal_annotation'
  );
}

/**
 * Parse a single annotation node into AnnotationUsage.
 */
function parseAnnotationNode(
  node: TreeSitterNode,
  target: AnnotationTarget,
  imports: JavaImportInfo[],
  options: AnnotationExtractionOptions
): AnnotationUsage | null {
  // Get annotation name
  const nameNode = findAnnotationName(node);
  if (!nameNode) {
    return null;
  }
  
  const name = extractAnnotationName(nameNode);
  if (!name) {
    return null;
  }
  
  // Parse arguments
  const args = parseAnnotationArguments(node, options);
  
  // Resolve full name
  const fullName = options.resolveFullNames
    ? resolveAnnotationFullName(name, imports)
    : null;
  
  return {
    name,
    fullName,
    arguments: args,
    target,
    startPosition: toPosition(node.startPosition),
    endPosition: toPosition(node.endPosition),
  };
}

/**
 * Find the name node within an annotation.
 */
function findAnnotationName(node: TreeSitterNode): TreeSitterNode | null {
  // The name can be an identifier or a scoped_identifier (qualified name)
  for (const child of node.children) {
    if (child.type === 'identifier' || child.type === 'scoped_identifier') {
      return child;
    }
  }
  
  // Also check childForFieldName if available
  const nameField = node.childForFieldName?.('name');
  if (nameField) {
    return nameField;
  }
  
  return null;
}

/**
 * Extract the annotation name from a name node.
 * Handles both simple names and qualified names.
 */
function extractAnnotationName(nameNode: TreeSitterNode): string {
  if (nameNode.type === 'identifier') {
    return nameNode.text;
  }
  
  if (nameNode.type === 'scoped_identifier') {
    // For qualified names like org.springframework.Service,
    // we want just the simple name (Service)
    const parts = nameNode.text.split('.');
    return parts[parts.length - 1] ?? nameNode.text;
  }
  
  return nameNode.text;
}

// ============================================
// Argument Parsing
// ============================================

/**
 * Parse annotation arguments from an annotation node.
 */
function parseAnnotationArguments(
  node: TreeSitterNode,
  options: AnnotationExtractionOptions
): AnnotationArgument[] {
  const args: AnnotationArgument[] = [];
  
  // Find the argument list node
  const argListNode = findChildByType(node, 'annotation_argument_list');
  if (!argListNode) {
    // Check for single element annotation value
    // @GetMapping("/api") - the "/api" is a direct child
    for (const child of node.children) {
      if (isValueNode(child)) {
        args.push(parseArgumentValue(null, child, options));
        break;
      }
    }
    return args;
  }
  
  // Parse each argument in the list
  for (const child of argListNode.children) {
    if (child.type === 'element_value_pair') {
      // Named argument: name = value
      const arg = parseElementValuePair(child, options);
      if (arg) {
        args.push(arg);
      }
    } else if (isValueNode(child)) {
      // Single value argument (no name)
      args.push(parseArgumentValue(null, child, options));
    }
  }
  
  return args;
}

/**
 * Parse a named element-value pair.
 * @example readOnly = true, value = "/api"
 */
function parseElementValuePair(
  node: TreeSitterNode,
  options: AnnotationExtractionOptions
): AnnotationArgument | null {
  let name: string | null = null;
  let valueNode: TreeSitterNode | null = null;
  
  for (const child of node.children) {
    if (child.type === 'identifier') {
      name = child.text;
    } else if (isValueNode(child)) {
      valueNode = child;
    }
  }
  
  if (!valueNode) {
    return null;
  }
  
  return parseArgumentValue(name, valueNode, options);
}

/**
 * Parse an argument value node into AnnotationArgument.
 */
function parseArgumentValue(
  name: string | null,
  valueNode: TreeSitterNode,
  options: AnnotationExtractionOptions
): AnnotationArgument {
  const { value, valueType, arrayElements } = extractValue(valueNode, options);
  
  const arg: AnnotationArgument = {
    name,
    value,
    valueType,
  };
  
  if (arrayElements && arrayElements.length > 0) {
    arg.arrayElements = arrayElements;
  }
  
  return arg;
}

/**
 * Extract the value and type from a value node.
 */
function extractValue(
  node: TreeSitterNode,
  options: AnnotationExtractionOptions
): { value: string; valueType: AnnotationValueType; arrayElements?: string[] } {
  const text = node.text;
  
  switch (node.type) {
    case 'string_literal':
    case 'string':
      // Remove quotes from string literals
      return {
        value: text.replace(/^["']|["']$/g, ''),
        valueType: 'string',
      };
    
    case 'decimal_integer_literal':
    case 'hex_integer_literal':
    case 'octal_integer_literal':
    case 'binary_integer_literal':
    case 'decimal_floating_point_literal':
    case 'hex_floating_point_literal':
    case 'integer_literal':
    case 'floating_point_literal':
    case 'number':
      return {
        value: text,
        valueType: 'number',
      };
    
    case 'true':
    case 'false':
    case 'boolean':
      return {
        value: text,
        valueType: 'boolean',
      };
    
    case 'class_literal':
      // SomeClass.class
      return {
        value: text.replace(/\.class$/, ''),
        valueType: 'class',
      };
    
    case 'array_initializer':
    case 'element_value_array_initializer':
      // { "value1", "value2" }
      const elements = options.parseArrayElements
        ? extractArrayElements(node)
        : [];
      return {
        value: text,
        valueType: 'array',
        arrayElements: elements,
      };
    
    case 'annotation':
    case 'marker_annotation':
    case 'single_element_annotation':
    case 'normal_annotation':
      // Nested annotation
      return {
        value: text,
        valueType: 'annotation',
      };
    
    case 'field_access':
    case 'scoped_identifier':
      // Enum value like RequestMethod.GET or Propagation.REQUIRED
      return {
        value: text,
        valueType: 'enum',
      };
    
    case 'identifier':
      // Could be an enum constant or a reference
      // If it's all caps, likely an enum
      if (text === text.toUpperCase() && text.length > 1) {
        return {
          value: text,
          valueType: 'enum',
        };
      }
      return {
        value: text,
        valueType: 'string',
      };
    
    default:
      // Default to string for unknown types
      return {
        value: text,
        valueType: 'string',
      };
  }
}

/**
 * Extract individual elements from an array initializer.
 */
function extractArrayElements(node: TreeSitterNode): string[] {
  const elements: string[] = [];
  
  for (const child of node.children) {
    if (isValueNode(child)) {
      const { value } = extractValue(child, { resolveFullNames: false, parseArrayElements: false });
      elements.push(value);
    }
  }
  
  return elements;
}

/**
 * Check if a node is a value node (can be an annotation argument value).
 */
function isValueNode(node: TreeSitterNode): boolean {
  const valueTypes = [
    'string_literal',
    'string',
    'decimal_integer_literal',
    'hex_integer_literal',
    'octal_integer_literal',
    'binary_integer_literal',
    'decimal_floating_point_literal',
    'hex_floating_point_literal',
    'integer_literal',
    'floating_point_literal',
    'number',
    'true',
    'false',
    'boolean',
    'class_literal',
    'array_initializer',
    'element_value_array_initializer',
    'annotation',
    'marker_annotation',
    'single_element_annotation',
    'normal_annotation',
    'field_access',
    'scoped_identifier',
    'identifier',
  ];
  
  return valueTypes.includes(node.type);
}

// ============================================
// Name Resolution
// ============================================

/**
 * Resolve the fully qualified name of an annotation.
 * 
 * @param simpleName - The simple annotation name (e.g., "GetMapping")
 * @param imports - Import statements from the file
 * @returns The fully qualified name or null if not resolvable
 */
export function resolveAnnotationFullName(
  simpleName: string,
  imports: JavaImportInfo[]
): string | null {
  // First, check explicit imports
  for (const imp of imports) {
    if (imp.isWildcard) {
      // Can't resolve from wildcard imports without more context
      continue;
    }
    
    // Check if this import matches the annotation name
    const importedName = imp.path.split('.').pop();
    if (importedName === simpleName) {
      return imp.path;
    }
  }
  
  // Check common Spring annotations
  if (simpleName in COMMON_SPRING_ANNOTATIONS) {
    return COMMON_SPRING_ANNOTATIONS[simpleName] ?? null;
  }
  
  // Check if any wildcard import could match
  // We can't be certain, but we can make educated guesses
  for (const imp of imports) {
    if (imp.isWildcard) {
      const packagePath = imp.path.replace('.*', '');
      
      // Common Spring packages
      if (packagePath.includes('springframework')) {
        // Check if this is a known Spring annotation
        // const possibleFullName = `${packagePath}.${simpleName}`;
        // We could validate this against a known list
        // For now, return null for wildcards
      }
    }
  }
  
  return null;
}

/**
 * Build an import map for faster lookups.
 */
export function buildImportMap(imports: JavaImportInfo[]): Map<string, string> {
  const map = new Map<string, string>();
  
  for (const imp of imports) {
    if (!imp.isWildcard) {
      const simpleName = imp.path.split('.').pop();
      if (simpleName) {
        map.set(simpleName, imp.path);
      }
    }
  }
  
  return map;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Find a child node by type.
 */
function findChildByType(node: TreeSitterNode, type: string): TreeSitterNode | null {
  for (const child of node.children) {
    if (child.type === type) {
      return child;
    }
  }
  return null;
}

/**
 * Find all children of a specific type.
 */
export function findChildrenByType(node: TreeSitterNode, type: string): TreeSitterNode[] {
  const results: TreeSitterNode[] = [];
  for (const child of node.children) {
    if (child.type === type) {
      results.push(child);
    }
  }
  return results;
}

/**
 * Check if an annotation has a specific argument.
 */
export function hasAnnotationArgument(
  annotation: AnnotationUsage,
  argumentName: string
): boolean {
  return annotation.arguments.some(arg => arg.name === argumentName);
}

/**
 * Get an annotation argument value by name.
 */
export function getAnnotationArgument(
  annotation: AnnotationUsage,
  argumentName: string
): AnnotationArgument | undefined {
  return annotation.arguments.find(arg => arg.name === argumentName);
}

/**
 * Get the single/default value of an annotation.
 * This is the value when no argument name is specified.
 * @example @GetMapping("/api") -> "/api"
 */
export function getAnnotationValue(annotation: AnnotationUsage): string | undefined {
  // Look for argument with null name (single value)
  const singleValue = annotation.arguments.find(arg => arg.name === null);
  if (singleValue) {
    return singleValue.value;
  }
  
  // Also check for "value" named argument
  const valueArg = annotation.arguments.find(arg => arg.name === 'value');
  return valueArg?.value;
}

/**
 * Check if an annotation is a Spring web mapping annotation.
 */
export function isWebMappingAnnotation(annotation: AnnotationUsage): boolean {
  const webMappings = [
    'RequestMapping',
    'GetMapping',
    'PostMapping',
    'PutMapping',
    'DeleteMapping',
    'PatchMapping',
  ];
  return webMappings.includes(annotation.name);
}

/**
 * Check if an annotation is a Spring stereotype annotation.
 */
export function isStereotypeAnnotation(annotation: AnnotationUsage): boolean {
  const stereotypes = [
    'Component',
    'Service',
    'Repository',
    'Controller',
    'RestController',
    'Configuration',
  ];
  return stereotypes.includes(annotation.name);
}

/**
 * Check if an annotation is a validation annotation.
 */
export function isValidationAnnotation(annotation: AnnotationUsage): boolean {
  const validations = [
    'Valid',
    'Validated',
    'NotNull',
    'NotBlank',
    'NotEmpty',
    'Size',
    'Min',
    'Max',
    'Email',
    'Pattern',
    'Positive',
    'PositiveOrZero',
    'Negative',
    'NegativeOrZero',
    'Past',
    'PastOrPresent',
    'Future',
    'FutureOrPresent',
  ];
  return validations.includes(annotation.name);
}
