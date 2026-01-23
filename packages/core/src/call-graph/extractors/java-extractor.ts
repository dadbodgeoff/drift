/**
 * Java Call Graph Extractor
 *
 * Extracts functions, calls, imports, and exports from Java
 * using tree-sitter for AST parsing.
 *
 * Handles:
 * - Method definitions (regular, static, abstract)
 * - Constructors
 * - Class hierarchies (extends, implements)
 * - Package imports
 * - Lambda expressions
 * - Method references (::)
 * - Spring annotations (@Controller, @Service, etc.)
 * - Inner classes
 * - Anonymous classes
 */

import { BaseCallGraphExtractor } from './base-extractor.js';
import type {
  CallGraphLanguage,
  FileExtractionResult,
  ParameterInfo,
} from '../types.js';
import {
  isJavaTreeSitterAvailable,
  createJavaParser,
} from '../../parsers/tree-sitter/java-loader.js';
import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';

/**
 * Java call graph extractor using tree-sitter
 */
export class JavaCallGraphExtractor extends BaseCallGraphExtractor {
  readonly language: CallGraphLanguage = 'java';
  readonly extensions: string[] = ['.java'];

  private parser: TreeSitterParser | null = null;

  /**
   * Check if tree-sitter is available
   */
  static isAvailable(): boolean {
    return isJavaTreeSitterAvailable();
  }

