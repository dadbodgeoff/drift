/**
 * Quality Gates System - Type Definitions
 * 
 * @license Apache-2.0
 * 
 * This file contains all type definitions for the quality gates system.
 * Types are organized into logical sections for maintainability.
 * 
 * LICENSING NOTE: All features are available to all users initially.
 * The licensing infrastructure is in place but NOT enforced.
 * See FUTURE_GATE comments for where license checks should be added.
 */

// =============================================================================
// SECTION 1: Core Enums and Constants
// =============================================================================

/**
 * Gate execution status
 */
export type GateStatus = 'passed' | 'failed' | 'warned' | 'skipped' | 'errored';

/**
 * Severity levels for violations
 */
export type ViolationSeverity = 'error' | 'warning' | 'info' | 'hint';

/**
 * Gate identifiers - each gate has a unique ID
 */
export type GateId = 
  | 'pattern-compliance'
  | 'constraint-verification'
  | 'regression-detection'
  | 'impact-simulation'
  | 'security-boundary'
  | 'custom-rules';

/**
 * Output format options
 */
export type OutputFormat = 
  | 'text' 
  | 'json' 
  | 'github' 
  | 'gitlab' 
  | 'sarif'
  | 'webhook';

/**
 * Policy aggregation modes
 */
export type AggregationMode = 'any' | 'all' | 'weighted' | 'threshold';

// =============================================================================
// SECTION 2: Gate Input/Output Types
// =============================================================================

/**
 * Input provided to all gates
 */
export interface GateInput {
  /** Files to check (relative paths) */
  files: string[];
  
  /** Project root directory */
  projectRoot: string;
  
  /** Current branch name */
  branch: string;
  
  /** Base branch for comparison (for PRs) */
  baseBranch?: string;
  
  /** Commit SHA being checked */
  commitSha?: string;
  
  /** Whether running in CI environment */
  isCI: boolean;
  
  /** Gate-specific configuration */
  config: GateConfig;
  
  /** Shared context from orchestrator */
  context: GateContext;
}

/**
 * Shared context available to all gates
 * Populated by orchestrator to avoid redundant loading
 */
export interface GateContext {
  /** Loaded patterns (if available) */
  patterns?: Pattern[];
  
  /** Loaded constraints (if available) */
  constraints?: Constraint[];
  
  /** Call graph (if available) */
  callGraph?: CallGraph;
  
  /** Previous snapshot for comparison (if available) */
  previousSnapshot?: HealthSnapshot;
  
  /** Custom rules (if available) */
  customRules?: CustomRule[];
}

// Simplified types for external dependencies
export interface Pattern {
  id: string;
  name: string;
  status: 'approved' | 'discovered' | 'ignored';
  confidence: number;
  category: string;
  locations?: Array<{ file: string; line: number }>;
  outliers?: Array<{ file: string; line: number; reason: string }>;
}

export interface Constraint {
  id: string;
  description: string;
  status: 'approved' | 'discovered' | 'ignored';
  confidence: number;
  category: string;
}

export interface CallGraph {
  nodes: Map<string, CallGraphNode>;
  edges: Array<{ from: string; to: string }>;
}

export interface CallGraphNode {
  id: string;
  file: string;
  name: string;
  type: 'function' | 'method' | 'class';
}

/**
 * Base result returned by all gates
 */
export interface GateResult {
  /** Gate identifier */
  gateId: GateId;
  
  /** Gate display name */
  gateName: string;
  
  /** Execution status */
  status: GateStatus;
  
  /** Whether the gate passed */
  passed: boolean;
  
  /** Score out of 100 */
  score: number;
  
  /** Human-readable summary */
  summary: string;
  
  /** Detailed violations */
  violations: GateViolation[];
  
  /** Warnings (non-blocking) */
  warnings: string[];
  
  /** Execution time in milliseconds */
  executionTimeMs: number;
  
  /** Gate-specific details */
  details: Record<string, unknown>;
  
  /** Error message if status is 'errored' */
  error?: string;
}

