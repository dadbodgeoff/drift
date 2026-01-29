/**
 * Java Class Extractor
 *
 * Extracts class, interface, enum, and record declarations from Java AST.
 * Handles all Java type declarations with their annotations, modifiers,
 * inheritance, and members.
 *
 * @requirements Java/Spring Boot Language Support
 */

import { extractAnnotations, extractParameterAnnotations } from './annotation-extractor.js';
import { extractMethod, extractConstructor, extractField } from './method-extractor.js';

import type { Position } from '../../types.js';
import type { TreeSitterNode } from '../types.js';
import type {
  JavaClassInfo,
  JavaInterfaceInfo,
  JavaEnumInfo,
  JavaEnumConstant,
  JavaRecordInfo,
  JavaRecordComponent,
  JavaFieldInfo,
  JavaMethodInfo,
  JavaConstructorInfo,
  JavaModifier,
  JavaAccessibility,
  JavaImportInfo,
  AnnotationDefinition,
  AnnotationElement,
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
export function extractModifiers(node: TreeSitterNode): JavaModifier[] {
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
export function deriveAccessibility(modifiers: JavaModifier[]): JavaAccessibility {
  if (modifiers.includes('public')) {return 'public';}
  if (modifiers.includes('private')) {return 'private';}
  if (modifiers.includes('protected')) {return 'protected';}
  return 'package-private';
}

// ============================================
// Class Extraction
// ============================================

/**
 * Extract all class declarations from the AST.
 */
export function extractClasses(
  root: TreeSitterNode,
  packageName: string | null,
  imports: JavaImportInfo[]
): JavaClassInfo[] {
  const classes: JavaClassInfo[] = [];
  
  findNodesOfType(root, 'class_declaration', (node) => {
    const classInfo = parseClassDeclaration(node, packageName, imports);
    if (classInfo) {
      classes.push(classInfo);
    }
  });
  
  return classes;
}

/**
 * Parse a class declaration node.
 */
function parseClassDeclaration(
  node: TreeSitterNode,
  packageName: string | null,
  imports: JavaImportInfo[]
): JavaClassInfo | null {
  const modifiers = extractModifiers(node);
  const annotations = extractAnnotations(node, 'class', imports);
  
  // Get class name
  const nameNode = findChildByType(node, 'identifier');
  if (!nameNode) {
    return null;
  }
  const name = nameNode.text;
  
  // Get type parameters
  const typeParams = extractTypeParameters(node);
  
  // Get superclass and interfaces
  const { superclass, interfaces } = extractInheritance(node);
  
  // Get permitted subclasses (for sealed classes)
  const permittedSubclasses = extractPermittedSubclasses(node);
  
  // Get class body
  const bodyNode = findChildByType(node, 'class_body');
  const { fields, methods, constructors, innerClasses } = bodyNode
    ? extractClassMembers(bodyNode, imports)
    : { fields: [], methods: [], constructors: [], innerClasses: [] };
  
  return {
    name,
    packageName,
    annotations,
    modifiers,
    superclass,
    interfaces,
    typeParameters: typeParams,
    permittedSubclasses,
    fields,
    methods,
    constructors,
    innerClasses,
    accessibility: deriveAccessibility(modifiers),
    isAbstract: modifiers.includes('abstract'),
    isFinal: modifiers.includes('final'),
    isStatic: modifiers.includes('static'),
    isSealed: modifiers.includes('sealed'),
    isNonSealed: modifiers.includes('non-sealed'),
    startPosition: toPosition(node.startPosition),
    endPosition: toPosition(node.endPosition),
  };
}

/**
 * Extract class members from a class body.
 */
function extractClassMembers(
  bodyNode: TreeSitterNode,
  imports: JavaImportInfo[]
): {
  fields: JavaFieldInfo[];
  methods: JavaMethodInfo[];
  constructors: JavaConstructorInfo[];
  innerClasses: string[];
} {
  const fields: JavaFieldInfo[] = [];
  const methods: JavaMethodInfo[] = [];
  const constructors: JavaConstructorInfo[] = [];
  const innerClasses: string[] = [];
  
  for (const child of bodyNode.children) {
    switch (child.type) {
      case 'field_declaration':
        const extractedFields = extractField(child, imports);
        fields.push(...extractedFields);
        break;
      
      case 'method_declaration':
        const method = extractMethod(child, imports);
        if (method) {
          methods.push(method);
        }
        break;
      
      case 'constructor_declaration':
        const constructor = extractConstructor(child, imports);
        if (constructor) {
          constructors.push(constructor);
        }
        break;
      
      case 'class_declaration':
      case 'interface_declaration':
      case 'enum_declaration':
      case 'record_declaration':
        const innerName = findChildByType(child, 'identifier')?.text;
        if (innerName) {
          innerClasses.push(innerName);
        }
        break;
    }
  }
  
  return { fields, methods, constructors, innerClasses };
}

// ============================================
// Interface Extraction
// ============================================

/**
 * Extract all interface declarations from the AST.
 */
export function extractInterfaces(
  root: TreeSitterNode,
  packageName: string | null,
  imports: JavaImportInfo[]
): JavaInterfaceInfo[] {
  const interfaces: JavaInterfaceInfo[] = [];
  
  findNodesOfType(root, 'interface_declaration', (node) => {
    const interfaceInfo = parseInterfaceDeclaration(node, packageName, imports);
    if (interfaceInfo) {
      interfaces.push(interfaceInfo);
    }
  });
  
  return interfaces;
}

/**
 * Parse an interface declaration node.
 */
function parseInterfaceDeclaration(
  node: TreeSitterNode,
  packageName: string | null,
  imports: JavaImportInfo[]
): JavaInterfaceInfo | null {
  const modifiers = extractModifiers(node);
  const annotations = extractAnnotations(node, 'interface', imports);
  
  // Get interface name
  const nameNode = findChildByType(node, 'identifier');
  if (!nameNode) {
    return null;
  }
  const name = nameNode.text;
  
  // Get type parameters
  const typeParams = extractTypeParameters(node);
  
  // Get extended interfaces
  const extendsInterfaces = extractExtendsInterfaces(node);
  
  // Get permitted subclasses (for sealed interfaces)
  const permittedSubclasses = extractPermittedSubclasses(node);
  
  // Get interface body
  const bodyNode = findChildByType(node, 'interface_body');
  const { methods, fields } = bodyNode
    ? extractInterfaceMembers(bodyNode, imports)
    : { methods: [], fields: [] };
  
  return {
    name,
    packageName,
    annotations,
    modifiers,
    extendsInterfaces,
    typeParameters: typeParams,
    permittedSubclasses,
    methods,
    fields,
    accessibility: deriveAccessibility(modifiers),
    isSealed: modifiers.includes('sealed'),
    isNonSealed: modifiers.includes('non-sealed'),
    startPosition: toPosition(node.startPosition),
    endPosition: toPosition(node.endPosition),
  };
}

/**
 * Extract interface members from an interface body.
 */
function extractInterfaceMembers(
  bodyNode: TreeSitterNode,
  imports: JavaImportInfo[]
): {
  methods: JavaMethodInfo[];
  fields: JavaFieldInfo[];
} {
  const methods: JavaMethodInfo[] = [];
  const fields: JavaFieldInfo[] = [];
  
  for (const child of bodyNode.children) {
    switch (child.type) {
      case 'method_declaration':
        const method = extractMethod(child, imports);
        if (method) {
          methods.push(method);
        }
        break;
      
      case 'constant_declaration':
      case 'field_declaration':
        const extractedFields = extractField(child, imports);
        fields.push(...extractedFields);
        break;
    }
  }
  
  return { methods, fields };
}

// ============================================
// Enum Extraction
// ============================================

/**
 * Extract all enum declarations from the AST.
 */
export function extractEnums(
  root: TreeSitterNode,
  packageName: string | null,
  imports: JavaImportInfo[]
): JavaEnumInfo[] {
  const enums: JavaEnumInfo[] = [];
  
  findNodesOfType(root, 'enum_declaration', (node) => {
    const enumInfo = parseEnumDeclaration(node, packageName, imports);
    if (enumInfo) {
      enums.push(enumInfo);
    }
  });
  
  return enums;
}

/**
 * Parse an enum declaration node.
 */
function parseEnumDeclaration(
  node: TreeSitterNode,
  packageName: string | null,
  imports: JavaImportInfo[]
): JavaEnumInfo | null {
  const modifiers = extractModifiers(node);
  const annotations = extractAnnotations(node, 'enum', imports);
  
  // Get enum name
  const nameNode = findChildByType(node, 'identifier');
  if (!nameNode) {
    return null;
  }
  const name = nameNode.text;
  
  // Get implemented interfaces
  const interfaces = extractImplementsInterfaces(node);
  
  // Get enum body
  const bodyNode = findChildByType(node, 'enum_body');
  const { constants, fields, methods, constructors } = bodyNode
    ? extractEnumMembers(bodyNode, imports)
    : { constants: [], fields: [], methods: [], constructors: [] };
  
  return {
    name,
    packageName,
    annotations,
    modifiers,
    interfaces,
    constants,
    fields,
    methods,
    constructors,
    accessibility: deriveAccessibility(modifiers),
    startPosition: toPosition(node.startPosition),
    endPosition: toPosition(node.endPosition),
  };
}

/**
 * Extract enum members from an enum body.
 */
function extractEnumMembers(
  bodyNode: TreeSitterNode,
  imports: JavaImportInfo[]
): {
  constants: JavaEnumConstant[];
  fields: JavaFieldInfo[];
  methods: JavaMethodInfo[];
  constructors: JavaConstructorInfo[];
} {
  const constants: JavaEnumConstant[] = [];
  const fields: JavaFieldInfo[] = [];
  const methods: JavaMethodInfo[] = [];
  const constructors: JavaConstructorInfo[] = [];
  
  for (const child of bodyNode.children) {
    switch (child.type) {
      case 'enum_constant':
        const constant = parseEnumConstant(child, imports);
        if (constant) {
          constants.push(constant);
        }
        break;
      
      case 'enum_body_declarations':
        // This contains the regular class members after the constants
        for (const memberChild of child.children) {
          switch (memberChild.type) {
            case 'field_declaration':
              const extractedFields = extractField(memberChild, imports);
              fields.push(...extractedFields);
              break;
            
            case 'method_declaration':
              const method = extractMethod(memberChild, imports);
              if (method) {
                methods.push(method);
              }
              break;
            
            case 'constructor_declaration':
              const constructor = extractConstructor(memberChild, imports);
              if (constructor) {
                constructors.push(constructor);
              }
              break;
          }
        }
        break;
    }
  }
  
  return { constants, fields, methods, constructors };
}

/**
 * Parse an enum constant.
 */
function parseEnumConstant(
  node: TreeSitterNode,
  imports: JavaImportInfo[]
): JavaEnumConstant | null {
  const annotations = extractAnnotations(node, 'field', imports);
  
  // Get constant name
  const nameNode = findChildByType(node, 'identifier');
  if (!nameNode) {
    return null;
  }
  const name = nameNode.text;
  
  // Get constructor arguments
  const args: string[] = [];
  const argListNode = findChildByType(node, 'argument_list');
  if (argListNode) {
    for (const child of argListNode.children) {
      if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
        args.push(child.text);
      }
    }
  }
  
  return {
    name,
    annotations,
    arguments: args,
    startPosition: toPosition(node.startPosition),
    endPosition: toPosition(node.endPosition),
  };
}

// ============================================
// Record Extraction (Java 16+)
// ============================================

/**
 * Extract all record declarations from the AST.
 */
export function extractRecords(
  root: TreeSitterNode,
  packageName: string | null,
  imports: JavaImportInfo[]
): JavaRecordInfo[] {
  const records: JavaRecordInfo[] = [];
  
  findNodesOfType(root, 'record_declaration', (node) => {
    const recordInfo = parseRecordDeclaration(node, packageName, imports);
    if (recordInfo) {
      records.push(recordInfo);
    }
  });
  
  return records;
}

/**
 * Parse a record declaration node.
 */
function parseRecordDeclaration(
  node: TreeSitterNode,
  packageName: string | null,
  imports: JavaImportInfo[]
): JavaRecordInfo | null {
  const modifiers = extractModifiers(node);
  const annotations = extractAnnotations(node, 'record', imports);
  
  // Get record name
  const nameNode = findChildByType(node, 'identifier');
  if (!nameNode) {
    return null;
  }
  const name = nameNode.text;
  
  // Get type parameters
  const typeParams = extractTypeParameters(node);
  
  // Get record components (the parameters in the record header)
  const components = extractRecordComponents(node, imports);
  
  // Get implemented interfaces
  const interfaces = extractImplementsInterfaces(node);
  
  // Get record body
  const bodyNode = findChildByType(node, 'record_body') || findChildByType(node, 'class_body');
  const { methods, constructors } = bodyNode
    ? extractRecordMembers(bodyNode, imports)
    : { methods: [], constructors: [] };
  
  return {
    name,
    packageName,
    annotations,
    modifiers,
    components,
    interfaces,
    typeParameters: typeParams,
    methods,
    constructors,
    accessibility: deriveAccessibility(modifiers),
    startPosition: toPosition(node.startPosition),
    endPosition: toPosition(node.endPosition),
  };
}

/**
 * Extract record components from the record header.
 */
function extractRecordComponents(
  node: TreeSitterNode,
  imports: JavaImportInfo[]
): JavaRecordComponent[] {
  const components: JavaRecordComponent[] = [];
  
  // Find the formal parameters node (record components)
  const paramsNode = findChildByType(node, 'formal_parameters') ||
                     findChildByType(node, 'record_component_list');
  
  if (!paramsNode) {
    return components;
  }
  
  for (const child of paramsNode.children) {
    if (child.type === 'formal_parameter' || child.type === 'record_component') {
      const component = parseRecordComponent(child, imports);
      if (component) {
        components.push(component);
      }
    }
  }
  
  return components;
}

/**
 * Parse a single record component.
 */
function parseRecordComponent(
  node: TreeSitterNode,
  imports: JavaImportInfo[]
): JavaRecordComponent | null {
  const annotations = extractParameterAnnotations(node, imports);
  
  let type = '';
  let name = '';
  
  for (const child of node.children) {
    if (child.type === 'identifier') {
      name = child.text;
    } else if (isTypeNode(child)) {
      type = child.text;
    }
  }
  
  if (!name || !type) {
    return null;
  }
  
  return {
    name,
    type,
    annotations,
  };
}

/**
 * Extract record members from a record body.
 */
function extractRecordMembers(
  bodyNode: TreeSitterNode,
  imports: JavaImportInfo[]
): {
  methods: JavaMethodInfo[];
  constructors: JavaConstructorInfo[];
} {
  const methods: JavaMethodInfo[] = [];
  const constructors: JavaConstructorInfo[] = [];
  
  for (const child of bodyNode.children) {
    switch (child.type) {
      case 'method_declaration':
        const method = extractMethod(child, imports);
        if (method) {
          methods.push(method);
        }
        break;
      
      case 'constructor_declaration':
      case 'compact_constructor_declaration':
        const constructor = extractConstructor(child, imports);
        if (constructor) {
          constructors.push(constructor);
        }
        break;
    }
  }
  
  return { methods, constructors };
}

// ============================================
// Annotation Definition Extraction
// ============================================

/**
 * Extract all annotation type definitions from the AST.
 */
export function extractAnnotationDefinitions(
  root: TreeSitterNode,
  packageName: string | null,
  imports: JavaImportInfo[]
): AnnotationDefinition[] {
  const definitions: AnnotationDefinition[] = [];
  
  findNodesOfType(root, 'annotation_type_declaration', (node) => {
    const definition = parseAnnotationDefinition(node, packageName, imports);
    if (definition) {
      definitions.push(definition);
    }
  });
  
  return definitions;
}

/**
 * Parse an annotation type definition.
 */
function parseAnnotationDefinition(
  node: TreeSitterNode,
  packageName: string | null,
  imports: JavaImportInfo[]
): AnnotationDefinition | null {
  const modifiers = extractModifiers(node);
  const annotations = extractAnnotations(node, 'annotation_type', imports);
  
  // Get annotation name
  const nameNode = findChildByType(node, 'identifier');
  if (!nameNode) {
    return null;
  }
  const name = nameNode.text;
  
  // Get annotation elements
  const bodyNode = findChildByType(node, 'annotation_type_body');
  const elements = bodyNode
    ? extractAnnotationElements(bodyNode)
    : [];
  
  return {
    name,
    packageName,
    annotations,
    elements,
    accessibility: deriveAccessibility(modifiers),
    startPosition: toPosition(node.startPosition),
    endPosition: toPosition(node.endPosition),
  };
}

/**
 * Extract annotation elements from an annotation type body.
 */
function extractAnnotationElements(bodyNode: TreeSitterNode): AnnotationElement[] {
  const elements: AnnotationElement[] = [];
  
  for (const child of bodyNode.children) {
    if (child.type === 'annotation_type_element_declaration') {
      const element = parseAnnotationElement(child);
      if (element) {
        elements.push(element);
      }
    }
  }
  
  return elements;
}

/**
 * Parse a single annotation element.
 */
function parseAnnotationElement(node: TreeSitterNode): AnnotationElement | null {
  let type = '';
  let name = '';
  let defaultValue: string | null = null;
  
  for (const child of node.children) {
    if (child.type === 'identifier') {
      name = child.text;
    } else if (isTypeNode(child)) {
      type = child.text;
    } else if (child.type === 'default_value') {
      // Get the value after 'default' keyword
      for (const valueChild of child.children) {
        if (valueChild.type !== 'default') {
          defaultValue = valueChild.text;
          break;
        }
      }
    }
  }
  
  if (!name || !type) {
    return null;
  }
  
  return {
    name,
    type,
    defaultValue,
  };
}

// ============================================
// Inheritance Extraction
// ============================================

/**
 * Extract superclass and implemented interfaces from a class.
 */
function extractInheritance(node: TreeSitterNode): {
  superclass: string | null;
  interfaces: string[];
} {
  let superclass: string | null = null;
  const interfaces: string[] = [];
  
  // Look for superclass
  const superclassNode = findChildByType(node, 'superclass');
  if (superclassNode) {
    const typeNode = findTypeInNode(superclassNode);
    if (typeNode) {
      superclass = typeNode.text;
    }
  }
  
  // Look for interfaces
  const interfacesNode = findChildByType(node, 'super_interfaces') ||
                         findChildByType(node, 'interfaces');
  if (interfacesNode) {
    const typeList = findChildByType(interfacesNode, 'type_list') ||
                     findChildByType(interfacesNode, 'interface_type_list');
    if (typeList) {
      for (const child of typeList.children) {
        if (isTypeNode(child)) {
          interfaces.push(child.text);
        }
      }
    } else {
      // Direct type children
      for (const child of interfacesNode.children) {
        if (isTypeNode(child)) {
          interfaces.push(child.text);
        }
      }
    }
  }
  
  return { superclass, interfaces };
}

/**
 * Extract extended interfaces from an interface declaration.
 */
function extractExtendsInterfaces(node: TreeSitterNode): string[] {
  const interfaces: string[] = [];
  
  const extendsNode = findChildByType(node, 'extends_interfaces');
  if (extendsNode) {
    const typeList = findChildByType(extendsNode, 'type_list') ||
                     findChildByType(extendsNode, 'interface_type_list');
    if (typeList) {
      for (const child of typeList.children) {
        if (isTypeNode(child)) {
          interfaces.push(child.text);
        }
      }
    } else {
      for (const child of extendsNode.children) {
        if (isTypeNode(child)) {
          interfaces.push(child.text);
        }
      }
    }
  }
  
  return interfaces;
}

/**
 * Extract implemented interfaces from a class/enum/record.
 */
function extractImplementsInterfaces(node: TreeSitterNode): string[] {
  const interfaces: string[] = [];
  
  const implementsNode = findChildByType(node, 'super_interfaces') ||
                         findChildByType(node, 'interfaces');
  if (implementsNode) {
    for (const child of implementsNode.children) {
      if (isTypeNode(child)) {
        interfaces.push(child.text);
      }
    }
  }
  
  return interfaces;
}

/**
 * Extract permitted subclasses for sealed types.
 */
function extractPermittedSubclasses(node: TreeSitterNode): string[] {
  const permitted: string[] = [];
  
  const permitsNode = findChildByType(node, 'permits');
  if (permitsNode) {
    for (const child of permitsNode.children) {
      if (isTypeNode(child)) {
        permitted.push(child.text);
      }
    }
  }
  
  return permitted;
}

/**
 * Extract type parameters from a generic declaration.
 */
function extractTypeParameters(node: TreeSitterNode): string[] {
  const params: string[] = [];
  
  const typeParamsNode = findChildByType(node, 'type_parameters');
  if (typeParamsNode) {
    for (const child of typeParamsNode.children) {
      if (child.type === 'type_parameter') {
        const nameNode = findChildByType(child, 'identifier');
        if (nameNode) {
          params.push(nameNode.text);
        }
      }
    }
  }
  
  return params;
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
 * Find all nodes of a specific type in the tree.
 */
function findNodesOfType(
  node: TreeSitterNode,
  type: string,
  callback: (node: TreeSitterNode) => void
): void {
  if (node.type === type) {
    callback(node);
  }
  for (const child of node.children) {
    findNodesOfType(child, type, callback);
  }
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
    'identifier',
  ];
  return typeNodeTypes.includes(node.type);
}

/**
 * Find a type node within a parent node.
 */
function findTypeInNode(node: TreeSitterNode): TreeSitterNode | null {
  for (const child of node.children) {
    if (isTypeNode(child)) {
      return child;
    }
  }
  return null;
}
