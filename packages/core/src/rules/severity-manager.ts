/**
 * Severity Manager - Severity handling
 *
 * Manages default severity per category, config overrides,
 * and severity escalation logic. Provides methods to get effective
 * severity for patterns, check if severity blocks, apply escalation
 * rules, and sort violations by severity.
 *
 * @requirements 24.1 - THE Enforcement_System SHALL support severity levels: error, warning, info, hint
 * @requirements 24.2 - WHEN severity is error, THE Violation SHALL block commits and merges
 * @requirements 24.3 - WHEN severity is warning, THE Violation SHALL be displayed but not block
 * @requirements 24.4 - THE Enforcement_System SHALL allow severity overrides per pattern in config
 * @requirements 24.5 - THE Enforcement_System SHALL support severity escalation after N violations
 */

import { SEVERITY_ORDER } from './types.js';

import type {
  Violation,
  SeverityConfig,
  SeverityEscalationConfig,
  SeverityEscalationRule,
} from './types.js';
import type { PatternCategory, Severity } from '../store/types.js';

// ============================================================================
// Default Severity Configuration
// ============================================================================

/**
 * Default severity levels per pattern category
 *
 * Security and auth patterns default to error (blocking)
 * Most patterns default to warning (non-blocking)
 * Documentation and hints default to info/hint
 *
 * @requirements 24.1 - Support severity levels: error, warning, info, hint
 */
export const DEFAULT_CATEGORY_SEVERITY: Record<PatternCategory, Severity> = {
  structural: 'warning',
  components: 'warning',
  styling: 'info',
  api: 'warning',
  auth: 'error',
  errors: 'warning',
  'data-access': 'warning',
  testing: 'info',
  logging: 'info',
  security: 'error',
  config: 'warning',
  types: 'info',
  performance: 'hint',
  accessibility: 'warning',
  documentation: 'hint',
};

/**
 * Default escalation rules
 *
 * @requirements 24.5 - Support severity escalation after N violations
 */
export const DEFAULT_ESCALATION_RULES: SeverityEscalationRule[] = [
  { from: 'hint', to: 'info', afterCount: 10 },
  { from: 'info', to: 'warning', afterCount: 10 },
  { from: 'warning', to: 'error', afterCount: 10 },
];

// ============================================================================
// Severity Manager Configuration
// ============================================================================

/**
 * Configuration options for the SeverityManager
 */
export interface SeverityManagerConfig {
  /** Default severity for patterns without explicit configuration */
  defaultSeverity: Severity;

  /** Severity overrides by pattern ID */
  patternOverrides: Record<string, Severity>;

  /** Severity overrides by category */
  categoryOverrides: Record<string, Severity>;

  /** Escalation configuration */
  escalation: SeverityEscalationConfig;
}

/**
 * Default SeverityManager configuration
 */
export const DEFAULT_SEVERITY_MANAGER_CONFIG: SeverityManagerConfig = {
  defaultSeverity: 'warning',
  patternOverrides: {},
  categoryOverrides: {},
  escalation: {
    enabled: false,
    threshold: 10,
    rules: DEFAULT_ESCALATION_RULES,
  },
};

// ============================================================================
// Violation Count Tracker
// ============================================================================

/**
 * Tracks violation counts for escalation purposes
 */
export interface ViolationCounts {
  /** Violation count by pattern ID */
  byPattern: Record<string, number>;

  /** Violation count by category */
  byCategory: Record<string, number>;

  /** Total violation count */
  total: number;
}

// ============================================================================
// Severity Manager Class
// ============================================================================

/**
 * SeverityManager class for managing severity levels for patterns.
 *
 * Provides functionality for:
 * - Getting effective severity for a pattern (considering overrides)
 * - Checking if a severity level blocks commits/merges
 * - Applying severity escalation rules
 * - Sorting violations by severity
 *
 * @requirements 24.1, 24.2, 24.3, 24.4, 24.5
 */
export class SeverityManager {
  private config: SeverityManagerConfig;
  private violationCounts: ViolationCounts;