/**
 * A single violation from a gate
 */
export interface GateViolation {
  /** Unique violation ID */
  id: string;
  
  /** Gate that produced this violation */
  gateId: GateId;
  
  /** Severity level */
  severity: ViolationSeverity;
  
  /** File path (relative) */
  file: string;
  
  /** Line number (1-indexed) */
  line: number;
  
  /** Column number (1-indexed) */
  column: number;
  
  /** End line (optional) */
  endLine?: number;
  
  /** End column (optional) */
  endColumn?: number;
  
  /** Short message */
  message: string;
  
  /** Detailed explanation */
  explanation: string;
  
  /** Rule or pattern ID that was violated */
  ruleId: string;
  
  /** Suggested fix (if available) */
  suggestedFix?: string;
  
  /** Documentation URL */
  documentationUrl?: string;
}

// =============================================================================
// SECTION 3: Gate-Specific Configuration Types
// =============================================================================

/**
 * Base configuration for all gates
 */
export interface BaseGateConfig {
  /** Whether this gate is enabled */
  enabled: boolean;
  
  /** Whether failures block the pipeline */
  blocking: boolean;
  
  /** Custom thresholds override defaults */
  thresholds?: Record<string, number>;
}

/**
 * Pattern Compliance Gate configuration
 */
export interface PatternComplianceConfig extends BaseGateConfig {
  /** Minimum compliance rate (0-100) */
  minComplianceRate: number;
  
  /** Maximum new outliers allowed */
  maxNewOutliers: number;
  
  /** Pattern categories to check (empty = all) */
  categories: string[];
  
  /** Minimum pattern confidence to consider */
  minPatternConfidence: number;
  
  /** Whether to check only approved patterns */
  approvedOnly: boolean;
}

/**
 * Constraint Verification Gate configuration
 * FUTURE_GATE: gate:policy-engine (Team tier for advanced constraint management)
 */
export interface ConstraintVerificationConfig extends BaseGateConfig {
  /** Enforce approved constraints */
  enforceApproved: boolean;
  
  /** Enforce discovered constraints (usually false) */
  enforceDiscovered: boolean;
  
  /** Minimum constraint confidence to enforce */
  minConfidence: number;
  
  /** Constraint categories to check (empty = all) */
  categories: string[];
}

/**
 * Regression Detection Gate configuration
 * FUTURE_GATE: gate:regression-detection (Team tier)
 */
export interface RegressionDetectionConfig extends BaseGateConfig {
  /** Maximum allowed confidence drop (percentage points) */
  maxConfidenceDrop: number;
  
  /** Maximum allowed compliance drop (percentage points) */
  maxComplianceDrop: number;
  
  /** Maximum new outliers per pattern */
  maxNewOutliersPerPattern: number;
  
  /** Categories where ANY regression fails */
  criticalCategories: string[];
  
  /** Comparison baseline ('previous-commit' | 'branch-base' | 'snapshot') */
  baseline: 'previous-commit' | 'branch-base' | 'snapshot';
}

/**
 * Impact Simulation Gate configuration
 * FUTURE_GATE: gate:impact-simulation (Enterprise tier)
 */
export interface ImpactSimulationConfig extends BaseGateConfig {
  /** Maximum downstream files affected */
  maxFilesAffected: number;
  
  /** Maximum downstream functions affected */
  maxFunctionsAffected: number;
  
  /** Maximum API entry points affected */
  maxEntryPointsAffected: number;
  
  /** Maximum friction score (0-100) */
  maxFrictionScore: number;
  
  /** Whether to analyze sensitive data paths */
  analyzeSensitiveData: boolean;
}

/**
 * Security Boundary Gate configuration
 * FUTURE_GATE: gate:security-boundary (Enterprise tier)
 */
export interface SecurityBoundaryConfig extends BaseGateConfig {
  /** Allow new sensitive data access points */
  allowNewSensitiveAccess: boolean;
  
  /** Tables that MUST have auth in call chain */
  protectedTables: string[];
  
