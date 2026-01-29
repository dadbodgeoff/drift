/**
 * Pattern Adapter
 *
 * Feeds constant analysis into the pattern detection system.
 * Creates patterns for constant consistency, magic values, and security issues.
 */

import { ConsistencyAnalyzer } from '../analysis/consistency-analyzer.js';
import { ConstantSecurityScanner } from '../analysis/security-scanner.js';
import { ConstantStore } from '../store/constant-store.js';

import type {
  ConstantExtraction,
  PotentialSecret,
  InconsistentConstant,
  IssueSeverity,
} from '../types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A pattern detected from constant analysis
 */
export interface ConstantPattern {
  /** Pattern ID */
  id: string;

  /** Pattern name */
  name: string;

  /** Pattern category */
  category: ConstantPatternCategory;

  /** Subcategory */
  subcategory: string;

  /** Description */
  description: string;

  /** Severity */
  severity: IssueSeverity;

  /** Confidence (0-1) */
  confidence: number;

  /** Locations where pattern is found */
  locations: PatternLocation[];

  /** Metadata */
  metadata: Record<string, unknown>;

  /** First seen timestamp */
  firstSeen: string;

  /** Last seen timestamp */
  lastSeen: string;
}

/**
 * Pattern categories for constants
 */
export type ConstantPatternCategory =
  | 'config'
  | 'security'
  | 'consistency'
  | 'maintenance';

/**
 * Location of a pattern
 */
export interface PatternLocation {
  /** File path */
  file: string;

  /** Line number */
  line: number;

  /** Column */
  column: number;

  /** Code snippet */
  snippet?: string;

  /** Additional context */
  context?: string;
}

/**
 * Pattern detection result
 */
export interface ConstantPatternResult {
  /** Detected patterns */
  patterns: ConstantPattern[];

  /** Statistics */
  stats: {
    totalPatterns: number;
    byCategory: Record<ConstantPatternCategory, number>;
    bySeverity: Record<IssueSeverity, number>;
  };

  /** Detection timestamp */
  detectedAt: string;

  /** Duration in ms */
  duration: number;
}

/**
 * Configuration for pattern adapter
 */
export interface PatternAdapterConfig {
  /** Root directory */
  rootDir: string;

  /** Enable magic value detection */
  detectMagicValues?: boolean;

  /** Enable security scanning */
  detectSecrets?: boolean;

  /** Enable consistency checking */
  detectInconsistencies?: boolean;

  /** Enable dead constant detection */
  detectDeadConstants?: boolean;

  /** Minimum occurrences for magic values */
  magicValueMinOccurrences?: number;

  /** Secret detection severity threshold */
  secretSeverityThreshold?: IssueSeverity;
}

// ============================================================================
// Pattern Adapter
// ============================================================================

/**
 * Adapter for feeding constant analysis into the pattern system
 */
export class ConstantPatternAdapter {
  private readonly config: Required<PatternAdapterConfig>;
  private readonly store: ConstantStore;
  private readonly securityScanner: ConstantSecurityScanner;
  private readonly consistencyAnalyzer: ConsistencyAnalyzer;

  constructor(config: PatternAdapterConfig) {
    this.config = {
      rootDir: config.rootDir,
      detectMagicValues: config.detectMagicValues ?? true,
      detectSecrets: config.detectSecrets ?? true,
      detectInconsistencies: config.detectInconsistencies ?? true,
      detectDeadConstants: config.detectDeadConstants ?? true,
      magicValueMinOccurrences: config.magicValueMinOccurrences ?? 2,
      secretSeverityThreshold: config.secretSeverityThreshold ?? 'medium',
    };

    this.store = new ConstantStore({ rootDir: config.rootDir });
    this.securityScanner = new ConstantSecurityScanner();
    this.consistencyAnalyzer = new ConsistencyAnalyzer();
  }

  /**
   * Detect all constant-related patterns
   */
  async detectPatterns(): Promise<ConstantPatternResult> {
    const startTime = performance.now();
    const patterns: ConstantPattern[] = [];

    // Get all constants
    const constants = await this.store.getAllConstants();

    // Detect magic values
    if (this.config.detectMagicValues) {
      const magicPatterns = await this.detectMagicValuePatterns(constants);
      patterns.push(...magicPatterns);
    }

    // Detect secrets
    if (this.config.detectSecrets) {
      const secretPatterns = await this.detectSecretPatterns(constants);
      patterns.push(...secretPatterns);
    }

    // Detect inconsistencies
    if (this.config.detectInconsistencies) {
      const inconsistencyPatterns = await this.detectInconsistencyPatterns(constants);
      patterns.push(...inconsistencyPatterns);
    }

    // Detect dead constants
    if (this.config.detectDeadConstants) {
      const deadPatterns = await this.detectDeadConstantPatterns(constants);
      patterns.push(...deadPatterns);
    }

    // Calculate statistics
    const stats = this.calculateStats(patterns);

    return {
      patterns,
      stats,
      detectedAt: new Date().toISOString(),
      duration: performance.now() - startTime,
    };
  }

