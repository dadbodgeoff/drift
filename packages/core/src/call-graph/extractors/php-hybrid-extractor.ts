/**
 * PHP Hybrid Extractor
 *
 * Combines tree-sitter (primary) with regex fallback for enterprise-grade
 * PHP code extraction.
 */

import { HybridExtractorBase } from './hybrid-extractor-base.js';
import { PhpRegexExtractor } from './regex/php-regex.js';
import {
  isPhpTreeSitterAvailable,
  createPhpParser,
} from '../../parsers/tree-sitter/php-loader.js';

import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type { CallGraphLanguage, FileExtractionResult } from '../types.js';
import type { HybridExtractorConfig } from './types.js';

/**
 * PHP hybrid extractor with tree-sitter + regex fallback
 */
export class PhpHybridExtractor extends HybridExtractorBase {
  readonly language: CallGraphLanguage = 'php';
  readonly extensions: string[] = ['.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.phps'];
  protected regexExtractor = new PhpRegexExtractor();

  private parser: TreeSitterParser | null = null;

  constructor(config?: HybridExtractorConfig) {
    super(config);
  }

  protected isTreeSitterAvailable(): boolean {
    return isPhpTreeSitterAvailable();
  }

  protected extractWithTreeSitter(source: string, filePath: string): FileExtractionResult | null {
    if (!isPhpTreeSitterAvailable()) {
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
        this.parser = createPhpParser();
      }

      if (this.parser) {
        const tree = this.parser.parse(source);
        this.visitNode(tree.rootNode, result, source, null);
      }

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  private visitNode(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentClass: string | null
  ): void {
    switch (node.type) {
      case 'function_definition':
        this.extractFunctionDefinition(node, result, currentClass);
        break;

      case 'method_declaration':
        if (currentClass) {
          this.extractMethodDeclaration(node, result, currentClass);
        }
        break;

      case 'class_declaration':
        this.extractClassDeclaration(node, result, source);
        break;

      case 'interface_declaration':
        this.extractInterfaceDeclaration(node, result);
        break;

      case 'trait_declaration':
        this.extractTraitDeclaration(node, result, source);
        break;

      case 'namespace_use_declaration':
        this.extractUseDeclaration(node, result);
        break;

      case 'function_call_expression':
      case 'member_call_expression':
      case 'scoped_call_expression':
        this.extractCallExpression(node, result);
        break;

      case 'object_creation_expression':
        this.extractObjectCreation(node, result);
        break;

      default:
        for (const child of node.children) {
          this.visitNode(child, result, source, currentClass);
        }
    }
  }

  private extractFunctionDefinition(
    node: TreeSitterNode,
    result: FileExtractionResult,
    currentClass: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const parametersNode = node.childForFieldName('parameters');
    const returnTypeNode = node.childForFieldName('return_type');
    const bodyNode = node.childForFieldName('body');

    const funcResult: FileExtractionResult['functions'][0] = {
      name,
      qualifiedName: currentClass ? `${currentClass}.${name}` : name,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters: parametersNode ? this.extractParameters(parametersNode) : [],
      isMethod: !!currentClass,
      isStatic: false,
      isExported: true,
      isConstructor: name === '__construct',
      isAsync: false,
      decorators: [],
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    };

    if (returnTypeNode) {
      funcResult.returnType = returnTypeNode.text;
    }
    if (currentClass) {
      funcResult.className = currentClass;
    }

    result.functions.push(funcResult);

    // Extract calls from body
    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result);
    }
  }

  private extractMethodDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    className: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const parametersNode = node.childForFieldName('parameters');
    const returnTypeNode = node.childForFieldName('return_type');
    const bodyNode = node.childForFieldName('body');

    // Check modifiers
    let isStatic = false;
    let isPublic = true;
    for (const child of node.children) {
      if (child.type === 'static_modifier') {isStatic = true;}
      if (child.type === 'visibility_modifier') {
        isPublic = child.text === 'public';
      }
    }

    const funcResult: FileExtractionResult['functions'][0] = {
      name,
      qualifiedName: `${className}.${name}`,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters: parametersNode ? this.extractParameters(parametersNode) : [],
      isMethod: true,
      isStatic,
      isExported: isPublic,
      isConstructor: name === '__construct',
      isAsync: false,
      className,
      decorators: [],
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    };

    if (returnTypeNode) {
      funcResult.returnType = returnTypeNode.text;
    }

    result.functions.push(funcResult);

    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result);
    }
  }

  private extractClassDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const baseClasses: string[] = [];
    const methods: string[] = [];

    // Get base class
    const baseClauseNode = node.childForFieldName('base_clause');
    if (baseClauseNode) {
      for (const child of baseClauseNode.children) {
        if (child.type === 'name' || child.type === 'qualified_name') {
          baseClasses.push(child.text);
        }
      }
    }

    // Get interfaces
    const interfaceClauseNode = node.childForFieldName('interfaces');
    if (interfaceClauseNode) {
      for (const child of interfaceClauseNode.children) {
        if (child.type === 'name' || child.type === 'qualified_name') {
          baseClasses.push(child.text);
        }
      }
    }

    // Get methods
    const bodyNode = node.childForFieldName('body');
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'method_declaration') {
          const methodNameNode = child.childForFieldName('name');
          if (methodNameNode) {
            methods.push(methodNameNode.text);
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
      isExported: true,
    });

    // Visit class body with class context
    if (bodyNode) {
      for (const child of bodyNode.children) {
        this.visitNode(child, result, source, name);
      }
    }
  }

  private extractInterfaceDeclaration(node: TreeSitterNode, result: FileExtractionResult): void {
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

  private extractTraitDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const methods: string[] = [];

    const bodyNode = node.childForFieldName('body');
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'method_declaration') {
          const methodNameNode = child.childForFieldName('name');
          if (methodNameNode) {
            methods.push(methodNameNode.text);
          }
        }
      }
    }

    result.classes.push({
      name,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      baseClasses: [],
      methods,
      isExported: true,
    });

    if (bodyNode) {
      for (const child of bodyNode.children) {
        this.visitNode(child, result, source, name);
      }
    }
  }

  private extractUseDeclaration(node: TreeSitterNode, result: FileExtractionResult): void {
    for (const child of node.children) {
      if (child.type === 'namespace_use_clause') {
        const nameNode = child.childForFieldName('name');
        const aliasNode = child.childForFieldName('alias');
        
        if (nameNode) {
          const source = nameNode.text;
          const local = aliasNode?.text ?? source.split('\\').pop() ?? source;
          
          result.imports.push({
            source,
            names: [{ imported: source, local, isDefault: false, isNamespace: false }],
            line: node.startPosition.row + 1,
            isTypeOnly: false,
          });
        }
      }
    }
  }

  private extractCallExpression(node: TreeSitterNode, result: FileExtractionResult): void {
    let calleeName: string;
    let receiver: string | undefined;
    let isMethodCall = false;

    if (node.type === 'function_call_expression') {
      const funcNode = node.childForFieldName('function');
      calleeName = funcNode?.text ?? 'unknown';
    } else if (node.type === 'member_call_expression') {
      const objectNode = node.childForFieldName('object');
      const nameNode = node.childForFieldName('name');
      receiver = objectNode?.text;
      calleeName = nameNode?.text ?? 'unknown';
      isMethodCall = true;
    } else if (node.type === 'scoped_call_expression') {
      const scopeNode = node.childForFieldName('scope');
      const nameNode = node.childForFieldName('name');
      receiver = scopeNode?.text;
      calleeName = nameNode?.text ?? 'unknown';
      isMethodCall = true;
    } else {
      return;
    }

    const argsNode = node.childForFieldName('arguments');
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
      isConstructorCall: false,
    });
  }

  private extractObjectCreation(node: TreeSitterNode, result: FileExtractionResult): void {
    const typeNode = node.childForFieldName('type');
    if (!typeNode) {return;}

    const calleeName = typeNode.text;
    const argsNode = node.childForFieldName('arguments');
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
      fullExpression: `new ${calleeName}`,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      argumentCount,
      isMethodCall: false,
      isConstructorCall: true,
    });
  }

  private extractCallsFromBody(node: TreeSitterNode, result: FileExtractionResult): void {
    const visit = (n: TreeSitterNode): void => {
      if (n.type === 'function_call_expression' ||
          n.type === 'member_call_expression' ||
          n.type === 'scoped_call_expression') {
        this.extractCallExpression(n, result);
      } else if (n.type === 'object_creation_expression') {
        this.extractObjectCreation(n, result);
      }

      for (const child of n.children) {
        visit(child);
      }
    };

    for (const child of node.children) {
      visit(child);
    }
  }

  private extractParameters(node: TreeSitterNode): FileExtractionResult['functions'][0]['parameters'] {
    const params: FileExtractionResult['functions'][0]['parameters'] = [];

    for (const child of node.children) {
      if (child.type === 'simple_parameter' || child.type === 'variadic_parameter') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');
        const defaultNode = child.childForFieldName('default_value');

        if (nameNode) {
          params.push({
            name: nameNode.text.replace(/^\$/, ''),
            type: typeNode?.text,
            hasDefault: !!defaultNode,
            isRest: child.type === 'variadic_parameter',
          });
        }
      }
    }

    return params;
  }
}

export function createPhpHybridExtractor(config?: HybridExtractorConfig): PhpHybridExtractor {
  return new PhpHybridExtractor(config);
}