  /** Maximum hops to sensitive data */
  maxDataFlowDepth: number;
  
  /** Required auth patterns in call chain */
  requiredAuthPatterns: string[];
}

/**
 * Custom Rules Gate configuration
 * FUTURE_GATE: gate:custom-rules (Team tier)
 */
export interface CustomRulesConfig extends BaseGateConfig {
  /** Rule files to load */
  ruleFiles: string[];
  
  /** Inline rule definitions */
  inlineRules: CustomRule[];
  
  /** Whether to use built-in rules */
  useBuiltInRules: boolean;
}

/**
 * Union type for all gate configs
 */
export type GateConfig = 
  | PatternComplianceConfig
  | ConstraintVerificationConfig
  | RegressionDetectionConfig
  | ImpactSimulationConfig
  | SecurityBoundaryConfig
  | CustomRulesConfig;


// =============================================================================
// SECTION 4: Gate-Specific Result Types
// =============================================================================

/**
 * Pattern Compliance Gate result details
 */
export interface PatternComplianceDetails {
  /** Overall compliance rate (0-100) */
  complianceRate: number;
  
  /** Number of patterns checked */
  patternsChecked: number;
  
  /** Number of files checked */
  filesChecked: number;
  
  /** New outliers introduced */
  newOutliers: OutlierDetail[];
  
  /** Existing outliers in changed files */
  existingOutliers: number;
  
  /** Compliance by category */
  byCategory: Record<string, { compliant: number; total: number }>;
}

/**
 * Detail about a single outlier
 */
export interface OutlierDetail {
  /** Pattern ID */
  patternId: string;
  
  /** Pattern name */
  patternName: string;
  
  /** File path */
  file: string;
  
  /** Line number */
  line: number;
  
  /** Reason for outlier */
  reason: string;
  
  /** Whether this is a new outlier (not in baseline) */
  isNew: boolean;
}

/**
 * Constraint Verification Gate result details
 */
export interface ConstraintVerificationDetails {
  /** Constraints that passed */
  satisfied: ConstraintResult[];
  
  /** Constraints that failed */
  violated: ConstraintViolationDetail[];
  
  /** Constraints that were skipped */
  skipped: SkippedConstraint[];
  
  /** Results by category */
  byCategory: Record<string, { passed: number; failed: number }>;
}

/**
 * Result for a single constraint check
 */
export interface ConstraintResult {
  /** Constraint ID */
  constraintId: string;
  
  /** Constraint description */
  description: string;
  
  /** Whether it passed */
  passed: boolean;
  
  /** Confidence in the result */
  confidence: number;
}

/**
 * Detail about a constraint violation
 */
export interface ConstraintViolationDetail {
  /** Constraint ID */
  constraintId: string;
  
  /** Constraint description */
  description: string;
  
  /** Files that violate */
  violatingFiles: string[];
  
  /** Specific violation locations */
  locations: Array<{ file: string; line: number; reason: string }>;
}

/**
 * Constraint that was skipped
 */
export interface SkippedConstraint {
  /** Constraint ID */
  constraintId: string;
  
  /** Reason for skipping */
  reason: string;
}

/**
 * Regression Detection Gate result details
 */
export interface RegressionDetectionDetails {
  /** Patterns that regressed */
  regressions: PatternRegression[];
  
  /** Patterns that improved */
  improvements: PatternImprovement[];
  
  /** Overall health delta (-100 to +100) */
  overallHealthDelta: number;
  
  /** Health delta by category */
  categoryDeltas: Record<string, number>;
  
  /** Baseline used for comparison */
  baseline: {
    type: 'previous-commit' | 'branch-base' | 'snapshot';
    reference: string;
    timestamp: string;
  };
}

/**
 * A pattern that regressed
 */
export interface PatternRegression {
  /** Pattern ID */
  patternId: string;
  
  /** Pattern name */
  patternName: string;
  
  /** Previous confidence */
  previousConfidence: number;
  
  /** Current confidence */
  currentConfidence: number;
  
