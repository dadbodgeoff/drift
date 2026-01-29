/**
 * C# Call Chain Normalizer
 *
 * Converts C# AST into unified call chains.
 * Handles C#-specific patterns including:
 * - Method chaining: obj.Method1().Method2()
 * - Static calls: Class.Method()
 * - Constructor calls: new Class()
 * - LINQ queries
 * - Entity Framework patterns
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
 * C# normalizer
 */
export class CSharpNormalizer extends BaseNormalizer {
  readonly language = 'csharp' as const;

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
      // Process invocation expressions that are the outermost in a chain
      if (node.type === 'invocation_expression' && !processedNodes.has(node)) {
        const parent = node.parent;
        if (parent?.type === 'member_access_expression' && parent.parent?.type === 'invocation_expression') {
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
   * Extract a call chain from an invocation expression
   */
  private extractCallChain(node: TreeSitterNode, filePath: string): UnifiedCallChain | null {
    const segments: CallChainSegment[] = [];
    let receiver = '';
    let current: TreeSitterNode | null = node;

    while (current) {
      if (current.type === 'invocation_expression') {
        const funcNode = current.childForFieldName('function');
        const argsNode = current.childForFieldName('arguments');

        if (!funcNode) {break;}

        const args = argsNode ? this.normalizeArguments(argsNode) : [];

        if (funcNode.type === 'member_access_expression') {
          const nameNode = funcNode.childForFieldName('name');
          const objectNode = funcNode.childForFieldName('expression');

          if (nameNode) {
            const pos = this.getPosition(nameNode);
            segments.unshift(this.createSegment(nameNode.text, true, args, pos.line, pos.column));
          }

          current = objectNode;
        } else if (funcNode.type === 'identifier') {
          const pos = this.getPosition(funcNode);
          segments.unshift(this.createSegment(funcNode.text, true, args, pos.line, pos.column));
          receiver = funcNode.text;
          break;
        } else if (funcNode.type === 'generic_name') {
          const nameNode = funcNode.childForFieldName('name');
          const name = nameNode?.text ?? funcNode.text;
          const pos = this.getPosition(funcNode);
          segments.unshift(this.createSegment(name, true, args, pos.line, pos.column));
          receiver = name;
          break;
        } else {
          break;
        }
      } else if (current.type === 'member_access_expression') {
        const nameNode = current.childForFieldName('name');
        const objectNode = current.childForFieldName('expression');

        if (nameNode) {
          const pos = this.getPosition(nameNode);
          segments.unshift(this.createSegment(nameNode.text, false, [], pos.line, pos.column));
        }

        current = objectNode;
      } else if (current.type === 'identifier') {
        receiver = current.text;
        break;
      } else if (current.type === 'this_expression') {
        receiver = 'this';
        break;
      } else if (current.type === 'qualified_name') {
        receiver = current.text;
        break;
      } else if (current.type === 'object_creation_expression') {
        const typeNode = current.childForFieldName('type');
        receiver = typeNode ? `new ${typeNode.text}` : 'new';
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
      if (child.type === 'argument') {
        const valueNode = child.childForFieldName('expression') ?? child.children.find(c => 
          c.type !== 'name_colon' && c.type !== ':'
        );
        if (valueNode) {
          args.push(this.normalizeArgument(valueNode));
        }
      } else if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
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
      case 'string_literal':
      case 'verbatim_string_literal':
      case 'interpolated_string_expression':
        return this.createStringArg(node.text, pos.line, pos.column);

      case 'integer_literal':
      case 'real_literal':
        return this.createNumberArg(node.text, pos.line, pos.column);

      case 'boolean_literal':
        return this.createBooleanArg(node.text, pos.line, pos.column);

      case 'identifier':
        return this.createIdentifierArg(node.text, pos.line, pos.column);

      case 'member_access_expression':
        return this.createIdentifierArg(node.text, pos.line, pos.column);

      case 'array_creation_expression':
      case 'collection_expression':
        return this.normalizeArrayLiteral(node);

      case 'object_creation_expression':
        return this.normalizeObjectCreation(node);

      case 'lambda_expression':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      default:
        return this.createUnknownArg(node.text, pos.line, pos.column);
    }
  }

  /**
   * Normalize an array literal
   */
  private normalizeArrayLiteral(node: TreeSitterNode): NormalizedArg {
    const pos = this.getPosition(node);
    const elements: NormalizedArg[] = [];

    const initNode = node.children.find(c => 
      c.type === 'initializer_expression' || c.type === 'collection_expression'
    );

    if (initNode) {
      for (const child of initNode.children) {
        if (child.type !== '{' && child.type !== '}' && child.type !== ',' && child.type !== '[' && child.type !== ']') {
          elements.push(this.normalizeArgument(child));
        }
      }
    }

    return this.createArrayArg(node.text, elements, pos.line, pos.column);
  }

  /**
   * Normalize an object creation expression
   */
  private normalizeObjectCreation(node: TreeSitterNode): NormalizedArg {
    const pos = this.getPosition(node);
    const properties: Record<string, NormalizedArg> = {};

    // Check for object initializer
    const initNode = node.children.find(c => c.type === 'initializer_expression');
    if (initNode) {
      for (const child of initNode.children) {
        if (child.type === 'assignment_expression') {
          const leftNode = child.childForFieldName('left');
          const rightNode = child.childForFieldName('right');
          if (leftNode && rightNode) {
            properties[leftNode.text] = this.normalizeArgument(rightNode);
          }
        }
      }
    }

    if (Object.keys(properties).length > 0) {
      return this.createObjectArg(node.text, properties, pos.line, pos.column);
    }

    return this.createUnknownArg(node.text, pos.line, pos.column);
  }

  /**
   * Mark all nodes in a chain as processed
   */
  private markChainNodesProcessed(node: TreeSitterNode, processed: Set<TreeSitterNode>): void {
    processed.add(node);
    for (const child of node.children) {
      if (child.type === 'invocation_expression' || child.type === 'member_access_expression') {
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
    let currentNamespace: string | null = null;

    // First pass: find namespace
    this.traverseNode(rootNode, node => {
      if (node.type === 'namespace_declaration' || node.type === 'file_scoped_namespace_declaration') {
        const nameNode = node.childForFieldName('name');
        currentNamespace = nameNode?.text ?? null;
      }
    });

    this.traverseNode(rootNode, node => {
      if (node.type === 'method_declaration') {
        const className = this.findParentClassName(node);
        const func = this.extractMethodDeclaration(node, filePath, className, currentNamespace);
        if (func) {functions.push(func);}
      } else if (node.type === 'constructor_declaration') {
        const className = this.findParentClassName(node);
        const func = this.extractConstructorDeclaration(node, filePath, className, currentNamespace);
        if (func) {functions.push(func);}
      }
    });

    return functions;
  }

  private extractMethodDeclaration(
    node: TreeSitterNode,
    filePath: string,
    className: string | null,
    _currentNamespace: string | null
  ): UnifiedFunction | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const params = this.extractParameters(node.childForFieldName('parameters'));
    const returnTypeNode = node.childForFieldName('type');
    const returnType = returnTypeNode?.text;
    const bodyNode = node.childForFieldName('body');
    const isStatic = this.hasModifier(node, 'static');
    const isAsync = this.hasModifier(node, 'async');
    const isPublic = this.hasModifier(node, 'public');
    const decorators = this.extractAttributes(node);

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
      isMethod: !!className,
      isStatic,
      isExported: isPublic,
      isConstructor: false,
      isAsync,
      className: className ?? undefined,
      decorators,
      bodyStartLine: bodyNode ? this.getPosition(bodyNode).line : pos.line,
      bodyEndLine: bodyNode ? this.getEndPosition(bodyNode).line : endPos.line,
    });
  }

  private extractConstructorDeclaration(
    node: TreeSitterNode,
    filePath: string,
    className: string | null,
    _currentNamespace: string | null
  ): UnifiedFunction | null {
    const params = this.extractParameters(node.childForFieldName('parameters'));
    const bodyNode = node.childForFieldName('body');
    const isPublic = this.hasModifier(node, 'public');
    const decorators = this.extractAttributes(node);

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

    return this.createFunction({
      name: 'constructor',
      qualifiedName: className ? `${className}.constructor` : 'constructor',
      file: filePath,
      startLine: pos.line,
      endLine: endPos.line,
      startColumn: pos.column,
      endColumn: endPos.column,
      parameters: params,
      isMethod: true,
      isStatic: false,
      isExported: isPublic,
      isConstructor: true,
      isAsync: false,
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
      if (child.type === 'parameter') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');
        const defaultNode = child.childForFieldName('default_value');

        if (nameNode) {
          params.push(this.createParameter(
            nameNode.text,
            typeNode?.text,
            defaultNode !== null,
            false
          ));
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
      if (child.type === 'modifier' && child.text === modifier) {return true;}
    }
    return false;
  }

  private findParentClassName(node: TreeSitterNode): string | null {
    let current = node.parent;
    while (current) {
      if (current.type === 'class_declaration' || 
          current.type === 'struct_declaration' ||
          current.type === 'record_declaration' ||
          current.type === 'interface_declaration') {
        const nameNode = current.childForFieldName('name');
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
      if (node.type === 'class_declaration' || 
          node.type === 'struct_declaration' ||
          node.type === 'record_declaration' ||
          node.type === 'interface_declaration') {
        const cls = this.extractClassDeclaration(node, filePath);
        if (cls) {classes.push(cls);}
      }
    });

    return classes;
  }

  private extractClassDeclaration(node: TreeSitterNode, filePath: string): UnifiedClass | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const baseClasses: string[] = [];
    const methods: string[] = [];

    // Get base classes
    const baseListNode = node.childForFieldName('bases');
    if (baseListNode) {
      for (const child of baseListNode.children) {
        if (child.type === 'identifier' || child.type === 'qualified_name' || child.type === 'generic_name') {
          baseClasses.push(child.text);
        }
      }
    }

    // Get methods
    const bodyNode = node.children.find(c => c.type === 'declaration_list');
    if (bodyNode) {
      for (const member of bodyNode.children) {
        if (member.type === 'method_declaration') {
          const methodNameNode = member.childForFieldName('name');
          if (methodNameNode) {methods.push(methodNameNode.text);}
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
      isExported: this.hasModifier(node, 'public'),
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
      if (node.type === 'using_directive') {
        const imp = this.extractUsingDirective(node);
        if (imp) {imports.push(imp);}
      }
    });

    return imports;
  }

  private extractUsingDirective(node: TreeSitterNode): UnifiedImport | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return null;}

    const namespaceName = nameNode.text;

    return this.createImport({
      source: namespaceName,
      names: [{
        imported: namespaceName,
        local: namespaceName.split('.').pop() ?? namespaceName,
      }],
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
    // C# doesn't have explicit exports
    // Public classes are implicitly exported
    const exports: UnifiedExport[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'class_declaration' && this.hasModifier(node, 'public')) {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          exports.push(this.createExport({
            name: nameNode.text,
            isDefault: false,
            isReExport: false,
            line: this.getPosition(node).line,
          }));
        }
      }
    });

    return exports;
  }
}
