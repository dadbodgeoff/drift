/**
 * Semantic Analyzer - Symbol resolution and scope analysis
 *
 * Provides symbol resolution, scope analysis, symbol table construction,
 * detection of unresolved references, and detection of shadowed variables.
 * Supports TypeScript/JavaScript scope rules.
 *
 * @requirements 3.5 - Parser SHALL provide a unified AST query interface across all languages
 */

import type {
  SemanticAnalysisResult,
  SymbolInfo,
  SymbolKind,
  SymbolVisibility,
  SymbolReference,
  ReferenceKind,
  ScopeInfo,
  ScopeKind,
  ShadowedVariable,
  SourceLocation,
  ParameterInfo,
} from './types.js';
import type { AST, ASTNode } from '../parsers/types.js';

/**
 * Options for semantic analysis
 */
export interface SemanticAnalysisOptions {
  /** Whether to track all references to symbols */
  trackReferences?: boolean;

  /** Whether to detect shadowed variables */
  detectShadowing?: boolean;

  /** Whether to include built-in symbols (console, window, etc.) */
  includeBuiltins?: boolean;

  /** Maximum depth for scope analysis */
  maxScopeDepth?: number;
}

/**
 * Built-in global symbols for JavaScript/TypeScript
 */
const BUILTIN_GLOBALS = new Set([
  // Global objects
  'globalThis', 'window', 'self', 'global',
  // Console
  'console',
  // Timers
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate',
  // Encoding
  'atob', 'btoa',
  // Fetch API
  'fetch', 'Request', 'Response', 'Headers',
  // URL
  'URL', 'URLSearchParams',
  // Events
  'Event', 'CustomEvent', 'EventTarget',
  // DOM (browser)
  'document', 'navigator', 'location', 'history',
  // Node.js
  'process', 'Buffer', '__dirname', '__filename', 'module', 'exports', 'require',
  // Built-in constructors
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Function', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError',
  'SyntaxError', 'ReferenceError', 'EvalError', 'URIError',
  'Map', 'Set', 'WeakMap', 'WeakSet',
  'Promise', 'Proxy', 'Reflect',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  // Built-in functions
  'eval', 'isFinite', 'isNaN', 'parseFloat', 'parseInt',
  'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent',
  // Math and JSON
  'Math', 'JSON', 'Intl',
  // TypeScript
  'undefined', 'NaN', 'Infinity',
]);

/**
 * Internal scope representation during analysis
 */
interface InternalScope {
  id: string;
  kind: ScopeKind;
  parentId: string | null;
  childIds: string[];
  symbols: Map<string, SymbolInfo>;
  location: SourceLocation;
  depth: number;
}

/**
 * Semantic Analyzer class for symbol resolution and scope analysis.
 *
 * Provides a unified interface for analyzing semantic information across
 * TypeScript and JavaScript code.
 *
 * @requirements 3.5 - Unified AST query interface across all languages
 */
export class SemanticAnalyzer {
  /** Counter for generating unique scope IDs */
  private scopeIdCounter = 0;

  /** All scopes discovered during analysis */
  private scopes: Map<string, InternalScope> = new Map();

  /** Global symbol table */
  private symbolTable: Map<string, SymbolInfo> = new Map();

  /** Unresolved references found during analysis */
  private unresolvedReferences: SymbolReference[] = [];

  /** Shadowed variables found during analysis */
  private shadowedVariables: ShadowedVariable[] = [];

  /** Current analysis options */
  private options: SemanticAnalysisOptions = {};

  /**
   * Analyze an AST and produce semantic analysis results.
   *
   * @param ast - The AST to analyze
   * @param options - Analysis options
   * @returns Semantic analysis result
   */
  analyze(ast: AST, options: SemanticAnalysisOptions = {}): SemanticAnalysisResult {
    // Reset state for fresh analysis
    this.reset();
    this.options = options;

    // Create global scope
    const globalScope = this.createScope('global', null, {
      start: ast.rootNode.startPosition,
      end: ast.rootNode.endPosition,
    });

    // Add built-in symbols if requested
    if (options.includeBuiltins !== false) {
      this.addBuiltinSymbols(globalScope);
    }

    // First pass: collect all declarations and build scope tree
    this.collectDeclarations(ast.rootNode, globalScope.id);

    // Second pass: resolve references
    if (options.trackReferences !== false) {
      this.resolveReferences(ast.rootNode, globalScope.id);
    }

    // Build result
    return this.buildResult();
  }

  /**
   * Resolve a symbol reference to its definition.
   *
   * @param name - The symbol name to resolve
   * @param scopeId - The scope to start resolution from
   * @returns The resolved symbol info, or null if not found
   */
  resolveSymbol(name: string, scopeId: string): SymbolInfo | null {
    let currentScopeId: string | null = scopeId;

    while (currentScopeId !== null) {
      const scope = this.scopes.get(currentScopeId);
      if (!scope) {break;}

      const symbol = scope.symbols.get(name);
      if (symbol) {
        return symbol;
      }

      currentScopeId = scope.parentId;
    }

    return null;
  }

