/**
 * Dead Code Detector
 *
 * Finds functions that are never called and aren't entry points.
 * These are candidates for removal.
 */

import type { CallGraph, FunctionNode } from '../types.js';
import {
  isNativeAvailable,
  isCallGraphAvailable,
  getCallGraphCallers,
} from '../../native/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Confidence level for dead code detection
 */
export type DeadCodeConfidence = 'high' | 'medium' | 'low';

/**
 * Reason why code might appear dead but isn't
 */
export type FalsePositiveReason =
  | 'dynamic-call'        // Called via getattr, reflection, etc.
  | 'framework-hook'      // Framework lifecycle method
  | 'test-only'           // Only used in tests
  | 'api-endpoint'        // HTTP endpoint (might be called externally)
  | 'event-handler'       // Event/signal handler
  | 'serialization'       // __str__, __repr__, toJSON, etc.
  | 'magic-method'        // Python dunder methods
  | 'interface-impl'      // Interface implementation
  | 'callback'            // Passed as callback
  | 'export'              // Exported for external use
  | 'cli-command'         // CLI command handler
  | 'scheduled-task'      // Cron/scheduled job
  | 'dependency-injection'; // DI container managed

/**
 * A potentially dead function
 */
export interface DeadCodeCandidate {
  /** Function ID */
  id: string;
  /** Function name */
  name: string;
  /** Qualified name */
  qualifiedName: string;
  /** File path */
  file: string;
  /** Line number */
  line: number;
  /** Language */
  language: string;
  /** Class name if method */
  className?: string;
  /** Confidence this is actually dead */
  confidence: DeadCodeConfidence;
  /** Possible reasons this might be a false positive */
  possibleFalsePositives: FalsePositiveReason[];
  /** Lines of code (rough estimate) */
  linesOfCode: number;
  /** Does this function access data? */
  hasDataAccess: boolean;
  /** Is this exported? */
  isExported: boolean;
}

/**
 * Dead code analysis result
 */
export interface DeadCodeResult {
  /** All dead code candidates */
  candidates: DeadCodeCandidate[];
  /** Summary statistics */
  summary: {
    totalFunctions: number;
    deadCandidates: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    estimatedDeadLines: number;
    byLanguage: Record<string, number>;
    byFile: Array<{ file: string; count: number; lines: number }>;
  };
  /** Functions excluded from analysis (entry points, etc.) */
  excluded: {
    entryPoints: number;
    withCallers: number;
    frameworkHooks: number;
  };
}

/**
 * Options for dead code detection
 */
export interface DeadCodeOptions {
  /** Include exported functions (default: false - they might be used externally) */
  includeExported?: boolean;
  /** Include test files (default: false) */
  includeTests?: boolean;
  /** Minimum confidence level to report (default: low) */
  minConfidence?: DeadCodeConfidence;
  /** File patterns to exclude */
  excludePatterns?: string[];
}

// ============================================================================
// Framework Hook Patterns
// ============================================================================

/**
 * Patterns that indicate framework lifecycle methods (not dead)
 */
const FRAMEWORK_HOOKS: RegExp[] = [
  // Python
  /^__init__$/, /^__new__$/, /^__del__$/,
  /^__str__$/, /^__repr__$/, /^__hash__$/, /^__eq__$/,
  /^__lt__$/, /^__le__$/, /^__gt__$/, /^__ge__$/,
  /^__len__$/, /^__iter__$/, /^__next__$/, /^__getitem__$/,
  /^__setitem__$/, /^__delitem__$/, /^__contains__$/,
  /^__call__$/, /^__enter__$/, /^__exit__$/,
  /^__getattr__$/, /^__setattr__$/, /^__delattr__$/,
  /^setUp$/, /^tearDown$/, /^setUpClass$/, /^tearDownClass$/,
  /^test_/, /^_test/,
  
  // JavaScript/TypeScript
  /^constructor$/, /^render$/, /^componentDidMount$/,
  /^componentWillUnmount$/, /^componentDidUpdate$/,
  /^shouldComponentUpdate$/, /^getDerivedStateFromProps$/,
  /^getSnapshotBeforeUpdate$/, /^componentDidCatch$/,
  /^useEffect$/, /^useState$/, /^useMemo$/, /^useCallback$/,
  /^ngOnInit$/, /^ngOnDestroy$/, /^ngOnChanges$/,  // Angular
  /^mounted$/, /^created$/, /^destroyed$/, /^updated$/,  // Vue
  /^beforeEach$/, /^afterEach$/, /^beforeAll$/, /^afterAll$/,  // Jest
  /^describe$/, /^it$/, /^test$/,
  
  // Java/C#
  /^main$/, /^Main$/,
  /^toString$/, /^hashCode$/, /^equals$/,
  /^compareTo$/, /^clone$/,
  /^Dispose$/, /^Finalize$/,
  /^OnGet$/, /^OnPost$/, /^OnPut$/, /^OnDelete$/,  // ASP.NET
  
  // General
  /^setup$/, /^teardown$/, /^init$/, /^initialize$/,
  /^dispose$/, /^cleanup$/, /^close$/, /^shutdown$/,
  /^handle$/, /^process$/, /^execute$/, /^run$/,
  /^on[A-Z]/, /^handle[A-Z]/,  // Event handlers
];

