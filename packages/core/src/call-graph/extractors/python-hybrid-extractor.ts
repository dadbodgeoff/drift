/**
 * Python Hybrid Extractor
 *
 * Combines tree-sitter (primary) with regex fallback for enterprise-grade
 * Python code extraction.
 */

import { HybridExtractorBase } from './hybrid-extractor-base.js';
import { PythonRegexExtractor } from './regex/python-regex.js';
import { isTreeSitterAvailable, createPythonParser } from '../../parsers/tree-sitter/loader.js';

import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type { CallGraphLanguage, FileExtractionResult } from '../types.js';
import type { HybridExtractorConfig } from './types.js';

/**
 * Python hybrid extractor with tree-sitter + regex fallback
 */
export class PythonHybridExtractor extends HybridExtractorBase {
  readonly language: CallGraphLanguage = 'python';
  readonly extensions: string[] = ['.py', '.pyw', '.pyi'];
  protected regexExtractor = new PythonRegexExtractor();

  private parser: TreeSitterParser | null = null;

  constructor(config?: HybridExtractorConfig) {
    super(config);
  }

  /**
   * Check if tree-sitter is available
   */
  protected isTreeSitterAvailable(): boolean {
    return isTreeSitterAvailable();
  }

  /**
   * Extract using tree-sitter
   */
  protected extractWithTreeSitter(source: string, filePath: string): FileExtractionResult | null {
    if (!isTreeSitterAvailable()) {
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
        this.parser = createPythonParser();
      }

      const tree = this.parser.parse(source);
      this.visitNode(tree.rootNode, result, source, null, null);
      this.extractModuleLevelCalls(tree.rootNode, result, source);

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
    source: string,
    currentClass: string | null,
    parentFunction: string | null
  ): void {
    switch (node.type) {
      case 'function_definition':
        this.extractFunctionDefinition(node, result, source, currentClass, parentFunction);
        break;

      case 'class_definition':
        this.extractClassDefinition(node, result, source);
        break;

      case 'import_statement':
        this.extractImportStatement(node, result);
        break;

      case 'import_from_statement':
        this.extractImportFromStatement(node, result);
        break;

      case 'call':
        this.extractCallExpression(node, result);
        break;

      default:
        for (const child of node.children) {
          this.visitNode(child, result, source, currentClass, parentFunction);
        }
    }
  }

  /**
   * Extract module-level calls
   */
  private extractModuleLevelCalls(
    rootNode: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    const moduleCalls: FileExtractionResult['calls'] = [];
    
    for (const child of rootNode.children) {
      if (child.type === 'function_definition' || child.type === 'class_definition') {
        continue;
      }
      if (child.type === 'import_statement' || child.type === 'import_from_statement') {
        continue;
      }
      
      this.extractCallsRecursive(child, moduleCalls);
    }
    
    result.calls.push(...moduleCalls);
    
    if (moduleCalls.length > 0) {
      result.functions.push({
        name: '__module__',
        qualifiedName: '__module__',
        startLine: 1,
        endLine: rootNode.endPosition.row + 1,
        startColumn: 0,
        endColumn: 0,
        parameters: [],
        isMethod: false,
        isStatic: false,
        isExported: false,
        isConstructor: false,
        isAsync: false,
        decorators: [],
        bodyStartLine: 1,
        bodyEndLine: rootNode.endPosition.row + 1,
      });
    }
  }

  /**
   * Recursively extract calls
   */
  private extractCallsRecursive(
    node: TreeSitterNode,
    calls: FileExtractionResult['calls']
  ): void {
    if (node.type === 'call') {
      const call = this.extractCallNode(node);
      if (call) {calls.push(call);}
    }
    
    if (node.type === 'function_definition' || node.type === 'class_definition') {
      return;
    }
    
    for (const child of node.children) {
      this.extractCallsRecursive(child, calls);
    }
  }

  /**
   * Extract a function definition
   */
  private extractFunctionDefinition(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentClass: string | null,
    parentFunction: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const isMethod = currentClass !== null;
    const isConstructor = name === '__init__';

    const decorators: string[] = [];
    let prevSibling = node.previousNamedSibling;
    while (prevSibling?.type === 'decorator') {
      decorators.unshift(prevSibling.text);
      prevSibling = prevSibling.previousNamedSibling;
    }

    const isAsync = node.children.some(c => c.type === 'async');
    const isStatic = decorators.some(d => d.includes('@staticmethod') || d.includes('@classmethod'));

    const parametersNode = node.childForFieldName('parameters');
    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];

