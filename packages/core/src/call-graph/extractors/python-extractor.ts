/**
 * Python Call Graph Extractor
 *
 * Extracts functions, calls, imports, and exports from Python
 * using tree-sitter for AST parsing.
 * 
 * Handles:
 * - Function definitions (def, async def)
 * - Nested functions (closures)
 * - Class methods and static methods
 * - Module-level calls (top-level code)
 * - Callback patterns (functions passed as arguments)
 * - Dependency injection (FastAPI Depends, etc.)
 * - Lambda expressions
 */

import { BaseCallGraphExtractor } from './base-extractor.js';
import { isTreeSitterAvailable, createPythonParser } from '../../parsers/tree-sitter/loader.js';

import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type {
  CallGraphLanguage,
  FileExtractionResult,
  ImportExtraction,
  ParameterInfo,
  CallExtraction,
} from '../types.js';

/**
 * Python call graph extractor using tree-sitter
 */
export class PythonCallGraphExtractor extends BaseCallGraphExtractor {
  readonly language: CallGraphLanguage = 'python';
  readonly extensions: string[] = ['.py', '.pyw', '.pyi'];

  private parser: TreeSitterParser | null = null;

  /**
   * Check if tree-sitter is available
   */
  static isAvailable(): boolean {
    return isTreeSitterAvailable();
  }

