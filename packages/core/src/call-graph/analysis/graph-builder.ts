/**
 * Call Graph Builder
 *
 * Builds the complete call graph from extracted file information.
 * Handles function registration, call resolution, and graph construction.
 */

import type { DataAccessPoint } from '../../boundaries/types.js';
import type {
  CallGraph,
  FunctionNode,
  CallSite,
  FileExtractionResult,
  FunctionExtraction,
  CallExtraction,
  ClassExtraction,
  ImportExtraction,
  CallGraphLanguage,
  CallGraphStats,
} from '../types.js';

/**
 * Options for building the call graph
 */
export interface GraphBuilderOptions {
  /** Project root directory */
  projectRoot: string;
  /** Whether to include unresolved calls */
  includeUnresolved?: boolean;
  /** Minimum confidence for resolution */
  minConfidence?: number;
}

/**
 * Call Graph Builder
 */
export class GraphBuilder {
  private functions: Map<string, FunctionNode> = new Map();
  private classes: Map<string, ClassExtraction> = new Map();
  private imports: Map<string, ImportExtraction[]> = new Map();
  private pendingCalls: Map<string, { call: CallExtraction; file: string; containingFunction: string }[]> = new Map();
  private dataAccessPoints: Map<string, DataAccessPoint[]> = new Map();
  private options: GraphBuilderOptions;

  constructor(options: GraphBuilderOptions) {
    this.options = {
      includeUnresolved: true,
      minConfidence: 0.7, // Raised from 0.5 to reduce false positives
      ...options,
    };
  }

  /**
   * Add extraction results from a file
   */
  addFile(extraction: FileExtractionResult): void {
    const { file, functions, calls, imports, classes } = extraction;

    // Store imports for resolution
    this.imports.set(file, imports);

    // Register classes
    for (const cls of classes) {
      const classKey = `${file}:${cls.name}`;
      this.classes.set(classKey, cls);
    }

    // Register functions
    for (const func of functions) {
      const funcNode = this.createFunctionNode(func, file, extraction.language);
      this.functions.set(funcNode.id, funcNode);
    }

    // Store calls for later resolution
    this.storePendingCalls(calls, file, functions);
  }

  /**
   * Add data access points for a file
   */
  addDataAccess(file: string, accessPoints: DataAccessPoint[]): void {
    this.dataAccessPoints.set(file, accessPoints);
  }

