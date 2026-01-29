/**
 * Manifest Store
 *
 * Manages the drift manifest - the quick-load index of everything.
 * The manifest provides instant access to stats without loading full data.
 *
 * Key features:
 * - Single file read for drift_status
 * - File hashes for cache invalidation
 * - View freshness tracking
 * - Incremental updates
 */

import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  LAKE_VERSION,
  LAKE_DIRS,
  DEFAULT_DATA_LAKE_CONFIG,
} from './types.js';

import type {
  DriftManifest,
  ManifestStats,
  PatternStats,
  SecurityStats,
  CallGraphStats,
  ContractStats,
  DNAStats,
  LastScanInfo,
  ViewFreshness,
  ViewMeta,
  DataLakeConfig,
} from './types.js';
import type { PatternCategory } from '../store/types.js';

// ============================================================================
// Constants
// ============================================================================

const MANIFEST_FILE = 'manifest.json';

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

function createEmptyStats(): ManifestStats {
  return {
    patterns: {
      total: 0,
      byCategory: {} as Record<PatternCategory, number>,
      byStatus: { discovered: 0, approved: 0, ignored: 0 },
      byConfidence: { high: 0, medium: 0, low: 0, uncertain: 0 },
      totalLocations: 0,
      totalOutliers: 0,
    },
    security: {
      totalTables: 0,
      totalAccessPoints: 0,
      sensitiveFields: 0,
      violations: 0,
      riskLevel: 'low',
    },
    callGraph: {
      totalFunctions: 0,
      totalCalls: 0,
      entryPoints: 0,
      dataAccessors: 0,
      avgDepth: 0,
    },
    contracts: {
      verified: 0,
      mismatch: 0,
      discovered: 0,
      ignored: 0,
    },
    dna: {
      healthScore: 0,
      geneticDiversity: 0,
      mutations: 0,
      dominantGenes: [],
    },
  };
}

function createEmptyViewFreshness(): ViewFreshness {
  const now = new Date().toISOString();
  const emptyMeta: ViewMeta = {
    generatedAt: now,
    stale: true,
  };
  return {
    status: { ...emptyMeta },
    patternIndex: { ...emptyMeta },
    securitySummary: { ...emptyMeta },
    trends: { ...emptyMeta },
    examples: { ...emptyMeta },
  };
}

function createEmptyManifest(projectRoot: string): DriftManifest {
  const now = new Date().toISOString();
  return {
    version: LAKE_VERSION,
    generatedAt: now,
    projectRoot,
    stats: createEmptyStats(),
    fileHashes: {},
    lastScan: {
      timestamp: now,
      duration: 0,
      filesScanned: 0,
      patternsFound: 0,
      errors: 0,
    },
    views: createEmptyViewFreshness(),
  };
}

// ============================================================================
// Manifest Store Class
// ============================================================================

export class ManifestStore extends EventEmitter {
  private readonly config: DataLakeConfig;
  private readonly manifestPath: string;
  private manifest: DriftManifest | null = null;
  private dirty: boolean = false;

