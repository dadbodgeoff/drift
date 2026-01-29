/**
 * Go Hybrid Extractor
 *
 * Combines tree-sitter (primary) with regex fallback for enterprise-grade
 * Go code extraction. Provides confidence tracking and graceful degradation.
 */

import { HybridExtractorBase } from './hybrid-extractor-base.js';
import { GoRegexExtractor } from './regex/go-regex.js';
import { isGoTreeSitterAvailable, createGoParser } from '../../parsers/tree-sitter/go-loader.js';

import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type { CallGraphLanguage, FileExtractionResult, ParameterInfo } from '../types.js';
import type { HybridExtractorConfig } from './types.js';

/**
 * Go hybrid extractor combining tree-sitter and regex
 */
export class GoHybridExtractor extends HybridExtractorBase {
  readonly language: CallGraphLanguage = 'go';
  readonly extensions: string[] = ['.go'];
  protected regexExtractor = new GoRegexExtractor();

  private parser: TreeSitterParser | null = null;

  constructor(config?: HybridExtractorConfig) {
    super(config);
  }

  /**
   * Check if tree-sitter is available for Go
   */
  protected isTreeSitterAvailable(): boolean {
    return isGoTreeSitterAvailable();
  }

  /**
   * Extract using tree-sitter
   */
  protected extractWithTreeSitter(source: string, filePath: string): FileExtractionResult | null {
    if (!isGoTreeSitterAvailable()) {
      return null;
    }

    const result: FileExtractionResult = {
      file: filePath,
      language: this.language,
      functions: [],
      calls: [],
      imports: [],
      exports: [],
      classes: [],
      errors: [],
    };

    try {
      if (!this.parser) {
        this.parser = createGoParser();
      }

      const tree = this.parser.parse(source);
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
        this.extractTypeDeclaration(node, result, currentPackage);
        break;

      case 'import_declaration':
        this.extractImportDeclaration(node, result);
        break;

      case 'call_expression':
        this.extractCallExpression(node, result);
        break;

      case 'go_statement':
        this.extractGoStatement(node, result);
        break;

      case 'defer_statement':
        this.extractDeferStatement(node, result);
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
    _source: string,
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

    result.functions.push({
      name,
      qualifiedName: `${currentPackage}.${name}`,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters,
      returnType,
      isMethod: false,
      isStatic: true,
      isExported,
      isConstructor: name === 'New' || name.startsWith('New'),
      isAsync: false,
      decorators: [],
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });

    // Extract calls from body
    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result);
    }
  }

  /**
   * Extract a method declaration
   */
  private extractMethodDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string,
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

    result.functions.push({
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

    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result);
    }
  }

  /**
   * Extract receiver type from receiver node
   */
  private extractReceiverType(receiverNode: TreeSitterNode): string {
    for (const child of receiverNode.children) {
      if (child.type === 'parameter_declaration') {
        const typeNode = child.childForFieldName('type');
        if (typeNode) {
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
    const baseClasses: string[] = [];

    const fieldListNode =
      node.childForFieldName('fields') ?? node.children.find((c) => c.type === 'field_declaration_list');
    if (fieldListNode) {
      for (const field of fieldListNode.children) {
        if (field.type === 'field_declaration') {
          const hasName = field.children.some((c) => c.type === 'field_identifier');
          if (!hasName) {
            const typeNode = field.children.find(
              (c) =>
                c.type === 'type_identifier' || c.type === 'pointer_type' || c.type === 'qualified_type'
            );
            if (typeNode) {
              const typeName = typeNode.text.replace(/^\*/, '');
              baseClasses.push(typeName);
            }
          }
        }
      }
    }

    result.classes.push({
      name,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      baseClasses,
      methods,
      isExported,
    });
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
    const baseClasses: string[] = [];

    for (const child of node.children) {
      if (child.type === 'method_spec') {
        const methodName = child.childForFieldName('name');
        if (methodName) {
          methods.push(methodName.text);
        }
      } else if (child.type === 'type_identifier') {
        baseClasses.push(child.text);
      }
    }

    result.classes.push({
      name,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      baseClasses,
      methods,
      isExported,
    });
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

      const packageName = path.split('/').pop() ?? path;

      result.imports.push({
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
        isTypeOnly: false,
      });
    }
  }

  /**
   * Extract call expression
   */
  private extractCallExpression(node: TreeSitterNode, result: FileExtractionResult): void {
    const funcNode = node.childForFieldName('function');
    const argsNode = node.childForFieldName('arguments');

    if (!funcNode) {return;}

    let calleeName: string;
    let receiver: string | undefined;
    let isMethodCall = false;

    if (funcNode.type === 'selector_expression') {
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

    result.calls.push({
      calleeName,
      receiver,
      fullExpression: node.text,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      argumentCount,
      isMethodCall,
      isConstructorCall: calleeName === 'New' || calleeName.startsWith('New'),
    });
  }

  /**
   * Extract go statement (goroutine)
   */
  private extractGoStatement(node: TreeSitterNode, result: FileExtractionResult): void {
    const callNode = node.namedChildren[0];
    if (callNode?.type === 'call_expression') {
      this.extractCallExpression(callNode, result);
    }
  }

  /**
   * Extract defer statement
   */
  private extractDeferStatement(node: TreeSitterNode, result: FileExtractionResult): void {
    const callNode = node.namedChildren[0];
    if (callNode?.type === 'call_expression') {
      this.extractCallExpression(callNode, result);
    }
  }

  /**
   * Extract calls from a function body
   */
  private extractCallsFromBody(node: TreeSitterNode, result: FileExtractionResult): void {
    const visit = (n: TreeSitterNode): void => {
      if (n.type === 'call_expression') {
        this.extractCallExpression(n, result);
      } else if (n.type === 'go_statement') {
        this.extractGoStatement(n, result);
      } else if (n.type === 'defer_statement') {
        this.extractDeferStatement(n, result);
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

        if (names.length === 0) {
          params.push({ name: '_', type, hasDefault: false, isRest: isVariadic });
        } else {
          for (const name of names) {
            params.push({ name, type, hasDefault: false, isRest: isVariadic });
          }
        }
      } else if (child.type === 'variadic_parameter_declaration') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');
        const name = nameNode?.text ?? '_';
        const type = typeNode?.text;
        params.push({ name, type, hasDefault: false, isRest: true });
      }
    }

    return params;
  }

  /**
   * Extract return type
   */
  private extractReturnType(node: TreeSitterNode): string {
    if (node.type === 'parameter_list') {
      const types: string[] = [];
      for (const child of node.children) {
        if (child.type === 'parameter_declaration') {
          const typeNode = child.childForFieldName('type');
          if (typeNode) {types.push(typeNode.text);}
          else {
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
 * Create a Go hybrid extractor instance
 */
export function createGoHybridExtractor(config?: HybridExtractorConfig): GoHybridExtractor {
  return new GoHybridExtractor(config);
}
