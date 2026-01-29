/**
 * Variant Manager - Manages intentional deviations from patterns
 *
 * Variants allow developers to mark code as intentionally deviating from
 * established patterns. Once a variant is created, the enforcement system
 * will stop flagging matching code.
 *
 * @requirements 26.1 - THE Variant_System SHALL allow creating named variants of patterns
 * @requirements 26.2 - THE Variant SHALL specify scope: global, directory, or file
 * @requirements 26.3 - THE Variant SHALL include a reason explaining why it's intentional
 * @requirements 26.5 - THE Variant_System SHALL store variants in .drift/patterns/variants/
 */

import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { VARIANTS_FILE_VERSION } from '../store/types.js';

import type {
  PatternVariant,
  VariantScope,
  VariantsFile,
  PatternLocation,
} from '../store/types.js';


// ============================================================================
// Constants
// ============================================================================

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/** Directory name for patterns */
const PATTERNS_DIR = 'patterns';

/** Directory name for variants */
const VARIANTS_DIR = 'variants';

/** File name for variants index */
const VARIANTS_INDEX_FILE = 'index.json';

// ============================================================================
// Types
// ============================================================================

/**
 * Input for creating a new variant
 *
 * @requirements 26.1 - Create named variants
 * @requirements 26.2 - Specify scope
 * @requirements 26.3 - Include reason
 */
export interface CreateVariantInput {
  /** Pattern ID this variant applies to */
  patternId: string;

  /** Human-readable name for the variant */
  name: string;

  /** Reason explaining why this deviation is intentional */
  reason: string;

  /** Scope of the variant */
  scope: VariantScope;

  /** Scope value (directory path or file path, depending on scope) */
  scopeValue?: string;

  /** Locations covered by this variant */
  locations: PatternLocation[];

  /** User who created the variant (optional) */
  createdBy?: string;

  /** Description of the variant (optional) */
  description?: string;
}

/**
 * Input for updating an existing variant
 */
export interface UpdateVariantInput {
  /** Human-readable name for the variant */
  name?: string;

  /** Reason explaining why this deviation is intentional */
  reason?: string;

  /** Scope of the variant */
  scope?: VariantScope;

  /** Scope value (directory path or file path, depending on scope) */
  scopeValue?: string;

  /** Locations covered by this variant */
  locations?: PatternLocation[];

  /** Whether the variant is active */
  active?: boolean;
}

/**
 * Query options for filtering variants
 */
export interface VariantQuery {
  /** Filter by pattern ID */
  patternId?: string;

  /** Filter by pattern IDs */
  patternIds?: string[];

  /** Filter by scope */
  scope?: VariantScope | VariantScope[];

  /** Filter by active status */
  active?: boolean;

  /** Filter by file path (variants that cover this file) */
  file?: string;

  /** Filter by directory path (variants that cover this directory) */
  directory?: string;

  /** Search in name and reason */
  search?: string;

  /** Filter by creator */
  createdBy?: string;
}

/**
 * Configuration options for the variant manager
 */
export interface VariantManagerConfig {
  /** Root directory for .drift folder (defaults to project root) */
  rootDir: string;

  /** Whether to auto-save changes */
  autoSave: boolean;

  /** Debounce time for auto-save in milliseconds */
  autoSaveDebounce: number;

  /** Whether to create backup before save */
  createBackup: boolean;

  /** Maximum number of backups to keep */
  maxBackups: number;
}

/**
 * Default variant manager configuration
 */
export const DEFAULT_VARIANT_MANAGER_CONFIG: VariantManagerConfig = {
  rootDir: '.',
  autoSave: false,
  autoSaveDebounce: 1000,
  createBackup: true,
  maxBackups: 5,
};

/**
 * Events emitted by the variant manager
 */
export type VariantManagerEventType =
  | 'variant:created'
  | 'variant:updated'
  | 'variant:deleted'
  | 'variant:activated'
  | 'variant:deactivated'
  | 'file:loaded'
  | 'file:saved'
  | 'error';

/**
 * Event payload for variant manager events
 */
export interface VariantManagerEvent {
  /** Event type */
  type: VariantManagerEventType;

  /** Variant ID (if applicable) */
  variantId?: string;

