/**
 * Go Call Graph Extractor
 *
 * Extracts functions, calls, imports, and exports from Go
 * using tree-sitter for AST parsing.
 *
 * Handles:
 * - Function definitions (regular and methods)
 * - Struct and interface definitions
 * - Package imports
 * - Method calls and function calls
 * - Goroutines (go statements)
 * - Defer statements
 * - Interface implementations
 * - Embedded types
 */

import { BaseCallGraphExtractor } from './base-extractor.js';
import {
  isGoTreeSitterAvailable,
  createGoParser,
} from '../../parsers/tree-sitter/go-loader.js';

import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type {
  CallGraphLanguage,
  FileExtractionResult,
  ParameterInfo,
} from '../types.js';

/**
 * Go call graph extractor using tree-sitter
 */
export class GoCallGraphExtractor extends BaseCallGraphExtractor {
  readonly language: CallGraphLanguage = 'go';
  readonly extensions: string[] = ['.go'];

  private parser: TreeSitterParser | null = null;

  /**
   * Check if tree-sitter is available
   */
  static isAvailable(): boolean {
    return isGoTreeSitterAvailable();
  }

  /**
   * Extract call graph information from Go source
   */
  extract(source: string, filePath: string): FileExtractionResult {
    const result = this.createEmptyResult(filePath);

    if (!isGoTreeSitterAvailable()) {
      result.errors.push('Tree-sitter not available for Go parsing');
      return result;
    }

    try {
      if (!this.parser) {
        this.parser = createGoParser();
      }

      const tree = this.parser.parse(source);

      // Extract package name
      const packageName = this.extractPackageName(tree.rootNode);

      this.visitNode(tree.rootNode, result, source, null, packageName);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Extract package name from root node
   */
  private extractPackageName(root: TreeSitterNode): string {
    for (const child of root.children) {
      if (child.type === 'package_clause') {
        const nameNode = child.children.find((c) => c.type === 'package_identifier');
        return nameNode?.text ?? 'main';
      }
    }
    return 'main';
  }

  /**
   * Visit a tree-sitter node and extract information
   */
  private visitNode(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentStruct: string | null,
    currentPackage: string
  ): void {
    switch (node.type) {
      case 'function_declaration':
        this.extractFunctionDeclaration(node, result, source, currentPackage);
        break;

      case 'method_declaration':
        this.extractMethodDeclaration(node, result, source, currentPackage);
        break;

      case 'type_declaration':
        this.extractTypeDeclaration(node, result, source, currentPackage);
        break;

      case 'import_declaration':
        this.extractImportDeclaration(node, result);
        break;

      case 'call_expression':
        this.extractCallExpression(node, result, source);
        break;

      case 'go_statement':
        this.extractGoStatement(node, result, source);
        break;

      case 'defer_statement':
        this.extractDeferStatement(node, result, source);
        break;

      default:
        // Recurse into children
        for (const child of node.children) {
          this.visitNode(child, result, source, currentStruct, currentPackage);
        }
    }
  }

  /**
   * Extract a function declaration
   */
  private extractFunctionDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentPackage: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const isExported = /^[A-Z]/.test(name);
    const parametersNode = node.childForFieldName('parameters');
    const resultNode = node.childForFieldName('result');
    const bodyNode = node.childForFieldName('body');

    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];
    const returnType = resultNode ? this.extractReturnType(resultNode) : undefined;

    const func = this.createFunction({
      name,
      qualifiedName: `${currentPackage}.${name}`,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters,
      returnType,
      isMethod: false,
      isStatic: true, // Go functions are effectively static
      isExported,
      isConstructor: name === 'New' || name.startsWith('New'),
      isAsync: false, // Go uses goroutines, not async
      decorators: [],
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });

    result.functions.push(func);

    // Extract calls from body
    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result, source);
    }
  }

  /**
   * Extract a method declaration
   */
  private extractMethodDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentPackage: string
  ): void {
    const nameNode = node.childForFieldName('name');
    const receiverNode = node.childForFieldName('receiver');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const isExported = /^[A-Z]/.test(name);
    const parametersNode = node.childForFieldName('parameters');
    const resultNode = node.childForFieldName('result');
    const bodyNode = node.childForFieldName('body');

    // Extract receiver info
    let className: string | undefined;
    if (receiverNode) {
      className = this.extractReceiverType(receiverNode);
    }

    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];
    const returnType = resultNode ? this.extractReturnType(resultNode) : undefined;

    const qualifiedName = className
      ? `${currentPackage}.${className}.${name}`
      : `${currentPackage}.${name}`;

    const func = this.createFunction({
      name,
      qualifiedName,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters,
      returnType,
      isMethod: true,
      isStatic: false,
      isExported,
      isConstructor: false,
      isAsync: false,
      className,
      decorators: [],
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });

    result.functions.push(func);

    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result, source);
    }
  }

  /**
   * Extract receiver type from receiver node
   */
  private extractReceiverType(receiverNode: TreeSitterNode): string {
    // (s *Server) or (s Server)
    for (const child of receiverNode.children) {
      if (child.type === 'parameter_declaration') {
        const typeNode = child.childForFieldName('type');
        if (typeNode) {
          // Handle pointer types
          if (typeNode.type === 'pointer_type') {
            const innerType = typeNode.namedChildren[0];
            return innerType?.text ?? 'unknown';
          }
          return typeNode.text;
        }
      }
    }
    return 'unknown';
  }

  /**
   * Extract type declarations (struct, interface)
   */
  private extractTypeDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string,
    _currentPackage: string
  ): void {
    for (const child of node.children) {
      if (child.type === 'type_spec') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');

        if (!nameNode || !typeNode) {continue;}

        const name = nameNode.text;
        const isExported = /^[A-Z]/.test(name);

        if (typeNode.type === 'struct_type') {
          this.extractStructType(name, typeNode, result, isExported);
        } else if (typeNode.type === 'interface_type') {
          this.extractInterfaceType(name, typeNode, result, isExported);
        }
      }
    }
  }

  /**
   * Extract struct type
   */
  private extractStructType(
    name: string,
    node: TreeSitterNode,
    result: FileExtractionResult,
    isExported: boolean
  ): void {
    const methods: string[] = [];
    const baseClasses: string[] = []; // Embedded types

    // Extract fields and embedded types
    const fieldListNode = node.childForFieldName('fields') ?? node.children.find((c) => c.type === 'field_declaration_list');
    if (fieldListNode) {
      for (const field of fieldListNode.children) {
        if (field.type === 'field_declaration') {
          // Check for embedded type (no name, just type)
          const hasName = field.children.some((c) => c.type === 'field_identifier');
          if (!hasName) {
            const typeNode = field.children.find(
              (c) =>
                c.type === 'type_identifier' ||
                c.type === 'pointer_type' ||
                c.type === 'qualified_type'
            );
            if (typeNode) {
              const typeName = typeNode.text.replace(/^\*/, '');
              baseClasses.push(typeName);
            }
          }
        }
      }
    }

    result.classes.push(
      this.createClass({
        name,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        baseClasses,
        methods,
        isExported,
      })
    );
  }

  /**
   * Extract interface type
   */
  private extractInterfaceType(
    name: string,
    node: TreeSitterNode,
    result: FileExtractionResult,
    isExported: boolean
  ): void {
    const methods: string[] = [];
    const baseClasses: string[] = []; // Embedded interfaces

    for (const child of node.children) {
      if (child.type === 'method_spec') {
        const methodName = child.childForFieldName('name');
        if (methodName) {
          methods.push(methodName.text);
        }
      } else if (child.type === 'type_identifier') {
        // Embedded interface
        baseClasses.push(child.text);
      }
    }

    result.classes.push(
      this.createClass({
        name,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        baseClasses,
        methods,
        isExported,
      })
    );
  }

  /**
   * Extract import declaration
   */
  private extractImportDeclaration(node: TreeSitterNode, result: FileExtractionResult): void {
    const importSpecs = this.findAllNodes(node, 'import_spec');

    for (const spec of importSpecs) {
      const pathNode = spec.childForFieldName('path');
      const nameNode = spec.childForFieldName('name');

      if (!pathNode) {continue;}

      const path = pathNode.text.replace(/^"|"$/g, '');
      const alias = nameNode?.text;
      const isDotImport = alias === '.';

      // Extract package name from path
      const packageName = path.split('/').pop() ?? path;

      result.imports.push(
        this.createImport({
          source: path,
          names: [
            {
              imported: packageName,
              local: alias ?? packageName,
              isDefault: false,
              isNamespace: isDotImport,
            },
          ],
          line: spec.startPosition.row + 1,
        })
      );
    }
  }

  /**
   * Extract call expression
   */
  private extractCallExpression(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    const funcNode = node.childForFieldName('function');
    const argsNode = node.childForFieldName('arguments');

    if (!funcNode) {return;}

    let calleeName: string;
    let receiver: string | undefined;
    let isMethodCall = false;

    if (funcNode.type === 'selector_expression') {
      // obj.Method() or pkg.Function()
      const operandNode = funcNode.childForFieldName('operand');
      const fieldNode = funcNode.childForFieldName('field');

      if (operandNode && fieldNode) {
        receiver = operandNode.text;
        calleeName = fieldNode.text;
        isMethodCall = true;
      } else {
        calleeName = funcNode.text;
      }
    } else if (funcNode.type === 'identifier') {
      calleeName = funcNode.text;
    } else {
      calleeName = funcNode.text;
    }

    let argumentCount = 0;
    if (argsNode) {
      for (const child of argsNode.children) {
        if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
          argumentCount++;
        }
      }
    }

    result.calls.push(
      this.createCall({
        calleeName,
        receiver,
        fullExpression: node.text,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        argumentCount,
        isMethodCall,
        isConstructorCall: calleeName === 'New' || calleeName.startsWith('New'),
      })
    );
  }

  /**
   * Extract go statement (goroutine)
   */
  private extractGoStatement(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    // go func() or go obj.Method()
    const callNode = node.namedChildren[0];
    if (callNode?.type === 'call_expression') {
      this.extractCallExpression(callNode, result, source);
    }
  }

  /**
   * Extract defer statement
   */
  private extractDeferStatement(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    // defer func() or defer obj.Method()
    const callNode = node.namedChildren[0];
    if (callNode?.type === 'call_expression') {
      this.extractCallExpression(callNode, result, source);
    }
  }

  /**
   * Extract calls from a function body
   */
  private extractCallsFromBody(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const visit = (n: TreeSitterNode): void => {
      if (n.type === 'call_expression') {
        this.extractCallExpression(n, result, source);
      } else if (n.type === 'go_statement') {
        this.extractGoStatement(n, result, source);
      } else if (n.type === 'defer_statement') {
        this.extractDeferStatement(n, result, source);
      }

      for (const child of n.children) {
        visit(child);
      }
    };

    for (const child of node.children) {
      visit(child);
    }
  }

  /**
   * Extract parameters from parameter list
   */
  private extractParameters(node: TreeSitterNode): ParameterInfo[] {
    const params: ParameterInfo[] = [];

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
          } else if (
            paramChild.type === 'type_identifier' ||
            paramChild.type === 'pointer_type' ||
            paramChild.type === 'slice_type' ||
            paramChild.type === 'map_type' ||
            paramChild.type === 'channel_type' ||
            paramChild.type === 'function_type' ||
            paramChild.type === 'qualified_type' ||
            paramChild.type === 'array_type' ||
            paramChild.type === 'struct_type' ||
            paramChild.type === 'interface_type'
          ) {
            type = paramChild.text;
          }
        }

        // If no names, it's an unnamed parameter
        if (names.length === 0) {
          params.push(this.parseParameter('_', type, false, isVariadic));
        } else {
          for (const name of names) {
            params.push(this.parseParameter(name, type, false, isVariadic));
          }
        }
      } else if (child.type === 'variadic_parameter_declaration') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');
        const name = nameNode?.text ?? '_';
        const type = typeNode?.text;
        params.push(this.parseParameter(name, type, false, true));
      }
    }

    return params;
  }

  /**
   * Extract return type
   */
  private extractReturnType(node: TreeSitterNode): string {
    if (node.type === 'parameter_list') {
      // Multiple return values: (int, error)
      const types: string[] = [];
      for (const child of node.children) {
        if (child.type === 'parameter_declaration') {
          const typeNode = child.childForFieldName('type');
          if (typeNode) {types.push(typeNode.text);}
          else {
            // Unnamed return type
            const typeChild = child.children.find(
              (c) =>
                c.type === 'type_identifier' ||
                c.type === 'pointer_type' ||
                c.type === 'slice_type' ||
                c.type === 'map_type'
            );
            if (typeChild) {types.push(typeChild.text);}
          }
        }
      }
      return types.length > 1 ? `(${types.join(', ')})` : types[0] ?? '';
    }
    return node.text;
  }

  /**
   * Find all nodes of a specific type
   */
  private findAllNodes(node: TreeSitterNode, type: string): TreeSitterNode[] {
    const results: TreeSitterNode[] = [];

    const visit = (n: TreeSitterNode): void => {
      if (n.type === type) {
        results.push(n);
      }
      for (const child of n.children) {
        visit(child);
      }
    };

    visit(node);
    return results;
  }
}

/**
 * Create a Go extractor instance
 */
export function createGoExtractor(): GoCallGraphExtractor {
  return new GoCallGraphExtractor();
}