  /**
   * Detect magic value patterns
   */
  private async detectMagicValuePatterns(
    constants: ConstantExtraction[]
  ): Promise<ConstantPattern[]> {
    const patterns: ConstantPattern[] = [];

    // Note: Magic value detection needs file content to scan for literals
    // This is a placeholder that would be called with actual file content
    // For now, we create patterns from constants that look like they might be magic values

    const potentialMagicConstants = constants.filter((c) => {
      // Constants with generic names might indicate magic values elsewhere
      const genericNames = ['VALUE', 'NUMBER', 'COUNT', 'SIZE', 'LIMIT'];
      return genericNames.some((name) => c.name.toUpperCase().includes(name));
    });

    if (potentialMagicConstants.length > 0) {
      patterns.push({
        id: 'constants/magic-value-candidates',
        name: 'Potential Magic Value Constants',
        category: 'maintenance',
        subcategory: 'magic-values',
        description: 'Constants with generic names that may indicate magic values in the codebase',
        severity: 'info',
        confidence: 0.6,
        locations: potentialMagicConstants.map((c) => ({
          file: c.file,
          line: c.line,
          column: c.column,
          snippet: `${c.name} = ${c.value}`,
          context: `Category: ${c.category}`,
        })),
        metadata: {
          constantCount: potentialMagicConstants.length,
        },
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }

    return patterns;
  }

  /**
   * Detect secret patterns
   */
  private async detectSecretPatterns(
    constants: ConstantExtraction[]
  ): Promise<ConstantPattern[]> {
    const patterns: ConstantPattern[] = [];

    // Scan constants for potential secrets
    const scanResult = this.securityScanner.scan(constants);

    // Filter by severity threshold
    const severityOrder: IssueSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
    const thresholdIndex = severityOrder.indexOf(this.config.secretSeverityThreshold);

    const filteredSecrets = scanResult.secrets.filter((secret) => {
      const secretIndex = severityOrder.indexOf(secret.severity);
      return secretIndex >= thresholdIndex;
    });

    if (filteredSecrets.length > 0) {
      // Group by secret type
      const byType = new Map<string, PotentialSecret[]>();
      for (const secret of filteredSecrets) {
        const existing = byType.get(secret.secretType) ?? [];
        existing.push(secret);
        byType.set(secret.secretType, existing);
      }

      for (const [secretType, secrets] of byType) {
        const maxSeverity = secrets.reduce((max, s) => {
          const maxIndex = severityOrder.indexOf(max);
          const currentIndex = severityOrder.indexOf(s.severity);
          return currentIndex > maxIndex ? s.severity : max;
        }, 'info' as IssueSeverity);

        patterns.push({
          id: `constants/hardcoded-secret/${secretType}`,
          name: `Hardcoded ${secretType.replace(/_/g, ' ')}`,
          category: 'security',
          subcategory: 'secrets',
          description: `Potential hardcoded ${secretType.replace(/_/g, ' ')} detected in constants`,
          severity: maxSeverity,
          confidence: Math.max(...secrets.map((s) => s.confidence)),
          locations: secrets.map((s) => ({
            file: s.file,
            line: s.line,
            column: 0,
            snippet: `${s.name} = ${s.maskedValue}`,
            context: s.recommendation,
          })),
          metadata: {
            secretType,
            count: secrets.length,
            recommendations: [...new Set(secrets.map((s) => s.recommendation))],
          },
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        });
      }
    }

    return patterns;
  }

  /**
   * Detect inconsistency patterns
   */
  private async detectInconsistencyPatterns(
    constants: ConstantExtraction[]
  ): Promise<ConstantPattern[]> {
    const patterns: ConstantPattern[] = [];

    // Analyze consistency
    const result = this.consistencyAnalyzer.analyze(constants);

    if (result.inconsistencies.length > 0) {
      for (const inconsistency of result.inconsistencies) {
        const severity = this.getInconsistencySeverity(inconsistency);

        patterns.push({
          id: `constants/inconsistent-value/${inconsistency.name}`,
          name: `Inconsistent Constant: ${inconsistency.name}`,
          category: 'consistency',
          subcategory: 'value-mismatch',
          description: `Constant "${inconsistency.name}" has different values in different files`,
          severity,
          confidence: 0.9,
          locations: inconsistency.instances.map((instance) => ({
            file: instance.file,
            line: instance.line,
            column: 0,
            snippet: `${inconsistency.name} = ${instance.value}`,
          })),
          metadata: {
            constantName: inconsistency.name,
            valueCount: new Set(inconsistency.instances.map((i) => String(i.value))).size,
            recommendation: inconsistency.recommendation,
          },
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        });
      }
    }

    return patterns;
  }

  /**
   * Detect dead constant patterns
   */
  private async detectDeadConstantPatterns(
    constants: ConstantExtraction[]
  ): Promise<ConstantPattern[]> {
    const patterns: ConstantPattern[] = [];

    // Note: Dead constant detection needs reference information
    // This creates patterns for constants that look potentially unused

    // Find constants that are not exported and have no obvious usage indicators
    const potentiallyDead = constants.filter((c) => {
      // Non-exported constants in files with few constants might be dead
      return !c.isExported && c.category === 'uncategorized';
    });

    if (potentiallyDead.length > 0) {
      patterns.push({
        id: 'constants/potentially-dead',
        name: 'Potentially Unused Constants',
        category: 'maintenance',
        subcategory: 'dead-code',
        description: 'Non-exported constants that may be unused',
        severity: 'info',
        confidence: 0.5,
        locations: potentiallyDead.map((c) => ({
          file: c.file,
          line: c.line,
          column: c.column,
          snippet: `${c.name} = ${c.value}`,
        })),
        metadata: {
          count: potentiallyDead.length,
          note: 'Requires reference analysis for accurate detection',
        },
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    }

    return patterns;
  }

  /**
   * Get severity for an inconsistency
   */
  private getInconsistencySeverity(inconsistency: InconsistentConstant): IssueSeverity {
    // Higher severity for more instances
    if (inconsistency.instances.length >= 5) {return 'high';}
    if (inconsistency.instances.length >= 3) {return 'medium';}
    return 'low';
  }

  /**
   * Calculate statistics from patterns
   */
  private calculateStats(patterns: ConstantPattern[]): ConstantPatternResult['stats'] {
    const byCategory: Record<ConstantPatternCategory, number> = {
      config: 0,
      security: 0,
      consistency: 0,
      maintenance: 0,
    };

    const bySeverity: Record<IssueSeverity, number> = {
      info: 0,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    for (const pattern of patterns) {
      byCategory[pattern.category]++;
      bySeverity[pattern.severity]++;
    }

    return {
      totalPatterns: patterns.length,
      byCategory,
      bySeverity,
    };
  }

  /**
   * Convert constant patterns to manifest format
   */
  toManifestPatterns(patterns: ConstantPattern[]): ManifestPattern[] {
    return patterns.map((pattern) => ({
      id: pattern.id,
      name: pattern.name,
      category: pattern.category,
      subcategory: pattern.subcategory,
      status: 'discovered' as const,
      confidence: pattern.confidence,
      locations: pattern.locations.map((loc) => ({
        file: loc.file,
        hash: '',
        range: { start: loc.line, end: loc.line },
        type: 'constant' as const,
        name: pattern.name,
        confidence: pattern.confidence,
        language: 'typescript' as const, // Would need to detect from file
      })),
      outliers: [],
      description: pattern.description,
      firstSeen: pattern.firstSeen,
      lastSeen: pattern.lastSeen,
    }));
  }
}

// ============================================================================
// Manifest Pattern Type (for integration)
// ============================================================================

/**
 * Pattern format for manifest storage
 */
export interface ManifestPattern {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  status: 'discovered' | 'approved' | 'ignored';
  confidence: number;
  locations: Array<{
    file: string;
    hash: string;
    range: { start: number; end: number };
    type: string;
    name: string;
    confidence: number;
    language: string;
  }>;
  outliers: unknown[];
  description: string;
  firstSeen: string;
  lastSeen: string;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a pattern adapter
 */
export function createPatternAdapter(config: PatternAdapterConfig): ConstantPatternAdapter {
  return new ConstantPatternAdapter(config);
}

/**
 * Convert severity to numeric value for comparison
 */
export function severityToNumber(severity: IssueSeverity): number {
  const map: Record<IssueSeverity, number> = {
    info: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  return map[severity];
}

/**
 * Compare severities
 */
export function compareSeverity(a: IssueSeverity, b: IssueSeverity): number {
  return severityToNumber(a) - severityToNumber(b);
}
