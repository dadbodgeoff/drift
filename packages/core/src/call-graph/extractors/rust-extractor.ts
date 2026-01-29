/**
 * Rust Call Graph Extractor
 *
 * Extracts functions, calls, imports, and exports from Rust
 * using tree-sitter for AST parsing.
 *
 * Handles:
 * - Function definitions (fn, pub fn, async fn)
 * - Method implementations (impl blocks)
 * - Trait definitions and implementations
 * - Module imports (use statements)
 * - Macro invocations
 * - Async/await patterns
 * - Closures
 * - Generic types and lifetimes
 *
 * @requirements Rust Language Support
 */

import { BaseCallGraphExtractor } from './base-extractor.js';
import {
  isRustTreeSitterAvailable,
  createRustParser,
} from '../../parsers/tree-sitter/rust-loader.js';

import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type {
  CallGraphLanguage,
  FileExtractionResult,
  ParameterInfo,
} from '../types.js';

/**
 * Rust call graph extractor using tree-sitter
 */
export class RustCallGraphExtractor extends BaseCallGraphExtractor {
  readonly language: CallGraphLanguage = 'rust';
  readonly extensions: string[] = ['.rs'];

  private parser: TreeSitterParser | null = null;

  /**
   * Check if tree-sitter is available
   */
  static isAvailable(): boolean {
    return isRustTreeSitterAvailable();
  }

