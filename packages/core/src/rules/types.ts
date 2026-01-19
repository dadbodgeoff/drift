/**
 * Rules type definitions
 *
 * Provides comprehensive types for violations, quick fixes, and code transformations.
 * These types support the rule engine that evaluates patterns and generates violations.
 *
 * @requirements 24.1 - THE Enforcement_System SHALL support severity levels: error, warning, info, hint
 * @requirements 25.1 - THE Quick_Fix_System SHALL generate code transformations for fixable violations
 * @requirements 25.2 - THE Quick_Fix SHALL include a preview of the change before applying
 * @requirements 25.3 - THE Quick_Fix SHALL support fix types: replace, wrap, extract, import, rename, move, delete
 * @requirements 25.4 - WHEN multiple fixes are available, THE Quick_Fix_System SHALL rank by confidence
 * @requirements 25.5 - THE Quick_Fix_System SHALL mark the preferred fix for one-click application
 */

// Re-export Severity from store/types for convenience
import type { Severity as StoreSeverity } from '../store/types.js';

// ============================================================================
// Severity Types
// ============================================================================

/**
 * Severity levels for pattern violations
 *
 * - error: Blocks commits and merges
 * - warning: Displayed but doesn't block
 * - info: Informational only
 * - hint: Subtle suggestion
 *
 * @requirements 24.1 - THE Enforcement_System SHALL support severity levels: error, warning, info, hint
 */
export type Severity = StoreSeverity;

/**
 * Severity enum for use in switch statements and comparisons
 *
 * @requirements 24.1 - Severity levels support
 */
export const SeverityLevel = {
  Error: 'error' as const,
  Warning: 'warning' as const,
  Info: 'info' as const,
  Hint: 'hint' as const,
} as const;

/**
 * Severity level ordering (higher = more severe)
 * Used for sorting violations by severity
 *
 * @requirements 24.2 - WHEN severity is error, THE Violation SHALL block commits and merges
 * @requirements 24.3 - WHEN severity is warning, THE Violation SHALL be displayed but not block
 */
export const SEVERITY_ORDER: Record<Severity, number> = {
  error: 4,
  warning: 3,
  info: 2,
  hint: 1,
};

/**
 * Array of all severity levels in order of severity (most severe first)
 */
export const SEVERITY_LEVELS: readonly Severity[] = ['error', 'warning', 'info', 'hint'] as const;

// ============================================================================
// Position and Range Types
// ============================================================================

/**
 * Position in a text document (0-indexed)
 * Compatible with LSP Position type
 */
export interface Position {
  /** Line number (0-indexed) */
  line: number;

  /** Character offset on the line (0-indexed) */
  character: number;
}

/**
 * Range in a text document
 * Compatible with LSP Range type
 */
export interface Range {
  /** Start position (inclusive) */
  start: Position;

  /** End position (exclusive) */
  end: Position;
}

/**
 * Create a Position from line and character
 */
export function createPosition(line: number, character: number): Position {
  return { line, character };
}

/**
 * Create a Range from start and end positions
 */
export function createRange(start: Position, end: Position): Range {
  return { start, end };
}

/**
 * Create a Range from line/character coordinates
 */
export function createRangeFromCoords(
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number
): Range {
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  };
}

// ============================================================================
// Violation Types
// ============================================================================

/**
 * A violation of a pattern rule
 *
 * Represents code that deviates from an approved pattern.
 * Contains all information needed to display, explain, and fix the violation.
 *
 * @requirements 24.1 - Violation with severity levels
 */
export interface Violation {
  /** Unique violation identifier */
  id: string;

  /** ID of the pattern that was violated */
  patternId: string;

  /** Severity level of the violation */
  severity: Severity;

  /** File path containing the violation (relative to project root) */
  file: string;

  /** Range of the violation in the source file */
  range: Range;

  /** Human-readable message describing the violation */
  message: string;

  /** Detailed explanation of why this is a violation (optional) */
  explanation?: string;

  /** What was expected based on the pattern */
  expected: string;

  /** What was actually found in the code */
  actual: string;

  /** Available quick fix for this violation (optional) */
  quickFix?: QuickFix;

  /** Whether AI explanation is available for this violation */
  aiExplainAvailable: boolean;

  /** Whether AI fix generation is available for this violation */
  aiFixAvailable: boolean;

  /** When this violation was first detected */
  firstSeen: Date;

  /** Number of times this violation has been seen */
  occurrences: number;
}

