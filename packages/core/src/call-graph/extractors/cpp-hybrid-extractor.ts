/**
 * C++ Hybrid Extractor
 *
 * Combines tree-sitter (primary) with regex fallback for enterprise-grade
 * C++ code extraction. Provides confidence tracking and graceful degradation.
 *
 * @requirements C++ Language Support
 * @license Apache-2.0
 */

import { HybridExtractorBase } from './hybrid-extractor-base.js';
import { CppRegexExtractor } from './regex/cpp-regex.js';
import { isCppTreeSitterAvailable, createCppParser } from '../../parsers/tree-sitter/cpp-loader.js';

import type { CallGraphLanguage, FileExtractionResult, ParameterInfo } from '../types.js';
import type { BaseRegexExtractor } from './regex/base-regex-extractor.js';
import type { HybridExtractorConfig } from './types.js';
import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';

/**
 * C++ hybrid extractor combining tree-sitter and regex
 */
export class CppHybridExtractor extends HybridExtractorBase {
  readonly language: CallGraphLanguage = 'cpp';
  readonly extensions: string[] = ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h++', '.h'];
  protected regexExtractor: BaseRegexExtractor = new CppRegexExtractor();

  private parser: TreeSitterParser | null = null;
  private currentAccessSpecifier: 'public' | 'protected' | 'private' | 'none' = 'none';
  private currentNamespace: string = '';
  private currentClass: string | null = null;

  constructor(config?: HybridExtractorConfig) {
    super(config);
  }

  /**
   * Check if tree-sitter is available for C++
   */
  protected isTreeSitterAvailable(): boolean {
    return isCppTreeSitterAvailable();
  }