  /** Confidence delta */
  confidenceDelta: number;
  
  /** Previous compliance */
  previousCompliance: number;
  
  /** Current compliance */
  currentCompliance: number;
  
  /** Compliance delta */
  complianceDelta: number;
  
  /** New outliers introduced */
  newOutliers: number;
  
  /** Severity of regression */
  severity: 'minor' | 'moderate' | 'severe';
}

/**
 * A pattern that improved
 */
export interface PatternImprovement {
  /** Pattern ID */
  patternId: string;
  
  /** Pattern name */
  patternName: string;
  
  /** Confidence improvement */
  confidenceImprovement: number;
  
  /** Compliance improvement */
  complianceImprovement: number;
  
  /** Outliers fixed */
  outliersFixed: number;
}

/**
 * Impact Simulation Gate result details
 */
export interface ImpactSimulationDetails {
  /** Number of files affected */
  filesAffected: number;
  
  /** Number of functions affected */
  functionsAffected: number;
  
  /** Entry points affected */
  entryPointsAffected: string[];
  
  /** Friction score (0-100) */
  frictionScore: number;
  
  /** Breaking risk assessment */
  breakingRisk: 'low' | 'medium' | 'high' | 'critical';
  
  /** Sensitive data paths affected */
  sensitiveDataPaths: SensitiveDataPath[];
  
  /** Affected files list */
  affectedFiles: AffectedFile[];
}

/**
 * A sensitive data path
 */
export interface SensitiveDataPath {
  /** Starting point */
  from: string;
  
  /** Sensitive data accessed */
  sensitiveData: string;
  
  /** Path through code */
  path: string[];
}

/**
 * An affected file
 */
export interface AffectedFile {
  /** File path */
  file: string;
  
  /** How it's affected */
  affectedBy: 'direct' | 'transitive';
  
  /** Distance from changed file */
  distance: number;
}

/**
 * Security Boundary Gate result details
 */
export interface SecurityBoundaryDetails {
  /** New sensitive data access points */
  newSensitiveAccess: DataAccessPoint[];
  
  /** Unauthorized access paths */
  unauthorizedPaths: UnauthorizedPath[];
  
  /** Tables accessed by changed code */
  tablesAccessed: string[];
  
  /** Auth coverage percentage */
  authCoverage: number;
  
  /** Protected tables status */
  protectedTablesStatus: Record<string, 'protected' | 'unprotected' | 'partial'>;
}

/**
 * A data access point
 */
export interface DataAccessPoint {
  /** File where access occurs */
  file: string;
  
  /** Line number */
  line: number;
  
  /** Table/data being accessed */
  dataAccessed: string;
  
  /** Type of access */
  accessType: 'read' | 'write' | 'delete';
  
  /** Whether auth is in call chain */
  hasAuth: boolean;
}

/**
 * An unauthorized access path
 */
export interface UnauthorizedPath {
  /** Entry point */
  entryPoint: string;
  
  /** Sensitive data reached */
  sensitiveData: string;
  
  /** Path through code */
  path: string[];
  
  /** Missing auth check */
  missingAuth: string;
}

/**
 * Custom Rules Gate result details
 */
export interface CustomRulesDetails {
  /** Results for each rule */
  ruleResults: RuleResult[];
  
  /** Rules that failed */
  failedRules: string[];
  
  /** Rules that passed */
  passedRules: string[];
  
  /** Rules that were skipped */
  skippedRules: string[];
}

/**
 * Result for a single rule
 */
export interface RuleResult {
  /** Rule ID */
  ruleId: string;
  
  /** Rule name */
  ruleName: string;
  
  /** Whether it passed */
  passed: boolean;
  
  /** Violations if failed */
  violations: RuleViolation[];
  
  /** Files checked */
  filesChecked: number;
}

/**
 * A rule violation
 */
export interface RuleViolation {
  /** File path */
  file: string;
  
  /** Line number */
  line: number;
  
  /** Violation message */
  message: string;
}


