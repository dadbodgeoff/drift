/**
 * Service Factory
 *
 * Factory functions for creating PatternService instances from legacy stores.
 * This is the recommended way to migrate consumers to the new pattern system.
 *
 * @module patterns/adapters/service-factory
 */

import { PatternStoreAdapter } from './pattern-store-adapter.js';
import { PatternService } from '../impl/pattern-service.js';

import type { PatternStore } from '../../store/pattern-store.js';
import type { IPatternRepository } from '../repository.js';
import type { IPatternService, PatternServiceConfig } from '../service.js';

/**
 * A wrapper that auto-initializes the repository on first use.
 * This provides a seamless experience for consumers who don't want
 * to manually call initialize().
 */
class AutoInitPatternService implements IPatternService {
  private readonly inner: PatternService;
  private readonly repository: IPatternRepository;
  private initPromise: Promise<void> | null = null;

  constructor(repository: IPatternRepository, rootDir: string, config?: Partial<PatternServiceConfig>) {
    this.repository = repository;
    this.inner = new PatternService(repository, rootDir, config);
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.repository.initialize();
    }
    await this.initPromise;
  }

  async getStatus() {
    await this.ensureInitialized();
    return this.inner.getStatus();
  }

  async getCategories() {
    await this.ensureInitialized();
    return this.inner.getCategories();
  }

  async listPatterns(options?: Parameters<IPatternService['listPatterns']>[0]) {
    await this.ensureInitialized();
    return this.inner.listPatterns(options);
  }

  async listByCategory(...args: Parameters<IPatternService['listByCategory']>) {
    await this.ensureInitialized();
    return this.inner.listByCategory(...args);
  }

  async listByStatus(...args: Parameters<IPatternService['listByStatus']>) {
    await this.ensureInitialized();
    return this.inner.listByStatus(...args);
  }

  async getPattern(id: string) {
    await this.ensureInitialized();
    return this.inner.getPattern(id);
  }

  async getPatternWithExamples(id: string, maxExamples?: number) {
    await this.ensureInitialized();
    return this.inner.getPatternWithExamples(id, maxExamples);
  }

  async getPatternsByFile(file: string) {
    await this.ensureInitialized();
    return this.inner.getPatternsByFile(file);
  }

  async approvePattern(id: string, approvedBy?: string) {
    await this.ensureInitialized();
    return this.inner.approvePattern(id, approvedBy);
  }

  async ignorePattern(id: string) {
    await this.ensureInitialized();
    return this.inner.ignorePattern(id);
  }

  async approveMany(ids: string[], approvedBy?: string) {
    await this.ensureInitialized();
    return this.inner.approveMany(ids, approvedBy);
  }

  async ignoreMany(ids: string[]) {
    await this.ensureInitialized();
    return this.inner.ignoreMany(ids);
  }

  async search(...args: Parameters<IPatternService['search']>) {
    await this.ensureInitialized();
    return this.inner.search(...args);
  }

  async query(...args: Parameters<IPatternService['query']>) {
    await this.ensureInitialized();
    return this.inner.query(...args);
  }

  // === Write Operations ===

  async addPattern(...args: Parameters<IPatternService['addPattern']>) {
    await this.ensureInitialized();
    return this.inner.addPattern(...args);
  }

  async addPatterns(...args: Parameters<IPatternService['addPatterns']>) {
    await this.ensureInitialized();
    return this.inner.addPatterns(...args);
  }

  async updatePattern(...args: Parameters<IPatternService['updatePattern']>) {
    await this.ensureInitialized();
    return this.inner.updatePattern(...args);
  }

  async deletePattern(...args: Parameters<IPatternService['deletePattern']>) {
    await this.ensureInitialized();
    return this.inner.deletePattern(...args);
  }

  async save() {
    await this.ensureInitialized();
    return this.inner.save();
  }

  async clear() {
    await this.ensureInitialized();
    return this.inner.clear();
  }
}

/**
 * Create a PatternService from an existing PatternStore.
 *
 * This is the recommended migration path for consumers currently using
 * PatternStore directly. The service provides a higher-level API with
 * caching, metrics, and business logic.
 *
 * The returned service auto-initializes on first use, so you don't need
 * to call initialize() manually.
 *
 * @example
 * ```typescript
 * // Before (direct PatternStore usage)
 * const store = new PatternStore({ rootDir });
 * await store.initialize();
 * const patterns = store.getAll();
 *
 * // After (using PatternService)
 * const store = new PatternStore({ rootDir });
 * const service = createPatternServiceFromStore(store, rootDir);
 * const result = await service.listPatterns(); // Auto-initializes
 * ```
 *
 * @param store The existing PatternStore instance
 * @param rootDir The project root directory (for reading code examples)
 * @param config Optional service configuration
 * @returns A PatternService instance wrapping the store
 */
export function createPatternServiceFromStore(
  store: PatternStore,
  rootDir: string,
  config?: Partial<PatternServiceConfig>
): IPatternService {
  const adapter = new PatternStoreAdapter(store);
  return new AutoInitPatternService(adapter, rootDir, config);
}