/**
 * Decorator patterns that indicate the function is used
 */
const USED_DECORATOR_PATTERNS: RegExp[] = [
  // Python web frameworks
  /@app\.route/, /@router\./, /@blueprint\./,
  /@get/, /@post/, /@put/, /@delete/, /@patch/,
  /@api_view/, /@action/,
  /@celery\.task/, /@shared_task/,  // Celery
  /@receiver/, /@signal/,  // Django signals
  /@property/, /@staticmethod/, /@classmethod/,
  /@pytest\.fixture/, /@fixture/,
  /@click\.command/, /@command/,  // CLI
  /@scheduled/, /@cron/,
  
  // JavaScript/TypeScript
  /@Get/, /@Post/, /@Put/, /@Delete/, /@Patch/,  // NestJS
  /@Controller/, /@Injectable/, /@Module/,
  /@Component/, /@Service/, /@Directive/,  // Angular
  /@action/, /@computed/, /@observable/,  // MobX
  
  // Java
  /@GetMapping/, /@PostMapping/, /@RequestMapping/,
  /@Autowired/, /@Bean/, /@Component/, /@Service/,
  /@Scheduled/, /@EventListener/,
  /@Test/, /@Before/, /@After/,
  
  // C#
  /\[HttpGet\]/, /\[HttpPost\]/, /\[Route\]/,
  /\[Fact\]/, /\[Theory\]/, /\[Test\]/,
];

// ============================================================================
// Dead Code Detector
// ============================================================================

export class DeadCodeDetector {
  private graph: CallGraph;
  private entryPointSet: Set<string>;
  private useNativeQueries: boolean;
  private projectRoot: string | undefined;

  constructor(graph: CallGraph) {
    this.graph = graph;
    this.entryPointSet = new Set(graph.entryPoints);
    
    // Check if we should use native SQLite queries
    this.projectRoot = graph.projectRoot;
    const isSqliteMode = (graph as { _sqliteAvailable?: boolean })._sqliteAvailable === true;
    this.useNativeQueries = isSqliteMode && 
                            !!this.projectRoot && 
                            isNativeAvailable() && 
                            isCallGraphAvailable(this.projectRoot);
  }

  /**
   * Check if a function has callers (using native query if available)
   */
  private hasCallers(func: FunctionNode): boolean {
    // If calledBy is populated, use it
    if (func.calledBy.length > 0) {
      return true;
    }
    
    // If using native queries, check SQLite
    if (this.useNativeQueries && this.projectRoot) {
      const callers = getCallGraphCallers(this.projectRoot, func.name);
      return callers.length > 0;
    }
    
    return false;
  }

  /**
   * Detect dead code in the codebase
   */
  detect(options: DeadCodeOptions = {}): DeadCodeResult {
    const {
      includeExported = false,
      includeTests = false,
      minConfidence = 'low',
      excludePatterns = [],
    } = options;

    const candidates: DeadCodeCandidate[] = [];
    let excludedEntryPoints = 0;
    let excludedWithCallers = 0;
    let excludedFrameworkHooks = 0;

    for (const [id, func] of this.graph.functions) {
      // Skip synthetic module functions (they represent top-level code)
      if (func.name === '__module__') {
        continue;
      }

      // Skip synthetic callback functions (they're implicitly called by the functions they're passed to)
      // These have names like $map$1, $useEffect$1, $forEach$1, etc.
      if (func.name.startsWith('$') && func.name.includes('$')) {
        continue;
      }

      // Skip entry points
      if (this.entryPointSet.has(id)) {
        excludedEntryPoints++;
        continue;
      }

      // Skip functions with callers
      if (this.hasCallers(func)) {
        excludedWithCallers++;
        continue;
      }

      // Skip test files unless requested
      if (!includeTests && this.isTestFile(func.file)) {
        continue;
      }

      // Skip excluded patterns
      if (excludePatterns.some(p => func.file.includes(p))) {
        continue;
      }

      // Check for framework hooks
      if (this.isFrameworkHook(func)) {
        excludedFrameworkHooks++;
        continue;
      }

      // Skip exported unless requested
      if (!includeExported && func.isExported && !func.className) {
        continue;
      }

      // Analyze the candidate
      const candidate = this.analyzeCandidate(func);

      // Filter by confidence
      if (this.meetsConfidenceThreshold(candidate.confidence, minConfidence)) {
        candidates.push(candidate);
      }
    }

    // Sort by confidence (high first), then by lines of code
    candidates.sort((a, b) => {
      const confOrder = { high: 0, medium: 1, low: 2 };
      if (confOrder[a.confidence] !== confOrder[b.confidence]) {
        return confOrder[a.confidence] - confOrder[b.confidence];
      }
      return b.linesOfCode - a.linesOfCode;
    });

    // Build summary
    const summary = this.buildSummary(candidates);

    return {
      candidates,
      summary,
      excluded: {
        entryPoints: excludedEntryPoints,
        withCallers: excludedWithCallers,
        frameworkHooks: excludedFrameworkHooks,
      },
    };
  }