  /**
   * Extract call graph information from Rust source
   */
  extract(source: string, filePath: string): FileExtractionResult {
    const result = this.createEmptyResult(filePath);

    if (!isRustTreeSitterAvailable()) {
      result.errors.push('Tree-sitter not available for Rust parsing');
      return result;
    }

    try {
      if (!this.parser) {
        this.parser = createRustParser();
      }

      const tree = this.parser.parse(source);

      // Extract module name from file path
      const moduleName = this.extractModuleName(filePath);

      this.visitNode(tree.rootNode, result, source, null, moduleName);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Extract module name from file path
   */
  private extractModuleName(filePath: string): string {
    const parts = filePath.split('/');
    const fileName = parts[parts.length - 1] ?? 'main';
    return fileName.replace('.rs', '');
  }

  /**
   * Visit a tree-sitter node and extract information
   */
  private visitNode(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentImpl: string | null,
    currentModule: string
  ): void {
    switch (node.type) {
      case 'function_item':
        this.extractFunctionItem(node, result, source, currentImpl, currentModule);
        break;

      case 'impl_item':
        this.extractImplItem(node, result, source, currentModule);
        return; // Don't recurse, handled internally

      case 'trait_item':
        this.extractTraitItem(node, result, source, currentModule);
        return; // Don't recurse, handled internally

      case 'struct_item':
        this.extractStructItem(node, result, currentModule);
        break;

      case 'enum_item':
        this.extractEnumItem(node, result, currentModule);
        break;

      case 'use_declaration':
        this.extractUseDeclaration(node, result);
        break;

      case 'call_expression':
        this.extractCallExpression(node, result, source);
        break;

      case 'macro_invocation':
        this.extractMacroInvocation(node, result, source);
        break;

      case 'method_call_expression':
        this.extractMethodCallExpression(node, result, source);
        break;

      default:
        // Recurse into children
        for (const child of node.children) {
          this.visitNode(child, result, source, currentImpl, currentModule);
        }
    }
  }

  /**
   * Extract a function item
   */
  private extractFunctionItem(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentImpl: string | null,
    currentModule: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const isPublic = this.hasVisibilityModifier(node, 'pub');
    const isAsync = this.hasModifier(node, 'async');
    const parametersNode = node.childForFieldName('parameters');
    const returnTypeNode = node.childForFieldName('return_type');
    const bodyNode = node.childForFieldName('body');

    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];
    const returnType = returnTypeNode ? this.extractReturnType(returnTypeNode) : undefined;

    const qualifiedName = currentImpl
      ? `${currentModule}::${currentImpl}::${name}`
      : `${currentModule}::${name}`;

    const func = this.createFunction({
      name,
      qualifiedName,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters,
      returnType,
      isMethod: currentImpl !== null,
      isStatic: currentImpl !== null && !this.hasSelfParameter(parametersNode),
      isExported: isPublic,
      isConstructor: name === 'new' || name === 'default',
      isAsync,
      className: currentImpl ?? undefined,
      decorators: this.extractAttributes(node),
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
   * Extract an impl block
   */
  private extractImplItem(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentModule: string
  ): void {
    // Get the type being implemented
    const typeNode = node.childForFieldName('type');
    const traitNode = node.childForFieldName('trait');
    
    let implName: string;
    if (typeNode) {
      implName = this.extractTypeName(typeNode);
    } else {
      return;
    }

    // If implementing a trait, include trait name
    if (traitNode) {
      const traitName = this.extractTypeName(traitNode);
      implName = `${traitName} for ${implName}`;
    }

    // Extract methods from impl body
    const bodyNode = node.childForFieldName('body');
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'function_item') {
          this.extractFunctionItem(child, result, source, implName, currentModule);
        }
      }
    }
  }

  /**
   * Extract a trait definition
   */
  private extractTraitItem(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string,
    _currentModule: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const isPublic = this.hasVisibilityModifier(node, 'pub');
    const methods: string[] = [];
    const baseClasses: string[] = [];

    // Extract trait bounds (super traits)
    const boundsNode = node.childForFieldName('bounds');
    if (boundsNode) {
      for (const child of boundsNode.children) {
        if (child.type === 'type_identifier' || child.type === 'scoped_type_identifier') {
          baseClasses.push(child.text);
        }
      }
    }

    // Extract method signatures from trait body
    const bodyNode = node.childForFieldName('body');
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'function_signature_item' || child.type === 'function_item') {
          const methodNameNode = child.childForFieldName('name');
          if (methodNameNode) {
            methods.push(methodNameNode.text);
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
        isExported: isPublic,
      })
    );
  }

  /**
   * Extract a struct definition
   */
  private extractStructItem(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _currentModule: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const isPublic = this.hasVisibilityModifier(node, 'pub');

    result.classes.push(
      this.createClass({
        name,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        baseClasses: [],
        methods: [],
        isExported: isPublic,
      })
    );
  }

  /**
   * Extract an enum definition
   */
  private extractEnumItem(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _currentModule: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const isPublic = this.hasVisibilityModifier(node, 'pub');

    result.classes.push(
      this.createClass({
        name,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        baseClasses: [],
        methods: [],
        isExported: isPublic,
      })
    );
  }

  /**
   * Extract use declaration (imports)
   */
  private extractUseDeclaration(node: TreeSitterNode, result: FileExtractionResult): void {
    const argumentNode = node.childForFieldName('argument');
    if (!argumentNode) {return;}

    const imports = this.extractUseTree(argumentNode);
    
    for (const imp of imports) {
      result.imports.push(
        this.createImport({
          source: imp.source,
          names: [{
            imported: imp.name,
            local: imp.alias ?? imp.name,
            isDefault: false,
            isNamespace: imp.isGlob,
          }],
          line: node.startPosition.row + 1,
        })
      );
    }
  }

  /**
   * Extract imports from use tree
   */
  private extractUseTree(node: TreeSitterNode): Array<{
    source: string;
    name: string;
    alias?: string;
    isGlob: boolean;
  }> {
    const imports: Array<{
      source: string;
      name: string;
      alias?: string;
      isGlob: boolean;
    }> = [];

    if (node.type === 'scoped_identifier' || node.type === 'identifier') {
      const path = node.text;
      const parts = path.split('::');
      const name = parts[parts.length - 1] ?? path;
      imports.push({
        source: path,
        name,
        isGlob: false,
      });
    } else if (node.type === 'use_wildcard') {
      const pathNode = node.childForFieldName('path');
      const path = pathNode?.text ?? '';
      imports.push({
        source: path,
        name: '*',
        isGlob: true,
      });
    } else if (node.type === 'use_as_clause') {
      const pathNode = node.childForFieldName('path');
      const aliasNode = node.childForFieldName('alias');
      const path = pathNode?.text ?? '';
      const parts = path.split('::');
      const name = parts[parts.length - 1] ?? path;
      const aliasText = aliasNode?.text;
      imports.push({
        source: path,
        name,
        ...(aliasText ? { alias: aliasText } : {}),
        isGlob: false,
      });
    } else if (node.type === 'use_list') {
      const pathNode = node.parent?.childForFieldName('path');
      const basePath = pathNode?.text ?? '';
      
      for (const child of node.children) {
        if (child.type === 'identifier') {
          imports.push({
            source: basePath ? `${basePath}::${child.text}` : child.text,
            name: child.text,
            isGlob: false,
          });
        } else if (child.type === 'use_as_clause') {
          const itemPath = child.childForFieldName('path');
          const alias = child.childForFieldName('alias');
          const itemName = itemPath?.text ?? '';
          const aliasText = alias?.text;
          imports.push({
            source: basePath ? `${basePath}::${itemName}` : itemName,
            name: itemName,
            ...(aliasText ? { alias: aliasText } : {}),
            isGlob: false,
          });
        } else if (child.type !== '{' && child.type !== '}' && child.type !== ',') {
          imports.push(...this.extractUseTree(child));
        }
      }
    } else if (node.type === 'scoped_use_list') {
      const pathNode = node.childForFieldName('path');
      const listNode = node.childForFieldName('list');
      const basePath = pathNode?.text ?? '';
      
      if (listNode) {
        for (const child of listNode.children) {
          if (child.type === 'identifier') {
            imports.push({
              source: basePath ? `${basePath}::${child.text}` : child.text,
              name: child.text,
              isGlob: false,
            });
          } else if (child.type === 'self') {
            imports.push({
              source: basePath,
              name: basePath.split('::').pop() ?? basePath,
              isGlob: false,
            });
          } else if (child.type !== '{' && child.type !== '}' && child.type !== ',') {
            const subImports = this.extractUseTree(child);
            for (const sub of subImports) {
              imports.push({
                ...sub,
                source: basePath ? `${basePath}::${sub.source}` : sub.source,
              });
            }
          }
        }
      }
    }

    return imports;
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

    if (funcNode.type === 'scoped_identifier') {
      // Path::to::function()
      calleeName = funcNode.text;
      const parts = calleeName.split('::');
      if (parts.length > 1) {
        receiver = parts.slice(0, -1).join('::');
        calleeName = parts[parts.length - 1] ?? calleeName;
      }
    } else if (funcNode.type === 'field_expression') {
      // obj.method() - but this is usually method_call_expression
      const fieldNode = funcNode.childForFieldName('field');
      const valueNode = funcNode.childForFieldName('value');
      if (fieldNode && valueNode) {
        receiver = valueNode.text;
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

    result.calls.push(
      this.createCall({
        calleeName,
        receiver,
        fullExpression: node.text,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        argumentCount,
        isMethodCall,
        isConstructorCall: calleeName === 'new' || calleeName === 'default',
      })
    );
  }

  /**
   * Extract method call expression
   */
  private extractMethodCallExpression(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    const nameNode = node.childForFieldName('name');
    const receiverNode = node.childForFieldName('value');
    const argsNode = node.childForFieldName('arguments');

    if (!nameNode) {return;}

    const calleeName = nameNode.text;
    const receiver = receiverNode?.text;
    const argumentCount = argsNode ? this.countArguments(argsNode) : 0;

    result.calls.push(
      this.createCall({
        calleeName,
        receiver,
        fullExpression: node.text,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        argumentCount,
        isMethodCall: true,
        isConstructorCall: calleeName === 'new' || calleeName === 'default',
      })
    );
  }

  /**
   * Extract macro invocation
   */
  private extractMacroInvocation(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    const macroNode = node.childForFieldName('macro');
    if (!macroNode) {return;}

    const calleeName = macroNode.text + '!';

    result.calls.push(
      this.createCall({
        calleeName,
        fullExpression: node.text,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        argumentCount: 0,
        isMethodCall: false,
        isConstructorCall: false,
      })
    );
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
      } else if (n.type === 'method_call_expression') {
        this.extractMethodCallExpression(n, result, source);
      } else if (n.type === 'macro_invocation') {
        this.extractMacroInvocation(n, result, source);
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
      if (child.type === 'parameter') {
        const patternNode = child.childForFieldName('pattern');
        const typeNode = child.childForFieldName('type');
        
        const name = patternNode?.text ?? '_';
        const type = typeNode?.text;

        params.push(this.parseParameter(name, type, false, false));
      } else if (child.type === 'self_parameter') {
        // &self, &mut self, self
        params.push(this.parseParameter('self', child.text, false, false));
      }
    }

    return params;
  }

  /**
   * Check if parameters include self
   */
  private hasSelfParameter(parametersNode: TreeSitterNode | null): boolean {
    if (!parametersNode) {return false;}
    
    for (const child of parametersNode.children) {
      if (child.type === 'self_parameter') {
        return true;
      }
    }
    return false;
  }

  /**
   * Extract return type
   */
  private extractReturnType(node: TreeSitterNode): string {
    // Skip the -> token
    const typeNode = node.namedChildren[0];
    return typeNode?.text ?? node.text.replace(/^->\s*/, '');
  }

  /**
   * Extract type name from type node
   */
  private extractTypeName(node: TreeSitterNode): string {
    if (node.type === 'type_identifier') {
      return node.text;
    } else if (node.type === 'scoped_type_identifier') {
      return node.text;
    } else if (node.type === 'generic_type') {
      const typeNode = node.childForFieldName('type');
      return typeNode?.text ?? node.text;
    }
    return node.text;
  }

  /**
   * Check for visibility modifier
   */
  private hasVisibilityModifier(node: TreeSitterNode, modifier: string): boolean {
    for (const child of node.children) {
      if (child.type === 'visibility_modifier') {
        return child.text.startsWith(modifier);
      }
    }
    return false;
  }

  /**
   * Check for other modifiers
   */
  private hasModifier(node: TreeSitterNode, modifier: string): boolean {
    for (const child of node.children) {
      if (child.type === modifier || child.text === modifier) {
        return true;
      }
    }
    return false;
  }

  /**
   * Extract attributes (decorators)
   */
  private extractAttributes(node: TreeSitterNode): string[] {
    const attributes: string[] = [];
    
    // Look for attribute_item nodes before the function
    let sibling = node.previousSibling;
    while (sibling) {
      if (sibling.type === 'attribute_item') {
        attributes.push(sibling.text);
      } else if (sibling.type !== 'line_comment' && sibling.type !== 'block_comment') {
        break;
      }
      sibling = sibling.previousSibling;
    }

    return attributes.reverse();
  }

  /**
   * Count arguments in argument list
   */
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
 * Create a Rust extractor instance
 */
export function createRustExtractor(): RustCallGraphExtractor {
  return new RustCallGraphExtractor();
}