/**
 * Violation without computed fields (for creation)
 */
export interface ViolationInput {
  /** ID of the pattern that was violated */
  patternId: string;

  /** Severity level of the violation */
  severity: Severity;

  /** File path containing the violation */
  file: string;

  /** Range of the violation in the source file */
  range: Range;

  /** Human-readable message describing the violation */
  message: string;

  /** Detailed explanation (optional) */
  explanation?: string;

  /** What was expected */
  expected: string;

  /** What was actually found */
  actual: string;

  /** Available quick fix (optional) */
  quickFix?: QuickFix;
}

/**
 * Summary of violations for reporting
 */
export interface ViolationSummary {
  /** Total number of violations */
  total: number;

  /** Count by severity level */
  bySeverity: Record<Severity, number>;

  /** Count by pattern ID */
  byPattern: Record<string, number>;

  /** Count by file */
  byFile: Record<string, number>;

  /** Number of auto-fixable violations */
  autoFixable: number;
}

// ============================================================================
// Quick Fix Types
// ============================================================================

/**
 * Kind of quick fix action
 *
 * - quickfix: A quick fix for a problem (e.g., fix a typo)
 * - refactor: A refactoring action (e.g., extract method)
 * - source: A source action (e.g., organize imports)
 */
export type QuickFixKind = 'quickfix' | 'refactor' | 'source';

/**
 * A quick fix that can be applied to resolve a violation
 *
 * @requirements 25.1 - THE Quick_Fix_System SHALL generate code transformations
 * @requirements 25.2 - THE Quick_Fix SHALL include a preview of the change
 * @requirements 25.4 - Quick fixes ranked by confidence
 * @requirements 25.5 - Preferred fix marked for one-click application
 */
export interface QuickFix {
  /** Human-readable title for the fix */
  title: string;

  /** Kind of fix action */
  kind: QuickFixKind;

  /** Workspace edit to apply the fix */
  edit: WorkspaceEdit;

  /** Whether this is the preferred fix (for one-click application) */
  isPreferred: boolean;

  /** Confidence score for this fix (0.0 to 1.0) */
  confidence: number;

  /** Preview of the change (optional, for display before applying) */
  preview?: string;
}

/**
 * Quick fix with additional metadata
 */
export interface QuickFixWithMetadata extends QuickFix {
  /** Unique identifier for the fix */
  id: string;

  /** Type of fix operation */
  fixType: FixType;

  /** Violation ID this fix addresses */
  violationId: string;

  /** Pattern ID this fix relates to */
  patternId: string;

  /** Whether the fix has been validated */
  validated: boolean;

  /** Estimated impact of the fix */
  impact?: FixImpact;
}

/**
 * Impact assessment for a quick fix
 */
export interface FixImpact {
  /** Number of files affected */
  filesAffected: number;

  /** Number of lines changed */
  linesChanged: number;

  /** Risk level of the change */
  riskLevel: 'low' | 'medium' | 'high';

  /** Whether the fix might break existing functionality */
  breakingChange: boolean;
}

// ============================================================================
// Fix Type Definitions
// ============================================================================

/**
 * Types of fix operations supported
 *
 * @requirements 25.3 - Support fix types: replace, wrap, extract, import, rename, move, delete
 */
export type FixType =
  | 'replace'  // Replace text with new text
  | 'wrap'     // Wrap code with additional structure
  | 'extract'  // Extract code into a new location
  | 'import'   // Add an import statement
  | 'rename'   // Rename a symbol
  | 'move'     // Move code to a different location
  | 'delete';  // Delete code

/**
 * Array of all fix types
 */
export const FIX_TYPES: readonly FixType[] = [
  'replace',
  'wrap',
  'extract',
  'import',
  'rename',
  'move',
  'delete',
] as const;

/**
 * Description of each fix type
 */
export const FIX_TYPE_DESCRIPTIONS: Record<FixType, string> = {
  replace: 'Replace text with new text',
  wrap: 'Wrap code with additional structure',
  extract: 'Extract code into a new location',
  import: 'Add an import statement',
  rename: 'Rename a symbol',
  move: 'Move code to a different location',
  delete: 'Delete code',
};

// ============================================================================
// Workspace Edit Types
// ============================================================================

/**
 * A workspace edit represents changes to multiple files
 *
 * Compatible with LSP WorkspaceEdit type
 */
export interface WorkspaceEdit {
  /** Text edits organized by file URI */
  changes: Record<string, TextEdit[]>;

