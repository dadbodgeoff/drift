/**
 * C# Hybrid Extractor
 *
 * Combines tree-sitter (primary) with regex fallback for enterprise-grade
 * C# code extraction.
 */

import { HybridExtractorBase } from './hybrid-extractor-base.js';
import { CSharpRegexExtractor } from './regex/csharp-regex.js';
import {
  isCSharpTreeSitterAvailable,
  createCSharpParser,
} from '../../parsers/tree-sitter/csharp-loader.js';

import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type { CallGraphLanguage, FileExtractionResult } from '../types.js';
import type { HybridExtractorConfig } from './types.js';

/**
 * C# hybrid extractor with tree-sitter + regex fallback
 */
export class CSharpHybridExtractor extends HybridExtractorBase {
  readonly language: CallGraphLanguage = 'csharp';
  readonly extensions: string[] = ['.cs'];
  protected regexExtractor = new CSharpRegexExtractor();

  private parser: TreeSitterParser | null = null;

  constructor(config?: HybridExtractorConfig) {
    super(config);
  }

  protected isTreeSitterAvailable(): boolean {
    return isCSharpTreeSitterAvailable();
  }

  protected extractWithTreeSitter(source: string, filePath: string): FileExtractionResult | null {
    if (!isCSharpTreeSitterAvailable()) {
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
        this.parser = createCSharpParser();
      }

      const tree = this.parser.parse(source);
      this.visitNode(tree.rootNode, result, source, null, null);

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  private visitNode(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentClass: string | null,
    currentNamespace: string | null
  ): void {
    switch (node.type) {
      case 'namespace_declaration':
      case 'file_scoped_namespace_declaration':
        this.extractNamespace(node, result, source);
        break;

      case 'class_declaration':
      case 'record_declaration':
      case 'struct_declaration':
        this.extractClassDeclaration(node, result, source, currentNamespace);
        break;

      case 'interface_declaration':
        this.extractInterfaceDeclaration(node, result, source, currentNamespace);
        break;

      case 'method_declaration':
        this.extractMethodDeclaration(node, result, currentClass, currentNamespace);
        break;

      case 'constructor_declaration':
        this.extractConstructorDeclaration(node, result, currentClass);
        break;

      case 'using_directive':
        this.extractUsingDirective(node, result);
        break;

      case 'invocation_expression':
        this.extractInvocationExpression(node, result);
        break;

      case 'object_creation_expression':
        this.extractObjectCreation(node, result);
        break;

      default:
        for (const child of node.children) {
          this.visitNode(child, result, source, currentClass, currentNamespace);
        }
    }
  }

  private extractNamespace(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const nameNode = node.childForFieldName('name');
    const namespaceName = nameNode?.text ?? '';

    for (const child of node.children) {
      if (child.type === 'declaration_list' || child.type === '{') {
        for (const decl of child.children) {
          this.visitNode(decl, result, source, null, namespaceName);
        }
      } else {
        this.visitNode(child, result, source, null, namespaceName);
      }
    }
  }

  private extractClassDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentNamespace: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const className = nameNode.text;
    const fullClassName = currentNamespace ? `${currentNamespace}.${className}` : className;

    const baseClasses: string[] = [];
    const baseListNode = node.childForFieldName('bases');
    if (baseListNode) {
      for (const child of baseListNode.children) {
        if (child.type === 'identifier' || child.type === 'qualified_name' || child.type === 'generic_name') {
          baseClasses.push(child.text);
        }
      }
    }

    const methods: string[] = [];
    const bodyNode = node.children.find(c => c.type === 'declaration_list');
    if (bodyNode) {
      for (const member of bodyNode.children) {
        if (member.type === 'method_declaration') {
          const methodNameNode = member.childForFieldName('name');
          if (methodNameNode) {
            methods.push(methodNameNode.text);
          }
        }
      }
    }

    const isExported = this.hasModifier(node, 'public');

    result.classes.push({
      name: className,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      baseClasses,
      methods,
      isExported,
    });

    if (bodyNode) {
      for (const member of bodyNode.children) {
        this.visitNode(member, result, source, fullClassName, currentNamespace);
      }
    }
  }

  private extractInterfaceDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentNamespace: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const interfaceName = nameNode.text;
    const fullName = currentNamespace ? `${currentNamespace}.${interfaceName}` : interfaceName;

    const methods: string[] = [];
    const bodyNode = node.children.find(c => c.type === 'declaration_list');
    if (bodyNode) {
      for (const member of bodyNode.children) {
        if (member.type === 'method_declaration') {
          const methodNameNode = member.childForFieldName('name');
          if (methodNameNode) {
            methods.push(methodNameNode.text);
          }
        }
      }
    }

    result.classes.push({
      name: interfaceName,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      baseClasses: [],
      methods,
      isExported: this.hasModifier(node, 'public'),
    });