  /**
   * Build the complete call graph
   */
  build(): CallGraph {
    // Resolve all pending calls
    this.resolveAllCalls();

    // Associate data access with functions
    this.associateDataAccess();

    // Identify entry points
    const entryPoints = this.identifyEntryPoints();

    // Identify data accessors
    const dataAccessors = this.identifyDataAccessors();

    // Calculate stats
    const stats = this.calculateStats();

    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      projectRoot: this.options.projectRoot,
      functions: this.functions,
      entryPoints,
      dataAccessors,
      stats,
    };
  }

  /**
   * Create a FunctionNode from extraction
   */
  private createFunctionNode(
    func: FunctionExtraction,
    file: string,
    language: CallGraphLanguage
  ): FunctionNode {
    const id = this.generateFunctionId(file, func.qualifiedName, func.startLine);

    return {
      id,
      name: func.name,
      qualifiedName: func.qualifiedName,
      file,
      startLine: func.startLine,
      endLine: func.endLine,
      language,
      calls: [],
      calledBy: [],
      dataAccess: [],
      className: func.className,
      moduleName: func.moduleName,
      isExported: func.isExported,
      isConstructor: func.isConstructor,
      isAsync: func.isAsync,
      decorators: func.decorators,
      parameters: func.parameters,
      returnType: func.returnType,
    };
  }

  /**
   * Store calls for later resolution
   */
  private storePendingCalls(
    calls: CallExtraction[],
    file: string,
    functions: FunctionExtraction[]
  ): void {
    for (const call of calls) {
      // Find the containing function
      const containingFunc = this.findContainingFunction(call.line, functions);
      if (!containingFunc) {continue;}

      const containingFunctionId = this.generateFunctionId(
        file,
        containingFunc.qualifiedName,
        containingFunc.startLine
      );

      const pending = this.pendingCalls.get(file) ?? [];
      pending.push({ call, file, containingFunction: containingFunctionId });
      this.pendingCalls.set(file, pending);
    }
  }

  /**
   * Find the function containing a given line
   * Includes parameter default values (which are before the body)
   */
  private findContainingFunction(
    line: number,
    functions: FunctionExtraction[]
  ): FunctionExtraction | null {
    // Find the innermost function containing this line
    let best: FunctionExtraction | null = null;
    let bestSize = Infinity;

    for (const func of functions) {
      // Check full function range (startLine to endLine) to include:
      // - Parameter default values (e.g., Depends(get_current_user))
      // - Function body
      // - Decorators are before startLine, so they're handled separately
      if (line >= func.startLine && line <= func.endLine) {
        const size = func.endLine - func.startLine;
        if (size < bestSize) {
          best = func;
          bestSize = size;
        }
      }
    }

    return best;
  }

  /**
   * Resolve all pending calls
   */
  private resolveAllCalls(): void {
    for (const [file, pending] of this.pendingCalls) {
      const fileImports = this.imports.get(file) ?? [];

      for (const { call, containingFunction } of pending) {
        const resolved = this.resolveCall(call, file, fileImports, containingFunction);
        
        // Skip uncertain resolutions (fuzzy matches) if below minimum confidence
        // This reduces false positive call paths
        if (resolved.confidence < this.options.minConfidence! && resolved.reason.includes('fuzzy')) {
          continue;
        }
        
        const callSite = this.createCallSite(call, file, containingFunction, resolved);

        // Add to caller's calls
        const caller = this.functions.get(containingFunction);
        if (caller) {
          caller.calls.push(callSite);
        }

        // Add to callee's calledBy (if resolved with sufficient confidence)
        if (resolved.resolved && resolved.candidates.length > 0 && resolved.confidence >= this.options.minConfidence!) {
          for (const candidateId of resolved.candidates) {
            const callee = this.functions.get(candidateId);
            if (callee) {
              callee.calledBy.push(callSite);
            }
          }
        }
      }
    }
  }

  /**
   * Resolve a call to its target function(s)
   */
  private resolveCall(
    call: CallExtraction,
    file: string,
    imports: ImportExtraction[],
    callerId?: string
  ): { resolved: boolean; candidates: string[]; confidence: number; reason: string } {
    const candidates: string[] = [];
    let confidence = 0;
    let reason = 'unresolved';

    // Strategy 1: Local function in same file (with nested function awareness)
    const localMatch = this.findLocalFunction(call, file, callerId);
    if (localMatch) {
      candidates.push(localMatch);
      confidence = 0.95;
      reason = 'local-function';
    }

    // Strategy 2: Method on known class
    if (candidates.length === 0 && call.receiver) {
      const methodMatches = this.findMethodByReceiver(call, file, imports);
      if (methodMatches.length > 0) {
        candidates.push(...methodMatches);
        confidence = methodMatches.length === 1 ? 0.85 : 0.6;
        reason = methodMatches.length === 1 ? 'method-single' : 'method-multiple';
      }
    }

    // Strategy 3: Dependency Injection patterns
    if (candidates.length === 0) {
      const diMatch = this.resolveDependencyInjection(call, file, imports);
      if (diMatch.length > 0) {
        candidates.push(...diMatch);
        confidence = diMatch.length === 1 ? 0.9 : 0.7;
        reason = 'dependency-injection';
      }
    }

    // Strategy 4: Imported function
    if (candidates.length === 0) {
      const importMatch = this.findImportedFunction(call, imports);
      if (importMatch) {
        candidates.push(importMatch);
        confidence = 0.8;
        reason = 'imported';
      }
    }

    // Strategy 5: Fuzzy match by name (low confidence - only use when no other option)
    // Mark as 'uncertain' to filter from high-confidence reports
    if (candidates.length === 0) {
      const fuzzyMatches = this.findByName(call.calleeName);
      if (fuzzyMatches.length > 0) {
        candidates.push(...fuzzyMatches.slice(0, 3)); // Limit to top 3
        // Significantly lower confidence for fuzzy matches to reduce false positives
        // Single match: 0.4 (below default threshold), multiple: 0.2 (very uncertain)
        confidence = fuzzyMatches.length === 1 ? 0.4 : 0.2;
        reason = 'fuzzy-match-uncertain';
      }
    }

    return {
      resolved: candidates.length > 0,
      candidates,
      confidence,
      reason,
    };
  }

  /**
   * Resolve Dependency Injection patterns
   * Handles: FastAPI Depends(), Flask inject, Spring @Autowired, etc.
   */
  private resolveDependencyInjection(
    call: CallExtraction,
    _file: string,
    _imports: ImportExtraction[]
  ): string[] {
    const matches: string[] = [];

    // Pattern 1: FastAPI Depends(function_name)
    // The call looks like: Depends(get_current_user)
    if (call.calleeName === 'Depends' && call.fullExpression) {
      const dependsMatch = call.fullExpression.match(/Depends\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (dependsMatch) {
        const depFuncName = dependsMatch[1];
        // Find the function being depended on
        for (const [id, func] of this.functions) {
          if (func.name === depFuncName) {
            matches.push(id);
          }
        }
      }
    }

    // Pattern 2: Function parameter with type hint that matches a class
    // e.g., def route(user: User = Depends(get_user))
    // The actual dependency is get_user, which we handle above

    // Pattern 3: Direct function reference passed as argument
    // e.g., app.add_middleware(AuthMiddleware)
    if (call.isConstructorCall || /^[A-Z]/.test(call.calleeName)) {
      // This might be a class being instantiated for DI
      for (const [id, func] of this.functions) {
        if (func.className === call.calleeName && func.isConstructor) {
          matches.push(id);
        }
      }
    }

    // Pattern 4: Service locator pattern
    // e.g., container.get(UserService), injector.get('user_service')
    if (call.calleeName === 'get' && call.receiver) {
      const containerPatterns = ['container', 'injector', 'locator', 'provider', 'services'];
      if (containerPatterns.some(p => call.receiver!.toLowerCase().includes(p))) {
        // Try to find the service being requested
        // This is heuristic - we look for classes/functions matching the argument
        for (const [id, func] of this.functions) {
          if (func.className && call.fullExpression.includes(func.className)) {
            matches.push(id);
          }
        }
      }
    }

    // Pattern 5: Decorator-based injection
    // Functions with @inject, @autowired decorators are called by the framework
    // We handle this in entry point detection, but also track the injected function

    return matches;
  }

  /**
   * Find a local function in the same file
   * Prioritizes nested functions within the caller's scope
   */
  private findLocalFunction(call: CallExtraction, file: string, callerId?: string): string | null {
    // For method calls on self/this, look for method in same class
    if (call.receiver === 'self' || call.receiver === 'this') {
      // Find the class context from the containing function
      for (const [id, func] of this.functions) {
        if (func.file === file && func.name === call.calleeName && func.className) {
          return id;
        }
      }
    }

    // If we have a caller, first look for nested functions within that caller's scope
    if (callerId) {
      const caller = this.functions.get(callerId);
      if (caller) {
        // Look for a nested function with qualifiedName like "ParentFunc.childFunc"
        const nestedQualifiedName = `${caller.qualifiedName}.${call.calleeName}`;
        for (const [id, func] of this.functions) {
          if (func.file === file && func.qualifiedName === nestedQualifiedName) {
            return id;
          }
        }
        
        // Also check if the caller is itself nested and look for sibling functions
        // e.g., if caller is "Parent.child1", look for "Parent.child2"
        const callerParts = caller.qualifiedName.split('.');
        if (callerParts.length > 1) {
          const parentName = callerParts.slice(0, -1).join('.');
          const siblingQualifiedName = `${parentName}.${call.calleeName}`;
          for (const [id, func] of this.functions) {
            if (func.file === file && func.qualifiedName === siblingQualifiedName) {
              return id;
            }
          }
        }
      }
    }

    // Direct function call - find top-level function
    for (const [id, func] of this.functions) {
      if (func.file === file && func.name === call.calleeName && !func.className) {
        // Prefer non-nested functions (no dots in qualifiedName except for class methods)
        if (!func.qualifiedName.includes('.') || func.className) {
          return id;
        }
      }
    }
    
    // Fallback: any function with matching name in the file
    for (const [id, func] of this.functions) {
      if (func.file === file && func.name === call.calleeName && !func.className) {
        return id;
      }
    }

    return null;
  }

  /**
   * Find method by receiver type
   */
  private findMethodByReceiver(
    call: CallExtraction,
    file: string,
    imports: ImportExtraction[]
  ): string[] {
    const matches: string[] = [];

    // Try to resolve receiver to a class
    const receiverClass = this.resolveReceiverType(call.receiver!, file, imports);

    if (receiverClass) {
      // Find method in that class
      for (const [id, func] of this.functions) {
        if (func.className === receiverClass && func.name === call.calleeName) {
          matches.push(id);
        }
      }
    }

    // If no specific class found, find all methods with this name
    if (matches.length === 0) {
      for (const [id, func] of this.functions) {
        if (func.name === call.calleeName && func.className) {
          matches.push(id);
        }
      }
    }

    return matches;
  }

  /**
   * Try to resolve a receiver to a class name
   */
  private resolveReceiverType(
    receiver: string,
    _file: string,
    _imports: ImportExtraction[]
  ): string | null {
    // Simple heuristics:
    // - If receiver is PascalCase, it might be a class name
    if (/^[A-Z][a-zA-Z0-9]*$/.test(receiver)) {
      return receiver;
    }

    // - Common patterns like user_service -> UserService
    const camelCase = receiver
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
    if (this.classExists(camelCase)) {
      return camelCase;
    }

    return null;
  }

  /**
   * Check if a class exists
   */
  private classExists(name: string): boolean {
    for (const [, cls] of this.classes) {
      if (cls.name === name) {return true;}
    }
    return false;
  }

  /**
   * Find an imported function
   */
  private findImportedFunction(
    call: CallExtraction,
    imports: ImportExtraction[]
  ): string | null {
    // Check if the callee name matches an import
    for (const imp of imports) {
      for (const name of imp.names) {
        if (name.local === call.calleeName || name.imported === call.calleeName) {
          // Try to find the function in the imported module
          // This is simplified - real implementation would resolve paths
          for (const [id, func] of this.functions) {
            if (func.name === name.imported && func.isExported) {
              return id;
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Find functions by name (fuzzy match)
   */
  private findByName(name: string): string[] {
    const matches: string[] = [];

    for (const [id, func] of this.functions) {
      if (func.name === name) {
        matches.push(id);
      }
    }

    return matches;
  }

  /**
   * Create a CallSite from extraction and resolution
   */
  private createCallSite(
    call: CallExtraction,
    file: string,
    callerId: string,
    resolved: { resolved: boolean; candidates: string[]; confidence: number; reason: string }
  ): CallSite {
    return {
      callerId,
      calleeId: resolved.candidates[0] ?? null,
      calleeName: call.calleeName,
      receiver: call.receiver,
      file,
      line: call.line,
      column: call.column,
      resolved: resolved.resolved,
      resolvedCandidates: resolved.candidates,
      confidence: resolved.confidence,
      resolutionReason: resolved.reason,
      argumentCount: call.argumentCount,
    };
  }

  /**
   * Associate data access points with functions
   */
  private associateDataAccess(): void {
    for (const [file, accessPoints] of this.dataAccessPoints) {
      for (const access of accessPoints) {
        // Find the function containing this access
        const containingFunc = this.findFunctionAtLine(file, access.line);
        if (containingFunc) {
          containingFunc.dataAccess.push(access);
        }
      }
    }
  }

  /**
   * Find function at a specific line
   */
  private findFunctionAtLine(file: string, line: number): FunctionNode | null {
    let best: FunctionNode | null = null;
    let bestSize = Infinity;

    for (const [, func] of this.functions) {
      if (func.file === file && line >= func.startLine && line <= func.endLine) {
        const size = func.endLine - func.startLine;
        if (size < bestSize) {
          best = func;
          bestSize = size;
        }
      }
    }

    return best;
  }

  /**
   * Identify entry points (exported functions, API handlers, main)
   * 
   * Entry points are functions that can be called from outside the codebase:
   * - Exported module functions
   * - API route handlers (detected by decorators/attributes)
   * - Main/entry functions
   * - Controller methods in web frameworks
   */
  private identifyEntryPoints(): string[] {
    const entryPoints: string[] = [];

    for (const [id, func] of this.functions) {
      // Exported functions (not class methods)
      if (func.isExported && !func.className) {
        entryPoints.push(id);
        continue;
      }

      // Check decorators/attributes for API route patterns
      if (this.isApiRouteHandler(func)) {
        entryPoints.push(id);
        continue;
      }

      // Check if this is a controller method (PHP Laravel, etc.)
      if (this.isControllerMethod(func)) {
        entryPoints.push(id);
        continue;
      }

      // Main functions
      if (func.name === 'main' || func.name === '__main__') {
        entryPoints.push(id);
      }
    }

    return entryPoints;
  }

  /**
   * Check if a function is an API route handler based on decorators/attributes
   */
  private isApiRouteHandler(func: FunctionNode): boolean {
    if (func.decorators.length === 0) {return false;}

    // Python/FastAPI/Flask patterns
    const pythonRoutePatterns = [
      '@app.route', '@router.', '@app.get', '@app.post', '@app.put', '@app.delete', '@app.patch',
      '@blueprint.route', '@api.route',
    ];

    // Java Spring patterns
    const javaRoutePatterns = [
      '@GetMapping', '@PostMapping', '@PutMapping', '@DeleteMapping', '@PatchMapping',
      '@RequestMapping', '@RestController',
    ];

    // C# ASP.NET patterns (attributes use square brackets)
    const csharpRoutePatterns = [
      '[HttpGet', '[HttpPost', '[HttpPut', '[HttpDelete', '[HttpPatch',
      '[Route', '[ApiController',
    ];

    // TypeScript/NestJS patterns
    const nestjsPatterns = [
      '@Get', '@Post', '@Put', '@Delete', '@Patch', '@Controller',
    ];

    const allPatterns = [
      ...pythonRoutePatterns,
      ...javaRoutePatterns,
      ...csharpRoutePatterns,
      ...nestjsPatterns,
    ];

    return func.decorators.some((d) => 
      allPatterns.some((pattern) => d.includes(pattern))
    );
  }

  /**
   * Check if a function is a controller method (for frameworks without decorators)
   * 
   * This handles:
   * - PHP Laravel controllers (public methods in classes extending Controller)
   * - Ruby Rails controllers
   * - Other MVC frameworks
   * 
   * We're conservative here to avoid false positives - only mark methods
   * that are likely to be actual route handlers.
   */
  private isControllerMethod(func: FunctionNode): boolean {
    // Must be a public method in a class
    if (!func.className || !func.isExported) {return false;}

    // Check if the class name suggests it's a controller
    const controllerPatterns = [
      /Controller$/i,
      /Handler$/i,
      /Resource$/i,  // Laravel API Resources
      /Endpoint$/i,
    ];

    const isControllerClass = controllerPatterns.some(pattern => 
      pattern.test(func.className!)
    );

    if (!isControllerClass) {return false;}

    // Exclude common non-route methods (expanded list to reduce false positives)
    const excludedMethods = [
      // Constructors/destructors
      'constructor', '__construct', '__destruct', '__init__',
      // Lifecycle methods
      'boot', 'register', 'handle', 'init', 'initialize', 'setup', 'teardown',
      // Middleware/auth
      'middleware', 'authorize', 'rules', 'messages', 'validate', 'validateRequest',
      // Helper/utility patterns
      'get', 'set', 'has', 'is', 'can', 'should', 'will', 'did',
      'find', 'fetch', 'load', 'save', 'delete', 'remove', 'add', 'update',
      'format', 'transform', 'convert', 'parse', 'serialize', 'deserialize',
      'build', 'create', 'make', 'generate', 'render', 'prepare',
      'check', 'verify', 'ensure', 'assert', 'guard',
      'log', 'debug', 'info', 'warn', 'error',
      'toArray', 'toJson', 'toString', 'toResponse',
      // Private/protected indicators (even if marked exported by parser)
      '__call', '__get', '__set', '__isset', '__unset',
      // Common internal methods
      'callAction', 'getMiddleware', 'getValidationRules',
      'beforeAction', 'afterAction', 'beforeFilter', 'afterFilter',
    ];

    const lowerName = func.name.toLowerCase();
    if (excludedMethods.some(m => lowerName === m.toLowerCase())) {return false;}

    // Exclude methods starting with common helper prefixes
    const excludedPrefixes = [
      'get', 'set', 'is', 'has', 'can', 'should', 'will', 'did',
      'find', 'fetch', 'load', 'build', 'make', 'create', 'prepare',
      'validate', 'check', 'verify', 'ensure', 'guard',
      'format', 'transform', 'convert', 'parse', 'render',
      'handle', 'process', 'dispatch', // These are often internal
      '_', // Private convention
    ];

    // Only exclude if the method name is longer than the prefix
    // (e.g., "get" is excluded but "getUser" might be a route)
    // Actually, be more conservative - exclude all helper-prefixed methods
    // unless they match known route patterns
    const startsWithExcludedPrefix = excludedPrefixes.some(prefix => 
      lowerName.startsWith(prefix.toLowerCase()) && lowerName !== prefix.toLowerCase()
    );

    // For PHP Laravel, check if it's a standard CRUD method
    // These are the ONLY methods we confidently mark as entry points
    // for controllers without explicit route decorators
    const laravelCrudMethods = ['index', 'show', 'store', 'update', 'destroy', 'create', 'edit'];
    
    if (laravelCrudMethods.includes(lowerName)) {
      return true;
    }

    // For methods with helper prefixes, don't mark as entry points
    // This is conservative but reduces false positives significantly
    if (startsWithExcludedPrefix) {
      return false;
    }

    // For other public methods in controllers, only mark as entry points
    // if they look like action methods (short, action-like names)
    // This is a heuristic to reduce false positives
    const actionLikePatterns = [
      /^(list|view|detail|details|search|filter|sort|export|import|download|upload)$/i,
      /^(login|logout|register|signup|signin|signout|authenticate|verify|confirm)$/i,
      /^(submit|cancel|approve|reject|accept|decline|process|execute|run)$/i,
      /^(send|receive|notify|broadcast|publish|subscribe)$/i,
      /^(activate|deactivate|enable|disable|toggle|switch)$/i,
      /^(archive|restore|trash|recover|duplicate|clone|copy)$/i,
      /^(attach|detach|link|unlink|associate|dissociate)$/i,
      /^(sync|refresh|reload|reset|clear|flush)$/i,
    ];

    if (actionLikePatterns.some(pattern => pattern.test(func.name))) {
      return true;
    }

    // Default: don't mark as entry point to avoid false positives
    // Real entry points should be detected via route decorators or explicit patterns
    return false;
  }

  /**
   * Identify functions with direct data access
   */
  private identifyDataAccessors(): string[] {
    const accessors: string[] = [];

    for (const [id, func] of this.functions) {
      if (func.dataAccess.length > 0) {
        accessors.push(id);
      }
    }

    return accessors;
  }

  /**
   * Calculate graph statistics
   */
  private calculateStats(): CallGraphStats {
    let totalCallSites = 0;
    let resolvedCallSites = 0;
    const byLanguage: Record<CallGraphLanguage, number> = {
      python: 0,
      typescript: 0,
      javascript: 0,
      java: 0,
      csharp: 0,
      php: 0,
      go: 0,
      rust: 0,
      cpp: 0,
      'structured-text': 0,
    };

    for (const [, func] of this.functions) {
      byLanguage[func.language]++;
      for (const call of func.calls) {
        totalCallSites++;
        if (call.resolved) {
          resolvedCallSites++;
        }
      }
    }

    return {
      totalFunctions: this.functions.size,
      totalCallSites,
      resolvedCallSites,
      unresolvedCallSites: totalCallSites - resolvedCallSites,
      totalDataAccessors: this.identifyDataAccessors().length,
      byLanguage,
    };
  }

  /**
   * Generate a unique function ID
   */
  private generateFunctionId(file: string, qualifiedName: string, line: number): string {
    return `${file}:${qualifiedName}:${line}`;
  }
}