  /**
   * Analyze a function to determine if it's dead code
   */
  private analyzeCandidate(func: FunctionNode): DeadCodeCandidate {
    const possibleFalsePositives: FalsePositiveReason[] = [];
    let confidence: DeadCodeConfidence = 'high';

    // Check for patterns that might indicate false positive
    if (func.isExported) {
      possibleFalsePositives.push('export');
      confidence = 'medium';
    }

    if (func.className) {
      // Methods might be called via interface/base class
      possibleFalsePositives.push('interface-impl');
      if (confidence === 'high') {confidence = 'medium';}
    }

    if (this.hasUsedDecorator(func)) {
      possibleFalsePositives.push('framework-hook');
      confidence = 'low';
    }

    if (this.looksLikeCallback(func)) {
      possibleFalsePositives.push('callback');
      if (confidence === 'high') {confidence = 'medium';}
    }

    if (this.looksLikeDynamicCall(func)) {
      possibleFalsePositives.push('dynamic-call');
      confidence = 'low';
    }

    if (this.looksLikeEventHandler(func)) {
      possibleFalsePositives.push('event-handler');
      if (confidence === 'high') {confidence = 'medium';}
    }

    if (this.looksLikeDI(func)) {
      possibleFalsePositives.push('dependency-injection');
      confidence = 'low';
    }

    if (this.looksLikeSerializer(func)) {
      possibleFalsePositives.push('serialization');
      if (confidence === 'high') {confidence = 'medium';}
    }

    // Check for decorator factory pattern (nested functions named 'decorator', 'wrapper', etc.)
    if (this.looksLikeDecoratorWrapper(func)) {
      possibleFalsePositives.push('callback');
      confidence = 'low';
    }

    return {
      id: func.id,
      name: func.name,
      qualifiedName: func.qualifiedName,
      file: func.file,
      line: func.startLine,
      language: func.language,
      ...(func.className ? { className: func.className } : {}),
      confidence,
      possibleFalsePositives,
      linesOfCode: func.endLine - func.startLine + 1,
      hasDataAccess: func.dataAccess.length > 0,
      isExported: func.isExported,
    };
  }

  /**
   * Check if function is a framework hook
   */
  private isFrameworkHook(func: FunctionNode): boolean {
    return FRAMEWORK_HOOKS.some(pattern => pattern.test(func.name));
  }

  /**
   * Check if function has a decorator indicating it's used
   */
  private hasUsedDecorator(func: FunctionNode): boolean {
    return func.decorators.some(dec =>
      USED_DECORATOR_PATTERNS.some(pattern => pattern.test(dec))
    );
  }

  /**
   * Check if function looks like a callback
   */
  private looksLikeCallback(func: FunctionNode): boolean {
    const callbackPatterns = [
      /callback$/i, /handler$/i, /listener$/i,
      /^on_/, /^handle_/, /^process_/,
      /_cb$/, /_fn$/,
    ];
    return callbackPatterns.some(p => p.test(func.name));
  }