  /**
   * Extract call graph information from Python source
   */
  extract(source: string, filePath: string): FileExtractionResult {
    const result = this.createEmptyResult(filePath);

    if (!isTreeSitterAvailable()) {
      result.errors.push('Tree-sitter not available for Python parsing');
      return result;
    }

    try {
      if (!this.parser) {
        this.parser = createPythonParser();
      }

      const tree = this.parser.parse(source);
      this.visitNode(tree.rootNode, result, source, null, null);
      
      // Extract module-level calls (top-level code not inside any function)
      this.extractModuleLevelCalls(tree.rootNode, result, source);

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Extract calls at module level (not inside any function or class)
   * This catches patterns like: app = FastAPI(), if __name__ == "__main__": main()
   */
  private extractModuleLevelCalls(
    rootNode: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const moduleCalls: CallExtraction[] = [];
    
    for (const child of rootNode.children) {
      // Skip function and class definitions
      if (child.type === 'function_definition' || child.type === 'class_definition') {
        continue;
      }
      
      // Skip import statements
      if (child.type === 'import_statement' || child.type === 'import_from_statement') {
        continue;
      }
      
      // Extract calls from expression statements, assignments, if statements, etc.
      this.extractCallsRecursive(child, moduleCalls, source);
    }
    
    // Add module-level calls to result
    result.calls.push(...moduleCalls);
    
    // If there are module-level calls, create a synthetic module function
    if (moduleCalls.length > 0) {
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
   * Recursively extract calls from a node (for module-level code)
   */
  private extractCallsRecursive(
    node: TreeSitterNode,
    calls: CallExtraction[],
    source: string
  ): void {
    if (node.type === 'call') {
      const call = this.extractCallExpressionToArray(node, source);
      if (call) {
        calls.push(...call);
      }
    }
    
    // Don't recurse into function or class definitions
    if (node.type === 'function_definition' || node.type === 'class_definition') {
      return;
    }
    
    for (const child of node.children) {
      this.extractCallsRecursive(child, calls, source);
    }
  }

  /**
   * Visit a tree-sitter node and extract information
   * @param parentFunction - The name of the containing function (for nested functions)
   */
  private visitNode(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentClass: string | null,
    parentFunction: string | null
  ): void {
    switch (node.type) {
      case 'function_definition':
        this.extractFunctionDefinition(node, result, source, currentClass, parentFunction);
        break;

      case 'class_definition':
        this.extractClassDefinition(node, result, source);
        break;

      case 'import_statement':
        this.extractImportStatement(node, result);
        break;

      case 'import_from_statement':
        this.extractImportFromStatement(node, result);
        break;

      case 'call':
        this.extractCallExpression(node, result, source);
        break;

      default:
        // Recurse into children
        for (const child of node.children) {
          this.visitNode(child, result, source, currentClass, parentFunction);
        }
    }
  }

  /**
   * Extract a function definition
   */
  private extractFunctionDefinition(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentClass: string | null,
    parentFunction: string | null
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;
    const isMethod = currentClass !== null;
    const isConstructor = name === '__init__';

    // Get decorators
    const decorators: string[] = [];
    let prevSibling = node.previousNamedSibling;
    while (prevSibling?.type === 'decorator') {
      decorators.unshift(prevSibling.text);
      prevSibling = prevSibling.previousNamedSibling;
    }

    // Check for async
    const isAsync = node.children.some(c => c.type === 'async');

    // Check for staticmethod/classmethod decorators
    const isStatic = decorators.some(d => d.includes('@staticmethod') || d.includes('@classmethod'));

    // Extract parameters
    const parametersNode = node.childForFieldName('parameters');
    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];

    // Get return type
    const returnTypeNode = node.childForFieldName('return_type');
    const returnType = returnTypeNode?.text;

    // Get body for line range
    const bodyNode = node.childForFieldName('body');

    // Build qualified name including parent function for nested functions
    let qualifiedName = name;
    if (parentFunction) {
      qualifiedName = `${parentFunction}.${name}`;
    } else if (currentClass) {
      qualifiedName = `${currentClass}.${name}`;
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
      isMethod,
      isStatic,
      isExported: parentFunction ? false : (!name.startsWith('_') || name.startsWith('__') && name.endsWith('__')),
      isConstructor,
      isAsync,
      className: currentClass ?? undefined,
      decorators,
      bodyStartLine: bodyNode ? bodyNode.startPosition.row + 1 : node.startPosition.row + 1,
      bodyEndLine: bodyNode ? bodyNode.endPosition.row + 1 : node.endPosition.row + 1,
    });

    result.functions.push(func);

    // Extract calls from parameter default values (for DI patterns like Depends(get_current_user))
    if (parametersNode) {
      this.extractCallsFromParameters(parametersNode, result, source);
    }

    // Extract calls from function body and nested functions
    if (bodyNode) {
      this.extractCallsFromBody(bodyNode, result, source);
      
      // Extract nested functions
      this.extractNestedFunctions(bodyNode, result, source, currentClass, qualifiedName);
    }
  }

  /**
   * Extract nested functions from a function body
   */
  private extractNestedFunctions(
    bodyNode: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentClass: string | null,
    parentFunctionName: string
  ): void {
    for (const child of bodyNode.children) {
      if (child.type === 'function_definition') {
        this.extractFunctionDefinition(child, result, source, currentClass, parentFunctionName);
      }
      // Also check for nested functions in if/else/for/while/with blocks
      else if (['if_statement', 'for_statement', 'while_statement', 'with_statement', 'try_statement'].includes(child.type)) {
        this.extractNestedFunctionsRecursive(child, result, source, currentClass, parentFunctionName);
      }
    }
  }

  /**
   * Recursively extract nested functions from control flow blocks
   */
  private extractNestedFunctionsRecursive(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string,
    currentClass: string | null,
    parentFunctionName: string
  ): void {
    for (const child of node.children) {
      if (child.type === 'function_definition') {
        this.extractFunctionDefinition(child, result, source, currentClass, parentFunctionName);
      } else if (child.type === 'block') {
        this.extractNestedFunctions(child, result, source, currentClass, parentFunctionName);
      } else {
        this.extractNestedFunctionsRecursive(child, result, source, currentClass, parentFunctionName);
      }
    }
  }

  /**
   * Extract calls from parameter default values (for DI patterns)
   */
  private extractCallsFromParameters(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const visit = (n: TreeSitterNode): void => {
      if (n.type === 'call') {
        this.extractCallExpression(n, result, source);
      }
      for (const child of n.children) {
        visit(child);
      }
    };

    for (const child of node.children) {
      // Look for default_parameter and typed_default_parameter
      if (child.type === 'default_parameter' || child.type === 'typed_default_parameter') {
        const valueNode = child.childForFieldName('value');
        if (valueNode) {
          visit(valueNode);
        }
      }
    }
  }

  /**
   * Extract a call expression and return as array (for module-level calls)
   */
  private extractCallExpressionToArray(
    node: TreeSitterNode,
    _source: string
  ): CallExtraction[] | null {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) {return null;}

    const calls: CallExtraction[] = [];
    let calleeName: string;
    let receiver: string | undefined;
    let fullExpression = funcNode.text;
    let isConstructorCall = false;

    // Attribute access: obj.method() or module.func()
    if (funcNode.type === 'attribute') {
      const objectNode = funcNode.childForFieldName('object');
      const attrNode = funcNode.childForFieldName('attribute');
      if (objectNode && attrNode) {
        receiver = objectNode.text;
        calleeName = attrNode.text;
      } else {
        calleeName = funcNode.text;
      }
    }
    // Direct call: func()
    else if (funcNode.type === 'identifier') {
      calleeName = funcNode.text;
      isConstructorCall = /^[A-Z]/.test(calleeName);
    }
    else {
      calleeName = funcNode.text;
    }

    fullExpression = node.text;

    const argsNode = node.childForFieldName('arguments');
    let argumentCount = 0;
    const functionRefs: string[] = [];
    
    if (argsNode) {
      for (const child of argsNode.children) {
        if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
          argumentCount++;
          
          if (child.type === 'identifier') {
            const argName = child.text;
            if (!['True', 'False', 'None', 'self', 'cls'].includes(argName)) {
              functionRefs.push(argName);
            }
          }
          else if (child.type === 'keyword_argument') {
            const valueNode = child.childForFieldName('value');
            if (valueNode?.type === 'identifier') {
              const argName = valueNode.text;
              if (!['True', 'False', 'None', 'self', 'cls'].includes(argName)) {
                functionRefs.push(argName);
              }
            }
          }
        }
      }
    }

    calls.push(this.createCall({
      calleeName,
      receiver,
      fullExpression,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      argumentCount,
      isMethodCall: !!receiver,
      isConstructorCall,
    }));

    // For DI patterns, also create implicit calls
    if (calleeName === 'Depends' || calleeName === 'inject' || calleeName === 'Inject') {
      for (const funcRef of functionRefs) {
        calls.push(this.createCall({
          calleeName: funcRef,
          receiver: undefined,
          fullExpression: `${calleeName}(${funcRef})`,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          argumentCount: 0,
          isMethodCall: false,
          isConstructorCall: /^[A-Z]/.test(funcRef),
        }));
      }
    }

    return calls;
  }

