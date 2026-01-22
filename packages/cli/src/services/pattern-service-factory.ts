/**
 * Pattern Service Factory for CLI
 *
 * Provides a convenient way to create a PatternService from the CLI context.
 * This enables CLI commands to use the new unified pattern system.
 *
 * @module services/pattern-service-factory
 */

import {
  PatternStore,
  createPatternServiceFromStore,
  type IPatternService,
} from 'driftdetect-core';

/**
 * Create a PatternService for CLI commands.
 *
 * The service auto-initializes on first use, so you don't need to
 * call initialize() manually.
 *
 * @example
 * ```typescript
 * const service = createCLIPatternService(rootDir);
 * const status = await service.getStatus();
 * ```
 *
 * @param rootDir The project root directory
 * @returns A PatternService instance
 */
export function createCLIPatternService(rootDir: string): IPatternService {
  const store = new PatternStore({ rootDir });
  return createPatternServiceFromStore(store, rootDir);
}

/**
 * Create both a PatternStore and PatternService for CLI commands
 * that need access to both (for backward compatibility during migration).
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
