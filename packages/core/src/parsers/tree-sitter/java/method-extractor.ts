/**
 * Java Method Extractor
 *
 * Extracts method, constructor, and field declarations from Java AST.
 * Handles all member declarations with their annotations, modifiers,
 * parameters, and return types.
 *
 * @requirements Java/Spring Boot Language Support
 */

import { extractAnnotations, extractParameterAnnotations } from './annotation-extractor.js';

import type { Position } from '../../types.js';
import type { TreeSitterNode } from '../types.js';
import type {
  JavaMethodInfo,
  JavaConstructorInfo,
  JavaFieldInfo,
  JavaParameterInfo,
  JavaModifier,
  JavaAccessibility,
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
// Modifier Extraction
// ============================================

/**
 * Extract modifiers from a node.
 */
function extractModifiers(node: TreeSitterNode): JavaModifier[] {
  const modifiers: JavaModifier[] = [];
  
  // Look for modifiers node
  const modifiersNode = findChildByType(node, 'modifiers');
  if (modifiersNode) {
    for (const child of modifiersNode.children) {
      const modifier = parseModifier(child);
      if (modifier) {
        modifiers.push(modifier);
      }
    }
  }
  
  // Also check direct children for modifier keywords
  for (const child of node.children) {
    const modifier = parseModifier(child);
    if (modifier && !modifiers.includes(modifier)) {
      modifiers.push(modifier);
    }
  }
  
  return modifiers;
}

/**
 * Parse a single modifier from a node.
 */
function parseModifier(node: TreeSitterNode): JavaModifier | null {
  const modifierKeywords: JavaModifier[] = [
    'public', 'private', 'protected',
    'static', 'final', 'abstract',
    'synchronized', 'volatile', 'transient',
    'native', 'strictfp', 'default',
    'sealed', 'non-sealed',
  ];
  
  const text = node.text.toLowerCase();
  
  // Handle non-sealed which might be parsed differently
  if (text === 'non-sealed' || node.type === 'non_sealed') {
    return 'non-sealed';
  }
  
  if (modifierKeywords.includes(text as JavaModifier)) {
    return text as JavaModifier;
  }
  
  return null;
}

/**
 * Derive accessibility from modifiers.
 */
function deriveAccessibility(modifiers: JavaModifier[]): JavaAccessibility {
  if (modifiers.includes('public')) {return 'public';}
  if (modifiers.includes('private')) {return 'private';}
  if (modifiers.includes('protected')) {return 'protected';}
  return 'package-private';
}

// ============================================
// Method Extraction
// ============================================

/**
 * Extract a method declaration.
 * 
 * @example
 * @GetMapping("/users/{id}")
 * @PreAuthorize("hasRole('USER')")
 * public ResponseEntity<UserDto> getUser(@PathVariable Long id) throws NotFoundException {
 *     ...
 * }
 */
export function extractMethod(
  node: TreeSitterNode,
  imports: JavaImportInfo[]
): JavaMethodInfo | null {
  const modifiers = extractModifiers(node);
  const annotations = extractAnnotations(node, 'method', imports);
  
  // Get method name
  const nameNode = findChildByType(node, 'identifier');
  if (!nameNode) {
    return null;
  }
  const name = nameNode.text;
  
  // Get return type
  const returnType = extractReturnType(node);
  
  // Get type parameters
  const typeParams = extractTypeParameters(node);
  
  // Get parameters
  const parameters = extractParameters(node, imports);
  
  // Get throws clause
  const throwsTypes = extractThrowsTypes(node);
  
  return {
    name,
    annotations,
    returnType,
    parameters,
    modifiers,
    typeParameters: typeParams,
    throwsTypes,
    accessibility: deriveAccessibility(modifiers),
    isStatic: modifiers.includes('static'),
    isAbstract: modifiers.includes('abstract'),
    isFinal: modifiers.includes('final'),
    isSynchronized: modifiers.includes('synchronized'),
    isNative: modifiers.includes('native'),
    isDefault: modifiers.includes('default'),
    startPosition: toPosition(node.startPosition),
    endPosition: toPosition(node.endPosition),
  };
}

/**
 * Extract the return type from a method declaration.
 */
function extractReturnType(node: TreeSitterNode): string {
  // The return type is typically a type node before the method name
  // In tree-sitter-java, it might be in different positions
  
  // Try to find type nodes
  for (const child of node.children) {
    if (isTypeNode(child)) {
      return child.text;
    }
  }
  
  // Check for void_type specifically
  const voidNode = findChildByType(node, 'void_type');
  if (voidNode) {
    return 'void';
  }
  
  // Default to void if no return type found
  return 'void';
}

/**
 * Extract type parameters from a generic method.
 */
function extractTypeParameters(node: TreeSitterNode): string[] {
  const params: string[] = [];
  
  const typeParamsNode = findChildByType(node, 'type_parameters');
  if (typeParamsNode) {
    for (const child of typeParamsNode.children) {
      if (child.type === 'type_parameter') {
        const nameNode = findChildByType(child, 'identifier');
        if (nameNode) {
          // Include bounds if present
          const boundsNode = findChildByType(child, 'type_bound');
          if (boundsNode) {
            params.push(`${nameNode.text} ${boundsNode.text}`);
          } else {
            params.push(nameNode.text);
          }
        }
      }
    }
  }
  
  return params;
}

/**
 * Extract throws clause types.
 */
function extractThrowsTypes(node: TreeSitterNode): string[] {
  const types: string[] = [];
  
  const throwsNode = findChildByType(node, 'throws');
  if (throwsNode) {
    for (const child of throwsNode.children) {
      if (isTypeNode(child)) {
        types.push(child.text);
      }
    }
  }
  
  return types;
}

// ============================================
// Constructor Extraction
// ============================================

/**
 * Extract a constructor declaration.
 * 
 * @example
 * @Autowired
 * public UserService(UserRepository userRepo, EmailService emailService) {
 *     this.userRepo = userRepo;
 *     this.emailService = emailService;
 * }
 */
export function extractConstructor(
  node: TreeSitterNode,
  imports: JavaImportInfo[]
): JavaConstructorInfo | null {
  const modifiers = extractModifiers(node);
  const annotations = extractAnnotations(node, 'constructor', imports);
  
  // Get parameters
  const parameters = extractParameters(node, imports);
  
  // Get throws clause
  const throwsTypes = extractThrowsTypes(node);
  
  return {
    annotations,
    parameters,
    modifiers,
    throwsTypes,
    accessibility: deriveAccessibility(modifiers),
    startPosition: toPosition(node.startPosition),
    endPosition: toPosition(node.endPosition),
  };
}

// ============================================
// Parameter Extraction
// ============================================

/**
 * Extract parameters from a method or constructor.
 */
function extractParameters(
  node: TreeSitterNode,
  imports: JavaImportInfo[]
): JavaParameterInfo[] {
  const parameters: JavaParameterInfo[] = [];
  
  // Find the formal_parameters node
  const paramsNode = findChildByType(node, 'formal_parameters');
  if (!paramsNode) {
    return parameters;
  }
  
  for (const child of paramsNode.children) {
    if (child.type === 'formal_parameter' || child.type === 'spread_parameter') {
      const param = parseParameter(child, imports);
      if (param) {
        parameters.push(param);
      }
    }
  }
  
  return parameters;
}

/**
 * Parse a single parameter.
 * 
 * @example
 * @PathVariable Long id
 * @RequestBody @Valid UserDto dto
 * String... args
 */
function parseParameter(
  node: TreeSitterNode,
  imports: JavaImportInfo[]
): JavaParameterInfo | null {
  const annotations = extractParameterAnnotations(node, imports);
  
  let type = '';
  let name = '';
  let isVarargs = false;
  let isFinal = false;
  
  // Check for spread_parameter (varargs)
  if (node.type === 'spread_parameter') {
    isVarargs = true;
  }
  
  for (const child of node.children) {
    if (child.type === 'identifier') {
      // The last identifier is the parameter name
      name = child.text;
    } else if (isTypeNode(child)) {
      type = child.text;
    } else if (child.type === 'modifiers') {
      // Check for final modifier
      for (const modChild of child.children) {
        if (modChild.text === 'final') {
          isFinal = true;
        }
      }
    } else if (child.text === 'final') {
      isFinal = true;
    } else if (child.text === '...') {
      isVarargs = true;
    }
  }
  
  // Handle varargs type (remove ... from type if present)
  if (type.endsWith('...')) {
    type = type.slice(0, -3).trim();
    isVarargs = true;
  }
  
  if (!name) {
    return null;
  }
  
  return {
    name,
    type,
    annotations,
    isVarargs,
    isFinal,
  };
}

// ============================================
// Field Extraction
// ============================================

/**
 * Extract field declarations.
 * A single field_declaration can declare multiple fields.
 * 
 * @example
 * @Autowired
 * private UserRepository userRepository;
 * 
 * @Value("${app.name}")
 * private String appName;
 * 
 * private int x, y, z;  // Multiple fields
 */
export function extractField(
  node: TreeSitterNode,
  imports: JavaImportInfo[]
): JavaFieldInfo[] {
  const fields: JavaFieldInfo[] = [];
  const modifiers = extractModifiers(node);
  const annotations = extractAnnotations(node, 'field', imports);
  
  // Get the type
  let type = '';
  for (const child of node.children) {
    if (isTypeNode(child)) {
      type = child.text;
      break;
    }
  }
  
  // Find variable declarators (there can be multiple: int x, y, z;)
  for (const child of node.children) {
    if (child.type === 'variable_declarator') {
      const field = parseVariableDeclarator(
        child,
        type,
        modifiers,
        annotations,
        node.startPosition,
        node.endPosition
      );
      if (field) {
        fields.push(field);
      }
    }
  }
  
  return fields;
}

/**
 * Parse a variable declarator into a field.
 */
function parseVariableDeclarator(
  node: TreeSitterNode,
  type: string,
  modifiers: JavaModifier[],
  annotations: ReturnType<typeof extractAnnotations>,
  startPos: { row: number; column: number },
  endPos: { row: number; column: number }
): JavaFieldInfo | null {
  let name = '';
  let initializer: string | null = null;
  
  for (const child of node.children) {
    if (child.type === 'identifier') {
      name = child.text;
    } else if (child.type === '=') {
      // Skip the equals sign
      continue;
    } else if (name && child.type !== 'dimensions') {
      // Everything after the name (except dimensions) is the initializer
      initializer = child.text;
    } else if (child.type === 'dimensions') {
      // Array dimensions like [] should be added to the type
      type = type + child.text;
    }
  }
  
  if (!name) {
    return null;
  }
  
  return {
    name,
    type,
    annotations,
    modifiers,
    initializer,
    accessibility: deriveAccessibility(modifiers),
    isStatic: modifiers.includes('static'),
    isFinal: modifiers.includes('final'),
    isVolatile: modifiers.includes('volatile'),
    isTransient: modifiers.includes('transient'),
    startPosition: toPosition(startPos),
    endPosition: toPosition(endPos),
  };
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
 * Check if a node is a type node.
 */
function isTypeNode(node: TreeSitterNode): boolean {
  const typeNodeTypes = [
    'type_identifier',
    'generic_type',
    'scoped_type_identifier',
    'array_type',
    'integral_type',
    'floating_point_type',
    'boolean_type',
    'void_type',
    // Primitive types
    'int',
    'long',
    'short',
    'byte',
    'float',
    'double',
    'boolean',
    'char',
  ];
  
  // Also check if it's a primitive type keyword
  const primitiveTypes = ['int', 'long', 'short', 'byte', 'float', 'double', 'boolean', 'char', 'void'];
  if (primitiveTypes.includes(node.text)) {
    return true;
  }
  
  return typeNodeTypes.includes(node.type);
}

// ============================================
// Helper Functions for External Use
// ============================================

/**
 * Check if a method has a specific annotation.
 */
export function hasAnnotation(
  method: JavaMethodInfo | JavaConstructorInfo | JavaFieldInfo,
  annotationName: string
): boolean {
  return method.annotations.some(
    ann => ann.name === annotationName || ann.fullName?.endsWith(`.${annotationName}`)
  );
}

/**
 * Get a specific annotation from a method.
 */
export function getAnnotation(
  method: JavaMethodInfo | JavaConstructorInfo | JavaFieldInfo,
  annotationName: string
) {
  return method.annotations.find(
    ann => ann.name === annotationName || ann.fullName?.endsWith(`.${annotationName}`)
  );
}

/**
 * Check if a method is a Spring request handler.
 */
export function isRequestHandler(method: JavaMethodInfo): boolean {
  const mappingAnnotations = [
    'RequestMapping',
    'GetMapping',
    'PostMapping',
    'PutMapping',
    'DeleteMapping',
    'PatchMapping',
  ];
  
  return method.annotations.some(ann => mappingAnnotations.includes(ann.name));
}

/**
 * Check if a method is transactional.
 */
export function isTransactional(method: JavaMethodInfo): boolean {
  return hasAnnotation(method, 'Transactional');
}

/**
 * Check if a method has security annotations.
 */
export function hasSecurityAnnotation(method: JavaMethodInfo): boolean {
  const securityAnnotations = [
    'PreAuthorize',
    'PostAuthorize',
    'Secured',
    'RolesAllowed',
  ];
  
  return method.annotations.some(ann => securityAnnotations.includes(ann.name));
}

/**
 * Get the HTTP method from a request mapping annotation.
 */
export function getHttpMethod(method: JavaMethodInfo): string | null {
  for (const ann of method.annotations) {
    switch (ann.name) {
      case 'GetMapping':
        return 'GET';
      case 'PostMapping':
        return 'POST';
      case 'PutMapping':
        return 'PUT';
      case 'DeleteMapping':
        return 'DELETE';
      case 'PatchMapping':
        return 'PATCH';
      case 'RequestMapping':
        // Check for method argument
        const methodArg = ann.arguments.find(arg => arg.name === 'method');
        if (methodArg) {
          // Extract method from RequestMethod.GET, etc.
          const match = methodArg.value.match(/RequestMethod\.(\w+)/);
          if (match) {
            return match[1] ?? null;
          }
          return methodArg.value;
        }
        // Default to GET if no method specified
        return 'GET';
    }
  }
  
  return null;
}

/**
 * Get the request path from a method's mapping annotation.
 */
export function getRequestPath(method: JavaMethodInfo): string | null {
  for (const ann of method.annotations) {
    if ([
      'RequestMapping',
      'GetMapping',
      'PostMapping',
      'PutMapping',
      'DeleteMapping',
      'PatchMapping',
    ].includes(ann.name)) {
      // Check for value argument (or single value)
      const valueArg = ann.arguments.find(arg => arg.name === 'value' || arg.name === null);
      if (valueArg) {
        return valueArg.value;
      }
      
      // Check for path argument
      const pathArg = ann.arguments.find(arg => arg.name === 'path');
      if (pathArg) {
        return pathArg.value;
      }
    }
  }
  
  return null;
}

/**
 * Extract path variables from method parameters.
 */
export function getPathVariables(method: JavaMethodInfo): JavaParameterInfo[] {
  return method.parameters.filter(param =>
    param.annotations.some(ann => ann.name === 'PathVariable')
  );
}

/**
 * Extract request body parameter from method.
 */
export function getRequestBody(method: JavaMethodInfo): JavaParameterInfo | undefined {
  return method.parameters.find(param =>
    param.annotations.some(ann => ann.name === 'RequestBody')
  );
}

/**
 * Extract query parameters from method parameters.
 */
export function getQueryParameters(method: JavaMethodInfo): JavaParameterInfo[] {
  return method.parameters.filter(param =>
    param.annotations.some(ann => ann.name === 'RequestParam')
  );
}
