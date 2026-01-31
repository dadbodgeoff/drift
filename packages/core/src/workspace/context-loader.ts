/**
 * Context Loader
 * 
 * Enterprise-grade context loading system that pre-loads workspace
 * data for fast access by CLI and MCP commands.
 * 
 * Features:
 * - Lazy loading with caching
 * - Automatic cache invalidation
 * - Memory-efficient summaries
 * - Fast startup times
 * 
 * @module workspace/context-loader
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {
  WorkspaceContext,
  ProjectContext,
  LakeContext,
  AnalysisContext,
  PatternSummary,
  CallGraphSummary,
  BoundarySummary,
  WorkspaceManagerConfig,
} from './types.js';
import { DEFAULT_WORKSPACE_CONFIG } from './types.js';

// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';
const CONTEXT_CACHE_FILE = '.context-cache.json';
const SOURCE_OF_TRUTH_FILE = 'source-of-truth.json';

// ============================================================================
// Context Loader Class
// ============================================================================

export class ContextLoader {
  private readonly rootDir: string;
  private readonly driftDir: string;
  private readonly config: WorkspaceManagerConfig;
  private cachedContext: WorkspaceContext | null = null;
  private cacheLoadedAt: number = 0;

  constructor(
    rootDir: string,
    config: Partial<WorkspaceManagerConfig> = {}
  ) {
    this.rootDir = rootDir;
    this.driftDir = path.join(rootDir, DRIFT_DIR);
    this.config = { ...DEFAULT_WORKSPACE_CONFIG, ...config };
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Load workspace context (with caching)
   */
  async loadContext(forceRefresh = false): Promise<WorkspaceContext> {
    // Check cache validity
    if (!forceRefresh && this.isCacheValid()) {
      return this.cachedContext!;
    }

    // Try to load from disk cache first
    if (!forceRefresh && this.config.enableContextCache) {
      const diskCache = await this.loadDiskCache();
      if (diskCache && this.isDiskCacheValid(diskCache)) {
        this.cachedContext = diskCache;
        this.cacheLoadedAt = Date.now();
        return diskCache;
      }
    }

    // Load fresh context
    const context = await this.loadFreshContext();
    
    // Update caches
    this.cachedContext = context;
    this.cacheLoadedAt = Date.now();
    
    if (this.config.enableContextCache) {
      await this.saveDiskCache(context);
    }

    return context;
  }

  /**
   * Get project context only (lightweight)
   */
  async getProjectContext(): Promise<ProjectContext> {
    const context = await this.loadContext();
    return context.project;
  }

  /**
   * Get lake context only
   */
  async getLakeContext(): Promise<LakeContext> {
    const context = await this.loadContext();
    return context.lake;
  }

  /**
   * Get analysis state
   */
  async getAnalysisContext(): Promise<AnalysisContext> {
    const context = await this.loadContext();
    return context.analysis;
  }

  /**
   * Invalidate cache (call after modifications)
   */
  invalidateCache(): void {
    this.cachedContext = null;
    this.cacheLoadedAt = 0;
  }

  /**
   * Check if drift is initialized
   */
  async isInitialized(): Promise<boolean> {
    try {
      await fs.access(this.driftDir);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Source of Truth exists
   */
  async hasSourceOfTruth(): Promise<boolean> {
    try {
      await fs.access(path.join(this.driftDir, SOURCE_OF_TRUTH_FILE));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Source of Truth data
   */
  async getSourceOfTruth(): Promise<unknown | null> {
    try {
      const sotPath = path.join(this.driftDir, SOURCE_OF_TRUTH_FILE);
      const content = await fs.readFile(sotPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private isCacheValid(): boolean {
    if (!this.cachedContext) return false;
    
    const age = Date.now() - this.cacheLoadedAt;
    return age < this.config.contextCacheTTL * 1000;
  }

  private isDiskCacheValid(cache: WorkspaceContext): boolean {
    const validUntil = new Date(cache.validUntil).getTime();
    return Date.now() < validUntil;
  }

  private async loadDiskCache(): Promise<WorkspaceContext | null> {
    try {
      const cachePath = path.join(this.driftDir, CONTEXT_CACHE_FILE);
      const content = await fs.readFile(cachePath, 'utf-8');
      return JSON.parse(content) as WorkspaceContext;
    } catch {
      return null;
    }
  }

  private async saveDiskCache(context: WorkspaceContext): Promise<void> {
    try {
      const cachePath = path.join(this.driftDir, CONTEXT_CACHE_FILE);
      await fs.writeFile(cachePath, JSON.stringify(context, null, 2));
    } catch {
      // Cache save failure is non-critical
    }
  }

  private async loadFreshContext(): Promise<WorkspaceContext> {
    const now = new Date();
    const validUntil = new Date(now.getTime() + this.config.contextCacheTTL * 1000);

    const [project, lake, analysis] = await Promise.all([
      this.loadProjectContext(),
      this.loadLakeContext(),
      this.loadAnalysisContext(),
    ]);

    return {
      project,
      lake,
      analysis,
      loadedAt: now.toISOString(),
      validUntil: validUntil.toISOString(),
    };
  }

  private async loadProjectContext(): Promise<ProjectContext> {
    const configPath = path.join(this.driftDir, 'config.json');
    
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);

      // Detect languages and frameworks
      const languages = await this.detectLanguages();
      const frameworks = await this.detectFrameworks();

      return {
        id: config.project?.id ?? '',
        name: config.project?.name ?? path.basename(this.rootDir),
        rootPath: this.rootDir,
        driftPath: this.driftDir,
        schemaVersion: config.version ?? '2.0.0',
        driftVersion: config.driftVersion ?? 'unknown',
        lastScanAt: config.lastScanAt,
        healthScore: config.healthScore,
        languages,
        frameworks,
      };
    } catch {
      return {
        id: '',
        name: path.basename(this.rootDir),
        rootPath: this.rootDir,
        driftPath: this.driftDir,
        schemaVersion: '2.0.0',
        driftVersion: 'unknown',
        languages: [],
        frameworks: [],
      };
    }
  }

  private async loadLakeContext(): Promise<LakeContext> {
    const patternSummary = await this.loadPatternSummary();
    const callGraphSummary = await this.loadCallGraphSummary();
    const boundarySummary = await this.loadBoundarySummary();

    return {
      available: patternSummary.total > 0,
      patternSummary,
      callGraphSummary,
      boundarySummary,
      lastUpdatedAt: await this.getLastLakeUpdate(),
    };
  }

  private async loadPatternSummary(): Promise<PatternSummary> {
    const summary: PatternSummary = {
      total: 0,
      byStatus: { discovered: 0, approved: 0, ignored: 0 },
      byCategory: {},
      byConfidence: { high: 0, medium: 0, low: 0, uncertain: 0 },
    };

    // Load from views if available (fast path)
    try {
      const viewPath = path.join(this.driftDir, 'views', 'status.json');
      const content = await fs.readFile(viewPath, 'utf-8');
      const view = JSON.parse(content);
      
      if (view.patterns) {
        summary.total = view.patterns.total ?? 0;
        summary.byStatus = view.patterns.byStatus ?? summary.byStatus;
        summary.byCategory = view.patterns.byCategory ?? {};
        summary.byConfidence = view.patterns.byConfidence ?? summary.byConfidence;
        return summary;
      }
    } catch {
      // Views not available, count from files
    }

    // Count from pattern files (slow path)
    const statuses = ['discovered', 'approved', 'ignored'] as const;
    
    for (const status of statuses) {
      const dir = path.join(this.driftDir, 'patterns', status);
      try {
        const files = await fs.readdir(dir);
        const count = files.filter(f => f.endsWith('.json')).length;
        summary.byStatus[status] = count;
        summary.total += count;
      } catch {
        // Directory doesn't exist
      }
    }

    return summary;
  }

  private async loadCallGraphSummary(): Promise<CallGraphSummary | undefined> {
    try {
      // Check for SQLite database (preferred)
      const dbPath = path.join(this.driftDir, 'lake', 'callgraph', 'callgraph.db');
      await fs.access(dbPath);
      
      // Load summary from index
      const indexPath = path.join(this.driftDir, 'lake', 'callgraph', 'index.json');
      const content = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(content);
      
      return {
        functions: index.totalFunctions ?? 0,
        callSites: index.totalCallSites ?? 0,
        entryPoints: index.entryPoints ?? 0,
        dataAccessors: index.dataAccessors ?? 0,
        builtAt: index.builtAt,
      };
    } catch {
      return undefined;
    }
  }

  private async loadBoundarySummary(): Promise<BoundarySummary | undefined> {
    try {
      const accessMapPath = path.join(this.driftDir, 'boundaries', 'access-map.json');
      const content = await fs.readFile(accessMapPath, 'utf-8');
      const accessMap = JSON.parse(content);
      
      return {
        tables: Object.keys(accessMap.tables ?? {}).length,
        accessPoints: accessMap.totalAccessPoints ?? 0,
        sensitiveFields: accessMap.sensitiveFields?.length ?? 0,
      };
    } catch {
      return undefined;
    }
  }

  private async loadAnalysisContext(): Promise<AnalysisContext> {
    const [
      callGraphBuilt,
      testTopologyBuilt,
      couplingBuilt,
      dnaProfileExists,
      memoryInitialized,
      constantsExtracted,
    ] = await Promise.all([
      this.checkExists('lake/callgraph/callgraph.db'),
      this.checkExists('test-topology/summary.json'),
      this.checkExists('module-coupling/graph.json'),
      this.checkExists('dna/profile.json'),
      this.checkExists('memory/memories.json'),
      this.checkExists('constants/index.json'),
    ]);

    return {
      callGraphBuilt,
      testTopologyBuilt,
      couplingBuilt,
      dnaProfileExists,
      memoryInitialized,
      constantsExtracted,
    };
  }

  private async checkExists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.driftDir, relativePath));
      return true;
    } catch {
      return false;
    }
  }

  private async getLastLakeUpdate(): Promise<string | undefined> {
    try {
      const manifestPath = path.join(this.driftDir, 'manifest.json');
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      return manifest.lastUpdatedAt;
    } catch {
      return undefined;
    }
  }

  private async detectLanguages(): Promise<string[]> {
    const languages: string[] = [];
    
    // Check for language indicators
    const indicators: Record<string, string[]> = {
      typescript: ['tsconfig.json', 'package.json'],
      python: ['requirements.txt', 'pyproject.toml', 'setup.py'],
      java: ['pom.xml', 'build.gradle'],
      csharp: ['*.csproj', '*.sln'],
      php: ['composer.json'],
      go: ['go.mod'],
      rust: ['Cargo.toml'],
    };

    for (const [lang, files] of Object.entries(indicators)) {
      for (const file of files) {
        try {
          if (file.includes('*')) {
            const entries = await fs.readdir(this.rootDir);
            if (entries.some(e => e.endsWith(file.replace('*', '')))) {
              languages.push(lang);
              break;
            }
          } else {
            await fs.access(path.join(this.rootDir, file));
            languages.push(lang);
            break;
          }
        } catch {
          continue;
        }
      }
    }

    return languages;
  }

  private async detectFrameworks(): Promise<string[]> {
    const frameworks: string[] = [];
    
    try {
      const pkgPath = path.join(this.rootDir, 'package.json');
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps['next']) frameworks.push('nextjs');
      else if (deps['react']) frameworks.push('react');
      if (deps['vue']) frameworks.push('vue');
      if (deps['@angular/core']) frameworks.push('angular');
      if (deps['express']) frameworks.push('express');
      if (deps['fastify']) frameworks.push('fastify');
      if (deps['@nestjs/core']) frameworks.push('nestjs');
    } catch {
      // No package.json
    }

    return frameworks;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a context loader instance
 */
export function createContextLoader(
  rootDir: string,
  config?: Partial<WorkspaceManagerConfig>
): ContextLoader {
  return new ContextLoader(rootDir, config);
}