    if (bodyNode) {
      for (const member of bodyNode.children) {
        this.visitNode(member, result, source, fullName, currentNamespace);
      }
    }
  }


  private extractMethodDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    currentClass: string | null,
    _currentNamespace: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const isStatic = this.hasModifier(node, 'static');
    const isAsync = this.hasModifier(node, 'async');
    const isPublic = this.hasModifier(node, 'public');

    const returnTypeNode = node.childForFieldName('type');
    const returnType = returnTypeNode?.text;

    const parametersNode = node.childForFieldName('parameters');
    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];

    const decorators = this.extractAttributes(node);
    const bodyNode = node.childForFieldName('body');

    const qualifiedName = currentClass ? `${currentClass}.${name}` : name;

    result.functions.push({
      name,
      qualifiedName,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters,
      returnType,
      isMethod: currentClass !== null,
      isStatic,
      isExported: isPublic,
      isConstructor: false,
      isAsync,
      className: currentClass ?? undefined,
      decorators,
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });

    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result);
    }
  }

  private extractConstructorDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    currentClass: string | null
  ): void {
    const parametersNode = node.childForFieldName('parameters');
    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];
    const decorators = this.extractAttributes(node);
    const bodyNode = node.childForFieldName('body');

    result.functions.push({
      name: 'constructor',
      qualifiedName: currentClass ? `${currentClass}.constructor` : 'constructor',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters,
      isMethod: true,
      isStatic: false,
      isExported: this.hasModifier(node, 'public'),
      isConstructor: true,
      isAsync: false,
      className: currentClass ?? undefined,
      decorators,
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });

    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result);
    }

    const initializerNode = node.childForFieldName('initializer');
    if (initializerNode) {
      this.extractCallsFromBody(initializerNode, result);
    }
  }

  private extractUsingDirective(node: TreeSitterNode, result: FileExtractionResult): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const namespaceName = nameNode.text;

    result.imports.push({
      source: namespaceName,
      names: [{
        imported: namespaceName,
        local: namespaceName.split('.').pop() ?? namespaceName,
        isDefault: false,
        isNamespace: true,
      }],
      line: node.startPosition.row + 1,
      isTypeOnly: false,
    });
  }

  private extractInvocationExpression(node: TreeSitterNode, result: FileExtractionResult): void {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) {return;}

    let calleeName: string;
    let receiver: string | undefined;

    if (funcNode.type === 'member_access_expression') {
      const objectNode = funcNode.childForFieldName('expression');
      const nameNode = funcNode.childForFieldName('name');
      if (objectNode && nameNode) {
        receiver = objectNode.text;
        calleeName = nameNode.text;
      } else {
        calleeName = funcNode.text;
      }
    } else if (funcNode.type === 'identifier') {
      calleeName = funcNode.text;
    } else if (funcNode.type === 'generic_name') {
      const nameNode = funcNode.childForFieldName('name');
      calleeName = nameNode?.text ?? funcNode.text;
    } else {
      calleeName = funcNode.text;
    }

    const argsNode = node.childForFieldName('arguments');
    let argumentCount = 0;
    if (argsNode) {
      for (const child of argsNode.children) {
        if (child.type === 'argument') {
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
      isMethodCall: !!receiver,
      isConstructorCall: false,
    });
  }

  private extractObjectCreation(node: TreeSitterNode, result: FileExtractionResult): void {
    const typeNode = node.childForFieldName('type');
    if (!typeNode) {return;}

    let calleeName: string;
    let receiver: string | undefined;

    if (typeNode.type === 'qualified_name') {
      const parts = typeNode.text.split('.');
      calleeName = parts.pop() ?? typeNode.text;
      if (parts.length > 0) {
        receiver = parts.join('.');
      }
    } else if (typeNode.type === 'generic_name') {
      const nameNode = typeNode.childForFieldName('name');
      calleeName = nameNode?.text ?? typeNode.text;
    } else {
      calleeName = typeNode.text;
    }

    const argsNode = node.childForFieldName('arguments');
    let argumentCount = 0;
    if (argsNode) {
      for (const child of argsNode.children) {
        if (child.type === 'argument') {
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
      isMethodCall: false,
      isConstructorCall: true,
    });
  }


  private extractCallsFromBody(node: TreeSitterNode, result: FileExtractionResult): void {
    const visit = (n: TreeSitterNode): void => {
      if (n.type === 'invocation_expression') {
        this.extractInvocationExpression(n, result);
      } else if (n.type === 'object_creation_expression') {
        this.extractObjectCreation(n, result);
      }

      if (n.type !== 'local_function_statement') {
        for (const child of n.children) {
          visit(child);
        }
      }
    };

    for (const child of node.children) {
      visit(child);
    }
  }

  private extractParameters(node: TreeSitterNode): FileExtractionResult['functions'][0]['parameters'] {
    const params: FileExtractionResult['functions'][0]['parameters'] = [];

    for (const child of node.children) {
      if (child.type === 'parameter') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');
        const defaultNode = child.childForFieldName('default_value');

        if (nameNode) {
          params.push({
            name: nameNode.text,
            type: typeNode?.text,
            hasDefault: defaultNode !== null,
            isRest: false,
          });
        }
      }
    }

    return params;
  }

  private extractAttributes(node: TreeSitterNode): string[] {
    const attributes: string[] = [];

    let sibling = node.previousNamedSibling;
    while (sibling?.type === 'attribute_list') {
      for (const attr of sibling.children) {
        if (attr.type === 'attribute') {
          attributes.unshift(`[${attr.text}]`);
        }
      }
      sibling = sibling.previousNamedSibling;
    }

    return attributes;
  }

  private hasModifier(node: TreeSitterNode, modifier: string): boolean {
    for (const child of node.children) {
      if (child.type === 'modifier' && child.text === modifier) {
        return true;
      }
    }
    return false;
  }
}

export function createCSharpHybridExtractor(config?: HybridExtractorConfig): CSharpHybridExtractor {
  return new CSharpHybridExtractor(config);
}
