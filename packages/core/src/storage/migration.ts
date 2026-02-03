/**
 * Migration Utilities
 *
 * Provides utilities for migrating from JSON file storage to SQLite.
 *
 * @module storage/migration
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { UnifiedStore } from './unified-store.js';
import type { UnifiedStoreConfig, DbPattern } from './types.js';
import type { PatternFile, PatternCategory, PatternStatus } from '../store/types.js';

// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';
const PATTERNS_DIR = 'patterns';
const CONTRACTS_DIR = 'contracts';
const CONSTRAINTS_DIR = 'constraints';
const BOUNDARIES_DIR = 'boundaries';
const ENVIRONMENT_DIR = 'environment';

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create and initialize a unified store
 */
export async function createUnifiedStore(
  config: Partial<UnifiedStoreConfig> = {}
): Promise<UnifiedStore> {
  const store = new UnifiedStore(config);
  await store.initialize();
  return store;
}

// ============================================================================
// Migration
// ============================================================================

export interface MigrationOptions {
  /** Root directory of the project */
  rootDir: string;
  /** Whether to keep JSON files after migration */
  keepJsonFiles?: boolean;
  /** Whether to run in dry-run mode (no changes) */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (message: string, current: number, total: number) => void;
}

export interface MigrationResult {
  success: boolean;
  patternsImported: number;
  contractsImported: number;
  constraintsImported: number;
  boundariesImported: number;
  envVariablesImported: number;
  errors: string[];
  warnings: string[];
}

/**
 * Migrate from JSON file storage to SQLite
 */
export async function migrateFromJson(options: MigrationOptions): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    patternsImported: 0,
    contractsImported: 0,
    constraintsImported: 0,
    boundariesImported: 0,
    envVariablesImported: 0,
    errors: [],
    warnings: [],
  };

  const { rootDir, keepJsonFiles = true, dryRun = false, onProgress } = options;
  const driftDir = path.join(rootDir, DRIFT_DIR);

  if (!fs.existsSync(driftDir)) {
    result.errors.push(`Drift directory not found: ${driftDir}`);
    result.success = false;
    return result;
  }

  // Create store
  const store = new UnifiedStore({ rootDir });
  
  if (!dryRun) {
    await store.initialize();
  }

  try {
    // Migrate patterns
    onProgress?.('Migrating patterns...', 0, 5);
    const patternCount = await migratePatterns(driftDir, store, dryRun, result);
    result.patternsImported = patternCount;

    // Migrate contracts
    onProgress?.('Migrating contracts...', 1, 5);
    const contractCount = await migrateContracts(driftDir, store, dryRun, result);
    result.contractsImported = contractCount;

    // Migrate constraints
    onProgress?.('Migrating constraints...', 2, 5);
    const constraintCount = await migrateConstraints(driftDir, store, dryRun, result);
    result.constraintsImported = constraintCount;

    // Migrate boundaries
    onProgress?.('Migrating boundaries...', 3, 5);
    const boundaryCount = await migrateBoundaries(driftDir, store, dryRun, result);
    result.boundariesImported = boundaryCount;

    // Migrate environment
    onProgress?.('Migrating environment variables...', 4, 5);
    const envCount = await migrateEnvironment(driftDir, store, dryRun, result);
    result.envVariablesImported = envCount;

    onProgress?.('Migration complete', 5, 5);

    // Optionally remove JSON files
    if (!keepJsonFiles && !dryRun) {
      await cleanupJsonFiles(driftDir, result);
    }
  } catch (error) {
    result.errors.push(`Migration failed: ${(error as Error).message}`);
    result.success = false;
  } finally {
    if (!dryRun) {
      await store.close();
    }
  }

  return result;
}

// ============================================================================
// Pattern Migration
// ============================================================================

