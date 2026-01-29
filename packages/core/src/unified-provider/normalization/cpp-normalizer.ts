/**
 * C++ Call Chain Normalizer
 *
 * Converts C++ AST into unified call chains.
 * Handles C++-specific patterns including:
 * - Method chaining: obj.method1().method2()
 * - Pointer method calls: ptr->method()
 * - Namespace-qualified calls: ns::Class::method()
 * - Template instantiation: func<T>()
 * - Operator overloading: obj << value
 * - Smart pointers: unique_ptr, shared_ptr
 * - STL containers and algorithms
 *
 * @requirements C++ Language Support
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
 * C++ normalizer
 */
export class CppNormalizer extends BaseNormalizer {
  readonly language = 'cpp' as const;

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
      if ((node.type === 'call_expression' || node.type === 'field_expression') &&
          !processedNodes.has(node)) {
        // Check if this call is part of a larger chain
        const parent = node.parent;
        if (parent?.type === 'call_expression' || parent?.type === 'field_expression') {
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

        if (funcNode.type === 'field_expression') {
          // obj.method() or ptr->method()
          const fieldNode = this.getChildByField(funcNode, 'field');
          const argNode = this.getChildByField(funcNode, 'argument');

          if (fieldNode) {
            const pos = this.getPosition(fieldNode);
            segments.unshift(this.createSegment(fieldNode.text, true, args, pos.line, pos.column));
          }

          current = argNode;
        } else if (funcNode.type === 'qualified_identifier' || funcNode.type === 'scoped_identifier') {
          // Namespace::Class::method()
          const parts = funcNode.text.split('::');
          const funcName = parts.pop() ?? funcNode.text;
          const pos = this.getPosition(funcNode);
          segments.unshift(this.createSegment(funcName, true, args, pos.line, pos.column));
          receiver = parts.join('::');
          break;
        } else if (funcNode.type === 'template_function') {
          // func<T>()
          const nameNode = this.getChildByField(funcNode, 'name');
          const pos = this.getPosition(funcNode);
          segments.unshift(this.createSegment(nameNode?.text ?? funcNode.text, true, args, pos.line, pos.column));
          break;
        } else if (funcNode.type === 'identifier') {
          const pos = this.getPosition(funcNode);
          segments.unshift(this.createSegment(funcNode.text, true, args, pos.line, pos.column));
          receiver = funcNode.text;
          break;
        } else {
          const pos = this.getPosition(funcNode);
          segments.unshift(this.createSegment(funcNode.text, true, args, pos.line, pos.column));
          break;
        }
      } else if (current.type === 'field_expression') {
        // Property access without call
        const fieldNode = this.getChildByField(current, 'field');
        const argNode = this.getChildByField(current, 'argument');

        if (fieldNode) {
          const pos = this.getPosition(fieldNode);
          segments.unshift(this.createSegment(fieldNode.text, false, [], pos.line, pos.column));
        }

        current = argNode;
      } else if (current.type === 'subscript_expression') {
        // array[index].method()
        const argNode: TreeSitterNode | null = this.getChildByField(current, 'argument');
        current = argNode;
      } else if (current.type === 'identifier') {
        receiver = current.text;
        break;
      } else if (current.type === 'qualified_identifier' || current.type === 'scoped_identifier') {
        receiver = current.text;
        break;
      } else if (current.type === 'this') {
        receiver = 'this';
        break;
      } else if (current.type === 'pointer_expression') {
        // *ptr
        const ptrArgNode: TreeSitterNode | undefined = current.namedChildren[0];
        current = ptrArgNode ?? null;
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
      case 'concatenated_string':
        return this.createStringArg(node.text, pos.line, pos.column);

      case 'number_literal':
        return this.createNumberArg(node.text, pos.line, pos.column);

      case 'true':
      case 'false':
        return this.createBooleanArg(node.text, pos.line, pos.column);

      case 'identifier':
        if (node.text === 'true' || node.text === 'false') {
          return this.createBooleanArg(node.text, pos.line, pos.column);
        }
        if (node.text === 'nullptr' || node.text === 'NULL') {
          return this.createUnknownArg(node.text, pos.line, pos.column);
        }
        return this.createIdentifierArg(node.text, pos.line, pos.column);

      case 'initializer_list':
        return this.normalizeInitializerList(node);

      case 'call_expression':
      case 'field_expression':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'lambda_expression':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'pointer_expression':
      case 'reference_expression':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'unary_expression':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'binary_expression':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'qualified_identifier':
      case 'scoped_identifier':
        return this.createIdentifierArg(node.text, pos.line, pos.column);

      case 'char_literal':
        return this.createStringArg(node.text, pos.line, pos.column);

      default:
        return this.createUnknownArg(node.text, pos.line, pos.column);
    }
  }