// =============================================================================
// SECTION 5: Custom Rule Types
// =============================================================================

/**
 * A custom rule definition
 */
export interface CustomRule {
  /** Unique rule ID */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Description of what the rule checks */
  description: string;
  
  /** Severity when violated */
  severity: ViolationSeverity;
  
  /** Rule condition */
  condition: RuleCondition;
  
  /** Message to show when violated */
  message: string;
  
  /** Documentation URL */
  documentationUrl?: string;
  
  /** Whether rule is enabled */
  enabled: boolean;
  
  /** Tags for categorization */
  tags: string[];
}

/**
 * Rule condition types
 */
export type RuleCondition = 
  | FilePatternCondition
  | ContentPatternCondition
  | DependencyCondition
  | NamingCondition
  | StructureCondition
  | CompositeCondition;

/**
 * File pattern condition
 */
export interface FilePatternCondition {
  type: 'file-pattern';
  
  /** Files that must exist matching pattern */
  mustExist?: string;
  
  /** Files that must not exist matching pattern */
  mustNotExist?: string;
  
  /** For each file matching this pattern... */
  forEachFile?: string;
  
  /** ...there must be a corresponding file matching this */
  correspondingFile?: string;
}

/**
 * Content pattern condition
 */
export interface ContentPatternCondition {
  type: 'content-pattern';
  
  /** Files to check */
  files: string;
  
  /** Pattern that must be present */
  mustContain?: string;
  
  /** Pattern that must not be present */
  mustNotContain?: string;
  
  /** Regex pattern */
  regex?: string;
}

/**
 * Dependency condition
 */
export interface DependencyCondition {
  type: 'dependency';
  
  /** Source files */
  from: string;
  
  /** Cannot import from */
  cannotImport?: string;
  
  /** Must import from */
  mustImport?: string;
}

/**
 * Naming condition
 */
export interface NamingCondition {
  type: 'naming';
  
  /** Files to check */
  files: string;
  
  /** Naming pattern (regex) */
  pattern: string;
  
  /** What should match (file, class, function, variable) */
  target: 'file' | 'class' | 'function' | 'variable';
}

/**
 * Structure condition
 */
export interface StructureCondition {
  type: 'structure';
  
  /** Directory that must exist */
  directoryMustExist?: string;
  
  /** File that must exist */
  fileMustExist?: string;
  
  /** Maximum file count in directory */
  maxFilesInDirectory?: { directory: string; max: number };
}

/**
 * Composite condition (AND/OR)
 */
export interface CompositeCondition {
  type: 'composite';
  
  /** Operator */
  operator: 'and' | 'or' | 'not';
  
  /** Child conditions */
  conditions: RuleCondition[];
}

// =============================================================================
// SECTION 6: Policy Types
// =============================================================================

/**
 * A quality gate policy
 * FUTURE_GATE: gate:policy-engine (Team tier for multiple policies)
 */
export interface QualityPolicy {
  /** Unique policy ID */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Description */
  description: string;
  
  /** Policy version */
  version: string;
  
  /** When this policy applies */
  scope: PolicyScope;
  
  /** Gate configurations */
  gates: PolicyGateConfigs;
  
  /** How to aggregate gate results */
  aggregation: AggregationConfig;
  
  /** Actions to take based on result */
  actions: PolicyActions;
  
  /** Policy metadata */
  metadata: {
    createdAt: string;
    updatedAt: string;
    createdBy?: string;
  };
}

/**
 * Policy scope - when the policy applies
 */
export interface PolicyScope {
  /** Branch patterns (glob) */
  branches?: string[];
  
  /** Path patterns (glob) */
  paths?: string[];
  
  /** Author patterns (for different rules for bots) */
  authors?: string[];
  
  /** File patterns to include */
  includeFiles?: string[];
  
  /** File patterns to exclude */
  excludeFiles?: string[];
  
  /** Time-based scope (e.g., stricter before release) */
  timeRange?: {
    after?: string;
    before?: string;
  };
}