  /**
   * Extract using tree-sitter
   */
  protected extractWithTreeSitter(source: string, filePath: string): FileExtractionResult | null {
    if (!isCppTreeSitterAvailable()) {
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
        this.parser = createCppParser();
      }

      const tree = this.parser.parse(source);
      this.currentNamespace = '';
      this.currentAccessSpecifier = 'none';
      this.currentClass = null;

      this.visitNode(tree.rootNode, result, source);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Visit a tree-sitter node and extract information
   */
  private visitNode(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    switch (node.type) {
      case 'function_definition':
        this.extractFunctionDefinition(node, result, source);
        break;

      case 'declaration':
        this.extractDeclaration(node, result, source);
        break;

      case 'class_specifier':
      case 'struct_specifier':
        this.extractClassSpecifier(node, result, source);
        return; // Don't recurse, handled internally

      case 'enum_specifier':
        this.extractEnumSpecifier(node, result);
        break;

      case 'namespace_definition':
        this.extractNamespaceDefinition(node, result, source);
        return; // Don't recurse, handled internally

      case 'preproc_include':
        this.extractInclude(node, result);
        break;

      case 'access_specifier':
        this.updateAccessSpecifier(node);
        break;

      case 'template_declaration':
        this.extractTemplateDeclaration(node, result, source);
        return; // Don't recurse, handled internally

      case 'call_expression':
        this.extractCallExpression(node, result);
        break;

      default:
        // Recurse into children
        for (const child of node.children) {
          this.visitNode(child, result, source);
        }
    }
  }

  /**
   * Extract function definition
   */
  private extractFunctionDefinition(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    const declaratorNode = node.childForFieldName('declarator');
    if (!declaratorNode) {return;}

    const { name, className } = this.extractFunctionName(declaratorNode);
    if (!name) {return;}

    const typeNode = node.childForFieldName('type');
    const bodyNode = node.childForFieldName('body');

    const qualifiedName = this.buildQualifiedName(name, className ?? this.currentClass);

    result.functions.push({
      name,
      qualifiedName,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters: this.extractParameters(declaratorNode),
      returnType: typeNode ? this.extractType(typeNode) : undefined,
      isMethod: !!(className ?? this.currentClass),
      isStatic: this.hasSpecifier(node, 'static'),
      isExported: true,
      isConstructor: name === (className ?? this.currentClass),
      isAsync: false,
      className: className ?? this.currentClass ?? undefined,
      moduleName: this.currentNamespace || undefined,
      decorators: this.extractAttributes(node),
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });

    // Extract calls from body
    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result);
    }
  }

  /**
   * Extract declaration (function declarations, variable declarations)
   */
  private extractDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    const declaratorNode = node.childForFieldName('declarator');
    if (!declaratorNode) {return;}

    // Check if this is a function declaration
    if (!this.isFunctionDeclarator(declaratorNode)) {return;}

    const { name, className } = this.extractFunctionName(declaratorNode);
    if (!name) {return;}

    const typeNode = node.childForFieldName('type');
    const qualifiedName = this.buildQualifiedName(name, className ?? this.currentClass);

    result.functions.push({
      name,
      qualifiedName,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters: this.extractParameters(declaratorNode),
      returnType: typeNode ? this.extractType(typeNode) : undefined,
      isMethod: !!(className ?? this.currentClass),
      isStatic: this.hasSpecifier(node, 'static'),
      isExported: true,
      isConstructor: name === (className ?? this.currentClass),
      isAsync: false,
      className: className ?? this.currentClass ?? undefined,
      moduleName: this.currentNamespace || undefined,
      decorators: this.extractAttributes(node),
      bodyStartLine: node.startPosition.row + 1,
      bodyEndLine: node.endPosition.row + 1,
    });
  }

  /**
   * Extract class/struct specifier
   */
  private extractClassSpecifier(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const bodyNode = node.childForFieldName('body');

    // Extract base classes
    const baseClasses: string[] = [];
    for (const child of node.children) {
      if (child.type === 'base_class_clause') {
        for (const baseChild of child.children) {
          if (baseChild.type === 'type_identifier' || baseChild.type === 'qualified_identifier') {
            baseClasses.push(baseChild.text);
          }
        }
      }
    }

    const methods: string[] = [];

    // Save context
    const savedClass = this.currentClass;
    const savedAccessSpecifier = this.currentAccessSpecifier;
    this.currentClass = name;
    this.currentAccessSpecifier = node.type === 'class_specifier' ? 'private' : 'public';

    // Extract members from body
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'access_specifier') {
          this.updateAccessSpecifier(child);
        } else if (child.type === 'function_definition') {
          this.extractFunctionDefinition(child, result, source);
          const fnName = this.extractFunctionNameFromNode(child);
          if (fnName) {methods.push(fnName);}
        } else if (child.type === 'declaration') {
          if (this.isFunctionDeclarator(child.childForFieldName('declarator'))) {
            this.extractDeclaration(child, result, source);
            const fnName = this.extractFunctionNameFromNode(child);
            if (fnName) {methods.push(fnName);}
          }
        } else if (child.type === 'template_declaration') {
          this.extractTemplateDeclaration(child, result, source);
        }
      }
    }

    // Restore context
    this.currentClass = savedClass;
    this.currentAccessSpecifier = savedAccessSpecifier;

    result.classes.push({
      name,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      baseClasses,
      methods,
      isExported: true,
    });
  }

  /**
   * Extract enum specifier
   */
  private extractEnumSpecifier(node: TreeSitterNode, result: FileExtractionResult): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    result.classes.push({
      name: nameNode.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      baseClasses: [],
      methods: [],
      isExported: true,
    });
  }

  /**
   * Extract namespace definition
   */
  private extractNamespaceDefinition(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const nameNode = node.childForFieldName('name');
    const bodyNode = node.childForFieldName('body');

    const name = nameNode?.text ?? '';

    // Save and update namespace context
    const savedNamespace = this.currentNamespace;
    this.currentNamespace = this.currentNamespace
      ? `${this.currentNamespace}::${name}`
      : name;

    // Process namespace body
    if (bodyNode) {
      for (const child of bodyNode.children) {
        this.visitNode(child, result, source);
      }
    }

    this.currentNamespace = savedNamespace;
  }

  /**
   * Extract include directive
   */
  private extractInclude(node: TreeSitterNode, result: FileExtractionResult): void {
    const pathNode = node.childForFieldName('path');
    if (!pathNode) {return;}

    const pathText = pathNode.text;
    const isSystem = pathText.startsWith('<');
    const path = pathText.replace(/^[<"]|[>"]$/g, '');

    result.imports.push({
      source: path,
      names: [{
        imported: path,
        local: path,
        isDefault: false,
        isNamespace: false,
      }],
      line: node.startPosition.row + 1,
      isTypeOnly: isSystem,
    });
  }

  /**
   * Extract template declaration
   */
  private extractTemplateDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    // Find the templated declaration
    for (const child of node.children) {
      if (child.type === 'function_definition') {
        this.extractFunctionDefinition(child, result, source);
      } else if (child.type === 'declaration') {
        this.extractDeclaration(child, result, source);
      } else if (child.type === 'class_specifier' || child.type === 'struct_specifier') {
        this.extractClassSpecifier(child, result, source);
      }
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

    if (funcNode.type === 'qualified_identifier') {
      calleeName = funcNode.text;
      const parts = calleeName.split('::');
      if (parts.length > 1) {
        receiver = parts.slice(0, -1).join('::');
        calleeName = parts[parts.length - 1] ?? calleeName;
      }
    } else if (funcNode.type === 'field_expression') {
      const fieldNode = funcNode.childForFieldName('field');
      const argNode = funcNode.childForFieldName('argument');
      if (fieldNode && argNode) {
        receiver = argNode.text;
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

    const argumentCount = argsNode ? this.countArguments(argsNode) : 0;

    result.calls.push({
      calleeName,
      receiver,
      fullExpression: node.text,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      argumentCount,
      isMethodCall,
      isConstructorCall: /^[A-Z]/.test(calleeName) && !calleeName.includes('::'),
    });
  }

  /**
   * Extract calls from a function body
   */
  private extractCallsFromBody(node: TreeSitterNode, result: FileExtractionResult): void {
    const visit = (n: TreeSitterNode): void => {
      if (n.type === 'call_expression') {
        this.extractCallExpression(n, result);
      }

      for (const child of n.children) {
        visit(child);
      }
    };

    for (const child of node.children) {
      visit(child);
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private extractFunctionName(declaratorNode: TreeSitterNode): { name: string | null; className: string | null } {
    let name: string | null = null;
    let className: string | null = null;

    const visit = (n: TreeSitterNode): void => {
      if (n.type === 'identifier') {
        name = n.text;
      } else if (n.type === 'field_identifier') {
        name = n.text;
      } else if (n.type === 'qualified_identifier') {
        const parts = n.text.split('::');
        name = parts[parts.length - 1] ?? null;
        if (parts.length > 1) {
          className = parts.slice(0, -1).join('::');
        }
      } else if (n.type === 'destructor_name') {
        name = n.text;
      } else if (n.type === 'operator_name') {
        name = n.text;
      } else if (n.type === 'function_declarator') {
        const innerDeclarator = n.childForFieldName('declarator');
        if (innerDeclarator) {
          visit(innerDeclarator);
        }
      } else if (n.type === 'pointer_declarator' || n.type === 'reference_declarator') {
        for (const child of n.children) {
          visit(child);
        }
      }
    };

    visit(declaratorNode);
    return { name, className };
  }

  private extractFunctionNameFromNode(node: TreeSitterNode): string | null {
    const declaratorNode = node.childForFieldName('declarator');
    if (!declaratorNode) {return null;}
    const { name } = this.extractFunctionName(declaratorNode);
    return name;
  }

  private buildQualifiedName(name: string, className: string | null): string {
    const parts: string[] = [];
    if (this.currentNamespace) {
      parts.push(this.currentNamespace);
    }
    if (className) {
      parts.push(className);
    }
    parts.push(name);
    return parts.join('::');
  }

  private extractParameters(declaratorNode: TreeSitterNode): ParameterInfo[] {
    const params: ParameterInfo[] = [];

    const findParams = (n: TreeSitterNode): TreeSitterNode | null => {
      if (n.type === 'function_declarator') {
        return n.childForFieldName('parameters');
      }
      for (const child of n.children) {
        const result = findParams(child);
        if (result) {return result;}
      }
      return null;
    };

    const paramsNode = findParams(declaratorNode);
    if (!paramsNode) {return params;}

    for (const child of paramsNode.children) {
      if (child.type === 'parameter_declaration') {
        const typeNode = child.childForFieldName('type');
        const declarator = child.childForFieldName('declarator');
        const defaultValue = child.childForFieldName('default_value');

        const typeText = typeNode?.text ?? 'unknown';
        let name = 'unnamed';

        if (declarator) {
          const { name: paramName } = this.extractFunctionName(declarator);
          if (paramName) {name = paramName;}
        }

        params.push({ name, type: typeText, hasDefault: !!defaultValue, isRest: false });
      }
    }

    return params;
  }

  private extractType(typeNode: TreeSitterNode): string {
    return typeNode.text;
  }

  private hasSpecifier(node: TreeSitterNode, specifier: string): boolean {
    for (const child of node.children) {
      if (child.type === 'storage_class_specifier' || child.type === 'type_qualifier') {
        if (child.text === specifier) {return true;}
      }
      if (child.text === specifier) {return true;}
    }
    return false;
  }

  private isFunctionDeclarator(node: TreeSitterNode | null): boolean {
    if (!node) {return false;}

    const visit = (n: TreeSitterNode): boolean => {
      if (n.type === 'function_declarator') {return true;}
      for (const child of n.children) {
        if (visit(child)) {return true;}
      }
      return false;
    };

    return visit(node);
  }

  private updateAccessSpecifier(node: TreeSitterNode): void {
    const text = node.text.replace(':', '').trim();
    if (text === 'public') {this.currentAccessSpecifier = 'public';}
    else if (text === 'protected') {this.currentAccessSpecifier = 'protected';}
    else if (text === 'private') {this.currentAccessSpecifier = 'private';}
  }

  private extractAttributes(node: TreeSitterNode): string[] {
    const attributes: string[] = [];

    let sibling = node.previousSibling;
    while (sibling) {
      if (sibling.type === 'attribute_declaration') {
        attributes.push(sibling.text);
      } else if (sibling.type !== 'comment') {
        break;
      }
      sibling = sibling.previousSibling;
    }

    return attributes.reverse();
  }

  private countArguments(argsNode: TreeSitterNode): number {
    let count = 0;
    for (const child of argsNode.children) {
      if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
        count++;
      }
    }
    return count;
  }
}

/**
 * Create a C++ hybrid extractor instance
 */
export function createCppHybridExtractor(config?: HybridExtractorConfig): CppHybridExtractor {
  return new CppHybridExtractor(config);
}
