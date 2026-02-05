/**
 * Pattern Service Factory for CLI
 *
 * Provides a convenient way to create a PatternService from the CLI context.
 * This enables CLI commands to use the new unified pattern system.
 *
 * Phase 3: SQLite is now the default storage backend.
 * - Uses SQLite (HybridPatternStore) if drift.db exists or for new projects
 * - Falls back to JSON (PatternStore) only if JSON patterns exist and no SQLite
 *
 * @module services/pattern-service-factory
 */

import {
  PatternStore,
  createPatternServiceFromStore,
  createPatternStore,
  getStorageInfo,
  type IPatternService,
  type PatternStoreInterface,
} from 'driftdetect-core';

/**
 * Create a PatternService for CLI commands.
 *
 * The service auto-initializes on first use, so you don't need to
 * call initialize() manually.
 *
 * Phase 3: Now automatically uses SQLite backend by default.
 *
 * @example
 * ```typescript
 * const service = await createCLIPatternService(rootDir);
 * const status = await service.getStatus();
 * ```
 *
 * @param rootDir The project root directory
 * @returns A PatternService instance
 */
export async function createCLIPatternServiceAsync(rootDir: string): Promise<IPatternService> {
  const store = await createPatternStore({ rootDir });
  // The store is already initialized by the factory
  return createPatternServiceFromStore(store as PatternStore, rootDir);
}

/**
 * Create a PatternService for CLI commands (synchronous wrapper).
 *
 * Note: This creates a JSON-based PatternStore for backward compatibility.
 * For SQLite support, use createCLIPatternServiceAsync instead.
 *
 * @param rootDir The project root directory
 * @returns A PatternService instance
 */
export function createCLIPatternService(rootDir: string): IPatternService {
  // For synchronous API, we still use JSON-based PatternStore
  // Callers needing SQLite should use createCLIPatternServiceAsync
  const store = new PatternStore({ rootDir });
  return createPatternServiceFromStore(store, rootDir);
}

/**
 * Create both a PatternStore and PatternService for CLI commands
 * that need access to both (for backward compatibility during migration).
 *
 * @deprecated Use createCLIPatternServiceAsync for automatic SQLite support
 *
 * @param rootDir The project root directory
 * @returns Both the store and service
 */
export function createCLIPatternStoreAndService(rootDir: string): {
  store: PatternStore;
  service: IPatternService;
} {
  const store = new PatternStore({ rootDir });
  const service = createPatternServiceFromStore(store, rootDir);
  return { store, service };
}

/**
 * Create a pattern store with automatic backend detection.
 * Phase 3: SQLite is now the default for new projects.
 *
 * @param rootDir The project root directory
 * @returns An initialized pattern store (either HybridPatternStore or PatternStore)
 */
export async function createCLIPatternStore(rootDir: string): Promise<PatternStoreInterface> {
  return createPatternStore({ rootDir });
}

/**
 * Get information about the storage backend for a project.
 *
 * @param rootDir The project root directory
 * @returns Storage backend information
 */
export function getCLIStorageInfo(rootDir: string) {
  return getStorageInfo(rootDir);
}
