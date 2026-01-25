/**
 * Speculative Execution Engine Types
 *
 * Complete type definitions for the pre-flight simulation system.
 * Supports all 6 languages: TypeScript, JavaScript, Python, Java, C#, PHP
 *
 * @module speculative/types
 */

// ============================================================================
// Language & Framework Types
// ============================================================================

/**
 * Supported programming languages
 */
export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'java'
  | 'csharp'
  | 'php'
  | 'rust'
  | 'cpp';

/**
 * Supported frameworks by language
 */
export type TypeScriptFramework = 'express' | 'nestjs' | 'nextjs' | 'fastify' | 'koa' | 'hono';
export type PythonFramework = 'django' | 'fastapi' | 'flask' | 'starlette';
export type JavaFramework = 'spring-boot' | 'spring-webflux' | 'jakarta-ee' | 'quarkus';
export type CSharpFramework = 'aspnet-core' | 'minimal-api' | 'blazor';
export type PHPFramework = 'laravel' | 'symfony' | 'slim';

export type SupportedFramework =
  | TypeScriptFramework
  | PythonFramework
  | JavaFramework
  | CSharpFramework
  | PHPFramework;

/**
 * File extensions by language
 */
export const LANGUAGE_EXTENSIONS: Record<SupportedLanguage, string[]> = {
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py', '.pyw'],
  java: ['.java'],
  csharp: ['.cs'],
  php: ['.php'],
  rust: ['.rs'],
  cpp: ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h++', '.h'],
};

// ============================================================================
// Task Types
// ============================================================================

/**
 * High-level task categories
 */
export type TaskType =
  | 'add_api_endpoint'
  | 'add_feature'
  | 'add_auth'
  | 'add_validation'
  | 'add_caching'
  | 'add_logging'
  | 'add_error_handling'
  | 'add_test'
  | 'add_database'
  | 'add_integration'
  | 'fix_bug'
  | 'refactor'
  | 'security_fix'
  | 'performance_opt'
  | 'unknown';

/**
 * Keywords that map to task types
 */
export const TASK_TYPE_KEYWORDS: Record<TaskType, string[]> = {
  add_api_endpoint: ['endpoint', 'route', 'api', 'rest', 'graphql', 'controller', 'handler'],
  add_feature: ['feature', 'add', 'implement', 'create', 'build', 'new'],
  add_auth: ['auth', 'authentication', 'authorization', 'login', 'jwt', 'oauth', 'permission', 'guard'],
  add_validation: ['validation', 'validate', 'schema', 'input', 'sanitize', 'check'],
  add_caching: ['cache', 'caching', 'redis', 'memcache', 'memoize', 'remember'],
  add_logging: ['log', 'logging', 'logger', 'trace', 'debug', 'monitor', 'observability'],
  add_error_handling: ['error', 'exception', 'catch', 'handle', 'fallback', 'retry'],
  add_test: ['test', 'testing', 'spec', 'unit', 'integration', 'e2e', 'coverage'],
  add_database: ['database', 'db', 'query', 'migration', 'model', 'entity', 'repository'],
  add_integration: ['integration', 'webhook', 'api', 'external', 'third-party', 'service'],
  fix_bug: ['fix', 'bug', 'issue', 'problem', 'broken', 'error', 'crash'],
  refactor: ['refactor', 'clean', 'improve', 'restructure', 'reorganize', 'simplify'],
  security_fix: ['security', 'vulnerability', 'xss', 'csrf', 'injection', 'sanitize'],
  performance_opt: ['performance', 'optimize', 'speed', 'slow', 'fast', 'efficient'],
  unknown: [],
};

/**
 * Parsed task from natural language
 */
export interface ParsedTask {
  /** Original task description */
  original: string;
  /** Detected task type */
  type: TaskType;
  /** Focus area (file, directory, or feature name) */
  focus: string;
  /** Detected language */
  language: SupportedLanguage | null;
  /** Detected framework */
  framework: SupportedFramework | null;
  /** Extracted keywords */
  keywords: string[];
  /** Detected constraints */
  constraints: string[];
  /** Confidence in parsing (0-1) */
  confidence: number;
}

// ============================================================================
// Approach Types
// ============================================================================

/**
 * Implementation strategy categories
 */
