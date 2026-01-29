/**
 * PHP Call Chain Normalizer
 *
 * Converts PHP AST into unified call chains.
 * Handles PHP-specific patterns including:
 * - Method chaining: $obj->method1()->method2()
 * - Static calls: Class::method()
 * - Constructor calls: new Class()
 * - Eloquent/Laravel patterns
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
 * PHP normalizer
 */
export class PhpNormalizer extends BaseNormalizer {
  readonly language = 'php' as const;

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
      // Process member calls that are the outermost in a chain
      if (node.type === 'member_call_expression' && !processedNodes.has(node)) {
        const parent = node.parent;
        if (parent?.type === 'member_call_expression') {
          return;
        }

        const chain = this.extractCallChain(node, filePath);
        if (chain && chain.segments.length > 0) {
          chains.push(chain);
          this.markChainNodesProcessed(node, processedNodes);
        }
      }

      // Also process scoped calls (static method chains)
      if (node.type === 'scoped_call_expression' && !processedNodes.has(node)) {
        const parent = node.parent;
        if (parent?.type === 'member_call_expression' || parent?.type === 'scoped_call_expression') {
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
   * Extract a call chain from a member/scoped call expression
   */
  private extractCallChain(node: TreeSitterNode, filePath: string): UnifiedCallChain | null {
    const segments: CallChainSegment[] = [];
    let receiver = '';
    let current: TreeSitterNode | null = node;

    while (current) {
      if (current.type === 'member_call_expression') {
        const nameNode = current.childForFieldName('name');
        const argsNode = current.childForFieldName('arguments');
        const objectNode = current.childForFieldName('object');

        if (nameNode) {
          const args = argsNode ? this.normalizeArguments(argsNode) : [];
          const pos = this.getPosition(nameNode);
          segments.unshift(this.createSegment(nameNode.text, true, args, pos.line, pos.column));
        }

        current = objectNode;
      } else if (current.type === 'scoped_call_expression') {
        const nameNode = current.childForFieldName('name');
        const argsNode = current.childForFieldName('arguments');
        const scopeNode = current.childForFieldName('scope');

        if (nameNode) {
          const args = argsNode ? this.normalizeArguments(argsNode) : [];
          const pos = this.getPosition(nameNode);
          segments.unshift(this.createSegment(nameNode.text, true, args, pos.line, pos.column));
        }

        if (scopeNode) {
          receiver = scopeNode.text;
        }
        break;
      } else if (current.type === 'member_access_expression') {
        const nameNode = current.childForFieldName('name');
        const objectNode = current.childForFieldName('object');

        if (nameNode) {
          const pos = this.getPosition(nameNode);
          segments.unshift(this.createSegment(nameNode.text, false, [], pos.line, pos.column));
        }

        current = objectNode;
      } else if (current.type === 'variable_name') {
        receiver = current.text.replace(/^\$/, '');
        break;
      } else if (current.type === 'name' || current.type === 'qualified_name') {
        receiver = current.text;
        break;
      } else if (current.type === 'object_creation_expression') {
        // new Foo()->method()
        const classNode = current.children.find(c => c.type === 'name' || c.type === 'qualified_name');
        receiver = classNode ? `new ${classNode.text}` : 'new';
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
   * Normalize arguments from an arguments node
   */
  private normalizeArguments(argsNode: TreeSitterNode): NormalizedArg[] {
    const args: NormalizedArg[] = [];

    for (const child of argsNode.children) {
      if (child.type === 'argument') {
        // Get the actual value from the argument
        const valueNode = child.children.find(c => 
          c.type !== 'name' || !child.childForFieldName('name')
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
      case 'string':
      case 'encapsed_string':
        return this.createStringArg(node.text, pos.line, pos.column);

      case 'integer':
      case 'float':
        return this.createNumberArg(node.text, pos.line, pos.column);

      case 'boolean':
        return this.createBooleanArg(node.text, pos.line, pos.column);

      case 'variable_name':
        return this.createIdentifierArg(node.text.replace(/^\$/, ''), pos.line, pos.column);

      case 'name':
      case 'qualified_name':
        return this.createIdentifierArg(node.text, pos.line, pos.column);

      case 'array_creation_expression':
        return this.normalizeArrayLiteral(node);

      case 'anonymous_function_creation_expression':
      case 'arrow_function':
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
    const properties: Record<string, NormalizedArg> = {};
    let isAssociative = false;

    for (const child of node.children) {
      if (child.type === 'array_element_initializer') {
        const keyNode = child.children.find(c => c.type !== '=>');
        const valueNode = child.children[child.children.length - 1];

        // Check if it's key => value
        const hasArrow = child.children.some(c => c.type === '=>');
        if (hasArrow && keyNode && valueNode && keyNode !== valueNode) {
          isAssociative = true;
          const key = this.extractStringValue(keyNode) ?? keyNode.text;
          properties[key] = this.normalizeArgument(valueNode);
        } else if (valueNode) {
          elements.push(this.normalizeArgument(valueNode));
        }
      }
    }

    if (isAssociative) {
      return this.createObjectArg(node.text, properties, pos.line, pos.column);
    }

    return this.createArrayArg(node.text, elements, pos.line, pos.column);
  }

  /**
   * Mark all nodes in a chain as processed
   */
  private markChainNodesProcessed(node: TreeSitterNode, processed: Set<TreeSitterNode>): void {
    processed.add(node);
    for (const child of node.children) {
      if (child.type === 'member_call_expression' || 
          child.type === 'scoped_call_expression' ||
          child.type === 'member_access_expression') {
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
      if (node.type === 'namespace_definition') {
        const nameNode = node.childForFieldName('name');
        currentNamespace = nameNode?.text ?? null;
      }
    });

    this.traverseNode(rootNode, node => {
      if (node.type === 'function_definition') {
        const func = this.extractFunctionDefinition(node, filePath, currentNamespace);
        if (func) {functions.push(func);}
      } else if (node.type === 'method_declaration') {
        const className = this.findParentClassName(node);
        const func = this.extractMethodDeclaration(node, filePath, className, currentNamespace);
        if (func) {functions.push(func);}
      }
    });

    return functions;
  }

  private extractFunctionDefinition(
    node: TreeSitterNode,
    filePath: string,
    currentNamespace: string | null
  ): UnifiedFunction | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const qualifiedName = currentNamespace ? `${currentNamespace}\\${name}` : name;
    const params = this.extractParameters(node.childForFieldName('parameters'));
    const returnTypeNode = node.childForFieldName('return_type');
    const returnType = returnTypeNode?.text;
    const bodyNode = node.childForFieldName('body');
    const decorators = this.extractAttributes(node);

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

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
      isMethod: false,
      isStatic: false,
      isExported: true,
      isConstructor: false,
      isAsync: false,
      decorators,
      bodyStartLine: bodyNode ? this.getPosition(bodyNode).line : pos.line,
      bodyEndLine: bodyNode ? this.getEndPosition(bodyNode).line : endPos.line,
    });
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
    const isConstructor = name === '__construct';
    const isStatic = this.hasModifier(node, 'static');
    const isPublic = this.hasModifier(node, 'public') || !this.hasAnyVisibility(node);
    const params = this.extractParameters(node.childForFieldName('parameters'));
    const returnTypeNode = node.childForFieldName('return_type');
    const returnType = returnTypeNode?.text;
    const bodyNode = node.childForFieldName('body');
    const decorators = this.extractAttributes(node);

    const pos = this.getPosition(node);
    const endPos = this.getEndPosition(node);

    return this.createFunction({
      name: isConstructor ? 'constructor' : name,
      qualifiedName: className ? `${className}.${isConstructor ? 'constructor' : name}` : name,
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
      isConstructor,
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
      if (child.type === 'simple_parameter' || 
          child.type === 'variadic_parameter' || 
          child.type === 'property_promotion_parameter') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');
        const defaultNode = child.childForFieldName('default_value');

        if (nameNode) {
          const name = nameNode.text.replace(/^\$/, '');
          params.push(this.createParameter(
            name,
            typeNode?.text,
            defaultNode !== null,
            child.type === 'variadic_parameter'
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
          attributes.unshift(`#[${attr.text}]`);
        }
      }
      sibling = sibling.previousNamedSibling;
    }

    return attributes;
  }

  private hasModifier(node: TreeSitterNode, modifier: string): boolean {
    for (const child of node.children) {
      if (child.type === 'visibility_modifier' && child.text === modifier) {return true;}
      if (child.type === 'static_modifier' && modifier === 'static') {return true;}
      if (child.type === 'abstract_modifier' && modifier === 'abstract') {return true;}
      if (child.type === 'final_modifier' && modifier === 'final') {return true;}
    }
    return false;
  }

  private hasAnyVisibility(node: TreeSitterNode): boolean {
    return node.children.some(c => c.type === 'visibility_modifier');
  }

  private findParentClassName(node: TreeSitterNode): string | null {
    let current = node.parent;
    while (current) {
      if (current.type === 'class_declaration' || 
          current.type === 'interface_declaration' ||
          current.type === 'trait_declaration') {
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
          node.type === 'interface_declaration' ||
          node.type === 'trait_declaration') {
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
    const interfacesNode = node.childForFieldName('interfaces');
    if (interfacesNode) {
      for (const child of interfacesNode.children) {
        if (child.type === 'name' || child.type === 'qualified_name') {
          baseClasses.push(child.text);
        }
      }
    }

    // Get methods
    const bodyNode = node.childForFieldName('body');
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
      isExported: !this.hasModifier(node, 'abstract'),
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
      if (node.type === 'namespace_use_declaration') {
        const imp = this.extractUseDeclaration(node);
        imports.push(...imp);
      }
    });

    return imports;
  }

  private extractUseDeclaration(node: TreeSitterNode): UnifiedImport[] {
    const imports: UnifiedImport[] = [];

    for (const child of node.children) {
      if (child.type === 'namespace_use_clause') {
        const nameNode = child.childForFieldName('name');
        const aliasNode = child.childForFieldName('alias');

        if (nameNode) {
          const fullName = nameNode.text;
          const parts = fullName.split('\\');
          const localName = aliasNode?.text ?? parts.pop() ?? fullName;

          imports.push(this.createImport({
            source: fullName,
            names: [{
              imported: fullName,
              local: localName,
            }],
            line: this.getPosition(node).line,
          }));
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
    // PHP doesn't have explicit exports
    // Public classes are implicitly exported
    const exports: UnifiedExport[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'class_declaration' && !this.hasModifier(node, 'abstract')) {
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
