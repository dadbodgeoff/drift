/**
 * Dead Constant Detector
 *
 * Detects constants that are defined but never used (dead code).
 */

import type {
  ConstantExtraction,
  EnumExtraction,
  DeadConstant,
  ConstantReference,
} from '../types.js';

/**
 * Configuration for dead constant detection
 */
export interface DeadConstantConfig {
  /** Include test-only references as "used" */
  countTestReferences: boolean;
  /** Include deprecated constants */
  includeDeprecated: boolean;
  /** File patterns to exclude from analysis */
  excludePatterns: string[];
  /** Minimum confidence to report */
  minConfidence: number;
}

/**
 * Default dead constant config
 */
export const DEFAULT_DEAD_CONSTANT_CONFIG: DeadConstantConfig = {
  countTestReferences: false,
  includeDeprecated: true,
  excludePatterns: ['node_modules', 'dist', 'build', '.git'],
  minConfidence: 0.7,
};

/**
 * Result of dead constant detection
 */
export interface DeadConstantResult {
  /** Dead constants found */
  deadConstants: DeadConstant[];
  /** Total constants analyzed */
  totalAnalyzed: number;
  /** Detection time in ms */
  detectionTimeMs: number;
}

/**
 * Dead constant detector
 */
export class DeadConstantDetector {
  private config: DeadConstantConfig;

  constructor(config: Partial<DeadConstantConfig> = {}) {
    this.config = { ...DEFAULT_DEAD_CONSTANT_CONFIG, ...config };
  }

  /**
   * Detect dead constants
   */
  detect(
    constants: ConstantExtraction[],
    enums: EnumExtraction[],
    references: Map<string, ConstantReference[]>
  ): DeadConstantResult {
    const startTime = performance.now();
    const deadConstants: DeadConstant[] = [];

    // Check each constant
    for (const constant of constants) {
      // Skip excluded files
      if (this.shouldExcludeFile(constant.file)) {
        continue;
      }

      const result = this.analyzeConstant(constant, references);
      if (result && result.confidence >= this.config.minConfidence) {
        deadConstants.push(result);
      }
    }

    // Check each enum
    for (const enumDef of enums) {
      // Skip excluded files
      if (this.shouldExcludeFile(enumDef.file)) {
        continue;
      }

      const result = this.analyzeEnum(enumDef, references);
      if (result && result.confidence >= this.config.minConfidence) {
        deadConstants.push(result);
      }
    }

    // Sort by confidence (highest first)
    deadConstants.sort((a, b) => b.confidence - a.confidence);

    return {
      deadConstants,
      totalAnalyzed: constants.length + enums.length,
      detectionTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Analyze a single constant for dead code
   */
  private analyzeConstant(
    constant: ConstantExtraction,
    references: Map<string, ConstantReference[]>
  ): DeadConstant | null {
    const refs = references.get(constant.id) || [];

    // Check for deprecated annotation
    if (this.isDeprecated(constant)) {
      if (!this.config.includeDeprecated) {
        return null;
      }
      return {
        id: constant.id,
        name: constant.name,
        file: constant.file,
        line: constant.line,
        confidence: 0.9,
        reason: 'deprecated_annotation',
      };
    }

    // Filter references based on config
    const effectiveRefs = this.filterReferences(refs, constant.file);

    // No references at all
    if (effectiveRefs.length === 0) {
      // Check if it's exported - exported constants might be used externally
      const confidence = constant.isExported ? 0.6 : 0.95;
      return {
        id: constant.id,
        name: constant.name,
        file: constant.file,
        line: constant.line,
        confidence,
        reason: 'no_references',
      };
    }

    // Only test references
    if (!this.config.countTestReferences) {
      const nonTestRefs = effectiveRefs.filter(r => !this.isTestFile(r.file));
      if (nonTestRefs.length === 0 && effectiveRefs.length > 0) {
        return {
          id: constant.id,
          name: constant.name,
          file: constant.file,
          line: constant.line,
          confidence: 0.8,
          reason: 'only_test_references',
        };
      }
    }

    return null;
  }

  /**
   * Analyze an enum for dead code
   */
  private analyzeEnum(
    enumDef: EnumExtraction,
    references: Map<string, ConstantReference[]>
  ): DeadConstant | null {
    const refs = references.get(enumDef.id) || [];

    // Check for deprecated annotation
    if (this.isEnumDeprecated(enumDef)) {
      if (!this.config.includeDeprecated) {
        return null;
      }
      return {
        id: enumDef.id,
        name: enumDef.name,
        file: enumDef.file,
        line: enumDef.line,
        confidence: 0.9,
        reason: 'deprecated_annotation',
      };
    }

    // Filter references
    const effectiveRefs = this.filterReferences(refs, enumDef.file);

    // No references
    if (effectiveRefs.length === 0) {
      const confidence = enumDef.isExported ? 0.6 : 0.95;
      return {
        id: enumDef.id,
        name: enumDef.name,
        file: enumDef.file,
        line: enumDef.line,
        confidence,
        reason: 'no_references',
      };
    }

    // Only test references
    if (!this.config.countTestReferences) {
      const nonTestRefs = effectiveRefs.filter(r => !this.isTestFile(r.file));
      if (nonTestRefs.length === 0 && effectiveRefs.length > 0) {
        return {
          id: enumDef.id,
          name: enumDef.name,
          file: enumDef.file,
          line: enumDef.line,
          confidence: 0.8,
          reason: 'only_test_references',
        };
      }
    }

    return null;
  }

  /**
   * Filter references based on configuration
   */
  private filterReferences(
    refs: ConstantReference[],
    definitionFile: string
  ): ConstantReference[] {
    return refs.filter(ref => {
      // Exclude self-references (same file, same line)
      if (ref.file === definitionFile) {
        return false;
      }

      // Exclude references in excluded patterns
      if (this.shouldExcludeFile(ref.file)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Check if a constant has deprecated annotation
   */
  private isDeprecated(constant: ConstantExtraction): boolean {
    // Check decorators
    if (constant.decorators.some(d => 
      d.toLowerCase().includes('deprecated') ||
      d.toLowerCase().includes('obsolete')
    )) {
      return true;
    }

    // Check doc comment
    if (constant.docComment?.toLowerCase().includes('@deprecated')) {
      return true;
    }

    return false;
  }

  /**
   * Check if an enum has deprecated annotation
   */
  private isEnumDeprecated(enumDef: EnumExtraction): boolean {
    if (enumDef.decorators.some(d => 
      d.toLowerCase().includes('deprecated') ||
      d.toLowerCase().includes('obsolete')
    )) {
      return true;
    }

    if (enumDef.docComment?.toLowerCase().includes('@deprecated')) {
      return true;
    }

    return false;
  }

  /**
   * Check if a file is a test file
   */
  private isTestFile(filePath: string): boolean {
    return (
      filePath.includes('.test.') ||
      filePath.includes('.spec.') ||
      filePath.includes('__tests__') ||
      filePath.includes('__mocks__') ||
      filePath.includes('/test/') ||
      filePath.includes('/tests/')
    );
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
 * Quick check if a constant is potentially dead
 * (for use during scanning without full reference analysis)
 */
export function isLikelyDead(
  constant: ConstantExtraction,
  fileContent: string
): boolean {
  // Count occurrences of the constant name in the file
  const pattern = new RegExp(`\\b${escapeRegex(constant.name)}\\b`, 'g');
  const matches = fileContent.match(pattern);

  // If only appears once (the definition), likely dead
  return !matches || matches.length <= 1;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