  /**
   * Normalize an initializer list
   */
  private normalizeInitializerList(node: TreeSitterNode): NormalizedArg {
    const pos = this.getPosition(node);
    const elements: NormalizedArg[] = [];

    for (const child of node.children) {
      if (child.type !== '{' && child.type !== '}' && child.type !== ',') {
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
      if (child.type === 'call_expression' || child.type === 'field_expression') {
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
        const func = this.extractFunctionDefinition(node, filePath, null);
        if (func) {functions.push(func);}
      } else if (node.type === 'class_specifier' || node.type === 'struct_specifier') {
        const classFunctions = this.extractClassMethods(node, filePath);
        functions.push(...classFunctions);
      }
    });

    return functions;
  }

  private extractFunctionDefinition(
    node: TreeSitterNode,
    filePath: string,
    className: string | null
  ): UnifiedFunction | null {
    const declaratorNode = this.getChildByField(node, 'declarator');
    if (!declaratorNode) {return null;}

    const name = this.extractFunctionName(declaratorNode);
    if (!name) {return null;}

    const params = this.extractParameters(declaratorNode);
    const returnTypeNode = this.getChildByField(node, 'type');
    const returnType = returnTypeNode?.text;
    const bodyNode = this.getChildByField(node, 'body');

    const isStatic = this.hasSpecifier(node, 'static');
    const isConstructor = className !== null && name === className;
    const isDestructor = name.startsWith('~');

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

    const qualifiedName = className ? `${className}::${name}` : name;

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
      isMethod: className !== null,
      isStatic,
      isExported: !isStatic,
      isConstructor: isConstructor || isDestructor,
      isAsync: false,
      className: className ?? undefined,
      decorators: this.extractSpecifiers(node),
      bodyStartLine: bodyNode ? this.getPosition(bodyNode).line : pos.line,
      bodyEndLine: bodyNode ? this.getEndPosition(bodyNode).line : endPos.line,
    });
  }

  private extractClassMethods(
    node: TreeSitterNode,
    filePath: string
  ): UnifiedFunction[] {
    const functions: UnifiedFunction[] = [];

    const nameNode = this.getChildByField(node, 'name');
    const className = nameNode?.text ?? '';

    const bodyNode = this.getChildByField(node, 'body');
    if (bodyNode) {
      this.traverseNode(bodyNode, child => {
        if (child.type === 'function_definition') {
          const func = this.extractFunctionDefinition(child, filePath, className);
          if (func) {functions.push(func);}
        } else if (child.type === 'declaration') {
          // Method declaration (not definition)
          const func = this.extractMethodDeclaration(child, filePath, className);
          if (func) {functions.push(func);}
        }
      });
    }

    return functions;
  }

  private extractMethodDeclaration(
    node: TreeSitterNode,
    filePath: string,
    className: string
  ): UnifiedFunction | null {
    const declaratorNode = this.getChildByField(node, 'declarator');
    if (!declaratorNode) {return null;}

    const name = this.extractFunctionName(declaratorNode);
    if (!name) {return null;}

    const params = this.extractParameters(declaratorNode);
    const returnTypeNode = this.getChildByField(node, 'type');
    const returnType = returnTypeNode?.text;

    const isStatic = this.hasSpecifier(node, 'static');
    const isConstructor = name === className;
    const isDestructor = name.startsWith('~');

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

    return this.createFunction({
      name,
      qualifiedName: `${className}::${name}`,
      file: filePath,
      startLine: pos.line,
      endLine: endPos.line,
      startColumn: pos.column,
      endColumn: endPos.column,
      parameters: params,
      returnType,
      isMethod: true,
      isStatic,
      isExported: !isStatic,
      isConstructor: isConstructor || isDestructor,
      isAsync: false,
      className,
      decorators: this.extractSpecifiers(node),
      bodyStartLine: pos.line,
      bodyEndLine: endPos.line,
    });
  }

  private extractFunctionName(declaratorNode: TreeSitterNode): string | null {
    if (declaratorNode.type === 'function_declarator') {
      const nameNode = this.getChildByField(declaratorNode, 'declarator');
      if (nameNode) {
        if (nameNode.type === 'qualified_identifier' || nameNode.type === 'scoped_identifier') {
          const parts = nameNode.text.split('::');
          return parts[parts.length - 1] ?? null;
        }
        return nameNode.text;
      }
    } else if (declaratorNode.type === 'identifier') {
      return declaratorNode.text;
    } else if (declaratorNode.type === 'qualified_identifier' || declaratorNode.type === 'scoped_identifier') {
      const parts = declaratorNode.text.split('::');
      return parts[parts.length - 1] ?? null;
    }
    return null;
  }

  private extractParameters(declaratorNode: TreeSitterNode): UnifiedParameter[] {
    const params: UnifiedParameter[] = [];

    const paramsNode = this.findParameterList(declaratorNode);
    if (!paramsNode) {return params;}

    for (const child of paramsNode.children) {
      if (child.type === 'parameter_declaration') {
        const typeNode = this.getChildByField(child, 'type');
        const declNode = this.getChildByField(child, 'declarator');
        const defaultNode = this.getChildByField(child, 'default_value');

        const name = declNode?.text ?? '_';
        const type = typeNode?.text;
        const hasDefault = defaultNode !== null;

        params.push(this.createParameter(name, type, hasDefault, false));
      } else if (child.type === 'variadic_parameter_declaration') {
        params.push(this.createParameter('...', undefined, false, true));
      }
    }

    return params;
  }

  private findParameterList(node: TreeSitterNode): TreeSitterNode | null {
    if (node.type === 'parameter_list') {
      return node;
    }

    for (const child of node.children) {
      if (child.type === 'parameter_list') {
        return child;
      }
      const found = this.findParameterList(child);
      if (found) {return found;}
    }

    return null;
  }

  private hasSpecifier(node: TreeSitterNode, specifier: string): boolean {
    for (const child of node.children) {
      if (child.type === 'storage_class_specifier' ||
          child.type === 'type_qualifier' ||
          child.type === 'virtual_specifier' ||
          child.type === 'function_specifier') {
        if (child.text === specifier) {
          return true;
        }
      }
    }
    return false;
  }

  private extractSpecifiers(node: TreeSitterNode): string[] {
    const specifiers: string[] = [];

    for (const child of node.children) {
      if (child.type === 'storage_class_specifier' ||
          child.type === 'type_qualifier' ||
          child.type === 'virtual_specifier' ||
          child.type === 'function_specifier') {
        specifiers.push(child.text);
      }
    }

    return specifiers;
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
      if (node.type === 'class_specifier') {
        const cls = this.extractClassSpecifier(node, filePath);
        if (cls) {classes.push(cls);}
      } else if (node.type === 'struct_specifier') {
        const cls = this.extractStructSpecifier(node, filePath);
        if (cls) {classes.push(cls);}
      }
    });

    return classes;
  }

  private extractClassSpecifier(node: TreeSitterNode, filePath: string): UnifiedClass | null {
    const nameNode = this.getChildByField(node, 'name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const baseClasses = this.extractBaseClasses(node);
    const methods = this.extractMethodNames(node);

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

    return this.createClass({
      name,
      file: filePath,
      startLine: pos.line,
      endLine: endPos.line,
      baseClasses,
      methods,
      isExported: true,
    });
  }

  private extractStructSpecifier(node: TreeSitterNode, filePath: string): UnifiedClass | null {
    const nameNode = this.getChildByField(node, 'name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const baseClasses = this.extractBaseClasses(node);
    const methods = this.extractMethodNames(node);

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

    return this.createClass({
      name,
      file: filePath,
      startLine: pos.line,
      endLine: endPos.line,
      baseClasses,
      methods,
      isExported: true,
    });
  }

  private extractBaseClasses(node: TreeSitterNode): string[] {
    const baseClasses: string[] = [];

    const baseClauseNode = node.children.find(c => c.type === 'base_class_clause');
    if (baseClauseNode) {
      for (const child of baseClauseNode.children) {
        if (child.type === 'type_identifier' ||
            child.type === 'qualified_identifier' ||
            child.type === 'scoped_identifier') {
          baseClasses.push(child.text);
        }
      }
    }

    return baseClasses;
  }

  private extractMethodNames(node: TreeSitterNode): string[] {
    const methods: string[] = [];

    const bodyNode = this.getChildByField(node, 'body');
    if (bodyNode) {
      this.traverseNode(bodyNode, child => {
        if (child.type === 'function_definition' || child.type === 'declaration') {
          const declaratorNode = this.getChildByField(child, 'declarator');
          if (declaratorNode) {
            const name = this.extractFunctionName(declaratorNode);
            if (name) {methods.push(name);}
          }
        }
      });
    }

    return methods;
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
      if (node.type === 'preproc_include') {
        const pathNode = node.children.find(c =>
          c.type === 'string_literal' || c.type === 'system_lib_string'
        );

        if (pathNode) {
          const source = pathNode.text.replace(/[<>"]/g, '');
          imports.push(this.createImport({
            source,
            names: [{
              imported: source,
              local: source,
              isDefault: false,
              isNamespace: true,
            }],
            line: this.getPosition(node).line,
            isTypeOnly: false,
          }));
        }
      } else if (node.type === 'using_declaration') {
        const nameNode = node.children.find(c =>
          c.type === 'qualified_identifier' || c.type === 'scoped_identifier' || c.type === 'identifier'
        );

        if (nameNode) {
          const parts = nameNode.text.split('::');
          const name = parts[parts.length - 1] ?? nameNode.text;
          imports.push(this.createImport({
            source: nameNode.text,
            names: [{
              imported: name,
              local: name,
              isDefault: false,
              isNamespace: false,
            }],
            line: this.getPosition(node).line,
            isTypeOnly: false,
          }));
        }
      }
    });

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
      if (child.type === 'function_definition') {
        const declaratorNode = this.getChildByField(child, 'declarator');
        if (declaratorNode) {
          const name = this.extractFunctionName(declaratorNode);
          if (name && !this.hasSpecifier(child, 'static')) {
            exports.push(this.createExport({
              name,
              line: this.getPosition(child).line,
            }));
          }
        }
      } else if (child.type === 'class_specifier' || child.type === 'struct_specifier') {
        const nameNode = this.getChildByField(child, 'name');
        if (nameNode) {
          exports.push(this.createExport({
            name: nameNode.text,
            line: this.getPosition(child).line,
          }));
        }
      }
    }

    return exports;
  }
}