/**
 * Gate configurations within a policy
 */
export interface PolicyGateConfigs {
  'pattern-compliance': PatternComplianceConfig | 'skip';
  'constraint-verification': ConstraintVerificationConfig | 'skip';
  'regression-detection': RegressionDetectionConfig | 'skip';
  'impact-simulation': ImpactSimulationConfig | 'skip';
  'security-boundary': SecurityBoundaryConfig | 'skip';
  'custom-rules': CustomRulesConfig | 'skip';
}

/**
 * Aggregation configuration
 */
export interface AggregationConfig {
  /** How to determine overall pass/fail */
  mode: AggregationMode;
  
  /** Weights for weighted mode */
  weights?: Record<GateId, number>;
  
  /** Minimum score for threshold mode */
  minScore?: number;
  
  /** Gates that must pass regardless of mode */
  requiredGates?: GateId[];
}

/**
 * Actions to take based on result
 */
export interface PolicyActions {
  /** Actions on pass */
  onPass: PolicyAction[];
  
  /** Actions on fail */
  onFail: PolicyAction[];
  
  /** Actions on warn */
  onWarn: PolicyAction[];
}

/**
 * A single policy action
 * FUTURE_GATE: integration:webhooks, integration:slack, integration:jira (Enterprise tier)
 */
export type PolicyAction = 
  | { type: 'comment'; template: string }
  | { type: 'label'; add?: string[]; remove?: string[] }
  | { type: 'webhook'; url: string; payload?: Record<string, unknown> }
  | { type: 'slack'; channel: string; message: string }
  | { type: 'jira'; project: string; issueType: string };


// =============================================================================
// SECTION 7: Orchestrator Types
// =============================================================================

/**
 * Options for running quality gates
 */
export interface QualityGateOptions {
  /** Project root directory */
  projectRoot: string;
  
  /** Files to check (if not specified, uses staged/changed files) */
  files?: string[];
  
  /** Policy to use (ID or inline) */
  policy?: string | QualityPolicy;
  
  /** Specific gates to run (overrides policy) */
  gates?: GateId[];
  
  /** Output format */
  format?: OutputFormat;
  
  /** Whether running in CI */
  ci?: boolean;
  
  /** Verbose output */
  verbose?: boolean;
  
  /** Dry run (show what would be checked) */
  dryRun?: boolean;
  
  /** Branch name */
  branch?: string;
  
  /** Base branch for comparison */
  baseBranch?: string;
  
  /** Commit SHA */
  commitSha?: string;
  
  /** Webhook URL for results */
  webhookUrl?: string;
  
  /** Save results to history */
  saveHistory?: boolean;
}

/**
 * Overall quality gate result
 */
export interface QualityGateResult {
  /** Overall pass/fail */
  passed: boolean;
  
  /** Overall status */
  status: GateStatus;
  
  /** Overall score (0-100) */
  score: number;
  
  /** Human-readable summary */
  summary: string;
  
  /** Individual gate results */
  gates: Record<GateId, GateResult>;
  
  /** All violations across gates */
  violations: GateViolation[];
  
  /** All warnings across gates */
  warnings: string[];
  
  /** Policy that was applied */
  policy: {
    id: string;
    name: string;
  };
  
  /** Execution metadata */
  metadata: {
    /** Total execution time */
    executionTimeMs: number;
    
    /** Files checked */
    filesChecked: number;
    
    /** Gates run */
    gatesRun: GateId[];
    
    /** Gates skipped */
    gatesSkipped: GateId[];
    
    /** Timestamp */
    timestamp: string;
    
    /** Branch */
    branch: string;
    
    /** Commit SHA */
    commitSha?: string;
    
    /** CI environment */
    ci: boolean;
  };
  
  /** Exit code for CLI */
  exitCode: number;
}

// =============================================================================
// SECTION 8: Health Snapshot Types
// =============================================================================

/**
 * A point-in-time snapshot of codebase health
 */
export interface HealthSnapshot {
  /** Snapshot ID */
  id: string;
  
