/**
 * Store Factory
 *
 * Factory functions for creating stores with automatic backend selection.
 * This module provides the integration point between legacy JSON storage and
 * the new SQLite storage.
 *
 * Phase 4: SQLite is now the default and only actively maintained storage.
 * JSON stores are deprecated and will be removed in a future version.
 *
 * Usage:
 * ```typescript
 * // Auto-detect: uses SQLite if drift.db exists, otherwise JSON (for backward compat)
 * const store = await createPatternStore({ rootDir: '/path/to/project' });
 *
 * // Force SQLite (recommended)
 * const store = await createPatternStore({ rootDir: '/path/to/project', backend: 'sqlite' });
 *
 * // Force JSON (deprecated - for migration only)
 * const store = await createPatternStore({ rootDir: '/path/to/project', backend: 'json' });
 * ```
 *
 * @module storage/store-factory
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { PatternStore } from '../store/pattern-store.js';
import { ContractStore } from '../store/contract-store.js';
import { HybridPatternStore } from './hybrid-pattern-store.js';
import { HybridContractStore } from './hybrid-contract-store.js';
import type { PatternStoreConfig } from '../store/types.js';
import type { ContractStoreConfig } from '../store/contract-store.js';

// ============================================================================
// Types
// ============================================================================

export type StorageBackend = 'auto' | 'sqlite' | 'json';

export interface CreatePatternStoreOptions extends Partial<PatternStoreConfig> {
  /** Storage backend to use */
  backend?: StorageBackend;
}

export interface PatternStoreInterface {
  initialize(): Promise<void>;
  close?(): Promise<void>;
  get(id: string): import('../store/types.js').Pattern | undefined;
  getOrThrow(id: string): import('../store/types.js').Pattern;
  has(id: string): boolean;
  add(pattern: import('../store/types.js').Pattern): void | Promise<void>;
  update(id: string, updates: Partial<Omit<import('../store/types.js').Pattern, 'id'>>): import('../store/types.js').Pattern | Promise<import('../store/types.js').Pattern>;
  delete(id: string): boolean | Promise<boolean>;
  approve(id: string, approvedBy?: string): import('../store/types.js').Pattern | Promise<import('../store/types.js').Pattern>;
  ignore(id: string): import('../store/types.js').Pattern | Promise<import('../store/types.js').Pattern>;
  query(options?: import('../store/types.js').PatternQueryOptions): import('../store/types.js').PatternQueryResult;
  getAll(): import('../store/types.js').Pattern[];
  getByCategory(category: import('../store/types.js').PatternCategory): import('../store/types.js').Pattern[];
  getByStatus(status: import('../store/types.js').PatternStatus): import('../store/types.js').Pattern[];
  getApproved(): import('../store/types.js').Pattern[];
  getDiscovered(): import('../store/types.js').Pattern[];
  getIgnored(): import('../store/types.js').Pattern[];
  getByFile(file: string): import('../store/types.js').Pattern[];
  getStats(): import('../store/types.js').PatternStoreStats;
  saveAll(): Promise<void>;
  loadAll(): Promise<void>;
}

// ============================================================================
// Detection
// ============================================================================

/**
 * Check if SQLite database exists for a project
 */
export function hasSqliteDatabase(rootDir: string): boolean {
  const dbPath = path.join(rootDir, '.drift', 'drift.db');
  return fs.existsSync(dbPath);
}

/**
 * Check if legacy JSON patterns exist
 */
export function hasJsonPatterns(rootDir: string): boolean {
  const patternsDir = path.join(rootDir, '.drift', 'patterns');
  if (!fs.existsSync(patternsDir)) return false;

  // Check for any JSON files in patterns directory or subdirectories
  const entries = fs.readdirSync(patternsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json')) return true;
    if (entry.isDirectory()) {
      const subDir = path.join(patternsDir, entry.name);
      const subEntries = fs.readdirSync(subDir);
      if (subEntries.some(f => f.endsWith('.json'))) return true;
    }
  }
  return false;
}

/**
 * Detect the best storage backend for a project
 * 
 * Phase 3: SQLite is now the default storage backend.
 * - If SQLite database exists, use it
 * - If only JSON exists, use JSON (for backward compatibility)
 * - If neither exists, default to SQLite (new projects)
 */
