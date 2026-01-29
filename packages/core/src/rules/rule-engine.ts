/**
 * Rule Engine - Pattern evaluation and violation generation
 *
 * Evaluates patterns against code/AST and generates Violation objects
 * when patterns are violated. Integrates with the PatternMatcher for
 * pattern matching and SeverityManager for severity handling.
 *
 * @requirements 24.1 - THE Enforcement_System SHALL support severity levels: error, warning, info, hint
 */

import { SeverityManager, type SeverityManagerConfig } from './severity-manager.js';
import { createRangeFromCoords } from './types.js';
import { PatternMatcher, type MatchOptions } from '../matcher/pattern-matcher.js';

import type {
  Violation,
  ViolationInput,
  Range,
  RuleEvaluationResult,
  RuleEvaluationSummary,
  RuleEvaluationError,
} from './types.js';
import type {
  PatternDefinition,
  PatternMatchResult,
  MatcherContext,
  Location,
} from '../matcher/types.js';
import type { AST } from '../parsers/types.js';
import type { Pattern } from '../store/types.js';


// ============================================================================
// Rule Engine Configuration
// ============================================================================

/**
 * Configuration options for the RuleEngine
 */
export interface RuleEngineConfig {
  /** Severity manager configuration */
  severityConfig?: Partial<SeverityManagerConfig>;

  /** Pattern matcher options */
  matcherOptions?: MatchOptions;

  /** Whether to generate quick fixes */
  generateQuickFixes?: boolean;

  /** Whether AI explanation is available */
  aiExplainAvailable?: boolean;

  /** Whether AI fix generation is available */
  aiFixAvailable?: boolean;

  /** Maximum violations per file */
  maxViolationsPerFile?: number;

  /** Maximum violations per pattern */
  maxViolationsPerPattern?: number;

  /** Whether to track violation occurrences */
  trackOccurrences?: boolean;

  /** Project root directory */
  projectRoot?: string;
}

/**
 * Default RuleEngine configuration
 */
export const DEFAULT_RULE_ENGINE_CONFIG: Required<RuleEngineConfig> = {
  severityConfig: {},
  matcherOptions: {},
  generateQuickFixes: true,
  aiExplainAvailable: false,
  aiFixAvailable: false,
  maxViolationsPerFile: 100,
  maxViolationsPerPattern: 50,
  trackOccurrences: true,
  projectRoot: '.',
};

// ============================================================================
// Rule Engine Input Types
// ============================================================================

/**
 * Input for rule evaluation
 */
export interface RuleEvaluationInput {
  /** File path being evaluated */
  file: string;

  /** File content */
  content: string;

  /** Parsed AST (null if parsing failed) */
  ast: AST | null;

  /** Language of the file */
  language: string;
}

/**
 * Pattern with evaluation context
 */
export interface PatternWithContext {
  /** The pattern to evaluate */
  pattern: Pattern;

  /** Expected code/structure based on the pattern */
  expected?: string;

  /** Pattern definition for matching */
  definition?: PatternDefinition;
}

// ============================================================================
// Violation Tracking
// ============================================================================

/**
 * Tracks violation occurrences for deduplication
 */
interface ViolationTracker {
  /** Violation count by pattern ID */
  byPattern: Map<string, number>;

  /** Violation count by file */
  byFile: Map<string, number>;

  /** First seen timestamps by violation key */
  firstSeen: Map<string, Date>;

  /** Occurrence counts by violation key */
  occurrences: Map<string, number>;
}

// ============================================================================
// Rule Engine Class
// ============================================================================

/**
 * RuleEngine class for evaluating patterns against code and generating violations.
 *
 * The rule engine:
 * - Takes patterns and code/AST as input
 * - Evaluates patterns against the code using PatternMatcher
 * - Generates Violation objects when patterns are violated
 * - Uses SeverityManager for severity handling
 *
 * @requirements 24.1 - Enforcement system with severity levels
 */