  /** Branch name */
  branch: string;
  
  /** Commit SHA */
  commitSha: string;
  
  /** Timestamp */
  timestamp: string;
  
  /** Overall health score */
  healthScore: number;
  
  /** Pattern health */
  patterns: PatternHealthSnapshot[];
  
  /** Constraint health */
  constraints: ConstraintHealthSnapshot[];
  
  /** Security health */
  security: SecurityHealthSnapshot;
  
  /** Metadata */
  metadata: {
    filesAnalyzed: number;
    patternsAnalyzed: number;
    constraintsAnalyzed: number;
  };
}

/**
 * Pattern health in a snapshot
 */
export interface PatternHealthSnapshot {
  /** Pattern ID */
  patternId: string;
  
  /** Pattern name */
  patternName: string;
  
  /** Category */
  category: string;
  
  /** Confidence score */
  confidence: number;
  
  /** Compliance rate */
  compliance: number;
  
  /** Number of locations */
  locations: number;
  
  /** Number of outliers */
  outliers: number;
}

/**
 * Constraint health in a snapshot
 */
export interface ConstraintHealthSnapshot {
  /** Constraint ID */
  constraintId: string;
  
  /** Description */
  description: string;
  
  /** Category */
  category: string;
  
  /** Whether satisfied */
  satisfied: boolean;
  
  /** Confidence */
  confidence: number;
}

/**
 * Security health in a snapshot
 */
export interface SecurityHealthSnapshot {
  /** Auth coverage */
  authCoverage: number;
  
  /** Sensitive data access points */
  sensitiveAccessPoints: number;
  
  /** Protected tables */
  protectedTables: number;
  
  /** Unprotected tables */
  unprotectedTables: number;
}

// =============================================================================
// SECTION 9: Reporter Types
// =============================================================================

/**
 * Reporter options
 */
export interface ReporterOptions {
  /** Output file path (if writing to file) */
  outputPath?: string;
  
  /** Verbose output */
  verbose?: boolean;
  
  /** Include suggestions */
  includeSuggestions?: boolean;
  
  /** Include code snippets */
  includeCodeSnippets?: boolean;
  
  /** Webhook URL (for webhook reporter) */
  webhookUrl?: string;
  
  /** GitHub token (for GitHub reporter) */
  githubToken?: string;
  
  /** GitLab token (for GitLab reporter) */
  gitlabToken?: string;
}

// =============================================================================
// SECTION 10: Store Types
// =============================================================================

/**
 * Gate run record
 */
export interface GateRunRecord {
  /** Run ID */
  id: string;
  
  /** Timestamp */
  timestamp: string;
  
  /** Branch */
  branch: string;
  
  /** Commit SHA */
  commitSha?: string;
  
  /** Policy used */
  policyId: string;
  
  /** Overall result */
  passed: boolean;
  
  /** Score */
  score: number;
  
  /** Gate results summary */
  gates: Record<GateId, { passed: boolean; score: number }>;
  
  /** Violation count */
  violationCount: number;
  
  /** Execution time */
  executionTimeMs: number;
  
  /** CI environment */
  ci: boolean;
}

// =============================================================================
// SECTION 11: Factory Types
// =============================================================================

/**
 * Gate factory function type
 */
export type GateFactory = (context: GateFactoryContext) => Gate;

/**
 * Context provided to gate factories
 */
export interface GateFactoryContext {
  /** Project root */
  projectRoot: string;
  
  /** Logger */
  logger?: Logger;
}

/**
 * Simple logger interface
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Gate interface
 */
export interface Gate {
  /** Gate ID */
  id: GateId;
  
  /** Gate name */
  name: string;
  
  /** Gate description */
  description: string;
  
  /** Execute the gate */
  execute(input: GateInput): Promise<GateResult>;
  
  /** Validate configuration */
  validateConfig(config: GateConfig): { valid: boolean; errors: string[] };
  
  /** Get default configuration */
  getDefaultConfig(): GateConfig;
}
