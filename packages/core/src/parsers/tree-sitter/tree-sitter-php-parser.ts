/**
 * Tree-sitter PHP Parser
 *
 * Full PHP parser using tree-sitter-php for semantic extraction.
 * Extracts namespaces, use statements, classes, interfaces, traits,
 * enums, methods, properties, and attributes from PHP source files.
 *
 * Supports PHP 8+ features including attributes, enums, and readonly properties.
 *
 * @requirements PHP/Laravel Language Support
 */

import {
  isPhpTreeSitterAvailable,
  createPhpParser,
  getPhpLoadingError,
} from './php-loader.js';

import type { Position, ASTNode, AST, ParseResult } from '../types.js';
import type { TreeSitterNode, TreeSitterParser } from './types.js';

// ============================================
// PHP-Specific Types
// ============================================

/** PHP namespace information */
export interface PhpNamespaceInfo {
  name: string;
  startPosition: Position;
  endPosition: Position;
}

/** PHP use statement */
export interface PhpUseStatementInfo {
  fqn: string;
  alias: string | null;
  type: 'class' | 'function' | 'const';
  startPosition: Position;
  endPosition: Position;
}

/** PHP attribute (PHP 8+) */
export interface PhpAttributeInfo {
  name: string;
  fqn: string | null;
  arguments: string[];
  startPosition: Position;
  endPosition: Position;
}

/** PHP parameter */
export interface PhpParameterInfo {
  name: string;
  type: string | null;
  defaultValue: string | null;
  isVariadic: boolean;
  isByReference: boolean;
  isPromoted: boolean;
  visibility: 'public' | 'protected' | 'private' | null;
  attributes: PhpAttributeInfo[];
}

/** PHP method */
export interface PhpMethodInfo {
  name: string;
  visibility: 'public' | 'protected' | 'private';
  isStatic: boolean;
  isAbstract: boolean;
  isFinal: boolean;
  parameters: PhpParameterInfo[];
  returnType: string | null;
  attributes: PhpAttributeInfo[];
  startPosition: Position;
  endPosition: Position;
}

/** PHP property */
export interface PhpPropertyInfo {
  name: string;
  visibility: 'public' | 'protected' | 'private';
  isStatic: boolean;
  isReadonly: boolean;
  type: string | null;
  defaultValue: string | null;
  attributes: PhpAttributeInfo[];
  startPosition: Position;
  endPosition: Position;
}

/** PHP class */
export interface PhpClassInfo {
  name: string;
  fqn: string;
  namespace: string | null;
  extends: string | null;
  implements: string[];
  traits: string[];
  isAbstract: boolean;
  isFinal: boolean;
  isReadonly: boolean;
  properties: PhpPropertyInfo[];
  methods: PhpMethodInfo[];
  attributes: PhpAttributeInfo[];
  startPosition: Position;
  endPosition: Position;
}

/** PHP interface */
export interface PhpInterfaceInfo {
  name: string;
  fqn: string;
  namespace: string | null;
  extends: string[];
  methods: PhpMethodInfo[];
  attributes: PhpAttributeInfo[];
  startPosition: Position;
  endPosition: Position;
}

/** PHP trait */
export interface PhpTraitInfo {
  name: string;
  fqn: string;
  namespace: string | null;
  properties: PhpPropertyInfo[];
  methods: PhpMethodInfo[];
  attributes: PhpAttributeInfo[];
  startPosition: Position;
  endPosition: Position;
}

/** PHP enum (PHP 8.1+) */
export interface PhpEnumInfo {
  name: string;
  fqn: string;
  namespace: string | null;
  backingType: 'string' | 'int' | null;
  implements: string[];
  cases: { name: string; value: string | null }[];
  methods: PhpMethodInfo[];
  attributes: PhpAttributeInfo[];
  startPosition: Position;
  endPosition: Position;
}

/** PHP parse result */
export interface PhpParseResult extends ParseResult {
  namespace: PhpNamespaceInfo | null;
  useStatements: PhpUseStatementInfo[];
  classes: PhpClassInfo[];
  interfaces: PhpInterfaceInfo[];
  traits: PhpTraitInfo[];
  enums: PhpEnumInfo[];
}

// ============================================
// Parser Class
// ============================================

/**
 * PHP parser using tree-sitter-php.
 */
export class TreeSitterPhpParser {
  private parser: TreeSitterParser | null = null;
  private initError: string | null = null;

  /**
   * Check if the parser is available.
   */
  isAvailable(): boolean {
    return isPhpTreeSitterAvailable();
  }

