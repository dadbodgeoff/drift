/**
 * Tree-sitter Go Parser
 *
 * Full Go parser using tree-sitter-go for semantic extraction.
 * Extracts packages, imports, structs, interfaces, functions,
 * methods, and type declarations from Go source files.
 *
 * Supports Go-specific features including receivers, embedded types,
 * multiple return values, and interface embedding.
 *
 * @requirements Go Language Support
 */

import {
  isGoTreeSitterAvailable,
  createGoParser,
  getGoLoadingError,
} from './go-loader.js';

import type { Position, ASTNode, AST, ParseResult } from '../types.js';
import type { TreeSitterNode, TreeSitterParser } from './types.js';

// ============================================
// Go-Specific Types
// ============================================

/** Go package information */
export interface GoPackageInfo {
  name: string;
  startPosition: Position;
  endPosition: Position;
}

/** Go import statement */
export interface GoImportInfo {
  path: string;
  alias: string | null;
  isBlankImport: boolean;
  isDotImport: boolean;
  startPosition: Position;
  endPosition: Position;
}

/** Go parameter */
export interface GoParameterInfo {
  name: string;
  type: string;
  isVariadic: boolean;
}

/** Go return type */
export interface GoReturnInfo {
  name: string | null;
  type: string;
}

/** Go function */
export interface GoFunctionInfo {
  name: string;
  qualifiedName: string;
  parameters: GoParameterInfo[];
  returns: GoReturnInfo[];
  isExported: boolean;
  isVariadic: boolean;
  startPosition: Position;
  endPosition: Position;
  bodyStartPosition: Position | null;
  bodyEndPosition: Position | null;
}

/** Go method (function with receiver) */
export interface GoMethodInfo extends GoFunctionInfo {
  receiver: GoReceiverInfo;
}

/** Go receiver */
export interface GoReceiverInfo {
  name: string;
  type: string;
  isPointer: boolean;
}

/** Go struct field */
export interface GoFieldInfo {
  name: string;
  type: string;
  tag: string | null;
  isExported: boolean;
  isEmbedded: boolean;
  startPosition: Position;
  endPosition: Position;
}

/** Go struct */
export interface GoStructInfo {
  name: string;
  isExported: boolean;
  fields: GoFieldInfo[];
  embeddedTypes: string[];
  startPosition: Position;
  endPosition: Position;
}

/** Go interface method signature */
export interface GoInterfaceMethodInfo {
  name: string;
  parameters: GoParameterInfo[];
  returns: GoReturnInfo[];
}

/** Go interface */
export interface GoInterfaceInfo {
  name: string;
  isExported: boolean;
  methods: GoInterfaceMethodInfo[];
  embeddedInterfaces: string[];
  startPosition: Position;
  endPosition: Position;
}

/** Go type alias */
export interface GoTypeAliasInfo {
  name: string;
  underlyingType: string;
  isExported: boolean;
  startPosition: Position;
  endPosition: Position;
}

/** Go parse result */
export interface GoParseResult extends ParseResult {
  package: GoPackageInfo | null;
  imports: GoImportInfo[];
  functions: GoFunctionInfo[];
  methods: GoMethodInfo[];
  structs: GoStructInfo[];
  interfaces: GoInterfaceInfo[];
  typeAliases: GoTypeAliasInfo[];
}

// ============================================
// Parser Class
// ============================================

/**
 * Go parser using tree-sitter-go.
 *
 * Provides full semantic extraction for Go source files including:
 * - Package declarations
 * - Import statements
 * - Function and method declarations
 * - Struct and interface declarations
 * - Type aliases
 */
export class TreeSitterGoParser {
  private parser: TreeSitterParser | null = null;
  private initError: string | null = null;

  /**
   * Check if the parser is available.
   */
  isAvailable(): boolean {
    return isGoTreeSitterAvailable();
  }

  /**
   * Get the initialization error if parser is not available.
   */
  getError(): string | null {
    return this.initError ?? getGoLoadingError();
  }

  /**
   * Initialize the parser.
   * Call this before parsing or check isAvailable() first.
   */
  initialize(): boolean {
    if (this.parser) {
      return true;
    }

    if (!isGoTreeSitterAvailable()) {
      this.initError = getGoLoadingError() ?? 'tree-sitter-go not available';
      return false;
    }

    try {
      this.parser = createGoParser();
      return true;
    } catch (error) {
      this.initError = error instanceof Error ? error.message : 'Failed to create Go parser';
      return false;
    }
  }