  constructor(config: Partial<DataLakeConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DATA_LAKE_CONFIG, ...config };
    this.manifestPath = path.join(
      this.config.rootDir,
      LAKE_DIRS.root,
      MANIFEST_FILE
    );
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    await ensureDir(path.dirname(this.manifestPath));
    await this.load();
  }

  async load(): Promise<DriftManifest> {
    if (!(await fileExists(this.manifestPath))) {
      this.manifest = createEmptyManifest(this.config.rootDir);
      return this.manifest;
    }

    try {
      const content = await fs.readFile(this.manifestPath, 'utf-8');
      this.manifest = JSON.parse(content) as DriftManifest;
      return this.manifest;
    } catch {
      this.manifest = createEmptyManifest(this.config.rootDir);
      return this.manifest;
    }
  }

  // ==========================================================================
  // Getters
  // ==========================================================================

  getManifest(): DriftManifest {
    if (!this.manifest) {
      return createEmptyManifest(this.config.rootDir);
    }
    return this.manifest;
  }

  getStats(): ManifestStats {
    return this.getManifest().stats;
  }

  getPatternStats(): PatternStats {
    return this.getStats().patterns;
  }

  getSecurityStats(): SecurityStats {
    return this.getStats().security;
  }

  getCallGraphStats(): CallGraphStats {
    return this.getStats().callGraph;
  }

  getContractStats(): ContractStats {
    return this.getStats().contracts;
  }

  getDNAStats(): DNAStats {
    return this.getStats().dna;
  }

  getLastScan(): LastScanInfo {
    return this.getManifest().lastScan;
  }

  getViewFreshness(): ViewFreshness {
    return this.getManifest().views;
  }

  // ==========================================================================
  // File Hash Management
  // ==========================================================================

  getFileHash(file: string): string | null {
    return this.getManifest().fileHashes[file] ?? null;
  }

  setFileHash(file: string, hash: string): void {
    if (!this.manifest) {
      this.manifest = createEmptyManifest(this.config.rootDir);
    }
    this.manifest.fileHashes[file] = hash;
    this.dirty = true;
  }

  async computeFileHash(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  hasFileChanged(file: string, newHash: string): boolean {
    const oldHash = this.getFileHash(file);
    return oldHash !== newHash;
  }

  // ==========================================================================
  // View Freshness
  // ==========================================================================

  isViewStale(view: keyof ViewFreshness): boolean {
    const meta = this.getViewFreshness()[view];
    if (meta.stale) {return true;}

    // Check TTL
    const age = Date.now() - new Date(meta.generatedAt).getTime();
    return age > this.config.viewTtlMs;
  }

  markViewFresh(view: keyof ViewFreshness): void {
    if (!this.manifest) {
      this.manifest = createEmptyManifest(this.config.rootDir);
    }
    this.manifest.views[view] = {
      generatedAt: new Date().toISOString(),
      stale: false,
    };
    this.dirty = true;
  }

  markViewStale(view: keyof ViewFreshness, reason?: string): void {
    if (!this.manifest) {
      this.manifest = createEmptyManifest(this.config.rootDir);
    }
    const existing = this.manifest.views[view];
    const newInvalidatedBy = reason
      ? [...(existing.invalidatedBy ?? []), reason]
      : existing.invalidatedBy;
    
    this.manifest.views[view] = {
      generatedAt: existing.generatedAt,
      stale: true,
      ...(newInvalidatedBy ? { invalidatedBy: newInvalidatedBy } : {}),
    };
    this.dirty = true;
  }

  markAllViewsStale(reason?: string): void {
    const views: (keyof ViewFreshness)[] = [
      'status',
      'patternIndex',
      'securitySummary',
      'trends',
      'examples',
    ];
    for (const view of views) {
      this.markViewStale(view, reason);
    }
  }

  // ==========================================================================
  // Stats Updates
  // ==========================================================================

  updatePatternStats(stats: Partial<PatternStats>): void {
    if (!this.manifest) {
      this.manifest = createEmptyManifest(this.config.rootDir);
    }
    this.manifest.stats.patterns = {
      ...this.manifest.stats.patterns,
      ...stats,
    };
    this.manifest.generatedAt = new Date().toISOString();
    this.dirty = true;
    this.markViewStale('status', 'pattern stats updated');
    this.markViewStale('patternIndex', 'pattern stats updated');
  }

  updateSecurityStats(stats: Partial<SecurityStats>): void {
    if (!this.manifest) {
      this.manifest = createEmptyManifest(this.config.rootDir);
    }
    this.manifest.stats.security = {
      ...this.manifest.stats.security,
      ...stats,
    };
    this.manifest.generatedAt = new Date().toISOString();
    this.dirty = true;
    this.markViewStale('status', 'security stats updated');
    this.markViewStale('securitySummary', 'security stats updated');
  }

  updateCallGraphStats(stats: Partial<CallGraphStats>): void {
    if (!this.manifest) {
      this.manifest = createEmptyManifest(this.config.rootDir);
    }
    this.manifest.stats.callGraph = {
      ...this.manifest.stats.callGraph,
      ...stats,
    };
    this.manifest.generatedAt = new Date().toISOString();
    this.dirty = true;
    this.markViewStale('status', 'call graph stats updated');
  }

  updateContractStats(stats: Partial<ContractStats>): void {
    if (!this.manifest) {
      this.manifest = createEmptyManifest(this.config.rootDir);
    }
    this.manifest.stats.contracts = {
      ...this.manifest.stats.contracts,
      ...stats,
    };
    this.manifest.generatedAt = new Date().toISOString();
    this.dirty = true;
    this.markViewStale('status', 'contract stats updated');
  }

  updateDNAStats(stats: Partial<DNAStats>): void {
    if (!this.manifest) {
      this.manifest = createEmptyManifest(this.config.rootDir);
    }
    this.manifest.stats.dna = {
      ...this.manifest.stats.dna,
      ...stats,
    };
    this.manifest.generatedAt = new Date().toISOString();
    this.dirty = true;
    this.markViewStale('status', 'DNA stats updated');
  }

  updateLastScan(info: Partial<LastScanInfo>): void {
    if (!this.manifest) {
      this.manifest = createEmptyManifest(this.config.rootDir);
    }
    this.manifest.lastScan = {
      ...this.manifest.lastScan,
      ...info,
    };
    this.manifest.generatedAt = new Date().toISOString();
    this.dirty = true;
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  async save(): Promise<void> {
    if (!this.manifest) {
      return;
    }

    await ensureDir(path.dirname(this.manifestPath));
    this.manifest.generatedAt = new Date().toISOString();
    await fs.writeFile(this.manifestPath, JSON.stringify(this.manifest, null, 2));
    this.dirty = false;
    this.emit('saved', this.manifest);
  }

  async saveIfDirty(): Promise<void> {
    if (this.dirty) {
      await this.save();
    }
  }

  isDirty(): boolean {
    return this.dirty;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createManifestStore(config: Partial<DataLakeConfig> = {}): ManifestStore {
  return new ManifestStore(config);
}
