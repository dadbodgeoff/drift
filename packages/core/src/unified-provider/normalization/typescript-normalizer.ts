/**
 * TypeScript/JavaScript Call Chain Normalizer
 *
 * Converts TypeScript/JavaScript AST into unified call chains.
 * Handles all JS/TS-specific patterns including:
 * - Method chaining: obj.method1().method2()
 * - Property access: obj.prop.method()
 * - Optional chaining: obj?.method()
 * - Computed properties: obj['method']()
 * - Tagged templates: sql`SELECT * FROM users`
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
 * TypeScript/JavaScript normalizer
 */
export class TypeScriptNormalizer extends BaseNormalizer {
  readonly language = 'typescript' as const;

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
      // Only process call expressions that are the outermost in a chain
      if (node.type === 'call_expression' && !processedNodes.has(node)) {
        // Check if this call is part of a larger chain
        const parent = node.parent;
        if (parent?.type === 'member_expression' || parent?.type === 'call_expression') {
          // This call is part of a larger chain, skip it
          return;
        }

        const chain = this.extractCallChain(node, filePath);
        if (chain && chain.segments.length > 0) {
          chains.push(chain);
          // Mark all nodes in this chain as processed
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

    // Walk the chain from outermost to innermost
    while (current) {
      if (current.type === 'call_expression') {
        const funcNode = this.getChildByField(current, 'function');
        const argsNode = this.getChildByField(current, 'arguments');

        if (!funcNode) {break;}

        const args = argsNode ? this.normalizeArguments(argsNode) : [];

        if (funcNode.type === 'member_expression') {
          const propNode = this.getChildByField(funcNode, 'property');
          const objNode = this.getChildByField(funcNode, 'object');

          if (propNode) {
            const pos = this.getPosition(propNode);
            segments.unshift(this.createSegment(propNode.text, true, args, pos.line, pos.column));
          }

          current = objNode;
        } else if (funcNode.type === 'identifier') {
          const pos = this.getPosition(funcNode);
          segments.unshift(this.createSegment(funcNode.text, true, args, pos.line, pos.column));
          receiver = funcNode.text;
          break;
        } else if (funcNode.type === 'subscript_expression') {
          // obj['method']()
          const indexNode = this.getChildByField(funcNode, 'index');
          const objNode = this.getChildByField(funcNode, 'object');

          if (indexNode) {
            const methodName = this.extractStringValue(indexNode) ?? indexNode.text;
            const pos = this.getPosition(indexNode);
            segments.unshift(this.createSegment(methodName, true, args, pos.line, pos.column));
          }

          current = objNode;
        } else {
          break;
        }
      } else if (current.type === 'member_expression') {
        const propNode = this.getChildByField(current, 'property');
        const objNode = this.getChildByField(current, 'object');

        if (propNode) {
          const pos = this.getPosition(propNode);
          segments.unshift(this.createSegment(propNode.text, false, [], pos.line, pos.column));
        }

        current = objNode;
      } else if (current.type === 'identifier') {
        receiver = current.text;
        break;
      } else if (current.type === 'this') {
        receiver = 'this';
        break;
      } else {
        // Unknown node type, use its text as receiver
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
   * Normalize arguments from an arguments node
   */
  private normalizeArguments(argsNode: TreeSitterNode): NormalizedArg[] {
    const args: NormalizedArg[] = [];

    for (const child of argsNode.children) {
      // Skip punctuation
      if (child.type === '(' || child.type === ')' || child.type === ',') {
        continue;
      }

      args.push(this.normalizeArgument(child));
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
      case 'template_string':
        return this.createStringArg(node.text, pos.line, pos.column);

      case 'number':
        return this.createNumberArg(node.text, pos.line, pos.column);

      case 'true':
      case 'false':
        return this.createBooleanArg(node.text, pos.line, pos.column);

      case 'identifier':
        return this.createIdentifierArg(node.text, pos.line, pos.column);

      case 'object':
        return this.normalizeObjectLiteral(node);

      case 'array':
        return this.normalizeArrayLiteral(node);

      case 'call_expression':
        // Nested call - could be a callback or nested chain
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'arrow_function':
      case 'function':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      default:
        return this.createUnknownArg(node.text, pos.line, pos.column);
    }
  }

  /**
   * Normalize an object literal
   */
  private normalizeObjectLiteral(node: TreeSitterNode): NormalizedArg {
    const pos = this.getPosition(node);
    const properties: Record<string, NormalizedArg> = {};

    for (const child of node.children) {
      if (child.type === 'pair') {
        const keyNode = this.getChildByField(child, 'key');
        const valueNode = this.getChildByField(child, 'value');

        if (keyNode && valueNode) {
          let key = keyNode.text;
          // Remove quotes from string keys
          if (keyNode.type === 'string') {
            key = this.unquoteString(key);
          }
          properties[key] = this.normalizeArgument(valueNode);
        }
      } else if (child.type === 'shorthand_property_identifier') {
        const key = child.text;
        properties[key] = this.createIdentifierArg(key, pos.line, pos.column);
      }
    }

    return this.createObjectArg(node.text, properties, pos.line, pos.column);
  }

  /**
   * Normalize an array literal
   */
  private normalizeArrayLiteral(node: TreeSitterNode): NormalizedArg {
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
   * Mark all nodes in a chain as processed
   */
  private markChainNodesProcessed(node: TreeSitterNode, processed: Set<TreeSitterNode>): void {
    processed.add(node);
    for (const child of node.children) {
      if (child.type === 'call_expression' || child.type === 'member_expression') {
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
      if (node.type === 'function_declaration') {
        const func = this.extractFunctionDeclaration(node, filePath, null);
        if (func) {functions.push(func);}
      } else if (node.type === 'method_definition') {
        const className = this.findParentClassName(node);
        const func = this.extractMethodDefinition(node, filePath, className);
        if (func) {functions.push(func);}
      } else if (node.type === 'variable_declarator') {
        const func = this.extractVariableFunction(node, filePath);
        if (func) {functions.push(func);}
      }
    });

    return functions;
  }

  private extractFunctionDeclaration(
    node: TreeSitterNode,
    filePath: string,
    className: string | null
  ): UnifiedFunction | null {
    const nameNode = this.getChildByField(node, 'name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const params = this.extractParameters(this.getChildByField(node, 'parameters'));
    const returnType = this.getNodeText(this.getChildByField(node, 'return_type'));
    const bodyNode = this.getChildByField(node, 'body');
    const isAsync = this.hasChildOfType(node, 'async');
    const isExported = this.isExported(node);

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
      returnType: returnType || undefined,
      isMethod: !!className,
      isStatic: false,
      isExported,
      isConstructor: false,
      isAsync,
      className: className ?? undefined,
      decorators: this.extractDecorators(node),
      bodyStartLine: bodyNode ? this.getPosition(bodyNode).line : pos.line,
      bodyEndLine: bodyNode ? this.getEndPosition(bodyNode).line : endPos.line,
    });
  }

  private extractMethodDefinition(
    node: TreeSitterNode,
    filePath: string,
    className: string | null
  ): UnifiedFunction | null {
    const nameNode = this.getChildByField(node, 'name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const params = this.extractParameters(this.getChildByField(node, 'parameters'));
    const returnType = this.getNodeText(this.getChildByField(node, 'return_type'));
    const bodyNode = this.getChildByField(node, 'body');
    const isAsync = this.hasChildOfType(node, 'async');
    const isStatic = this.hasChildOfType(node, 'static');
    const isConstructor = name === 'constructor';

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
      returnType: returnType || undefined,
      isMethod: true,
      isStatic,
      isExported: false, // Methods inherit class export status
      isConstructor,
      isAsync,
      className: className ?? undefined,
      decorators: this.extractDecorators(node),
      bodyStartLine: bodyNode ? this.getPosition(bodyNode).line : pos.line,
      bodyEndLine: bodyNode ? this.getEndPosition(bodyNode).line : endPos.line,
    });
  }

  private extractVariableFunction(
    node: TreeSitterNode,
    filePath: string
  ): UnifiedFunction | null {
    const nameNode = this.getChildByField(node, 'name');
    const valueNode = this.getChildByField(node, 'value');

    if (!nameNode || !valueNode) {return null;}
    if (valueNode.type !== 'arrow_function' && valueNode.type !== 'function') {return null;}

    const name = nameNode.text;
    const params = this.extractParameters(this.getChildByField(valueNode, 'parameters'));
    const returnType = this.getNodeText(this.getChildByField(valueNode, 'return_type'));
    const bodyNode = this.getChildByField(valueNode, 'body');
    const isAsync = this.hasChildOfType(valueNode, 'async');

    // Check if parent variable_declaration is exported
    const varDecl = node.parent;
    const isExported = varDecl ? this.isExported(varDecl) : false;

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

    return this.createFunction({
      name,
      file: filePath,
      startLine: pos.line,
      endLine: endPos.line,
      startColumn: pos.column,
      endColumn: endPos.column,
      parameters: params,
      returnType: returnType || undefined,
      isMethod: false,
      isStatic: false,
      isExported,
      isConstructor: false,
      isAsync,
      decorators: [],
      bodyStartLine: bodyNode ? this.getPosition(bodyNode).line : pos.line,
      bodyEndLine: bodyNode ? this.getEndPosition(bodyNode).line : endPos.line,
    });
  }

  private extractParameters(paramsNode: TreeSitterNode | null): UnifiedParameter[] {
    if (!paramsNode) {return [];}

    const params: UnifiedParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === 'identifier') {
        params.push(this.createParameter(child.text));
      } else if (child.type === 'required_parameter' || child.type === 'optional_parameter') {
        const nameNode = this.getChildByField(child, 'pattern') ?? this.getChildByField(child, 'name');
        const typeNode = this.getChildByField(child, 'type');
        const hasDefault = child.type === 'optional_parameter' || this.hasChildOfType(child, '=');

        if (nameNode) {
          params.push(this.createParameter(
            nameNode.text,
            typeNode?.text,
            hasDefault
          ));
        }
      } else if (child.type === 'rest_pattern') {
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
      if (current.type === 'class_declaration' || current.type === 'class') {
        const nameNode = this.getChildByField(current, 'name');
        return nameNode?.text ?? null;
      }
      current = current.parent;
    }
    return null;
  }

  private isExported(node: TreeSitterNode): boolean {
    // Check for export keyword in parent
    const parent = node.parent;
    if (parent?.type === 'export_statement') {return true;}

    // Check for export modifier
    return node.children.some(c => c.type === 'export');
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
      if (node.type === 'class_declaration' || node.type === 'class') {
        const cls = this.extractClassDeclaration(node, filePath);
        if (cls) {classes.push(cls);}
      }
    });

    return classes;
  }

