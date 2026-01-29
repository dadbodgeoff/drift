/**
 * Evaluator - Pattern evaluation and violation detection
 *
 * Provides focused evaluation of code against patterns to determine
 * if code matches a pattern and generate detailed violation information.
 * Works with the PatternMatcher for pattern matching and SeverityManager
 * for severity handling.
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
  Severity,
} from './types.js';
import type {
  PatternDefinition,
  PatternMatchResult,
  MatcherContext,
  Location,
  RegexMatchConfig,
  StructuralMatchConfig,
} from '../matcher/types.js';
import type { AST } from '../parsers/types.js';
import type { Pattern, PatternLocation, OutlierLocation } from '../store/types.js';


// ============================================================================
// Evaluator Configuration
// ============================================================================

/**
 * Configuration options for the Evaluator
 */
export interface EvaluatorConfig {
  /** Severity manager configuration */
  severityConfig?: Partial<SeverityManagerConfig>;

  /** Pattern matcher options */
  matcherOptions?: MatchOptions;

  /** Whether AI explanation is available */
  aiExplainAvailable?: boolean;

  /** Whether AI fix generation is available */
  aiFixAvailable?: boolean;

  /** Minimum confidence threshold for matches */
  minConfidence?: number;

  /** Project root directory */
  projectRoot?: string;
}

/**
 * Default Evaluator configuration
 */
export const DEFAULT_EVALUATOR_CONFIG: Required<EvaluatorConfig> = {
  severityConfig: {},
  matcherOptions: {},
  aiExplainAvailable: false,
  aiFixAvailable: false,
  minConfidence: 0.0,
  projectRoot: '.',
};

// ============================================================================
// Evaluation Input Types
// ============================================================================

/**
 * Input for code evaluation
 */
export interface EvaluationInput {
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
 * Context for pattern evaluation
 */
export interface EvaluationContext extends EvaluationInput {
  /** Project root directory */
  projectRoot: string;
}

// ============================================================================
// Evaluation Result Types
// ============================================================================

/**
 * Result of evaluating code against a pattern
 */
export interface EvaluationResult {
  /** Pattern ID that was evaluated */
  patternId: string;

  /** File that was evaluated */
  file: string;

  /** Whether the code matches the pattern (no violations) */
  matches: boolean;

  /** Confidence score of the match (0.0 to 1.0) */
  confidence: number;

  /** Pattern matches found in the code */
  patternMatches: PatternMatchResult[];

  /** Violations found (code that deviates from pattern) */
  violations: Violation[];

  /** Evaluation duration in milliseconds */
  duration: number;

  /** Any errors encountered during evaluation */
  errors: EvaluationError[];
}

/**
 * Error encountered during evaluation
 */
export interface EvaluationError {
  /** Error message */
  message: string;

  /** Error code */
  code?: string;

  /** Whether evaluation can continue */
  recoverable: boolean;
}

/**
 * Summary of multiple evaluations
 */
export interface EvaluationSummary {
  /** Total patterns evaluated */
  patternsEvaluated: number;

  /** Patterns that matched (no violations) */
  patternsMatched: number;

  /** Patterns with violations */
  patternsViolated: number;

  /** Total violations found */
  totalViolations: number;

  /** Violations by severity */
  violationsBySeverity: Record<Severity, number>;

  /** Total evaluation duration in milliseconds */
  totalDuration: number;

  /** Files evaluated */
  filesEvaluated: string[];
}

/**
 * Detailed match information
 */
export interface MatchDetails {
  /** Whether the code matches the pattern */
  matches: boolean;

  /** Confidence score (0.0 to 1.0) */
  confidence: number;

  /** Location of the match */
  location: Location;

  /** Matched text (if available) */
  matchedText?: string;

  /** Whether this is an outlier */
  isOutlier: boolean;

  /** Reason for outlier classification */
  outlierReason?: string;
}

// ============================================================================
// Evaluator Class
// ============================================================================

/**
 * Evaluator class for checking if code matches patterns and determining violations.
 *
 * The evaluator:
 * - Checks if code matches a pattern definition
 * - Determines violation details (location, severity, message)
 * - Works with PatternMatcher for pattern matching
 * - Uses SeverityManager for severity handling
 *
 * @requirements 24.1 - Enforcement system with severity levels
 */
export class Evaluator {
  private config: Required<EvaluatorConfig>;
  private patternMatcher: PatternMatcher;
  private severityManager: SeverityManager;
  private violationIdCounter: number;

  /**
   * Create a new Evaluator instance.
   *
   * @param config - Optional configuration options
   */
  constructor(config?: EvaluatorConfig) {
    this.config = {
      ...DEFAULT_EVALUATOR_CONFIG,
      ...config,
    };

    this.patternMatcher = new PatternMatcher();
    this.severityManager = new SeverityManager(this.config.severityConfig);
    this.violationIdCounter = 0;
  }