export function detectStorageBackend(rootDir: string): 'sqlite' | 'json' {
  const hasSqlite = hasSqliteDatabase(rootDir);
  const hasJson = hasJsonPatterns(rootDir);
  
  // Phase 3: SQLite is default
  // 1. If SQLite exists, use it
  if (hasSqlite) {
    return 'sqlite';
  }
  
  // 2. If only JSON exists, use JSON for backward compatibility
  if (hasJson) {
    return 'json';
  }
  
  // 3. New projects default to SQLite
  return 'sqlite';
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a pattern store with automatic backend selection
 *
 * @param options - Store configuration options
 * @returns An initialized pattern store
 */
export async function createPatternStore(
  options: CreatePatternStoreOptions = {}
): Promise<PatternStoreInterface> {
  const rootDir = options.rootDir ?? '.';
  const backend = options.backend ?? 'auto';

  // Determine which backend to use
  let useBackend: 'sqlite' | 'json';
  if (backend === 'auto') {
    useBackend = detectStorageBackend(rootDir);
  } else {
    useBackend = backend;
  }

  // Create the appropriate store
  if (useBackend === 'sqlite') {
    const store = new HybridPatternStore({
      rootDir,
      sqliteOnly: true,
    });
    await store.initialize();
    return store;
  } else {
    const store = new PatternStore({
      rootDir,
      autoSave: options.autoSave ?? true,
      autoSaveDebounce: options.autoSaveDebounce ?? 1000,
      createBackup: options.createBackup ?? true,
      maxBackups: options.maxBackups ?? 5,
      validateSchema: options.validateSchema ?? false,
    });
    await store.initialize();
    return store;
  }
}

/**
 * Get storage backend info for a project
 */
export function getStorageInfo(rootDir: string): {
  backend: 'sqlite' | 'json' | 'none';
  hasSqlite: boolean;
  hasJson: boolean;
  recommended: 'sqlite' | 'json';
} {
  const hasSqlite = hasSqliteDatabase(rootDir);
  const hasJson = hasJsonPatterns(rootDir);

  let backend: 'sqlite' | 'json' | 'none';
  if (hasSqlite) {
    backend = 'sqlite';
  } else if (hasJson) {
    backend = 'json';
  } else {
    backend = 'none';
  }

  return {
    backend,
    hasSqlite,
    hasJson,
    recommended: hasSqlite ? 'sqlite' : 'json',
  };
}

// ============================================================================
// Contract Store Types
// ============================================================================

export interface CreateContractStoreOptions extends Partial<ContractStoreConfig> {
  /** Storage backend to use */
  backend?: StorageBackend;
}

export interface ContractStoreInterface {
  initialize(): Promise<void>;
  close?(): Promise<void>;
  get(id: string): import('../types/contracts.js').Contract | undefined;
  getOrThrow(id: string): import('../types/contracts.js').Contract;
  has(id: string): boolean;
  add(contract: import('../types/contracts.js').Contract): void | Promise<void>;
  update(id: string, updates: Partial<Omit<import('../types/contracts.js').Contract, 'id'>>): import('../types/contracts.js').Contract | Promise<import('../types/contracts.js').Contract>;
  delete(id: string): boolean | Promise<boolean>;
  verify(id: string, verifiedBy?: string): import('../types/contracts.js').Contract | Promise<import('../types/contracts.js').Contract>;
  markMismatch(id: string): import('../types/contracts.js').Contract | Promise<import('../types/contracts.js').Contract>;
  ignore(id: string): import('../types/contracts.js').Contract | Promise<import('../types/contracts.js').Contract>;
  query(options?: import('../types/contracts.js').ContractQueryOptions): import('../types/contracts.js').ContractQueryResult;
  getAll(): import('../types/contracts.js').Contract[];
  getByStatus(status: import('../types/contracts.js').ContractStatus): import('../types/contracts.js').Contract[];
  getByMethod(method: import('../types/contracts.js').HttpMethod): import('../types/contracts.js').Contract[];
  getWithMismatches(): import('../types/contracts.js').Contract[];
  getVerified(): import('../types/contracts.js').Contract[];
  getDiscovered(): import('../types/contracts.js').Contract[];
  getMismatched(): import('../types/contracts.js').Contract[];
  getStats(): import('../types/contracts.js').ContractStats;
  saveAll(): Promise<void>;
  loadAll(): Promise<void>;
}

// ============================================================================
// Contract Store Factory
// ============================================================================

/**
 * Create a contract store with automatic backend selection
 *
 * @param options - Store configuration options
 * @returns An initialized contract store
 */
export async function createContractStore(
  options: CreateContractStoreOptions = {}
): Promise<ContractStoreInterface> {
  const rootDir = options.rootDir ?? '.';
  const backend = options.backend ?? 'auto';

  // Determine which backend to use
  let useBackend: 'sqlite' | 'json';
  if (backend === 'auto') {
    useBackend = detectStorageBackend(rootDir);
  } else {
    useBackend = backend;
  }

  // Create the appropriate store
  if (useBackend === 'sqlite') {
    const store = new HybridContractStore({ rootDir });
    await store.initialize();
    return store;
  } else {
    // Legacy JSON store (deprecated)
    const store = new ContractStore({
      rootDir,
      autoSave: options.autoSave ?? true,
      autoSaveDebounce: options.autoSaveDebounce ?? 1000,
      createBackup: options.createBackup ?? true,
      maxBackups: options.maxBackups ?? 5,
    });
    await store.initialize();
    return store;
  }
}
