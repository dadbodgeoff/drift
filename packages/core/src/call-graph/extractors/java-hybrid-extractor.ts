/**
 * Java Hybrid Extractor
 *
 * Combines tree-sitter (primary) with regex fallback for enterprise-grade
 * Java code extraction.
 */

import { HybridExtractorBase } from './hybrid-extractor-base.js';
import { JavaRegexExtractor } from './regex/java-regex.js';
import {
  isJavaTreeSitterAvailable,
  createJavaParser,
} from '../../parsers/tree-sitter/java-loader.js';

import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type { CallGraphLanguage, FileExtractionResult } from '../types.js';
import type { HybridExtractorConfig } from './types.js';

/**
 * Java hybrid extractor with tree-sitter + regex fallback
 */
export class JavaHybridExtractor extends HybridExtractorBase {
  readonly language: CallGraphLanguage = 'java';
  readonly extensions: string[] = ['.java'];
  protected regexExtractor = new JavaRegexExtractor();

  private parser: TreeSitterParser | null = null;

  constructor(config?: HybridExtractorConfig) {
    super(config);
  }

  protected isTreeSitterAvailable(): boolean {
    return isJavaTreeSitterAvailable();
  }

  protected extractWithTreeSitter(source: string, filePath: string): FileExtractionResult | null {
    if (!isJavaTreeSitterAvailable()) {
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
        this.parser = createJavaParser();
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
      case 'method_declaration':
        this.extractMethodDeclaration(node, result, currentClass);
        break;

      case 'constructor_declaration':
        if (currentClass) {
          this.extractConstructorDeclaration(node, result, currentClass);
        }
        break;

      case 'class_declaration':
        this.extractClassDeclaration(node, result, source);
        break;

      case 'interface_declaration':
        this.extractInterfaceDeclaration(node, result, source);
        break;

      case 'enum_declaration':
        this.extractEnumDeclaration(node, result);
        break;

      case 'import_declaration':
        this.extractImportDeclaration(node, result);
        break;

      case 'package_declaration':
        this.extractPackageDeclaration(node, result);
        break;

      case 'method_invocation':
        this.extractMethodInvocation(node, result);
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

  private extractMethodDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    currentClass: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const parametersNode = node.childForFieldName('parameters');
    const returnTypeNode = node.childForFieldName('type');
    const bodyNode = node.childForFieldName('body');

    // Check modifiers
    let isStatic = false;
    let isPublic = false;
    const decorators: string[] = [];

    for (const child of node.children) {
      if (child.type === 'modifiers') {
        for (const mod of child.children) {
          if (mod.type === 'static') {isStatic = true;}
          if (mod.type === 'public') {isPublic = true;}
          if (mod.type === 'marker_annotation' || mod.type === 'annotation') {
            decorators.push(mod.text);
          }
        }
      }
    }

    const funcResult: FileExtractionResult['functions'][0] = {
      name,
      qualifiedName: currentClass ? `${currentClass}.${name}` : name,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters: parametersNode ? this.extractParameters(parametersNode) : [],
      isMethod: true,
      isStatic,
      isExported: isPublic,
      isConstructor: false,
      isAsync: false,
      decorators,
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

    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result);
    }
  }

