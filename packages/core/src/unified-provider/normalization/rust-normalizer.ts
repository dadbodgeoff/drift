/**
 * Rust Call Chain Normalizer
 *
 * Converts Rust AST into unified call chains.
 * Handles Rust-specific patterns including:
 * - Method chaining: obj.method1().method2()
 * - Path expressions: Path::to::function()
 * - Macro invocations: macro_name!()
 * - Async/await: async fn, .await
 * - Result/Option chaining: .unwrap(), .map(), .and_then()
 * - Builder patterns
 * - Closures
 *
 * @requirements Rust Language Support
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
 * Rust normalizer
 */
export class RustNormalizer extends BaseNormalizer {
  readonly language = 'rust' as const;

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
      if ((node.type === 'call_expression' || node.type === 'method_call_expression') &&
          !processedNodes.has(node)) {
        // Check if this call is part of a larger chain
        const parent = node.parent;
        if (parent?.type === 'method_call_expression' || parent?.type === 'call_expression') {
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
      if (current.type === 'method_call_expression') {
        const nameNode = this.getChildByField(current, 'name');
        const argsNode = this.getChildByField(current, 'arguments');
        const valueNode = this.getChildByField(current, 'value');

        if (nameNode) {
          const args = argsNode ? this.normalizeArguments(argsNode) : [];
          const pos = this.getPosition(nameNode);
          segments.unshift(this.createSegment(nameNode.text, true, args, pos.line, pos.column));
        }

        current = valueNode;
      } else if (current.type === 'call_expression') {
        const funcNode = this.getChildByField(current, 'function');
        const argsNode = this.getChildByField(current, 'arguments');

        if (!funcNode) {break;}

        const args = argsNode ? this.normalizeArguments(argsNode) : [];

        if (funcNode.type === 'scoped_identifier') {
          // Path::to::function()
          const parts = funcNode.text.split('::');
          const funcName = parts.pop() ?? funcNode.text;
          const pos = this.getPosition(funcNode);
          segments.unshift(this.createSegment(funcName, true, args, pos.line, pos.column));
          receiver = parts.join('::');
          break;
        } else if (funcNode.type === 'field_expression') {
          // obj.field() - rare in Rust, usually method_call_expression
          const fieldNode = this.getChildByField(funcNode, 'field');
          const valueNode = this.getChildByField(funcNode, 'value');

          if (fieldNode) {
            const pos = this.getPosition(fieldNode);
            segments.unshift(this.createSegment(fieldNode.text, true, args, pos.line, pos.column));
          }

          current = valueNode;
        } else if (funcNode.type === 'identifier') {
          const pos = this.getPosition(funcNode);
          segments.unshift(this.createSegment(funcNode.text, true, args, pos.line, pos.column));
          receiver = funcNode.text;
          break;
        } else {
          break;
        }
      } else if (current.type === 'field_expression') {
        // Property access without call
        const fieldNode = this.getChildByField(current, 'field');
        const valueNode = this.getChildByField(current, 'value');

        if (fieldNode) {
          const pos = this.getPosition(fieldNode);
          segments.unshift(this.createSegment(fieldNode.text, false, [], pos.line, pos.column));
        }

        current = valueNode;
      } else if (current.type === 'await_expression') {
        // .await
        const pos = this.getPosition(current);
        segments.unshift(this.createSegment('await', false, [], pos.line, pos.column));
        const awaitValueNode: TreeSitterNode | null = this.getChildByField(current, 'value') ?? current.namedChildren[0] ?? null;
        current = awaitValueNode;
      } else if (current.type === 'try_expression') {
        // ? operator
        const pos = this.getPosition(current);
        segments.unshift(this.createSegment('?', false, [], pos.line, pos.column));
        const tryValueNode: TreeSitterNode | null = current.namedChildren[0] ?? null;
        current = tryValueNode;
      } else if (current.type === 'identifier') {
        receiver = current.text;
        break;
      } else if (current.type === 'scoped_identifier') {
        receiver = current.text;
        break;
      } else if (current.type === 'index_expression') {
        // array[index].method()
        const valueNode = this.getChildByField(current, 'value');
        current = valueNode;
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
   * Normalize arguments from an argument list node
   */
  private normalizeArguments(argsNode: TreeSitterNode): NormalizedArg[] {
    const args: NormalizedArg[] = [];

    for (const child of argsNode.children) {
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
      case 'string_literal':
      case 'raw_string_literal':
        return this.createStringArg(node.text, pos.line, pos.column);

      case 'integer_literal':
      case 'float_literal':
        return this.createNumberArg(node.text, pos.line, pos.column);

      case 'boolean_literal':
        return this.createBooleanArg(node.text, pos.line, pos.column);

      case 'identifier':
        if (node.text === 'true' || node.text === 'false') {
          return this.createBooleanArg(node.text, pos.line, pos.column);
        }
        if (node.text === 'None') {
          return this.createUnknownArg('None', pos.line, pos.column);
        }
        return this.createIdentifierArg(node.text, pos.line, pos.column);

      case 'struct_expression':
        return this.normalizeStructExpression(node);

      case 'array_expression':
        return this.normalizeArrayExpression(node);

      case 'tuple_expression':
        return this.normalizeTupleExpression(node);

      case 'call_expression':
      case 'method_call_expression':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'closure_expression':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'reference_expression':
        // &value, &mut value
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'unary_expression':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'binary_expression':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'scoped_identifier':
        return this.createIdentifierArg(node.text, pos.line, pos.column);

      case 'field_expression':
        return this.createIdentifierArg(node.text, pos.line, pos.column);

      default:
        return this.createUnknownArg(node.text, pos.line, pos.column);
    }
  }

  /**
   * Normalize a struct expression
   */
  private normalizeStructExpression(node: TreeSitterNode): NormalizedArg {
    const pos = this.getPosition(node);
    const properties: Record<string, NormalizedArg> = {};

    const bodyNode = node.children.find(c => c.type === 'field_initializer_list');
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'field_initializer') {
          const nameNode = this.getChildByField(child, 'name') ??
                           child.children.find(c => c.type === 'field_identifier');
          const valueNode = this.getChildByField(child, 'value') ??
                            child.children.find(c => c !== nameNode && c.type !== ':');

          if (nameNode && valueNode) {
            properties[nameNode.text] = this.normalizeArgument(valueNode);
          }
        } else if (child.type === 'shorthand_field_initializer') {
          const nameNode = child.children.find(c => c.type === 'identifier');
          if (nameNode) {
            properties[nameNode.text] = this.createIdentifierArg(nameNode.text, pos.line, pos.column);
          }
        }
      }
    }

    return this.createObjectArg(node.text, properties, pos.line, pos.column);
  }