  /**
   * Create a new SeverityManager instance.
   *
   * @param config - Optional custom configuration
   */
  constructor(config?: Partial<SeverityManagerConfig>) {
    this.config = {
      defaultSeverity: config?.defaultSeverity ?? DEFAULT_SEVERITY_MANAGER_CONFIG.defaultSeverity,
      patternOverrides: { ...DEFAULT_SEVERITY_MANAGER_CONFIG.patternOverrides, ...config?.patternOverrides },
      categoryOverrides: { ...DEFAULT_SEVERITY_MANAGER_CONFIG.categoryOverrides, ...config?.categoryOverrides },
      escalation: {
        enabled: config?.escalation?.enabled ?? DEFAULT_SEVERITY_MANAGER_CONFIG.escalation.enabled,
        threshold: config?.escalation?.threshold ?? DEFAULT_SEVERITY_MANAGER_CONFIG.escalation.threshold,
        rules: config?.escalation?.rules 
          ? [...config.escalation.rules] 
          : [...DEFAULT_SEVERITY_MANAGER_CONFIG.escalation.rules],
      },
    };
    this.violationCounts = {
      byPattern: {},
      byCategory: {},
      total: 0,
    };
  }

  /**
   * Get the effective severity for a pattern.
   *
   * Priority order:
   * 1. Pattern-specific override (highest priority)
   * 2. Category override
   * 3. Default category severity
   * 4. Default severity (lowest priority)
   *
   * @param patternId - The pattern ID
   * @param category - The pattern category
   * @returns The effective severity level
   *
   * @requirements 24.4 - Allow severity overrides per pattern in config
   */
  getEffectiveSeverity(patternId: string, category: PatternCategory): Severity {
    // 1. Check pattern-specific override
    if (this.config.patternOverrides[patternId]) {
      return this.config.patternOverrides[patternId];
    }

    // 2. Check category override
    if (this.config.categoryOverrides[category]) {
      return this.config.categoryOverrides[category];
    }

    // 3. Check default category severity
    if (DEFAULT_CATEGORY_SEVERITY[category]) {
      return DEFAULT_CATEGORY_SEVERITY[category];
    }

    // 4. Fall back to default severity
    return this.config.defaultSeverity;
  }

  /**
   * Get the effective severity with escalation applied.
   *
   * Applies escalation rules based on violation counts.
   *
   * @param patternId - The pattern ID
   * @param category - The pattern category
   * @returns The effective severity level (potentially escalated)
   *
   * @requirements 24.5 - Support severity escalation after N violations
   */
  getEffectiveSeverityWithEscalation(
    patternId: string,
    category: PatternCategory
  ): Severity {
    const baseSeverity = this.getEffectiveSeverity(patternId, category);

    if (!this.config.escalation.enabled) {
      return baseSeverity;
    }

    return this.applyEscalation(baseSeverity, patternId, category);
  }

  /**
   * Check if a severity level blocks commits and merges.
   *
   * Only 'error' severity blocks.
   *
   * @param severity - The severity level to check
   * @returns True if the severity blocks, false otherwise
   *
   * @requirements 24.2 - WHEN severity is error, THE Violation SHALL block commits and merges
   * @requirements 24.3 - WHEN severity is warning, THE Violation SHALL be displayed but not block
   */
  isBlocking(severity: Severity): boolean {
    return severity === 'error';
  }

  /**
   * Check if any violations in a list are blocking.
   *
   * @param violations - Array of violations to check
   * @returns True if any violation has blocking severity
   *
   * @requirements 24.2 - Error severity blocks commits and merges
   */
  hasBlockingViolations(violations: Violation[]): boolean {
    return violations.some((v) => this.isBlocking(v.severity));
  }

  /**
   * Get the count of blocking violations.
   *
   * @param violations - Array of violations to check
   * @returns Number of violations with blocking severity
   */
  getBlockingViolationCount(violations: Violation[]): number {
    return violations.filter((v) => this.isBlocking(v.severity)).length;
  }