  /**
   * Parse Go source code and extract semantic information.
   *
   * @param source - Go source code
   * @param filePath - Optional file path for error reporting
   * @returns GoParseResult with full semantic information
   */
  parse(source: string, _filePath?: string): GoParseResult {
    // Ensure parser is initialized
    if (!this.parser && !this.initialize()) {
      return this.createErrorResult(
        this.initError ?? 'Parser not initialized'
      );
    }

    if (!this.parser) {
      return this.createErrorResult('Parser not available');
    }

    try {
      // Parse the source
      const tree = this.parser.parse(source);
      const rootNode = tree.rootNode;

      // Extract semantic information
      const packageInfo = this.extractPackage(rootNode);
      const imports = this.extractImports(rootNode);
      const packageName = packageInfo?.name ?? 'main';

      // Extract declarations
      const functions = this.extractFunctions(rootNode, packageName);
      const methods = this.extractMethods(rootNode, packageName);
      const structs = this.extractStructs(rootNode);
      const interfaces = this.extractInterfaces(rootNode);
      const typeAliases = this.extractTypeAliases(rootNode);

      // Convert to AST for base result
      const ast = this.convertToAST(rootNode, source);

      return {
        success: true,
        language: 'go',
        ast,
        errors: [],
        package: packageInfo,
        imports,
        functions,
        methods,
        structs,
        interfaces,
        typeAliases,
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

  /**
   * Extract package declaration from the AST.
   */
  private extractPackage(root: TreeSitterNode): GoPackageInfo | null {
    const packageNode = this.findChildByType(root, 'package_clause');
    if (!packageNode) {
      return null;
    }

    const nameNode = packageNode.childForFieldName('name') ??
                     this.findChildByType(packageNode, 'package_identifier');
    if (!nameNode) {
      return null;
    }

    return {
      name: nameNode.text,
      startPosition: this.toPosition(packageNode.startPosition),
      endPosition: this.toPosition(packageNode.endPosition),
    };
  }

  /**
   * Extract import statements from the AST.
   */
  private extractImports(root: TreeSitterNode): GoImportInfo[] {
    const imports: GoImportInfo[] = [];

    this.findNodesOfType(root, 'import_declaration', (node) => {
      // Handle import spec list (grouped imports)
      this.findNodesOfType(node, 'import_spec', (specNode) => {
        const importInfo = this.parseImportSpec(specNode);
        if (importInfo) {
          imports.push(importInfo);
        }
      });
    });

    return imports;
  }

  /**
   * Parse a single import spec.
   */
  private parseImportSpec(node: TreeSitterNode): GoImportInfo | null {
    const pathNode = node.childForFieldName('path') ??
                     this.findChildByType(node, 'interpreted_string_literal');
    if (!pathNode) {
      return null;
    }

    // Remove quotes from path
    const path = pathNode.text.replace(/^"|"$/g, '');

    // Check for alias
    const nameNode = node.childForFieldName('name') ??
                     this.findChildByType(node, 'package_identifier') ??
                     this.findChildByType(node, 'blank_identifier') ??
                     this.findChildByType(node, 'dot');

    let alias: string | null = null;
    let isBlankImport = false;
    let isDotImport = false;

    if (nameNode) {
      if (nameNode.type === 'blank_identifier' || nameNode.text === '_') {
        isBlankImport = true;
        alias = '_';
      } else if (nameNode.type === 'dot' || nameNode.text === '.') {
        isDotImport = true;
        alias = '.';
      } else {
        alias = nameNode.text;
      }
    }

    return {
      path,
      alias,
      isBlankImport,
      isDotImport,
      startPosition: this.toPosition(node.startPosition),
      endPosition: this.toPosition(node.endPosition),
    };
  }

  /**
   * Extract function declarations (non-method functions).
   */
  private extractFunctions(root: TreeSitterNode, packageName: string): GoFunctionInfo[] {
    const functions: GoFunctionInfo[] = [];

    this.findNodesOfType(root, 'function_declaration', (node) => {
      const funcInfo = this.parseFunctionDeclaration(node, packageName);
      if (funcInfo) {
        functions.push(funcInfo);
      }
    });

    return functions;
  }

  /**
   * Parse a function declaration.
   */
  private parseFunctionDeclaration(node: TreeSitterNode, packageName: string): GoFunctionInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return null;
    }

    const name = nameNode.text;
    const isExported = /^[A-Z]/.test(name);

    const parametersNode = node.childForFieldName('parameters');
    const resultNode = node.childForFieldName('result');
    const bodyNode = node.childForFieldName('body');

    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];
    const returns = resultNode ? this.extractReturns(resultNode) : [];
    const isVariadic = parameters.some(p => p.isVariadic);

    return {
      name,
      qualifiedName: `${packageName}.${name}`,
      parameters,
      returns,
      isExported,
      isVariadic,
      startPosition: this.toPosition(node.startPosition),
      endPosition: this.toPosition(node.endPosition),
      bodyStartPosition: bodyNode ? this.toPosition(bodyNode.startPosition) : null,
      bodyEndPosition: bodyNode ? this.toPosition(bodyNode.endPosition) : null,
    };
  }