  /**
   * Extract call graph information from Java source
   */
  extract(source: string, filePath: string): FileExtractionResult {
    const result = this.createEmptyResult(filePath);

    if (!isJavaTreeSitterAvailable()) {
      result.errors.push('Tree-sitter not available for Java parsing');
      return result;
    }

    try {
      if (!this.parser) {
        this.parser = createJavaParser();
      }

      const tree = this.parser.parse(source);
      
      // Extract package name
      let packageName: string | null = null;
      for (const child of tree.rootNode.children) {
        if (child.type === 'package_declaration') {
          const nameNode = child.children.find(c => 
            c.type === 'scoped_identifier' || c.type === 'identifier'
          );
          packageName = nameNode?.text ?? null;
          break;
        }
      }

      this.visitNode(tree.rootNode, result, source, null, packageName);

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
    currentPackage: string | null
  ): void {
    switch (node.type) {
      case 'class_declaration':
      case 'record_declaration':
      case 'enum_declaration':
        this.extractClassDeclaration(node, result, source, currentPackage);
        break;

      case 'interface_declaration':
        this.extractInterfaceDeclaration(node, result, source, currentPackage);
        break;

      case 'method_declaration':
        this.extractMethodDeclaration(node, result, source, currentClass, currentPackage);
        break;

      case 'constructor_declaration':
        this.extractConstructorDeclaration(node, result, source, currentClass, currentPackage);
        break;

      case 'import_declaration':
        this.extractImportDeclaration(node, result);
        break;

      case 'method_invocation':
        this.extractMethodInvocation(node, result, source);
        break;

      case 'object_creation_expression':
        this.extractObjectCreation(node, result, source);
        break;

      case 'method_reference':
        this.extractMethodReference(node, result, source);
        break;

      default:
        // Recurse into children
        for (const child of node.children) {
          this.visitNode(child, result, source, currentClass, currentPackage);
        }
    }
  }

  /**
   * Extract a class/record/enum declaration
   */
  private extractClassDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentPackage: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const className = nameNode.text;
    const fullClassName = currentPackage ? `${currentPackage}.${className}` : className;

    // Get base classes (extends)
    const baseClasses: string[] = [];
    const superclassNode = node.childForFieldName('superclass');
    if (superclassNode) {
      // Skip the 'extends' keyword
      const typeNode = superclassNode.children.find(c => 
        c.type === 'type_identifier' || c.type === 'scoped_type_identifier' || c.type === 'generic_type'
      );
      if (typeNode) {
        baseClasses.push(typeNode.text);
      }
    }

    // Get interfaces (implements)
    const interfacesNode = node.childForFieldName('interfaces');
    if (interfacesNode) {
      for (const child of interfacesNode.children) {
        if (child.type === 'type_identifier' || child.type === 'scoped_type_identifier' || child.type === 'generic_type') {
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

    // Check if public
    const isExported = this.hasModifier(node, 'public');

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
        this.visitNode(member, result, source, fullClassName, currentPackage);
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
    currentPackage: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const interfaceName = nameNode.text;
    const fullName = currentPackage ? `${currentPackage}.${interfaceName}` : interfaceName;

    // Get extended interfaces
    const baseClasses: string[] = [];
    const extendsNode = node.childForFieldName('extends');
    if (extendsNode) {
      for (const child of extendsNode.children) {
        if (child.type === 'type_identifier' || child.type === 'scoped_type_identifier') {
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
      isExported: this.hasModifier(node, 'public'),
    }));

    // Visit interface body
    if (bodyNode) {
      for (const member of bodyNode.children) {
        this.visitNode(member, result, source, fullName, currentPackage);
      }
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
    _currentPackage: string | null,
    parentFunction: string | null = null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const isStatic = this.hasModifier(node, 'static');
    const isPublic = this.hasModifier(node, 'public');

    // Get return type
    const returnTypeNode = node.childForFieldName('type');
    const returnType = returnTypeNode?.text;

    // Get parameters
    const parametersNode = node.childForFieldName('parameters');
    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];

    // Get annotations (decorators)
    const decorators = this.extractAnnotations(node);

    // Get body
    const bodyNode = node.childForFieldName('body');

    // Build qualified name
    let qualifiedName = currentClass ? `${currentClass}.${name}` : name;
    if (parentFunction) {
      qualifiedName = `${parentFunction}.${name}`;
    }

    const func = this.createFunction({
      name,
      qualifiedName,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters,
      returnType,
      isMethod: currentClass !== null,
      isStatic,
      isExported: parentFunction ? false : isPublic,
      isConstructor: false,
      isAsync: false, // Java doesn't have async keyword
      className: currentClass ?? undefined,
      decorators,
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });

    result.functions.push(func);

    // Extract calls from method body
    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result, source);
      // Extract lambda expressions and anonymous classes
      this.extractNestedFunctions(bodyNode, result, source, currentClass, qualifiedName);
    }
  }

  /**
   * Extract a constructor declaration
   */
  private extractConstructorDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentClass: string | null,
    _currentPackage: string | null
  ): void {
    // Get parameters
    const parametersNode = node.childForFieldName('parameters');
    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];

    // Get annotations
    const decorators = this.extractAnnotations(node);

    // Get body
    const bodyNode = node.childForFieldName('body');

    const qualifiedName = currentClass ? `${currentClass}.constructor` : 'constructor';

    const func = this.createFunction({
      name: 'constructor',
      qualifiedName,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters,
      isMethod: true,
      isStatic: false,
      isExported: this.hasModifier(node, 'public'),
      isConstructor: true,
      isAsync: false,
      className: currentClass ?? undefined,
      decorators,
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });

    result.functions.push(func);