  private extractConstructorDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    className: string
  ): void {
    const nameNode = node.childForFieldName('name');
    const parametersNode = node.childForFieldName('parameters');
    const bodyNode = node.childForFieldName('body');

    let isPublic = false;
    for (const child of node.children) {
      if (child.type === 'modifiers') {
        for (const mod of child.children) {
          if (mod.type === 'public') {isPublic = true;}
        }
      }
    }

    result.functions.push({
      name: nameNode?.text ?? className,
      qualifiedName: `${className}.${className}`,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters: parametersNode ? this.extractParameters(parametersNode) : [],
      isMethod: true,
      isStatic: false,
      isExported: isPublic,
      isConstructor: true,
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

    // Get superclass
    const superclassNode = node.childForFieldName('superclass');
    if (superclassNode) {
      baseClasses.push(superclassNode.text);
    }

    // Get interfaces
    const interfacesNode = node.childForFieldName('interfaces');
    if (interfacesNode) {
      for (const child of interfacesNode.children) {
        if (child.type === 'type_identifier' || child.type === 'generic_type') {
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
        } else if (child.type === 'constructor_declaration') {
          methods.push(name);
        }
      }
    }

    let isPublic = false;
    for (const child of node.children) {
      if (child.type === 'modifiers') {
        for (const mod of child.children) {
          if (mod.type === 'public') {isPublic = true;}
        }
      }
    }

    result.classes.push({
      name,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      baseClasses,
      methods,
      isExported: isPublic,
    });

    // Visit class body with class context
    if (bodyNode) {
      for (const child of bodyNode.children) {
        this.visitNode(child, result, source, name);
      }
    }
  }

  private extractInterfaceDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const baseClasses: string[] = [];

    const extendsNode = node.childForFieldName('extends');
    if (extendsNode) {
      for (const child of extendsNode.children) {
        if (child.type === 'type_identifier' || child.type === 'generic_type') {
          baseClasses.push(child.text);
        }
      }
    }

    let isPublic = false;
    for (const child of node.children) {
      if (child.type === 'modifiers') {
        for (const mod of child.children) {
          if (mod.type === 'public') {isPublic = true;}
        }
      }
    }

    result.classes.push({
      name,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      baseClasses,
      methods: [],
      isExported: isPublic,
    });

    const bodyNode = node.childForFieldName('body');
    if (bodyNode) {
      for (const child of bodyNode.children) {
        this.visitNode(child, result, source, name);
      }
    }
  }

  private extractEnumDeclaration(node: TreeSitterNode, result: FileExtractionResult): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    let isPublic = false;
    for (const child of node.children) {
      if (child.type === 'modifiers') {
        for (const mod of child.children) {
          if (mod.type === 'public') {isPublic = true;}
        }
      }
    }

    result.classes.push({
      name: nameNode.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      baseClasses: [],
      methods: [],
      isExported: isPublic,
    });
  }

  private extractImportDeclaration(node: TreeSitterNode, result: FileExtractionResult): void {
    let source = '';
    let isStatic = false;
    let isWildcard = false;

    for (const child of node.children) {
      if (child.type === 'static') {
        isStatic = true;
      } else if (child.type === 'scoped_identifier' || child.type === 'identifier') {
        source = child.text;
      } else if (child.type === 'asterisk') {
        isWildcard = true;
      }
    }

    if (!source) {return;}

    const className = isWildcard ? '*' : source.split('.').pop() ?? source;

    result.imports.push({
      source,
      names: [{
        imported: className,
        local: className,
        isDefault: false,
        isNamespace: isWildcard,
      }],
      line: node.startPosition.row + 1,
      isTypeOnly: !isStatic,
    });
  }

  private extractPackageDeclaration(node: TreeSitterNode, result: FileExtractionResult): void {
    for (const child of node.children) {
      if (child.type === 'scoped_identifier' || child.type === 'identifier') {
        result.exports.push({
          name: child.text,
          isDefault: false,
          isReExport: false,
          line: node.startPosition.row + 1,
        });
        break;
      }
    }
  }

  private extractMethodInvocation(node: TreeSitterNode, result: FileExtractionResult): void {
    const nameNode = node.childForFieldName('name');
    const objectNode = node.childForFieldName('object');
    const argsNode = node.childForFieldName('arguments');

    if (!nameNode) {return;}

    let argumentCount = 0;
    if (argsNode) {
      for (const child of argsNode.children) {
        if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
          argumentCount++;
        }
      }
    }

    result.calls.push({
      calleeName: nameNode.text,
      receiver: objectNode?.text,
      fullExpression: node.text,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      argumentCount,
      isMethodCall: !!objectNode,
      isConstructorCall: false,
    });
  }

  private extractObjectCreation(node: TreeSitterNode, result: FileExtractionResult): void {
    const typeNode = node.childForFieldName('type');
    if (!typeNode) {return;}

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
      calleeName: typeNode.text,
      fullExpression: `new ${typeNode.text}`,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      argumentCount,
      isMethodCall: false,
      isConstructorCall: true,
    });
  }

  private extractCallsFromBody(node: TreeSitterNode, result: FileExtractionResult): void {
    const visit = (n: TreeSitterNode): void => {
      if (n.type === 'method_invocation') {
        this.extractMethodInvocation(n, result);
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
      if (child.type === 'formal_parameter' || child.type === 'spread_parameter') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');

        if (nameNode) {
          params.push({
            name: nameNode.text,
            type: typeNode?.text,
            hasDefault: false,
            isRest: child.type === 'spread_parameter',
          });
        }
      }
    }

    return params;
  }
}

export function createJavaHybridExtractor(config?: HybridExtractorConfig): JavaHybridExtractor {
  return new JavaHybridExtractor(config);
}
