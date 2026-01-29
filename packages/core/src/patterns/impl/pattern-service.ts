/**
 * Pattern Service Implementation
 *
 * High-level service for pattern operations. This is the recommended
 * interface for all consumers (MCP tools, CLI, Dashboard).
 *
 * @module patterns/impl/pattern-service
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { DEFAULT_SERVICE_CONFIG } from '../service.js';
import { PATTERN_CATEGORIES, toPatternSummary } from '../types.js';

import type { IPatternRepository, PatternQueryOptions, PatternQueryResult, PatternFilter } from '../repository.js';
import type {
  IPatternService,
  PatternSystemStatus,
  CategorySummary,
  PatternWithExamples,
  CodeExample,
  ListOptions,
  PaginatedResult,
  SearchOptions,
  PatternServiceConfig,
} from '../service.js';
import type {
  Pattern,
  PatternCategory,
  PatternStatus,
  ConfidenceLevel,
  PatternSummary,
} from '../types.js';

// ============================================================================
// Language Detection
// ============================================================================

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.sql': 'sql',
};

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_EXTENSIONS[ext] ?? 'text';
}

// ============================================================================
// Pattern Service Implementation
// ============================================================================

/**
 * Pattern Service implementation.
 *
 * Provides high-level operations on top of the pattern repository.
 */
export class PatternService implements IPatternService {
  private readonly repository: IPatternRepository;
  private readonly config: Required<PatternServiceConfig>;
  private readonly rootDir: string;

  // Simple in-memory cache for status
  private statusCache: { value: PatternSystemStatus; expiresAt: number } | null = null;

  constructor(
    repository: IPatternRepository,
    rootDir: string,
    config: Partial<PatternServiceConfig> = {}
  ) {
    this.repository = repository;
    this.rootDir = rootDir;
    this.config = { ...DEFAULT_SERVICE_CONFIG, ...config };
  }

  // ==========================================================================
  // Discovery (instant, lightweight)
  // ==========================================================================

  async getStatus(): Promise<PatternSystemStatus> {
    // Check cache
    if (
      this.config.enableCache &&
      this.statusCache &&
      Date.now() < this.statusCache.expiresAt
    ) {
      return this.statusCache.value;
    }

    const patterns = await this.repository.getAll();

    // Compute status
    const byStatus: Record<PatternStatus, number> = {
      discovered: 0,
      approved: 0,
      ignored: 0,
    };

    const byCategory: Record<PatternCategory, number> = {} as Record<PatternCategory, number>;
    for (const cat of PATTERN_CATEGORIES) {
      byCategory[cat] = 0;
    }

    const byConfidence: Record<ConfidenceLevel, number> = {
      high: 0,
      medium: 0,
      low: 0,
      uncertain: 0,
    };

    let lastScanAt: Date | null = null;

    for (const pattern of patterns) {
      byStatus[pattern.status]++;
      byCategory[pattern.category]++;
      byConfidence[pattern.confidenceLevel]++;

      const lastSeen = new Date(pattern.lastSeen);
      if (!lastScanAt || lastSeen > lastScanAt) {
        lastScanAt = lastSeen;
      }
    }

    // Compute health score (0-100)
    const healthScore = this.computeHealthScore(patterns, byStatus, byConfidence);

    const status: PatternSystemStatus = {
      totalPatterns: patterns.length,
      byStatus,
      byCategory,
      byConfidence,
      lastScanAt,
      healthScore,
    };

    // Cache the result
    if (this.config.enableCache) {
      this.statusCache = {
        value: status,
        expiresAt: Date.now() + this.config.cacheTtlMs,
      };
    }

    return status;
  }

  private computeHealthScore(
    patterns: Pattern[],
    byStatus: Record<PatternStatus, number>,
    byConfidence: Record<ConfidenceLevel, number>
  ): number {
    if (patterns.length === 0) {return 100;}

    // Factors:
    // 1. Approval rate (40% weight)
    const approvalRate = byStatus.approved / patterns.length;
    const approvalScore = approvalRate * 40;

    // 2. High confidence rate (30% weight)
    const highConfidenceRate = byConfidence.high / patterns.length;
    const confidenceScore = highConfidenceRate * 30;

    // 3. Low outlier rate (30% weight)
    const totalOutliers = patterns.reduce((sum, p) => sum + p.outliers.length, 0);
    const totalLocations = patterns.reduce((sum, p) => sum + p.locations.length, 0);
    const outlierRate = totalLocations > 0 ? totalOutliers / totalLocations : 0;
    const outlierScore = (1 - Math.min(outlierRate, 1)) * 30;

    return Math.round(approvalScore + confidenceScore + outlierScore);
  }