  /**
   * Extract calls from a function body
   * Also extracts callback patterns where functions are passed as arguments
   */
  private extractCallsFromBody(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const visit = (n: TreeSitterNode): void => {
      if (n.type === 'call') {
        this.extractCallExpression(n, result, source);
        // Also extract callback references
        this.extractCallbackReferences(n, result, source);
      }
      // Don't recurse into nested function definitions (they're handled separately)
      if (n.type !== 'function_definition' && n.type !== 'class_definition') {
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
   * Extract callback references from function call arguments
   * Handles patterns like: map(process_item, items), threading.Thread(target=my_func)
   */
  private extractCallbackReferences(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) {return;}

    for (const child of argsNode.children) {
      // Direct function reference passed as argument
      if (child.type === 'identifier') {
        const argName = child.text;
        // Skip common non-function arguments
        if (!['True', 'False', 'None', 'self', 'cls'].includes(argName) && 
            !/^[A-Z]/.test(argName)) { // Skip class names (handled as constructor calls)
          result.calls.push(this.createCall({
            calleeName: argName,
            receiver: undefined,
            fullExpression: argName,
            line: child.startPosition.row + 1,
            column: child.startPosition.column,
            argumentCount: 0,
            isMethodCall: false,
            isConstructorCall: false,
          }));
        }
      }
      // Keyword argument with function reference: target=my_func
      else if (child.type === 'keyword_argument') {
        const keyNode = child.childForFieldName('name');
        const valueNode = child.childForFieldName('value');
        // Common callback keyword arguments
        const callbackKeywords = ['target', 'callback', 'func', 'function', 'handler', 'key', 'default'];
        if (keyNode && valueNode?.type === 'identifier' && 
            callbackKeywords.includes(keyNode.text)) {
          const argName = valueNode.text;
          if (!['True', 'False', 'None', 'self', 'cls'].includes(argName)) {
            result.calls.push(this.createCall({
              calleeName: argName,
              receiver: undefined,
              fullExpression: `${keyNode.text}=${argName}`,
              line: valueNode.startPosition.row + 1,
              column: valueNode.startPosition.column,
              argumentCount: 0,
              isMethodCall: false,
              isConstructorCall: false,
            }));
          }
        }
      }
    }
  }

  /**
   * Extract a call expression
   */
  private extractCallExpression(
    node: TreeSitterNode,
    result: FileExtractionResult,
    _source: string
  ): void {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) {return;}

    let calleeName: string;
    let receiver: string | undefined;
    let fullExpression = funcNode.text;
    let isConstructorCall = false;

    // Attribute access: obj.method() or module.func()
    if (funcNode.type === 'attribute') {
      const objectNode = funcNode.childForFieldName('object');
      const attrNode = funcNode.childForFieldName('attribute');
      if (objectNode && attrNode) {
        receiver = objectNode.text;
        calleeName = attrNode.text;
      } else {
        calleeName = funcNode.text;
      }
    }
    // Direct call: func()
    else if (funcNode.type === 'identifier') {
      calleeName = funcNode.text;
      // Check if it looks like a class instantiation (PascalCase)
      isConstructorCall = /^[A-Z]/.test(calleeName);
    }
    // Other (subscript, call result, etc.)
    else {
      calleeName = funcNode.text;
    }

    // Get full expression including arguments for DI pattern detection
    fullExpression = node.text;

    // Count arguments and extract function references
    const argsNode = node.childForFieldName('arguments');
    let argumentCount = 0;
    const functionRefs: string[] = [];
    
    if (argsNode) {
      for (const child of argsNode.children) {
        if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
          argumentCount++;
          
          // Check if argument is a function reference (identifier that's not a keyword)
          if (child.type === 'identifier') {
            const argName = child.text;
            // Skip common non-function arguments
            if (!['True', 'False', 'None', 'self', 'cls'].includes(argName)) {
              functionRefs.push(argName);
            }
          }
          // Check for keyword argument with function reference: Depends(get_current_user)
          else if (child.type === 'keyword_argument') {
            const valueNode = child.childForFieldName('value');
            if (valueNode?.type === 'identifier') {
              const argName = valueNode.text;
              if (!['True', 'False', 'None', 'self', 'cls'].includes(argName)) {
                functionRefs.push(argName);
              }
            }
          }
        }
      }
    }

    const call = this.createCall({
      calleeName,
      receiver,
      fullExpression,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      argumentCount,
      isMethodCall: !!receiver,
      isConstructorCall,
    });

    result.calls.push(call);

    // For DI patterns like Depends(func), also create implicit calls to the referenced functions
    // This helps the call graph understand that the route handler "calls" the dependency
    if (calleeName === 'Depends' || calleeName === 'inject' || calleeName === 'Inject') {
      for (const funcRef of functionRefs) {
        const implicitCall = this.createCall({
          calleeName: funcRef,
          receiver: undefined,
          fullExpression: `${calleeName}(${funcRef})`,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          argumentCount: 0,
          isMethodCall: false,
          isConstructorCall: /^[A-Z]/.test(funcRef),
        });
        result.calls.push(implicitCall);
      }
    }
  }

