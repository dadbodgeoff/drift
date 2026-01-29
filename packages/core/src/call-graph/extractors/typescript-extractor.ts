/**
 * TypeScript/JavaScript Call Graph Extractor
 *
 * Extracts functions, calls, imports, and exports from TypeScript/JavaScript
 * using the TypeScript Compiler API.
 * 
 * Handles:
 * - Function declarations, arrow functions, function expressions
 * - Nested functions (closures)
 * - Class methods and constructors
 * - JSX component usage
 * - Module-level calls (top-level code)
 * - Callback patterns (functions passed as arguments)
 * - IIFE patterns
 */

import ts from 'typescript';

import { BaseCallGraphExtractor } from './base-extractor.js';

import type {
  CallGraphLanguage,
  FileExtractionResult,
  FunctionExtraction,
  CallExtraction,
  ImportExtraction,
  ClassExtraction,
  ParameterInfo,
} from '../types.js';

/**
 * TypeScript/JavaScript call graph extractor
 */
export class TypeScriptCallGraphExtractor extends BaseCallGraphExtractor {
  readonly language: CallGraphLanguage = 'typescript';
  readonly extensions: string[] = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

  /**
   * Extract call graph information from TypeScript/JavaScript source
   */
  extract(source: string, filePath: string): FileExtractionResult {
    const result = this.createEmptyResult(filePath);
    result.language = this.getLanguageFromPath(filePath);

    try {
      const scriptKind = this.getScriptKind(filePath);
      const sourceFile = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        scriptKind
      );

      // Extract all information in a single pass
      this.visitNode(sourceFile, result, null, null);

      // Extract module-level calls (top-level code not inside any function)
      this.extractModuleLevelCalls(sourceFile, result);

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Extract calls at module level (not inside any function)
   * This catches patterns like: ReactDOM.render(<App />, ...) in main.tsx
   */
  private extractModuleLevelCalls(sourceFile: ts.SourceFile, result: FileExtractionResult): void {
    const source = sourceFile.text;
    
    // Create a synthetic "module" function to hold top-level calls
    const moduleCalls: CallExtraction[] = [];
    
    // Visit only top-level statements
    for (const statement of sourceFile.statements) {
      // Expression statements at top level (like ReactDOM.render(...))
      if (ts.isExpressionStatement(statement)) {
        this.extractCallsFromNodeWithCallback(statement, moduleCalls, source);
      }
      // Variable declarations with calls (like const x = foo())
      else if (ts.isVariableStatement(statement)) {
        let hasFunction = false;
        for (const decl of statement.declarationList.declarations) {
          if (decl.initializer && 
              (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
            hasFunction = true;
          }
        }
        if (!hasFunction) {
          this.extractCallsFromNodeWithCallback(statement, moduleCalls, source);
        }
      }
    }
    
    // Add module-level calls to result
    result.calls.push(...moduleCalls);
    
    // If there are module-level calls, create a synthetic module function
    if (moduleCalls.length > 0) {
      const moduleFunc = this.createFunction({
        name: '__module__',
        startLine: 1,
        endLine: sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1,
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
        bodyEndLine: sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1,
      });
      result.functions.push(moduleFunc);
    }
  }

  /**
   * Visit a node and extract relevant information
   * @param parentFunction - The name of the containing function (for nested functions)
   */
  private visitNode(
    node: ts.Node,
    result: FileExtractionResult,
    currentClass: string | null,
    parentFunction: string | null
  ): void {
    const source = node.getSourceFile().text;

    // Function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      const func = this.extractFunctionDeclaration(node, source, currentClass, parentFunction);
      if (func) {
        result.functions.push(func);
        // Extract calls within the function body
        if (node.body) {
          this.extractCallsFromNode(node.body, result, source);
          // Visit nested functions
          this.visitNestedFunctions(node.body, result, source, currentClass, func.name);
        }
      }
      return; // Don't recurse into children - we've handled the body
    }

    // Arrow functions and function expressions assigned to variables
    else if (ts.isVariableStatement(node)) {
      let hasFunction = false;
      for (const decl of node.declarationList.declarations) {
        if (decl.initializer && ts.isIdentifier(decl.name)) {
          if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
            hasFunction = true;
            const func = this.extractVariableFunction(node, decl, source, parentFunction);
            if (func) {
              result.functions.push(func);
              // Extract calls within the function body
              this.extractCallsFromNode(decl.initializer, result, source);
              // Visit nested functions
              this.visitNestedFunctions(decl.initializer.body, result, source, currentClass, func.name);
            }
          }
        }
      }
      if (hasFunction) {
        return; // Don't recurse into children - we've handled the function body
      }
    }

    // Class declarations
    else if (ts.isClassDeclaration(node) && node.name) {
      const classInfo = this.extractClassDeclaration(node, source);
      result.classes.push(classInfo);

      // Visit class members with class context
      for (const member of node.members) {
        this.visitNode(member, result, node.name.text, parentFunction);
      }
      return; // Don't recurse into children again
    }

    // Method declarations
    else if (ts.isMethodDeclaration(node) && node.name && currentClass) {
      const func = this.extractMethodDeclaration(node, source, currentClass);
      if (func) {
        result.functions.push(func);
        if (node.body) {
          this.extractCallsFromNode(node.body, result, source);
          // Visit nested functions in methods
          this.visitNestedFunctions(node.body, result, source, currentClass, func.qualifiedName);
        }
      }
      return; // Don't recurse into children - we've handled the body
    }

    // Constructor
    else if (ts.isConstructorDeclaration(node) && currentClass) {
      const func = this.extractConstructor(node, source, currentClass);
      result.functions.push(func);
      if (node.body) {
        this.extractCallsFromNode(node.body, result, source);
        // Visit nested functions in constructor
        this.visitNestedFunctions(node.body, result, source, currentClass, func.qualifiedName);
      }
      return; // Don't recurse into children - we've handled the body
    }

    // Import declarations
    else if (ts.isImportDeclaration(node)) {
      const importInfo = this.extractImportDeclaration(node, source);
      if (importInfo) {
        result.imports.push(importInfo);
      }
    }

    // Export declarations
    else if (ts.isExportDeclaration(node)) {
      const exports = this.extractExportDeclaration(node, source);
      result.exports.push(...exports);
    }

    // Exported declarations
    else if (this.hasExportModifier(node)) {
      const exportInfo = this.extractExportedDeclaration(node, source);
      if (exportInfo) {
        result.exports.push(exportInfo);
      }
    }

    // Recurse into children
    ts.forEachChild(node, (child) => this.visitNode(child, result, currentClass, parentFunction));
  }