  /**
   * Apply escalation rules to a severity level.
   *
   * Checks violation counts and applies escalation rules if thresholds are met.
   *
   * @param baseSeverity - The base severity level
   * @param patternId - The pattern ID
   * @param category - The pattern category
   * @returns The escalated severity level
   *
   * @requirements 24.5 - Support severity escalation after N violations
   */
  applyEscalation(
    baseSeverity: Severity,
    patternId: string,
    category: PatternCategory
  ): Severity {
    if (!this.config.escalation.enabled) {
      return baseSeverity;
    }

    // Get violation count for this pattern
    const patternCount = this.violationCounts.byPattern[patternId] || 0;
    const categoryCount = this.violationCounts.byCategory[category] || 0;

    // Use the higher of pattern or category count
    const violationCount = Math.max(patternCount, categoryCount);

    // Find applicable escalation rule
    const applicableRule = this.findApplicableEscalationRule(
      baseSeverity,
      violationCount
    );

    if (applicableRule) {
      return applicableRule.to;
    }

    return baseSeverity;
  }

  /**
   * Find the applicable escalation rule for a severity and count.
   *
   * @param severity - The current severity level
   * @param violationCount - The number of violations
   * @returns The applicable escalation rule, or null if none applies
   */
  private findApplicableEscalationRule(
    severity: Severity,
    violationCount: number
  ): SeverityEscalationRule | null {
    // Find rules that match the current severity
    const matchingRules = this.config.escalation.rules.filter(
      (rule) => rule.from === severity && violationCount >= rule.afterCount
    );

    if (matchingRules.length === 0) {
      return null;
    }

    // Return the rule with the highest afterCount that still applies
    // (most specific escalation)
    return matchingRules.reduce((best, current) =>
      current.afterCount > best.afterCount ? current : best
    );
  }

  /**
   * Record a violation for escalation tracking.
   *
   * @param patternId - The pattern ID
   * @param category - The pattern category
   */
  recordViolation(patternId: string, category: PatternCategory): void {
    this.violationCounts.byPattern[patternId] =
      (this.violationCounts.byPattern[patternId] || 0) + 1;
    this.violationCounts.byCategory[category] =
      (this.violationCounts.byCategory[category] || 0) + 1;
    this.violationCounts.total += 1;
  }

  /**
   * Record multiple violations for escalation tracking.
   *
   * @param violations - Array of violations to record
   * @param categoryMap - Map of pattern ID to category
   */
  recordViolations(
    violations: Violation[],
    categoryMap: Record<string, PatternCategory>
  ): void {
    for (const violation of violations) {
      const category = categoryMap[violation.patternId];
      if (category) {
        this.recordViolation(violation.patternId, category);
      }
    }
  }

  /**
   * Reset violation counts.
   */
  resetViolationCounts(): void {
    this.violationCounts = {
      byPattern: {},
      byCategory: {},
      total: 0,
    };
  }

  /**
   * Get current violation counts.
   *
   * @returns Copy of current violation counts
   */
  getViolationCounts(): ViolationCounts {
    return {
      byPattern: { ...this.violationCounts.byPattern },
      byCategory: { ...this.violationCounts.byCategory },
      total: this.violationCounts.total,
    };
  }

  /**
   * Sort violations by severity (most severe first).
   *
   * Errors come before warnings, warnings before info, info before hints.
   *
   * @param violations - Array of violations to sort
   * @returns New array sorted by severity (descending)
   *
   * @requirements 24.1 - Support severity levels: error, warning, info, hint
   */
  sortBySeverity(violations: Violation[]): Violation[] {
    return [...violations].sort((a, b) => {
      const orderA = SEVERITY_ORDER[a.severity];
      const orderB = SEVERITY_ORDER[b.severity];
      return orderB - orderA; // Descending order (most severe first)
    });
  }

  /**
   * Sort violations by severity (least severe first).
   *
   * @param violations - Array of violations to sort
   * @returns New array sorted by severity (ascending)
   */
  sortBySeverityAscending(violations: Violation[]): Violation[] {
    return [...violations].sort((a, b) => {
      const orderA = SEVERITY_ORDER[a.severity];
      const orderB = SEVERITY_ORDER[b.severity];
      return orderA - orderB; // Ascending order (least severe first)
    });
  }

  /**
   * Group violations by severity level.
   *
   * @param violations - Array of violations to group
   * @returns Object with violations grouped by severity
   */
  groupBySeverity(violations: Violation[]): Record<Severity, Violation[]> {
    const groups: Record<Severity, Violation[]> = {
      error: [],
      warning: [],
      info: [],
      hint: [],
    };

    for (const violation of violations) {
      groups[violation.severity].push(violation);
    }

    return groups;
  }

