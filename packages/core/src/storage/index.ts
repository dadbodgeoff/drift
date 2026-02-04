/**
 * Unified Storage Module
 *
 * This module provides a unified SQLite-based storage layer for all Drift metadata.
 * It replaces the scattered JSON file storage with a professional, cloud-ready architecture.
 *
 * Phase 4: SQLite is now the default and only actively maintained storage backend.
 * JSON stores are deprecated and will be removed in a future version.
 *
 * @module storage
 */

// Types
export * from './types.js';

// Migration types
export type { MigrationOptions, MigrationResult } from './migration.js';

// Main store
export { UnifiedStore } from './unified-store.js';

// Hybrid stores (SQLite-backed, replacing legacy JSON stores)
export { HybridPatternStore } from './hybrid-pattern-store.js';
export type { HybridPatternStoreConfig } from './hybrid-pattern-store.js';
export { HybridContractStore } from './hybrid-contract-store.js';
export type { HybridContractStoreConfig } from './hybrid-contract-store.js';

// Repositories
export { PatternRepository } from './repositories/pattern-repository.js';
export { ContractRepository } from './repositories/contract-repository.js';
export { ConstraintRepository } from './repositories/constraint-repository.js';
export { BoundaryRepository } from './repositories/boundary-repository.js';
export { EnvironmentRepository } from './repositories/environment-repository.js';
export { CallGraphRepository } from './repositories/callgraph-repository.js';
export { AuditRepository } from './repositories/audit-repository.js';
export { DNARepository } from './repositories/dna-repository.js';
export { TestTopologyRepository } from './repositories/test-topology-repository.js';

// Utilities
export { createUnifiedStore, migrateFromJson } from './migration.js';

// Sync Service
export { StoreSyncService, createSyncService } from './sync-service.js';
export type { SyncResult, SyncOptions } from './sync-service.js';

// Factory functions
export {
  createPatternStore,
  createContractStore,
  detectStorageBackend,
  hasSqliteDatabase,
  hasJsonPatterns,
  getStorageInfo,
} from './store-factory.js';
export type {
  StorageBackend,
  CreatePatternStoreOptions,
  CreateContractStoreOptions,
  PatternStoreInterface,
  ContractStoreInterface,
} from './store-factory.js';
