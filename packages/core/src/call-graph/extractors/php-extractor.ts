/**
 * PHP Call Graph Extractor
 *
 * Extracts functions, calls, imports, and exports from PHP
 * using tree-sitter for AST parsing.
 *
 * Handles:
 * - Function definitions
 * - Class methods (public, private, protected, static)
 * - Constructors and destructors
 * - Traits
 * - Namespaces and use statements
 * - Arrow functions (fn =>)
 * - Closures
 * - Laravel controller actions
 * - Static method calls (Class::method())
 */

import { BaseCallGraphExtractor } from './base-extractor.js';
import type {
  CallGraphLanguage,
  FileExtractionResult,
  ParameterInfo,
} from '../types.js';
import {
  isPhpTreeSitterAvailable,
  createPhpParser,
} from '../../parsers/tree-sitter/php-loader.js';
import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';

/**
 * PHP call graph extractor using tree-sitter
 */
export class PhpCallGraphExtractor extends BaseCallGraphExtractor {
  readonly language: CallGraphLanguage = 'php';
  readonly extensions: string[] = ['.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.phps'];

  private parser: TreeSitterParser | null = null;

  /**
   * Check if tree-sitter is available
   */
  static isAvailable(): boolean {
    return isPhpTreeSitterAvailable();
  }

  /**
   * Extract call graph information from PHP source
   */
  extract(source: string, filePath: string): FileExtractionResult {
    const result = this.createEmptyResult(filePath);

    if (!isPhpTreeSitterAvailable()) {
      result.errors.push('Tree-sitter not available for PHP parsing');
      return result;
    }

    try {
      if (!this.parser) {
        this.parser = createPhpParser();
      }

      const tree = this.parser.parse(source);
      
      // Extract namespace
      let currentNamespace: string | null = null;
      
      this.visitNode(tree.rootNode, result, source, null, currentNamespace);

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
    currentNamespace: string | null
  ): void {
    switch (node.type) {
      case 'namespace_definition':
        this.extractNamespace(node, result, source);
        break;

      case 'class_declaration':
        this.extractClassDeclaration(node, result, source, currentNamespace);
        break;

      case 'interface_declaration':
        this.extractInterfaceDeclaration(node, result, source, currentNamespace);
        break;

      case 'trait_declaration':
        this.extractTraitDeclaration(node, result, source, currentNamespace);
        break;

      case 'function_definition':
        this.extractFunctionDefinition(node, result, source, currentNamespace);
        break;

      case 'method_declaration':
        this.extractMethodDeclaration(node, result, source, currentClass, currentNamespace);
        break;

      case 'namespace_use_declaration':
        this.extractUseDeclaration(node, result);
        break;

      case 'function_call_expression':
        this.extractFunctionCall(node, result, source);
        break;

      case 'member_call_expression':
        this.extractMemberCall(node, result, source);
        break;

      case 'scoped_call_expression':
        this.extractScopedCall(node, result, source);
        break;

      case 'object_creation_expression':
        this.extractObjectCreation(node, result, source);
        break;

      default:
        // Recurse into children
        for (const child of node.children) {
          this.visitNode(child, result, source, currentClass, currentNamespace);
        }
    }
  }

  /**
   * Extract namespace and visit children with namespace context
   */
  private extractNamespace(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const nameNode = node.childForFieldName('name');
    const namespaceName = nameNode?.text ?? '';

    // Visit children with namespace context
    for (const child of node.children) {
      if (child.type === 'compound_statement' || child.type === 'declaration_list') {
        for (const decl of child.children) {
          this.visitNode(decl, result, source, null, namespaceName);
        }
      } else {
        this.visitNode(child, result, source, null, namespaceName);
      }
    }
  }

  /**
   * Extract a class declaration
   */
  private extractClassDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentNamespace: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const className = nameNode.text;
    const fullClassName = currentNamespace ? `${currentNamespace}\\${className}` : className;

    // Get base class (extends)
    const baseClasses: string[] = [];
    const baseClauseNode = node.childForFieldName('base_clause');
    if (baseClauseNode) {
      for (const child of baseClauseNode.children) {
        if (child.type === 'name' || child.type === 'qualified_name') {
          baseClasses.push(child.text);
        }
      }
    }

    // Get interfaces (implements)
    const interfacesNode = node.childForFieldName('interfaces');
    if (interfacesNode) {
      for (const child of interfacesNode.children) {
        if (child.type === 'name' || child.type === 'qualified_name') {
          baseClasses.push(child.text);
        }
      }
    }

    // Get methods
    const methods: string[] = [];
    const bodyNode = node.childForFieldName('body');
    if (bodyNode) {
      for (const member of bodyNode.children) {
        if (member.type === 'method_declaration') {
          const methodNameNode = member.childForFieldName('name');
          if (methodNameNode) {
            methods.push(methodNameNode.text);
          }
        }
      }
    }

    // Check visibility
    const isExported = !this.hasModifier(node, 'abstract'); // Abstract classes can't be instantiated directly

    result.classes.push(this.createClass({
      name: className,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      baseClasses,
      methods,
      isExported,
    }));

    // Visit class body with class context
    if (bodyNode) {
      for (const member of bodyNode.children) {
        this.visitNode(member, result, source, fullClassName, currentNamespace);
      }
    }
  }

