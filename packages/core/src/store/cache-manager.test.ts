/**
 * Unit tests for CacheManager
 *
 * Tests LRU cache functionality, file hash-based keys,
 * cache invalidation, and statistics tracking.
 *
 * @requirements 2.5 - THE Scanner SHALL cache analysis results using file content hashes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { CacheManager, type CacheManagerOptions } from './cache-manager.js';

describe('CacheManager', () => {
  let cache: CacheManager<string>;
  let testDir: string;

  beforeEach(async () => {
    cache = new CacheManager<string>({ maxSize: 5, ttl: 0, enableStats: true });
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-cache-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      cache.set('hash1', 'value1');
      expect(cache.get('hash1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should check if key exists with has()', () => {
      cache.set('hash1', 'value1');
      expect(cache.has('hash1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should delete entries', () => {
      cache.set('hash1', 'value1');
      expect(cache.delete('hash1')).toBe(true);
      expect(cache.get('hash1')).toBeUndefined();
      expect(cache.delete('hash1')).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('hash1', 'value1');
      cache.set('hash2', 'value2');
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('hash1')).toBeUndefined();
      expect(cache.get('hash2')).toBeUndefined();
    });

    it('should report correct size', () => {
      expect(cache.size).toBe(0);
      cache.set('hash1', 'value1');
      expect(cache.size).toBe(1);
      cache.set('hash2', 'value2');
      expect(cache.size).toBe(2);
      cache.delete('hash1');
      expect(cache.size).toBe(1);
    });

    it('should update existing entries', () => {
      cache.set('hash1', 'value1');
      cache.set('hash1', 'updated');
      expect(cache.get('hash1')).toBe('updated');
      expect(cache.size).toBe(1);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used entry when at capacity', () => {
      // Fill cache to capacity (maxSize = 5)
      cache.set('hash1', 'value1');
      cache.set('hash2', 'value2');
      cache.set('hash3', 'value3');
      cache.set('hash4', 'value4');
      cache.set('hash5', 'value5');

      // Add one more, should evict hash1 (oldest)
      cache.set('hash6', 'value6');

      expect(cache.size).toBe(5);
      expect(cache.get('hash1')).toBeUndefined(); // Evicted
      expect(cache.get('hash6')).toBe('value6'); // New entry
    });

    it('should update LRU order on get()', () => {
      cache.set('hash1', 'value1');
      cache.set('hash2', 'value2');
      cache.set('hash3', 'value3');
      cache.set('hash4', 'value4');
      cache.set('hash5', 'value5');

      // Access hash1, making it most recently used
      cache.get('hash1');

      // Add new entry, should evict hash2 (now oldest)
      cache.set('hash6', 'value6');

      expect(cache.get('hash1')).toBe('value1'); // Still present
      expect(cache.get('hash2')).toBeUndefined(); // Evicted
    });

    it('should update LRU order on set() for existing key', () => {
      cache.set('hash1', 'value1');
      cache.set('hash2', 'value2');
      cache.set('hash3', 'value3');
      cache.set('hash4', 'value4');
      cache.set('hash5', 'value5');

      // Update hash1, making it most recently used
      cache.set('hash1', 'updated');

      // Add new entry, should evict hash2 (now oldest)
      cache.set('hash6', 'value6');

      expect(cache.get('hash1')).toBe('updated'); // Still present
      expect(cache.get('hash2')).toBeUndefined(); // Evicted
    });

    it('should track eviction count in stats', () => {
      cache.set('hash1', 'value1');
      cache.set('hash2', 'value2');
      cache.set('hash3', 'value3');
      cache.set('hash4', 'value4');
      cache.set('hash5', 'value5');
      cache.set('hash6', 'value6'); // Evicts hash1
      cache.set('hash7', 'value7'); // Evicts hash2

      const stats = cache.getStats();
      expect(stats.evictions).toBe(2);
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortTtlCache = new CacheManager<string>({ maxSize: 5, ttl: 50, enableStats: true });
      shortTtlCache.set('hash1', 'value1');

      expect(shortTtlCache.get('hash1')).toBe('value1');

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(shortTtlCache.get('hash1')).toBeUndefined();
    });

    it('should not expire entries when TTL is 0', async () => {
      const noTtlCache = new CacheManager<string>({ maxSize: 5, ttl: 0, enableStats: true });
      noTtlCache.set('hash1', 'value1');

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(noTtlCache.get('hash1')).toBe('value1');
    });

    it('should track expiration count in stats', async () => {
      const shortTtlCache = new CacheManager<string>({ maxSize: 5, ttl: 50, enableStats: true });
      shortTtlCache.set('hash1', 'value1');

      await new Promise((resolve) => setTimeout(resolve, 100));

      shortTtlCache.get('hash1'); // Triggers expiration check

      const stats = shortTtlCache.getStats();
      expect(stats.expirations).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it('should prune expired entries', async () => {
      const shortTtlCache = new CacheManager<string>({ maxSize: 5, ttl: 50, enableStats: true });
      shortTtlCache.set('hash1', 'value1');
      shortTtlCache.set('hash2', 'value2');

      await new Promise((resolve) => setTimeout(resolve, 100));

      const pruned = shortTtlCache.prune();
      expect(pruned).toBe(2);
      expect(shortTtlCache.size).toBe(0);
    });
  });

  describe('statistics tracking', () => {
    it('should track hits and misses', () => {
      cache.set('hash1', 'value1');

      cache.get('hash1'); // Hit
      cache.get('hash1'); // Hit
      cache.get('nonexistent'); // Miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('should calculate hit ratio', () => {
      cache.set('hash1', 'value1');

      cache.get('hash1'); // Hit
      cache.get('hash1'); // Hit
      cache.get('nonexistent'); // Miss

      const stats = cache.getStats();
      expect(stats.hitRatio).toBeCloseTo(2 / 3, 5);
    });

    it('should track entry hits', () => {
      cache.set('hash1', 'value1');

      cache.get('hash1');
      cache.get('hash1');
      cache.get('hash1');

      const entries = cache.entries();
      const entry = entries.find((e) => e.key === 'hash1');
      expect(entry?.entry.hits).toBe(3);
    });

    it('should reset stats', () => {
      cache.set('hash1', 'value1');
      cache.get('hash1');
      cache.get('nonexistent');

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.evictions).toBe(0);
      expect(stats.hitRatio).toBe(0);
      expect(stats.size).toBe(1); // Size is preserved
    });

    it('should disable stats tracking when enableStats is false', () => {
      const noStatsCache = new CacheManager<string>({
        maxSize: 5,
        ttl: 0,
        enableStats: false,
      });

      noStatsCache.set('hash1', 'value1');
      noStatsCache.get('hash1');
      noStatsCache.get('nonexistent');

      const stats = noStatsCache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('hash computation', () => {
    it('should compute consistent hash for same content', () => {
      const hash1 = CacheManager.computeHash('hello world');
      const hash2 = CacheManager.computeHash('hello world');
      expect(hash1).toBe(hash2);
    });

    it('should compute different hash for different content', () => {
      const hash1 = CacheManager.computeHash('content1');
      const hash2 = CacheManager.computeHash('content2');
      expect(hash1).not.toBe(hash2);
    });

    it('should compute SHA-256 hash', () => {
      const hash = CacheManager.computeHash('hello world');
      // Known SHA-256 hash of "hello world"
      expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    });

    it('should compute hash from file', async () => {
      const filePath = path.join(testDir, 'test.txt');
      await fs.writeFile(filePath, 'hello world');

      const hash = await CacheManager.computeFileHash(filePath);
      expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    });

    it('should handle Buffer input', () => {
      const hash = CacheManager.computeHash(Buffer.from('hello world'));
      expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate single entry', () => {
      cache.set('hash1', 'value1');
      cache.set('hash2', 'value2');

      const count = cache.invalidate('hash1');

      expect(count).toBe(1);
      expect(cache.get('hash1')).toBeUndefined();
      expect(cache.get('hash2')).toBe('value2');
    });

    it('should invalidate entry and dependents', () => {
      cache.set('hash1', 'value1');
      cache.set('hash2', 'value2');
      cache.set('hash3', 'value3');

      const count = cache.invalidate('hash1', ['hash2', 'hash3']);

      expect(count).toBe(3);
      expect(cache.get('hash1')).toBeUndefined();
      expect(cache.get('hash2')).toBeUndefined();
      expect(cache.get('hash3')).toBeUndefined();
    });

    it('should return 0 for non-existent entries', () => {
      const count = cache.invalidate('nonexistent');
      expect(count).toBe(0);
    });

    it('should handle partial invalidation', () => {
      cache.set('hash1', 'value1');

      const count = cache.invalidate('hash1', ['nonexistent1', 'nonexistent2']);

      expect(count).toBe(1);
    });
  });

  describe('persistence', () => {
    it('should persist cache to disk', async () => {
      const persistPath = path.join(testDir, 'cache.json');
      const persistCache = new CacheManager<string>({
        maxSize: 5,
        ttl: 0,
        persistPath,
        enableStats: true,
      });

      persistCache.set('hash1', 'value1');
      persistCache.set('hash2', 'value2');

      await persistCache.persist();

      const content = await fs.readFile(persistPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.version).toBe('1.0.0');
      expect(parsed.entries).toHaveLength(2);
    });

    it('should load cache from disk', async () => {
      const persistPath = path.join(testDir, 'cache.json');
      const originalCache = new CacheManager<string>({
        maxSize: 5,
        ttl: 0,
        persistPath,
        enableStats: true,
      });

      originalCache.set('hash1', 'value1');
      originalCache.set('hash2', 'value2');
      await originalCache.persist();

      const loadedCache = new CacheManager<string>({
        maxSize: 5,
        ttl: 0,
        persistPath,
        enableStats: true,
      });
      await loadedCache.load();

      expect(loadedCache.get('hash1')).toBe('value1');
      expect(loadedCache.get('hash2')).toBe('value2');
    });

    it('should handle non-existent persist file gracefully', async () => {
      const persistPath = path.join(testDir, 'nonexistent.json');
      const loadCache = new CacheManager<string>({
        maxSize: 5,
        ttl: 0,
        persistPath,
        enableStats: true,
      });

      await loadCache.load(); // Should not throw

      expect(loadCache.size).toBe(0);
    });

    it('should throw error for invalid cache version', async () => {
      const persistPath = path.join(testDir, 'cache.json');
      await fs.writeFile(
        persistPath,
        JSON.stringify({
          version: '2.0.0',
          createdAt: new Date().toISOString(),
          entries: [],
        })
      );

      const loadCache = new CacheManager<string>({
        maxSize: 5,
        ttl: 0,
        persistPath,
        enableStats: true,
      });

      await expect(loadCache.load()).rejects.toThrow('Unsupported cache version');
    });

    it('should throw error for missing version', async () => {
      const persistPath = path.join(testDir, 'cache.json');
      await fs.writeFile(
        persistPath,
        JSON.stringify({
          createdAt: new Date().toISOString(),
          entries: [],
        })
      );

      const loadCache = new CacheManager<string>({
        maxSize: 5,
        ttl: 0,
        persistPath,
        enableStats: true,
      });

      await expect(loadCache.load()).rejects.toThrow('Invalid cache file: missing version');
    });

    it('should throw error when no persist path specified', async () => {
      const noPersistCache = new CacheManager<string>({ maxSize: 5, ttl: 0, enableStats: true });

      await expect(noPersistCache.persist()).rejects.toThrow('No persist path specified');
      await expect(noPersistCache.load()).rejects.toThrow('No persist path specified');
    });

    it('should create directory structure when persisting', async () => {
      const persistPath = path.join(testDir, 'deep', 'nested', 'cache.json');
      const persistCache = new CacheManager<string>({
        maxSize: 5,
        ttl: 0,
        enableStats: true,
      });

      persistCache.set('hash1', 'value1');
      await persistCache.persist(persistPath);

      const exists = await fs
        .access(persistPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should skip expired entries when loading', async () => {
      const persistPath = path.join(testDir, 'cache.json');

      // Create cache with short TTL
      const originalCache = new CacheManager<string>({
        maxSize: 5,
        ttl: 50,
        persistPath,
        enableStats: true,
      });

      originalCache.set('hash1', 'value1');
      await originalCache.persist();

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Load into new cache with same TTL
      const loadedCache = new CacheManager<string>({
        maxSize: 5,
        ttl: 50,
        persistPath,
        enableStats: true,
      });
      await loadedCache.load();

      expect(loadedCache.size).toBe(0);
    });
  });

  describe('entries()', () => {
    it('should return all non-expired entries', () => {
      cache.set('hash1', 'value1');
      cache.set('hash2', 'value2');

      const entries = cache.entries();

      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.key).sort()).toEqual(['hash1', 'hash2']);
    });

    it('should exclude expired entries', async () => {
      const shortTtlCache = new CacheManager<string>({ maxSize: 5, ttl: 50, enableStats: true });
      shortTtlCache.set('hash1', 'value1');

      await new Promise((resolve) => setTimeout(resolve, 100));

      const entries = shortTtlCache.entries();
      expect(entries).toHaveLength(0);
    });

    it('should include entry metadata', () => {
      cache.set('hash1', 'value1', 100);

      const entries = cache.entries();
      const entry = entries[0];

      expect(entry.entry.hash).toBe('hash1');
      expect(entry.entry.value).toBe('value1');
      expect(entry.entry.size).toBe(100);
      expect(entry.entry.hits).toBe(0);
      expect(entry.entry.timestamp).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('edge cases', () => {
    it('should handle empty cache operations', () => {
      expect(cache.get('any')).toBeUndefined();
      expect(cache.has('any')).toBe(false);
      expect(cache.delete('any')).toBe(false);
      expect(cache.size).toBe(0);
      cache.clear(); // Should not throw
    });

    it('should handle maxSize of 1', () => {
      const tinyCache = new CacheManager<string>({ maxSize: 1, ttl: 0, enableStats: true });

      tinyCache.set('hash1', 'value1');
      expect(tinyCache.get('hash1')).toBe('value1');

      tinyCache.set('hash2', 'value2');
      expect(tinyCache.get('hash1')).toBeUndefined();
      expect(tinyCache.get('hash2')).toBe('value2');
    });

    it('should handle complex object values', () => {
      const objectCache = new CacheManager<{ data: string; count: number }>({
        maxSize: 5,
        ttl: 0,
        enableStats: true,
      });

      const value = { data: 'test', count: 42 };
      objectCache.set('hash1', value);

      const retrieved = objectCache.get('hash1');
      expect(retrieved).toEqual(value);
    });

    it('should handle special characters in hash keys', () => {
      cache.set('hash/with/slashes', 'value1');
      cache.set('hash with spaces', 'value2');
      cache.set('hash:with:colons', 'value3');

      expect(cache.get('hash/with/slashes')).toBe('value1');
      expect(cache.get('hash with spaces')).toBe('value2');
      expect(cache.get('hash:with:colons')).toBe('value3');
    });

    it('should handle rapid set/get operations', () => {
      for (let i = 0; i < 100; i++) {
        cache.set(`hash${i}`, `value${i}`);
      }

      // Only last 5 should remain (maxSize = 5)
      expect(cache.size).toBe(5);

      for (let i = 95; i < 100; i++) {
        expect(cache.get(`hash${i}`)).toBe(`value${i}`);
      }
    });
  });

  describe('default options', () => {
    it('should use default options when not specified', () => {
      const defaultCache = new CacheManager<string>();

      const stats = defaultCache.getStats();
      expect(stats.maxSize).toBe(1000);
    });

    it('should merge partial options with defaults', () => {
      const partialCache = new CacheManager<string>({ maxSize: 50 });

      const stats = partialCache.getStats();
      expect(stats.maxSize).toBe(50);
    });
  });
});