  /** Pattern ID (if applicable) */
  patternId?: string;

  /** Additional event data */
  data?: Record<string, unknown>;

  /** ISO timestamp of the event */
  timestamp: string;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when a variant is not found
 */
export class VariantNotFoundError extends Error {
  constructor(public readonly variantId: string) {
    super(`Variant not found: ${variantId}`);
    this.name = 'VariantNotFoundError';
  }
}

/**
 * Error thrown when a variant operation fails
 */
export class VariantManagerError extends Error {
  public readonly errorCause: Error | undefined;

  constructor(message: string, errorCause?: Error) {
    super(message);
    this.name = 'VariantManagerError';
    this.errorCause = errorCause;
  }
}

/**
 * Error thrown when variant input is invalid
 */
export class InvalidVariantInputError extends Error {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'InvalidVariantInputError';
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique variant ID
 */
function generateVariantId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `var_${timestamp}_${random}`;
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
 * Normalize a path for comparison
 */
function normalizePath(p: string): string {
  return path.normalize(p).replace(/\\/g, '/');
}

/**
 * Check if a file path is within a directory
 */
function isFileInDirectory(filePath: string, dirPath: string): boolean {
  const normalizedFile = normalizePath(filePath);
  const normalizedDir = normalizePath(dirPath);
  return normalizedFile.startsWith(normalizedDir + '/') || normalizedFile === normalizedDir;
}

// ============================================================================
// Variant Manager Class
// ============================================================================

/**
 * Variant Manager - Manages intentional deviations from patterns
 *
 * Variants are stored in .drift/patterns/variants/ directory.
 * Each variant specifies a scope (global, directory, or file) and
 * includes a reason explaining why the deviation is intentional.
 *
 * @requirements 26.1 - Create named variants of patterns
 * @requirements 26.2 - Variants specify scope: global, directory, or file
 * @requirements 26.3 - Variants include reason for deviation
 * @requirements 26.5 - Variants stored in .drift/patterns/variants/
 */
export class VariantManager extends EventEmitter {
  private readonly config: VariantManagerConfig;
  private readonly variantsDir: string;
  private variants: Map<string, PatternVariant> = new Map();
  private loaded: boolean = false;
  private dirty: boolean = false;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(config: Partial<VariantManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_VARIANT_MANAGER_CONFIG, ...config };
    this.variantsDir = path.join(
      this.config.rootDir,
      DRIFT_DIR,
      PATTERNS_DIR,
      VARIANTS_DIR
    );
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the variant manager
   *
   * Creates necessary directories and loads existing variants.
   */
  async initialize(): Promise<void> {
    // Create directory structure
    await this.ensureDirectoryStructure();

    // Load all variants
    await this.loadAll();

    this.loaded = true;
  }

  /**
   * Ensure the directory structure exists
   *
   * @requirements 26.5 - Store variants in .drift/patterns/variants/
   */
  private async ensureDirectoryStructure(): Promise<void> {
    await ensureDir(this.variantsDir);
  }

  /**
   * Check if the manager is initialized
   */
  isInitialized(): boolean {
    return this.loaded;
  }

  // ==========================================================================
  // Loading
  // ==========================================================================

  /**
   * Load all variants from disk
   *
   * @requirements 26.5 - Load variants from .drift/patterns/variants/
   */
  async loadAll(): Promise<void> {
    this.variants.clear();

    const indexPath = path.join(this.variantsDir, VARIANTS_INDEX_FILE);

    if (!(await fileExists(indexPath))) {
      this.emitEvent('file:loaded', undefined, undefined, { count: 0 });
      return;
    }

    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      const data = JSON.parse(content) as VariantsFile;

      // Load variants from the file
      for (const variant of data.variants) {
        this.variants.set(variant.id, variant);
      }

      this.emitEvent('file:loaded', undefined, undefined, { count: this.variants.size });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return; // File doesn't exist, skip
      }
      throw new VariantManagerError(
        `Failed to load variants file: ${indexPath}`,
        error as Error
      );
    }
  }

  // ==========================================================================
  // Saving
  // ==========================================================================