export type ApproachStrategy =
  // Cross-cutting patterns
  | 'middleware'
  | 'decorator'
  | 'interceptor'
  | 'filter'
  | 'aspect'
  // Structural patterns
  | 'controller'
  | 'service'
  | 'repository'
  | 'handler'
  | 'factory'
  // Inline patterns
  | 'inline'
  | 'wrapper'
  | 'guard'
  // Configuration patterns
  | 'annotation'
  | 'attribute'
  | 'configuration'
  // Fix patterns
  | 'patch'
  | 'refactor'
  | 'defensive';

/**
 * A candidate implementation approach
 */
export interface Approach {
  /** Unique identifier (e.g., 'express-middleware') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of the approach */
  description: string;
  /** The strategy this approach uses */
  strategy: ApproachStrategy;
  /** Language this approach applies to */
  language: SupportedLanguage;
  /** Frameworks this approach works with (empty = all) */
  frameworks: SupportedFramework[];
  /** Task types this approach is applicable to */
  applicableTo: TaskType[];
  /** Prerequisites for this approach */
  prerequisites: string[];
  /** Example implementation hint */
  implementationHint: string;
  /** Typical file patterns created/modified */
  filePatterns: string[];
  /** Estimated lines of code */
  estimatedLoc: { min: number; max: number };
}

// ============================================================================
// Simulation Types
// ============================================================================

/**
 * A file or function that would be affected
 */
export interface TouchPoint {
  /** File path (relative to project root) */
  file: string;
  /** Action required */
  action: 'create' | 'modify' | 'delete';
  /** Estimated lines changed (for modify) */
  linesChanged?: number;
  /** Specific functions affected */
  functions?: string[];
  /** Reason for the change */
  reason: string;
  /** Confidence in this touch point (0-1) */
  confidence: number;
}

/**
 * Impact on the call graph
 */
export interface CallGraphImpact {
  /** Functions directly affected */
  directlyAffected: number;
  /** Functions transitively affected */
  transitivelyAffected: number;
  /** Entry points affected */
  entryPointsAffected: number;
  /** Maximum depth of impact */
  maxDepth: number;
  /** Affected entry point names (limited) */
  affectedEntryPoints: string[];
}

/**
 * Alignment with existing patterns
 */
export interface PatternAlignment {
  /** Patterns this approach aligns with */
  alignedPatterns: Array<{
    id: string;
    name: string;
    category: string;
    confidence: number;
    locationCount: number;
  }>;
  /** Overall alignment score (0-1) */
  score: number;
  /** Would this create outliers? */
  createsOutliers: boolean;
  /** Note about alignment */
  note?: string;
}

/**
 * Change in module coupling
 */
export interface CouplingDelta {
  /** New dependencies added */
  newDependencies: string[];
  /** Dependencies removed */
  removedDependencies: string[];
  /** Would this create a cycle? */
  createsCycle: boolean;
  /** Cycle details if applicable */
  cycleDetails?: string;
  /** Change in instability metric (-1 to 1) */
  instabilityDelta: number;
  /** Affected modules */
  affectedModules: string[];
}

/**
 * Security implications
 */
export interface SecurityPath {
  /** Type of security concern */
  type: 'sensitive_data' | 'auth_bypass' | 'injection_risk' | 'exposure' | 'privilege_escalation';
  /** Description */
  description: string;
  /** Severity */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Affected data/paths */
  affected: string[];
  /** Mitigation suggestion */
  mitigation?: string;
}

/**
 * Test coverage for affected code
 */
export interface TestCoverage {
  /** Average coverage of affected files (0-1) */
  averageCoverage: number;
  /** Files with no test coverage */
  uncoveredFiles: string[];
  /** Existing tests that might need updates */
  affectedTests: string[];
  /** Suggested test types */
  suggestedTestTypes: ('unit' | 'integration' | 'e2e')[];
  /** Test files that cover affected code */
  coveringTests: string[];
}

/**
 * Complete simulation result for an approach
 */
export interface SimulationResult {
  /** Touch points */
  touchPoints: TouchPoint[];
  /** Call graph impact */
  callGraphImpact: CallGraphImpact;
  /** Pattern alignment */
  patternAlignment: PatternAlignment;
  /** Coupling changes */
  couplingDelta: CouplingDelta;
  /** Security paths */
  securityPaths: SecurityPath[];
  /** Test coverage */
  testCoverage: TestCoverage;
}

