/**
 * Python Call Chain Normalizer
 *
 * Converts Python AST into unified call chains.
 * Handles Python-specific patterns including:
 * - Method chaining: obj.method1().method2()
 * - Attribute access: obj.attr.method()
 * - Keyword arguments: func(key=value)
 * - Decorators: @decorator
 * - Django/FastAPI patterns
 */

import { BaseNormalizer } from './base-normalizer.js';

import type { TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type {
  UnifiedCallChain,
  CallChainSegment,
  NormalizedArg,
  UnifiedFunction,
  UnifiedClass,
  UnifiedImport,
  UnifiedExport,
  UnifiedParameter,
} from '../types.js';

/**
 * Python normalizer
 */
export class PythonNormalizer extends BaseNormalizer {
  readonly language = 'python' as const;

  // ============================================================================
  // Call Chain Normalization
  // ============================================================================

  normalizeCallChains(
    rootNode: TreeSitterNode,
    _source: string,
    filePath: string
  ): UnifiedCallChain[] {
    const chains: UnifiedCallChain[] = [];
    const processedNodes = new Set<TreeSitterNode>();

    this.traverseNode(rootNode, node => {
      if (node.type === 'call' && !processedNodes.has(node)) {
        // Check if this call is part of a larger chain
        const parent = node.parent;
        if (parent?.type === 'attribute' || parent?.type === 'call') {
          return;
        }

        const chain = this.extractCallChain(node, filePath);
        if (chain && chain.segments.length > 0) {
          chains.push(chain);
          this.markChainNodesProcessed(node, processedNodes);
        }
      }
    });

    return chains;
  }

  /**
   * Extract a call chain from a call expression
   */
  private extractCallChain(node: TreeSitterNode, filePath: string): UnifiedCallChain | null {
    const segments: CallChainSegment[] = [];
    let receiver = '';
    let current: TreeSitterNode | null = node;

    while (current) {
      if (current.type === 'call') {
        const funcNode = this.getChildByField(current, 'function');
        const argsNode = this.getChildByField(current, 'arguments');

        if (!funcNode) {break;}

        const args = argsNode ? this.normalizeArguments(argsNode) : [];

        if (funcNode.type === 'attribute') {
          const attrNode = this.getChildByField(funcNode, 'attribute');
          const objNode = this.getChildByField(funcNode, 'object');

          if (attrNode) {
            const pos = this.getPosition(attrNode);
            segments.unshift(this.createSegment(attrNode.text, true, args, pos.line, pos.column));
          }

          current = objNode;
        } else if (funcNode.type === 'identifier') {
          const pos = this.getPosition(funcNode);
          segments.unshift(this.createSegment(funcNode.text, true, args, pos.line, pos.column));
          receiver = funcNode.text;
          break;
        } else if (funcNode.type === 'subscript') {
          // obj['method']()
          const subscriptNode = this.getChildByField(funcNode, 'subscript');
          const valueNode = this.getChildByField(funcNode, 'value');

          if (subscriptNode) {
            const methodName = this.extractStringValue(subscriptNode) ?? subscriptNode.text;
            const pos = this.getPosition(subscriptNode);
            segments.unshift(this.createSegment(methodName, true, args, pos.line, pos.column));
          }

          current = valueNode;
        } else {
          break;
        }
      } else if (current.type === 'attribute') {
        const attrNode = this.getChildByField(current, 'attribute');
        const objNode = this.getChildByField(current, 'object');

        if (attrNode) {
          const pos = this.getPosition(attrNode);
          segments.unshift(this.createSegment(attrNode.text, false, [], pos.line, pos.column));
        }

        current = objNode;
      } else if (current.type === 'identifier') {
        receiver = current.text;
        break;
      } else {
        receiver = current.text;
        break;
      }
    }

    if (segments.length === 0) {
      return null;
    }

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

    return this.createCallChain(
      receiver,
      segments,
      node.text,
      filePath,
      pos.line,
      pos.column,
      endPos.line,
      endPos.column,
      node
    );
  }

  /**
   * Normalize arguments from an argument_list node
   */
  private normalizeArguments(argsNode: TreeSitterNode): NormalizedArg[] {
    const args: NormalizedArg[] = [];

    for (const child of argsNode.children) {
      if (child.type === '(' || child.type === ')' || child.type === ',') {
        continue;
      }

      if (child.type === 'keyword_argument') {
        // Handle keyword arguments: key=value
        const nameNode = this.getChildByField(child, 'name');
        const valueNode = this.getChildByField(child, 'value');

        if (nameNode && valueNode) {
          const arg = this.normalizeArgument(valueNode);
          // Store keyword name in the arg for pattern matching
          args.push({
            ...arg,
            value: `${nameNode.text}=${arg.value}`,
          });
        }
      } else {
        args.push(this.normalizeArgument(child));
      }
    }

    return args;
  }

  /**
   * Normalize a single argument
   */
  private normalizeArgument(node: TreeSitterNode): NormalizedArg {
    const pos = this.getPosition(node);

    switch (node.type) {
      case 'string':
      case 'concatenated_string':
        return this.createStringArg(node.text, pos.line, pos.column);

      case 'integer':
      case 'float':
        return this.createNumberArg(node.text, pos.line, pos.column);

      case 'true':
      case 'false':
      case 'True':
      case 'False':
        return this.createBooleanArg(node.text, pos.line, pos.column);

      case 'identifier':
        // Check for Python boolean literals
        if (node.text === 'True' || node.text === 'False') {
          return this.createBooleanArg(node.text, pos.line, pos.column);
        }
        if (node.text === 'None') {
          return this.createUnknownArg(node.text, pos.line, pos.column);
        }
        return this.createIdentifierArg(node.text, pos.line, pos.column);

      case 'dictionary':
        return this.normalizeDictionary(node);

      case 'list':
        return this.normalizeList(node);

      case 'tuple':
        return this.normalizeTuple(node);

      case 'call':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'lambda':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      default:
        return this.createUnknownArg(node.text, pos.line, pos.column);
    }
  }

  /**
   * Normalize a dictionary literal
   */
  private normalizeDictionary(node: TreeSitterNode): NormalizedArg {
    const pos = this.getPosition(node);
    const properties: Record<string, NormalizedArg> = {};

    for (const child of node.children) {
      if (child.type === 'pair') {
        const keyNode = this.getChildByField(child, 'key');
        const valueNode = this.getChildByField(child, 'value');

        if (keyNode && valueNode) {
          let key = keyNode.text;
          if (keyNode.type === 'string') {
            key = this.unquoteString(key);
          }
          properties[key] = this.normalizeArgument(valueNode);
        }
      }
    }

    return this.createObjectArg(node.text, properties, pos.line, pos.column);
  }

  /**
   * Normalize a list literal
   */
  private normalizeList(node: TreeSitterNode): NormalizedArg {
    const pos = this.getPosition(node);
    const elements: NormalizedArg[] = [];

    for (const child of node.children) {
      if (child.type !== '[' && child.type !== ']' && child.type !== ',') {
        elements.push(this.normalizeArgument(child));
      }
    }

    return this.createArrayArg(node.text, elements, pos.line, pos.column);
  }

  /**
   * Normalize a tuple literal
   */
  private normalizeTuple(node: TreeSitterNode): NormalizedArg {
    const pos = this.getPosition(node);
    const elements: NormalizedArg[] = [];

    for (const child of node.children) {
      if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
        elements.push(this.normalizeArgument(child));
      }
    }

    return this.createArrayArg(node.text, elements, pos.line, pos.column);
  }

  /**
   * Mark all nodes in a chain as processed
   */
  private markChainNodesProcessed(node: TreeSitterNode, processed: Set<TreeSitterNode>): void {
    processed.add(node);
    for (const child of node.children) {
      if (child.type === 'call' || child.type === 'attribute') {
        this.markChainNodesProcessed(child, processed);
      }
    }
  }

  // ============================================================================
  // Function Extraction
  // ============================================================================

  extractFunctions(
    rootNode: TreeSitterNode,
    _source: string,
    filePath: string
  ): UnifiedFunction[] {
    const functions: UnifiedFunction[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'function_definition') {
        const className = this.findParentClassName(node);
        const func = this.extractFunctionDefinition(node, filePath, className);
        if (func) {functions.push(func);}
      }
    });

    return functions;
  }

  private extractFunctionDefinition(
    node: TreeSitterNode,
    filePath: string,
    className: string | null
  ): UnifiedFunction | null {
    const nameNode = this.getChildByField(node, 'name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const params = this.extractParameters(this.getChildByField(node, 'parameters'));
    const returnTypeNode = this.getChildByField(node, 'return_type');
    const returnType = returnTypeNode?.text;
    const bodyNode = this.getChildByField(node, 'body');

    // Check for async
    const isAsync = node.children.some(c => c.type === 'async');

    // Check for decorators
    const decorators = this.extractDecorators(node);

    // Check for staticmethod/classmethod
    const isStatic = decorators.some(d =>
      d.includes('@staticmethod') || d.includes('@classmethod')
    );

    // Determine if exported (not private)
    const isExported = !name.startsWith('_') || (name.startsWith('__') && name.endsWith('__'));

    const isConstructor = name === '__init__';
    const isMethod = className !== null;

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

    return this.createFunction({
      name,
      qualifiedName: className ? `${className}.${name}` : name,
      file: filePath,
      startLine: pos.line,
      endLine: endPos.line,
      startColumn: pos.column,
      endColumn: endPos.column,
      parameters: params,
      returnType,
      isMethod,
      isStatic,
      isExported,
      isConstructor,
      isAsync,
      className: className ?? undefined,
      decorators,
      bodyStartLine: bodyNode ? this.getPosition(bodyNode).line : pos.line,
      bodyEndLine: bodyNode ? this.getEndPosition(bodyNode).line : endPos.line,
    });
  }

  private extractParameters(paramsNode: TreeSitterNode | null): UnifiedParameter[] {
    if (!paramsNode) {return [];}

    const params: UnifiedParameter[] = [];

    for (const child of paramsNode.children) {
      // Skip 'self' and 'cls'
      if (child.type === 'identifier') {
        if (child.text !== 'self' && child.text !== 'cls') {
          params.push(this.createParameter(child.text));
        }
      } else if (child.type === 'typed_parameter') {
        const nameNode = child.children.find(c => c.type === 'identifier');
        const typeNode = this.getChildByField(child, 'type');
        if (nameNode && nameNode.text !== 'self' && nameNode.text !== 'cls') {
          params.push(this.createParameter(nameNode.text, typeNode?.text));
        }
      } else if (child.type === 'default_parameter' || child.type === 'typed_default_parameter') {
        const nameNode = this.getChildByField(child, 'name');
        const typeNode = this.getChildByField(child, 'type');
        if (nameNode && nameNode.text !== 'self' && nameNode.text !== 'cls') {
          params.push(this.createParameter(nameNode.text, typeNode?.text, true));
        }
      } else if (child.type === 'list_splat_pattern' || child.type === 'dictionary_splat_pattern') {
        const nameNode = child.children.find(c => c.type === 'identifier');
        if (nameNode) {
          params.push(this.createParameter(nameNode.text, undefined, false, true));
        }
      }
    }

    return params;
  }

  private extractDecorators(node: TreeSitterNode): string[] {
    const decorators: string[] = [];
    let sibling = node.previousNamedSibling;

    while (sibling?.type === 'decorator') {
      decorators.unshift(sibling.text);
      sibling = sibling.previousNamedSibling;
    }

    return decorators;
  }

  private findParentClassName(node: TreeSitterNode): string | null {
    let current = node.parent;
    while (current) {
      if (current.type === 'class_definition') {
        const nameNode = this.getChildByField(current, 'name');
        return nameNode?.text ?? null;
      }
      current = current.parent;
    }
    return null;
  }

  // ============================================================================
  // Class Extraction
  // ============================================================================

  extractClasses(
    rootNode: TreeSitterNode,
    _source: string,
    filePath: string
  ): UnifiedClass[] {
    const classes: UnifiedClass[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'class_definition') {
        const cls = this.extractClassDefinition(node, filePath);
        if (cls) {classes.push(cls);}
      }
    });

    return classes;
  }

  private extractClassDefinition(node: TreeSitterNode, filePath: string): UnifiedClass | null {
    const nameNode = this.getChildByField(node, 'name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const baseClasses: string[] = [];
    const methods: string[] = [];

    // Get base classes
    const superclassNode = this.getChildByField(node, 'superclasses');
    if (superclassNode) {
      for (const child of superclassNode.children) {
        if (child.type === 'identifier' || child.type === 'attribute') {
          baseClasses.push(child.text);
        }
      }
    }

    // Get methods
    const bodyNode = this.getChildByField(node, 'body');
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'function_definition') {
          const methodNameNode = this.getChildByField(child, 'name');
          if (methodNameNode) {
            methods.push(methodNameNode.text);
          }
        }
      }
    }

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

    return this.createClass({
      name,
      file: filePath,
      startLine: pos.line,
      endLine: endPos.line,
      baseClasses,
      methods,
      isExported: !name.startsWith('_'),
    });
  }

  // ============================================================================
  // Import Extraction
  // ============================================================================

  extractImports(
    rootNode: TreeSitterNode,
    _source: string,
    _filePath: string
  ): UnifiedImport[] {
    const imports: UnifiedImport[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'import_statement') {
        const imp = this.extractImportStatement(node);
        if (imp) {imports.push(imp);}
      } else if (node.type === 'import_from_statement') {
        const imp = this.extractImportFromStatement(node);
        if (imp) {imports.push(imp);}
      }
    });

    return imports;
  }

  private extractImportStatement(node: TreeSitterNode): UnifiedImport | null {
    const names: Array<{ imported: string; local: string; isDefault: boolean; isNamespace: boolean }> = [];

    for (const child of node.children) {
      if (child.type === 'dotted_name') {
        const moduleName = child.text;
        names.push({
          imported: moduleName,
          local: moduleName.split('.').pop() ?? moduleName,
          isDefault: false,
          isNamespace: false,
        });
      } else if (child.type === 'aliased_import') {
        const nameNode = this.getChildByField(child, 'name');
        const aliasNode = this.getChildByField(child, 'alias');
        if (nameNode) {
          const moduleName = nameNode.text;
          names.push({
            imported: moduleName,
            local: aliasNode?.text ?? moduleName.split('.').pop() ?? moduleName,
            isDefault: false,
            isNamespace: false,
          });
        }
      }
    }

    if (names.length === 0) {return null;}

    return this.createImport({
      source: names[0]?.imported ?? '',
      names,
      line: this.getPosition(node).line,
    });
  }

  private extractImportFromStatement(node: TreeSitterNode): UnifiedImport | null {
    const moduleNode = this.getChildByField(node, 'module_name');
    const moduleName = moduleNode?.text ?? '';

    const names: Array<{ imported: string; local: string; isDefault: boolean; isNamespace: boolean }> = [];

    for (const child of node.children) {
      if (child.type === 'dotted_name' && child !== moduleNode) {
        names.push({
          imported: child.text,
          local: child.text,
          isDefault: false,
          isNamespace: false,
        });
      } else if (child.type === 'aliased_import') {
        const nameNode = this.getChildByField(child, 'name');
        const aliasNode = this.getChildByField(child, 'alias');
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

    if (names.length === 0) {return null;}

    return this.createImport({
      source: moduleName,
      names,
      line: this.getPosition(node).line,
    });
  }

  // ============================================================================
  // Export Extraction
  // ============================================================================

  extractExports(
    rootNode: TreeSitterNode,
    _source: string,
    _filePath: string
  ): UnifiedExport[] {
    // Python doesn't have explicit exports like JS/TS
    // We consider public functions/classes as exports
    const exports: UnifiedExport[] = [];

    // Check for __all__ definition
    this.traverseNode(rootNode, node => {
      if (node.type === 'assignment') {
        const leftNode = node.children.find(c => c.type === 'identifier');
        if (leftNode?.text === '__all__') {
          const rightNode = node.children.find(c => c.type === 'list');
          if (rightNode) {
            for (const elem of rightNode.children) {
              if (elem.type === 'string') {
                const name = this.unquoteString(elem.text);
                exports.push(this.createExport({
                  name,
                  line: this.getPosition(node).line,
                }));
              }
            }
          }
        }
      }
    });

    // If no __all__, export all public top-level definitions
    if (exports.length === 0) {
      for (const child of rootNode.children) {
        if (child.type === 'function_definition') {
          const nameNode = this.getChildByField(child, 'name');
          if (nameNode && !nameNode.text.startsWith('_')) {
            exports.push(this.createExport({
              name: nameNode.text,
              line: this.getPosition(child).line,
            }));
          }
        } else if (child.type === 'class_definition') {
          const nameNode = this.getChildByField(child, 'name');
          if (nameNode && !nameNode.text.startsWith('_')) {
            exports.push(this.createExport({
              name: nameNode.text,
              line: this.getPosition(child).line,
            }));
          }
        }
      }
    }

    return exports;
  }
}