async function migratePatterns(
  driftDir: string,
  store: UnifiedStore,
  dryRun: boolean,
  result: MigrationResult
): Promise<number> {
  const patternsDir = path.join(driftDir, PATTERNS_DIR);
  if (!fs.existsSync(patternsDir)) {
    result.warnings.push('Patterns directory not found');
    return 0;
  }

  let count = 0;
  
  // Check for unified format (v2.0.0) - category files directly in patterns/
  const categoryFiles = fs.readdirSync(patternsDir).filter((f) => f.endsWith('.json'));
  const hasUnifiedFormat = categoryFiles.some((f) => {
    try {
      const content = fs.readFileSync(path.join(patternsDir, f), 'utf-8');
      const data = JSON.parse(content);
      return data.version?.startsWith('2.');
    } catch {
      return false;
    }
  });

  if (hasUnifiedFormat) {
    // Migrate from unified format (v2.0.0)
    for (const file of categoryFiles) {
      try {
        const filePath = path.join(patternsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const patternFile = JSON.parse(content);
        
        if (!patternFile.version?.startsWith('2.')) continue;
        
        const category = patternFile.category || file.replace('.json', '') as PatternCategory;

        for (const stored of patternFile.patterns || []) {
          const status = stored.status || 'discovered';
          const dbPattern = convertPatternToDb(stored, category, status);
          
          if (!dryRun) {
            await store.patterns.create(dbPattern);

            // Add locations
            for (const loc of stored.locations || []) {
              await store.patterns.addLocation(dbPattern.id, {
                pattern_id: dbPattern.id,
                file: loc.file,
                line: loc.line,
                column_num: loc.column ?? 0,
                end_line: loc.endLine ?? null,
                end_column: loc.endColumn ?? null,
                is_outlier: loc.isOutlier ? 1 : 0,
                outlier_reason: loc.outlierReason ?? null,
                deviation_score: loc.deviationScore ?? null,
                confidence: loc.confidence ?? 1.0,
                snippet: loc.snippet ?? null,
              });
            }

            // Add outliers (if separate from locations)
            for (const outlier of stored.outliers || []) {
              await store.patterns.addLocation(dbPattern.id, {
                pattern_id: dbPattern.id,
                file: outlier.file,
                line: outlier.line,
                column_num: outlier.column ?? 0,
                end_line: outlier.endLine ?? null,
                end_column: outlier.endColumn ?? null,
                is_outlier: 1,
                outlier_reason: outlier.reason,
                deviation_score: outlier.deviationScore ?? null,
                confidence: 1.0,
                snippet: null,
              });
            }
          }

          count++;
        }
      } catch (error) {
        result.errors.push(`Failed to migrate pattern file ${file}: ${(error as Error).message}`);
      }
    }
  } else {
    // Migrate from legacy format (status subdirectories)
    const statuses: PatternStatus[] = ['discovered', 'approved', 'ignored'];

    for (const status of statuses) {
      const statusDir = path.join(patternsDir, status);
      if (!fs.existsSync(statusDir)) continue;

      const files = fs.readdirSync(statusDir).filter((f) => f.endsWith('.json'));

      for (const file of files) {
        try {
          const filePath = path.join(statusDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const patternFile = JSON.parse(content) as PatternFile;
          const category = file.replace('.json', '') as PatternCategory;

          for (const stored of patternFile.patterns) {
            const dbPattern = convertPatternToDb(stored, category, status);
            
            if (!dryRun) {
              await store.patterns.create(dbPattern);

              for (const loc of stored.locations) {
                await store.patterns.addLocation(dbPattern.id, {
                  pattern_id: dbPattern.id,
                  file: loc.file,
                  line: loc.line,
                  column_num: loc.column ?? 0,
                  end_line: loc.endLine ?? null,
                  end_column: loc.endColumn ?? null,
                  is_outlier: 0,
                  outlier_reason: null,
                  deviation_score: null,
                  confidence: 1.0,
                  snippet: null,
                });
              }

              // Add outliers
              for (const outlier of stored.outliers) {
                await store.patterns.addLocation(dbPattern.id, {
                  pattern_id: dbPattern.id,
                  file: outlier.file,
                  line: outlier.line,
                  column_num: outlier.column ?? 0,
                  end_line: outlier.endLine ?? null,
                  end_column: outlier.endColumn ?? null,
                  is_outlier: 1,
                  outlier_reason: outlier.reason,
                  deviation_score: outlier.deviationScore ?? null,
                  confidence: 1.0,
                  snippet: null,
                });
              }
            }

            count++;
          }
        } catch (error) {
          result.errors.push(`Failed to migrate pattern file ${file}: ${(error as Error).message}`);
        }
      }
    }
  }

  return count;
}

function convertPatternToDb(
  stored: any,
  category: PatternCategory,
  status: PatternStatus
): DbPattern {
  return {
    id: stored.id,
    name: stored.name,
    description: stored.description ?? null,
    category,
    subcategory: stored.subcategory ?? null,
    status,
    confidence_score: stored.confidence?.score ?? 0,
    confidence_level: stored.confidence?.level ?? 'uncertain',
    confidence_frequency: stored.confidence?.frequency ?? null,
    confidence_consistency: stored.confidence?.consistency ?? null,
    confidence_age: stored.confidence?.age ?? null,
    confidence_spread: stored.confidence?.spread ?? null,
    detector_type: stored.detectionMethod ?? stored.detector?.type ?? null,
    detector_config: stored.detector?.config ? JSON.stringify(stored.detector.config) : null,
    severity: stored.severity ?? 'info',
    auto_fixable: stored.autoFixable ? 1 : 0,
    first_seen: stored.metadata?.firstSeen ?? new Date().toISOString(),
    last_seen: stored.metadata?.lastSeen ?? new Date().toISOString(),
    approved_at: stored.metadata?.approvedAt ?? null,
    approved_by: stored.metadata?.approvedBy ?? null,
    tags: stored.metadata?.tags ? JSON.stringify(stored.metadata.tags) : null,
    source: stored.metadata?.source ?? null,
    location_count: stored.locations?.length ?? 0,
    outlier_count: stored.outliers?.length ?? 0,
  };
}

// ============================================================================
// Contract Migration
// ============================================================================

async function migrateContracts(
  driftDir: string,
  store: UnifiedStore,
  dryRun: boolean,
  result: MigrationResult
): Promise<number> {
  const contractsDir = path.join(driftDir, CONTRACTS_DIR);
  if (!fs.existsSync(contractsDir)) {
    result.warnings.push('Contracts directory not found');
    return 0;
  }

  let count = 0;
  const statuses = ['discovered', 'verified', 'mismatch', 'ignored'];

  for (const status of statuses) {
    const statusDir = path.join(contractsDir, status);
    if (!fs.existsSync(statusDir)) continue;

    const files = fs.readdirSync(statusDir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      try {
        const filePath = path.join(statusDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const contract = JSON.parse(content);

        if (!dryRun) {
          await store.contracts.create({
            id: contract.id,
            method: contract.method,
            endpoint: contract.endpoint,
            normalized_endpoint: contract.normalizedEndpoint ?? contract.endpoint,
            status: status as any,
            backend_method: contract.backend?.method ?? null,
            backend_path: contract.backend?.path ?? null,
            backend_normalized_path: contract.backend?.normalizedPath ?? null,
            backend_file: contract.backend?.file ?? null,
            backend_line: contract.backend?.line ?? null,
            backend_framework: contract.backend?.framework ?? null,
            backend_response_fields: contract.backend?.responseFields ? JSON.stringify(contract.backend.responseFields) : null,
            confidence_score: contract.confidence?.score ?? 0,
            confidence_level: contract.confidence?.level ?? 'low',
            match_confidence: contract.confidence?.matchConfidence ?? null,
            field_extraction_confidence: contract.confidence?.fieldExtractionConfidence ?? null,
            mismatches: contract.mismatches ? JSON.stringify(contract.mismatches) : null,
            first_seen: contract.firstSeen ?? new Date().toISOString(),
            last_seen: contract.lastSeen ?? new Date().toISOString(),
            verified_at: contract.verifiedAt ?? null,
            verified_by: contract.verifiedBy ?? null,
          });
        }

        count++;
      } catch (error) {
        result.errors.push(`Failed to migrate contract file ${file}: ${(error as Error).message}`);
      }
    }
  }

  return count;
}

// ============================================================================
// Constraint Migration
// ============================================================================

async function migrateConstraints(
  driftDir: string,
  store: UnifiedStore,
  dryRun: boolean,
  result: MigrationResult
): Promise<number> {
  const constraintsDir = path.join(driftDir, CONSTRAINTS_DIR);
  if (!fs.existsSync(constraintsDir)) {
    result.warnings.push('Constraints directory not found');
    return 0;
  }

  let count = 0;
  const statuses = ['discovered', 'approved', 'ignored', 'custom'];

  for (const status of statuses) {
    const statusDir = path.join(constraintsDir, status);
    if (!fs.existsSync(statusDir)) continue;

    const files = fs.readdirSync(statusDir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      try {
        const filePath = path.join(statusDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const constraint = JSON.parse(content);

        if (!dryRun) {
          await store.constraints.create({
            id: constraint.id,
            name: constraint.name,
            description: constraint.description ?? null,
            category: constraint.category,
            status: status as any,
            language: constraint.language ?? 'all',
            invariant: JSON.stringify(constraint.invariant),
            scope: constraint.scope ? JSON.stringify(constraint.scope) : null,
            enforcement_level: constraint.enforcement?.level ?? 'warning',
            enforcement_message: constraint.enforcement?.message ?? null,
            enforcement_autofix: constraint.enforcement?.autofix ?? null,
            confidence_score: constraint.confidence?.score ?? 0,
            confidence_evidence: constraint.confidence?.evidence ?? 0,
            confidence_violations: constraint.confidence?.violations ?? 0,
            created_at: constraint.createdAt ?? new Date().toISOString(),
            updated_at: constraint.updatedAt ?? new Date().toISOString(),
            approved_at: constraint.approvedAt ?? null,
            approved_by: constraint.approvedBy ?? null,
            ignored_at: constraint.ignoredAt ?? null,
            ignore_reason: constraint.ignoreReason ?? null,
            tags: constraint.tags ? JSON.stringify(constraint.tags) : null,
            notes: constraint.notes ?? null,
          });
        }

        count++;
      } catch (error) {
        result.errors.push(`Failed to migrate constraint file ${file}: ${(error as Error).message}`);
      }
    }
  }

  return count;
}

// ============================================================================
// Boundary Migration
// ============================================================================

async function migrateBoundaries(
  driftDir: string,
  store: UnifiedStore,
  dryRun: boolean,
  result: MigrationResult
): Promise<number> {
  const boundariesDir = path.join(driftDir, BOUNDARIES_DIR);
  if (!fs.existsSync(boundariesDir)) {
    result.warnings.push('Boundaries directory not found');
    return 0;
  }

  let count = 0;

  // Migrate access-map.json
  const accessMapPath = path.join(boundariesDir, 'access-map.json');
  if (fs.existsSync(accessMapPath)) {
    try {
      const content = fs.readFileSync(accessMapPath, 'utf-8');
      const accessMap = JSON.parse(content);

      if (!dryRun && accessMap.tables) {
        for (const [tableName, tableData] of Object.entries(accessMap.tables as Record<string, any>)) {
          // Add model
          if (tableData.model) {
            await store.boundaries.addModel({
              name: tableData.model.name ?? tableName,
              table_name: tableName,
              file: tableData.model.file ?? '',
              line: tableData.model.line ?? 0,
              framework: tableData.model.framework ?? null,
              confidence: tableData.model.confidence ?? 1.0,
              fields: tableData.fields ? JSON.stringify(tableData.fields) : null,
            });
          }

          // Add sensitive fields
          if (tableData.sensitiveFields) {
            for (const sf of tableData.sensitiveFields) {
              await store.boundaries.addSensitiveField({
                table_name: tableName,
                field_name: sf.field,
                sensitivity: sf.sensitivity,
                reason: sf.reason ?? null,
              });
            }
          }

          // Add access points
          if (tableData.accessPoints) {
            for (const ap of tableData.accessPoints) {
              await store.boundaries.addAccessPoint({
                id: ap.id ?? `${tableName}-${ap.file}-${ap.line}`,
                table_name: tableName,
                operation: ap.operation,
                file: ap.file,
                line: ap.line,
                column_num: ap.column ?? 0,
                context: ap.context ?? null,
                fields: ap.fields ? JSON.stringify(ap.fields) : null,
                is_raw_sql: ap.isRawSql ? 1 : 0,
                confidence: ap.confidence ?? 1.0,
                function_id: ap.functionId ?? null,
              });
            }
          }

          count++;
        }
      }
    } catch (error) {
      result.errors.push(`Failed to migrate access-map.json: ${(error as Error).message}`);
    }
  }

  return count;
}

// ============================================================================
// Environment Migration
// ============================================================================

async function migrateEnvironment(
  driftDir: string,
  store: UnifiedStore,
  dryRun: boolean,
  result: MigrationResult
): Promise<number> {
  const envDir = path.join(driftDir, ENVIRONMENT_DIR);
  if (!fs.existsSync(envDir)) {
    result.warnings.push('Environment directory not found');
    return 0;
  }

  let count = 0;

  // Migrate variables.json
  const variablesPath = path.join(envDir, 'variables.json');
  if (fs.existsSync(variablesPath)) {
    try {
      const content = fs.readFileSync(variablesPath, 'utf-8');
      const data = JSON.parse(content);

      if (!dryRun && data.variables) {
        for (const [name, varData] of Object.entries(data.variables as Record<string, any>)) {
          await store.environment.addVariable({
            name,
            sensitivity: varData.sensitivity ?? 'unknown',
            has_default: varData.hasDefault ? 1 : 0,
            is_required: varData.isRequired ? 1 : 0,
            default_value: varData.defaultValue ?? null,
          });

          // Add access points
          if (varData.accessPoints) {
            for (const ap of varData.accessPoints) {
              await store.environment.addAccessPoint({
                id: ap.id ?? `${name}-${ap.file}-${ap.line}`,
                var_name: name,
                method: ap.method,
                file: ap.file,
                line: ap.line,
                column_num: ap.column ?? 0,
                context: ap.context ?? null,
                language: ap.language ?? null,
                confidence: ap.confidence ?? 1.0,
                has_default: ap.hasDefault ? 1 : 0,
                default_value: ap.defaultValue ?? null,
                is_required: ap.isRequired ? 1 : 0,
              });
            }
          }

          count++;
        }
      }
    } catch (error) {
      result.errors.push(`Failed to migrate variables.json: ${(error as Error).message}`);
    }
  }

  return count;
}

// ============================================================================
// Cleanup
// ============================================================================

async function cleanupJsonFiles(driftDir: string, result: MigrationResult): Promise<void> {
  // Note: This is a destructive operation - only called if keepJsonFiles is false
  const dirsToClean = [
    path.join(driftDir, PATTERNS_DIR),
    path.join(driftDir, CONTRACTS_DIR),
    path.join(driftDir, CONSTRAINTS_DIR),
    path.join(driftDir, BOUNDARIES_DIR),
    path.join(driftDir, ENVIRONMENT_DIR),
  ];

  for (const dir of dirsToClean) {
    if (fs.existsSync(dir)) {
      try {
        // Create backup before deletion
        const backupDir = path.join(driftDir, '.json-backup', path.basename(dir));
        fs.mkdirSync(backupDir, { recursive: true });
        
        // Copy files to backup
        const copyDir = (src: string, dest: string) => {
          const entries = fs.readdirSync(src, { withFileTypes: true });
          for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
              fs.mkdirSync(destPath, { recursive: true });
              copyDir(srcPath, destPath);
            } else {
              fs.copyFileSync(srcPath, destPath);
            }
          }
        };
        
        copyDir(dir, backupDir);
        result.warnings.push(`Backed up ${dir} to ${backupDir}`);
      } catch (error) {
        result.errors.push(`Failed to backup ${dir}: ${(error as Error).message}`);
      }
    }
  }
}