  /**
   * Visit nested functions within a function body
   * This extracts arrow functions, function expressions, and named functions defined inside other functions
   * Also handles anonymous callbacks passed to functions like useEffect, useCallback, etc.
   */
  private visitNestedFunctions(
    body: ts.Node,
    result: FileExtractionResult,
    source: string,
    currentClass: string | null,
    parentFunctionName: string
  ): void {
    let callbackCounter = 0;
    
    const visit = (node: ts.Node): void => {
      // Named function inside another function
      if (ts.isFunctionDeclaration(node) && node.name) {
        const func = this.extractFunctionDeclaration(node, source, currentClass, parentFunctionName);
        if (func) {
          result.functions.push(func);
          if (node.body) {
            this.extractCallsFromNode(node.body, result, source);
            // Recursively visit nested functions
            this.visitNestedFunctions(node.body, result, source, currentClass, func.name);
          }
        }
        return; // Don't recurse into this function's children
      }
      
      // Arrow function or function expression assigned to a variable
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (decl.initializer && ts.isIdentifier(decl.name)) {
            if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
              const func = this.extractNestedFunction(decl, source, parentFunctionName);
              if (func) {
                result.functions.push(func);
                this.extractCallsFromNode(decl.initializer, result, source);
                // Recursively visit nested functions
                if (ts.isBlock(decl.initializer.body)) {
                  this.visitNestedFunctions(decl.initializer.body, result, source, currentClass, func.name);
                }
              }
            }
          }
        }
        return;
      }
      
      // Call expressions with anonymous callback arguments
      // Handles: useEffect(() => {...}), setTimeout(() => {...}), arr.map((x) => {...}), etc.
      if (ts.isCallExpression(node)) {
        const processedArgs = new Set<ts.Node>();
        
        for (const arg of node.arguments) {
          if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
            processedArgs.add(arg);
            // Create a synthetic function for the callback
            const calleeName = this.getCallExpressionName(node);
            callbackCounter++;
            const syntheticName = `$${calleeName}$${callbackCounter}`;
            const syntheticQualifiedName = `${parentFunctionName}.${syntheticName}`;
            
            const startPos = this.getPosition(arg.getStart(), source);
            const endPos = this.getPosition(arg.getEnd(), source);
            const modifiers = ts.canHaveModifiers(arg) ? ts.getModifiers(arg) : undefined;
            
            const syntheticFunc = this.createFunction({
              name: syntheticName,
              qualifiedName: syntheticQualifiedName,
              startLine: startPos.row + 1,
              endLine: endPos.row + 1,
              startColumn: startPos.column,
              endColumn: endPos.column,
              parameters: this.extractParameters(arg.parameters),
              returnType: arg.type?.getText(),
              isMethod: false,
              isStatic: false,
              isExported: false,
              isConstructor: false,
              isAsync: modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
              decorators: [],
              bodyStartLine: this.getPosition(arg.body.getStart(), source).row + 1,
              bodyEndLine: this.getPosition(arg.body.getEnd(), source).row + 1,
            });
            
            result.functions.push(syntheticFunc);
            
            // Extract calls from the callback body
            this.extractCallsFromNode(arg.body, result, source);
            
            // Recursively visit nested functions in the callback
            if (ts.isBlock(arg.body)) {
              this.visitNestedFunctions(arg.body, result, source, currentClass, syntheticQualifiedName);
            }
          }
        }
        // Visit children but skip the callback arguments we already processed
        ts.forEachChild(node, (child) => {
          if (!processedArgs.has(child)) {
            visit(child);
          }
        });
        return;
      }
      
      ts.forEachChild(node, visit);
    };
    
    ts.forEachChild(body, visit);
  }

  /**
   * Get the name of a call expression for synthetic function naming
   */
  private getCallExpressionName(node: ts.CallExpression): string {
    const expr = node.expression;
    if (ts.isIdentifier(expr)) {
      return expr.text;
    } else if (ts.isPropertyAccessExpression(expr)) {
      return expr.name.text;
    }
    return 'callback';
  }

  /**
   * Extract a nested function (arrow function or function expression inside another function)
   */
  private extractNestedFunction(
    decl: ts.VariableDeclaration,
    source: string,
    parentFunctionName: string
  ): FunctionExtraction | null {
    if (!ts.isIdentifier(decl.name)) {return null;}
    
    const func = decl.initializer as ts.ArrowFunction | ts.FunctionExpression;
    const startPos = this.getPosition(decl.getStart(), source);
    const endPos = this.getPosition(decl.getEnd(), source);
    const modifiers = ts.canHaveModifiers(func) ? ts.getModifiers(func) : undefined;
    
    const name = decl.name.text;
    
    return this.createFunction({
      name,
      qualifiedName: `${parentFunctionName}.${name}`,
      startLine: startPos.row + 1,
      endLine: endPos.row + 1,
      startColumn: startPos.column,
      endColumn: endPos.column,
      parameters: this.extractParameters(func.parameters),
      returnType: func.type?.getText(),
      isMethod: false,
      isStatic: false,
      isExported: false, // Nested functions are never exported
      isConstructor: false,
      isAsync: modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
      decorators: [],
      bodyStartLine: this.getPosition(func.body.getStart(), source).row + 1,
      bodyEndLine: this.getPosition(func.body.getEnd(), source).row + 1,
    });
  }

  /**
   * Extract calls from a node (function body, etc.)
   */
  private extractCallsFromNode(
    node: ts.Node,
    result: FileExtractionResult,
    source: string
  ): void {
    this.extractCallsFromNodeWithCallback(node, result.calls, source);
  }

  /**
   * Extract calls from a node into a specific array
   * Also detects callback patterns where functions are passed as arguments
   */
  private extractCallsFromNodeWithCallback(
    node: ts.Node,
    calls: CallExtraction[],
    source: string
  ): void {
    const visit = (n: ts.Node): void => {
      // Call expressions: foo(), obj.method(), new Foo()
      if (ts.isCallExpression(n)) {
        const call = this.extractCallExpression(n, source);
        if (call) {
          calls.push(call);
        }
        
        // Check for callback patterns - functions passed as arguments
        this.extractCallbackReferences(n, calls, source);
      }

      // New expressions: new Foo()
      else if (ts.isNewExpression(n)) {
        const call = this.extractNewExpression(n, source);
        if (call) {
          calls.push(call);
        }
      }

      // JSX elements: <Component /> or <Component>...</Component>
      // These are effectively function calls to the component
      else if (ts.isJsxSelfClosingElement(n)) {
        const call = this.extractJsxElement(n.tagName, n, source);
        if (call) {
          calls.push(call);
        }
        // Extract function references from JSX attributes (onClick={handleClick}, etc.)
        this.extractJsxAttributeReferences(n.attributes, calls, source);
      }
      else if (ts.isJsxOpeningElement(n)) {
        const call = this.extractJsxElement(n.tagName, n, source);
        if (call) {
          calls.push(call);
        }
        // Extract function references from JSX attributes (onClick={handleClick}, etc.)
        this.extractJsxAttributeReferences(n.attributes, calls, source);
      }

      ts.forEachChild(n, visit);
    };

    visit(node);
  }

  /**
   * Extract function references from JSX attributes
   * Handles patterns like: onClick={handleClick}, onSubmit={formHandler}, ref={myRef}
   */
  private extractJsxAttributeReferences(
    attributes: ts.JsxAttributes,
    calls: CallExtraction[],
    source: string
  ): void {
    for (const attr of attributes.properties) {
      if (ts.isJsxAttribute(attr) && attr.initializer) {
        // Check if it's an expression container: onClick={...}
        if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
          const expr = attr.initializer.expression;
          
          // Direct function reference: onClick={handleClick}
          if (ts.isIdentifier(expr)) {
            const pos = this.getPosition(expr.getStart(), source);
            calls.push(this.createCall({
              calleeName: expr.text,
              fullExpression: expr.text,
              line: pos.row + 1,
              column: pos.column,
              argumentCount: 0,
              isMethodCall: false,
              isConstructorCall: false,
            }));
          }
          // Property access: onClick={this.handleClick} or onClick={handlers.click}
          else if (ts.isPropertyAccessExpression(expr)) {
            const pos = this.getPosition(expr.getStart(), source);
            calls.push(this.createCall({
              calleeName: expr.name.text,
              receiver: expr.expression.getText(),
              fullExpression: expr.getText(),
              line: pos.row + 1,
              column: pos.column,
              argumentCount: 0,
              isMethodCall: true,
              isConstructorCall: false,
            }));
          }
        }
      }
    }
  }

  /**
   * Extract callback references from function call arguments
   * Handles patterns like: setTimeout(myFunc, 1000), arr.map(processItem), etc.
   */
  private extractCallbackReferences(
    callExpr: ts.CallExpression,
    calls: CallExtraction[],
    source: string
  ): void {
    for (const arg of callExpr.arguments) {
      // Direct function reference: setTimeout(myFunc, 1000)
      if (ts.isIdentifier(arg)) {
        const pos = this.getPosition(arg.getStart(), source);
        calls.push(this.createCall({
          calleeName: arg.text,
          fullExpression: arg.text,
          line: pos.row + 1,
          column: pos.column,
          argumentCount: 0,
          isMethodCall: false,
          isConstructorCall: false,
        }));
      }
      // Property access: obj.method passed as callback
      else if (ts.isPropertyAccessExpression(arg)) {
        const pos = this.getPosition(arg.getStart(), source);
        calls.push(this.createCall({
          calleeName: arg.name.text,
          receiver: arg.expression.getText(),
          fullExpression: arg.getText(),
          line: pos.row + 1,
          column: pos.column,
          argumentCount: 0,
          isMethodCall: true,
          isConstructorCall: false,
        }));
      }
    }
  }

  /**
   * Extract a call expression
   */
  private extractCallExpression(node: ts.CallExpression, source: string): CallExtraction | null {
    const pos = this.getPosition(node.getStart(), source);
    let calleeName: string;
    let receiver: string | undefined;
    let fullExpression: string;

    const expr = node.expression;

    // Method call: obj.method() or obj.prop.method()
    if (ts.isPropertyAccessExpression(expr)) {
      calleeName = expr.name.text;
      receiver = expr.expression.getText();
      fullExpression = expr.getText();
    }
    // Element access: obj['method']()
    else if (ts.isElementAccessExpression(expr)) {
      const arg = expr.argumentExpression;
      calleeName = ts.isStringLiteral(arg) ? arg.text : arg.getText();
      receiver = expr.expression.getText();
      fullExpression = expr.getText();
    }
    // Direct call: foo()
    else if (ts.isIdentifier(expr)) {
      calleeName = expr.text;
      fullExpression = expr.text;
    }
    // Other (call expression result, etc.)
    else {
      calleeName = expr.getText();
      fullExpression = expr.getText();
    }

    return this.createCall({
      calleeName,
      receiver,
      fullExpression,
      line: pos.row + 1,
      column: pos.column,
      argumentCount: node.arguments.length,
      isMethodCall: !!receiver,
      isConstructorCall: false,
    });
  }

  /**
   * Extract a new expression
   */
  private extractNewExpression(node: ts.NewExpression, source: string): CallExtraction | null {
    const pos = this.getPosition(node.getStart(), source);
    let calleeName: string;
    let receiver: string | undefined;

    const expr = node.expression;

    if (ts.isIdentifier(expr)) {
      calleeName = expr.text;
    } else if (ts.isPropertyAccessExpression(expr)) {
      calleeName = expr.name.text;
      receiver = expr.expression.getText();
    } else {
      calleeName = expr.getText();
    }

    return this.createCall({
      calleeName,
      receiver,
      fullExpression: node.getText(),
      line: pos.row + 1,
      column: pos.column,
      argumentCount: node.arguments?.length ?? 0,
      isMethodCall: false,
      isConstructorCall: true,
    });
  }

  /**
   * Extract a JSX element as a function call
   * <Component prop={value} /> is effectively Component({ prop: value })
   */
  private extractJsxElement(
    tagName: ts.JsxTagNameExpression,
    node: ts.Node,
    source: string
  ): CallExtraction | null {
    const pos = this.getPosition(node.getStart(), source);
    let calleeName: string;
    let receiver: string | undefined;

    // <Component /> - identifier
    if (ts.isIdentifier(tagName)) {
      calleeName = tagName.text;
      // Skip intrinsic HTML elements (lowercase) - only track component calls
      // React components must start with uppercase
      if (!calleeName || calleeName.charAt(0) === calleeName.charAt(0).toLowerCase()) {
        return null;
      }
    }
    // <Namespace.Component /> - property access
    else if (ts.isPropertyAccessExpression(tagName)) {
      calleeName = tagName.name.text;
      receiver = tagName.expression.getText();
    }
    // <this.component /> or other
    else {
      calleeName = tagName.getText();
    }

    return this.createCall({
      calleeName,
      receiver,
      fullExpression: `<${tagName.getText()} />`,
      line: pos.row + 1,
      column: pos.column,
      argumentCount: 1, // JSX props are like a single object argument
      isMethodCall: !!receiver,
      isConstructorCall: false,
    });
  }

  /**
   * Extract a function declaration
   */
  private extractFunctionDeclaration(
    node: ts.FunctionDeclaration,
    source: string,
    currentClass: string | null,
    parentFunction: string | null
  ): FunctionExtraction | null {
    if (!node.name) {return null;}

    const startPos = this.getPosition(node.getStart(), source);
    const endPos = this.getPosition(node.getEnd(), source);
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const name = node.name.text;
    
    // Build qualified name including parent function for nested functions
    let qualifiedName = name;
    if (parentFunction) {
      qualifiedName = `${parentFunction}.${name}`;
    } else if (currentClass) {
      qualifiedName = `${currentClass}.${name}`;
    }

    return this.createFunction({
      name,
      qualifiedName,
      startLine: startPos.row + 1,
      endLine: endPos.row + 1,
      startColumn: startPos.column,
      endColumn: endPos.column,
      parameters: this.extractParameters(node.parameters),
      returnType: node.type?.getText(),
      isMethod: false,
      isStatic: false,
      isExported: parentFunction ? false : this.hasExportModifier(node), // Nested functions can't be exported
      isConstructor: false,
      isAsync: modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
      className: currentClass ?? undefined,
      decorators: this.extractDecorators(node),
      bodyStartLine: node.body ? this.getPosition(node.body.getStart(), source).row + 1 : startPos.row + 1,
      bodyEndLine: node.body ? this.getPosition(node.body.getEnd(), source).row + 1 : endPos.row + 1,
    });
  }

  /**
   * Extract a variable function (arrow function or function expression)
   */
  private extractVariableFunction(
    statement: ts.VariableStatement,
    decl: ts.VariableDeclaration,
    source: string,
    parentFunction: string | null
  ): FunctionExtraction | null {
    if (!ts.isIdentifier(decl.name)) {return null;}

    const func = decl.initializer as ts.ArrowFunction | ts.FunctionExpression;
    const startPos = this.getPosition(statement.getStart(), source);
    const endPos = this.getPosition(statement.getEnd(), source);
    const modifiers = ts.canHaveModifiers(func) ? ts.getModifiers(func) : undefined;
    const name = decl.name.text;
    
    // Build qualified name including parent function for nested functions
    const qualifiedName = parentFunction ? `${parentFunction}.${name}` : name;

    return this.createFunction({
      name,
      qualifiedName,
      startLine: startPos.row + 1,
      endLine: endPos.row + 1,
      startColumn: startPos.column,
      endColumn: endPos.column,
      parameters: this.extractParameters(func.parameters),
      returnType: func.type?.getText(),
      isMethod: false,
      isStatic: false,
      isExported: parentFunction ? false : this.hasExportModifier(statement), // Nested functions can't be exported
      isConstructor: false,
      isAsync: modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
      decorators: [],
      bodyStartLine: this.getPosition(func.body.getStart(), source).row + 1,
      bodyEndLine: this.getPosition(func.body.getEnd(), source).row + 1,
    });
  }

  /**
   * Extract a method declaration
   */
  private extractMethodDeclaration(
    node: ts.MethodDeclaration,
    source: string,
    className: string
  ): FunctionExtraction | null {
    const name = ts.isIdentifier(node.name) ? node.name.text : node.name.getText();
    const startPos = this.getPosition(node.getStart(), source);
    const endPos = this.getPosition(node.getEnd(), source);
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;

    return this.createFunction({
      name,
      startLine: startPos.row + 1,
      endLine: endPos.row + 1,
      startColumn: startPos.column,
      endColumn: endPos.column,
      parameters: this.extractParameters(node.parameters),
      returnType: node.type?.getText(),
      isMethod: true,
      isStatic: modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false,
      isExported: false, // Methods inherit class export status
      isConstructor: false,
      isAsync: modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
      className,
      decorators: this.extractDecorators(node),
      bodyStartLine: node.body ? this.getPosition(node.body.getStart(), source).row + 1 : startPos.row + 1,
      bodyEndLine: node.body ? this.getPosition(node.body.getEnd(), source).row + 1 : endPos.row + 1,
    });
  }

  /**
   * Extract a constructor
   */
  private extractConstructor(
    node: ts.ConstructorDeclaration,
    source: string,
    className: string
  ): FunctionExtraction {
    const startPos = this.getPosition(node.getStart(), source);
    const endPos = this.getPosition(node.getEnd(), source);

    return this.createFunction({
      name: 'constructor',
      startLine: startPos.row + 1,
      endLine: endPos.row + 1,
      startColumn: startPos.column,
      endColumn: endPos.column,
      parameters: this.extractParameters(node.parameters),
      isMethod: true,
      isStatic: false,
      isExported: false,
      isConstructor: true,
      isAsync: false,
      className,
      decorators: [],
      bodyStartLine: node.body ? this.getPosition(node.body.getStart(), source).row + 1 : startPos.row + 1,
      bodyEndLine: node.body ? this.getPosition(node.body.getEnd(), source).row + 1 : endPos.row + 1,
    });
  }

  /**
   * Extract a class declaration
   */
  private extractClassDeclaration(node: ts.ClassDeclaration, source: string): ClassExtraction {
    const name = node.name?.text ?? 'anonymous';
    const startPos = this.getPosition(node.getStart(), source);
    const endPos = this.getPosition(node.getEnd(), source);

    const baseClasses: string[] = [];
    if (node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          for (const type of clause.types) {
            if (ts.isIdentifier(type.expression)) {
              baseClasses.push(type.expression.text);
            }
          }
        }
      }
    }

    const methods: string[] = [];
    for (const member of node.members) {
      if (ts.isMethodDeclaration(member) && member.name) {
        methods.push(ts.isIdentifier(member.name) ? member.name.text : member.name.getText());
      } else if (ts.isConstructorDeclaration(member)) {
        methods.push('constructor');
      }
    }

    return this.createClass({
      name,
      startLine: startPos.row + 1,
      endLine: endPos.row + 1,
      baseClasses,
      methods,
      isExported: this.hasExportModifier(node),
    });
  }

  /**
   * Extract an import declaration
   */
  private extractImportDeclaration(node: ts.ImportDeclaration, source: string): ImportExtraction | null {
    const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
    const pos = this.getPosition(node.getStart(), source);
    const isTypeOnly = node.importClause?.isTypeOnly ?? false;

    const names: ImportExtraction['names'] = [];
    const importClause = node.importClause;

    if (importClause) {
      // Default import
      if (importClause.name) {
        names.push({
          imported: 'default',
          local: importClause.name.text,
          isDefault: true,
          isNamespace: false,
        });
      }

      // Named or namespace imports
      const namedBindings = importClause.namedBindings;
      if (namedBindings) {
        if (ts.isNamespaceImport(namedBindings)) {
          names.push({
            imported: '*',
            local: namedBindings.name.text,
            isDefault: false,
            isNamespace: true,
          });
        } else if (ts.isNamedImports(namedBindings)) {
          for (const element of namedBindings.elements) {
            names.push({
              imported: element.propertyName?.text ?? element.name.text,
              local: element.name.text,
              isDefault: false,
              isNamespace: false,
            });
          }
        }
      }
    }

    return this.createImport({
      source: moduleSpecifier,
      names,
      line: pos.row + 1,
      isTypeOnly,
    });
  }

  /**
   * Extract export declarations
   */
  private extractExportDeclaration(node: ts.ExportDeclaration, source: string): ImportExtraction['names'] extends infer _ ? import('../types.js').ExportExtraction[] : never {
    const pos = this.getPosition(node.getStart(), source);
    const moduleSpecifier = node.moduleSpecifier ? (node.moduleSpecifier as ts.StringLiteral).text : undefined;
    const exports: import('../types.js').ExportExtraction[] = [];

    if (!node.exportClause) {
      // export * from './foo'
      exports.push(this.createExport({
        name: '*',
        isReExport: true,
        source: moduleSpecifier,
        line: pos.row + 1,
      }));
    } else if (ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        exports.push(this.createExport({
          name: element.name.text,
          isReExport: !!moduleSpecifier,
          source: moduleSpecifier,
          line: pos.row + 1,
        }));
      }
    }

    return exports;
  }

  /**
   * Extract exported declaration
   */
  private extractExportedDeclaration(node: ts.Node, source: string): import('../types.js').ExportExtraction | null {
    const pos = this.getPosition(node.getStart(), source);
    let name: string | null = null;
    const isDefault = this.hasDefaultModifier(node);

    if (ts.isFunctionDeclaration(node) && node.name) {
      name = node.name.text;
    } else if (ts.isClassDeclaration(node) && node.name) {
      name = node.name.text;
    } else if (ts.isVariableStatement(node)) {
      const firstDecl = node.declarationList.declarations[0];
      if (firstDecl && ts.isIdentifier(firstDecl.name)) {
        name = firstDecl.name.text;
      }
    }

    if (!name) {return null;}

    return this.createExport({
      name,
      isDefault,
      line: pos.row + 1,
    });
  }

  /**
   * Extract parameters from a parameter list
   */
  private extractParameters(params: ts.NodeArray<ts.ParameterDeclaration>): ParameterInfo[] {
    return params.map((param) => {
      const name = ts.isIdentifier(param.name) ? param.name.text : param.name.getText();
      return this.parseParameter(
        name,
        param.type?.getText(),
        param.initializer !== undefined,
        param.dotDotDotToken !== undefined
      );
    });
  }

  /**
   * Extract decorators from a node
   */
  private extractDecorators(node: ts.Node): string[] {
    const decorators: string[] = [];
    const modifiers = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;

    if (modifiers) {
      for (const decorator of modifiers) {
        decorators.push(decorator.expression.getText());
      }
    }

    return decorators;
  }

  /**
   * Check if node has export modifier
   */
  private hasExportModifier(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }

  /**
   * Check if node has default modifier
   */
  private hasDefaultModifier(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
  }

  /**
   * Get script kind from file path
   */
  private getScriptKind(filePath: string): ts.ScriptKind {
    const ext = filePath.toLowerCase().split('.').pop();
    switch (ext) {
      case 'tsx': return ts.ScriptKind.TSX;
      case 'jsx': return ts.ScriptKind.JSX;
      case 'js':
      case 'mjs':
      case 'cjs': return ts.ScriptKind.JS;
      default: return ts.ScriptKind.TS;
    }
  }

  /**
   * Get language from file path
   */
  private getLanguageFromPath(filePath: string): CallGraphLanguage {
    const ext = filePath.toLowerCase().split('.').pop();
    if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') {
      return 'javascript';
    }
    return 'typescript';
  }

  /**
   * Convert offset to position
   */
  private getPosition(offset: number, source: string): { row: number; column: number } {
    let row = 0;
    let column = 0;

    for (let i = 0; i < offset && i < source.length; i++) {
      if (source[i] === '\n') {
        row++;
        column = 0;
      } else {
        column++;
      }
    }

    return { row, column };
  }
}