  /**
   * Normalize an array expression
   */
  private normalizeArrayExpression(node: TreeSitterNode): NormalizedArg {
    const pos = this.getPosition(node);
    const elements: NormalizedArg[] = [];

    for (const child of node.children) {
      if (child.type !== '[' && child.type !== ']' && child.type !== ',' && child.type !== ';') {
        elements.push(this.normalizeArgument(child));
      }
    }

    return this.createArrayArg(node.text, elements, pos.line, pos.column);
  }

  /**
   * Normalize a tuple expression
   */
  private normalizeTupleExpression(node: TreeSitterNode): NormalizedArg {
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
      if (child.type === 'call_expression' ||
          child.type === 'method_call_expression' ||
          child.type === 'field_expression') {
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
    const moduleName = this.extractModuleName(filePath);

    this.traverseNode(rootNode, node => {
      if (node.type === 'function_item') {
        const func = this.extractFunctionItem(node, filePath, moduleName, null);
        if (func) {functions.push(func);}
      } else if (node.type === 'impl_item') {
        const implFunctions = this.extractImplFunctions(node, filePath, moduleName);
        functions.push(...implFunctions);
      }
    });

    return functions;
  }

  private extractModuleName(filePath: string): string {
    const parts = filePath.split('/');
    const fileName = parts[parts.length - 1] ?? 'main';
    return fileName.replace('.rs', '');
  }

  private extractFunctionItem(
    node: TreeSitterNode,
    filePath: string,
    moduleName: string,
    implName: string | null
  ): UnifiedFunction | null {
    const nameNode = this.getChildByField(node, 'name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const params = this.extractParameters(this.getChildByField(node, 'parameters'));
    const returnTypeNode = this.getChildByField(node, 'return_type');
    const returnType = returnTypeNode?.text?.replace(/^->\s*/, '');
    const bodyNode = this.getChildByField(node, 'body');

    const isPublic = this.hasVisibilityModifier(node, 'pub');
    const isAsync = this.hasModifier(node, 'async');
    const isConstructor = name === 'new' || name === 'default';

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

    const qualifiedName = implName
      ? `${moduleName}::${implName}::${name}`
      : `${moduleName}::${name}`;

    return this.createFunction({
      name,
      qualifiedName,
      file: filePath,
      startLine: pos.line,
      endLine: endPos.line,
      startColumn: pos.column,
      endColumn: endPos.column,
      parameters: params,
      returnType,
      isMethod: implName !== null,
      isStatic: implName !== null && !this.hasSelfParameter(this.getChildByField(node, 'parameters')),
      isExported: isPublic,
      isConstructor,
      isAsync,
      className: implName ?? undefined,
      decorators: this.extractAttributes(node),
      bodyStartLine: bodyNode ? this.getPosition(bodyNode).line : pos.line,
      bodyEndLine: bodyNode ? this.getEndPosition(bodyNode).line : endPos.line,
    });
  }

  private extractImplFunctions(
    node: TreeSitterNode,
    filePath: string,
    moduleName: string
  ): UnifiedFunction[] {
    const functions: UnifiedFunction[] = [];

    const typeNode = this.getChildByField(node, 'type');
    const traitNode = this.getChildByField(node, 'trait');

    if (!typeNode) {return functions;}

    let implName = this.extractTypeName(typeNode);
    if (traitNode) {
      const traitName = this.extractTypeName(traitNode);
      implName = `${traitName} for ${implName}`;
    }

    const bodyNode = this.getChildByField(node, 'body');
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'function_item') {
          const func = this.extractFunctionItem(child, filePath, moduleName, implName);
          if (func) {functions.push(func);}
        }
      }
    }