  private extractClassDeclaration(node: TreeSitterNode, filePath: string): UnifiedClass | null {
    const nameNode = this.getChildByField(node, 'name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const baseClasses: string[] = [];
    const methods: string[] = [];

    // Get heritage (extends/implements)
    const heritageNode = this.getChildByField(node, 'heritage');
    if (heritageNode) {
      for (const child of heritageNode.children) {
        if (child.type === 'extends_clause' || child.type === 'implements_clause') {
          for (const typeNode of child.children) {
            if (typeNode.type === 'identifier' || typeNode.type === 'type_identifier') {
              baseClasses.push(typeNode.text);
            }
          }
        }
      }
    }

    // Get methods
    const bodyNode = this.getChildByField(node, 'body');
    if (bodyNode) {
      for (const member of bodyNode.children) {
        if (member.type === 'method_definition') {
          const methodName = this.getChildByField(member, 'name');
          if (methodName) {methods.push(methodName.text);}
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
      isExported: this.isExported(node),
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
      }
    });

    return imports;
  }

  private extractImportStatement(node: TreeSitterNode): UnifiedImport | null {
    const sourceNode = this.getChildByField(node, 'source');
    if (!sourceNode) {return null;}

    const source = this.unquoteString(sourceNode.text);
    const names: Array<{ imported: string; local: string; isDefault: boolean; isNamespace: boolean }> = [];
    const isTypeOnly = this.hasChildOfType(node, 'type');

    for (const child of node.children) {
      if (child.type === 'import_clause') {
        for (const clauseChild of child.children) {
          if (clauseChild.type === 'identifier') {
            // Default import
            names.push({
              imported: 'default',
              local: clauseChild.text,
              isDefault: true,
              isNamespace: false,
            });
          } else if (clauseChild.type === 'namespace_import') {
            // import * as foo
            const aliasNode = clauseChild.children.find(c => c.type === 'identifier');
            if (aliasNode) {
              names.push({
                imported: '*',
                local: aliasNode.text,
                isDefault: false,
                isNamespace: true,
              });
            }
          } else if (clauseChild.type === 'named_imports') {
            // import { foo, bar as baz }
            for (const specifier of clauseChild.children) {
              if (specifier.type === 'import_specifier') {
                const nameNode = this.getChildByField(specifier, 'name');
                const aliasNode = this.getChildByField(specifier, 'alias');
                if (nameNode) {
                  names.push({
                    imported: nameNode.text,
                    local: aliasNode?.text ?? nameNode.text,
                    isDefault: false,
                    isNamespace: false,
                  });
                }
              }
            }
          }
        }
      }
    }

    if (names.length === 0) {
      // Side-effect import: import 'module'
      names.push({
        imported: '*',
        local: '*',
        isDefault: false,
        isNamespace: true,
      });
    }

    return this.createImport({
      source,
      names,
      line: this.getPosition(node).line,
      isTypeOnly,
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
    const exports: UnifiedExport[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'export_statement') {
        const exp = this.extractExportStatement(node);
        exports.push(...exp);
      }
    });

    return exports;
  }

  private extractExportStatement(node: TreeSitterNode): UnifiedExport[] {
    const exports: UnifiedExport[] = [];
    const pos = this.getPosition(node);

    // Check for re-export: export { foo } from 'module'
    const sourceNode = this.getChildByField(node, 'source');
    const source = sourceNode ? this.unquoteString(sourceNode.text) : undefined;

    // Check for default export
    const isDefault = this.hasChildOfType(node, 'default');

    for (const child of node.children) {
      if (child.type === 'export_clause') {
        for (const specifier of child.children) {
          if (specifier.type === 'export_specifier') {
            const nameNode = this.getChildByField(specifier, 'name');
            if (nameNode) {
              exports.push(this.createExport({
                name: nameNode.text,
                isDefault: false,
                isReExport: !!source,
                source,
                line: pos.line,
              }));
            }
          }
        }
      } else if (child.type === 'function_declaration' || child.type === 'class_declaration') {
        const nameNode = this.getChildByField(child, 'name');
        if (nameNode) {
          exports.push(this.createExport({
            name: nameNode.text,
            isDefault,
            isReExport: false,
            line: pos.line,
          }));
        }
      } else if (child.type === 'lexical_declaration') {
        for (const decl of child.children) {
          if (decl.type === 'variable_declarator') {
            const nameNode = this.getChildByField(decl, 'name');
            if (nameNode) {
              exports.push(this.createExport({
                name: nameNode.text,
                isDefault,
                isReExport: false,
                line: pos.line,
              }));
            }
          }
        }
      }
    }

    // Handle: export default expression
    if (isDefault && exports.length === 0) {
      exports.push(this.createExport({
        name: 'default',
        isDefault: true,
        isReExport: false,
        line: pos.line,
      }));
    }

    return exports;
  }
}
