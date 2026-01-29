/**
 * C# Call Graph Extractor
 *
 * Extracts functions, calls, imports, and exports from C#
 * using tree-sitter for AST parsing.
 *
 * Handles:
 * - Method definitions (regular, static, async)
 * - Constructors
 * - Properties with getters/setters
 * - Class hierarchies
 * - Namespace imports (using statements)
 * - Lambda expressions
 * - Local functions (C# 7+)
 * - LINQ queries
 * - ASP.NET controller actions
 * - Top-level statements (C# 9+)
 * - Callback patterns (Action, Func delegates)
 */

import { BaseCallGraphExtractor } from './base-extractor.js';
import {
  isCSharpTreeSitterAvailable,
  createCSharpParser,
} from '../../parsers/tree-sitter/csharp-loader.js';

import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type {
  CallGraphLanguage,
  FileExtractionResult,
  ParameterInfo,
  CallExtraction,
} from '../types.js';

/**
 * C# call graph extractor using tree-sitter
 */
export class CSharpCallGraphExtractor extends BaseCallGraphExtractor {
  readonly language: CallGraphLanguage = 'csharp';
  readonly extensions: string[] = ['.cs'];

  private parser: TreeSitterParser | null = null;

  /**
   * Check if tree-sitter is available
   */
  static isAvailable(): boolean {
    return isCSharpTreeSitterAvailable();
  }

  /**
   * Extract call graph information from C# source
   */
  extract(source: string, filePath: string): FileExtractionResult {
    const result = this.createEmptyResult(filePath);

    if (!isCSharpTreeSitterAvailable()) {
      result.errors.push('Tree-sitter not available for C# parsing');
      return result;
    }

    try {
      if (!this.parser) {
        this.parser = createCSharpParser();
      }

      const tree = this.parser.parse(source);
      this.visitNode(tree.rootNode, result, source, null, null);
      
      // Extract top-level statements (C# 9+)
      this.extractTopLevelStatements(tree.rootNode, result, source);

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
      case 'namespace_declaration':
      case 'file_scoped_namespace_declaration':
        this.extractNamespace(node, result, source);
        break;

      case 'class_declaration':
      case 'record_declaration':
      case 'struct_declaration':
        this.extractClassDeclaration(node, result, source, currentNamespace);
        break;

      case 'interface_declaration':
        this.extractInterfaceDeclaration(node, result, source, currentNamespace);
        break;

      case 'method_declaration':
        this.extractMethodDeclaration(node, result, source, currentClass, currentNamespace, null);
        break;

      case 'constructor_declaration':
        this.extractConstructorDeclaration(node, result, source, currentClass, currentNamespace);
        break;

      case 'local_function_statement':
        // Local functions are handled within method bodies
        break;

      case 'using_directive':
        this.extractUsingDirective(node, result);
        break;

      case 'invocation_expression':
        this.extractInvocationExpression(node, result, source);
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
      if (child.type === 'declaration_list' || child.type === '{') {
        for (const decl of child.children) {
          this.visitNode(decl, result, source, null, namespaceName);
        }
      } else {
        this.visitNode(child, result, source, null, namespaceName);
      }
    }
  }