    return functions;
  }

  private extractParameters(paramsNode: TreeSitterNode | null): UnifiedParameter[] {
    if (!paramsNode) {return [];}

    const params: UnifiedParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === 'parameter') {
        const patternNode = this.getChildByField(child, 'pattern');
        const typeNode = this.getChildByField(child, 'type');

        const name = patternNode?.text ?? '_';
        const type = typeNode?.text;

        params.push(this.createParameter(name, type, false, false));
      } else if (child.type === 'self_parameter') {
        params.push(this.createParameter('self', child.text, false, false));
      }
    }

    return params;
  }

  private hasSelfParameter(paramsNode: TreeSitterNode | null): boolean {
    if (!paramsNode) {return false;}

    for (const child of paramsNode.children) {
      if (child.type === 'self_parameter') {
        return true;
      }
    }
    return false;
  }

  private hasVisibilityModifier(node: TreeSitterNode, modifier: string): boolean {
    for (const child of node.children) {
      if (child.type === 'visibility_modifier') {
        return child.text.startsWith(modifier);
      }
    }
    return false;
  }

  private hasModifier(node: TreeSitterNode, modifier: string): boolean {
    for (const child of node.children) {
      if (child.type === modifier || child.text === modifier) {
        return true;
      }
    }
    return false;
  }

  private extractAttributes(node: TreeSitterNode): string[] {
    const attributes: string[] = [];

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

  private extractTypeName(node: TreeSitterNode): string {
    if (node.type === 'type_identifier') {
      return node.text;
    } else if (node.type === 'scoped_type_identifier') {
      return node.text;
    } else if (node.type === 'generic_type') {
      const typeNode = this.getChildByField(node, 'type');
      return typeNode?.text ?? node.text;
    }
    return node.text;
  }

  // ============================================================================
  // Class (Struct/Trait/Enum) Extraction
  // ============================================================================

  extractClasses(
    rootNode: TreeSitterNode,
    _source: string,
    filePath: string
  ): UnifiedClass[] {
    const classes: UnifiedClass[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'struct_item') {
        const cls = this.extractStructItem(node, filePath);
        if (cls) {classes.push(cls);}
      } else if (node.type === 'enum_item') {
        const cls = this.extractEnumItem(node, filePath);
        if (cls) {classes.push(cls);}
      } else if (node.type === 'trait_item') {
        const cls = this.extractTraitItem(node, filePath);
        if (cls) {classes.push(cls);}
      }
    });

    return classes;
  }

  private extractStructItem(node: TreeSitterNode, filePath: string): UnifiedClass | null {
    const nameNode = this.getChildByField(node, 'name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const isPublic = this.hasVisibilityModifier(node, 'pub');

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

    return this.createClass({
      name,
      file: filePath,
      startLine: pos.line,
      endLine: endPos.line,
      baseClasses: [],
      methods: [],
      isExported: isPublic,
    });
  }

  private extractEnumItem(node: TreeSitterNode, filePath: string): UnifiedClass | null {
    const nameNode = this.getChildByField(node, 'name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const isPublic = this.hasVisibilityModifier(node, 'pub');

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

    return this.createClass({
      name,
      file: filePath,
      startLine: pos.line,
      endLine: endPos.line,
      baseClasses: [],
      methods: [],
      isExported: isPublic,
    });
  }

  private extractTraitItem(node: TreeSitterNode, filePath: string): UnifiedClass | null {
    const nameNode = this.getChildByField(node, 'name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const isPublic = this.hasVisibilityModifier(node, 'pub');
    const methods: string[] = [];
    const baseClasses: string[] = [];

    // Extract super traits
    const boundsNode = this.getChildByField(node, 'bounds');
    if (boundsNode) {
      for (const child of boundsNode.children) {
        if (child.type === 'type_identifier' || child.type === 'scoped_type_identifier') {
          baseClasses.push(child.text);
        }
      }
    }

    // Extract method signatures
    const bodyNode = this.getChildByField(node, 'body');
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'function_signature_item' || child.type === 'function_item') {
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
      isExported: isPublic,
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
      if (node.type === 'use_declaration') {
        const argumentNode = this.getChildByField(node, 'argument');
        if (argumentNode) {
          const useImports = this.extractUseTree(argumentNode);
          for (const imp of useImports) {
            imports.push(this.createImport({
              source: imp.source,
              names: [{
                imported: imp.name,
                local: imp.alias ?? imp.name,
                isDefault: false,
                isNamespace: imp.isGlob,
              }],
              line: this.getPosition(node).line,
              isTypeOnly: false,
            }));
          }
        }
      }
    });

    return imports;
  }

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
      imports.push({ source: path, name, isGlob: false });
    } else if (node.type === 'use_wildcard') {
      const pathNode = this.getChildByField(node, 'path');
      imports.push({ source: pathNode?.text ?? '', name: '*', isGlob: true });
    } else if (node.type === 'use_as_clause') {
      const pathNode = this.getChildByField(node, 'path');
      const aliasNode = this.getChildByField(node, 'alias');
      const path = pathNode?.text ?? '';
      const parts = path.split('::');
      const name = parts[parts.length - 1] ?? path;
      const aliasText = aliasNode?.text;
      imports.push({ source: path, name, ...(aliasText ? { alias: aliasText } : {}), isGlob: false });
    } else if (node.type === 'scoped_use_list') {
      const pathNode = this.getChildByField(node, 'path');
      const listNode = this.getChildByField(node, 'list');
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

  // ============================================================================
  // Export Extraction
  // ============================================================================

  extractExports(
    rootNode: TreeSitterNode,
    _source: string,
    _filePath: string
  ): UnifiedExport[] {
    const exports: UnifiedExport[] = [];

    for (const child of rootNode.children) {
      if (child.type === 'function_item') {
        if (this.hasVisibilityModifier(child, 'pub')) {
          const nameNode = this.getChildByField(child, 'name');
          if (nameNode) {
            exports.push(this.createExport({
              name: nameNode.text,
              line: this.getPosition(child).line,
            }));
          }
        }
      } else if (child.type === 'struct_item' || child.type === 'enum_item' || child.type === 'trait_item') {
        if (this.hasVisibilityModifier(child, 'pub')) {
          const nameNode = this.getChildByField(child, 'name');
          if (nameNode) {
            exports.push(this.createExport({
              name: nameNode.text,
              line: this.getPosition(child).line,
            }));
          }
        }
      } else if (child.type === 'const_item' || child.type === 'static_item') {
        if (this.hasVisibilityModifier(child, 'pub')) {
          const nameNode = this.getChildByField(child, 'name');
          if (nameNode) {
            exports.push(this.createExport({
              name: nameNode.text,
              line: this.getPosition(child).line,
            }));
          }
        }
      } else if (child.type === 'mod_item') {
        if (this.hasVisibilityModifier(child, 'pub')) {
          const nameNode = this.getChildByField(child, 'name');
          if (nameNode) {
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
