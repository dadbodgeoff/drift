/**
 * Property-Based Tests for CacheManager - Cache Invalidation
 *
 * Property 14: Cache Invalidation Correctness
 * For any file modification, cached results SHALL be invalidated
 * **Validates: Requirements 2.5, 4.7**
 *
 * @requirements 2.5 - WHEN scanning completes, THE Scanner SHALL cache results in .drift/cache/ for subsequent runs
 * @requirements 4.7 - THE drift.lock file SHALL contain a snapshot of approved patterns for version control
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { CacheManager } from './cache-manager.js';

/**
 * Arbitrary for generating valid cache entry keys (simulating file hashes)
 */
const hashArb = fc.hexaString({ minLength: 8, maxLength: 64 });

/**
 * Arbitrary for generating unique hash sets
 */
const uniqueHashesArb = (minLength: number, maxLength: number) =>
  fc
    .array(hashArb, { minLength, maxLength })
    .map((hashes) => [...new Set(hashes)])
    .filter((hashes) => hashes.length >= minLength);

/**
 * Arbitrary for generating cache entry values (simulating analysis results)
 */
const cacheValueArb = fc.record({
  patterns: fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
  violations: fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
  timestamp: fc.date().map((d) => d.toISOString()),
});

type CacheValue = {
  patterns: string[];
  violations: string[];
  timestamp: string;
};

/**
 * Arbitrary for generating a dependency graph structure
 * Returns a map of file hash -> dependent file hashes
 */
const dependencyGraphArb = fc
  .tuple(
    uniqueHashesArb(3, 10), // All file hashes
    fc.integer({ min: 0, max: 5 }) // Number of dependencies per file
  )
  .chain(([hashes, maxDeps]) => {
    // Create a dependency graph where each file can depend on others
    const graphArb = fc.tuple(
      ...hashes.map((hash) =>
        fc
          .subarray(
            hashes.filter((h) => h !== hash),
            { minLength: 0, maxLength: Math.min(maxDeps, hashes.length - 1) }
          )
          .map((deps) => ({ hash, dependents: deps }))
      )
    );
    return graphArb.map((entries) => {
      const graph = new Map<string, string[]>();
      for (const entry of entries) {
        graph.set(entry.hash, entry.dependents);
      }
      return { hashes, graph };
    });
  });