  /**
   * Extract an interface declaration
   */
  private extractInterfaceDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentNamespace: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const interfaceName = nameNode.text;
    const fullName = currentNamespace ? `${currentNamespace}\\${interfaceName}` : interfaceName;

    // Get extended interfaces
    const baseClasses: string[] = [];
    const baseClauseNode = node.childForFieldName('base_clause');
    if (baseClauseNode) {
      for (const child of baseClauseNode.children) {
        if (child.type === 'name' || child.type === 'qualified_name') {
          baseClasses.push(child.text);
        }
      }
    }

    // Get methods
    const methods: string[] = [];
    const bodyNode = node.childForFieldName('body');
    if (bodyNode) {
      for (const member of bodyNode.children) {
        if (member.type === 'method_declaration') {
          const methodNameNode = member.childForFieldName('name');
          if (methodNameNode) {
            methods.push(methodNameNode.text);
          }
        }
      }
    }

    result.classes.push(this.createClass({
      name: interfaceName,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      baseClasses,
      methods,
      isExported: true,
    }));

    // Visit interface body
    if (bodyNode) {
      for (const member of bodyNode.children) {
        this.visitNode(member, result, source, fullName, currentNamespace);
      }
    }
  }

  /**
   * Extract a trait declaration
   */
  private extractTraitDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentNamespace: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const traitName = nameNode.text;
    const fullName = currentNamespace ? `${currentNamespace}\\${traitName}` : traitName;

    // Get methods
    const methods: string[] = [];
    const bodyNode = node.childForFieldName('body');
    if (bodyNode) {
      for (const member of bodyNode.children) {
        if (member.type === 'method_declaration') {
          const methodNameNode = member.childForFieldName('name');
          if (methodNameNode) {
            methods.push(methodNameNode.text);
          }
        }
      }
    }

    result.classes.push(this.createClass({
      name: traitName,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      baseClasses: [],
      methods,
      isExported: true,
    }));

    // Visit trait body
    if (bodyNode) {
      for (const member of bodyNode.children) {
        this.visitNode(member, result, source, fullName, currentNamespace);
      }
    }
  }

  /**
   * Extract a function definition (not a method)
   */
  private extractFunctionDefinition(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentNamespace: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const qualifiedName = currentNamespace ? `${currentNamespace}\\${name}` : name;

    // Get return type
    const returnTypeNode = node.childForFieldName('return_type');
    const returnType = returnTypeNode?.text;

    // Get parameters
    const parametersNode = node.childForFieldName('parameters');
    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];

    // Get attributes (PHP 8+)
    const decorators = this.extractAttributes(node);

    // Get body
    const bodyNode = node.childForFieldName('body');

    const func = this.createFunction({
      name,
      qualifiedName,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters,
      returnType,
      isMethod: false,
      isStatic: false,
      isExported: true, // PHP functions are always "exported" within their namespace
      isConstructor: false,
      isAsync: false,
      decorators,
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });

    result.functions.push(func);

    // Extract calls from function body
    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result, source);
    }
  }

  /**
   * Extract a method declaration
   */
  private extractMethodDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentClass: string | null,
    _currentNamespace: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const isStatic = this.hasModifier(node, 'static');
    const isPublic = this.hasModifier(node, 'public') || !this.hasAnyVisibility(node);
    const isConstructor = name === '__construct';
    const isDestructor = name === '__destruct';

    // Get return type
    const returnTypeNode = node.childForFieldName('return_type');
    const returnType = returnTypeNode?.text;

    // Get parameters
    const parametersNode = node.childForFieldName('parameters');
    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];

    // Get attributes
    const decorators = this.extractAttributes(node);

    // Get body
    const bodyNode = node.childForFieldName('body');

    const func = this.createFunction({
      name: isConstructor ? 'constructor' : (isDestructor ? 'destructor' : name),
      qualifiedName: currentClass ? `${currentClass}.${isConstructor ? 'constructor' : name}` : name,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters,
      returnType,
      isMethod: currentClass !== null,
      isStatic,
      isExported: isPublic,
      isConstructor,
      isAsync: false,
      className: currentClass ?? undefined,
      decorators,
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });

    result.functions.push(func);

    // Extract calls from method body
    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result, source);
    }
  }

  /**
   * Extract a use declaration (namespace import)
   */
  private extractUseDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult
  ): void {
    for (const child of node.children) {
      if (child.type === 'namespace_use_clause') {
        const nameNode = child.childForFieldName('name');
        const aliasNode = child.childForFieldName('alias');

        if (nameNode) {
          const fullName = nameNode.text;
          const parts = fullName.split('\\');
          const localName = aliasNode?.text ?? parts.pop() ?? fullName;

          result.imports.push(this.createImport({
            source: fullName,
            names: [{
              imported: fullName,
              local: localName,
            }],
            line: node.startPosition.row + 1,
          }));
        }
      }
    }
  }

  /**
   * Extract a function call (global function)
   */
  private extractFunctionCall(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return;

    let calleeName: string;
    let receiver: string | undefined;

    // Qualified name: \Namespace\func() or Namespace\func()
    if (funcNode.type === 'qualified_name') {
      const parts = funcNode.text.split('\\').filter(p => p);
      calleeName = parts.pop() ?? funcNode.text;
      if (parts.length > 0) {
        receiver = parts.join('\\');
      }
    }
    // Simple name: func()
    else {
      calleeName = funcNode.text;
    }

    // Count arguments
    const argsNode = node.childForFieldName('arguments');
    let argumentCount = 0;
    if (argsNode) {
      for (const child of argsNode.children) {
        if (child.type === 'argument') {
          argumentCount++;
        }
      }
    }

    const call = this.createCall({
      calleeName,
      receiver,
      fullExpression: node.text,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      argumentCount,
      isMethodCall: false,
      isConstructorCall: false,
    });

    result.calls.push(call);
  }

  /**
   * Extract a member call ($obj->method())
   */
  private extractMemberCall(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    const nameNode = node.childForFieldName('name');
    const objectNode = node.childForFieldName('object');

    if (!nameNode) return;

    const calleeName = nameNode.text;
    const receiver = objectNode?.text;

    // Count arguments
    const argsNode = node.childForFieldName('arguments');
    let argumentCount = 0;
    if (argsNode) {
      for (const child of argsNode.children) {
        if (child.type === 'argument') {
          argumentCount++;
        }
      }
    }

    const call = this.createCall({
      calleeName,
      receiver,
      fullExpression: node.text,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      argumentCount,
      isMethodCall: true,
      isConstructorCall: false,
    });

    result.calls.push(call);
  }

  /**
   * Extract a scoped call (Class::method() or self::method())
   */
  private extractScopedCall(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    const nameNode = node.childForFieldName('name');
    const scopeNode = node.childForFieldName('scope');

    if (!nameNode) return;

    const calleeName = nameNode.text;
    const receiver = scopeNode?.text;

    // Count arguments
    const argsNode = node.childForFieldName('arguments');
    let argumentCount = 0;
    if (argsNode) {
      for (const child of argsNode.children) {
        if (child.type === 'argument') {
          argumentCount++;
        }
      }
    }

    const call = this.createCall({
      calleeName,
      receiver,
      fullExpression: node.text,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      argumentCount,
      isMethodCall: true,
      isConstructorCall: false,
    });

    result.calls.push(call);
  }

  /**
   * Extract an object creation (new Foo())
   */
  private extractObjectCreation(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    // Find the class name - could be in different positions
    let calleeName: string | undefined;
    let receiver: string | undefined;

    for (const child of node.children) {
      if (child.type === 'name' || child.type === 'qualified_name') {
        const parts = child.text.split('\\').filter(p => p);
        calleeName = parts.pop();
        if (parts.length > 0) {
          receiver = parts.join('\\');
        }
        break;
      }
    }

    if (!calleeName) return;

    // Count arguments
    const argsNode = node.childForFieldName('arguments');
    let argumentCount = 0;
    if (argsNode) {
      for (const child of argsNode.children) {
        if (child.type === 'argument') {
          argumentCount++;
        }
      }
    }

    const call = this.createCall({
      calleeName,
      receiver,
      fullExpression: node.text,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      argumentCount,
      isMethodCall: false,
      isConstructorCall: true,
    });

    result.calls.push(call);
  }

  /**
   * Extract calls from a function/method body
   */
  private extractCallsFromBody(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const visit = (n: TreeSitterNode): void => {
      if (n.type === 'function_call_expression') {
        this.extractFunctionCall(n, result, source);
      } else if (n.type === 'member_call_expression') {
        this.extractMemberCall(n, result, source);
      } else if (n.type === 'scoped_call_expression') {
        this.extractScopedCall(n, result, source);
      } else if (n.type === 'object_creation_expression') {
        this.extractObjectCreation(n, result, source);
      }

      // Don't recurse into nested function/class declarations
      if (n.type !== 'function_definition' && n.type !== 'class_declaration' && n.type !== 'anonymous_function_creation_expression') {
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
   * Extract parameters from a formal_parameters node
   */
  private extractParameters(node: TreeSitterNode): ParameterInfo[] {
    const params: ParameterInfo[] = [];

    for (const child of node.children) {
      if (child.type === 'simple_parameter' || child.type === 'variadic_parameter' || child.type === 'property_promotion_parameter') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');
        const defaultNode = child.childForFieldName('default_value');

        if (nameNode) {
          // Remove $ prefix from PHP variable names
          const name = nameNode.text.replace(/^\$/, '');
          params.push(this.parseParameter(
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

  /**
   * Extract attributes (PHP 8+) from a node
   */
  private extractAttributes(node: TreeSitterNode): string[] {
    const attributes: string[] = [];

    // Look for attribute_list siblings before the node
    let sibling = node.previousNamedSibling;
    while (sibling && sibling.type === 'attribute_list') {
      for (const attr of sibling.children) {
        if (attr.type === 'attribute') {
          attributes.unshift(`#[${attr.text}]`);
        }
      }
      sibling = sibling.previousNamedSibling;
    }

    return attributes;
  }

  /**
   * Check if a node has a specific modifier
   */
  private hasModifier(node: TreeSitterNode, modifier: string): boolean {
    for (const child of node.children) {
      if (child.type === 'visibility_modifier' && child.text === modifier) {
        return true;
      }
      if (child.type === 'static_modifier' && modifier === 'static') {
        return true;
      }
      if (child.type === 'abstract_modifier' && modifier === 'abstract') {
        return true;
      }
      if (child.type === 'final_modifier' && modifier === 'final') {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a node has any visibility modifier
   */
  private hasAnyVisibility(node: TreeSitterNode): boolean {
    for (const child of node.children) {
      if (child.type === 'visibility_modifier') {
        return true;
      }
    }
    return false;
  }
}
