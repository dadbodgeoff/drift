/**
 * Java Call Chain Normalizer
 *
 * Converts Java AST into unified call chains.
 * Handles Java-specific patterns including:
 * - Method chaining: obj.method1().method2()
 * - Static method calls: Class.staticMethod()
 * - Constructor calls: new Class()
 * - Method references: Class::method
 * - Spring/JPA patterns
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
 * Java normalizer
 */
export class JavaNormalizer extends BaseNormalizer {
  readonly language = 'java' as const;

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
      // Process method invocations that are the outermost in a chain
      if (node.type === 'method_invocation' && !processedNodes.has(node)) {
        const parent = node.parent;
        if (parent?.type === 'method_invocation') {
          // This is part of a larger chain, skip
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
   * Extract a call chain from a method invocation
   */
  private extractCallChain(node: TreeSitterNode, filePath: string): UnifiedCallChain | null {
    const segments: CallChainSegment[] = [];
    let receiver = '';
    let current: TreeSitterNode | null = node;

    // Walk the chain from outermost to innermost
    while (current) {
      if (current.type === 'method_invocation') {
        const nameNode = current.childForFieldName('name');
        const argsNode = current.childForFieldName('arguments');
        const objectNode = current.childForFieldName('object');

        if (nameNode) {
          const args = argsNode ? this.normalizeArguments(argsNode) : [];
          const pos = this.getPosition(nameNode);
          segments.unshift(this.createSegment(nameNode.text, true, args, pos.line, pos.column));
        }

        current = objectNode;
      } else if (current.type === 'field_access') {
        const fieldNode = current.childForFieldName('field');
        const objectNode = current.childForFieldName('object');

        if (fieldNode) {
          const pos = this.getPosition(fieldNode);
          segments.unshift(this.createSegment(fieldNode.text, false, [], pos.line, pos.column));
        }

        current = objectNode;
      } else if (current.type === 'identifier') {
        receiver = current.text;
        break;
      } else if (current.type === 'this') {
        receiver = 'this';
        break;
      } else if (current.type === 'scoped_identifier' || current.type === 'type_identifier') {
        receiver = current.text;
        break;
      } else if (current.type === 'object_creation_expression') {
        // new Foo().method()
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
        return this.createStringArg(node.text, pos.line, pos.column);

      case 'decimal_integer_literal':
      case 'hex_integer_literal':
      case 'octal_integer_literal':
      case 'binary_integer_literal':
      case 'decimal_floating_point_literal':
      case 'hex_floating_point_literal':
        return this.createNumberArg(node.text, pos.line, pos.column);

      case 'true':
      case 'false':
        return this.createBooleanArg(node.text, pos.line, pos.column);

      case 'identifier':
        return this.createIdentifierArg(node.text, pos.line, pos.column);

      case 'field_access':
        return this.createIdentifierArg(node.text, pos.line, pos.column);

      case 'array_creation_expression':
      case 'array_initializer':
        return this.normalizeArrayLiteral(node);

      case 'object_creation_expression':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'lambda_expression':
        return this.createUnknownArg(node.text, pos.line, pos.column);

      case 'method_reference':
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

    // Find array_initializer
    const initNode = node.type === 'array_initializer' 
      ? node 
      : node.children.find(c => c.type === 'array_initializer');

    if (initNode) {
      for (const child of initNode.children) {
        if (child.type !== '{' && child.type !== '}' && child.type !== ',') {
          elements.push(this.normalizeArgument(child));
        }
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
      if (child.type === 'method_invocation' || child.type === 'field_access') {
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
    let currentPackage: string | null = null;

    // First pass: find package
    for (const child of rootNode.children) {
      if (child.type === 'package_declaration') {
        const nameNode = child.children.find(c => 
          c.type === 'scoped_identifier' || c.type === 'identifier'
        );
        currentPackage = nameNode?.text ?? null;
        break;
      }
    }

    this.traverseNode(rootNode, node => {
      if (node.type === 'method_declaration') {
        const className = this.findParentClassName(node);
        const func = this.extractMethodDeclaration(node, filePath, className, currentPackage);
        if (func) {functions.push(func);}
      } else if (node.type === 'constructor_declaration') {
        const className = this.findParentClassName(node);
        const func = this.extractConstructorDeclaration(node, filePath, className, currentPackage);
        if (func) {functions.push(func);}
      }
    });

    return functions;
  }

  private extractMethodDeclaration(
    node: TreeSitterNode,
    filePath: string,
    className: string | null,
    _currentPackage: string | null
  ): UnifiedFunction | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return null;}

    const name = nameNode.text;
    const params = this.extractParameters(node.childForFieldName('parameters'));
    const returnTypeNode = node.childForFieldName('type');
    const returnType = returnTypeNode?.text;
    const bodyNode = node.childForFieldName('body');
    const isStatic = this.hasModifier(node, 'static');
    const isPublic = this.hasModifier(node, 'public');
    const decorators = this.extractAnnotations(node);

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
      isAsync: false,
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
    _currentPackage: string | null
  ): UnifiedFunction | null {
    const params = this.extractParameters(node.childForFieldName('parameters'));
    const bodyNode = node.childForFieldName('body');
    const isPublic = this.hasModifier(node, 'public');
    const decorators = this.extractAnnotations(node);

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
      if (child.type === 'formal_parameter' || child.type === 'spread_parameter') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');

        if (nameNode) {
          params.push(this.createParameter(
            nameNode.text,
            typeNode?.text,
            false,
            child.type === 'spread_parameter'
          ));
        }
      }
    }

    return params;
  }

  private extractAnnotations(node: TreeSitterNode): string[] {
    const annotations: string[] = [];

    let sibling = node.previousNamedSibling;
    while (sibling && (sibling.type === 'annotation' || sibling.type === 'marker_annotation')) {
      annotations.unshift(sibling.text);
      sibling = sibling.previousNamedSibling;
    }

    for (const child of node.children) {
      if (child.type === 'modifiers') {
        for (const mod of child.children) {
          if (mod.type === 'annotation' || mod.type === 'marker_annotation') {
            annotations.push(mod.text);
          }
        }
      }
    }

    return annotations;
  }

  private hasModifier(node: TreeSitterNode, modifier: string): boolean {
    for (const child of node.children) {
      if (child.type === 'modifiers') {
        for (const mod of child.children) {
          if (mod.text === modifier) {return true;}
        }
      }
      if (child.text === modifier) {return true;}
    }
    return false;
  }

  private findParentClassName(node: TreeSitterNode): string | null {
    let current = node.parent;
    while (current) {
      if (current.type === 'class_declaration' || 
          current.type === 'interface_declaration' ||
          current.type === 'enum_declaration') {
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
          node.type === 'enum_declaration') {
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

    // Get superclass
    const superclassNode = node.childForFieldName('superclass');
    if (superclassNode) {
      const typeNode = superclassNode.children.find(c => 
        c.type === 'type_identifier' || c.type === 'scoped_type_identifier' || c.type === 'generic_type'
      );
      if (typeNode) {baseClasses.push(typeNode.text);}
    }

    // Get interfaces
    const interfacesNode = node.childForFieldName('interfaces');
    if (interfacesNode) {
      for (const child of interfacesNode.children) {
        if (child.type === 'type_identifier' || child.type === 'scoped_type_identifier' || child.type === 'generic_type') {
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
      if (node.type === 'import_declaration') {
        const imp = this.extractImportDeclaration(node);
        if (imp) {imports.push(imp);}
      }
    });

    return imports;
  }

  private extractImportDeclaration(node: TreeSitterNode): UnifiedImport | null {
    let importPath = '';
    let isWildcard = false;

    for (const child of node.children) {
      if (child.type === 'scoped_identifier' || child.type === 'identifier') {
        importPath = child.text;
      } else if (child.type === 'asterisk') {
        isWildcard = true;
      }
    }

    if (!importPath) {return null;}

    const parts = importPath.split('.');
    const localName = isWildcard ? '*' : (parts.pop() ?? importPath);

    return this.createImport({
      source: importPath,
      names: [{
        imported: localName,
        local: localName,
        isNamespace: isWildcard,
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
    // Java doesn't have explicit exports like JS/TS
    // Public classes/methods are implicitly exported
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