  /** Document changes with versioning (optional, for more complex edits) */
  documentChanges?: DocumentChange[];
}

/**
 * A text edit represents a change to a single range in a document
 *
 * Compatible with LSP TextEdit type
 */
export interface TextEdit {
  /** Range to replace */
  range: Range;

  /** New text to insert (empty string for deletion) */
  newText: string;
}

/**
 * A document change with versioning support
 */
export interface DocumentChange {
  /** Document URI */
  uri: string;

  /** Document version (for conflict detection) */
  version?: number;

  /** Text edits to apply */
  edits: TextEdit[];
}

/**
 * Create a TextEdit for replacing a range
 */
export function createTextEdit(range: Range, newText: string): TextEdit {
  return { range, newText };
}

/**
 * Create a TextEdit for inserting text at a position
 */
export function createInsertEdit(position: Position, newText: string): TextEdit {
  return {
    range: { start: position, end: position },
    newText,
  };
}

/**
 * Create a TextEdit for deleting a range
 */
export function createDeleteEdit(range: Range): TextEdit {
  return { range, newText: '' };
}

/**
 * Create a WorkspaceEdit with changes to a single file
 */
export function createWorkspaceEdit(file: string, edits: TextEdit[]): WorkspaceEdit {
  return {
    changes: { [file]: edits },
  };
}

// ============================================================================
// Rule Evaluation Types
// ============================================================================

/**
 * Result of evaluating a rule against code
 */
export interface RuleEvaluationResult {
  /** Rule/pattern ID that was evaluated */
  ruleId: string;

  /** File that was evaluated */
  file: string;

  /** Whether the rule passed (no violations) */
  passed: boolean;

  /** Violations found (empty if passed) */
  violations: Violation[];

  /** Evaluation duration in milliseconds */
  duration: number;

  /** Any errors encountered during evaluation */
  errors: RuleEvaluationError[];
}

/**
 * Error encountered during rule evaluation
 */
export interface RuleEvaluationError {
  /** Error message */
  message: string;

  /** Error code */
  code?: string;

  /** Whether evaluation can continue */
  recoverable: boolean;
}

/**
 * Aggregated results from evaluating multiple rules
 */
export interface RuleEvaluationSummary {
  /** Total rules evaluated */
  rulesEvaluated: number;

  /** Rules that passed */
  rulesPassed: number;

  /** Rules that failed (had violations) */
  rulesFailed: number;

  /** Total violations found */
  totalViolations: number;

  /** Violations by severity */
  violationsBySeverity: Record<Severity, number>;

  /** Total evaluation duration in milliseconds */
  totalDuration: number;

  /** Files evaluated */
  filesEvaluated: string[];
}

// ============================================================================
// Severity Configuration Types
// ============================================================================

/**
 * Configuration for severity overrides
 *
 * @requirements 24.4 - THE Enforcement_System SHALL allow severity overrides per pattern in config
 */
export interface SeverityConfig {
  /** Default severity for patterns without explicit configuration */
  default: Severity;

  /** Severity overrides by pattern ID */
  overrides: Record<string, Severity>;

  /** Severity overrides by category */
  categoryOverrides: Record<string, Severity>;

  /** Escalation configuration */
  escalation?: SeverityEscalationConfig;
}

/**
 * Configuration for severity escalation
 *
 * @requirements 24.5 - THE Enforcement_System SHALL support severity escalation after N violations
 */
export interface SeverityEscalationConfig {
  /** Whether escalation is enabled */
  enabled: boolean;

  /** Number of violations before escalation */
  threshold: number;

  /** Escalation rules (from severity -> to severity) */
  rules: SeverityEscalationRule[];
}

/**
 * A single severity escalation rule
 */
export interface SeverityEscalationRule {
  /** Original severity level */
  from: Severity;

  /** Escalated severity level */
  to: Severity;

  /** Number of violations to trigger escalation */
  afterCount: number;
}

/**
 * Default severity configuration
 */
export const DEFAULT_SEVERITY_CONFIG: SeverityConfig = {
  default: 'warning',
  overrides: {},
  categoryOverrides: {},
  escalation: {
    enabled: false,
    threshold: 10,
    rules: [
      { from: 'hint', to: 'info', afterCount: 10 },
      { from: 'info', to: 'warning', afterCount: 10 },
      { from: 'warning', to: 'error', afterCount: 10 },
    ],
  },
};