  /**
   * Filter violations by minimum severity level.
   *
   * @param violations - Array of violations to filter
   * @param minSeverity - Minimum severity level to include
   * @returns Filtered array of violations
   */
  filterByMinSeverity(violations: Violation[], minSeverity: Severity): Violation[] {
    const minOrder = SEVERITY_ORDER[minSeverity];
    return violations.filter((v) => SEVERITY_ORDER[v.severity] >= minOrder);
  }

  /**
   * Filter violations by maximum severity level.
   *
   * @param violations - Array of violations to filter
   * @param maxSeverity - Maximum severity level to include
   * @returns Filtered array of violations
   */
  filterByMaxSeverity(violations: Violation[], maxSeverity: Severity): Violation[] {
    const maxOrder = SEVERITY_ORDER[maxSeverity];
    return violations.filter((v) => SEVERITY_ORDER[v.severity] <= maxOrder);
  }

  /**
   * Compare two severity levels.
   *
   * @param a - First severity level
   * @param b - Second severity level
   * @returns Negative if a < b, positive if a > b, 0 if equal
   */
  compareSeverity(a: Severity, b: Severity): number {
    return SEVERITY_ORDER[a] - SEVERITY_ORDER[b];
  }

  /**
   * Check if severity a is more severe than severity b.
   *
   * @param a - First severity level
   * @param b - Second severity level
   * @returns True if a is more severe than b
   */
  isMoreSevere(a: Severity, b: Severity): boolean {
    return SEVERITY_ORDER[a] > SEVERITY_ORDER[b];
  }

  /**
   * Check if severity a is less severe than severity b.
   *
   * @param a - First severity level
   * @param b - Second severity level
   * @returns True if a is less severe than b
   */
  isLessSevere(a: Severity, b: Severity): boolean {
    return SEVERITY_ORDER[a] < SEVERITY_ORDER[b];
  }

  /**
   * Get the most severe severity from a list.
   *
   * @param severities - Array of severity levels
   * @returns The most severe level, or 'hint' if empty
   */
  getMostSevere(severities: Severity[]): Severity {
    if (severities.length === 0) {
      return 'hint';
    }

    return severities.reduce((most, current) =>
      this.isMoreSevere(current, most) ? current : most
    );
  }

  /**
   * Get the least severe severity from a list.
   *
   * @param severities - Array of severity levels
   * @returns The least severe level, or 'error' if empty
   */
  getLeastSevere(severities: Severity[]): Severity {
    if (severities.length === 0) {
      return 'error';
    }

    return severities.reduce((least, current) =>
      this.isLessSevere(current, least) ? current : least
    );
  }

  /**
   * Set a pattern-specific severity override.
   *
   * @param patternId - The pattern ID
   * @param severity - The severity level to set
   *
   * @requirements 24.4 - Allow severity overrides per pattern in config
   */
  setPatternOverride(patternId: string, severity: Severity): void {
    this.config.patternOverrides[patternId] = severity;
  }

  /**
   * Remove a pattern-specific severity override.
   *
   * @param patternId - The pattern ID
   */
  removePatternOverride(patternId: string): void {
    delete this.config.patternOverrides[patternId];
  }

  /**
   * Set a category severity override.
   *
   * @param category - The pattern category
   * @param severity - The severity level to set
   *
   * @requirements 24.4 - Allow severity overrides per pattern in config
   */
  setCategoryOverride(category: PatternCategory, severity: Severity): void {
    this.config.categoryOverrides[category] = severity;
  }

  /**
   * Remove a category severity override.
   *
   * @param category - The pattern category
   */
  removeCategoryOverride(category: PatternCategory): void {
    delete this.config.categoryOverrides[category];
  }

  /**
   * Enable or disable escalation.
   *
   * @param enabled - Whether escalation should be enabled
   *
   * @requirements 24.5 - Support severity escalation after N violations
   */
  setEscalationEnabled(enabled: boolean): void {
    this.config.escalation.enabled = enabled;
  }

  /**
   * Set escalation threshold.
   *
   * @param threshold - Number of violations before escalation
   *
   * @requirements 24.5 - Support severity escalation after N violations
   */
  setEscalationThreshold(threshold: number): void {
    this.config.escalation.threshold = threshold;
  }