  /**
   * Save all variants to disk
   *
   * @requirements 26.5 - Persist variants in .drift/patterns/variants/
   */
  async saveAll(): Promise<void> {
    const indexPath = path.join(this.variantsDir, VARIANTS_INDEX_FILE);

    // Create backup if enabled
    if (this.config.createBackup && (await fileExists(indexPath))) {
      await this.createBackup(indexPath);
    }

    // Ensure directory exists
    await ensureDir(this.variantsDir);

    // Create variants file
    const variantsFile: VariantsFile = {
      version: VARIANTS_FILE_VERSION,
      variants: Array.from(this.variants.values()),
      lastUpdated: new Date().toISOString(),
    };

    // Write file
    await fs.writeFile(indexPath, JSON.stringify(variantsFile, null, 2));

    this.dirty = false;
    this.emitEvent('file:saved', undefined, undefined, { count: this.variants.size });
  }

  /**
   * Create a backup of a file
   */
  private async createBackup(filePath: string): Promise<void> {
    const backupDir = path.join(path.dirname(filePath), '.backups');
    await ensureDir(backupDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      backupDir,
      `${path.basename(filePath, '.json')}-${timestamp}.json`
    );

    await fs.copyFile(filePath, backupPath);

    // Clean up old backups
    await this.cleanupBackups(backupDir, path.basename(filePath, '.json'));
  }