  async getCategories(): Promise<CategorySummary[]> {
    const patterns = await this.repository.getAll();

    const summaries: Map<PatternCategory, CategorySummary> = new Map();

    for (const cat of PATTERN_CATEGORIES) {
      summaries.set(cat, {
        category: cat,
        count: 0,
        approvedCount: 0,
        discoveredCount: 0,
        highConfidenceCount: 0,
      });
    }

    for (const pattern of patterns) {
      const summary = summaries.get(pattern.category)!;
      summary.count++;
      if (pattern.status === 'approved') {summary.approvedCount++;}
      if (pattern.status === 'discovered') {summary.discoveredCount++;}
      if (pattern.confidenceLevel === 'high') {summary.highConfidenceCount++;}
    }

    // Return only categories with patterns
    return Array.from(summaries.values()).filter((s) => s.count > 0);
  }

  // ==========================================================================
  // Exploration (paginated)
  // ==========================================================================

  async listPatterns(options?: ListOptions): Promise<PaginatedResult<PatternSummary>> {
    const queryOptions = this.listOptionsToQueryOptions(options);
    const result = await this.repository.query(queryOptions);

    return {
      items: result.patterns.map(toPatternSummary),
      total: result.total,
      hasMore: result.hasMore,
      offset: options?.offset ?? 0,
      limit: options?.limit ?? 20,
    };
  }

  async listByCategory(
    category: PatternCategory,
    options?: ListOptions
  ): Promise<PaginatedResult<PatternSummary>> {
    const queryOptions = this.listOptionsToQueryOptions(options);
    queryOptions.filter = {
      ...queryOptions.filter,
      categories: [category],
    };

    const result = await this.repository.query(queryOptions);

    return {
      items: result.patterns.map(toPatternSummary),
      total: result.total,
      hasMore: result.hasMore,
      offset: options?.offset ?? 0,
      limit: options?.limit ?? 20,
    };
  }

  async listByStatus(
    status: PatternStatus,
    options?: ListOptions
  ): Promise<PaginatedResult<PatternSummary>> {
    const queryOptions = this.listOptionsToQueryOptions(options);
    queryOptions.filter = {
      ...queryOptions.filter,
      statuses: [status],
    };

    const result = await this.repository.query(queryOptions);

    return {
      items: result.patterns.map(toPatternSummary),
      total: result.total,
      hasMore: result.hasMore,
      offset: options?.offset ?? 0,
      limit: options?.limit ?? 20,
    };
  }

  private listOptionsToQueryOptions(options?: ListOptions): PatternQueryOptions {
    const queryOptions: PatternQueryOptions = {
      filter: {},
      pagination: {
        offset: options?.offset ?? 0,
        limit: options?.limit ?? 20,
      },
    };

    if (options?.sortBy) {
      queryOptions.sort = {
        field: options.sortBy,
        direction: options.sortDirection ?? 'desc',
      };
    }

    return queryOptions;
  }

  // ==========================================================================
  // Detail (focused)
  // ==========================================================================

  async getPattern(id: string): Promise<Pattern | null> {
    return this.repository.get(id);
  }

  async getPatternWithExamples(
    id: string,
    maxExamples: number = 3
  ): Promise<PatternWithExamples | null> {
    const pattern = await this.repository.get(id);
    if (!pattern) {return null;}

    // Extract code examples from locations
    const codeExamples = await this.extractCodeExamples(
      pattern.locations,
      maxExamples
    );

    // Find related patterns (same category and subcategory)
    const relatedResult = await this.repository.query({
      filter: {
        categories: [pattern.category],
      },
      pagination: { offset: 0, limit: 5 },
    });

    const relatedPatterns = relatedResult.patterns
      .filter((p) => p.id !== pattern.id)
      .slice(0, 4)
      .map(toPatternSummary);

    return {
      ...pattern,
      codeExamples,
      relatedPatterns,
    };
  }