    // Extract calls from constructor body
    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result, source);
      // Extract lambda expressions and anonymous classes
      this.extractNestedFunctions(bodyNode, result, source, currentClass, qualifiedName);
    }
  }

  /**
   * Extract an import declaration
   */
  private extractImportDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult
  ): void {
    // Find the scoped_identifier or identifier
    let importPath = '';
    let isWildcard = false;

    for (const child of node.children) {
      if (child.type === 'scoped_identifier' || child.type === 'identifier') {
        importPath = child.text;
      } else if (child.type === 'asterisk') {
        isWildcard = true;
      }
    }

    if (!importPath) return;

    const parts = importPath.split('.');
    const localName = isWildcard ? '*' : (parts.pop() ?? importPath);

    result.imports.push(this.createImport({
      source: importPath,
      names: [{
        imported: localName,
        local: localName,
        isNamespace: isWildcard,
      }],
      line: node.startPosition.row + 1,
    }));
  }

  /**
   * Extract a method invocation
   */
  private extractMethodInvocation(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const calleeName = nameNode.text;
    let receiver: string | undefined;

    // Get receiver (object)
    const objectNode = node.childForFieldName('object');
    if (objectNode) {
      receiver = objectNode.text;
    }

    // Count arguments
    const argsNode = node.childForFieldName('arguments');
    let argumentCount = 0;
    const callbackRefs: string[] = [];
    
    if (argsNode) {
      for (const child of argsNode.children) {
        if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
          argumentCount++;
          
          // Check for method references or lambda callbacks
          if (child.type === 'identifier') {
            callbackRefs.push(child.text);
          }
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
      isMethodCall: !!receiver,
      isConstructorCall: false,
    });

    result.calls.push(call);
  }

  /**
   * Extract an object creation expression (new Foo())
   */
  private extractObjectCreation(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    const typeNode = node.childForFieldName('type');
    if (!typeNode) return;

    let calleeName: string;
    let receiver: string | undefined;

    // Scoped type: new com.example.Foo()
    if (typeNode.type === 'scoped_type_identifier') {
      const parts = typeNode.text.split('.');
      calleeName = parts.pop() ?? typeNode.text;
      if (parts.length > 0) {
        receiver = parts.join('.');
      }
    }
    // Generic type: new ArrayList<String>()
    else if (typeNode.type === 'generic_type') {
      const nameNode = typeNode.children.find(c => 
        c.type === 'type_identifier' || c.type === 'scoped_type_identifier'
      );
      calleeName = nameNode?.text ?? typeNode.text;
    }
    // Simple type: new Foo()
    else {
      calleeName = typeNode.text;
    }

    // Count arguments
    const argsNode = node.childForFieldName('arguments');
    let argumentCount = 0;
    if (argsNode) {
      for (const child of argsNode.children) {
        if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
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
   * Extract a method reference (Class::method)
   */
  private extractMethodReference(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    // Method references are like: String::valueOf, this::process, obj::method
    const text = node.text;
    const parts = text.split('::');
    
    if (parts.length === 2 && parts[0] && parts[1]) {
      const receiver = parts[0];
      const methodName = parts[1];

      const call = this.createCall({
        calleeName: methodName === 'new' ? receiver : methodName,
        receiver: methodName === 'new' ? undefined : receiver,
        fullExpression: text,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        argumentCount: 0,
        isMethodCall: methodName !== 'new',
        isConstructorCall: methodName === 'new',
      });

      result.calls.push(call);
    }
  }

  /**
   * Extract nested functions (lambdas and anonymous classes) from a method body
   */
  private extractNestedFunctions(
    bodyNode: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentClass: string | null,
    parentFunctionName: string
  ): void {
    let lambdaCounter = 0;
    let anonClassCounter = 0;
    
    const visit = (node: TreeSitterNode): void => {
      // Lambda expression: (x) -> x * 2 or x -> x * 2
      if (node.type === 'lambda_expression') {
        lambdaCounter++;
        this.extractLambdaExpression(node, result, source, parentFunctionName, lambdaCounter);
        return; // Don't recurse into lambda body (handled by extractLambdaExpression)
      }
      
      // Anonymous class: new Runnable() { public void run() { ... } }
      if (node.type === 'object_creation_expression') {
        const classBody = node.children.find(c => c.type === 'class_body');
        if (classBody) {
          anonClassCounter++;
          this.extractAnonymousClass(classBody, result, source, currentClass, parentFunctionName, anonClassCounter);
          return;
        }
      }
      
      // Don't recurse into nested class declarations
      if (node.type === 'class_declaration') {
        return;
      }
      
      for (const child of node.children) {
        visit(child);
      }
    };
    
    for (const child of bodyNode.children) {
      visit(child);
    }
  }

  /**
   * Extract a lambda expression
   * e.g., (x) -> x * 2, x -> x * 2, () -> System.out.println("hello")
   */
  private extractLambdaExpression(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    parentFunctionName: string,
    counter: number
  ): void {
    const syntheticName = `lambda${counter}`;
    const qualifiedName = `${parentFunctionName}.${syntheticName}`;
    
    // Get parameters
    const parametersNode = node.childForFieldName('parameters');
    let parameters: ParameterInfo[] = [];
    
    if (parametersNode) {
      if (parametersNode.type === 'formal_parameters') {
        parameters = this.extractParameters(parametersNode);
      } else if (parametersNode.type === 'inferred_parameters') {
        // Inferred parameters: (x, y) without types
        for (const child of parametersNode.children) {
          if (child.type === 'identifier') {
            parameters.push(this.parseParameter(child.text));
          }
        }
      } else if (parametersNode.type === 'identifier') {
        // Single parameter without parentheses: x -> x * 2
        parameters.push(this.parseParameter(parametersNode.text));
      }
    }
    
    // Get body
    const bodyNode = node.childForFieldName('body');
    
    const func = this.createFunction({
      name: syntheticName,
      qualifiedName,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      parameters,
      isMethod: false,
      isStatic: false,
      isExported: false,
      isConstructor: false,
      isAsync: false,
      decorators: [],
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });
    
    result.functions.push(func);
    
    // Extract calls from lambda body
    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result, source);
      // Recursively extract nested lambdas
      this.extractNestedFunctions(bodyNode, result, source, null, qualifiedName);
    }
  }

  /**
   * Extract methods from an anonymous class
   * e.g., new Runnable() { public void run() { ... } }
   */
  private extractAnonymousClass(
    classBody: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    _currentClass: string | null,
    parentFunctionName: string,
    counter: number
  ): void {
    const syntheticClassName = `${parentFunctionName}.$anon${counter}`;
    
    // Extract methods from the anonymous class body
    for (const member of classBody.children) {
      if (member.type === 'method_declaration') {
        this.extractMethodDeclaration(member, result, source, syntheticClassName, null, parentFunctionName);
      } else if (member.type === 'constructor_declaration') {
        // Anonymous classes can have instance initializers but not constructors
        // Skip for now
      }
    }
  }

  /**
   * Extract calls from a method body
   */
  private extractCallsFromBody(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const visit = (n: TreeSitterNode): void => {
      if (n.type === 'method_invocation') {
        this.extractMethodInvocation(n, result, source);
      } else if (n.type === 'object_creation_expression') {
        this.extractObjectCreation(n, result, source);
      } else if (n.type === 'method_reference') {
        this.extractMethodReference(n, result, source);
      }

      // Don't recurse into nested class declarations
      if (n.type !== 'class_declaration' && n.type !== 'anonymous_class_body') {
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
      if (child.type === 'formal_parameter' || child.type === 'spread_parameter') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');

        if (nameNode) {
          params.push(this.parseParameter(
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

  /**
   * Extract annotations from a node
   */
  private extractAnnotations(node: TreeSitterNode): string[] {
    const annotations: string[] = [];

    // Look for annotation siblings before the node
    let sibling = node.previousNamedSibling;
    while (sibling && (sibling.type === 'annotation' || sibling.type === 'marker_annotation')) {
      annotations.unshift(sibling.text);
      sibling = sibling.previousNamedSibling;
    }

    // Also check modifiers node which may contain annotations
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

  /**
   * Check if a node has a specific modifier
   */
  private hasModifier(node: TreeSitterNode, modifier: string): boolean {
    for (const child of node.children) {
      if (child.type === 'modifiers') {
        for (const mod of child.children) {
          if (mod.text === modifier) {
            return true;
          }
        }
      }
      // Direct modifier child
      if (child.text === modifier) {
        return true;
      }
    }
    return false;
  }
}
