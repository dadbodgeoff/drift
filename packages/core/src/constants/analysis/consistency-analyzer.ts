/**
 * Constant Consistency Analyzer
 *
 * Detects inconsistent constants - same name with different values
 * across the codebase.
 */

import type {
  ConstantExtraction,
  InconsistentConstant,
  ConstantInstance,
  ConstantCategory,
} from '../types.js';

/**
 * Configuration for consistency analysis
 */
export interface ConsistencyConfig {
  /** Ignore case when comparing names */
  ignoreCase: boolean;
  /** Categories to analyze (empty = all) */
  categories: ConstantCategory[];
  /** File patterns to exclude */
  excludePatterns: string[];
  /** Minimum instances to report */
  minInstances: number;
}

/**
 * Default consistency config
 */
export const DEFAULT_CONSISTENCY_CONFIG: ConsistencyConfig = {
  ignoreCase: true,
  categories: [], // All categories
  minInstances: 2,
  excludePatterns: ['node_modules', 'dist', 'build', '.git'],
};

/**
 * Result of consistency analysis
 */
export interface ConsistencyResult {
  /** Inconsistent constants found */
  inconsistencies: InconsistentConstant[];
  /** Total constants analyzed */
  totalAnalyzed: number;
  /** Unique names analyzed */
  uniqueNames: number;
  /** Analysis time in ms */
  analysisTimeMs: number;
}

/**
 * Consistency analyzer
 */
export class ConsistencyAnalyzer {
  private config: ConsistencyConfig;

  constructor(config: Partial<ConsistencyConfig> = {}) {
    this.config = { ...DEFAULT_CONSISTENCY_CONFIG, ...config };
  }

  /**
   * Analyze constants for inconsistencies
   */
  analyze(constants: ConstantExtraction[]): ConsistencyResult {
    const startTime = performance.now();

    // Filter constants
    const filtered = constants.filter(c => {
      // Exclude by file pattern
      if (this.shouldExcludeFile(c.file)) {
        return false;
      }

      // Filter by category if specified
      if (this.config.categories.length > 0 && !this.config.categories.includes(c.category)) {
        return false;
      }

      return true;
    });

    // Group by name
    const byName = this.groupByName(filtered);

    // Find inconsistencies
    const inconsistencies = this.findInconsistencies(byName);

    return {
      inconsistencies,
      totalAnalyzed: filtered.length,
      uniqueNames: byName.size,
      analysisTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Group constants by name
   */
  private groupByName(constants: ConstantExtraction[]): Map<string, ConstantExtraction[]> {
    const groups = new Map<string, ConstantExtraction[]>();

    for (const constant of constants) {
      const key = this.config.ignoreCase 
        ? constant.name.toLowerCase() 
        : constant.name;

      const group = groups.get(key) || [];
      group.push(constant);
      groups.set(key, group);
    }

    return groups;
  }

  /**
   * Find inconsistencies in grouped constants
   */
  private findInconsistencies(
    groups: Map<string, ConstantExtraction[]>
  ): InconsistentConstant[] {
    const inconsistencies: InconsistentConstant[] = [];

    for (const [name, constants] of groups) {
      // Skip if not enough instances
      if (constants.length < this.config.minInstances) {
        continue;
      }

      // Check if values are different
      const uniqueValues = this.getUniqueValues(constants);
      if (uniqueValues.size <= 1) {
        continue; // All same value, not inconsistent
      }

      // Build instances
      const instances: ConstantInstance[] = constants.map(c => ({
        id: c.id,
        file: c.file,
        line: c.line,
        value: c.value ?? null,
      }));

      // Generate recommendation
      const recommendation = this.generateRecommendation(name, constants, uniqueValues);

      inconsistencies.push({
        name: constants[0]?.name ?? name, // Use original case
        instances,
        recommendation,
      });
    }

    // Sort by number of instances (most first)
    inconsistencies.sort((a, b) => b.instances.length - a.instances.length);

    return inconsistencies;
  }

  /**
   * Get unique values from constants
   */
  private getUniqueValues(constants: ConstantExtraction[]): Set<string> {
    const values = new Set<string>();

    for (const constant of constants) {
      const valueStr = this.normalizeValue(constant.value);
      values.add(valueStr);
    }

    return values;
  }

  /**
   * Normalize a value for comparison
   */
  private normalizeValue(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'string') {
      return `"${value}"`;
    }
    return String(value);
  }

  /**
   * Generate a recommendation for fixing inconsistency
   */
  private generateRecommendation(
    name: string,
    constants: ConstantExtraction[],
    uniqueValues: Set<string>
  ): string {
    const valueCount = uniqueValues.size;
    const instanceCount = constants.length;

    // Find most common value
    const valueCounts = new Map<string, number>();
    for (const c of constants) {
      const valueStr = this.normalizeValue(c.value);
      valueCounts.set(valueStr, (valueCounts.get(valueStr) || 0) + 1);
    }

    let mostCommonValue = '';
    let maxCount = 0;
    for (const [value, count] of valueCounts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonValue = value;
      }
    }

    // Generate recommendation
    if (valueCount === 2) {
      return `Constant '${name}' has 2 different values across ${instanceCount} locations. ` +
        `Consider standardizing to ${mostCommonValue} (used ${maxCount} times).`;
    }

    return `Constant '${name}' has ${valueCount} different values across ${instanceCount} locations. ` +
      `Most common value is ${mostCommonValue} (used ${maxCount} times). ` +
      `Consider consolidating into a single source of truth.`;
  }

  /**
   * Check if a file should be excluded
   */
  private shouldExcludeFile(filePath: string): boolean {
    for (const pattern of this.config.excludePatterns) {
      if (filePath.includes(pattern)) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Quick check for potential inconsistency
 */
export function hasPotentialInconsistency(
  constant: ConstantExtraction,
  existingConstants: ConstantExtraction[]
): ConstantExtraction | null {
  const sameName = existingConstants.find(c => 
    c.name.toLowerCase() === constant.name.toLowerCase() &&
    c.file !== constant.file
  );

  if (sameName && sameName.value !== constant.value) {
    return sameName;
  }

  return null;
}
