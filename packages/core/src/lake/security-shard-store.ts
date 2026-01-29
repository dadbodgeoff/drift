/**
 * Security Shard Store
 *
 * Manages sharded security/access-map storage - one file per table.
 * This allows loading only the access data you need instead of the entire map.
 *
 * Storage structure:
 * .drift/lake/security/
 *   ├── index.json           # Security summary index
 *   ├── tables/
 *   │   ├── users.json       # Access points for users table
 *   │   ├── orders.json      # Access points for orders table
 *   │   └── ...
 *   └── sensitive.json       # Sensitive field registry
 *
 * Key features:
 * - Load access data by table (not all at once)
 * - Pre-computed security summary
 * - Incremental updates per table
 */

import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  LAKE_DIRS,
  DEFAULT_DATA_LAKE_CONFIG,
} from './types.js';

import type {
  AccessMapShard,
  AccessPointEntry,
  SecuritySummaryView,
  DataLakeConfig,
} from './types.js';


// ============================================================================
// Constants
// ============================================================================

const SECURITY_SHARD_DIR = 'security';
const TABLES_SUBDIR = 'tables';
const INDEX_FILE = 'index.json';
const SENSITIVE_FILE = 'sensitive.json';
const SHARD_VERSION = '1.0.0';

// ============================================================================
// Types
// ============================================================================

export interface SecurityIndex {
  version: string;
  generatedAt: string;
  summary: {
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    totalTables: number;
    sensitiveTablesCount: number;
    totalAccessPoints: number;
    violationCount: number;
  };
  tables: TableIndexEntry[];
  topSensitiveTables: SensitiveTableEntry[];
  topViolations: ViolationEntry[];
}

export interface TableIndexEntry {
  table: string;
  model?: string;
  fieldCount: number;
  sensitiveFieldCount: number;
  accessPointCount: number;
  hasViolations: boolean;
}

export interface SensitiveTableEntry {
  table: string;
  sensitiveFields: number;
  accessPoints: number;
  riskScore: number;
}

export interface ViolationEntry {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  file: string;
  table: string;
  line?: number;
}

export interface SensitiveFieldRegistry {
  version: string;
  generatedAt: string;
  fields: SensitiveFieldRecord[];
}

export interface SensitiveFieldRecord {
  table: string;
  field: string;
  sensitivity: 'pii' | 'financial' | 'auth' | 'health' | 'custom';
  reason: string;
  accessCount: number;
}

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

