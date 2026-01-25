/**
 * Constraint Store
 *
 * Manages storage and retrieval of architectural constraints.
 * Constraints are stored in .drift/constraints/ with category-based sharding.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';

import type {
  Constraint,
  ConstraintCategory,
  ConstraintStatus,
  ConstraintLanguage,
  ConstraintQueryOptions,
  ConstraintQueryResult,
  ConstraintIndex,
  ConstraintSummary,
  ConstraintCounts,
} from '../types.js';

import {
  CONSTRAINT_CATEGORIES,
  CONSTRAINT_STATUSES,
  CONSTRAINT_LANGUAGES,
} from '../types.js';

// =============================================================================
// Types
// =============================================================================

export interface ConstraintStoreConfig {
  /** Root directory of the project */
  rootDir: string;
}

interface ConstraintFile {
  version: string;
  generatedAt: string;
  category: ConstraintCategory;
  status: ConstraintStatus;
  constraints: Constraint[];
}

// =============================================================================
// Constants
// =============================================================================

const CONSTRAINTS_DIR = '.drift/constraints';
const INDEX_FILE = 'index.json';
const SCHEMA_VERSION = '1.0.0';

// =============================================================================
// Constraint Store
// =============================================================================

export class ConstraintStore extends EventEmitter {
  private readonly constraintsDir: string;

  /** In-memory cache of all constraints */
  private constraints: Map<string, Constraint> = new Map();

  /** Index for fast lookups */
  private index: ConstraintIndex | null = null;

  /** Whether the store has been initialized */
  private initialized = false;

  constructor(config: ConstraintStoreConfig) {
    super();
    this.constraintsDir = path.join(config.rootDir, CONSTRAINTS_DIR);
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the store, loading all constraints from disk
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.ensureDirectories();
    await this.loadAll();
    this.initialized = true;

    this.emit('initialized', { constraintCount: this.constraints.size });
  }

