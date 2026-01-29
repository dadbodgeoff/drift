/**
 * Lock File Manager - Generates and manages drift.lock files
 *
 * The drift.lock file contains a snapshot of approved patterns for version control.
 * It provides a deterministic, version-control-friendly format that allows teams
 * to track pattern changes over time.
 *
 * @requirements 4.7 - THE drift.lock file SHALL contain a snapshot of approved patterns for version control
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { LOCK_FILE_VERSION } from './types.js';

import type {
  Pattern,
  LockFile,
  LockedPattern,
  PatternCategory,
} from './types.js';


// ============================================================================
// Constants
// ============================================================================

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/** Lock file name */
const LOCK_FILE_NAME = 'drift.lock';

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when lock file operations fail
 */
export class LockFileError extends Error {
  public readonly errorCause: Error | undefined;

  constructor(message: string, errorCause?: Error) {
    super(message);
    this.name = 'LockFileError';
    this.errorCause = errorCause;
  }
}

/**
 * Error thrown when lock file validation fails
 */
export class LockFileValidationError extends Error {
  constructor(
    message: string,
    public readonly differences: LockFileDifference[]
  ) {
    super(message);
    this.name = 'LockFileValidationError';
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Type of difference between lock file and current patterns
 */
export type LockFileDifferenceType =
  | 'added'      // Pattern exists in current but not in lock
  | 'removed'    // Pattern exists in lock but not in current
  | 'modified';  // Pattern exists in both but has changed

/**
 * A difference between lock file and current patterns
 */
export interface LockFileDifference {
  /** Type of difference */
  type: LockFileDifferenceType;

  /** Pattern ID */
  patternId: string;

  /** Pattern category */
  category: PatternCategory;

  /** Pattern name */
  name: string;

  /** Details about the change (for modified patterns) */
  details?: string;

  /** Previous value (for modified patterns) */
  previousValue?: unknown;

  /** Current value (for modified patterns) */
  currentValue?: unknown;
}

/**
 * Result of comparing lock file with current patterns
 */
export interface LockFileComparisonResult {
  /** Whether the lock file matches current patterns */
  isMatch: boolean;

  /** List of differences */
  differences: LockFileDifference[];

  /** Number of patterns in lock file */
  lockedCount: number;

  /** Number of approved patterns in current store */
  currentCount: number;
}

/**
 * Configuration options for the lock file manager
 */
export interface LockFileManagerConfig {
  /** Root directory for .drift folder (defaults to project root) */
  rootDir: string;
}

/**
 * Default lock file manager configuration
 */
export const DEFAULT_LOCK_FILE_MANAGER_CONFIG: LockFileManagerConfig = {
  rootDir: '.',
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a deterministic hash for a pattern definition
 *
 * This hash is used to detect changes in pattern definitions.
 * It includes all fields that affect pattern behavior.
 */
function generatePatternHash(pattern: Pattern): string {
  // Create a deterministic representation of the pattern
  const hashInput = {
    id: pattern.id,
    category: pattern.category,
    subcategory: pattern.subcategory,
    name: pattern.name,
    description: pattern.description,
    detector: pattern.detector,
    severity: pattern.severity,
    autoFixable: pattern.autoFixable,
  };

  // Sort keys for deterministic output
  const content = JSON.stringify(hashInput, Object.keys(hashInput).sort());
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Generate a checksum for the entire lock file
 */
function generateLockFileChecksum(patterns: LockedPattern[], generatedAt: string): string {
  const content = JSON.stringify({
    patterns: patterns.map(p => ({
      id: p.id,
      category: p.category,
      name: p.name,
      confidenceScore: p.confidenceScore,
      severity: p.severity,
      definitionHash: p.definitionHash,
      lockedAt: p.lockedAt,
    })),
    generatedAt,
  });
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists
 */
async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Sort patterns deterministically by category then by id
 */
function sortPatterns<T extends { category: PatternCategory; id: string }>(patterns: T[]): T[] {
  return [...patterns].sort((a, b) => {
    // First sort by category
    const categoryCompare = a.category.localeCompare(b.category);
    if (categoryCompare !== 0) {
      return categoryCompare;
    }
    // Then sort by id within category
    return a.id.localeCompare(b.id);
  });
}

// ============================================================================
// Lock File Manager Class
// ============================================================================

/**
 * Lock File Manager - Manages drift.lock file generation and validation
 *
 * The lock file provides:
 * - A snapshot of approved patterns for version control
 * - Deterministic format for clean diffs
 * - Integrity verification via checksums
 * - Change detection between lock file and current patterns
 *
 * @requirements 4.7 - drift.lock snapshots approved patterns
 */
export class LockFileManager {
  private readonly config: LockFileManagerConfig;
  private readonly lockFilePath: string;

  constructor(config: Partial<LockFileManagerConfig> = {}) {
    this.config = { ...DEFAULT_LOCK_FILE_MANAGER_CONFIG, ...config };
    this.lockFilePath = path.join(this.config.rootDir, DRIFT_DIR, LOCK_FILE_NAME);
  }

  // ==========================================================================
  // Lock File Generation
  // ==========================================================================

  /**
   * Generate a lock file from approved patterns
   *
   * Creates a deterministic snapshot of all approved patterns.
   * The output is sorted and formatted for version control friendliness.
   *
   * @param approvedPatterns - Array of approved patterns to lock
   * @returns The generated lock file
   *
   * @requirements 4.7 - Snapshot approved patterns
   */
  generateLockFile(approvedPatterns: Pattern[]): LockFile {
    const now = new Date().toISOString();

    // Convert patterns to locked format and sort deterministically
    const lockedPatterns = sortPatterns(
      approvedPatterns.map((pattern) => this.patternToLocked(pattern, now))
    );

    // Generate checksum for integrity verification
    const checksum = generateLockFileChecksum(lockedPatterns, now);

    return {
      version: LOCK_FILE_VERSION,
      patterns: lockedPatterns,
      generatedAt: now,
      checksum,
    };
  }

  /**
   * Convert a Pattern to a LockedPattern
   */
  private patternToLocked(pattern: Pattern, lockedAt: string): LockedPattern {
    return {
      id: pattern.id,
      category: pattern.category,
      name: pattern.name,
      confidenceScore: pattern.confidence.score,
      severity: pattern.severity,
      definitionHash: generatePatternHash(pattern),
      lockedAt,
    };
  }

  // ==========================================================================
  // Lock File Persistence
  // ==========================================================================

  /**
   * Save a lock file to disk
   *
   * Writes the lock file in a deterministic, version-control-friendly format.
   *
   * @param lockFile - The lock file to save
   *
   * @requirements 4.7 - Version control friendly format
   */
  async save(lockFile: LockFile): Promise<void> {
    try {
      // Ensure .drift directory exists
      await ensureDir(path.dirname(this.lockFilePath));

      // Format with sorted keys and consistent indentation
      const content = this.formatLockFile(lockFile);

      await fs.writeFile(this.lockFilePath, content, 'utf-8');
    } catch (error) {
      throw new LockFileError(
        `Failed to save lock file: ${this.lockFilePath}`,
        error as Error
      );
    }
  }

  /**
   * Format lock file for version control friendly output
   *
   * Uses consistent formatting with sorted keys for clean diffs.
   */
  private formatLockFile(lockFile: LockFile): string {
    // Create a formatted output with consistent ordering
    const output = {
      version: lockFile.version,
      generatedAt: lockFile.generatedAt,
      checksum: lockFile.checksum,
      patterns: lockFile.patterns.map((p) => ({
        id: p.id,
        category: p.category,
        name: p.name,
        confidenceScore: p.confidenceScore,
        severity: p.severity,
        definitionHash: p.definitionHash,
        lockedAt: p.lockedAt,
      })),
    };

    return JSON.stringify(output, null, 2) + '\n';
  }

  /**
   * Load a lock file from disk
   *
   * @returns The loaded lock file or null if it doesn't exist
   */
  async load(): Promise<LockFile | null> {
    if (!(await fileExists(this.lockFilePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(this.lockFilePath, 'utf-8');
      const data = JSON.parse(content);

      // Validate basic structure
      if (!data.version || !data.patterns || !data.generatedAt || !data.checksum) {
        throw new LockFileError('Invalid lock file format: missing required fields');
      }

      return data as LockFile;
    } catch (error) {
      if (error instanceof LockFileError) {
        throw error;
      }
      throw new LockFileError(
        `Failed to load lock file: ${this.lockFilePath}`,
        error as Error
      );
    }
  }

  /**
   * Check if a lock file exists
   */
  async exists(): Promise<boolean> {
    return fileExists(this.lockFilePath);
  }

  /**
   * Delete the lock file
   */
  async delete(): Promise<boolean> {
    if (!(await fileExists(this.lockFilePath))) {
      return false;
    }

    try {
      await fs.unlink(this.lockFilePath);
      return true;
    } catch (error) {
      throw new LockFileError(
        `Failed to delete lock file: ${this.lockFilePath}`,
        error as Error
      );
    }
  }

  // ==========================================================================
  // Lock File Validation
  // ==========================================================================

  /**
   * Verify the integrity of a lock file
   *
   * Checks that the checksum matches the content.
   *
   * @param lockFile - The lock file to verify
   * @returns True if the checksum is valid
   */
  verifyIntegrity(lockFile: LockFile): boolean {
    const expectedChecksum = generateLockFileChecksum(
      lockFile.patterns,
      lockFile.generatedAt
    );
    return lockFile.checksum === expectedChecksum;
  }

  /**
   * Compare a lock file with current approved patterns
   *
   * Identifies patterns that have been added, removed, or modified
   * since the lock file was generated.
   *
   * @param lockFile - The lock file to compare against
   * @param currentPatterns - Current approved patterns
   * @returns Comparison result with differences
   */
  compare(lockFile: LockFile, currentPatterns: Pattern[]): LockFileComparisonResult {
    const differences: LockFileDifference[] = [];

    // Create maps for efficient lookup
    const lockedMap = new Map(lockFile.patterns.map((p) => [p.id, p]));
    const currentMap = new Map(currentPatterns.map((p) => [p.id, p]));

    // Find removed patterns (in lock but not in current)
    for (const locked of lockFile.patterns) {
      if (!currentMap.has(locked.id)) {
        differences.push({
          type: 'removed',
          patternId: locked.id,
          category: locked.category,
          name: locked.name,
        });
      }
    }

    // Find added and modified patterns
    for (const current of currentPatterns) {
      const locked = lockedMap.get(current.id);

      if (!locked) {
        // Pattern was added
        differences.push({
          type: 'added',
          patternId: current.id,
          category: current.category,
          name: current.name,
        });
      } else {
        // Check for modifications
        const currentHash = generatePatternHash(current);
        if (locked.definitionHash !== currentHash) {
          differences.push({
            type: 'modified',
            patternId: current.id,
            category: current.category,
            name: current.name,
            details: 'Pattern definition has changed',
            previousValue: locked.definitionHash,
            currentValue: currentHash,
          });
        }

        // Check for severity changes
        if (locked.severity !== current.severity) {
          differences.push({
            type: 'modified',
            patternId: current.id,
            category: current.category,
            name: current.name,
            details: 'Severity has changed',
            previousValue: locked.severity,
            currentValue: current.severity,
          });
        }

        // Check for significant confidence changes (more than 10%)
        const confidenceDiff = Math.abs(locked.confidenceScore - current.confidence.score);
        if (confidenceDiff > 0.1) {
          differences.push({
            type: 'modified',
            patternId: current.id,
            category: current.category,
            name: current.name,
            details: 'Confidence score has changed significantly',
            previousValue: locked.confidenceScore,
            currentValue: current.confidence.score,
          });
        }
      }
    }

    // Sort differences for deterministic output
    differences.sort((a, b) => {
      const typeOrder = { removed: 0, added: 1, modified: 2 };
      const typeCompare = typeOrder[a.type] - typeOrder[b.type];
      if (typeCompare !== 0) {return typeCompare;}
      return a.patternId.localeCompare(b.patternId);
    });

    return {
      isMatch: differences.length === 0,
      differences,
      lockedCount: lockFile.patterns.length,
      currentCount: currentPatterns.length,
    };
  }

  /**
   * Validate that current patterns match the lock file
   *
   * Throws an error if there are any differences.
   *
   * @param lockFile - The lock file to validate against
   * @param currentPatterns - Current approved patterns
   * @throws LockFileValidationError if patterns don't match
   */
  validate(lockFile: LockFile, currentPatterns: Pattern[]): void {
    const result = this.compare(lockFile, currentPatterns);

    if (!result.isMatch) {
      throw new LockFileValidationError(
        `Lock file validation failed: ${result.differences.length} difference(s) found`,
        result.differences
      );
    }
  }

  // ==========================================================================
  // Convenience Methods
  // ==========================================================================

  /**
   * Generate and save a lock file from approved patterns
   *
   * Convenience method that combines generation and saving.
   *
   * @param approvedPatterns - Array of approved patterns to lock
   * @returns The generated lock file
   */
  async generateAndSave(approvedPatterns: Pattern[]): Promise<LockFile> {
    const lockFile = this.generateLockFile(approvedPatterns);
    await this.save(lockFile);
    return lockFile;
  }

  /**
   * Load and validate a lock file against current patterns
   *
   * @param currentPatterns - Current approved patterns
   * @returns Comparison result
   * @throws LockFileError if lock file doesn't exist or can't be loaded
   */
  async loadAndCompare(currentPatterns: Pattern[]): Promise<LockFileComparisonResult> {
    const lockFile = await this.load();

    if (!lockFile) {
      throw new LockFileError('Lock file does not exist');
    }

    return this.compare(lockFile, currentPatterns);
  }

  /**
   * Load and validate a lock file, throwing if there are differences
   *
   * @param currentPatterns - Current approved patterns
   * @throws LockFileError if lock file doesn't exist
   * @throws LockFileValidationError if patterns don't match
   */
  async loadAndValidate(currentPatterns: Pattern[]): Promise<void> {
    const lockFile = await this.load();

    if (!lockFile) {
      throw new LockFileError('Lock file does not exist');
    }

    this.validate(lockFile, currentPatterns);
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Get the lock file path
   */
  get path(): string {
    return this.lockFilePath;
  }

  /**
   * Get a summary of a lock file
   */
  getSummary(lockFile: LockFile): {
    version: string;
    patternCount: number;
    generatedAt: string;
    categories: Record<PatternCategory, number>;
  } {
    const categories: Record<PatternCategory, number> = {} as Record<PatternCategory, number>;

    for (const pattern of lockFile.patterns) {
      categories[pattern.category] = (categories[pattern.category] || 0) + 1;
    }

    return {
      version: lockFile.version,
      patternCount: lockFile.patterns.length,
      generatedAt: lockFile.generatedAt,
      categories,
    };
  }
}
