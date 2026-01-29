/**
 * Go Call Chain Normalizer
 *
 * Converts Go AST into unified call chains.
 * Handles Go-specific patterns including:
 * - Method chaining: obj.Method1().Method2()
 * - Selector expressions: pkg.Function()
 * - Struct literals: Type{field: value}
 * - Goroutines: go func()
 * - Defer statements: defer func()
 * - Error handling: if err != nil
 *
 * @requirements Go Language Support
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
 * Go normalizer
 */
export class GoNormalizer extends BaseNormalizer {
  readonly language = 'go' as const;

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
      if (node.type === 'call_expression' && !processedNodes.has(node)) {
        // Check if this call is part of a larger chain
        const parent = node.parent;
        if (parent?.type === 'selector_expression' || parent?.type === 'call_expression') {
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
      if (current.type === 'call_expression') {
        const funcNode = this.getChildByField(current, 'function');
        const argsNode = this.getChildByField(current, 'arguments');

        if (!funcNode) {break;}

        const args = argsNode ? this.normalizeArguments(argsNode) : [];

        if (funcNode.type === 'selector_expression') {
          // obj.Method() or pkg.Function()
          const fieldNode = this.getChildByField(funcNode, 'field');
          const operandNode = this.getChildByField(funcNode, 'operand');

          if (fieldNode) {
            const pos = this.getPosition(fieldNode);
            segments.unshift(this.createSegment(fieldNode.text, true, args, pos.line, pos.column));
          }

          current = operandNode;
        } else if (funcNode.type === 'identifier') {
          // Direct function call: Function()
          const pos = this.getPosition(funcNode);
          segments.unshift(this.createSegment(funcNode.text, true, args, pos.line, pos.column));
          receiver = funcNode.text;
          break;
        } else {
          break;
        }
      } else if (current.type === 'selector_expression') {
        // Property access without call: obj.field
        const fieldNode = this.getChildByField(current, 'field');
        const operandNode = this.getChildByField(current, 'operand');

        if (fieldNode) {
          const pos = this.getPosition(fieldNode);
          segments.unshift(this.createSegment(fieldNode.text, false, [], pos.line, pos.column));
        }

        current = operandNode;
      } else if (current.type === 'identifier') {
        receiver = current.text;
        break;
      } else if (current.type === 'index_expression') {
        // array[index].Method()
        const operandNode = this.getChildByField(current, 'operand');
        current = operandNode;
      } else if (current.type === 'type_assertion_expression') {
        // obj.(Type).Method()
        const operandNode = this.getChildByField(current, 'operand');
        current = operandNode;
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
      case 'interpreted_string_literal':
      case 'raw_string_literal':
        return this.createStringArg(node.text, pos.line, pos.column);

      case 'int_literal':
      case 'float_literal':
        return this.createNumberArg(node.text, pos.line, pos.column);

      case 'true':
      case 'false':
        return this.createBooleanArg(node.text, pos.line, pos.column);

      case 'nil':
        return this.createUnknownArg('nil', pos.line, pos.column);

      case 'identifier':
        // Check for Go boolean literals
        if (node.text === 'true' || node.text === 'false') {
          return this.createBooleanArg(node.text, pos.line, pos.column);
        }
        if (node.text === 'nil') {
          return this.createUnknownArg('nil', pos.line, pos.column);
        }
        return this.createIdentifierArg(node.text, pos.line, pos.column);

      case 'composite_literal':
        return this.normalizeCompositeLiteral(node);

      case 'slice_expression':
      case 'index_expression':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'call_expression':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'func_literal':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'unary_expression':
        // Handle &obj, *ptr, etc.
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'binary_expression':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'selector_expression':
        return this.createIdentifierArg(node.text, pos.line, pos.column);

      default:
        return this.createUnknownArg(node.text, pos.line, pos.column);
    }
  }

  /**
   * Normalize a composite literal (struct, map, slice)
   */
  private normalizeCompositeLiteral(node: TreeSitterNode): NormalizedArg {
    const pos = this.getPosition(node);
    const typeNode = this.getChildByField(node, 'type');
    const bodyNode = this.getChildByField(node, 'body');

    // Check if it's a map or struct
    if (typeNode?.type === 'map_type' || this.isStructLiteral(node)) {
      const properties: Record<string, NormalizedArg> = {};

      if (bodyNode) {
        for (const child of bodyNode.children) {
          if (child.type === 'keyed_element') {
            const keyNode = child.children.find(c =>
              c.type === 'literal_element' || c.type === 'identifier'
            );
            const valueNode = child.children.find(c =>
              c !== keyNode && c.type !== ':'
            );

            if (keyNode && valueNode) {
              const key = this.unquoteString(keyNode.text);
              properties[key] = this.normalizeArgument(valueNode);
            }
          }
        }
      }

      return this.createObjectArg(node.text, properties, pos.line, pos.column);
    }

    // Slice/array literal
    const elements: NormalizedArg[] = [];
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type !== '{' && child.type !== '}' && child.type !== ',') {
          if (child.type === 'literal_element') {
            elements.push(this.normalizeArgument(child.children[0] ?? child));
          } else {
            elements.push(this.normalizeArgument(child));
          }
        }
      }
    }

    return this.createArrayArg(node.text, elements, pos.line, pos.column);
  }

  /**
   * Check if a composite literal is a struct literal
   */
  private isStructLiteral(node: TreeSitterNode): boolean {
    const typeNode = this.getChildByField(node, 'type');
    if (!typeNode) {return false;}

    // Type identifier (struct name) or qualified type (pkg.Struct)
    return typeNode.type === 'type_identifier' ||
           typeNode.type === 'qualified_type';
  }

  /**
   * Mark all nodes in a chain as processed
   */
  private markChainNodesProcessed(node: TreeSitterNode, processed: Set<TreeSitterNode>): void {
    processed.add(node);
    for (const child of node.children) {
      if (child.type === 'call_expression' || child.type === 'selector_expression') {
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
    const packageName = this.extractPackageName(rootNode);

    this.traverseNode(rootNode, node => {
      if (node.type === 'function_declaration') {
        const func = this.extractFunctionDeclaration(node, filePath, packageName);
        if (func) {functions.push(func);}
      } else if (node.type === 'method_declaration') {
        const func = this.extractMethodDeclaration(node, filePath, packageName);
        if (func) {functions.push(func);}
      }
    });

    return functions;
  }

  private extractPackageName(rootNode: TreeSitterNode): string {
    for (const child of rootNode.children) {
      if (child.type === 'package_clause') {
        const nameNode = this.getChildByField(child, 'name') ??
                         child.children.find(c => c.type === 'package_identifier');
        return nameNode?.text ?? 'main';
      }
    }
    return 'main';
  }

  private extractFunctionDeclaration(
    node: TreeSitterNode,
    filePath: string,
    packageName: string
  ): UnifiedFunction | null {
    const nameNode = this.getChildByField(node, 'name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const params = this.extractParameters(this.getChildByField(node, 'parameters'));
    const resultNode = this.getChildByField(node, 'result');
    const returnType = resultNode?.text;
    const bodyNode = this.getChildByField(node, 'body');

    const isExported = /^[A-Z]/.test(name);
    const isConstructor = name === 'New' || name.startsWith('New');

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

    return this.createFunction({
      name,
      qualifiedName: `${packageName}.${name}`,
      file: filePath,
      startLine: pos.line,
      endLine: endPos.line,
      startColumn: pos.column,
      endColumn: endPos.column,
      parameters: params,
      returnType,
      isMethod: false,
      isStatic: true, // Go functions are effectively static
      isExported,
      isConstructor,
      isAsync: false, // Go uses goroutines, not async
      decorators: [],
      bodyStartLine: bodyNode ? this.getPosition(bodyNode).line : pos.line,
      bodyEndLine: bodyNode ? this.getEndPosition(bodyNode).line : endPos.line,
    });
  }

  private extractMethodDeclaration(
    node: TreeSitterNode,
    filePath: string,
    packageName: string
  ): UnifiedFunction | null {
    const nameNode = this.getChildByField(node, 'name');
    const receiverNode = this.getChildByField(node, 'receiver');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const params = this.extractParameters(this.getChildByField(node, 'parameters'));
    const resultNode = this.getChildByField(node, 'result');
    const returnType = resultNode?.text;
    const bodyNode = this.getChildByField(node, 'body');

    // Extract receiver type
    let className: string | undefined;
    if (receiverNode) {
      className = this.extractReceiverType(receiverNode);
    }

    const isExported = /^[A-Z]/.test(name);

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

    return this.createFunction({
      name,
      qualifiedName: className ? `${packageName}.${className}.${name}` : `${packageName}.${name}`,
      file: filePath,
      startLine: pos.line,
      endLine: endPos.line,
      startColumn: pos.column,
      endColumn: endPos.column,
      parameters: params,
      returnType,
      isMethod: true,
      isStatic: false,
      isExported,
      isConstructor: false,
      isAsync: false,
      className,
      decorators: [],
      bodyStartLine: bodyNode ? this.getPosition(bodyNode).line : pos.line,
      bodyEndLine: bodyNode ? this.getEndPosition(bodyNode).line : endPos.line,
    });
  }

  private extractReceiverType(receiverNode: TreeSitterNode): string | undefined {
    for (const child of receiverNode.children) {
      if (child.type === 'parameter_declaration') {
        const typeNode = this.getChildByField(child, 'type');
        if (typeNode) {
          // Handle pointer types: *Server -> Server
          if (typeNode.type === 'pointer_type') {
            const innerType = typeNode.namedChildren[0];
            return innerType?.text;
          }
          return typeNode.text;
        }
      }
    }
    return undefined;
  }

  private extractParameters(paramsNode: TreeSitterNode | null): UnifiedParameter[] {
    if (!paramsNode) {return [];}

    const params: UnifiedParameter[] = [];

    for (const child of paramsNode.children) {
      if (child.type === 'parameter_declaration') {
        const names: string[] = [];
        let type: string | undefined;
        let isVariadic = false;

        for (const paramChild of child.children) {
          if (paramChild.type === 'identifier') {
            names.push(paramChild.text);
          } else if (paramChild.type === 'variadic_parameter_declaration') {
            isVariadic = true;
            const variadicType = this.getChildByField(paramChild, 'type');
            type = variadicType?.text;
          } else if (this.isTypeNode(paramChild)) {
            type = paramChild.text;
          }
        }

        if (names.length === 0) {
          params.push(this.createParameter('_', type, false, isVariadic));
        } else {
          for (const name of names) {
            params.push(this.createParameter(name, type, false, isVariadic));
          }
        }
      } else if (child.type === 'variadic_parameter_declaration') {
        const nameNode = child.children.find(c => c.type === 'identifier');
        const typeNode = this.getChildByField(child, 'type');
        params.push(this.createParameter(nameNode?.text ?? '_', typeNode?.text, false, true));
      }
    }

    return params;
  }

  private isTypeNode(node: TreeSitterNode): boolean {
    const typeNodes = [
      'type_identifier',
      'pointer_type',
      'slice_type',
      'array_type',
      'map_type',
      'channel_type',
      'function_type',
      'qualified_type',
      'struct_type',
      'interface_type',
    ];
    return typeNodes.includes(node.type);
  }

  // ============================================================================
  // Class (Struct/Interface) Extraction
  // ============================================================================

  extractClasses(
    rootNode: TreeSitterNode,
    _source: string,
    filePath: string
  ): UnifiedClass[] {
    const classes: UnifiedClass[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'type_declaration') {
        for (const child of node.children) {
          if (child.type === 'type_spec') {
            const cls = this.extractTypeSpec(child, filePath);
            if (cls) {classes.push(cls);}
          }
        }
      }
    });

    return classes;
  }

  private extractTypeSpec(node: TreeSitterNode, filePath: string): UnifiedClass | null {
    const nameNode = this.getChildByField(node, 'name');
    const typeNode = this.getChildByField(node, 'type');

    if (!nameNode || !typeNode) {return null;}

    // Only extract structs and interfaces
    if (typeNode.type !== 'struct_type' && typeNode.type !== 'interface_type') {
      return null;
    }

    const name = nameNode.text;
    const isExported = /^[A-Z]/.test(name);
    const baseClasses: string[] = [];
    const methods: string[] = [];

    if (typeNode.type === 'struct_type') {
      // Extract embedded types from struct
      const fieldListNode = this.getChildByField(typeNode, 'fields') ??
                            typeNode.children.find(c => c.type === 'field_declaration_list');

      if (fieldListNode) {
        for (const field of fieldListNode.children) {
          if (field.type === 'field_declaration') {
            // Check for embedded type (no field name)
            const hasName = field.children.some(c => c.type === 'field_identifier');
            if (!hasName) {
              const typeChild = field.children.find(c => this.isTypeNode(c));
              if (typeChild) {
                baseClasses.push(typeChild.text.replace(/^\*/, ''));
              }
            }
          }
        }
      }
    } else if (typeNode.type === 'interface_type') {
      // Extract method signatures and embedded interfaces
      for (const child of typeNode.children) {
        if (child.type === 'method_spec') {
          const methodNameNode = this.getChildByField(child, 'name');
          if (methodNameNode) {
            methods.push(methodNameNode.text);
          }
        } else if (child.type === 'type_identifier' || child.type === 'qualified_type') {
          // Embedded interface
          baseClasses.push(child.text);
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
      isExported,
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
      if (node.type === 'import_declaration') {
        const importSpecs = this.findNodesOfTypeGo(node, 'import_spec');
        for (const spec of importSpecs) {
          const imp = this.extractImportSpec(spec);
          if (imp) {imports.push(imp);}
        }
      }
    });

    return imports;
  }

  private extractImportSpec(node: TreeSitterNode): UnifiedImport | null {
    const pathNode = this.getChildByField(node, 'path') ??
                     node.children.find(c => c.type === 'interpreted_string_literal');

    if (!pathNode) {return null;}

    const path = this.unquoteString(pathNode.text);
    const packageName = path.split('/').pop() ?? path;

    // Check for alias
    const nameNode = this.getChildByField(node, 'name') ??
                     node.children.find(c =>
                       c.type === 'package_identifier' ||
                       c.type === 'blank_identifier' ||
                       c.type === 'dot'
                     );

    let alias: string | null = null;
    let isDotImport = false;

    if (nameNode) {
      if (nameNode.type === 'blank_identifier' || nameNode.text === '_') {
        alias = '_';
      } else if (nameNode.type === 'dot' || nameNode.text === '.') {
        isDotImport = true;
        alias = '.';
      } else {
        alias = nameNode.text;
      }
    }

    return this.createImport({
      source: path,
      names: [{
        imported: packageName,
        local: alias ?? packageName,
        isDefault: false,
        isNamespace: isDotImport,
      }],
      line: this.getPosition(node).line,
      isTypeOnly: false,
    });
  }

  private findNodesOfTypeGo(node: TreeSitterNode, type: string): TreeSitterNode[] {
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

  // ============================================================================
  // Export Extraction
  // ============================================================================

  extractExports(
    rootNode: TreeSitterNode,
    _source: string,
    _filePath: string
  ): UnifiedExport[] {
    // Go exports are determined by capitalization
    // All public (capitalized) top-level declarations are exports
    const exports: UnifiedExport[] = [];

    for (const child of rootNode.children) {
      if (child.type === 'function_declaration') {
        const nameNode = this.getChildByField(child, 'name');
        if (nameNode && /^[A-Z]/.test(nameNode.text)) {
          exports.push(this.createExport({
            name: nameNode.text,
            line: this.getPosition(child).line,
          }));
        }
      } else if (child.type === 'method_declaration') {
        const nameNode = this.getChildByField(child, 'name');
        if (nameNode && /^[A-Z]/.test(nameNode.text)) {
          exports.push(this.createExport({
            name: nameNode.text,
            line: this.getPosition(child).line,
          }));
        }
      } else if (child.type === 'type_declaration') {
        for (const typeSpec of child.children) {
          if (typeSpec.type === 'type_spec') {
            const nameNode = this.getChildByField(typeSpec, 'name');
            if (nameNode && /^[A-Z]/.test(nameNode.text)) {
              exports.push(this.createExport({
                name: nameNode.text,
                line: this.getPosition(typeSpec).line,
              }));
            }
          }
        }
      } else if (child.type === 'var_declaration' || child.type === 'const_declaration') {
        for (const spec of child.children) {
          if (spec.type === 'var_spec' || spec.type === 'const_spec') {
            const nameNode = spec.children.find(c => c.type === 'identifier');
            if (nameNode && /^[A-Z]/.test(nameNode.text)) {
              exports.push(this.createExport({
                name: nameNode.text,
                line: this.getPosition(spec).line,
              }));
            }
          }
        }
      }
    }

    return exports;
  }
}