  /**
   * Clean up old backups, keeping only the most recent ones
   */
  private async cleanupBackups(backupDir: string, prefix: string): Promise<void> {
    try {
      const files = await fs.readdir(backupDir);
      const backups = files
        .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
        .sort()
        .reverse();

      // Remove old backups beyond maxBackups
      for (const backup of backups.slice(this.config.maxBackups)) {
        await fs.unlink(path.join(backupDir, backup));
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Schedule an auto-save if enabled
   */
  private scheduleAutoSave(): void {
    if (!this.config.autoSave) {
      return;
    }

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(async () => {
      if (this.dirty) {
        await this.saveAll();
      }
    }, this.config.autoSaveDebounce);
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Create a new variant
   *
   * @requirements 26.1 - Create named variants of patterns
   * @requirements 26.2 - Specify scope: global, directory, or file
   * @requirements 26.3 - Include reason explaining why it's intentional
   *
   * @param input - Variant creation input
   * @returns The created variant
   */
  create(input: CreateVariantInput): PatternVariant {
    // Validate input
    this.validateCreateInput(input);

    const now = new Date().toISOString();
    const variant: PatternVariant = {
      id: generateVariantId(),
      patternId: input.patternId,
      name: input.name,
      reason: input.reason,
      scope: input.scope,
      locations: input.locations,
      createdAt: now,
      active: true,
    };

    // Only add optional properties if they have values
    if (input.scopeValue !== undefined) {
      variant.scopeValue = input.scopeValue;
    }
    if (input.createdBy !== undefined) {
      variant.createdBy = input.createdBy;
    }

    this.variants.set(variant.id, variant);
    this.dirty = true;
    this.emitEvent('variant:created', variant.id, variant.patternId);
    this.scheduleAutoSave();

    return variant;
  }

  /**
   * Validate create input
   */
  private validateCreateInput(input: CreateVariantInput): void {
    if (!input.patternId || input.patternId.trim() === '') {
      throw new InvalidVariantInputError('Pattern ID is required', 'patternId');
    }

    if (!input.name || input.name.trim() === '') {
      throw new InvalidVariantInputError('Variant name is required', 'name');
    }

    if (!input.reason || input.reason.trim() === '') {
      throw new InvalidVariantInputError('Reason is required', 'reason');
    }

    if (!input.scope) {
      throw new InvalidVariantInputError('Scope is required', 'scope');
    }

    const validScopes: VariantScope[] = ['global', 'directory', 'file'];
    if (!validScopes.includes(input.scope)) {
      throw new InvalidVariantInputError(
        `Invalid scope: ${input.scope}. Must be one of: ${validScopes.join(', ')}`,
        'scope'
      );
    }

    // Validate scope value for non-global scopes
    if (input.scope !== 'global' && (!input.scopeValue || input.scopeValue.trim() === '')) {
      throw new InvalidVariantInputError(
        `Scope value is required for ${input.scope} scope`,
        'scopeValue'
      );
    }

    if (!input.locations || input.locations.length === 0) {
      throw new InvalidVariantInputError(
        'At least one location is required',
        'locations'
      );
    }
  }

  /**
   * Get a variant by ID
   *
   * @param id - Variant ID
   * @returns The variant or undefined if not found
   */
  get(id: string): PatternVariant | undefined {
    return this.variants.get(id);
  }

  /**
   * Get a variant by ID, throwing if not found
   *
   * @param id - Variant ID
   * @returns The variant
   * @throws VariantNotFoundError if variant not found
   */
  getOrThrow(id: string): PatternVariant {
    const variant = this.variants.get(id);
    if (!variant) {
      throw new VariantNotFoundError(id);
    }
    return variant;
  }

  /**
   * Check if a variant exists
   *
   * @param id - Variant ID
   * @returns True if variant exists
   */
  has(id: string): boolean {
    return this.variants.has(id);
  }

  /**
   * Update an existing variant
   *
   * @param id - Variant ID
   * @param updates - Partial variant updates
   * @returns The updated variant
   * @throws VariantNotFoundError if variant not found
   */
  update(id: string, updates: UpdateVariantInput): PatternVariant {
    const existing = this.getOrThrow(id);

    // Build the updated variant, preserving immutable fields
    const updated: PatternVariant = {
      id, // Ensure ID cannot be changed
      patternId: existing.patternId, // Ensure pattern ID cannot be changed
      name: updates.name ?? existing.name,
      reason: updates.reason ?? existing.reason,
      scope: updates.scope ?? existing.scope,
      locations: updates.locations ?? existing.locations,
      createdAt: existing.createdAt, // Ensure creation time cannot be changed
      active: updates.active ?? existing.active,
    };

    // Handle optional scopeValue
    const newScopeValue = updates.scopeValue !== undefined ? updates.scopeValue : existing.scopeValue;
    if (newScopeValue !== undefined) {
      updated.scopeValue = newScopeValue;
    }

    // Handle optional createdBy (preserve from existing)
    if (existing.createdBy !== undefined) {
      updated.createdBy = existing.createdBy;
    }

    // Validate scope value if scope is being updated
    if (updates.scope && updates.scope !== 'global') {
      const scopeValue = updated.scopeValue;
      if (!scopeValue || scopeValue.trim() === '') {
        throw new InvalidVariantInputError(
          `Scope value is required for ${updates.scope} scope`,
          'scopeValue'
        );
      }
    }

    this.variants.set(id, updated);
    this.dirty = true;
    this.emitEvent('variant:updated', id, updated.patternId);
    this.scheduleAutoSave();

    return updated;
  }

  /**
   * Delete a variant
   *
   * @param id - Variant ID
   * @returns True if variant was deleted
   */
  delete(id: string): boolean {
    const variant = this.variants.get(id);
    if (!variant) {
      return false;
    }

    this.variants.delete(id);
    this.dirty = true;
    this.emitEvent('variant:deleted', id, variant.patternId);
    this.scheduleAutoSave();

    return true;
  }

  // ==========================================================================
  // Activation/Deactivation
  // ==========================================================================

  /**
   * Activate a variant
   *
   * @param id - Variant ID
   * @returns The updated variant
   */
  activate(id: string): PatternVariant {
    const variant = this.getOrThrow(id);

    if (variant.active) {
      return variant; // Already active
    }

    const updated: PatternVariant = {
      ...variant,
      active: true,
    };

    this.variants.set(id, updated);
    this.dirty = true;
    this.emitEvent('variant:activated', id, variant.patternId);
    this.scheduleAutoSave();

    return updated;
  }

  /**
   * Deactivate a variant
   *
   * @param id - Variant ID
   * @returns The updated variant
   */
  deactivate(id: string): PatternVariant {
    const variant = this.getOrThrow(id);

    if (!variant.active) {
      return variant; // Already inactive
    }

    const updated: PatternVariant = {
      ...variant,
      active: false,
    };

    this.variants.set(id, updated);
    this.dirty = true;
    this.emitEvent('variant:deactivated', id, variant.patternId);
    this.scheduleAutoSave();

    return updated;
  }

  // ==========================================================================
  // Querying
  // ==========================================================================

  /**
   * Query variants with filtering
   *
   * @param query - Query options
   * @returns Matching variants
   */
  query(query: VariantQuery = {}): PatternVariant[] {
    let results = Array.from(this.variants.values());

    // Filter by pattern ID
    if (query.patternId) {
      results = results.filter((v) => v.patternId === query.patternId);
    }

    // Filter by pattern IDs
    if (query.patternIds && query.patternIds.length > 0) {
      results = results.filter((v) => query.patternIds!.includes(v.patternId));
    }

    // Filter by scope
    if (query.scope) {
      const scopes = Array.isArray(query.scope) ? query.scope : [query.scope];
      results = results.filter((v) => scopes.includes(v.scope));
    }

    // Filter by active status
    if (query.active !== undefined) {
      results = results.filter((v) => v.active === query.active);
    }

    // Filter by file path
    if (query.file) {
      results = results.filter((v) => this.variantCoversFile(v, query.file!));
    }

    // Filter by directory path
    if (query.directory) {
      results = results.filter((v) => this.variantCoversDirectory(v, query.directory!));
    }

    // Search in name and reason
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      results = results.filter(
        (v) =>
          v.name.toLowerCase().includes(searchLower) ||
          v.reason.toLowerCase().includes(searchLower)
      );
    }

    // Filter by creator
    if (query.createdBy) {
      results = results.filter((v) => v.createdBy === query.createdBy);
    }

    return results;
  }

  /**
   * Check if a variant covers a specific file
   */
  private variantCoversFile(variant: PatternVariant, filePath: string): boolean {
    switch (variant.scope) {
      case 'global':
        return true;
      case 'directory':
        return variant.scopeValue
          ? isFileInDirectory(filePath, variant.scopeValue)
          : false;
      case 'file':
        return variant.scopeValue
          ? normalizePath(filePath) === normalizePath(variant.scopeValue)
          : false;
      default:
        return false;
    }
  }

  /**
   * Check if a variant covers a specific directory
   */
  private variantCoversDirectory(variant: PatternVariant, dirPath: string): boolean {
    switch (variant.scope) {
      case 'global':
        return true;
      case 'directory':
        return variant.scopeValue
          ? isFileInDirectory(dirPath, variant.scopeValue) ||
              normalizePath(dirPath) === normalizePath(variant.scopeValue)
          : false;
      case 'file':
        return variant.scopeValue
          ? isFileInDirectory(variant.scopeValue, dirPath)
          : false;
      default:
        return false;
    }
  }

  // ==========================================================================
  // Convenience Query Methods
  // ==========================================================================

  /**
   * Get all variants
   */
  getAll(): PatternVariant[] {
    return Array.from(this.variants.values());
  }

  /**
   * Get all active variants
   */
  getActive(): PatternVariant[] {
    return this.query({ active: true });
  }

  /**
   * Get all inactive variants
   */
  getInactive(): PatternVariant[] {
    return this.query({ active: false });
  }

  /**
   * Get variants for a specific pattern
   *
   * @param patternId - Pattern ID
   * @returns Variants for the pattern
   */
  getByPatternId(patternId: string): PatternVariant[] {
    return this.query({ patternId });
  }

  /**
   * Get active variants for a specific pattern
   *
   * @param patternId - Pattern ID
   * @returns Active variants for the pattern
   */
  getActiveByPatternId(patternId: string): PatternVariant[] {
    return this.query({ patternId, active: true });
  }

  /**
   * Get variants by scope
   *
   * @param scope - Variant scope
   * @returns Variants with the specified scope
   */
  getByScope(scope: VariantScope): PatternVariant[] {
    return this.query({ scope });
  }

  /**
   * Get variants that cover a specific file
   *
   * @param filePath - File path
   * @returns Variants that cover the file
   */
  getByFile(filePath: string): PatternVariant[] {
    return this.query({ file: filePath });
  }

  /**
   * Get active variants that cover a specific file
   *
   * @param filePath - File path
   * @returns Active variants that cover the file
   */
  getActiveByFile(filePath: string): PatternVariant[] {
    return this.query({ file: filePath, active: true });
  }

  // ==========================================================================
  // Coverage Checking
  // ==========================================================================

  /**
   * Check if a location is covered by any active variant for a pattern
   *
   * This is the primary method used by the enforcement system to determine
   * if a violation should be suppressed.
   *
   * @requirements 26.4 - WHEN a variant is created, THE Enforcement_System SHALL stop flagging matching code
   *
   * @param patternId - Pattern ID
   * @param location - Location to check
   * @returns True if the location is covered by an active variant
   */
  isLocationCovered(patternId: string, location: PatternLocation): boolean {
    const variants = this.getActiveByPatternId(patternId);

    for (const variant of variants) {
      if (this.variantCoversLocation(variant, location)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a variant covers a specific location
   * 
   * A variant covers a location if:
   * 1. The file is within the variant's scope (global, directory, or file)
   * 2. AND either:
   *    a. The variant has only one location (the "anchor" location used for validation)
   *       which means it covers the entire scope
   *    b. The variant has multiple locations that include this specific location
   */
  private variantCoversLocation(
    variant: PatternVariant,
    location: PatternLocation
  ): boolean {
    // First check if the file is in scope
    if (!this.variantCoversFile(variant, location.file)) {
      return false;
    }

    // If the variant has only one location (the anchor), it covers the entire scope
    // This is the common case where a variant is created to cover all violations
    // in a file/directory/globally
    if (variant.locations.length === 1) {
      return true;
    }

    // If the variant has multiple specific locations, check if this location matches
    return variant.locations.some(
      (loc) =>
        normalizePath(loc.file) === normalizePath(location.file) &&
        loc.line === location.line &&
        loc.column === location.column
    );
  }

  /**
   * Get the variant that covers a specific location (if any)
   *
   * @param patternId - Pattern ID
   * @param location - Location to check
   * @returns The covering variant or undefined
   */
  getCoveringVariant(
    patternId: string,
    location: PatternLocation
  ): PatternVariant | undefined {
    const variants = this.getActiveByPatternId(patternId);

    for (const variant of variants) {
      if (this.variantCoversLocation(variant, location)) {
        return variant;
      }
    }

    return undefined;
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get statistics about variants
   */
  getStats(): VariantStats {
    const variants = Array.from(this.variants.values());

    const byScope: Record<VariantScope, number> = {
      global: 0,
      directory: 0,
      file: 0,
    };

    const byPattern: Record<string, number> = {};
    let activeCount = 0;
    let inactiveCount = 0;

    for (const variant of variants) {
      byScope[variant.scope]++;

      const patternCount = byPattern[variant.patternId];
      byPattern[variant.patternId] = (patternCount ?? 0) + 1;

      if (variant.active) {
        activeCount++;
      } else {
        inactiveCount++;
      }
    }

    return {
      total: variants.length,
      active: activeCount,
      inactive: inactiveCount,
      byScope,
      byPattern,
      patternsWithVariants: Object.keys(byPattern).length,
    };
  }

  // ==========================================================================
  // Event Emission
  // ==========================================================================

  /**
   * Emit a variant manager event
   */
  private emitEvent(
    type: VariantManagerEventType,
    variantId?: string,
    patternId?: string,
    data?: Record<string, unknown>
  ): void {
    const event: VariantManagerEvent = {
      type,
      timestamp: new Date().toISOString(),
    };

    // Only add optional properties if they have values
    if (variantId !== undefined) {
      event.variantId = variantId;
    }
    if (patternId !== undefined) {
      event.patternId = patternId;
    }
    if (data !== undefined) {
      event.data = data;
    }

    this.emit(type, event);
    this.emit('event', event);
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    this.removeAllListeners();
  }
}

// ============================================================================
// Statistics Types
// ============================================================================

/**
 * Statistics about variants
 */
export interface VariantStats {
  /** Total number of variants */
  total: number;

  /** Number of active variants */
  active: number;

  /** Number of inactive variants */
  inactive: number;

  /** Variants by scope */
  byScope: Record<VariantScope, number>;

  /** Variants by pattern ID */
  byPattern: Record<string, number>;

  /** Number of patterns with variants */
  patternsWithVariants: number;
}