  /**
   * Ensure all required directories exist
   */
  private async ensureDirectories(): Promise<void> {
    const dirs = [
      this.constraintsDir,
      path.join(this.constraintsDir, 'discovered'),
      path.join(this.constraintsDir, 'approved'),
      path.join(this.constraintsDir, 'ignored'),
      path.join(this.constraintsDir, 'custom'),
      path.join(this.constraintsDir, 'history'),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Load all constraints from disk
   */
  private async loadAll(): Promise<void> {
    this.constraints.clear();

    for (const status of CONSTRAINT_STATUSES) {
      const statusDir = path.join(this.constraintsDir, status);

      try {
        const files = await fs.readdir(statusDir);

        for (const file of files) {
          if (!file.endsWith('.json')) continue;

          const filePath = path.join(statusDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const data: ConstraintFile = JSON.parse(content);

          for (const constraint of data.constraints) {
            this.constraints.set(constraint.id, constraint);
          }
        }
      } catch (error) {
        // Directory might not exist yet, that's fine
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }

    // Load or rebuild index
    await this.loadOrRebuildIndex();
  }

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Add a new constraint
   */
  async add(constraint: Constraint): Promise<void> {
    this.ensureInitialized();

    // Validate constraint
    this.validateConstraint(constraint);

    // Add to memory
    this.constraints.set(constraint.id, constraint);

    // Persist to disk
    await this.saveConstraint(constraint);

    // Update index
    await this.rebuildIndex();

    this.emit('constraint:added', constraint);
  }

  /**
   * Add multiple constraints
   */
  async addMany(constraints: Constraint[]): Promise<void> {
    this.ensureInitialized();

    for (const constraint of constraints) {
      this.validateConstraint(constraint);
      this.constraints.set(constraint.id, constraint);
    }

    // Batch save by category and status
    await this.saveAll();

    // Update index
    await this.rebuildIndex();

    this.emit('constraints:added', { count: constraints.length });
  }

  /**
   * Get a constraint by ID
   */
  get(id: string): Constraint | undefined {
    this.ensureInitialized();
    return this.constraints.get(id);
  }

  /**
   * Get all constraints
   */
  getAll(): Constraint[] {
    this.ensureInitialized();
    return Array.from(this.constraints.values());
  }

  /**
   * Update a constraint
   */
  async update(id: string, updates: Partial<Constraint>): Promise<Constraint | null> {
    this.ensureInitialized();

    const existing = this.constraints.get(id);
    if (!existing) return null;

    const updated: Constraint = {
      ...existing,
      ...updates,
      id: existing.id, // ID cannot be changed
      metadata: {
        ...existing.metadata,
        ...updates.metadata,
        updatedAt: new Date().toISOString(),
      },
    };

    // If status changed, need to move file
    const statusChanged = updates.status && updates.status !== existing.status;

    this.constraints.set(id, updated);

    if (statusChanged) {
      // Remove from old location
      await this.removeConstraintFile(existing);
    }

    // Save to new/current location
    await this.saveConstraint(updated);

    // Update index
    await this.rebuildIndex();

    this.emit('constraint:updated', updated);
    return updated;
  }

  /**
   * Delete a constraint
   */
  async delete(id: string): Promise<boolean> {
    this.ensureInitialized();

    const constraint = this.constraints.get(id);
    if (!constraint) return false;

    this.constraints.delete(id);
    await this.removeConstraintFile(constraint);
    await this.rebuildIndex();

    this.emit('constraint:deleted', { id });
    return true;
  }

  /**
   * Approve a discovered constraint
   */
  async approve(id: string, approvedBy?: string): Promise<Constraint | null> {
    const existing = this.get(id);
    if (!existing) return null;

    const updates: Partial<Constraint> = {
      status: 'approved',
      metadata: {
        ...existing.metadata,
        schemaVersion: SCHEMA_VERSION,
        createdAt: existing.metadata.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        approvedAt: new Date().toISOString(),
      },
    };

    if (approvedBy) {
      updates.metadata!.approvedBy = approvedBy;
    }

    return this.update(id, updates);
  }

  /**
   * Ignore a discovered constraint
   */
  async ignore(id: string, reason?: string): Promise<Constraint | null> {
    const existing = this.get(id);
    if (!existing) return null;

    const updates: Partial<Constraint> = {
      status: 'ignored',
      metadata: {
        ...existing.metadata,
        schemaVersion: SCHEMA_VERSION,
        createdAt: existing.metadata.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    if (reason) {
      updates.metadata!.notes = reason;
    }

    return this.update(id, updates);
  }

  // ===========================================================================
  // Query Operations
  // ===========================================================================

  /**
   * Query constraints with filters
   */
  query(options: ConstraintQueryOptions = {}): ConstraintQueryResult {
    this.ensureInitialized();

    let results = Array.from(this.constraints.values());

    // Apply filters
    if (options.category) {
      results = results.filter(c => c.category === options.category);
    }

    if (options.categories?.length) {
      results = results.filter(c => options.categories!.includes(c.category));
    }

    if (options.status) {
      results = results.filter(c => c.status === options.status);
    }

    if (options.statuses?.length) {
      results = results.filter(c => options.statuses!.includes(c.status));
    }

    if (options.language) {
      results = results.filter(c => 
        c.language === options.language || c.language === 'all'
      );
    }

    if (options.minConfidence !== undefined) {
      results = results.filter(c => c.confidence.score >= options.minConfidence!);
    }

    if (options.enforcement) {
      results = results.filter(c => c.enforcement.level === options.enforcement);
    }

    if (options.tags?.length) {
      results = results.filter(c =>
        options.tags!.some(tag => c.metadata.tags?.includes(tag))
      );
    }

    if (options.search) {
      const searchLower = options.search.toLowerCase();
      results = results.filter(c =>
        c.name.toLowerCase().includes(searchLower) ||
        c.description.toLowerCase().includes(searchLower)
      );
    }

    if (options.file) {
      results = results.filter(c => this.constraintAppliesToFile(c, options.file!));
    }

    // Sort by confidence (highest first)
    results.sort((a, b) => b.confidence.score - a.confidence.score);

    // Pagination
    const total = results.length;
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    const paged = results.slice(offset, offset + limit);

    return {
      constraints: paged,
      total,
      hasMore: offset + limit < total,
      offset,
      limit,
    };
  }

  /**
   * Get constraints applicable to a specific file
   */
  getForFile(filePath: string): Constraint[] {
    this.ensureInitialized();

    return Array.from(this.constraints.values()).filter(c =>
      this.constraintAppliesToFile(c, filePath)
    );
  }

  /**
   * Get constraints by category
   */
  getByCategory(category: ConstraintCategory): Constraint[] {
    this.ensureInitialized();

    return Array.from(this.constraints.values()).filter(c =>
      c.category === category
    );
  }

  /**
   * Get constraints by status
   */
  getByStatus(status: ConstraintStatus): Constraint[] {
    this.ensureInitialized();

    return Array.from(this.constraints.values()).filter(c =>
      c.status === status
    );
  }

  /**
   * Get active constraints (approved + discovered with high confidence)
   */
  getActive(minConfidence = 0.9): Constraint[] {
    this.ensureInitialized();

    return Array.from(this.constraints.values()).filter(c =>
      c.status === 'approved' ||
      (c.status === 'discovered' && c.confidence.score >= minConfidence)
    );
  }

  // ===========================================================================
  // Index Operations
  // ===========================================================================

  /**
   * Get the constraint index
   */
  getIndex(): ConstraintIndex | null {
    return this.index;
  }

  /**
   * Get constraint counts
   */
  getCounts(): ConstraintCounts {
    this.ensureInitialized();

    const counts: ConstraintCounts = {
      total: this.constraints.size,
      byStatus: {} as Record<ConstraintStatus, number>,
      byCategory: {} as Record<ConstraintCategory, number>,
      byLanguage: {} as Record<ConstraintLanguage, number>,
      byEnforcement: { error: 0, warning: 0, info: 0 },
    };

    // Initialize all counts to 0
    for (const status of CONSTRAINT_STATUSES) {
      counts.byStatus[status] = 0;
    }
    for (const category of CONSTRAINT_CATEGORIES) {
      counts.byCategory[category] = 0;
    }
    for (const language of CONSTRAINT_LANGUAGES) {
      counts.byLanguage[language] = 0;
    }

    // Count
    for (const constraint of this.constraints.values()) {
      counts.byStatus[constraint.status]++;
      counts.byCategory[constraint.category]++;
      counts.byLanguage[constraint.language]++;
      counts.byEnforcement[constraint.enforcement.level]++;
    }

    return counts;
  }

  /**
   * Get constraint summaries for listing
   */
  getSummaries(): ConstraintSummary[] {
    this.ensureInitialized();

    return Array.from(this.constraints.values()).map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      category: c.category,
      language: c.language,
      status: c.status,
      confidence: c.confidence.score,
      enforcement: c.enforcement.level,
      evidence: c.confidence.evidence,
      violations: c.confidence.violations,
      type: c.invariant.type,
    }));
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('ConstraintStore not initialized. Call initialize() first.');
    }
  }

  private validateConstraint(constraint: Constraint): void {
    if (!constraint.id) {
      throw new Error('Constraint must have an id');
    }
    if (!constraint.name) {
      throw new Error('Constraint must have a name');
    }
    if (!CONSTRAINT_CATEGORIES.includes(constraint.category)) {
      throw new Error(`Invalid constraint category: ${constraint.category}`);
    }
    if (!CONSTRAINT_STATUSES.includes(constraint.status)) {
      throw new Error(`Invalid constraint status: ${constraint.status}`);
    }
    if (!CONSTRAINT_LANGUAGES.includes(constraint.language)) {
      throw new Error(`Invalid constraint language: ${constraint.language}`);
    }
  }

  private constraintAppliesToFile(constraint: Constraint, filePath: string): boolean {
    const scope = constraint.scope;

    // Check exclusions first
    if (scope.exclude?.files?.length) {
      for (const pattern of scope.exclude.files) {
        if (this.matchGlob(filePath, pattern)) {
          return false;
        }
      }
    }

    if (scope.exclude?.directories?.length) {
      for (const dir of scope.exclude.directories) {
        if (filePath.includes(dir)) {
          return false;
        }
      }
    }

    // Check inclusions
    if (scope.files?.length) {
      return scope.files.some(pattern => this.matchGlob(filePath, pattern));
    }

    // Check language match
    if (constraint.language !== 'all') {
      const ext = path.extname(filePath).toLowerCase();
      const langExtensions: Record<ConstraintLanguage, string[]> = {
        typescript: ['.ts', '.tsx'],
        javascript: ['.js', '.jsx', '.mjs', '.cjs'],
        python: ['.py'],
        java: ['.java'],
        csharp: ['.cs'],
        php: ['.php'],
        all: [],
      };

      if (!langExtensions[constraint.language].includes(ext)) {
        return false;
      }
    }

    // If no specific file scope, constraint applies to all matching language files
    return true;
  }

  private matchGlob(filePath: string, pattern: string): boolean {
    // Simple glob matching (supports * and **)
    const regexPattern = pattern
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{GLOBSTAR}}/g, '.*')
      .replace(/\//g, '\\/');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }

  private async saveConstraint(constraint: Constraint): Promise<void> {
    const filePath = this.getConstraintFilePath(constraint);
    const dir = path.dirname(filePath);

    // Load existing file or create new
    let fileData: ConstraintFile;
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      fileData = JSON.parse(content);
    } catch {
      fileData = {
        version: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        category: constraint.category,
        status: constraint.status,
        constraints: [],
      };
    }

    // Update or add constraint
    const existingIndex = fileData.constraints.findIndex(c => c.id === constraint.id);
    if (existingIndex >= 0) {
      fileData.constraints[existingIndex] = constraint;
    } else {
      fileData.constraints.push(constraint);
    }

    fileData.generatedAt = new Date().toISOString();

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(fileData, null, 2));
  }