  /**
   * Set escalation rules.
   *
   * @param rules - Array of escalation rules
   *
   * @requirements 24.5 - Support severity escalation after N violations
   */
  setEscalationRules(rules: SeverityEscalationRule[]): void {
    this.config.escalation.rules = [...rules];
  }

  /**
   * Add an escalation rule.
   *
   * @param rule - The escalation rule to add
   *
   * @requirements 24.5 - Support severity escalation after N violations
   */
  addEscalationRule(rule: SeverityEscalationRule): void {
    this.config.escalation.rules.push(rule);
  }

  /**
   * Get the current configuration.
   *
   * @returns Copy of current configuration
   */
  getConfig(): SeverityManagerConfig {
    return {
      ...this.config,
      patternOverrides: { ...this.config.patternOverrides },
      categoryOverrides: { ...this.config.categoryOverrides },
      escalation: {
        ...this.config.escalation,
        rules: [...this.config.escalation.rules],
      },
    };
  }

  /**
   * Create a SeverityConfig object from current state.
   *
   * @returns SeverityConfig object
   */
  toSeverityConfig(): SeverityConfig {
    return {
      default: this.config.defaultSeverity,
      overrides: { ...this.config.patternOverrides },
      categoryOverrides: { ...this.config.categoryOverrides },
      escalation: {
        ...this.config.escalation,
        rules: [...this.config.escalation.rules],
      },
    };
  }

  /**
   * Create a SeverityManager from a SeverityConfig object.
   *
   * @param config - The SeverityConfig to use
   * @returns New SeverityManager instance
   */
  static fromSeverityConfig(config: SeverityConfig): SeverityManager {
    const managerConfig: Partial<SeverityManagerConfig> = {
      defaultSeverity: config.default,
      patternOverrides: config.overrides,
      categoryOverrides: config.categoryOverrides,
    };
    
    if (config.escalation) {
      managerConfig.escalation = config.escalation;
    }
    
    return new SeverityManager(managerConfig);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the default severity for a category.
 *
 * @param category - The pattern category
 * @returns The default severity for the category
 */
export function getDefaultCategorySeverity(category: PatternCategory): Severity {
  return DEFAULT_CATEGORY_SEVERITY[category] || 'warning';
}

/**
 * Check if a severity level is blocking.
 *
 * @param severity - The severity level to check
 * @returns True if the severity blocks commits/merges
 *
 * @requirements 24.2 - Error severity blocks commits and merges
 */
export function isBlockingSeverity(severity: Severity): boolean {
  return severity === 'error';
}

/**
 * Compare two severity levels.
 *
 * @param a - First severity level
 * @param b - Second severity level
 * @returns Negative if a < b, positive if a > b, 0 if equal
 */
export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_ORDER[a] - SEVERITY_ORDER[b];
}

/**
 * Sort violations by severity (most severe first).
 *
 * @param violations - Array of violations to sort
 * @returns New array sorted by severity (descending)
 */
export function sortViolationsBySeverity(violations: Violation[]): Violation[] {
  return [...violations].sort((a, b) => {
    return SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
  });
}

/**
 * Get severity summary from violations.
 *
 * @param violations - Array of violations
 * @returns Object with counts by severity
 */
export function getSeveritySummary(
  violations: Violation[]
): Record<Severity, number> {
  const summary: Record<Severity, number> = {
    error: 0,
    warning: 0,
    info: 0,
    hint: 0,
  };

  for (const violation of violations) {
    summary[violation.severity]++;
  }

  return summary;
}

/**
 * Create a SeverityManager with default configuration.
 *
 * @returns New SeverityManager instance with defaults
 */
export function createSeverityManager(): SeverityManager {
  return new SeverityManager();
}

/**
 * Create a SeverityManager from DriftConfig severity settings.
 *
 * @param severityOverrides - Severity overrides from config
 * @returns New SeverityManager instance
 */
export function createSeverityManagerFromConfig(
  severityOverrides?: Record<string, Severity>
): SeverityManager {
  return new SeverityManager({
    patternOverrides: severityOverrides || {},
  });
}