// ============================================================================
// Scoring Types
// ============================================================================

/**
 * Friction breakdown by dimension
 */
export interface FrictionBreakdown {
  /** Structural friction (0-100) */
  structural: number;
  /** Pattern alignment friction (0-100) */
  pattern: number;
  /** Coupling friction (0-100) */
  coupling: number;
  /** Security friction (0-100) */
  security: number;
  /** Test coverage friction (0-100) */
  test: number;
}

/**
 * Friction weights (must sum to 1.0)
 */
export interface FrictionWeights {
  structural: number;
  pattern: number;
  coupling: number;
  security: number;
  test: number;
}

/**
 * Default friction weights
 */
export const DEFAULT_FRICTION_WEIGHTS: FrictionWeights = {
  structural: 0.25,
  pattern: 0.30,
  coupling: 0.15,
  security: 0.15,
  test: 0.15,
};

/**
 * Effort estimation levels
 */
export type EffortLevel = 'trivial' | 'small' | 'medium' | 'large';

/**
 * Effort thresholds (in estimated minutes)
 */
export const EFFORT_THRESHOLDS: Record<EffortLevel, { min: number; max: number }> = {
  trivial: { min: 0, max: 15 },
  small: { min: 15, max: 60 },
  medium: { min: 60, max: 240 },
  large: { min: 240, max: Infinity },
};

// ============================================================================
// Evaluation Types
// ============================================================================

/**
 * Complete evaluation of an approach
 */
export interface ApproachEvaluation {
  /** The approach being evaluated */
  approach: Approach;
  /** Simulation results */
  simulation: SimulationResult;
  /** Overall friction score (0-100, lower is better) */
  frictionScore: number;
  /** Friction breakdown by dimension */
  frictionBreakdown: FrictionBreakdown;
  /** Pros of this approach */
  pros: string[];
  /** Cons of this approach */
  cons: string[];
  /** Estimated effort */
  effort: EffortLevel;
  /** Confidence in this evaluation (0-1) */
  confidence: number;
  /** Rank among evaluated approaches (1 = best) */
  rank: number;
}

/**
 * A trade-off to consider
 */
export interface Tradeoff {
  /** Condition when this trade-off applies */
  if: string;
  /** What to do instead */
  then: string;
  /** Reasoning */
  because: string;
  /** Which approach this favors */
  favorsApproach?: string;
}

/**
 * Warning about simulation
 */
export interface SimulationWarning {
  /** Warning type */
  type: 'security' | 'breaking_change' | 'complexity' | 'missing_data' | 'low_confidence' | 'deprecated';
  /** Warning message */
  message: string;
  /** Severity */
  severity: 'info' | 'warning' | 'critical';
  /** Related approach ID (if specific to one) */
  approachId?: string;
}

/**
 * Recommendation from the engine
 */
export interface Recommendation {
  /** Recommended approach ID */
  approachId: string;
  /** Approach name */
  approachName: string;
  /** Reasoning for the recommendation */
  reasoning: string;
  /** Confidence in recommendation (0-1) */
  confidence: number;
  /** How much better than alternatives (percentage) */
  advantagePercent: number;
}

// ============================================================================
// Engine Input/Output Types
// ============================================================================

/**
 * Input to the speculative execution engine
 */
export interface SimulateInput {
  /** Natural language task description */
  task: string;
  /** Optional: specific area to focus on (file or directory) */
  focus?: string;
  /** Optional: specific approach IDs to evaluate */
  approaches?: string[];
  /** Optional: constraints to consider */
  constraints?: string[];
  /** Maximum approaches to evaluate (default: 4) */
  maxApproaches?: number;
  /** Custom friction weights */
  weights?: Partial<FrictionWeights>;
  /** Target project name (for multi-project support) */
  project?: string;
}

/**
 * Output from the speculative execution engine
 */
export interface SimulateOutput {
  /** Summary of the simulation */
  summary: string;
  /** Parsed task */
  task: ParsedTask;
  /** Evaluated approaches (sorted by friction, best first) */
  approaches: ApproachEvaluation[];
  /** Recommendation */
  recommendation: Recommendation;
  /** Trade-offs to consider */
  tradeoffs: Tradeoff[];
  /** Warnings */
  warnings: SimulationWarning[];
  /** Metadata */
  metadata: SimulationMetadata;
}