function generateChecksum(data: unknown): string {
  const content = JSON.stringify(data);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function sanitizeTableName(table: string): string {
  // Convert table name to safe filename
  return table.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

// ============================================================================
// Security Shard Store Class
// ============================================================================

export class SecurityShardStore extends EventEmitter {
  private readonly config: DataLakeConfig;
  private readonly securityDir: string;
  private readonly tablesDir: string;

  // In-memory cache
  private indexCache: SecurityIndex | null = null;
  private tableCache: Map<string, AccessMapShard> = new Map();
  private sensitiveCache: SensitiveFieldRegistry | null = null;

  constructor(config: Partial<DataLakeConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DATA_LAKE_CONFIG, ...config };
    this.securityDir = path.join(
      this.config.rootDir,
      LAKE_DIRS.root,
      LAKE_DIRS.lake,
      SECURITY_SHARD_DIR
    );
    this.tablesDir = path.join(this.securityDir, TABLES_SUBDIR);
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    await ensureDir(this.securityDir);
    await ensureDir(this.tablesDir);
  }

  // ==========================================================================
  // Index Operations
  // ==========================================================================

  /**
   * Get the security index (summary of all security data)
   */
  async getIndex(): Promise<SecurityIndex | null> {
    if (this.indexCache) {
      return this.indexCache;
    }

    const indexPath = path.join(this.securityDir, INDEX_FILE);
    if (!(await fileExists(indexPath))) {
      return null;
    }

    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      this.indexCache = JSON.parse(content);
      return this.indexCache;
    } catch {
      return null;
    }
  }

  /**
   * Save the security index
   */
  async saveIndex(index: SecurityIndex): Promise<void> {
    await ensureDir(this.securityDir);
    
    const indexPath = path.join(this.securityDir, INDEX_FILE);
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
    
    this.indexCache = index;
    this.emit('index:saved');
  }

  /**
   * Build security index from table shards
   */
  async buildIndex(): Promise<SecurityIndex> {
    const tables = await this.listTables();
    const tableEntries: TableIndexEntry[] = [];
    const sensitiveTables: SensitiveTableEntry[] = [];
    const violations: ViolationEntry[] = [];
    
    let totalAccessPoints = 0;
    let sensitiveTablesCount = 0;
    let violationCount = 0;

    for (const tableName of tables) {
      const shard = await this.getTableShard(tableName);
      if (!shard) {continue;}

      const sensitiveFieldCount = shard.sensitiveFields.length;
      const accessPointCount = shard.accessPoints.length;
      totalAccessPoints += accessPointCount;

      // Check for violations (simplified - real implementation would check rules)
      const tableViolations = this.detectViolations(shard);
      violations.push(...tableViolations);
      violationCount += tableViolations.length;

      // Build table entry, only including model if defined
      const tableEntry: TableIndexEntry = {
        table: shard.table,
        fieldCount: shard.fields.length,
        sensitiveFieldCount,
        accessPointCount,
        hasViolations: tableViolations.length > 0,
      };
      if (shard.model !== undefined) {
        tableEntry.model = shard.model;
      }
      tableEntries.push(tableEntry);

      if (sensitiveFieldCount > 0) {
        sensitiveTablesCount++;
        sensitiveTables.push({
          table: shard.table,
          sensitiveFields: sensitiveFieldCount,
          accessPoints: accessPointCount,
          riskScore: this.calculateRiskScore(shard),
        });
      }
    }

    // Sort sensitive tables by risk
    sensitiveTables.sort((a, b) => b.riskScore - a.riskScore);

    // Sort violations by severity
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    violations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    const index: SecurityIndex = {
      version: SHARD_VERSION,
      generatedAt: new Date().toISOString(),
      summary: {
        riskLevel: this.calculateOverallRisk(sensitiveTables, violationCount),
        totalTables: tables.length,
        sensitiveTablesCount,
        totalAccessPoints,
        violationCount,
      },
      tables: tableEntries,
      topSensitiveTables: sensitiveTables.slice(0, 10),
      topViolations: violations.slice(0, 10),
    };

    await this.saveIndex(index);
    return index;
  }

  // ==========================================================================
  // Table Shard Operations
  // ==========================================================================

  /**
   * Get access data for a specific table
   */
  async getTableShard(table: string): Promise<AccessMapShard | null> {
    // Check cache first
    const cached = this.tableCache.get(table);
    if (cached) {
      return cached;
    }

    const filePath = path.join(this.tablesDir, `${sanitizeTableName(table)}.json`);
    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      const shard: AccessMapShard = {
        table: data.table,
        model: data.model,
        fields: data.fields,
        sensitiveFields: data.sensitiveFields,
        accessPoints: data.accessPoints,
      };
      
      this.tableCache.set(table, shard);
      return shard;
    } catch {
      return null;
    }
  }

  /**
   * Save access data for a table
   */
  async saveTableShard(shard: AccessMapShard): Promise<void> {
    await ensureDir(this.tablesDir);
    
    const filePath = path.join(this.tablesDir, `${sanitizeTableName(shard.table)}.json`);
    const shardFile = {
      version: SHARD_VERSION,
      generatedAt: new Date().toISOString(),
      checksum: generateChecksum(shard),
      ...shard,
    };
    
    await fs.writeFile(filePath, JSON.stringify(shardFile, null, 2));
    this.tableCache.set(shard.table, shard);
    
    this.emit('table:saved', shard.table);
  }

  /**
   * Get access data for multiple tables
   */
  async getTableShards(tables: string[]): Promise<AccessMapShard[]> {
    const results: AccessMapShard[] = [];
    
    const shards = await Promise.all(
      tables.map(t => this.getTableShard(t))
    );
    
    for (const shard of shards) {
      if (shard) {
        results.push(shard);
      }
    }
    
    return results;
  }

  /**
   * List all available tables
   */
  async listTables(): Promise<string[]> {
    if (!(await fileExists(this.tablesDir))) {
      return [];
    }

    const files = await fs.readdir(this.tablesDir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  /**
   * Delete a table shard
   */
  async deleteTableShard(table: string): Promise<void> {
    const filePath = path.join(this.tablesDir, `${sanitizeTableName(table)}.json`);
    
    try {
      await fs.unlink(filePath);
      this.tableCache.delete(table);
      this.emit('table:deleted', table);
    } catch {
      // Ignore if doesn't exist
    }
  }

  // ==========================================================================
  // Sensitive Fields Operations
  // ==========================================================================

  /**
   * Get the sensitive field registry
   */
  async getSensitiveFields(): Promise<SensitiveFieldRegistry | null> {
    if (this.sensitiveCache) {
      return this.sensitiveCache;
    }

    const filePath = path.join(this.securityDir, SENSITIVE_FILE);
    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.sensitiveCache = JSON.parse(content);
      return this.sensitiveCache;
    } catch {
      return null;
    }
  }

  /**
   * Save the sensitive field registry
   */
  async saveSensitiveFields(registry: SensitiveFieldRegistry): Promise<void> {
    await ensureDir(this.securityDir);
    
    const filePath = path.join(this.securityDir, SENSITIVE_FILE);
    await fs.writeFile(filePath, JSON.stringify(registry, null, 2));
    
    this.sensitiveCache = registry;
    this.emit('sensitive:saved');
  }

  /**
   * Build sensitive field registry from table shards
   */
  async buildSensitiveRegistry(): Promise<SensitiveFieldRegistry> {
    const tables = await this.listTables();
    const fields: SensitiveFieldRecord[] = [];

    for (const tableName of tables) {
      const shard = await this.getTableShard(tableName);
      if (!shard) {continue;}

      for (const sf of shard.sensitiveFields) {
        // Count access points that touch this field
        const accessCount = shard.accessPoints.filter(
          ap => ap.fields.includes(sf.field)
        ).length;

        fields.push({
          table: shard.table,
          field: sf.field,
          sensitivity: sf.sensitivity,
          reason: sf.reason,
          accessCount,
        });
      }
    }

    // Sort by access count (most accessed first)
    fields.sort((a, b) => b.accessCount - a.accessCount);

    const registry: SensitiveFieldRegistry = {
      version: SHARD_VERSION,
      generatedAt: new Date().toISOString(),
      fields,
    };

    await this.saveSensitiveFields(registry);
    return registry;
  }

  // ==========================================================================
  // Query Helpers
  // ==========================================================================

  /**
   * Get access points for a specific file
   */
  async getAccessPointsByFile(file: string): Promise<AccessPointEntry[]> {
    const tables = await this.listTables();
    const results: AccessPointEntry[] = [];

    for (const tableName of tables) {
      const shard = await this.getTableShard(tableName);
      if (!shard) {continue;}

      const fileAccessPoints = shard.accessPoints.filter(ap => ap.file === file);
      results.push(...fileAccessPoints);
    }

    return results;
  }

  /**
   * Get all access points for sensitive fields
   */
  async getSensitiveAccessPoints(): Promise<Array<AccessPointEntry & { table: string; sensitivity: string }>> {
    const tables = await this.listTables();
    const results: Array<AccessPointEntry & { table: string; sensitivity: string }> = [];

    for (const tableName of tables) {
      const shard = await this.getTableShard(tableName);
      if (!shard || shard.sensitiveFields.length === 0) {continue;}

      const sensitiveFieldNames = new Set(shard.sensitiveFields.map(sf => sf.field));
      const sensitivityMap = new Map(shard.sensitiveFields.map(sf => [sf.field, sf.sensitivity]));

      for (const ap of shard.accessPoints) {
        const sensitiveFieldsAccessed = ap.fields.filter(f => sensitiveFieldNames.has(f));
        if (sensitiveFieldsAccessed.length > 0) {
          const firstField = sensitiveFieldsAccessed[0];
          const sensitivity = firstField !== undefined ? sensitivityMap.get(firstField) : undefined;
          results.push({
            ...ap,
            table: shard.table,
            sensitivity: sensitivity ?? 'custom',
          });
        }
      }
    }

    return results;
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Invalidate all caches
   */
  invalidateCache(table?: string): void {
    if (table) {
      this.tableCache.delete(table);
    } else {
      this.indexCache = null;
      this.tableCache.clear();
      this.sensitiveCache = null;
    }
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { cachedTables: number; hasIndex: boolean; hasSensitive: boolean } {
    return {
      cachedTables: this.tableCache.size,
      hasIndex: this.indexCache !== null,
      hasSensitive: this.sensitiveCache !== null,
    };
  }

  // ==========================================================================
  // Conversion Helpers
  // ==========================================================================

  /**
   * Convert security index to SecuritySummaryView
   */
  indexToSummaryView(index: SecurityIndex): SecuritySummaryView {
    return {
      generatedAt: index.generatedAt,
      riskLevel: index.summary.riskLevel,
      summary: {
        totalTables: index.summary.totalTables,
        sensitiveTablesCount: index.summary.sensitiveTablesCount,
        totalAccessPoints: index.summary.totalAccessPoints,
        violationCount: index.summary.violationCount,
      },
      topSensitiveTables: index.topSensitiveTables.map(t => ({
        table: t.table,
        sensitiveFields: t.sensitiveFields,
        accessPoints: t.accessPoints,
        riskScore: t.riskScore,
      })),
      topViolations: index.topViolations.map(v => ({
        id: v.id,
        severity: v.severity,
        message: v.message,
        file: v.file,
        table: v.table,
      })),
      recentChanges: [], // Would need history tracking
    };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private detectViolations(shard: AccessMapShard): ViolationEntry[] {
    const violations: ViolationEntry[] = [];
    
    // Simple violation detection - real implementation would use boundary rules
    for (const ap of shard.accessPoints) {
      const sensitiveFieldNames = new Set(shard.sensitiveFields.map(sf => sf.field));
      const sensitiveAccessed = ap.fields.filter(f => sensitiveFieldNames.has(f));
      
      // Flag low-confidence access to sensitive fields
      if (sensitiveAccessed.length > 0 && ap.confidence < 0.7) {
        violations.push({
          id: `${shard.table}-${ap.id}-low-confidence`,
          severity: 'warning',
          message: `Low confidence access to sensitive field(s): ${sensitiveAccessed.join(', ')}`,
          file: ap.file,
          table: shard.table,
          line: ap.line,
        });
      }
    }
    
    return violations;
  }

  private calculateRiskScore(shard: AccessMapShard): number {
    // Risk score based on:
    // - Number of sensitive fields
    // - Number of access points
    // - Types of sensitivity
    
    const sensitiveWeight: Record<string, number> = {
      pii: 3,
      financial: 4,
      auth: 5,
      health: 4,
      custom: 2,
    };
    
    let score = 0;
    for (const sf of shard.sensitiveFields) {
      score += sensitiveWeight[sf.sensitivity] ?? 2;
    }
    
    // Factor in access point count
    score *= Math.log10(shard.accessPoints.length + 1) + 1;
    
    return Math.round(score * 10) / 10;
  }

  private calculateOverallRisk(
    sensitiveTables: SensitiveTableEntry[],
    violationCount: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (violationCount > 10 || sensitiveTables.some(t => t.riskScore > 50)) {
      return 'critical';
    }
    if (violationCount > 5 || sensitiveTables.some(t => t.riskScore > 30)) {
      return 'high';
    }
    if (violationCount > 0 || sensitiveTables.some(t => t.riskScore > 15)) {
      return 'medium';
    }
    return 'low';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createSecurityShardStore(config: Partial<DataLakeConfig> = {}): SecurityShardStore {
  return new SecurityShardStore(config);
}