    const returnTypeNode = node.childForFieldName('return_type');
    const returnType = returnTypeNode?.text;

    const bodyNode = node.childForFieldName('body');

    let qualifiedName = name;
    if (parentFunction) {
      qualifiedName = `${parentFunction}.${name}`;
    } else if (currentClass) {
      qualifiedName = `${currentClass}.${name}`;
    }

    result.functions.push({
      name,
      qualifiedName,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters,
      returnType,
      isMethod,
      isStatic,
      isExported: !name.startsWith('_') || (name.startsWith('__') && name.endsWith('__')),
      isConstructor,
      isAsync,
      className: currentClass ?? undefined,
      decorators,
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });

    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result);
      this.extractNestedFunctions(bodyNode, result, source, currentClass, qualifiedName);
    }
  }

  /**
   * Extract nested functions
   */
  private extractNestedFunctions(
    bodyNode: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentClass: string | null,
    parentFunctionName: string
  ): void {
    for (const child of bodyNode.children) {
      if (child.type === 'function_definition') {
        this.extractFunctionDefinition(child, result, source, currentClass, parentFunctionName);
      } else if (['if_statement', 'for_statement', 'while_statement', 'with_statement', 'try_statement'].includes(child.type)) {
        this.extractNestedFunctionsRecursive(child, result, source, currentClass, parentFunctionName);
      }
    }
  }

  /**
   * Recursively extract nested functions
   */
  private extractNestedFunctionsRecursive(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentClass: string | null,
    parentFunctionName: string
  ): void {
    for (const child of node.children) {
      if (child.type === 'function_definition') {
        this.extractFunctionDefinition(child, result, source, currentClass, parentFunctionName);
      } else if (child.type === 'block') {
        this.extractNestedFunctions(child, result, source, currentClass, parentFunctionName);
      } else {
        this.extractNestedFunctionsRecursive(child, result, source, currentClass, parentFunctionName);
      }
    }
  }

  /**
   * Extract calls from function body
   */
  private extractCallsFromBody(node: TreeSitterNode, result: FileExtractionResult): void {
    const visit = (n: TreeSitterNode): void => {
      if (n.type === 'call') {
        const call = this.extractCallNode(n);
        if (call) {result.calls.push(call);}
      }
      if (n.type !== 'function_definition' && n.type !== 'class_definition') {
        for (const child of n.children) {
          visit(child);
        }
      }
    };

    for (const child of node.children) {
      visit(child);
    }
  }

  /**
   * Extract a call expression
   */
  private extractCallExpression(node: TreeSitterNode, result: FileExtractionResult): void {
    const call = this.extractCallNode(node);
    if (call) {result.calls.push(call);}
  }

  /**
   * Extract call node to CallExtraction
   */
  private extractCallNode(node: TreeSitterNode): FileExtractionResult['calls'][0] | null {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) {return null;}

    let calleeName: string;
    let receiver: string | undefined;
    let isConstructorCall = false;

    if (funcNode.type === 'attribute') {
      const objectNode = funcNode.childForFieldName('object');
      const attrNode = funcNode.childForFieldName('attribute');
      if (objectNode && attrNode) {
        receiver = objectNode.text;
        calleeName = attrNode.text;
      } else {
        calleeName = funcNode.text;
      }
    } else if (funcNode.type === 'identifier') {
      calleeName = funcNode.text;
      isConstructorCall = /^[A-Z]/.test(calleeName);
    } else {
      calleeName = funcNode.text;
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

    return {
      calleeName,
      receiver,
      fullExpression: node.text,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      argumentCount,
      isMethodCall: !!receiver,
      isConstructorCall,
    };
  }

  /**
   * Extract a class definition
   */
  private extractClassDefinition(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;

    const baseClasses: string[] = [];
    const superclassNode = node.childForFieldName('superclasses');
    if (superclassNode) {
      for (const child of superclassNode.children) {
        if (child.type === 'identifier' || child.type === 'attribute') {
          baseClasses.push(child.text);
        }
      }
    }

    const methods: string[] = [];
    const bodyNode = node.childForFieldName('body');
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'function_definition') {
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
      isExported: !name.startsWith('_'),
    });

    if (bodyNode) {
      for (const child of bodyNode.children) {
        this.visitNode(child, result, source, name, null);
      }
    }
  }

  /**
   * Extract import statement
   */
  private extractImportStatement(node: TreeSitterNode, result: FileExtractionResult): void {
    for (const child of node.children) {
      if (child.type === 'dotted_name') {
        const moduleName = child.text;
        result.imports.push({
          source: moduleName,
          names: [{
            imported: moduleName,
            local: moduleName.split('.').pop() ?? moduleName,
            isDefault: false,
            isNamespace: false,
          }],
          line: node.startPosition.row + 1,
          isTypeOnly: false,
        });
      } else if (child.type === 'aliased_import') {
        const nameNode = child.childForFieldName('name');
        const aliasNode = child.childForFieldName('alias');
        if (nameNode) {
          const moduleName = nameNode.text;
          result.imports.push({
            source: moduleName,
            names: [{
              imported: moduleName,
              local: aliasNode?.text ?? moduleName.split('.').pop() ?? moduleName,
              isDefault: false,
              isNamespace: false,
            }],
            line: node.startPosition.row + 1,
            isTypeOnly: false,
          });
        }
      }
    }
  }

  /**
   * Extract from...import statement
   */
  private extractImportFromStatement(node: TreeSitterNode, result: FileExtractionResult): void {
    const moduleNode = node.childForFieldName('module_name');
    const moduleName = moduleNode?.text ?? '';

    const names: FileExtractionResult['imports'][0]['names'] = [];

    for (const child of node.children) {
      if (child.type === 'dotted_name' && child !== moduleNode) {
        names.push({
          imported: child.text,
          local: child.text,
          isDefault: false,
          isNamespace: false,
        });
      } else if (child.type === 'aliased_import') {
        const nameNode = child.childForFieldName('name');
        const aliasNode = child.childForFieldName('alias');
        if (nameNode) {
          names.push({
            imported: nameNode.text,
            local: aliasNode?.text ?? nameNode.text,
            isDefault: false,
            isNamespace: false,
          });
        }
      } else if (child.type === 'wildcard_import') {
        names.push({
          imported: '*',
          local: '*',
          isDefault: false,
          isNamespace: true,
        });
      }
    }

    if (names.length > 0) {
      result.imports.push({
        source: moduleName,
        names,
        line: node.startPosition.row + 1,
        isTypeOnly: false,
      });
    }
  }

  /**
   * Extract parameters
   */
  private extractParameters(node: TreeSitterNode): FileExtractionResult['functions'][0]['parameters'] {
    const params: FileExtractionResult['functions'][0]['parameters'] = [];

    for (const child of node.children) {
      if (child.type === 'identifier') {
        if (child.text !== 'self' && child.text !== 'cls') {
          params.push({ name: child.text, hasDefault: false, isRest: false });
        }
      } else if (child.type === 'typed_parameter') {
        const nameNode = child.children.find(c => c.type === 'identifier');
        const typeNode = child.childForFieldName('type');
        if (nameNode && nameNode.text !== 'self' && nameNode.text !== 'cls') {
          params.push({ name: nameNode.text, type: typeNode?.text, hasDefault: false, isRest: false });
        }
      } else if (child.type === 'default_parameter' || child.type === 'typed_default_parameter') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');
        if (nameNode && nameNode.text !== 'self' && nameNode.text !== 'cls') {
          params.push({ name: nameNode.text, type: typeNode?.text, hasDefault: true, isRest: false });
        }
      } else if (child.type === 'list_splat_pattern' || child.type === 'dictionary_splat_pattern') {
        const nameNode = child.children.find(c => c.type === 'identifier');
        if (nameNode) {
          params.push({ name: nameNode.text, hasDefault: false, isRest: true });
        }
      }
    }

    return params;
  }
}

/**
 * Factory function for backward compatibility
 */
export function createPythonHybridExtractor(config?: HybridExtractorConfig): PythonHybridExtractor {
  return new PythonHybridExtractor(config);
}