  private async extractCodeExamples(
    locations: Pattern['locations'],
    maxExamples: number
  ): Promise<CodeExample[]> {
    const examples: CodeExample[] = [];
    const contextLines = this.config.codeExampleContextLines;

    // Take up to maxExamples locations
    const selectedLocations = locations.slice(0, maxExamples);

    for (const location of selectedLocations) {
      try {
        const filePath = path.join(this.rootDir, location.file);
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        const startLine = Math.max(1, location.line - contextLines);
        const endLine = Math.min(
          lines.length,
          (location.endLine ?? location.line) + contextLines
        );

        const code = lines.slice(startLine - 1, endLine).join('\n');

        examples.push({
          file: location.file,
          startLine,
          endLine,
          code,
          language: detectLanguage(location.file),
        });
      } catch {
        // File not found or unreadable, skip
      }
    }

    return examples;
  }

  async getPatternsByFile(file: string): Promise<Pattern[]> {
    return this.repository.getByFile(file);
  }

  // ==========================================================================
  // Actions
  // ==========================================================================

  async approvePattern(id: string, approvedBy?: string): Promise<Pattern> {
    this.invalidateStatusCache();
    return this.repository.approve(id, approvedBy);
  }

  async ignorePattern(id: string): Promise<Pattern> {
    this.invalidateStatusCache();
    return this.repository.ignore(id);
  }

  async approveMany(ids: string[], approvedBy?: string): Promise<Pattern[]> {
    this.invalidateStatusCache();
    const results: Pattern[] = [];
    for (const id of ids) {
      const pattern = await this.repository.approve(id, approvedBy);
      results.push(pattern);
    }
    return results;
  }

  async ignoreMany(ids: string[]): Promise<Pattern[]> {
    this.invalidateStatusCache();
    const results: Pattern[] = [];
    for (const id of ids) {
      const pattern = await this.repository.ignore(id);
      results.push(pattern);
    }
    return results;
  }

  private invalidateStatusCache(): void {
    this.statusCache = null;
  }

  // ==========================================================================
  // Search
  // ==========================================================================

  async search(query: string, options?: SearchOptions): Promise<PatternSummary[]> {
    const filter: PatternFilter = {
      search: query,
    };

    if (options?.categories) {
      filter.categories = options.categories;
    }
    if (options?.statuses) {
      filter.statuses = options.statuses;
    }
    if (options?.minConfidence !== undefined) {
      filter.minConfidence = options.minConfidence;
    }

    const result = await this.repository.query({
      filter,
      pagination: {
        offset: 0,
        limit: options?.limit ?? 20,
      },
    });

    return result.patterns.map(toPatternSummary);
  }

  // ==========================================================================
  // Advanced Queries
  // ==========================================================================

  async query(options: PatternQueryOptions): Promise<PatternQueryResult> {
    return this.repository.query(options);
  }

  // ==========================================================================
  // Write Operations (for producers like scan)
  // ==========================================================================

  async addPattern(pattern: Pattern): Promise<void> {
    this.invalidateStatusCache();
    await this.repository.add(pattern);
  }

  async addPatterns(patterns: Pattern[]): Promise<void> {
    this.invalidateStatusCache();
    await this.repository.addMany(patterns);
  }

  async updatePattern(id: string, updates: Partial<Pattern>): Promise<Pattern> {
    this.invalidateStatusCache();
    return this.repository.update(id, updates);
  }

  async deletePattern(id: string): Promise<boolean> {
    this.invalidateStatusCache();
    return this.repository.delete(id);
  }

  async save(): Promise<void> {
    await this.repository.saveAll();
  }

  async clear(): Promise<void> {
    this.invalidateStatusCache();
    await this.repository.clear();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new PatternService instance.
 */
export function createPatternService(
  repository: IPatternRepository,
  rootDir: string,
  config?: Partial<PatternServiceConfig>
): IPatternService {
  return new PatternService(repository, rootDir, config);
}
