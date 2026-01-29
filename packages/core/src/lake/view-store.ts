/**
 * View Store
 *
 * Manages materialized views - pre-computed responses for common queries.
 * Views are generated during scan and read instantly at query time.
 *
 * Key features:
 * - Pre-computed status view for instant drift_status
 * - Pattern index for fast listing without full load
 * - Security summary for instant security overview
 * - Trends view for pre-computed trend analysis
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  LAKE_DIRS,
  VIEW_FILES,
  DEFAULT_DATA_LAKE_CONFIG,
} from './types.js';

import type {
  StatusView,
  PatternIndexView,
  PatternSummary,
  SecuritySummaryView,
  TrendsView,
  HealthFactor,
  TopIssue,
  DataLakeConfig,
  ViewType,
} from './types.js';
import type { Pattern } from '../store/types.js';

// ============================================================================
// Helper Functions
// ============================================================================

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

// ============================================================================
// View Store Class
// ============================================================================

export class ViewStore extends EventEmitter {
  private readonly config: DataLakeConfig;
  private readonly viewsDir: string;

  // In-memory cache for hot views
  private statusCache: StatusView | null = null;
  private patternIndexCache: PatternIndexView | null = null;
  private securitySummaryCache: SecuritySummaryView | null = null;
  private trendsCache: TrendsView | null = null;

  constructor(config: Partial<DataLakeConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DATA_LAKE_CONFIG, ...config };
    this.viewsDir = path.join(
      this.config.rootDir,
      LAKE_DIRS.root,
      LAKE_DIRS.views
    );
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    await ensureDir(this.viewsDir);
  }

  // ==========================================================================
  // Status View
  // ==========================================================================

  async getStatusView(): Promise<StatusView | null> {
    if (this.statusCache) {
      return this.statusCache;
    }

    const filePath = path.join(this.viewsDir, VIEW_FILES.status);
    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.statusCache = JSON.parse(content) as StatusView;
      return this.statusCache;
    } catch {
      return null;
    }
  }

  async saveStatusView(view: StatusView): Promise<void> {
    await ensureDir(this.viewsDir);
    const filePath = path.join(this.viewsDir, VIEW_FILES.status);
    await fs.writeFile(filePath, JSON.stringify(view, null, 2));
    this.statusCache = view;
    this.emit('view:saved', 'status', view);
  }

  /**
   * Build status view from patterns and other data
   */
  buildStatusView(
    patterns: Pattern[],
    securityData?: {
      violations: number;
      sensitiveExposures: number;
      riskLevel: 'low' | 'medium' | 'high' | 'critical';
    },
    lastScan?: {
      timestamp: string;
      duration: number;
      filesScanned: number;
      patternsFound: number;
      errors: number;
    }
  ): StatusView {
    const now = new Date().toISOString();

    // Calculate pattern stats
    const approved = patterns.filter(p => p.status === 'approved').length;
    const discovered = patterns.filter(p => p.status === 'discovered').length;
    const ignored = patterns.filter(p => p.status === 'ignored').length;

    const byCategory: Record<string, number> = {};
    for (const pattern of patterns) {
      byCategory[pattern.category] = (byCategory[pattern.category] ?? 0) + 1;
    }

    // Calculate health score
    const highConfidence = patterns.filter(p => p.confidence.score >= 0.85).length;
    const healthScore = Math.round(
      (approved / Math.max(1, patterns.length)) * 50 +
      (highConfidence / Math.max(1, patterns.length)) * 50
    );

    // Identify top issues
    const topIssues: TopIssue[] = [];
    
    // Add patterns with many outliers
    const outlierPatterns = patterns
      .filter(p => p.outliers.length > 0)
      .sort((a, b) => b.outliers.length - a.outliers.length)
      .slice(0, 3);

    for (const pattern of outlierPatterns) {
      topIssues.push({
        id: `outlier-${pattern.id}`,
        type: 'outlier',
        severity: pattern.outliers.length >= 5 ? 'critical' : 'warning',
        message: `${pattern.name} has ${pattern.outliers.length} outliers`,
        patternId: pattern.id,
      });
    }

    // Calculate health factors
    const healthFactors: HealthFactor[] = [
      {
        name: 'Pattern Approval Rate',
        score: approved / Math.max(1, patterns.length),
        weight: 0.3,
        trend: 'stable',
      },
      {
        name: 'High Confidence Patterns',
        score: highConfidence / Math.max(1, patterns.length),
        weight: 0.3,
        trend: 'stable',
      },
      {
        name: 'Low Outlier Rate',
        score: 1 - (patterns.reduce((sum, p) => sum + p.outliers.length, 0) /
          Math.max(1, patterns.reduce((sum, p) => sum + p.locations.length + p.outliers.length, 0))),
        weight: 0.4,
        trend: 'stable',
      },
    ];

    return {
      generatedAt: now,
      health: {
        score: healthScore,
        trend: 'stable', // Would need history to determine
        factors: healthFactors,
      },
      patterns: {
        total: patterns.length,
        approved,
        discovered,
        ignored,
        byCategory,
      },
      issues: {
        critical: topIssues.filter(i => i.severity === 'critical').length,
        warnings: topIssues.filter(i => i.severity === 'warning').length,
        topIssues,
      },
      security: securityData ?? {
        riskLevel: 'low',
        violations: 0,
        sensitiveExposures: 0,
      },
      lastScan: lastScan ?? {
        timestamp: now,
        duration: 0,
        filesScanned: 0,
        patternsFound: patterns.length,
        errors: 0,
      },
    };
  }

  // ==========================================================================
  // Pattern Index View
  // ==========================================================================

  async getPatternIndexView(): Promise<PatternIndexView | null> {
    if (this.patternIndexCache) {
      return this.patternIndexCache;
    }

    const filePath = path.join(this.viewsDir, VIEW_FILES.patternIndex);
    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.patternIndexCache = JSON.parse(content) as PatternIndexView;
      return this.patternIndexCache;
    } catch {
      return null;
    }
  }

  async savePatternIndexView(view: PatternIndexView): Promise<void> {
    await ensureDir(this.viewsDir);
    const filePath = path.join(this.viewsDir, VIEW_FILES.patternIndex);
    await fs.writeFile(filePath, JSON.stringify(view, null, 2));
    this.patternIndexCache = view;
    this.emit('view:saved', 'patternIndex', view);
  }

  /**
   * Build pattern index from full patterns
   */
  buildPatternIndexView(patterns: Pattern[]): PatternIndexView {
    const summaries: PatternSummary[] = patterns.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      subcategory: p.subcategory,
      status: p.status,
      confidence: p.confidence.score,
      confidenceLevel: p.confidence.level,
      locationCount: p.locations.length,
      outlierCount: p.outliers.length,
      severity: p.severity,
      locationsHash: this.hashLocations(p.locations),
    }));

    return {
      generatedAt: new Date().toISOString(),
      total: patterns.length,
      patterns: summaries,
    };
  }

  private hashLocations(locations: Pattern['locations']): string {
    const data = locations.map(l => `${l.file}:${l.line}`).sort().join('|');
    // Simple hash - in production use crypto
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).slice(0, 8);
  }

  // ==========================================================================
  // Security Summary View
  // ==========================================================================

  async getSecuritySummaryView(): Promise<SecuritySummaryView | null> {
    if (this.securitySummaryCache) {
      return this.securitySummaryCache;
    }

    const filePath = path.join(this.viewsDir, VIEW_FILES.securitySummary);
    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.securitySummaryCache = JSON.parse(content) as SecuritySummaryView;
      return this.securitySummaryCache;
    } catch {
      return null;
    }
  }

  async saveSecuritySummaryView(view: SecuritySummaryView): Promise<void> {
    await ensureDir(this.viewsDir);
    const filePath = path.join(this.viewsDir, VIEW_FILES.securitySummary);
    await fs.writeFile(filePath, JSON.stringify(view, null, 2));
    this.securitySummaryCache = view;
    this.emit('view:saved', 'securitySummary', view);
  }

  // ==========================================================================
  // Trends View
  // ==========================================================================

  async getTrendsView(): Promise<TrendsView | null> {
    if (this.trendsCache) {
      return this.trendsCache;
    }

    const filePath = path.join(this.viewsDir, VIEW_FILES.trends);
    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.trendsCache = JSON.parse(content) as TrendsView;
      return this.trendsCache;
    } catch {
      return null;
    }
  }

  async saveTrendsView(view: TrendsView): Promise<void> {
    await ensureDir(this.viewsDir);
    const filePath = path.join(this.viewsDir, VIEW_FILES.trends);
    await fs.writeFile(filePath, JSON.stringify(view, null, 2));
    this.trendsCache = view;
    this.emit('view:saved', 'trends', view);
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  invalidateCache(view?: ViewType): void {
    if (!view) {
      this.statusCache = null;
      this.patternIndexCache = null;
      this.securitySummaryCache = null;
      this.trendsCache = null;
      return;
    }

    switch (view) {
      case 'status':
        this.statusCache = null;
        break;
      case 'patternIndex':
        this.patternIndexCache = null;
        break;
      case 'securitySummary':
        this.securitySummaryCache = null;
        break;
      case 'trends':
        this.trendsCache = null;
        break;
    }
  }

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  async hasView(view: ViewType): Promise<boolean> {
    const files: Record<ViewType, string> = {
      status: VIEW_FILES.status,
      patternIndex: VIEW_FILES.patternIndex,
      securitySummary: VIEW_FILES.securitySummary,
      trends: VIEW_FILES.trends,
      examples: 'examples', // Directory, not file
    };

    const filePath = path.join(this.viewsDir, files[view]);
    return fileExists(filePath);
  }

  async deleteView(view: ViewType): Promise<void> {
    const files: Record<ViewType, string> = {
      status: VIEW_FILES.status,
      patternIndex: VIEW_FILES.patternIndex,
      securitySummary: VIEW_FILES.securitySummary,
      trends: VIEW_FILES.trends,
      examples: 'examples',
    };

    const filePath = path.join(this.viewsDir, files[view]);
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore if doesn't exist
    }
    this.invalidateCache(view);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createViewStore(config: Partial<DataLakeConfig> = {}): ViewStore {
  return new ViewStore(config);
}