  /**
   * Extract method declarations (functions with receivers).
   */
  private extractMethods(root: TreeSitterNode, packageName: string): GoMethodInfo[] {
    const methods: GoMethodInfo[] = [];

    this.findNodesOfType(root, 'method_declaration', (node) => {
      const methodInfo = this.parseMethodDeclaration(node, packageName);
      if (methodInfo) {
        methods.push(methodInfo);
      }
    });

    return methods;
  }

  /**
   * Parse a method declaration.
   */
  private parseMethodDeclaration(node: TreeSitterNode, packageName: string): GoMethodInfo | null {
    const nameNode = node.childForFieldName('name');
    const receiverNode = node.childForFieldName('receiver');
    if (!nameNode || !receiverNode) {
      return null;
    }

    const name = nameNode.text;
    const isExported = /^[A-Z]/.test(name);
    const receiver = this.parseReceiver(receiverNode);
    if (!receiver) {
      return null;
    }

    const parametersNode = node.childForFieldName('parameters');
    const resultNode = node.childForFieldName('result');
    const bodyNode = node.childForFieldName('body');

    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];
    const returns = resultNode ? this.extractReturns(resultNode) : [];
    const isVariadic = parameters.some(p => p.isVariadic);

    return {
      name,
      qualifiedName: `${packageName}.${receiver.type}.${name}`,
      receiver,
      parameters,
      returns,
      isExported,
      isVariadic,
      startPosition: this.toPosition(node.startPosition),
      endPosition: this.toPosition(node.endPosition),
      bodyStartPosition: bodyNode ? this.toPosition(bodyNode.startPosition) : null,
      bodyEndPosition: bodyNode ? this.toPosition(bodyNode.endPosition) : null,
    };
  }

  /**
   * Parse a receiver declaration.
   */
  private parseReceiver(node: TreeSitterNode): GoReceiverInfo | null {
    // Receiver is a parameter_list with one parameter
    for (const child of node.children) {
      if (child.type === 'parameter_declaration') {
        const nameNode = this.findChildByType(child, 'identifier');
        const typeNode = child.childForFieldName('type');

        if (!typeNode) {continue;}

        let typeName: string;
        let isPointer = false;

        if (typeNode.type === 'pointer_type') {
          isPointer = true;
          // Use namedChildren instead of namedChild
          const innerType = typeNode.namedChildren[0];
          typeName = innerType?.text ?? 'unknown';
        } else {
          typeName = typeNode.text;
        }

        return {
          name: nameNode?.text ?? '_',
          type: typeName,
          isPointer,
        };
      }
    }

    return null;
  }

  /**
   * Extract parameters from a parameter list.
   */
  private extractParameters(node: TreeSitterNode): GoParameterInfo[] {
    const params: GoParameterInfo[] = [];

    for (const child of node.children) {
      if (child.type === 'parameter_declaration') {
        const names: string[] = [];
        let type: string | undefined;
        let isVariadic = false;

        for (const paramChild of child.children) {
          if (paramChild.type === 'identifier') {
            names.push(paramChild.text);
          } else if (paramChild.type === 'variadic_parameter_declaration') {
            isVariadic = true;
            const variadicType = paramChild.childForFieldName('type');
            type = variadicType?.text;
          } else if (this.isTypeNode(paramChild)) {
            type = paramChild.text;
          }
        }

        // If no names, it's an unnamed parameter
        if (names.length === 0) {
          params.push({
            name: '_',
            type: type ?? 'unknown',
            isVariadic,
          });
        } else {
          for (const name of names) {
            params.push({
              name,
              type: type ?? 'unknown',
              isVariadic,
            });
          }
        }
      } else if (child.type === 'variadic_parameter_declaration') {
        const nameNode = this.findChildByType(child, 'identifier');
        const typeNode = child.childForFieldName('type');
        params.push({
          name: nameNode?.text ?? '_',
          type: typeNode?.text ?? 'unknown',
          isVariadic: true,
        });
      }
    }

    return params;
  }

  /**
   * Extract return types from a result node.
   */
  private extractReturns(node: TreeSitterNode): GoReturnInfo[] {
    const returns: GoReturnInfo[] = [];

    if (node.type === 'parameter_list') {
      // Multiple/named returns: (int, error) or (result int, err error)
      for (const child of node.children) {
        if (child.type === 'parameter_declaration') {
          const names: string[] = [];
          let type: string | undefined;

          for (const paramChild of child.children) {
            if (paramChild.type === 'identifier') {
              names.push(paramChild.text);
            } else if (this.isTypeNode(paramChild)) {
              type = paramChild.text;
            }
          }

          if (names.length === 0) {
            returns.push({ name: null, type: type ?? 'unknown' });
          } else {
            for (const name of names) {
              returns.push({ name, type: type ?? 'unknown' });
            }
          }
        }
      }
    } else {
      // Single return type
      returns.push({ name: null, type: node.text });
    }

    return returns;
  }

  /**
   * Extract struct declarations.
   */
  private extractStructs(root: TreeSitterNode): GoStructInfo[] {
    const structs: GoStructInfo[] = [];

    this.findNodesOfType(root, 'type_declaration', (node) => {
      for (const child of node.children) {
        if (child.type === 'type_spec') {
          const nameNode = child.childForFieldName('name');
          const typeNode = child.childForFieldName('type');

          if (nameNode && typeNode?.type === 'struct_type') {
            const structInfo = this.parseStruct(nameNode.text, typeNode);
            if (structInfo) {
              structs.push(structInfo);
            }
          }
        }
      }
    });

    return structs;
  }

  /**
   * Parse a struct type.
   */
  private parseStruct(name: string, node: TreeSitterNode): GoStructInfo | null {
    const isExported = /^[A-Z]/.test(name);
    const fields: GoFieldInfo[] = [];
    const embeddedTypes: string[] = [];

    const fieldListNode = node.childForFieldName('fields') ??
                          this.findChildByType(node, 'field_declaration_list');

    if (fieldListNode) {
      for (const child of fieldListNode.children) {
        if (child.type === 'field_declaration') {
          const fieldInfo = this.parseField(child);
          if (fieldInfo) {
            if (fieldInfo.isEmbedded) {
              embeddedTypes.push(fieldInfo.type);
            }
            fields.push(fieldInfo);
          }
        }
      }
    }

    return {
      name,
      isExported,
      fields,
      embeddedTypes,
      startPosition: this.toPosition(node.startPosition),
      endPosition: this.toPosition(node.endPosition),
    };
  }

  /**
   * Parse a struct field.
   */
  private parseField(node: TreeSitterNode): GoFieldInfo | null {
    const names: string[] = [];
    let type: string | undefined;
    let tag: string | null = null;

    for (const child of node.children) {
      if (child.type === 'field_identifier') {
        names.push(child.text);
      } else if (this.isTypeNode(child)) {
        type = child.text.replace(/^\*/, ''); // Remove pointer for embedded type check
      } else if (child.type === 'raw_string_literal' || child.type === 'interpreted_string_literal') {
        tag = child.text;
      }
    }

    if (!type) {
      return null;
    }

    // Embedded type (no name, just type)
    const isEmbedded = names.length === 0;
    const fieldName = isEmbedded ? type : names[0]!;
    const isExported = /^[A-Z]/.test(fieldName);

    return {
      name: fieldName,
      type,
      tag,
      isExported,
      isEmbedded,
      startPosition: this.toPosition(node.startPosition),
      endPosition: this.toPosition(node.endPosition),
    };
  }

  /**
   * Extract interface declarations.
   */
  private extractInterfaces(root: TreeSitterNode): GoInterfaceInfo[] {
    const interfaces: GoInterfaceInfo[] = [];

    this.findNodesOfType(root, 'type_declaration', (node) => {
      for (const child of node.children) {
        if (child.type === 'type_spec') {
          const nameNode = child.childForFieldName('name');
          const typeNode = child.childForFieldName('type');

          if (nameNode && typeNode?.type === 'interface_type') {
            const interfaceInfo = this.parseInterface(nameNode.text, typeNode);
            if (interfaceInfo) {
              interfaces.push(interfaceInfo);
            }
          }
        }
      }
    });

    return interfaces;
  }

  /**
   * Parse an interface type.
   */
  private parseInterface(name: string, node: TreeSitterNode): GoInterfaceInfo | null {
    const isExported = /^[A-Z]/.test(name);
    const methods: GoInterfaceMethodInfo[] = [];
    const embeddedInterfaces: string[] = [];

    for (const child of node.children) {
      if (child.type === 'method_spec') {
        const methodInfo = this.parseInterfaceMethod(child);
        if (methodInfo) {
          methods.push(methodInfo);
        }
      } else if (child.type === 'type_identifier' || child.type === 'qualified_type') {
        // Embedded interface
        embeddedInterfaces.push(child.text);
      }
    }

    return {
      name,
      isExported,
      methods,
      embeddedInterfaces,
      startPosition: this.toPosition(node.startPosition),
      endPosition: this.toPosition(node.endPosition),
    };
  }

  /**
   * Parse an interface method signature.
   */
  private parseInterfaceMethod(node: TreeSitterNode): GoInterfaceMethodInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {
      return null;
    }

    const parametersNode = node.childForFieldName('parameters');
    const resultNode = node.childForFieldName('result');

    return {
      name: nameNode.text,
      parameters: parametersNode ? this.extractParameters(parametersNode) : [],
      returns: resultNode ? this.extractReturns(resultNode) : [],
    };
  }

  /**
   * Extract type alias declarations.
   */
  private extractTypeAliases(root: TreeSitterNode): GoTypeAliasInfo[] {
    const aliases: GoTypeAliasInfo[] = [];

    this.findNodesOfType(root, 'type_declaration', (node) => {
      for (const child of node.children) {
        if (child.type === 'type_spec') {
          const nameNode = child.childForFieldName('name');
          const typeNode = child.childForFieldName('type');

          if (nameNode && typeNode &&
              typeNode.type !== 'struct_type' &&
              typeNode.type !== 'interface_type') {
            aliases.push({
              name: nameNode.text,
              underlyingType: typeNode.text,
              isExported: /^[A-Z]/.test(nameNode.text),
              startPosition: this.toPosition(child.startPosition),
              endPosition: this.toPosition(child.endPosition),
            });
          }
        }
      }
    });

    return aliases;
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Check if a node is a type node.
   */
  private isTypeNode(node: TreeSitterNode): boolean {
    const typeNodes = [
      'type_identifier',
      'pointer_type',
      'slice_type',
      'array_type',
      'map_type',
      'channel_type',
      'function_type',
      'qualified_type',
      'struct_type',
      'interface_type',
    ];
    return typeNodes.includes(node.type);
  }

  /**
   * Convert tree-sitter AST to drift AST format.
   */
  private convertToAST(node: TreeSitterNode, source: string): AST {
    const rootNode = this.convertNode(node);
    return {
      rootNode,
      text: source,
    };
  }

  /**
   * Convert a single tree-sitter node to drift ASTNode.
   */
  private convertNode(node: TreeSitterNode): ASTNode {
    const children: ASTNode[] = [];

    for (const child of node.children) {
      children.push(this.convertNode(child));
    }

    return {
      type: this.mapNodeType(node.type),
      text: node.text,
      children,
      startPosition: this.toPosition(node.startPosition),
      endPosition: this.toPosition(node.endPosition),
    };
  }

  /**
   * Map tree-sitter node types to drift node types.
   */
  private mapNodeType(type: string): string {
    const typeMap: Record<string, string> = {
      source_file: 'Program',
      package_clause: 'PackageDeclaration',
      import_declaration: 'ImportDeclaration',
      function_declaration: 'FunctionDeclaration',
      method_declaration: 'MethodDeclaration',
      type_declaration: 'TypeDeclaration',
      struct_type: 'StructType',
      interface_type: 'InterfaceType',
      identifier: 'Identifier',
      type_identifier: 'TypeIdentifier',
      block: 'Block',
      return_statement: 'ReturnStatement',
      if_statement: 'IfStatement',
      for_statement: 'ForStatement',
      go_statement: 'GoStatement',
      defer_statement: 'DeferStatement',
      call_expression: 'CallExpression',
      selector_expression: 'SelectorExpression',
    };

    return typeMap[type] ?? type;
  }

  /**
   * Convert tree-sitter position to drift Position.
   */
  private toPosition(point: { row: number; column: number }): Position {
    return {
      row: point.row,
      column: point.column,
    };
  }

  /**
   * Find a child node by type.
   */
  private findChildByType(node: TreeSitterNode, type: string): TreeSitterNode | null {
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
  private findNodesOfType(
    node: TreeSitterNode,
    type: string,
    callback: (node: TreeSitterNode) => void
  ): void {
    if (node.type === type) {
      callback(node);
    }
    for (const child of node.children) {
      this.findNodesOfType(child, type, callback);
    }
  }

  /**
   * Create an error result.
   */
  private createErrorResult(message: string): GoParseResult {
    return {
      success: false,
      language: 'go',
      ast: null,
      errors: [
        {
          message,
          position: { row: 0, column: 0 },
        },
      ],
      package: null,
      imports: [],
      functions: [],
      methods: [],
      structs: [],
      interfaces: [],
      typeAliases: [],
    };
  }
}