  private async removeConstraintFile(constraint: Constraint): Promise<void> {
    const filePath = this.getConstraintFilePath(constraint);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const fileData: ConstraintFile = JSON.parse(content);

      fileData.constraints = fileData.constraints.filter(c => c.id !== constraint.id);

      if (fileData.constraints.length === 0) {
        await fs.unlink(filePath);
      } else {
        fileData.generatedAt = new Date().toISOString();
        await fs.writeFile(filePath, JSON.stringify(fileData, null, 2));
      }
    } catch {
      // File doesn't exist, nothing to remove
    }
  }

  private getConstraintFilePath(constraint: Constraint): string {
    return path.join(
      this.constraintsDir,
      constraint.status,
      `${constraint.category}.json`
    );
  }

  private async saveAll(): Promise<void> {
    // Group constraints by status and category
    const grouped = new Map<string, Constraint[]>();

    for (const constraint of this.constraints.values()) {
      const key = `${constraint.status}/${constraint.category}`;
      const list = grouped.get(key) ?? [];
      list.push(constraint);
      grouped.set(key, list);
    }

    // Save each group
    for (const [key, constraints] of grouped) {
      const [status, category] = key.split('/');
      const filePath = path.join(this.constraintsDir, status!, `${category}.json`);

      const fileData: ConstraintFile = {
        version: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        category: category as ConstraintCategory,
        status: status as ConstraintStatus,
        constraints,
      };

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(fileData, null, 2));
    }
  }

  private async loadOrRebuildIndex(): Promise<void> {
    const indexPath = path.join(this.constraintsDir, INDEX_FILE);

    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      this.index = JSON.parse(content);
    } catch {
      await this.rebuildIndex();
    }
  }

  private async rebuildIndex(): Promise<void> {
    // Build summaries directly (avoid ensureInitialized check during init)
    const summaries: ConstraintSummary[] = Array.from(this.constraints.values()).map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      category: c.category,
      language: c.language,
      status: c.status,
      confidence: c.confidence.score,
      enforcement: c.enforcement.level,
      evidence: c.confidence.evidence,
      violations: c.confidence.violations,
      type: c.invariant.type,
    }));

    // Build counts directly (avoid ensureInitialized check during init)
    const counts: ConstraintCounts = {
      total: this.constraints.size,
      byStatus: {} as Record<ConstraintStatus, number>,
      byCategory: {} as Record<ConstraintCategory, number>,
      byLanguage: {} as Record<ConstraintLanguage, number>,
      byEnforcement: { error: 0, warning: 0, info: 0 },
    };

    for (const status of CONSTRAINT_STATUSES) {
      counts.byStatus[status] = 0;
    }
    for (const category of CONSTRAINT_CATEGORIES) {
      counts.byCategory[category] = 0;
    }
    for (const language of CONSTRAINT_LANGUAGES) {
      counts.byLanguage[language] = 0;
    }

    for (const constraint of this.constraints.values()) {
      counts.byStatus[constraint.status]++;
      counts.byCategory[constraint.category]++;
      counts.byLanguage[constraint.language]++;
      counts.byEnforcement[constraint.enforcement.level]++;
    }

    // Build lookup maps
    const byFile: Record<string, string[]> = {};
    const byCategory: Record<string, string[]> = {};
    const byLanguage: Record<string, string[]> = {};
    const byStatus: Record<string, string[]> = {};

    for (const constraint of this.constraints.values()) {
      // By category
      const categoryList = byCategory[constraint.category] ?? [];
      categoryList.push(constraint.id);
      byCategory[constraint.category] = categoryList;

      // By language
      const languageList = byLanguage[constraint.language] ?? [];
      languageList.push(constraint.id);
      byLanguage[constraint.language] = languageList;

      // By status
      const statusList = byStatus[constraint.status] ?? [];
      statusList.push(constraint.id);
      byStatus[constraint.status] = statusList;

      // By file patterns
      if (constraint.scope.files) {
        for (const pattern of constraint.scope.files) {
          const fileList = byFile[pattern] ?? [];
          fileList.push(constraint.id);
          byFile[pattern] = fileList;
        }
      }
    }

    this.index = {
      version: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      counts,
      byFile,
      byCategory,
      byLanguage,
      byStatus,
      summaries,
    };

    // Save index
    const indexPath = path.join(this.constraintsDir, INDEX_FILE);
    await fs.writeFile(indexPath, JSON.stringify(this.index, null, 2));
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createConstraintStore(config: ConstraintStoreConfig): ConstraintStore {
  return new ConstraintStore(config);
}