  /**
   * Extract a class definition
   */
  private extractClassDefinition(
    node: TreeSitterNode,
    result: FileExtractionResult,
    source: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const name = nameNode.text;

    // Get base classes
    const baseClasses: string[] = [];
    const superclassNode = node.childForFieldName('superclasses');
    if (superclassNode) {
      for (const child of superclassNode.children) {
        if (child.type === 'identifier' || child.type === 'attribute') {
          baseClasses.push(child.text);
        }
      }
    }

    // Get methods
    const methods: string[] = [];
    const bodyNode = node.childForFieldName('body');
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'function_definition') {
          const methodNameNode = child.childForFieldName('name');
          if (methodNameNode) {
            methods.push(methodNameNode.text);
          }
        }
      }
    }

    const classInfo = this.createClass({
      name,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      baseClasses,
      methods,
      isExported: !name.startsWith('_'),
    });

    result.classes.push(classInfo);

    // Visit class body with class context
    if (bodyNode) {
      for (const child of bodyNode.children) {
        this.visitNode(child, result, source, name, null);
      }
    }
  }

  /**
   * Extract an import statement (import foo, import foo.bar)
   */
  private extractImportStatement(
    node: TreeSitterNode,
    result: FileExtractionResult
  ): void {
    for (const child of node.children) {
      if (child.type === 'dotted_name') {
        const moduleName = child.text;
        result.imports.push(this.createImport({
          source: moduleName,
          names: [{
            imported: moduleName,
            local: moduleName.split('.').pop() ?? moduleName,
          }],
          line: node.startPosition.row + 1,
        }));
      } else if (child.type === 'aliased_import') {
        const nameNode = child.childForFieldName('name');
        const aliasNode = child.childForFieldName('alias');
        if (nameNode) {
          const moduleName = nameNode.text;
          result.imports.push(this.createImport({
            source: moduleName,
            names: [{
              imported: moduleName,
              local: aliasNode?.text ?? moduleName.split('.').pop() ?? moduleName,
            }],
            line: node.startPosition.row + 1,
          }));
        }
      }
    }
  }

  /**
   * Extract a from...import statement
   */
  private extractImportFromStatement(
    node: TreeSitterNode,
    result: FileExtractionResult
  ): void {
    const moduleNode = node.childForFieldName('module_name');
    const moduleName = moduleNode?.text ?? '';

    const names: ImportExtraction['names'] = [];

    for (const child of node.children) {
      if (child.type === 'dotted_name' && child !== moduleNode) {
        names.push({
          imported: child.text,
          local: child.text,
          isDefault: false,
          isNamespace: false,
        });
      } else if (child.type === 'aliased_import') {
        const nameNode = child.childForFieldName('name');
        const aliasNode = child.childForFieldName('alias');
        if (nameNode) {
          names.push({
            imported: nameNode.text,
            local: aliasNode?.text ?? nameNode.text,
            isDefault: false,
            isNamespace: false,
          });
        }
      } else if (child.type === 'wildcard_import') {
        names.push({
          imported: '*',
          local: '*',
          isDefault: false,
          isNamespace: true,
        });
      }
    }

    if (names.length > 0) {
      result.imports.push(this.createImport({
        source: moduleName,
        names,
        line: node.startPosition.row + 1,
      }));
    }
  }

  /**
   * Extract parameters from a parameters node
   */
  private extractParameters(node: TreeSitterNode): ParameterInfo[] {
    const params: ParameterInfo[] = [];

    for (const child of node.children) {
      if (child.type === 'identifier') {
        // Skip 'self' and 'cls' for methods
        if (child.text !== 'self' && child.text !== 'cls') {
          params.push(this.parseParameter(child.text));
        }
      } else if (child.type === 'typed_parameter') {
        const nameNode = child.children.find(c => c.type === 'identifier');
        const typeNode = child.childForFieldName('type');
        if (nameNode && nameNode.text !== 'self' && nameNode.text !== 'cls') {
          params.push(this.parseParameter(nameNode.text, typeNode?.text));
        }
      } else if (child.type === 'default_parameter') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');
        if (nameNode && nameNode.text !== 'self' && nameNode.text !== 'cls') {
          params.push(this.parseParameter(nameNode.text, typeNode?.text, true));
        }
      } else if (child.type === 'typed_default_parameter') {
        const nameNode = child.childForFieldName('name');
        const typeNode = child.childForFieldName('type');
        if (nameNode && nameNode.text !== 'self' && nameNode.text !== 'cls') {
          params.push(this.parseParameter(nameNode.text, typeNode?.text, true));
        }
      } else if (child.type === 'list_splat_pattern' || child.type === 'dictionary_splat_pattern') {
        const nameNode = child.children.find(c => c.type === 'identifier');
        if (nameNode) {
          params.push(this.parseParameter(nameNode.text, undefined, false, true));
        }
      }
    }

    return params;
  }
}