  /**
   * Get all symbols visible from a given scope.
   *
   * @param scopeId - The scope to get visible symbols from
   * @returns Map of symbol names to symbol info
   */
  getVisibleSymbols(scopeId: string): Map<string, SymbolInfo> {
    const visible = new Map<string, SymbolInfo>();
    let currentScopeId: string | null = scopeId;

    while (currentScopeId !== null) {
      const scope = this.scopes.get(currentScopeId);
      if (!scope) {break;}

      // Add symbols from this scope (don't override closer scopes)
      for (const [name, symbol] of scope.symbols) {
        if (!visible.has(name)) {
          visible.set(name, symbol);
        }
      }

      currentScopeId = scope.parentId;
    }

    return visible;
  }

  /**
   * Get the scope containing a specific position.
   *
   * @param position - The position to find scope for
   * @returns The most specific scope at that position, or null
   */
  getScopeAtPosition(position: { row: number; column: number }): ScopeInfo | null {
    let result: InternalScope | null = null;

    for (const scope of this.scopes.values()) {
      if (this.positionInRange(position, scope.location.start, scope.location.end)) {
        // Keep the most specific (deepest) scope
        if (!result || scope.depth > result.depth) {
          result = scope;
        }
      }
    }

    return result ? this.toScopeInfo(result) : null;
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Reset analyzer state for fresh analysis.
   */
  private reset(): void {
    this.scopeIdCounter = 0;
    this.scopes.clear();
    this.symbolTable.clear();
    this.unresolvedReferences = [];
    this.shadowedVariables = [];
    this.options = {};
  }

  /**
   * Create a new scope.
   */
  private createScope(
    kind: ScopeKind,
    parentId: string | null,
    location: SourceLocation
  ): InternalScope {
    const id = `scope_${this.scopeIdCounter++}`;
    const parentScope = parentId ? this.scopes.get(parentId) : null;
    const depth = parentScope ? parentScope.depth + 1 : 0;

    const scope: InternalScope = {
      id,
      kind,
      parentId,
      childIds: [],
      symbols: new Map(),
      location,
      depth,
    };

    this.scopes.set(id, scope);

    // Add to parent's children
    if (parentScope) {
      parentScope.childIds.push(id);
    }

    return scope;
  }

  /**
   * Add built-in global symbols.
   */
  private addBuiltinSymbols(globalScope: InternalScope): void {
    for (const name of BUILTIN_GLOBALS) {
      const symbol = this.createSymbol(name, 'variable', globalScope.id, {
        start: { row: 0, column: 0 },
        end: { row: 0, column: 0 },
      });
      symbol.visibility = 'public';
      symbol.isExported = false;
      symbol.isImported = false;
      globalScope.symbols.set(name, symbol);
    }
  }

  /**
   * Create a new symbol.
   */
  private createSymbol(
    name: string,
    kind: SymbolKind,
    scopeId: string,
    location: SourceLocation
  ): SymbolInfo {
    return {
      name,
      kind,
      location,
      scopeId,
      visibility: 'default',
      isExported: false,
      isImported: false,
      references: [],
    };
  }

  /**
   * Add a symbol to a scope, checking for shadowing.
   */
  private addSymbolToScope(
    symbol: SymbolInfo,
    scopeId: string
  ): void {
    const scope = this.scopes.get(scopeId);
    if (!scope) {return;}

    // Check for shadowing in parent scopes
    if (this.options.detectShadowing !== false) {
      const existingSymbol = this.resolveSymbol(symbol.name, scope.parentId || '');
      if (existingSymbol && existingSymbol.scopeId !== scopeId) {
        this.shadowedVariables.push({
          name: symbol.name,
          shadowLocation: symbol.location,
          originalLocation: existingSymbol.location,
        });
      }
    }

    // Check for redeclaration in same scope (for let/const)
    const existingInScope = scope.symbols.get(symbol.name);
    if (existingInScope) {
      // This is a redeclaration - could be an error depending on context
      // For now, we just update the symbol
    }

    scope.symbols.set(symbol.name, symbol);
    this.symbolTable.set(`${scopeId}:${symbol.name}`, symbol);
  }

  /**
   * Collect declarations from AST nodes.
   */
  private collectDeclarations(node: ASTNode, scopeId: string): void {
    const nodeType = node.type;

    // Check max depth
    const scope = this.scopes.get(scopeId);
    if (scope && this.options.maxScopeDepth !== undefined &&
        scope.depth >= this.options.maxScopeDepth) {
      return;
    }

    // Handle different declaration types
    switch (nodeType) {
      case 'program':
      case 'Program':
        // Module scope (treat as global for now)
        this.collectChildDeclarations(node, scopeId);
        break;

      case 'function_declaration':
      case 'FunctionDeclaration':
        this.collectFunctionDeclaration(node, scopeId);
        break;

      case 'arrow_function':
      case 'ArrowFunctionExpression':
        this.collectArrowFunction(node, scopeId);
        break;

      case 'method_definition':
      case 'MethodDefinition':
        this.collectMethodDefinition(node, scopeId);
        break;

      case 'class_declaration':
      case 'ClassDeclaration':
        this.collectClassDeclaration(node, scopeId);
        break;

      case 'variable_declaration':
      case 'VariableDeclaration':
      case 'lexical_declaration':
        this.collectVariableDeclaration(node, scopeId);
        break;

      case 'import_statement':
      case 'ImportDeclaration':
        this.collectImportDeclaration(node, scopeId);
        break;

      case 'export_statement':
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
        this.collectExportDeclaration(node, scopeId);
        break;

      case 'interface_declaration':
      case 'TSInterfaceDeclaration':
        this.collectInterfaceDeclaration(node, scopeId);
        break;

      case 'type_alias_declaration':
      case 'TSTypeAliasDeclaration':
        this.collectTypeAliasDeclaration(node, scopeId);
        break;

      case 'enum_declaration':
      case 'TSEnumDeclaration':
        this.collectEnumDeclaration(node, scopeId);
        break;

      case 'statement_block':
      case 'BlockStatement':
        this.collectBlockStatement(node, scopeId);
        break;

      case 'for_statement':
      case 'ForStatement':
      case 'for_in_statement':
      case 'ForInStatement':
      case 'for_of_statement':
      case 'ForOfStatement':
        this.collectForStatement(node, scopeId);
        break;

      case 'if_statement':
      case 'IfStatement':
        this.collectIfStatement(node, scopeId);
        break;

      case 'switch_statement':
      case 'SwitchStatement':
        this.collectSwitchStatement(node, scopeId);
        break;

      case 'try_statement':
      case 'TryStatement':
        this.collectTryStatement(node, scopeId);
        break;

      case 'catch_clause':
      case 'CatchClause':
        this.collectCatchClause(node, scopeId);
        break;

      default:
        // Recurse into children for other node types
        this.collectChildDeclarations(node, scopeId);
        break;
    }
  }

  /**
   * Collect declarations from child nodes.
   */
  private collectChildDeclarations(node: ASTNode, scopeId: string): void {
    for (const child of node.children) {
      this.collectDeclarations(child, scopeId);
    }
  }

  /**
   * Collect function declaration.
   */
  private collectFunctionDeclaration(node: ASTNode, scopeId: string): void {
    const nameNode = this.findChildByType(node, 'identifier') ||
                     this.findChildByType(node, 'Identifier');
    const name = nameNode?.text || '<anonymous>';

    // Add function symbol to current scope
    const symbol = this.createSymbol(name, 'function', scopeId, {
      start: node.startPosition,
      end: node.endPosition,
    });
    symbol.parameters = this.extractParameters(node);
    this.addSymbolToScope(symbol, scopeId);

    // Create function scope
    const funcScope = this.createScope('function', scopeId, {
      start: node.startPosition,
      end: node.endPosition,
    });

    // Add parameters to function scope
    for (const param of symbol.parameters || []) {
      const paramSymbol = this.createSymbol(param.name, 'parameter', funcScope.id, param.location);
      this.addSymbolToScope(paramSymbol, funcScope.id);
    }

    // Process function body
    const body = this.findChildByType(node, 'statement_block') ||
                 this.findChildByType(node, 'BlockStatement');
    if (body) {
      this.collectChildDeclarations(body, funcScope.id);
    }
  }

  /**
   * Collect arrow function.
   */
  private collectArrowFunction(node: ASTNode, scopeId: string): void {
    // Create function scope
    const funcScope = this.createScope('function', scopeId, {
      start: node.startPosition,
      end: node.endPosition,
    });

    // Extract and add parameters
    const params = this.extractParameters(node);
    for (const param of params) {
      const paramSymbol = this.createSymbol(param.name, 'parameter', funcScope.id, param.location);
      this.addSymbolToScope(paramSymbol, funcScope.id);
    }

    // Process body
    const body = this.findChildByType(node, 'statement_block') ||
                 this.findChildByType(node, 'BlockStatement');
    if (body) {
      this.collectChildDeclarations(body, funcScope.id);
    } else {
      // Expression body - still process for nested functions
      this.collectChildDeclarations(node, funcScope.id);
    }
  }

  /**
   * Collect method definition.
   */
  private collectMethodDefinition(node: ASTNode, scopeId: string): void {
    const nameNode = this.findChildByType(node, 'property_identifier') ||
                     this.findChildByType(node, 'Identifier');
    const name = nameNode?.text || '<anonymous>';

    // Add method symbol to class scope
    const symbol = this.createSymbol(name, 'method', scopeId, {
      start: node.startPosition,
      end: node.endPosition,
    });
    symbol.visibility = this.extractVisibility(node);
    symbol.parameters = this.extractParameters(node);
    this.addSymbolToScope(symbol, scopeId);

    // Create method scope
    const methodScope = this.createScope('function', scopeId, {
      start: node.startPosition,
      end: node.endPosition,
    });

    // Add 'this' to method scope
    const thisSymbol = this.createSymbol('this', 'variable', methodScope.id, {
      start: node.startPosition,
      end: node.startPosition,
    });
    this.addSymbolToScope(thisSymbol, methodScope.id);

    // Add parameters to method scope
    for (const param of symbol.parameters || []) {
      const paramSymbol = this.createSymbol(param.name, 'parameter', methodScope.id, param.location);
      this.addSymbolToScope(paramSymbol, methodScope.id);
    }

    // Process method body
    const body = this.findChildByType(node, 'statement_block') ||
                 this.findChildByType(node, 'BlockStatement');
    if (body) {
      this.collectChildDeclarations(body, methodScope.id);
    }
  }

  /**
   * Collect class declaration.
   */
  private collectClassDeclaration(node: ASTNode, scopeId: string): void {
    const nameNode = this.findChildByType(node, 'type_identifier') ||
                     this.findChildByType(node, 'Identifier');
    const name = nameNode?.text || '<anonymous>';

    // Add class symbol to current scope
    const symbol = this.createSymbol(name, 'class', scopeId, {
      start: node.startPosition,
      end: node.endPosition,
    });
    this.addSymbolToScope(symbol, scopeId);

    // Create class scope
    const classScope = this.createScope('class', scopeId, {
      start: node.startPosition,
      end: node.endPosition,
    });

    // Process class body
    const body = this.findChildByType(node, 'class_body') ||
                 this.findChildByType(node, 'ClassBody');
    if (body) {
      // Collect class members
      for (const child of body.children) {
        if (child.type === 'method_definition' || child.type === 'MethodDefinition') {
          this.collectMethodDefinition(child, classScope.id);
        } else if (child.type === 'public_field_definition' ||
                   child.type === 'PropertyDefinition' ||
                   child.type === 'field_definition') {
          this.collectFieldDefinition(child, classScope.id);
        } else {
          this.collectDeclarations(child, classScope.id);
        }
      }
    }
  }

  /**
   * Collect field definition.
   */
  private collectFieldDefinition(node: ASTNode, scopeId: string): void {
    const nameNode = this.findChildByType(node, 'property_identifier') ||
                     this.findChildByType(node, 'Identifier');
    const name = nameNode?.text;

    if (name) {
      const symbol = this.createSymbol(name, 'property', scopeId, {
        start: node.startPosition,
        end: node.endPosition,
      });
      symbol.visibility = this.extractVisibility(node);
      this.addSymbolToScope(symbol, scopeId);
    }
  }

  /**
   * Collect variable declaration.
   */
  private collectVariableDeclaration(node: ASTNode, scopeId: string): void {
    // Find all variable declarators
    for (const child of node.children) {
      if (child.type === 'variable_declarator' || child.type === 'VariableDeclarator') {
        this.collectVariableDeclarator(child, scopeId);
      }
    }
  }

  /**
   * Collect variable declarator.
   */
  private collectVariableDeclarator(node: ASTNode, scopeId: string): void {
    // Handle destructuring patterns
    const pattern = node.children[0];
    if (!pattern) {return;}

    if (pattern.type === 'identifier' || pattern.type === 'Identifier') {
      const symbol = this.createSymbol(pattern.text, 'variable', scopeId, {
        start: pattern.startPosition,
        end: pattern.endPosition,
      });
      this.addSymbolToScope(symbol, scopeId);
    } else if (pattern.type === 'object_pattern' || pattern.type === 'ObjectPattern') {
      this.collectObjectPattern(pattern, scopeId);
    } else if (pattern.type === 'array_pattern' || pattern.type === 'ArrayPattern') {
      this.collectArrayPattern(pattern, scopeId);
    }

    // Process initializer for nested functions
    const initializer = this.findChildByType(node, 'arrow_function') ||
                        this.findChildByType(node, 'ArrowFunctionExpression') ||
                        this.findChildByType(node, 'function') ||
                        this.findChildByType(node, 'FunctionExpression');
    if (initializer) {
      this.collectDeclarations(initializer, scopeId);
    }
  }

  /**
   * Collect object destructuring pattern.
   */
  private collectObjectPattern(node: ASTNode, scopeId: string): void {
    for (const child of node.children) {
      if (child.type === 'shorthand_property_identifier_pattern' ||
          child.type === 'shorthand_property_identifier') {
        const symbol = this.createSymbol(child.text, 'variable', scopeId, {
          start: child.startPosition,
          end: child.endPosition,
        });
        this.addSymbolToScope(symbol, scopeId);
      } else if (child.type === 'pair_pattern' || child.type === 'Property') {
        // { key: value } pattern
        const valueNode = child.children[child.children.length - 1];
        if (valueNode?.type === 'identifier' || valueNode?.type === 'Identifier') {
          const symbol = this.createSymbol(valueNode.text, 'variable', scopeId, {
            start: valueNode.startPosition,
            end: valueNode.endPosition,
          });
          this.addSymbolToScope(symbol, scopeId);
        } else if (valueNode) {
          // Nested pattern
          this.collectPattern(valueNode, scopeId);
        }
      }
    }
  }

  /**
   * Collect array destructuring pattern.
   */
  private collectArrayPattern(node: ASTNode, scopeId: string): void {
    for (const child of node.children) {
      if (child.type === 'identifier' || child.type === 'Identifier') {
        const symbol = this.createSymbol(child.text, 'variable', scopeId, {
          start: child.startPosition,
          end: child.endPosition,
        });
        this.addSymbolToScope(symbol, scopeId);
      } else if (child.type === 'rest_pattern' || child.type === 'RestElement') {
        const restId = this.findChildByType(child, 'identifier') ||
                       this.findChildByType(child, 'Identifier');
        if (restId) {
          const symbol = this.createSymbol(restId.text, 'variable', scopeId, {
            start: restId.startPosition,
            end: restId.endPosition,
          });
          this.addSymbolToScope(symbol, scopeId);
        }
      } else {
        // Nested pattern
        this.collectPattern(child, scopeId);
      }
    }
  }

  /**
   * Collect any pattern type.
   */
  private collectPattern(node: ASTNode, scopeId: string): void {
    if (node.type === 'identifier' || node.type === 'Identifier') {
      const symbol = this.createSymbol(node.text, 'variable', scopeId, {
        start: node.startPosition,
        end: node.endPosition,
      });
      this.addSymbolToScope(symbol, scopeId);
    } else if (node.type === 'object_pattern' || node.type === 'ObjectPattern') {
      this.collectObjectPattern(node, scopeId);
    } else if (node.type === 'array_pattern' || node.type === 'ArrayPattern') {
      this.collectArrayPattern(node, scopeId);
    }
  }

  /**
   * Collect import declaration.
   */
  private collectImportDeclaration(node: ASTNode, scopeId: string): void {
    // Find import clause
    const importClause = this.findChildByType(node, 'import_clause');
    if (importClause) {
      for (const child of importClause.children) {
        if (child.type === 'identifier' || child.type === 'Identifier') {
          // Default import
          const symbol = this.createSymbol(child.text, 'variable', scopeId, {
            start: child.startPosition,
            end: child.endPosition,
          });
          symbol.isImported = true;
          this.addSymbolToScope(symbol, scopeId);
        } else if (child.type === 'named_imports') {
          // Named imports
          for (const spec of child.children) {
            if (spec.type === 'import_specifier') {
              const localName = this.findChildByType(spec, 'identifier') ||
                               spec.children[spec.children.length - 1];
              if (localName && (localName.type === 'identifier' || localName.type === 'Identifier')) {
                const symbol = this.createSymbol(localName.text, 'variable', scopeId, {
                  start: localName.startPosition,
                  end: localName.endPosition,
                });
                symbol.isImported = true;
                this.addSymbolToScope(symbol, scopeId);
              }
            }
          }
        } else if (child.type === 'namespace_import') {
          // Namespace import (import * as name)
          const nameNode = this.findChildByType(child, 'identifier');
          if (nameNode) {
            const symbol = this.createSymbol(nameNode.text, 'namespace', scopeId, {
              start: nameNode.startPosition,
              end: nameNode.endPosition,
            });
            symbol.isImported = true;
            this.addSymbolToScope(symbol, scopeId);
          }
        }
      }
    }

    // Handle direct named imports (ImportDeclaration style)
    for (const child of node.children) {
      if (child.type === 'ImportSpecifier') {
        const localNode = this.findChildByType(child, 'Identifier');
        if (localNode) {
          const symbol = this.createSymbol(localNode.text, 'variable', scopeId, {
            start: localNode.startPosition,
            end: localNode.endPosition,
          });
          symbol.isImported = true;
          this.addSymbolToScope(symbol, scopeId);
        }
      }
    }
  }

  /**
   * Collect export declaration.
   */
  private collectExportDeclaration(node: ASTNode, scopeId: string): void {
    // Process the declaration being exported
    for (const child of node.children) {
      if (child.type === 'function_declaration' || child.type === 'FunctionDeclaration') {
        this.collectFunctionDeclaration(child, scopeId);
        // Mark as exported
        const nameNode = this.findChildByType(child, 'identifier') ||
                        this.findChildByType(child, 'Identifier');
        if (nameNode) {
          const scope = this.scopes.get(scopeId);
          const symbol = scope?.symbols.get(nameNode.text);
          if (symbol) {
            symbol.isExported = true;
          }
        }
      } else if (child.type === 'class_declaration' || child.type === 'ClassDeclaration') {
        this.collectClassDeclaration(child, scopeId);
        const nameNode = this.findChildByType(child, 'type_identifier') ||
                        this.findChildByType(child, 'Identifier');
        if (nameNode) {
          const scope = this.scopes.get(scopeId);
          const symbol = scope?.symbols.get(nameNode.text);
          if (symbol) {
            symbol.isExported = true;
          }
        }
      } else if (child.type === 'variable_declaration' || child.type === 'VariableDeclaration' ||
                 child.type === 'lexical_declaration') {
        this.collectVariableDeclaration(child, scopeId);
        // Mark all declared variables as exported
        for (const declarator of child.children) {
          if (declarator.type === 'variable_declarator' || declarator.type === 'VariableDeclarator') {
            const idNode = declarator.children[0];
            if (idNode && (idNode.type === 'identifier' || idNode.type === 'Identifier')) {
              const scope = this.scopes.get(scopeId);
              const symbol = scope?.symbols.get(idNode.text);
              if (symbol) {
                symbol.isExported = true;
              }
            }
          }
        }
      } else if (child.type === 'interface_declaration' || child.type === 'TSInterfaceDeclaration') {
        this.collectInterfaceDeclaration(child, scopeId);
      } else if (child.type === 'type_alias_declaration' || child.type === 'TSTypeAliasDeclaration') {
        this.collectTypeAliasDeclaration(child, scopeId);
      }
    }
  }

  /**
   * Collect interface declaration.
   */
  private collectInterfaceDeclaration(node: ASTNode, scopeId: string): void {
    const nameNode = this.findChildByType(node, 'type_identifier') ||
                     this.findChildByType(node, 'Identifier');
    const name = nameNode?.text;

    if (name) {
      const symbol = this.createSymbol(name, 'interface', scopeId, {
        start: node.startPosition,
        end: node.endPosition,
      });
      this.addSymbolToScope(symbol, scopeId);
    }
  }

  /**
   * Collect type alias declaration.
   */
  private collectTypeAliasDeclaration(node: ASTNode, scopeId: string): void {
    const nameNode = this.findChildByType(node, 'type_identifier') ||
                     this.findChildByType(node, 'Identifier');
    const name = nameNode?.text;

    if (name) {
      const symbol = this.createSymbol(name, 'type', scopeId, {
        start: node.startPosition,
        end: node.endPosition,
      });
      this.addSymbolToScope(symbol, scopeId);
    }
  }

  /**
   * Collect enum declaration.
   */
  private collectEnumDeclaration(node: ASTNode, scopeId: string): void {
    const nameNode = this.findChildByType(node, 'identifier') ||
                     this.findChildByType(node, 'Identifier');
    const name = nameNode?.text;

    if (name) {
      const symbol = this.createSymbol(name, 'enum', scopeId, {
        start: node.startPosition,
        end: node.endPosition,
      });
      this.addSymbolToScope(symbol, scopeId);

      // Collect enum members
      const body = this.findChildByType(node, 'enum_body');
      if (body) {
        for (const child of body.children) {
          if (child.type === 'enum_assignment' || child.type === 'property_identifier') {
            const memberName = this.findChildByType(child, 'property_identifier') ||
                              this.findChildByType(child, 'Identifier');
            if (memberName) {
              // Create enum member symbol (accessible via the enum name)
              const memberSymbol = this.createSymbol(memberName.text, 'enumMember', scopeId, {
                start: memberName.startPosition,
                end: memberName.endPosition,
              });
              this.addSymbolToScope(memberSymbol, scopeId);
            }
          }
        }
      }
    }
  }

  /**
   * Collect block statement.
   */
  private collectBlockStatement(node: ASTNode, scopeId: string): void {
    // Create block scope
    const blockScope = this.createScope('block', scopeId, {
      start: node.startPosition,
      end: node.endPosition,
    });

    this.collectChildDeclarations(node, blockScope.id);
  }

  /**
   * Collect for statement.
   */
  private collectForStatement(node: ASTNode, scopeId: string): void {
    // Create loop scope
    const loopScope = this.createScope('loop', scopeId, {
      start: node.startPosition,
      end: node.endPosition,
    });

    // Collect loop variable declarations
    for (const child of node.children) {
      if (child.type === 'variable_declaration' || child.type === 'VariableDeclaration' ||
          child.type === 'lexical_declaration') {
        this.collectVariableDeclaration(child, loopScope.id);
      } else if (child.type === 'statement_block' || child.type === 'BlockStatement') {
        this.collectChildDeclarations(child, loopScope.id);
      } else {
        this.collectDeclarations(child, loopScope.id);
      }
    }
  }

  /**
   * Collect if statement.
   */
  private collectIfStatement(node: ASTNode, scopeId: string): void {
    for (const child of node.children) {
      if (child.type === 'statement_block' || child.type === 'BlockStatement') {
        // Create conditional scope
        const condScope = this.createScope('conditional', scopeId, {
          start: child.startPosition,
          end: child.endPosition,
        });
        this.collectChildDeclarations(child, condScope.id);
      } else if (child.type === 'else_clause') {
        this.collectDeclarations(child, scopeId);
      }
    }
  }

  /**
   * Collect switch statement.
   */
  private collectSwitchStatement(node: ASTNode, scopeId: string): void {
    // Create switch scope
    const switchScope = this.createScope('switch', scopeId, {
      start: node.startPosition,
      end: node.endPosition,
    });

    const body = this.findChildByType(node, 'switch_body');
    if (body) {
      this.collectChildDeclarations(body, switchScope.id);
    }
  }

  /**
   * Collect try statement.
   */
  private collectTryStatement(node: ASTNode, scopeId: string): void {
    for (const child of node.children) {
      if (child.type === 'statement_block' || child.type === 'BlockStatement') {
        const tryScope = this.createScope('block', scopeId, {
          start: child.startPosition,
          end: child.endPosition,
        });
        this.collectChildDeclarations(child, tryScope.id);
      } else if (child.type === 'catch_clause' || child.type === 'CatchClause') {
        this.collectCatchClause(child, scopeId);
      } else if (child.type === 'finally_clause') {
        const finallyBlock = this.findChildByType(child, 'statement_block') ||
                            this.findChildByType(child, 'BlockStatement');
        if (finallyBlock) {
          const finallyScope = this.createScope('block', scopeId, {
            start: finallyBlock.startPosition,
            end: finallyBlock.endPosition,
          });
          this.collectChildDeclarations(finallyBlock, finallyScope.id);
        }
      }
    }
  }

  /**
   * Collect catch clause.
   */
  private collectCatchClause(node: ASTNode, scopeId: string): void {
    // Create catch scope
    const catchScope = this.createScope('catch', scopeId, {
      start: node.startPosition,
      end: node.endPosition,
    });

    // Add catch parameter
    const param = this.findChildByType(node, 'identifier') ||
                  this.findChildByType(node, 'Identifier');
    if (param) {
      const symbol = this.createSymbol(param.text, 'parameter', catchScope.id, {
        start: param.startPosition,
        end: param.endPosition,
      });
      this.addSymbolToScope(symbol, catchScope.id);
    }

    // Process catch body
    const body = this.findChildByType(node, 'statement_block') ||
                 this.findChildByType(node, 'BlockStatement');
    if (body) {
      this.collectChildDeclarations(body, catchScope.id);
    }
  }

  /**
   * Resolve references in AST nodes.
   */
  private resolveReferences(node: ASTNode, scopeId: string): void {
    const nodeType = node.type;

    // Update scope for scope-creating nodes
    let currentScopeId = scopeId;
    if (this.isNewScopeNode(node)) {
      const matchingScope = this.findScopeForNode(node);
      if (matchingScope) {
        currentScopeId = matchingScope.id;
      }
    }

    // Check for identifier references
    if (nodeType === 'identifier' || nodeType === 'Identifier') {
      this.resolveIdentifierReference(node, currentScopeId);
    }

    // Recurse into children
    for (const child of node.children) {
      this.resolveReferences(child, currentScopeId);
    }
  }

  /**
   * Check if a node creates a new scope.
   */
  private isNewScopeNode(node: ASTNode): boolean {
    const scopeCreatingTypes = new Set([
      'function_declaration', 'FunctionDeclaration',
      'arrow_function', 'ArrowFunctionExpression',
      'method_definition', 'MethodDefinition',
      'class_declaration', 'ClassDeclaration',
      'statement_block', 'BlockStatement',
      'for_statement', 'ForStatement',
      'for_in_statement', 'ForInStatement',
      'for_of_statement', 'ForOfStatement',
      'switch_statement', 'SwitchStatement',
      'catch_clause', 'CatchClause',
    ]);
    return scopeCreatingTypes.has(node.type);
  }

  /**
   * Find the scope that matches a node's location.
   */
  private findScopeForNode(node: ASTNode): InternalScope | null {
    for (const scope of this.scopes.values()) {
      if (scope.location.start.row === node.startPosition.row &&
          scope.location.start.column === node.startPosition.column &&
          scope.location.end.row === node.endPosition.row &&
          scope.location.end.column === node.endPosition.column) {
        return scope;
      }
    }
    return null;
  }

  /**
   * Resolve an identifier reference.
   */
  private resolveIdentifierReference(node: ASTNode, scopeId: string): void {
    const name = node.text;

    // Skip if this is a declaration (handled separately)
    if (this.isDeclarationContext(node)) {
      return;
    }

    // Skip property access (obj.prop - prop is not a reference)
    if (this.isPropertyAccess(node)) {
      return;
    }

    // Try to resolve the symbol
    const symbol = this.resolveSymbol(name, scopeId);

    if (symbol) {
      // Add reference to the symbol
      const reference: SymbolReference = {
        location: {
          start: node.startPosition,
          end: node.endPosition,
        },
        kind: this.determineReferenceKind(node),
        isWrite: this.isWriteReference(node),
      };
      symbol.references.push(reference);
    } else {
      // Unresolved reference
      this.unresolvedReferences.push({
        location: {
          start: node.startPosition,
          end: node.endPosition,
        },
        kind: 'read',
        isWrite: false,
      });
    }
  }

  /**
   * Check if an identifier is in a declaration context.
   */
  private isDeclarationContext(_node: ASTNode): boolean {
    // This is a simplified check - in a real implementation,
    // we'd need to track parent nodes during traversal
    return false;
  }

  /**
   * Check if an identifier is a property access.
   */
  private isPropertyAccess(_node: ASTNode): boolean {
    // This is a simplified check
    return false;
  }

  /**
   * Determine the kind of reference.
   */
  private determineReferenceKind(_node: ASTNode): ReferenceKind {
    // Simplified - would need parent context for accurate determination
    return 'read';
  }

  /**
   * Check if a reference is a write (assignment).
   */
  private isWriteReference(_node: ASTNode): boolean {
    // Simplified - would need parent context for accurate determination
    return false;
  }

  /**
   * Extract parameters from a function node.
   */
  private extractParameters(node: ASTNode): ParameterInfo[] {
    const params: ParameterInfo[] = [];

    const paramsNode = this.findChildByType(node, 'formal_parameters') ||
                       this.findChildByType(node, 'parameters');
    if (!paramsNode) {return params;}

    for (const child of paramsNode.children) {
      if (child.type === 'required_parameter' || child.type === 'optional_parameter' ||
          child.type === 'identifier' || child.type === 'Identifier') {
        const nameNode = child.type === 'identifier' || child.type === 'Identifier'
          ? child
          : this.findChildByType(child, 'identifier') || this.findChildByType(child, 'Identifier');

        if (nameNode) {
          params.push({
            name: nameNode.text,
            isOptional: child.type === 'optional_parameter',
            isRest: false,
            location: {
              start: nameNode.startPosition,
              end: nameNode.endPosition,
            },
          });
        }
      } else if (child.type === 'rest_pattern' || child.type === 'RestElement') {
        const nameNode = this.findChildByType(child, 'identifier') ||
                        this.findChildByType(child, 'Identifier');
        if (nameNode) {
          params.push({
            name: nameNode.text,
            isOptional: false,
            isRest: true,
            location: {
              start: nameNode.startPosition,
              end: nameNode.endPosition,
            },
          });
        }
      }
    }

    return params;
  }

  /**
   * Extract visibility modifier from a node.
   */
  private extractVisibility(node: ASTNode): SymbolVisibility {
    for (const child of node.children) {
      if (child.type === 'accessibility_modifier' || child.text === 'public') {
        return 'public';
      } else if (child.text === 'private') {
        return 'private';
      } else if (child.text === 'protected') {
        return 'protected';
      }
    }
    return 'default';
  }

  /**
   * Find a child node by type.
   */
  private findChildByType(node: ASTNode, type: string): ASTNode | null {
    for (const child of node.children) {
      if (child.type === type) {
        return child;
      }
    }
    return null;
  }

  /**
   * Check if a position is within a range.
   */
  private positionInRange(
    position: { row: number; column: number },
    start: { row: number; column: number },
    end: { row: number; column: number }
  ): boolean {
    // Check if position is after start
    if (position.row < start.row) {return false;}
    if (position.row === start.row && position.column < start.column) {return false;}

    // Check if position is before end
    if (position.row > end.row) {return false;}
    if (position.row === end.row && position.column > end.column) {return false;}

    return true;
  }

  /**
   * Convert internal scope to ScopeInfo.
   */
  private toScopeInfo(scope: InternalScope): ScopeInfo {
    return {
      id: scope.id,
      kind: scope.kind,
      parentId: scope.parentId,
      childIds: scope.childIds,
      symbols: Array.from(scope.symbols.keys()),
      location: scope.location,
      depth: scope.depth,
    };
  }

  /**
   * Build the final analysis result.
   */
  private buildResult(): SemanticAnalysisResult {
    // Build symbol table from all scopes
    const symbols = new Map<string, SymbolInfo>();
    for (const scope of this.scopes.values()) {
      for (const [name, symbol] of scope.symbols) {
        // Use scope-qualified key to avoid collisions
        const key = `${scope.id}:${name}`;
        symbols.set(key, symbol);
      }
    }

    // Convert scopes to ScopeInfo array
    const scopes: ScopeInfo[] = Array.from(this.scopes.values()).map((s) => this.toScopeInfo(s));

    return {
      symbols,
      scopes,
      unresolvedReferences: this.unresolvedReferences,
      shadowedVariables: this.shadowedVariables,
    };
  }

  /**
   * Clear internal state.
   */
  clearCache(): void {
    this.reset();
  }
}
