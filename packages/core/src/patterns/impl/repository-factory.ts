/**
 * Pattern Repository Factory
 *
 * Creates the appropriate pattern repository based on the storage format
 * detected in the project. Handles automatic migration and format detection.
 *
 * @module patterns/impl/repository-factory
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { FilePatternRepository } from './file-repository.js';
import { UnifiedFilePatternRepository, type UnifiedRepositoryConfig } from './unified-file-repository.js';

import type { IPatternRepository, PatternRepositoryConfig } from '../repository.js';

// ============================================================================
// Types
// ============================================================================

export type StorageFormat = 'unified' | 'legacy' | 'none';

export interface RepositoryFactoryConfig extends Partial<UnifiedRepositoryConfig> {
  /** Prefer unified format even if legacy exists */
  preferUnified?: boolean;
  /** Auto-migrate legacy to unified on create */
  autoMigrate?: boolean;
}

const DEFAULT_FACTORY_CONFIG: Required<RepositoryFactoryConfig> = {
  rootDir: process.cwd(),
  autoSave: true,
  autoSaveDelayMs: 1000,
  validateSchema: true,
  preferUnified: true,
  autoMigrate: true,
  keepLegacyFiles: true,
};

// ============================================================================
// Format Detection
// ============================================================================

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the storage format used in a project
 */
export async function detectStorageFormat(rootDir: string): Promise<StorageFormat> {
  const patternsDir = path.join(rootDir, '.drift', 'patterns');

  // Check for unified format (category files with version 2.x)
  const categories = ['api', 'auth', 'security', 'errors', 'structural'];
  for (const category of categories) {
    const filePath = path.join(patternsDir, `${category}.json`);
    if (await fileExists(filePath)) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        if (data.version?.startsWith('2.')) {
          return 'unified';
        }
      } catch {
        // Not valid unified format
      }
    }
  }

  // Check for legacy format (status directories)
  const legacyDirs = ['discovered', 'approved', 'ignored'];
  for (const dir of legacyDirs) {
    const statusDir = path.join(patternsDir, dir);
    if (await fileExists(statusDir)) {
      return 'legacy';
    }
  }

  return 'none';
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a pattern repository with automatic format detection.
 *
 * - If unified format exists, uses UnifiedFilePatternRepository
 * - If legacy format exists and autoMigrate is true, migrates to unified
 * - If legacy format exists and autoMigrate is false, uses FilePatternRepository
 * - If no format exists, creates new UnifiedFilePatternRepository
 *
 * @example
 * ```typescript
 * const repository = await createPatternRepository({ rootDir: '/path/to/project' });
 * await repository.initialize();
 * ```
 */
export async function createPatternRepository(
  config: Partial<RepositoryFactoryConfig> = {}
): Promise<IPatternRepository> {
  const fullConfig = { ...DEFAULT_FACTORY_CONFIG, ...config };
  const format = await detectStorageFormat(fullConfig.rootDir);

  switch (format) {
    case 'unified':
      // Already using unified format
      return new UnifiedFilePatternRepository({
        rootDir: fullConfig.rootDir,
        autoSave: fullConfig.autoSave,
        autoSaveDelayMs: fullConfig.autoSaveDelayMs,
        autoMigrate: false, // Already unified
      });

    case 'legacy':
      if (fullConfig.autoMigrate && fullConfig.preferUnified) {
        // Migrate to unified format
        console.log('[RepositoryFactory] Migrating from legacy to unified format...');
        return new UnifiedFilePatternRepository({
          rootDir: fullConfig.rootDir,
          autoSave: fullConfig.autoSave,
          autoSaveDelayMs: fullConfig.autoSaveDelayMs,
          autoMigrate: true,
          keepLegacyFiles: fullConfig.keepLegacyFiles,
        });
      } else {
        // Use legacy format
        console.warn('[RepositoryFactory] Using legacy storage format. Run `drift migrate-storage` to upgrade.');
        return new FilePatternRepository({
          rootDir: fullConfig.rootDir,
          autoSave: fullConfig.autoSave,
          autoSaveDelayMs: fullConfig.autoSaveDelayMs,
        });
      }

    case 'none':
    default:
      // No existing format, create new unified
      return new UnifiedFilePatternRepository({
        rootDir: fullConfig.rootDir,
        autoSave: fullConfig.autoSave,
        autoSaveDelayMs: fullConfig.autoSaveDelayMs,
        autoMigrate: false,
      });
  }
}

/**
 * Create a pattern repository synchronously (uses unified format by default).
 *
 * This is useful when you can't use async/await but need a repository.
 * Note: This always creates UnifiedFilePatternRepository with autoMigrate enabled.
 */
export function createPatternRepositorySync(
  config: Partial<PatternRepositoryConfig> = {}
): IPatternRepository {
  return new UnifiedFilePatternRepository({
    ...config,
    autoMigrate: true,
    keepLegacyFiles: true,
  });
}