  /**
   * Check if code matches a pattern.
   *
   * @param input - The evaluation input (file, content, AST)
   * @param pattern - The pattern to check against
   * @returns True if code matches the pattern (no violations)
   */
  checkMatch(input: EvaluationInput, pattern: Pattern): boolean {
    const result = this.evaluate(input, pattern);
    return result.matches;
  }

  /**
   * Get detailed match information for code against a pattern.
   *
   * @param input - The evaluation input
   * @param pattern - The pattern to check against
   * @returns Array of match details
   */
  getMatchDetails(input: EvaluationInput, pattern: Pattern): MatchDetails[] {
    const context = this.createMatcherContext(input);
    const definition = this.patternToDefinition(pattern);

    const matches = this.patternMatcher.match(
      context,
      definition,
      this.config.matcherOptions
    );

    return matches.map((match) => {
      const detail: MatchDetails = {
        matches: !match.isOutlier,
        confidence: match.confidence,
        location: match.location,
        isOutlier: match.isOutlier,
      };
      if (match.matchedText !== undefined) {
        detail.matchedText = match.matchedText;
      }
      if (match.outlierReason !== undefined) {
        detail.outlierReason = match.outlierReason;
      }
      return detail;
    });
  }

  /**
   * Evaluate code against a pattern and get detailed results.
   *
   * @param input - The evaluation input (file, content, AST)
   * @param pattern - The pattern to evaluate against
   * @returns Evaluation result with matches and violations
   */
  evaluate(input: EvaluationInput, pattern: Pattern): EvaluationResult {
    const startTime = Date.now();
    const errors: EvaluationError[] = [];
    let patternMatches: PatternMatchResult[] = [];
    let violations: Violation[] = [];

    try {
      // Create matcher context
      const context = this.createMatcherContext(input);

      // Convert pattern to definition for matching
      const definition = this.patternToDefinition(pattern);

      // Match pattern against code
      patternMatches = this.patternMatcher.match(
        context,
        definition,
        this.config.matcherOptions
      );

      // Find violations from outliers and missing patterns
      violations = this.findViolations(input, pattern, patternMatches);
    } catch (error) {
      errors.push({
        message: error instanceof Error ? error.message : String(error),
        code: 'EVALUATION_ERROR',
        recoverable: true,
      });
    }

    // Calculate overall confidence
    const confidence = this.calculateOverallConfidence(patternMatches);

    // Determine if code matches (no violations)
    const matches = violations.length === 0;

    return {
      patternId: pattern.id,
      file: input.file,
      matches,
      confidence,
      patternMatches,
      violations,
      duration: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Evaluate code against multiple patterns.
   *
   * @param input - The evaluation input
   * @param patterns - Array of patterns to evaluate
   * @returns Array of evaluation results
   */
  evaluateAll(input: EvaluationInput, patterns: Pattern[]): EvaluationResult[] {
    return patterns.map((pattern) => this.evaluate(input, pattern));
  }

  /**
   * Evaluate multiple files against patterns.
   *
   * @param inputs - Array of evaluation inputs
   * @param patterns - Array of patterns to evaluate
   * @returns Evaluation summary
   */
  evaluateFiles(
    inputs: EvaluationInput[],
    patterns: Pattern[]
  ): EvaluationSummary {
    const startTime = Date.now();
    const allResults: EvaluationResult[] = [];
    const filesEvaluated: string[] = [];

    for (const input of inputs) {
      filesEvaluated.push(input.file);
      const results = this.evaluateAll(input, patterns);
      allResults.push(...results);
    }

    return this.summarizeResults(allResults, filesEvaluated, startTime);
  }

  /**
   * Determine violation details for a specific location.
   *
   * @param input - The evaluation input
   * @param pattern - The pattern being violated
   * @param location - The location of the violation
   * @param reason - Optional reason for the violation
   * @returns Violation object with full details
   */
  determineViolation(
    input: EvaluationInput,
    pattern: Pattern,
    location: Location,
    reason?: string
  ): Violation {
    const severity = this.severityManager.getEffectiveSeverityWithEscalation(
      pattern.id,
      pattern.category
    );

    const range = this.locationToRange(location);
    const message = reason || `Code deviates from pattern: ${pattern.name}`;

    const violationInput: ViolationInput = {
      patternId: pattern.id,
      severity,
      file: input.file,
      range,
      message,
      expected: this.getExpectedFromPattern(pattern),
      actual: this.getActualFromLocation(input.content, location),
    };
    if (reason !== undefined) {
      violationInput.explanation = reason;
    }
    return this.createViolation(violationInput);
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
   * Get the pattern matcher instance.
   *
   * @returns The pattern matcher
   */
  getPatternMatcher(): PatternMatcher {
    return this.patternMatcher;
  }

  /**
   * Reset the evaluator state.
   */
  reset(): void {
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
  private createMatcherContext(input: EvaluationInput): MatcherContext {
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

    // Add regex config if present
    if (pattern.detector.regex) {
      const regexConfig: RegexMatchConfig = {
        pattern: pattern.detector.regex.pattern,
      };
      if (pattern.detector.regex.flags !== undefined) {
        regexConfig.flags = pattern.detector.regex.flags;
      }
      if (pattern.detector.regex.captureGroups !== undefined) {
        regexConfig.captureGroups = pattern.detector.regex.captureGroups;
      }
      definition.regexConfig = regexConfig;
    }

    // Add structural config if present
    if (pattern.detector.structural) {
      const structuralConfig: StructuralMatchConfig = {};
      if (pattern.detector.structural.pathPattern !== undefined) {
        structuralConfig.pathPattern = pattern.detector.structural.pathPattern;
      }
      if (pattern.detector.structural.directoryPattern !== undefined) {
        structuralConfig.directoryPattern = pattern.detector.structural.directoryPattern;
      }
      if (pattern.detector.structural.namingPattern !== undefined) {
        structuralConfig.namingPattern = pattern.detector.structural.namingPattern;
      }
      if (pattern.detector.structural.requiredSiblings !== undefined) {
        structuralConfig.requiredSiblings = pattern.detector.structural.requiredSiblings;
      }
      definition.structuralConfig = structuralConfig;
    }

    // Add metadata if present
    if (pattern.metadata.firstSeen || pattern.metadata.lastSeen || pattern.metadata.tags) {
      definition.metadata = {};
      if (pattern.metadata.firstSeen) {
        definition.metadata.firstSeen = new Date(pattern.metadata.firstSeen);
      }
      if (pattern.metadata.lastSeen) {
        definition.metadata.lastSeen = new Date(pattern.metadata.lastSeen);
      }
      if (pattern.metadata.tags) {
        definition.metadata.tags = pattern.metadata.tags;
      }
    }

    return definition;
  }

  // ============================================================================
  // Private Methods - Violation Detection
  // ============================================================================

  /**
   * Find violations based on pattern matches.
   */
  private findViolations(
    input: EvaluationInput,
    pattern: Pattern,
    matches: PatternMatchResult[]
  ): Violation[] {
    const violations: Violation[] = [];

    // Check for outliers in matches
    for (const match of matches) {
      if (match.isOutlier) {
        const violation = this.createViolationFromOutlier(input, pattern, match);
        violations.push(violation);
      }
    }

    // Check pattern's outlier locations for this file
    const outlierLocations = pattern.outliers.filter(
      (loc) => loc.file === input.file
    );

    for (const outlier of outlierLocations) {
      const violation = this.createViolationFromOutlierLocation(
        input,
        pattern,
        outlier
      );
      violations.push(violation);
    }

    // Check for missing expected patterns
    if (this.shouldHavePattern(input, pattern) && matches.length === 0) {
      const violation = this.createMissingPatternViolation(input, pattern);
      violations.push(violation);
    }

    return violations;
  }

  /**
   * Check if a file should have a pattern.
   */
  private shouldHavePattern(input: EvaluationInput, pattern: Pattern): boolean {
    // Check if file matches pattern's expected locations
    return pattern.locations.some((loc) => loc.file === input.file);
  }

  /**
   * Create a violation from an outlier match.
   */
  private createViolationFromOutlier(
    input: EvaluationInput,
    pattern: Pattern,
    match: PatternMatchResult
  ): Violation {
    const severity = this.severityManager.getEffectiveSeverityWithEscalation(
      pattern.id,
      pattern.category
    );

    const range = this.locationToRange(match.location);

    const violationInput: ViolationInput = {
      patternId: pattern.id,
      severity,
      file: input.file,
      range,
      message: this.generateViolationMessage(pattern, match),
      expected: this.getExpectedFromPattern(pattern),
      actual: match.matchedText || 'Code deviates from pattern',
    };
    if (match.outlierReason !== undefined) {
      violationInput.explanation = match.outlierReason;
    }
    return this.createViolation(violationInput);
  }

  /**
   * Create a violation from an outlier location.
   */
  private createViolationFromOutlierLocation(
    input: EvaluationInput,
    pattern: Pattern,
    outlier: OutlierLocation
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

    const violationInput: ViolationInput = {
      patternId: pattern.id,
      severity,
      file: input.file,
      range,
      message: `Pattern violation: ${pattern.name}`,
      expected: this.getExpectedFromPattern(pattern),
      actual: `Code at line ${outlier.line} deviates from pattern`,
    };
    if (outlier.reason !== undefined) {
      violationInput.explanation = outlier.reason;
    }
    return this.createViolation(violationInput);
  }

  /**
   * Create a violation for a missing pattern.
   */
  private createMissingPatternViolation(
    input: EvaluationInput,
    pattern: Pattern
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

    return this.createViolation({
      patternId: pattern.id,
      severity,
      file: input.file,
      range,
      message: `Missing expected pattern: ${pattern.name}`,
      explanation: `Expected to find pattern "${pattern.name}" but it was not detected.`,
      expected: this.getExpectedFromPattern(pattern),
      actual: 'Pattern not found',
    });
  }

  // ============================================================================
  // Private Methods - Violation Creation
  // ============================================================================

  /**
   * Create a violation with full details.
   */
  private createViolation(input: ViolationInput): Violation {
    const id = this.generateViolationId();

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
      firstSeen: new Date(),
      occurrences: 1,
    };

    // Add optional properties only if defined
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
    return `eval-violation-${Date.now()}-${this.violationIdCounter}`;
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

  /**
   * Get actual code from a location.
   */
  private getActualFromLocation(content: string, location: Location): string {
    const lines = content.split('\n');
    const lineIndex = location.line - 1; // Convert to 0-indexed

    if (lineIndex >= 0 && lineIndex < lines.length) {
      const line = lines[lineIndex];
      if (line !== undefined) {
        // Return the line or a portion of it
        const maxLength = 100;
        if (line.length > maxLength) {
          return line.substring(0, maxLength) + '...';
        }
        return line;
      }
    }

    return 'Unable to extract code';
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
  private patternLocationToRange(location: PatternLocation): Range {
    return createRangeFromCoords(
      location.line - 1, // Convert to 0-indexed
      location.column - 1,
      (location.endLine || location.line) - 1,
      (location.endColumn || location.column) - 1
    );
  }

  // ============================================================================
  // Private Methods - Confidence Calculation
  // ============================================================================

  /**
   * Calculate overall confidence from pattern matches.
   */
  private calculateOverallConfidence(matches: PatternMatchResult[]): number {
    if (matches.length === 0) {
      return 0;
    }

    // Calculate average confidence of non-outlier matches
    const validMatches = matches.filter((m) => !m.isOutlier);
    if (validMatches.length === 0) {
      return 0;
    }

    const totalConfidence = validMatches.reduce(
      (sum, match) => sum + match.confidence,
      0
    );

    return totalConfidence / validMatches.length;
  }

  // ============================================================================
  // Private Methods - Result Summarization
  // ============================================================================

  /**
   * Summarize evaluation results.
   */
  private summarizeResults(
    results: EvaluationResult[],
    filesEvaluated: string[],
    startTime: number
  ): EvaluationSummary {
    let patternsMatched = 0;
    let patternsViolated = 0;
    let totalViolations = 0;
    const violationsBySeverity: Record<Severity, number> = {
      error: 0,
      warning: 0,
      info: 0,
      hint: 0,
    };

    for (const result of results) {
      if (result.matches) {
        patternsMatched++;
      } else {
        patternsViolated++;
      }

      totalViolations += result.violations.length;

      for (const violation of result.violations) {
        violationsBySeverity[violation.severity]++;
      }
    }

    return {
      patternsEvaluated: results.length,
      patternsMatched,
      patternsViolated,
      totalViolations,
      violationsBySeverity,
      totalDuration: Date.now() - startTime,
      filesEvaluated,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an Evaluator with default configuration.
 *
 * @returns New Evaluator instance
 */
export function createEvaluator(): Evaluator {
  return new Evaluator();
}

/**
 * Create an Evaluator with custom configuration.
 *
 * @param config - Configuration options
 * @returns New Evaluator instance
 */
export function createEvaluatorWithConfig(config: EvaluatorConfig): Evaluator {
  return new Evaluator(config);
}

/**
 * Create an Evaluator with AI features enabled.
 *
 * @returns New Evaluator instance with AI features
 */
export function createEvaluatorWithAI(): Evaluator {
  return new Evaluator({
    aiExplainAvailable: true,
    aiFixAvailable: true,
  });
}

/**
 * Create an Evaluator with a custom severity manager.
 *
 * @param severityConfig - Severity manager configuration
 * @returns New Evaluator instance
 */
export function createEvaluatorWithSeverity(
  severityConfig: Partial<SeverityManagerConfig>
): Evaluator {
  return new Evaluator({ severityConfig });
}