/**
 * Simulation metadata
 */
export interface SimulationMetadata {
  /** Time taken in ms */
  durationMs: number;
  /** Data sources used */
  dataSources: ('patterns' | 'callgraph' | 'coupling' | 'boundaries' | 'tests')[];
  /** Engine version */
  version: string;
  /** Project root */
  projectRoot: string;
  /** Whether data was from cache */
  fromCache: boolean;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Engine configuration
 */
export interface SpeculativeEngineConfig {
  /** Project root directory */
  rootDir: string;
  /** Maximum approaches to generate */
  maxApproaches: number;
  /** Maximum depth for call graph traversal */
  maxCallGraphDepth: number;
  /** Friction weights */
  weights: FrictionWeights;
  /** Enable caching */
  enableCache: boolean;
  /** Cache TTL in ms */
  cacheTtlMs: number;
  /** Minimum confidence to include an approach */
  minApproachConfidence: number;
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: SpeculativeEngineConfig = {
  rootDir: '.',
  maxApproaches: 4,
  maxCallGraphDepth: 10,
  weights: DEFAULT_FRICTION_WEIGHTS,
  enableCache: true,
  cacheTtlMs: 5 * 60 * 1000, // 5 minutes
  minApproachConfidence: 0.3,
};

// ============================================================================
// Template Types
// ============================================================================

/**
 * Approach template definition
 */
export interface ApproachTemplate {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Strategy type */
  strategy: ApproachStrategy;
  /** Language */
  language: SupportedLanguage;
  /** Compatible frameworks (empty = all) */
  frameworks: SupportedFramework[];
  /** Applicable task types */
  taskTypes: TaskType[];
  /** Prerequisites (patterns, dependencies, etc.) */
  prerequisites: string[];
  /** Implementation hint */
  hint: string;
  /** File patterns typically created/modified */
  filePatterns: string[];
  /** Estimated LOC range */
  locRange: [number, number];
  /** Keywords that suggest this approach */
  keywords: string[];
  /** Priority when multiple approaches match (higher = preferred) */
  priority: number;
}

/**
 * Template registry interface
 */
export interface TemplateRegistry {
  /** Get all templates */
  getAll(): ApproachTemplate[];
  /** Get templates for a language */
  getByLanguage(language: SupportedLanguage): ApproachTemplate[];
  /** Get templates for a task type */
  getByTaskType(taskType: TaskType): ApproachTemplate[];
  /** Get templates matching criteria */
  query(criteria: TemplateQueryCriteria): ApproachTemplate[];
  /** Get a specific template by ID */
  get(id: string): ApproachTemplate | undefined;
}

/**
 * Criteria for querying templates
 */
export interface TemplateQueryCriteria {
  language?: SupportedLanguage;
  framework?: SupportedFramework;
  taskType?: TaskType;
  strategy?: ApproachStrategy;
  keywords?: string[];
  maxResults?: number;
}

// ============================================================================
// Store Dependencies
// ============================================================================

/**
 * Dependencies required by the speculative engine
 */
export interface SpeculativeEngineDependencies {
  /** Pattern store for pattern alignment */
  patternStore: {
    initialize(): Promise<void>;
    getAll(): Array<{
      id: string;
      name: string;
      category: string;
      confidence: { score: number };
      locations: Array<{ file: string; line: number }>;
      outliers: Array<{ file: string; line: number }>;
    }>;
  };
  /** Call graph store for impact analysis */
  callGraphStore: {
    initialize(): Promise<void>;
    getGraph(): {
      functions: Map<string, { file: string; name: string; calls: unknown[]; calledBy: unknown[] }>;
      entryPoints: string[];
    } | null;
  };
  /** Coupling analyzer for coupling delta */
  couplingAnalyzer: {
    getGraph(): {
      modules: Map<string, { imports: string[]; importedBy: string[] }>;
      cycles: Array<{ path: string[] }>;
    } | null;
  };
  /** Boundary store for security analysis */
  boundaryStore: {
    initialize(): Promise<void>;
    getAccessMap(): {
      sensitiveFields: Array<{ table: string; field: string; file: string }>;
    } | null;
  };
  /** Test topology analyzer for test coverage */
  testTopologyAnalyzer: {
    getCoverage(file: string): { coverage: number; tests: string[] } | null;
  };
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Async result type
 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;