describe('CacheManager Property Tests', () => {
  /**
   * Property 14: Cache Invalidation Correctness
   * For any file modification, all cached analysis results for that file
   * and its dependents SHALL be invalidated.
   * **Validates: Requirements 2.5, 4.7**
   */
  describe('Property 14: Cache Invalidation Correctness', () => {
    it('should invalidate the entry for a modified file', async () => {
      await fc.assert(
        fc.asyncProperty(hashArb, cacheValueArb, async (hash, value) => {
          // Create a fresh cache for each test iteration
          const cache = new CacheManager<CacheValue>({ maxSize: 100, ttl: 0, enableStats: true });

          // Add entry to cache
          cache.set(hash, value);

          // Verify entry exists
          expect(cache.has(hash)).toBe(true);

          // Invalidate the entry (simulating file modification)
          const count = cache.invalidate(hash);

          // PROPERTY: After invalidation, the entry SHALL NOT be in the cache
          expect(cache.has(hash)).toBe(false);
          expect(cache.get(hash)).toBeUndefined();
          expect(count).toBe(1);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should invalidate dependent entries when a file is modified', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueHashesArb(2, 6),
          fc.array(cacheValueArb, { minLength: 2, maxLength: 6 }),
          async (hashes, values) => {
            // Ensure we have enough values for all hashes
            if (values.length < hashes.length) {
              return true; // Skip this iteration
            }

            // Create a fresh cache for each test iteration
            const cache = new CacheManager<CacheValue>({
              maxSize: 100,
              ttl: 0,
              enableStats: true,
            });

            // Add all entries to cache
            for (let i = 0; i < hashes.length; i++) {
              cache.set(hashes[i], values[i]);
            }

            // The first hash is the "modified" file, rest are dependents
            const modifiedHash = hashes[0];
            const dependentHashes = hashes.slice(1);

            // Verify all entries exist
            for (const hash of hashes) {
              expect(cache.has(hash)).toBe(true);
            }

            // Invalidate the modified file and its dependents
            const count = cache.invalidate(modifiedHash, dependentHashes);

            // PROPERTY: After invalidation, the modified file SHALL NOT be in the cache
            expect(cache.has(modifiedHash)).toBe(false);

            // PROPERTY: After invalidation, all dependent entries SHALL NOT be in the cache
            for (const depHash of dependentHashes) {
              expect(cache.has(depHash)).toBe(false);
            }

            // PROPERTY: The count should equal the number of invalidated entries
            expect(count).toBe(hashes.length);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should NOT invalidate non-dependent entries', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueHashesArb(4, 8),
          fc.array(cacheValueArb, { minLength: 4, maxLength: 8 }),
          async (hashes, values) => {
            // Ensure we have enough values for all hashes
            if (values.length < hashes.length) {
              return true; // Skip this iteration
            }

            // Create a fresh cache for each test iteration
            const cache = new CacheManager<CacheValue>({
              maxSize: 100,
              ttl: 0,
              enableStats: true,
            });

            // Add all entries to cache
            for (let i = 0; i < hashes.length; i++) {
              cache.set(hashes[i], values[i]);
            }

            // Split hashes: first half are modified/dependents, second half are non-dependents
            const midpoint = Math.floor(hashes.length / 2);
            const modifiedHash = hashes[0];
            const dependentHashes = hashes.slice(1, midpoint);
            const nonDependentHashes = hashes.slice(midpoint);

            // Invalidate only the modified file and its dependents
            cache.invalidate(modifiedHash, dependentHashes);

            // PROPERTY: Non-dependent entries SHALL remain in the cache
            for (const hash of nonDependentHashes) {
              expect(cache.has(hash)).toBe(true);
              expect(cache.get(hash)).toEqual(values[hashes.indexOf(hash)]);
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should update cache statistics correctly after invalidation', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueHashesArb(3, 8),
          fc.array(cacheValueArb, { minLength: 3, maxLength: 8 }),
          async (hashes, values) => {
            // Ensure we have enough values for all hashes
            if (values.length < hashes.length) {
              return true; // Skip this iteration
            }

            // Create a fresh cache for each test iteration
            const cache = new CacheManager<CacheValue>({
              maxSize: 100,
              ttl: 0,
              enableStats: true,
            });

            // Add all entries to cache
            for (let i = 0; i < hashes.length; i++) {
              cache.set(hashes[i], values[i]);
            }

            const initialSize = cache.size;
            expect(initialSize).toBe(hashes.length);

            // Invalidate some entries
            const modifiedHash = hashes[0];
            const dependentHashes = hashes.slice(1, Math.ceil(hashes.length / 2));
            const invalidatedCount = 1 + dependentHashes.length;

            cache.invalidate(modifiedHash, dependentHashes);

            // PROPERTY: Cache size SHALL be updated correctly after invalidation
            const expectedSize = initialSize - invalidatedCount;
            expect(cache.size).toBe(expectedSize);

            // PROPERTY: Stats size SHALL match actual cache size
            const stats = cache.getStats();
            expect(stats.size).toBe(expectedSize);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle invalidation of non-existent entries gracefully', async () => {
      await fc.assert(
        fc.asyncProperty(
          hashArb,
          uniqueHashesArb(1, 5),
          async (nonExistentHash, nonExistentDeps) => {
            // Create a fresh cache for each test iteration
            const cache = new CacheManager<CacheValue>({
              maxSize: 100,
              ttl: 0,
              enableStats: true,
            });

            // Don't add any entries - cache is empty

            // Invalidate non-existent entries
            const count = cache.invalidate(nonExistentHash, nonExistentDeps);

            // PROPERTY: Invalidating non-existent entries SHALL return 0
            expect(count).toBe(0);

            // PROPERTY: Cache SHALL remain empty
            expect(cache.size).toBe(0);

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle partial invalidation (some entries exist, some do not)', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueHashesArb(4, 8),
          fc.array(cacheValueArb, { minLength: 2, maxLength: 4 }),
          async (allHashes, values) => {
            // Create a fresh cache for each test iteration
            const cache = new CacheManager<CacheValue>({
              maxSize: 100,
              ttl: 0,
              enableStats: true,
            });

            // Only add some entries to cache (first half)
            const existingHashes = allHashes.slice(0, Math.min(values.length, allHashes.length / 2));
            const nonExistingHashes = allHashes.slice(existingHashes.length);

            for (let i = 0; i < existingHashes.length; i++) {
              cache.set(existingHashes[i], values[i]);
            }

            const initialSize = cache.size;

            // Invalidate a mix of existing and non-existing entries
            const modifiedHash = existingHashes[0];
            const mixedDependents = [
              ...existingHashes.slice(1),
              ...nonExistingHashes.slice(0, 2),
            ];

            const count = cache.invalidate(modifiedHash, mixedDependents);

            // PROPERTY: Count SHALL only include entries that actually existed
            expect(count).toBe(existingHashes.length);

            // PROPERTY: All existing entries that were invalidated SHALL be removed
            for (const hash of existingHashes) {
              expect(cache.has(hash)).toBe(false);
            }

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should maintain cache integrity after multiple invalidations', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueHashesArb(6, 12),
          fc.array(cacheValueArb, { minLength: 6, maxLength: 12 }),
          fc.integer({ min: 2, max: 4 }),
          async (hashes, values, numInvalidations) => {
            // Ensure we have enough values for all hashes
            if (values.length < hashes.length) {
              return true; // Skip this iteration
            }

            // Create a fresh cache for each test iteration
            const cache = new CacheManager<CacheValue>({
              maxSize: 100,
              ttl: 0,
              enableStats: true,
            });

            // Add all entries to cache
            for (let i = 0; i < hashes.length; i++) {
              cache.set(hashes[i], values[i]);
            }

            // Track which hashes have been invalidated
            const invalidatedHashes = new Set<string>();
            const hashesPerInvalidation = Math.floor(hashes.length / numInvalidations);

            // Perform multiple invalidations
            for (let i = 0; i < numInvalidations; i++) {
              const startIdx = i * hashesPerInvalidation;
              const endIdx = Math.min(startIdx + hashesPerInvalidation, hashes.length);
              const hashesToInvalidate = hashes.slice(startIdx, endIdx);

              if (hashesToInvalidate.length > 0) {
                const modifiedHash = hashesToInvalidate[0];
                const dependents = hashesToInvalidate.slice(1);

                cache.invalidate(modifiedHash, dependents);

                for (const hash of hashesToInvalidate) {
                  invalidatedHashes.add(hash);
                }
              }
            }

            // PROPERTY: All invalidated entries SHALL NOT be in the cache
            for (const hash of invalidatedHashes) {
              expect(cache.has(hash)).toBe(false);
            }

            // PROPERTY: All non-invalidated entries SHALL remain in the cache
            for (const hash of hashes) {
              if (!invalidatedHashes.has(hash)) {
                expect(cache.has(hash)).toBe(true);
              }
            }

            // PROPERTY: Cache size SHALL be consistent
            const expectedSize = hashes.length - invalidatedHashes.size;
            expect(cache.size).toBe(expectedSize);

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should correctly invalidate entries in a simulated dependency graph', async () => {
      await fc.assert(
        fc.asyncProperty(dependencyGraphArb, cacheValueArb, async ({ hashes, graph }, value) => {
          // Create a fresh cache for each test iteration
          const cache = new CacheManager<CacheValue>({
            maxSize: 100,
            ttl: 0,
            enableStats: true,
          });

          // Add all entries to cache
          for (const hash of hashes) {
            cache.set(hash, { ...value, timestamp: new Date().toISOString() });
          }

          // Pick a random file to "modify"
          const modifiedHash = hashes[0];

          // Get all dependents (files that depend on the modified file)
          // In a real scenario, this would be computed from the dependency graph
          const dependents = graph.get(modifiedHash) || [];

          // Invalidate the modified file and its dependents
          cache.invalidate(modifiedHash, dependents);

          // PROPERTY: The modified file SHALL NOT be in the cache
          expect(cache.has(modifiedHash)).toBe(false);

          // PROPERTY: All dependent files SHALL NOT be in the cache
          for (const dep of dependents) {
            expect(cache.has(dep)).toBe(false);
          }

          // PROPERTY: Non-dependent files SHALL remain in the cache
          const invalidatedSet = new Set([modifiedHash, ...dependents]);
          for (const hash of hashes) {
            if (!invalidatedSet.has(hash)) {
              expect(cache.has(hash)).toBe(true);
            }
          }

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should handle invalidation with empty dependents array', async () => {
      await fc.assert(
        fc.asyncProperty(hashArb, cacheValueArb, async (hash, value) => {
          // Create a fresh cache for each test iteration
          const cache = new CacheManager<CacheValue>({ maxSize: 100, ttl: 0, enableStats: true });

          // Add entry to cache
          cache.set(hash, value);

          // Invalidate with empty dependents array
          const count = cache.invalidate(hash, []);

          // PROPERTY: Only the main entry SHALL be invalidated
          expect(count).toBe(1);
          expect(cache.has(hash)).toBe(false);

          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should handle duplicate hashes in dependents array', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueHashesArb(3, 5),
          fc.array(cacheValueArb, { minLength: 3, maxLength: 5 }),
          async (hashes, values) => {
            // Ensure we have enough values for all hashes
            if (values.length < hashes.length) {
              return true; // Skip this iteration
            }

            // Create a fresh cache for each test iteration
            const cache = new CacheManager<CacheValue>({
              maxSize: 100,
              ttl: 0,
              enableStats: true,
            });

            // Add all entries to cache
            for (let i = 0; i < hashes.length; i++) {
              cache.set(hashes[i], values[i]);
            }

            const modifiedHash = hashes[0];
            // Create dependents array with duplicates
            const dependents = [...hashes.slice(1), ...hashes.slice(1)];

            const count = cache.invalidate(modifiedHash, dependents);

            // PROPERTY: Duplicates should not cause issues
            // Count should be the number of unique entries invalidated
            expect(count).toBe(hashes.length);

            // PROPERTY: All entries SHALL be invalidated
            for (const hash of hashes) {
              expect(cache.has(hash)).toBe(false);
            }

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