  /**
   * Get the initialization error if parser is not available.
   */
  getError(): string | null {
    return this.initError ?? getPhpLoadingError();
  }

  /**
   * Initialize the parser.
   */
  initialize(): boolean {
    if (this.parser) {
      return true;
    }

    if (!isPhpTreeSitterAvailable()) {
      this.initError = getPhpLoadingError() ?? 'tree-sitter-php not available';
      return false;
    }

    try {
      this.parser = createPhpParser();
      return true;
    } catch (error) {
      this.initError = error instanceof Error ? error.message : 'Failed to create PHP parser';
      return false;
    }
  }

  /**
   * Parse PHP source code and extract semantic information.
   */
  parse(source: string, _filePath?: string): PhpParseResult {
    if (!this.parser && !this.initialize()) {
      return this.createErrorResult(this.initError ?? 'Parser not initialized');
    }

    if (!this.parser) {
      return this.createErrorResult('Parser not available');
    }

    try {
      const tree = this.parser.parse(source);
      const rootNode = tree.rootNode;

      // Extract semantic information
      const namespace = this.extractNamespace(rootNode);
      const useStatements = this.extractUseStatements(rootNode);
      const namespaceName = namespace?.name ?? null;

      const classes = this.extractClasses(rootNode, namespaceName);
      const interfaces = this.extractInterfaces(rootNode, namespaceName);
      const traits = this.extractTraits(rootNode, namespaceName);
      const enums = this.extractEnums(rootNode, namespaceName);

      const ast = this.convertToAST(rootNode, source);

      return {
        success: true,
        language: 'php',
        ast,
        errors: [],
        namespace,
        useStatements,
        classes,
        interfaces,
        traits,
        enums,
      };
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Parse error'
      );
    }
  }

  // ============================================
  // Extraction Methods
  // ============================================

  private extractNamespace(root: TreeSitterNode): PhpNamespaceInfo | null {
    const nsNode = this.findChildByType(root, 'namespace_definition');
    if (!nsNode) {return null;}

    const nameNode = this.findChildByType(nsNode, 'namespace_name') ??
                     this.findChildByType(nsNode, 'qualified_name');
    if (!nameNode) {return null;}

    return {
      name: nameNode.text,
      startPosition: this.toPosition(nsNode.startPosition),
      endPosition: this.toPosition(nsNode.endPosition),
    };
  }

  private extractUseStatements(root: TreeSitterNode): PhpUseStatementInfo[] {
    const statements: PhpUseStatementInfo[] = [];

    this.findNodesOfType(root, 'namespace_use_declaration', (node) => {
      const useClause = this.findChildByType(node, 'namespace_use_clause');
      if (!useClause) {return;}

      const nameNode = this.findChildByType(useClause, 'qualified_name') ??
                       this.findChildByType(useClause, 'namespace_name');
      if (!nameNode) {return;}

      const aliasNode = this.findChildByType(useClause, 'namespace_aliasing_clause');
      const alias = aliasNode ? this.findChildByType(aliasNode, 'name')?.text ?? null : null;

      // Determine type (class, function, const)
      let type: 'class' | 'function' | 'const' = 'class';
      for (const child of node.children) {
        if (child.text === 'function') {type = 'function';}
        else if (child.text === 'const') {type = 'const';}
      }

      statements.push({
        fqn: nameNode.text,
        alias,
        type,
        startPosition: this.toPosition(node.startPosition),
        endPosition: this.toPosition(node.endPosition),
      });
    });

    return statements;
  }

  private extractClasses(root: TreeSitterNode, namespace: string | null): PhpClassInfo[] {
    const classes: PhpClassInfo[] = [];

    this.findNodesOfType(root, 'class_declaration', (node) => {
      const classInfo = this.parseClass(node, namespace);
      if (classInfo) {classes.push(classInfo);}
    });

    return classes;
  }

  private parseClass(node: TreeSitterNode, namespace: string | null): PhpClassInfo | null {
    const nameNode = this.findChildByType(node, 'name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const fqn = namespace ? `${namespace}\\${name}` : name;

    // Extract modifiers
    let isAbstract = false;
    let isFinal = false;
    let isReadonly = false;

    for (const child of node.children) {
      if (child.type === 'abstract_modifier') {isAbstract = true;}
      if (child.type === 'final_modifier') {isFinal = true;}
      if (child.type === 'readonly_modifier') {isReadonly = true;}
    }

    // Extract extends
    let extendsClass: string | null = null;
    const extendsNode = this.findChildByType(node, 'base_clause');
    if (extendsNode) {
      const extName = this.findChildByType(extendsNode, 'qualified_name') ??
                      this.findChildByType(extendsNode, 'name');
      extendsClass = extName?.text ?? null;
    }

    // Extract implements
    const implementsList: string[] = [];
    const implementsNode = this.findChildByType(node, 'class_interface_clause');
    if (implementsNode) {
      this.findNodesOfType(implementsNode, 'qualified_name', (n) => {
        implementsList.push(n.text);
      });
      this.findNodesOfType(implementsNode, 'name', (n) => {
        if (!implementsList.includes(n.text)) {
          implementsList.push(n.text);
        }
      });
    }

    // Extract body
    const bodyNode = this.findChildByType(node, 'declaration_list');
    const { properties, methods, traits } = bodyNode
      ? this.extractClassBody(bodyNode)
      : { properties: [], methods: [], traits: [] };

    // Extract attributes
    const attributes = this.extractAttributes(node);

    return {
      name,
      fqn,
      namespace,
      extends: extendsClass,
      implements: implementsList,
      traits,
      isAbstract,
      isFinal,
      isReadonly,
      properties,
      methods,
      attributes,
      startPosition: this.toPosition(node.startPosition),
      endPosition: this.toPosition(node.endPosition),
    };
  }

  private extractClassBody(bodyNode: TreeSitterNode): {
    properties: PhpPropertyInfo[];
    methods: PhpMethodInfo[];
    traits: string[];
  } {
    const properties: PhpPropertyInfo[] = [];
    const methods: PhpMethodInfo[] = [];
    const traits: string[] = [];

    for (const child of bodyNode.children) {
      if (child.type === 'property_declaration') {
        const prop = this.parseProperty(child);
        if (prop) {properties.push(prop);}
      } else if (child.type === 'method_declaration') {
        const method = this.parseMethod(child);
        if (method) {methods.push(method);}
      } else if (child.type === 'use_declaration') {
        // Trait use
        this.findNodesOfType(child, 'qualified_name', (n) => traits.push(n.text));
        this.findNodesOfType(child, 'name', (n) => {
          if (!traits.includes(n.text)) {traits.push(n.text);}
        });
      }
    }

    return { properties, methods, traits };
  }

  private parseProperty(node: TreeSitterNode): PhpPropertyInfo | null {
    // Extract visibility and modifiers
    let visibility: 'public' | 'protected' | 'private' = 'public';
    let isStatic = false;
    let isReadonly = false;

    for (const child of node.children) {
      if (child.type === 'visibility_modifier') {
        visibility = child.text as 'public' | 'protected' | 'private';
      }
      if (child.type === 'static_modifier') {isStatic = true;}
      if (child.type === 'readonly_modifier') {isReadonly = true;}
    }

    // Extract type
    const typeNode = this.findChildByType(node, 'type');
    const type = typeNode?.text ?? null;

    // Extract property element
    const propElement = this.findChildByType(node, 'property_element');
    if (!propElement) {return null;}

    const varNode = this.findChildByType(propElement, 'variable_name');
    if (!varNode) {return null;}

    const name = varNode.text.replace(/^\$/, '');

    // Extract default value
    const initNode = this.findChildByType(propElement, 'property_initializer');
    const defaultValue = initNode?.text ?? null;

    const attributes = this.extractAttributes(node);

    return {
      name,
      visibility,
      isStatic,
      isReadonly,
      type,
      defaultValue,
      attributes,
      startPosition: this.toPosition(node.startPosition),
      endPosition: this.toPosition(node.endPosition),
    };
  }

  private parseMethod(node: TreeSitterNode): PhpMethodInfo | null {
    const nameNode = this.findChildByType(node, 'name');
    if (!nameNode) {return null;}

    let visibility: 'public' | 'protected' | 'private' = 'public';
    let isStatic = false;
    let isAbstract = false;
    let isFinal = false;

    for (const child of node.children) {
      if (child.type === 'visibility_modifier') {
        visibility = child.text as 'public' | 'protected' | 'private';
      }
      if (child.type === 'static_modifier') {isStatic = true;}
      if (child.type === 'abstract_modifier') {isAbstract = true;}
      if (child.type === 'final_modifier') {isFinal = true;}
    }

    // Extract parameters
    const paramsNode = this.findChildByType(node, 'formal_parameters');
    const parameters = paramsNode ? this.extractParameters(paramsNode) : [];

    // Extract return type
    const returnTypeNode = this.findChildByType(node, 'return_type');
    const returnType = returnTypeNode?.text?.replace(/^:\s*/, '') ?? null;

    const attributes = this.extractAttributes(node);

    return {
      name: nameNode.text,
      visibility,
      isStatic,
      isAbstract,
      isFinal,
      parameters,
      returnType,
      attributes,
      startPosition: this.toPosition(node.startPosition),
      endPosition: this.toPosition(node.endPosition),
    };
  }

  private extractParameters(paramsNode: TreeSitterNode): PhpParameterInfo[] {
    const params: PhpParameterInfo[] = [];

    for (const child of paramsNode.children) {
      if (child.type === 'simple_parameter' || child.type === 'property_promotion_parameter') {
        const param = this.parseParameter(child);
        if (param) {params.push(param);}
      }
    }

    return params;
  }

  private parseParameter(node: TreeSitterNode): PhpParameterInfo | null {
    const varNode = this.findChildByType(node, 'variable_name');
    if (!varNode) {return null;}

    const name = varNode.text.replace(/^\$/, '');

    // Type
    const typeNode = this.findChildByType(node, 'type');
    const type = typeNode?.text ?? null;

    // Default value
    const defaultNode = this.findChildByType(node, 'default_value');
    const defaultValue = defaultNode?.text?.replace(/^=\s*/, '') ?? null;

    // Modifiers
    let isVariadic = false;
    let isByReference = false;
    let isPromoted = node.type === 'property_promotion_parameter';
    let visibility: 'public' | 'protected' | 'private' | null = null;

    for (const child of node.children) {
      if (child.type === 'variadic_parameter') {isVariadic = true;}
      if (child.type === 'reference_modifier') {isByReference = true;}
      if (child.type === 'visibility_modifier') {
        visibility = child.text as 'public' | 'protected' | 'private';
        isPromoted = true;
      }
    }

    const attributes = this.extractAttributes(node);

    return {
      name,
      type,
      defaultValue,
      isVariadic,
      isByReference,
      isPromoted,
      visibility,
      attributes,
    };
  }

  private extractInterfaces(root: TreeSitterNode, namespace: string | null): PhpInterfaceInfo[] {
    const interfaces: PhpInterfaceInfo[] = [];

    this.findNodesOfType(root, 'interface_declaration', (node) => {
      const nameNode = this.findChildByType(node, 'name');
      if (!nameNode) {return;}

      const name = nameNode.text;
      const fqn = namespace ? `${namespace}\\${name}` : name;

      // Extract extends
      const extendsList: string[] = [];
      const extendsNode = this.findChildByType(node, 'base_clause');
      if (extendsNode) {
        this.findNodesOfType(extendsNode, 'qualified_name', (n) => extendsList.push(n.text));
        this.findNodesOfType(extendsNode, 'name', (n) => {
          if (!extendsList.includes(n.text)) {extendsList.push(n.text);}
        });
      }

      // Extract methods
      const bodyNode = this.findChildByType(node, 'declaration_list');
      const methods: PhpMethodInfo[] = [];
      if (bodyNode) {
        for (const child of bodyNode.children) {
          if (child.type === 'method_declaration') {
            const method = this.parseMethod(child);
            if (method) {methods.push(method);}
          }
        }
      }

      interfaces.push({
        name,
        fqn,
        namespace,
        extends: extendsList,
        methods,
        attributes: this.extractAttributes(node),
        startPosition: this.toPosition(node.startPosition),
        endPosition: this.toPosition(node.endPosition),
      });
    });

    return interfaces;
  }

  private extractTraits(root: TreeSitterNode, namespace: string | null): PhpTraitInfo[] {
    const traits: PhpTraitInfo[] = [];

    this.findNodesOfType(root, 'trait_declaration', (node) => {
      const nameNode = this.findChildByType(node, 'name');
      if (!nameNode) {return;}

      const name = nameNode.text;
      const fqn = namespace ? `${namespace}\\${name}` : name;

      const bodyNode = this.findChildByType(node, 'declaration_list');
      const bodyResult = bodyNode
        ? this.extractClassBody(bodyNode)
        : { properties: [], methods: [], traits: [] };

      traits.push({
        name,
        fqn,
        namespace,
        properties: bodyResult.properties,
        methods: bodyResult.methods,
        attributes: this.extractAttributes(node),
        startPosition: this.toPosition(node.startPosition),
        endPosition: this.toPosition(node.endPosition),
      });
    });

    return traits;
  }

  private extractEnums(root: TreeSitterNode, namespace: string | null): PhpEnumInfo[] {
    const enums: PhpEnumInfo[] = [];

    this.findNodesOfType(root, 'enum_declaration', (node) => {
      const nameNode = this.findChildByType(node, 'name');
      if (!nameNode) {return;}

      const name = nameNode.text;
      const fqn = namespace ? `${namespace}\\${name}` : name;

      // Backing type
      let backingType: 'string' | 'int' | null = null;
      const backingNode = this.findChildByType(node, 'enum_declaration_list');
      if (backingNode) {
        const typeNode = this.findChildByType(backingNode, 'primitive_type');
        if (typeNode?.text === 'string') {backingType = 'string';}
        else if (typeNode?.text === 'int') {backingType = 'int';}
      }

      // Implements
      const implementsList: string[] = [];
      const implementsNode = this.findChildByType(node, 'class_interface_clause');
      if (implementsNode) {
        this.findNodesOfType(implementsNode, 'qualified_name', (n) => implementsList.push(n.text));
      }

      // Cases and methods
      const cases: { name: string; value: string | null }[] = [];
      const methods: PhpMethodInfo[] = [];

      const bodyNode = this.findChildByType(node, 'enum_declaration_list') ??
                       this.findChildByType(node, 'declaration_list');
      if (bodyNode) {
        for (const child of bodyNode.children) {
          if (child.type === 'enum_case') {
            const caseNameNode = this.findChildByType(child, 'name');
            const caseValueNode = this.findChildByType(child, 'integer') ??
                                  this.findChildByType(child, 'string');
            if (caseNameNode) {
              cases.push({
                name: caseNameNode.text,
                value: caseValueNode?.text ?? null,
              });
            }
          } else if (child.type === 'method_declaration') {
            const method = this.parseMethod(child);
            if (method) {methods.push(method);}
          }
        }
      }

      enums.push({
        name,
        fqn,
        namespace,
        backingType,
        implements: implementsList,
        cases,
        methods,
        attributes: this.extractAttributes(node),
        startPosition: this.toPosition(node.startPosition),
        endPosition: this.toPosition(node.endPosition),
      });
    });

    return enums;
  }

  private extractAttributes(node: TreeSitterNode): PhpAttributeInfo[] {
    const attributes: PhpAttributeInfo[] = [];

    // Look for attribute_list nodes before the declaration
    for (const child of node.children) {
      if (child.type === 'attribute_list' || child.type === 'attribute_group') {
        this.findNodesOfType(child, 'attribute', (attrNode) => {
          const nameNode = this.findChildByType(attrNode, 'qualified_name') ??
                           this.findChildByType(attrNode, 'name');
          if (!nameNode) {return;}

          const args: string[] = [];
          const argsNode = this.findChildByType(attrNode, 'arguments');
          if (argsNode) {
            for (const argChild of argsNode.children) {
              if (argChild.type === 'argument') {
                args.push(argChild.text);
              }
            }
          }

          attributes.push({
            name: nameNode.text.split('\\').pop() ?? nameNode.text,
            fqn: nameNode.text.includes('\\') ? nameNode.text : null,
            arguments: args,
            startPosition: this.toPosition(attrNode.startPosition),
            endPosition: this.toPosition(attrNode.endPosition),
          });
        });
      }
    }

    return attributes;
  }

  // ============================================
  // Utility Methods
  // ============================================

  private convertToAST(node: TreeSitterNode, source: string): AST {
    const rootNode = this.convertNode(node);
    return {
      rootNode,
      text: source,
    };
  }

  private convertNode(node: TreeSitterNode): ASTNode {
    const children: ASTNode[] = [];
    for (const child of node.children) {
      children.push(this.convertNode(child));
    }

    return {
      type: node.type,
      text: node.text,
      children,
      startPosition: this.toPosition(node.startPosition),
      endPosition: this.toPosition(node.endPosition),
    };
  }

  private toPosition(point: { row: number; column: number }): Position {
    return { row: point.row, column: point.column };
  }

  private findChildByType(node: TreeSitterNode, type: string): TreeSitterNode | null {
    for (const child of node.children) {
      if (child.type === type) {return child;}
    }
    return null;
  }

  private findNodesOfType(
    node: TreeSitterNode,
    type: string,
    callback: (node: TreeSitterNode) => void
  ): void {
    if (node.type === type) {callback(node);}
    for (const child of node.children) {
      this.findNodesOfType(child, type, callback);
    }
  }

  private createErrorResult(message: string): PhpParseResult {
    return {
      success: false,
      language: 'php',
      ast: null,
      errors: [{ message, position: { row: 0, column: 0 } }],
      namespace: null,
      useStatements: [],
      classes: [],
      interfaces: [],
      traits: [],
      enums: [],
    };
  }
}