  /**
   * Extract a class/record/struct declaration
   */
  private extractClassDeclaration(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentNamespace: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const className = nameNode.text;
    const fullClassName = currentNamespace ? `${currentNamespace}.${className}` : className;

    // Get base classes
    const baseClasses: string[] = [];
    const baseListNode = node.childForFieldName('bases');
    if (baseListNode) {
      for (const child of baseListNode.children) {
        if (child.type === 'identifier' || child.type === 'qualified_name' || child.type === 'generic_name') {
          baseClasses.push(child.text);
        }
      }
    }

    // Get methods
    const methods: string[] = [];
    const bodyNode = node.children.find(c => c.type === 'declaration_list');
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

    // Check if exported (public)
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
    if (!nameNode) {return;}

    const interfaceName = nameNode.text;
    const fullName = currentNamespace ? `${currentNamespace}.${interfaceName}` : interfaceName;

    // Get methods
    const methods: string[] = [];
    const bodyNode = node.children.find(c => c.type === 'declaration_list');
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
      baseClasses: [],
      methods,
      isExported: this.hasModifier(node, 'public'),
    }));

    // Visit interface body
    if (bodyNode) {
      for (const member of bodyNode.children) {
        this.visitNode(member, result, source, fullName, currentNamespace);
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
    _currentNamespace: string | null,
    parentFunction: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const isStatic = this.hasModifier(node, 'static');
    const isAsync = this.hasModifier(node, 'async');
    const isPublic = this.hasModifier(node, 'public');

    // Get return type
    const returnTypeNode = node.childForFieldName('type');
    const returnType = returnTypeNode?.text;

    // Get parameters
    const parametersNode = node.childForFieldName('parameters');
    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];

    // Get decorators (attributes)
    const decorators = this.extractAttributes(node);

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
      isAsync,
      className: currentClass ?? undefined,
      decorators,
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });

    result.functions.push(func);

    // Extract calls from method body
    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result, source);
      // Extract local functions and lambdas
      this.extractNestedFunctions(bodyNode, result, source, currentClass, qualifiedName);
    }
  }

  /**
   * Extract top-level statements (C# 9+)
   * These are statements outside of any class or namespace
   */
  private extractTopLevelStatements(
    rootNode: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const moduleCalls: CallExtraction[] = [];
    let hasTopLevelStatements = false;
    
    const visit = (node: TreeSitterNode): void => {
      // Skip namespace, class, and method declarations
      if (node.type === 'namespace_declaration' ||
          node.type === 'file_scoped_namespace_declaration' ||
          node.type === 'class_declaration' ||
          node.type === 'struct_declaration' ||
          node.type === 'record_declaration' ||
          node.type === 'interface_declaration' ||
          node.type === 'using_directive') {
        return;
      }
      
      // Check for global statements (top-level code)
      if (node.type === 'global_statement') {
        hasTopLevelStatements = true;
        this.extractCallsToArray(node, moduleCalls, source);
      }
      
      // Also check for expression statements at root level
      if (node.type === 'expression_statement' || 
          node.type === 'local_declaration_statement') {
        hasTopLevelStatements = true;
        this.extractCallsToArray(node, moduleCalls, source);
      }
      
      for (const child of node.children) {
        visit(child);
      }
    };
    
    // Find compilation_unit
    const compilationUnit = rootNode.type === 'compilation_unit' ? rootNode : 
      rootNode.children.find(c => c.type === 'compilation_unit') ?? rootNode;
    
    for (const child of compilationUnit.children) {
      visit(child);
    }
    
    // Add module-level calls to result
    result.calls.push(...moduleCalls);
    
    // If there are top-level statements, create a synthetic module function
    if (hasTopLevelStatements && moduleCalls.length > 0) {
      const moduleFunc = this.createFunction({
        name: '__module__',
        startLine: 1,
        endLine: rootNode.endPosition.row + 1,
        startColumn: 0,
        endColumn: 0,
        parameters: [],
        isMethod: false,
        isStatic: false,
        isExported: false,
        isConstructor: false,
        isAsync: false,
        decorators: [],
        bodyStartLine: 1,
        bodyEndLine: rootNode.endPosition.row + 1,
      });
      result.functions.push(moduleFunc);
    }
  }

  /**
   * Extract calls to an array (for top-level statements)
   */
  private extractCallsToArray(
    node: TreeSitterNode,
    calls: CallExtraction[],
    _source: string
  ): void {
    const visit = (n: TreeSitterNode): void => {
      if (n.type === 'invocation_expression') {
        const funcNode = n.childForFieldName('function');
        if (funcNode) {
          let calleeName: string;
          let receiver: string | undefined;

          if (funcNode.type === 'member_access_expression') {
            const objectNode = funcNode.childForFieldName('expression');
            const nameNode = funcNode.childForFieldName('name');
            if (objectNode && nameNode) {
              receiver = objectNode.text;
              calleeName = nameNode.text;
            } else {
              calleeName = funcNode.text;
            }
          } else if (funcNode.type === 'identifier') {
            calleeName = funcNode.text;
          } else if (funcNode.type === 'generic_name') {
            const nameNode = funcNode.childForFieldName('name');
            calleeName = nameNode?.text ?? funcNode.text;
          } else {
            calleeName = funcNode.text;
          }

          const argsNode = n.childForFieldName('arguments');
          let argumentCount = 0;
          if (argsNode) {
            for (const child of argsNode.children) {
              if (child.type === 'argument') {
                argumentCount++;
              }
            }
          }

          calls.push(this.createCall({
            calleeName,
            receiver,
            fullExpression: n.text,
            line: n.startPosition.row + 1,
            column: n.startPosition.column,
            argumentCount,
            isMethodCall: !!receiver,
            isConstructorCall: false,
          }));
        }
      } else if (n.type === 'object_creation_expression') {
        const typeNode = n.childForFieldName('type');
        if (typeNode) {
          let calleeName: string;
          let receiver: string | undefined;

          if (typeNode.type === 'qualified_name') {
            const parts = typeNode.text.split('.');
            calleeName = parts.pop() ?? typeNode.text;
            if (parts.length > 0) {
              receiver = parts.join('.');
            }
          } else if (typeNode.type === 'generic_name') {
            const nameNode = typeNode.childForFieldName('name');
            calleeName = nameNode?.text ?? typeNode.text;
          } else {
            calleeName = typeNode.text;
          }

          const argsNode = n.childForFieldName('arguments');
          let argumentCount = 0;
          if (argsNode) {
            for (const child of argsNode.children) {
              if (child.type === 'argument') {
                argumentCount++;
              }
            }
          }

          calls.push(this.createCall({
            calleeName,
            receiver,
            fullExpression: n.text,
            line: n.startPosition.row + 1,
            column: n.startPosition.column,
            argumentCount,
            isMethodCall: false,
            isConstructorCall: true,
          }));
        }
      }
      
      for (const child of n.children) {
        visit(child);
      }
    };
    
    visit(node);
  }

  /**
   * Extract nested functions (local functions and lambdas) from a method body
   */
  private extractNestedFunctions(
    bodyNode: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentClass: string | null,
    parentFunctionName: string
  ): void {
    let lambdaCounter = 0;
    
    const visit = (node: TreeSitterNode): void => {
      // Local function: int LocalFunc() { ... }
      if (node.type === 'local_function_statement') {
        this.extractLocalFunction(node, result, source, currentClass, parentFunctionName);
        return; // Don't recurse into this function's children
      }
      
      // Lambda expression: x => x * 2 or (x, y) => x + y
      if (node.type === 'lambda_expression') {
        lambdaCounter++;
        this.extractLambdaExpression(node, result, source, parentFunctionName, lambdaCounter);
        return;
      }
      
      // Anonymous method: delegate(int x) { return x * 2; }
      if (node.type === 'anonymous_method_expression') {
        lambdaCounter++;
        this.extractAnonymousMethod(node, result, source, parentFunctionName, lambdaCounter);
        return;
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
   * Extract a local function (C# 7+)
   * e.g., int LocalFunc(int x) => x * 2;
   */
  private extractLocalFunction(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentClass: string | null,
    parentFunctionName: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const qualifiedName = `${parentFunctionName}.${name}`;
    
    const isStatic = this.hasModifier(node, 'static');
    const isAsync = this.hasModifier(node, 'async');

    // Get return type
    const returnTypeNode = node.childForFieldName('type');
    const returnType = returnTypeNode?.text;

    // Get parameters
    const parametersNode = node.childForFieldName('parameters');
    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];

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
      isStatic,
      isExported: false, // Local functions are never exported
      isConstructor: false,
      isAsync,
      decorators: [],
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });

    result.functions.push(func);

    // Extract calls from local function body
    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result, source);
      // Recursively extract nested functions
      this.extractNestedFunctions(bodyNode, result, source, currentClass, qualifiedName);
    }
  }

  /**
   * Extract a lambda expression
   * e.g., x => x * 2, (x, y) => x + y, async () => await Task.Delay(1000)
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
    
    // Check for async modifier
    const isAsync = node.children.some(c => c.text === 'async');
    
    // Get parameters
    const parametersNode = node.childForFieldName('parameters');
    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];
    
    // Single parameter without parentheses
    if (parameters.length === 0) {
      for (const child of node.children) {
        if (child.type === 'identifier' && child !== node.childForFieldName('body')) {
          parameters.push(this.parseParameter(child.text));
          break;
        }
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
      isAsync,
      decorators: [],
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });
    
    result.functions.push(func);
    
    // Extract calls from lambda body
    if (bodyNode) {
      this.extractCallsFromBodyRecursive(bodyNode, result, source);
    }
  }

  /**
   * Extract an anonymous method expression
   * e.g., delegate(int x) { return x * 2; }
   */
  private extractAnonymousMethod(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    parentFunctionName: string,
    counter: number
  ): void {
    const syntheticName = `delegate${counter}`;
    const qualifiedName = `${parentFunctionName}.${syntheticName}`;
    
    // Check for async modifier
    const isAsync = node.children.some(c => c.text === 'async');
    
    // Get parameters
    const parametersNode = node.childForFieldName('parameters');
    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];
    
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
      isAsync,
      decorators: [],
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });
    
    result.functions.push(func);
    
    // Extract calls from anonymous method body
    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result, source);
      // Recursively extract nested functions
      this.extractNestedFunctions(bodyNode, result, source, null, qualifiedName);
    }
  }

  /**
   * Extract calls recursively from an expression (for lambda bodies)
   */
  private extractCallsFromBodyRecursive(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    if (node.type === 'invocation_expression') {
      this.extractInvocationExpression(node, result, source);
    } else if (node.type === 'object_creation_expression') {
      this.extractObjectCreation(node, result, source);
    }
    
    for (const child of node.children) {
      this.extractCallsFromBodyRecursive(child, result, source);
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
    _currentNamespace: string | null
  ): void {
    // Get parameters
    const parametersNode = node.childForFieldName('parameters');
    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];

    // Get decorators (attributes)
    const decorators = this.extractAttributes(node);

    // Get body
    const bodyNode = node.childForFieldName('body');

    const func = this.createFunction({
      name: 'constructor',
      qualifiedName: currentClass ? `${currentClass}.constructor` : 'constructor',
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

    const qualifiedName = currentClass ? `${currentClass}.constructor` : 'constructor';

    // Extract calls from constructor body
    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result, source);
      // Extract local functions and lambdas from constructor body
      this.extractNestedFunctions(bodyNode, result, source, currentClass, qualifiedName);
    }

    // Extract calls from constructor initializer (: base(...) or : this(...))
    const initializerNode = node.childForFieldName('initializer');
    if (initializerNode) {
      this.extractCallsFromBody(initializerNode, result, source);
    }
  }

  /**
   * Extract a using directive
   */
  private extractUsingDirective(
    node: TreeSitterNode,
    result: FileExtractionResult
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const namespaceName = nameNode.text;

    result.imports.push(this.createImport({
      source: namespaceName,
      names: [{
        imported: namespaceName,
        local: namespaceName.split('.').pop() ?? namespaceName,
      }],
      line: node.startPosition.row + 1,
    }));
  }

  /**
   * Extract an invocation expression (method call)
   */
  private extractInvocationExpression(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) {return;}

    let calleeName: string;
    let receiver: string | undefined;

    // Member access: obj.Method() or obj.Prop.Method()
    if (funcNode.type === 'member_access_expression') {
      const objectNode = funcNode.childForFieldName('expression');
      const nameNode = funcNode.childForFieldName('name');
      if (objectNode && nameNode) {
        receiver = objectNode.text;
        calleeName = nameNode.text;
      } else {
        calleeName = funcNode.text;
      }
    }
    // Direct call: Method()
    else if (funcNode.type === 'identifier') {
      calleeName = funcNode.text;
    }
    // Generic method: Method<T>()
    else if (funcNode.type === 'generic_name') {
      const nameNode = funcNode.childForFieldName('name');
      calleeName = nameNode?.text ?? funcNode.text;
    }
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
    if (!typeNode) {return;}

    let calleeName: string;
    let receiver: string | undefined;

    // Qualified name: new Namespace.Class()
    if (typeNode.type === 'qualified_name') {
      const parts = typeNode.text.split('.');
      calleeName = parts.pop() ?? typeNode.text;
      if (parts.length > 0) {
        receiver = parts.join('.');
      }
    }
    // Generic name: new List<T>()
    else if (typeNode.type === 'generic_name') {
      const nameNode = typeNode.childForFieldName('name');
      calleeName = nameNode?.text ?? typeNode.text;
    }
    // Simple identifier: new Foo()
    else {
      calleeName = typeNode.text;
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
      isConstructorCall: true,
    });

    result.calls.push(call);
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
      if (n.type === 'invocation_expression') {
        this.extractInvocationExpression(n, result, source);
      } else if (n.type === 'object_creation_expression') {
        this.extractObjectCreation(n, result, source);
      }

      // Don't recurse into nested method declarations (lambdas are handled separately)
      if (n.type !== 'local_function_statement') {
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
   * Extract parameters from a parameter list
   */
  private extractParameters(node: TreeSitterNode): ParameterInfo[] {
    const params: ParameterInfo[] = [];

    for (const child of node.children) {
      if (child.type === 'parameter') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');
        const defaultNode = child.childForFieldName('default_value');

        if (nameNode) {
          params.push(this.parseParameter(
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

  /**
   * Extract attributes (decorators) from a node
   */
  private extractAttributes(node: TreeSitterNode): string[] {
    const attributes: string[] = [];

    // Look for attribute_list siblings before the node
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

  /**
   * Check if a node has a specific modifier
   */
  private hasModifier(node: TreeSitterNode, modifier: string): boolean {
    for (const child of node.children) {
      if (child.type === 'modifier' && child.text === modifier) {
        return true;
      }
    }
    return false;
  }
}