export class RuleEngine {
  private config: Required<RuleEngineConfig>;
  private patternMatcher: PatternMatcher;
  private severityManager: SeverityManager;
  private violationTracker: ViolationTracker;
  private violationIdCounter: number;

  /**
   * Create a new RuleEngine instance.
   *
   * @param config - Optional configuration options
   */
  constructor(config?: RuleEngineConfig) {
    this.config = {
      ...DEFAULT_RULE_ENGINE_CONFIG,
      ...config,
    };

    this.patternMatcher = new PatternMatcher();
    this.severityManager = new SeverityManager(this.config.severityConfig);
    this.violationTracker = this.createViolationTracker();
    this.violationIdCounter = 0;
  }

  /**
   * Create a new violation tracker.
   */
  private createViolationTracker(): ViolationTracker {
    return {
      byPattern: new Map(),
      byFile: new Map(),
      firstSeen: new Map(),
      occurrences: new Map(),
    };
  }

  /**
   * Evaluate a single pattern against code.
   *
   * @param input - The evaluation input (file, content, AST)
   * @param patternWithContext - The pattern to evaluate with context
   * @returns Rule evaluation result with violations
   */
  evaluate(
    input: RuleEvaluationInput,
    patternWithContext: PatternWithContext
  ): RuleEvaluationResult {
    const startTime = Date.now();
    const violations: Violation[] = [];
    const errors: RuleEvaluationError[] = [];

    const { pattern, expected, definition } = patternWithContext;

    try {
      // Create matcher context
      const context = this.createMatcherContext(input);

      // Get pattern definition for matching
      const patternDef = definition || this.patternToDefinition(pattern);

      // Check if this file should be evaluated for this pattern
      if (!this.shouldEvaluateFile(input.file, pattern)) {
        return {
          ruleId: pattern.id,
          file: input.file,
          passed: true,
          violations: [],
          duration: Date.now() - startTime,
          errors: [],
        };
      }

      // Match pattern against code
      const matches = this.patternMatcher.match(
        context,
        patternDef,
        this.config.matcherOptions
      );

      // Find violations (outliers or missing expected patterns)
      const foundViolations = this.findViolations(
        input,
        pattern,
        matches,
        expected
      );

      // Apply violation limits
      const limitedViolations = this.applyViolationLimits(
        foundViolations,
        pattern.id,
        input.file
      );

      violations.push(...limitedViolations);

      // Record violations for escalation tracking
      if (this.config.trackOccurrences) {
        for (const _violation of violations) {
          this.severityManager.recordViolation(pattern.id, pattern.category);
        }
      }
    } catch (error) {
      errors.push({
        message: error instanceof Error ? error.message : String(error),
        code: 'EVALUATION_ERROR',
        recoverable: true,
      });
    }

    return {
      ruleId: pattern.id,
      file: input.file,
      passed: violations.length === 0,
      violations,
      duration: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Evaluate multiple patterns against code.
   *
   * @param input - The evaluation input (file, content, AST)
   * @param patterns - Array of patterns to evaluate
   * @returns Array of rule evaluation results
   */
  evaluateAll(
    input: RuleEvaluationInput,
    patterns: PatternWithContext[]
  ): RuleEvaluationResult[] {
    const results: RuleEvaluationResult[] = [];

    for (const patternWithContext of patterns) {
      const result = this.evaluate(input, patternWithContext);
      results.push(result);
    }

    return results;
  }

  /**
   * Evaluate patterns against multiple files.
   *
   * @param inputs - Array of evaluation inputs
   * @param patterns - Array of patterns to evaluate
   * @returns Summary of all evaluations
   */
  evaluateFiles(
    inputs: RuleEvaluationInput[],
    patterns: PatternWithContext[]
  ): RuleEvaluationSummary {
    const startTime = Date.now();
    const allResults: RuleEvaluationResult[] = [];
    const filesEvaluated: string[] = [];

    for (const input of inputs) {
      filesEvaluated.push(input.file);
      const results = this.evaluateAll(input, patterns);
      allResults.push(...results);
    }

    return this.summarizeResults(allResults, filesEvaluated, startTime);
  }

  /**
   * Get all violations from evaluation results.
   *
   * @param results - Array of rule evaluation results
   * @returns All violations sorted by severity
   */
  getViolations(results: RuleEvaluationResult[]): Violation[] {
    const violations: Violation[] = [];

    for (const result of results) {
      violations.push(...result.violations);
    }

    return this.severityManager.sortBySeverity(violations);
  }

  /**
   * Get blocking violations from evaluation results.
   *
   * @param results - Array of rule evaluation results
   * @returns Violations that block commits/merges
   */
  getBlockingViolations(results: RuleEvaluationResult[]): Violation[] {
    const violations = this.getViolations(results);
    return violations.filter((v) => this.severityManager.isBlocking(v.severity));
  }

  /**
   * Check if any violations are blocking.
   *
   * @param results - Array of rule evaluation results
   * @returns True if any violation blocks commits/merges
   */
  hasBlockingViolations(results: RuleEvaluationResult[]): boolean {
    const violations = this.getViolations(results);
    return this.severityManager.hasBlockingViolations(violations);
  }

  /**
   * Get the severity manager instance.
   *
   * @returns The severity manager
   */
  getSeverityManager(): SeverityManager {
    return this.severityManager;
  }

  /**
   * Reset the rule engine state.
   */
  reset(): void {
    this.violationTracker = this.createViolationTracker();
    this.violationIdCounter = 0;
    this.severityManager.resetViolationCounts();
    this.patternMatcher.clearCache();
  }

  // ============================================================================
  // Private Methods - Context Creation
  // ============================================================================

  /**
   * Create a matcher context from evaluation input.
   */
  private createMatcherContext(input: RuleEvaluationInput): MatcherContext {
    return {
      file: input.file,
      content: input.content,
      ast: input.ast,
      language: input.language,
      projectRoot: this.config.projectRoot,
    };
  }

  /**
   * Convert a Pattern to a PatternDefinition for matching.
   */
  private patternToDefinition(pattern: Pattern): PatternDefinition {
    // Build the base definition
    const definition: PatternDefinition = {
      id: pattern.id,
      name: pattern.name,
      description: pattern.description,
      category: pattern.category,
      subcategory: pattern.subcategory,
      matchType: pattern.detector.type === 'custom' ? 'custom' : pattern.detector.type,
      enabled: true,
    };

    // Add AST config if present
    if (pattern.detector.ast) {
      definition.astConfig = pattern.detector.ast;
    }

    // Add regex config if present with all required fields
    if (pattern.detector.regex) {
      const regexConfig: PatternDefinition['regexConfig'] = {
        pattern: pattern.detector.regex.pattern,
      };
      if (pattern.detector.regex.flags) {
        regexConfig.flags = pattern.detector.regex.flags;
      }
      if (pattern.detector.regex.captureGroups) {
        regexConfig.captureGroups = pattern.detector.regex.captureGroups;
      }
      definition.regexConfig = regexConfig;
    }

    // Add structural config if present with all required fields
    if (pattern.detector.structural) {
      const structuralConfig: PatternDefinition['structuralConfig'] = {};
      if (pattern.detector.structural.pathPattern) {
        structuralConfig.pathPattern = pattern.detector.structural.pathPattern;
      }
      if (pattern.detector.structural.directoryPattern) {
        structuralConfig.directoryPattern = pattern.detector.structural.directoryPattern;
      }
      if (pattern.detector.structural.namingPattern) {
        structuralConfig.namingPattern = pattern.detector.structural.namingPattern;
      }
      if (pattern.detector.structural.requiredSiblings) {
        structuralConfig.requiredSiblings = pattern.detector.structural.requiredSiblings;
      }
      definition.structuralConfig = structuralConfig;
    }

    // Add metadata if present
    if (pattern.metadata.firstSeen || pattern.metadata.lastSeen || pattern.metadata.tags) {
      const metadata: NonNullable<PatternDefinition['metadata']> = {};
      if (pattern.metadata.firstSeen) {
        metadata.firstSeen = new Date(pattern.metadata.firstSeen);
      }
      if (pattern.metadata.lastSeen) {
        metadata.lastSeen = new Date(pattern.metadata.lastSeen);
      }
      if (pattern.metadata.tags) {
        metadata.tags = pattern.metadata.tags;
      }
      definition.metadata = metadata;
    }

    return definition;
  }

  // ============================================================================
  // Private Methods - Violation Detection
  // ============================================================================

  /**
   * Check if a file should be evaluated for a pattern.
   */
  private shouldEvaluateFile(_file: string, _pattern: Pattern): boolean {
    // Check if file is in pattern locations or could potentially match
    // For now, evaluate all files - more sophisticated filtering can be added
    return true;
  }

  /**
   * Find violations based on pattern matches.
   */
  private findViolations(
    input: RuleEvaluationInput,
    pattern: Pattern,
    matches: PatternMatchResult[],
    expected?: string
  ): Violation[] {
    const violations: Violation[] = [];

    // Check for outliers in matches
    for (const match of matches) {
      if (match.isOutlier) {
        const violation = this.createViolationFromOutlier(
          input,
          pattern,
          match,
          expected
        );
        violations.push(violation);
      }
    }

    // Check for missing expected patterns
    if (this.shouldHavePattern(input, pattern) && matches.length === 0) {
      const violation = this.createMissingPatternViolation(
        input,
        pattern,
        expected
      );
      violations.push(violation);
    }

    // Check pattern locations for violations
    const locationViolations = this.checkPatternLocations(
      input,
      pattern,
      matches
    );
    violations.push(...locationViolations);

    return violations;
  }

  /**
   * Check if a file should have a pattern.
   */
  private shouldHavePattern(
    input: RuleEvaluationInput,
    pattern: Pattern
  ): boolean {
    // Check if file matches pattern's expected locations
    const hasLocationInFile = pattern.locations.some(
      (loc) => loc.file === input.file
    );

    // If pattern has locations in this file, it should match
    return hasLocationInFile;
  }

  /**
   * Check pattern locations for violations.
   */
  private checkPatternLocations(
    input: RuleEvaluationInput,
    pattern: Pattern,
    _matches: PatternMatchResult[]
  ): Violation[] {
    const violations: Violation[] = [];

    // Get outlier locations in this file
    const outlierLocations = pattern.outliers.filter(
      (loc) => loc.file === input.file
    );

    // Create violations for outlier locations
    for (const outlier of outlierLocations) {
      const violation = this.createViolationFromOutlierLocation(
        input,
        pattern,
        outlier
      );
      violations.push(violation);
    }

    return violations;
  }

  /**
   * Create a violation from an outlier match.
   */
  private createViolationFromOutlier(
    input: RuleEvaluationInput,
    pattern: Pattern,
    match: PatternMatchResult,
    expected?: string
  ): Violation {
    const severity = this.severityManager.getEffectiveSeverityWithEscalation(
      pattern.id,
      pattern.category
    );

    const range = this.locationToRange(match.location);
    const violationKey = this.getViolationKey(pattern.id, input.file, range);

    const violationInput: ViolationInput = {
      patternId: pattern.id,
      severity,
      file: input.file,
      range,
      message: this.generateViolationMessage(pattern, match),
      expected: expected || this.getExpectedFromPattern(pattern),
      actual: match.matchedText || 'Code deviates from pattern',
    };

    if (match.outlierReason) {
      violationInput.explanation = match.outlierReason;
    }

    return this.createViolation(violationInput, violationKey);
  }

  /**
   * Create a violation for a missing pattern.
   */
  private createMissingPatternViolation(
    input: RuleEvaluationInput,
    pattern: Pattern,
    expected?: string
  ): Violation {
    const severity = this.severityManager.getEffectiveSeverityWithEscalation(
      pattern.id,
      pattern.category
    );

    // Find the expected location in this file
    const expectedLocation = pattern.locations.find(
      (loc) => loc.file === input.file
    );

    const range = expectedLocation
      ? this.patternLocationToRange(expectedLocation)
      : createRangeFromCoords(0, 0, 0, 0);

    const violationKey = this.getViolationKey(pattern.id, input.file, range);

    return this.createViolation({
      patternId: pattern.id,
      severity,
      file: input.file,
      range,
      message: `Missing expected pattern: ${pattern.name}`,
      explanation: `Expected to find pattern "${pattern.name}" but it was not detected.`,
      expected: expected || this.getExpectedFromPattern(pattern),
      actual: 'Pattern not found',
    }, violationKey);
  }

  /**
   * Create a violation from an outlier location.
   */
  private createViolationFromOutlierLocation(
    input: RuleEvaluationInput,
    pattern: Pattern,
    outlier: { file: string; line: number; column: number; reason: string; endLine?: number; endColumn?: number }
  ): Violation {
    const severity = this.severityManager.getEffectiveSeverityWithEscalation(
      pattern.id,
      pattern.category
    );

    const range = createRangeFromCoords(
      outlier.line - 1, // Convert to 0-indexed
      outlier.column - 1,
      (outlier.endLine || outlier.line) - 1,
      (outlier.endColumn || outlier.column) - 1
    );

    const violationKey = this.getViolationKey(pattern.id, input.file, range);

    return this.createViolation({
      patternId: pattern.id,
      severity,
      file: input.file,
      range,
      message: `Pattern violation: ${pattern.name}`,
      explanation: outlier.reason,
      expected: this.getExpectedFromPattern(pattern),
      actual: `Code at line ${outlier.line} deviates from pattern`,
    }, violationKey);
  }

  // ============================================================================
  // Private Methods - Violation Creation
  // ============================================================================

  /**
   * Create a violation with tracking.
   */
  private createViolation(
    input: ViolationInput,
    violationKey: string
  ): Violation {
    const id = this.generateViolationId();

    // Track first seen and occurrences
    let firstSeen = this.violationTracker.firstSeen.get(violationKey);
    if (!firstSeen) {
      firstSeen = new Date();
      this.violationTracker.firstSeen.set(violationKey, firstSeen);
    }

    const occurrences = (this.violationTracker.occurrences.get(violationKey) || 0) + 1;
    this.violationTracker.occurrences.set(violationKey, occurrences);

    const violation: Violation = {
      id,
      patternId: input.patternId,
      severity: input.severity,
      file: input.file,
      range: input.range,
      message: input.message,
      expected: input.expected,
      actual: input.actual,
      aiExplainAvailable: this.config.aiExplainAvailable,
      aiFixAvailable: this.config.aiFixAvailable,
      firstSeen,
      occurrences,
    };

    // Add optional properties only if they are defined
    if (input.explanation !== undefined) {
      violation.explanation = input.explanation;
    }
    if (input.quickFix !== undefined) {
      violation.quickFix = input.quickFix;
    }

    return violation;
  }

  /**
   * Generate a unique violation ID.
   */
  private generateViolationId(): string {
    this.violationIdCounter++;
    return `violation-${Date.now()}-${this.violationIdCounter}`;
  }

  /**
   * Generate a violation key for deduplication.
   */
  private getViolationKey(patternId: string, file: string, range: Range): string {
    return `${patternId}:${file}:${range.start.line}:${range.start.character}`;
  }

  /**
   * Generate a violation message from pattern and match.
   */
  private generateViolationMessage(
    pattern: Pattern,
    match: PatternMatchResult
  ): string {
    if (match.outlierReason) {
      return `${pattern.name}: ${match.outlierReason}`;
    }
    return `Code deviates from pattern: ${pattern.name}`;
  }

  /**
   * Get expected code/structure from pattern.
   */
  private getExpectedFromPattern(pattern: Pattern): string {
    return pattern.description || `Follow the ${pattern.name} pattern`;
  }

  // ============================================================================
  // Private Methods - Location Conversion
  // ============================================================================

  /**
   * Convert a Location to a Range.
   */
  private locationToRange(location: Location): Range {
    return createRangeFromCoords(
      location.line - 1, // Convert to 0-indexed
      location.column - 1,
      (location.endLine || location.line) - 1,
      (location.endColumn || location.column) - 1
    );
  }

  /**
   * Convert a PatternLocation to a Range.
   */
  private patternLocationToRange(location: {
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
  }): Range {
    return createRangeFromCoords(
      location.line - 1, // Convert to 0-indexed
      location.column - 1,
      (location.endLine || location.line) - 1,
      (location.endColumn || location.column) - 1
    );
  }

  // ============================================================================
  // Private Methods - Violation Limits
  // ============================================================================

  /**
   * Apply violation limits per file and pattern.
   */
  private applyViolationLimits(
    violations: Violation[],
    patternId: string,
    file: string
  ): Violation[] {
    // Get current counts
    const patternCount = this.violationTracker.byPattern.get(patternId) || 0;
    const fileCount = this.violationTracker.byFile.get(file) || 0;

    // Calculate remaining capacity
    const patternRemaining = this.config.maxViolationsPerPattern - patternCount;
    const fileRemaining = this.config.maxViolationsPerFile - fileCount;
    const maxToAdd = Math.min(patternRemaining, fileRemaining, violations.length);

    if (maxToAdd <= 0) {
      return [];
    }

    // Take only up to the limit
    const limited = violations.slice(0, maxToAdd);

    // Update counts
    this.violationTracker.byPattern.set(patternId, patternCount + limited.length);
    this.violationTracker.byFile.set(file, fileCount + limited.length);

    return limited;
  }

  // ============================================================================
  // Private Methods - Result Summarization
  // ============================================================================

  /**
   * Summarize evaluation results.
   */
  private summarizeResults(
    results: RuleEvaluationResult[],
    filesEvaluated: string[],
    startTime: number
  ): RuleEvaluationSummary {
    const violations = this.getViolations(results);
    const violationsBySeverity = this.severityManager.groupBySeverity(violations);

    let rulesPassed = 0;
    let rulesFailed = 0;

    for (const result of results) {
      if (result.passed) {
        rulesPassed++;
      } else {
        rulesFailed++;
      }
    }

    return {
      rulesEvaluated: results.length,
      rulesPassed,
      rulesFailed,
      totalViolations: violations.length,
      violationsBySeverity: {
        error: violationsBySeverity.error.length,
        warning: violationsBySeverity.warning.length,
        info: violationsBySeverity.info.length,
        hint: violationsBySeverity.hint.length,
      },
      totalDuration: Date.now() - startTime,
      filesEvaluated,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a RuleEngine with default configuration.
 *
 * @returns New RuleEngine instance
 */
export function createRuleEngine(): RuleEngine {
  return new RuleEngine();
}

/**
 * Create a RuleEngine with custom configuration.
 *
 * @param config - Configuration options
 * @returns New RuleEngine instance
 */
export function createRuleEngineWithConfig(config: RuleEngineConfig): RuleEngine {
  return new RuleEngine(config);
}

/**
 * Create a RuleEngine with AI features enabled.
 *
 * @returns New RuleEngine instance with AI features
 */
export function createRuleEngineWithAI(): RuleEngine {
  return new RuleEngine({
    aiExplainAvailable: true,
    aiFixAvailable: true,
  });
}