  /**
   * Check if function looks like a decorator wrapper (nested function in decorator factory)
   * Common patterns: decorator, wrapper, inner, wrapped
   */
  private looksLikeDecoratorWrapper(func: FunctionNode): boolean {
    // Check if it's a nested function with common decorator wrapper names
    const wrapperPatterns = [
      /^decorator$/i, /^wrapper$/i, /^inner$/i, /^wrapped$/i,
      /_decorator$/i, /_wrapper$/i,
      /^_check_/, /^_validate_/, /^_require_/,
    ];
    
    // Check if the function name matches wrapper patterns
    if (wrapperPatterns.some(p => p.test(func.name))) {
      return true;
    }
    
    // Check if it's a nested function (qualifiedName contains a dot and it's not a class method)
    if (func.qualifiedName.includes('.') && !func.className) {
      // Nested functions in Python decorators often have names like 'decorator', 'wrapper'
      const parts = func.qualifiedName.split('.');
      if (parts.length >= 2) {
        const parentName = parts[parts.length - 2]!;
        const funcName = parts[parts.length - 1]!;
        
        // If parent looks like a decorator factory and this is a wrapper
        const decoratorFactoryPatterns = [
          /^rate_limit$/i, /^require_/i, /^check_/i, /^validate_/i,
          /^auth/i, /^permission/i, /^cache/i, /^retry/i,
          /^log/i, /^trace/i, /^measure/i, /^time/i,
        ];
        
        if (decoratorFactoryPatterns.some(p => p.test(parentName))) {
          return true;
        }
        
        // Common wrapper function names
        if (['decorator', 'wrapper', 'inner', 'wrapped', '_check_limit', '_check_tier', '_check_feature'].includes(funcName)) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Check if function might be called dynamically
   */
  private looksLikeDynamicCall(func: FunctionNode): boolean {
    // Functions with generic names often called via getattr/reflection
    const dynamicPatterns = [
      /^get_/, /^set_/, /^do_/, /^execute_/,
      /^action_/, /^cmd_/, /^command_/,
    ];
    return dynamicPatterns.some(p => p.test(func.name));
  }

  /**
   * Check if function looks like an event handler
   */
  private looksLikeEventHandler(func: FunctionNode): boolean {
    const eventPatterns = [
      /^on[A-Z]/, /^handle[A-Z]/,
      /_event$/, /_signal$/, /_hook$/,
      /^emit_/, /^trigger_/,
    ];
    return eventPatterns.some(p => p.test(func.name));
  }

  /**
   * Check if function looks like it's managed by DI
   */
  private looksLikeDI(func: FunctionNode): boolean {
    // Check decorators for DI patterns
    const diDecorators = [
      /@inject/i, /@autowired/i, /@bean/i,
      /@service/i, /@component/i, /@provider/i,
      /Depends\(/,  // FastAPI
    ];
    return func.decorators.some(dec =>
      diDecorators.some(pattern => pattern.test(dec))
    );
  }

  /**
   * Check if function is a serializer method
   */
  private looksLikeSerializer(func: FunctionNode): boolean {
    const serializerPatterns = [
      /^to_/, /^from_/, /^serialize/, /^deserialize/,
      /^toJSON$/, /^fromJSON$/, /^toDict$/, /^fromDict$/,
      /^as_dict$/, /^to_dict$/, /^from_dict$/,
    ];
    return serializerPatterns.some(p => p.test(func.name));
  }

  /**
   * Check if file is a test file
   */
  private isTestFile(file: string): boolean {
    return /test[s]?[\/\\]|_test\.|\.test\.|\.spec\.|test_/.test(file);
  }

  /**
   * Check if confidence meets threshold
   */
  private meetsConfidenceThreshold(
    confidence: DeadCodeConfidence,
    threshold: DeadCodeConfidence
  ): boolean {
    const order = { high: 2, medium: 1, low: 0 };
    return order[confidence] >= order[threshold];
  }

  /**
   * Build summary statistics
   */
  private buildSummary(candidates: DeadCodeCandidate[]): DeadCodeResult['summary'] {
    const byLanguage: Record<string, number> = {};
    const byFileMap = new Map<string, { count: number; lines: number }>();
    let highConfidence = 0;
    let mediumConfidence = 0;
    let lowConfidence = 0;
    let estimatedDeadLines = 0;

    for (const c of candidates) {
      // By confidence
      if (c.confidence === 'high') {highConfidence++;}
      else if (c.confidence === 'medium') {mediumConfidence++;}
      else {lowConfidence++;}

      // By language
      byLanguage[c.language] = (byLanguage[c.language] ?? 0) + 1;

      // By file
      const fileStats = byFileMap.get(c.file) ?? { count: 0, lines: 0 };
      fileStats.count++;
      fileStats.lines += c.linesOfCode;
      byFileMap.set(c.file, fileStats);

      // Total lines
      estimatedDeadLines += c.linesOfCode;
    }

    // Sort files by count
    const byFile = Array.from(byFileMap.entries())
      .map(([file, stats]) => ({ file, ...stats }))
      .sort((a, b) => b.count - a.count);

    return {
      totalFunctions: this.graph.functions.size,
      deadCandidates: candidates.length,
      highConfidence,
      mediumConfidence,
      lowConfidence,
      estimatedDeadLines,
      byLanguage,
      byFile: byFile.slice(0, 20),  // Top 20 files
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createDeadCodeDetector(graph: CallGraph): DeadCodeDetector {
  return new DeadCodeDetector(graph);
}
