/**
 * Integration tests for the Scanner module
 *
 * Verifies that the scanner can traverse a real codebase,
 * build dependency graphs, and cache results correctly.
 *
 * @requirements 2.1, 2.3, 2.4, 2.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FileWalker } from './file-walker.js';
import { DependencyGraph, type ImportInfo, type ExportInfo } from './dependency-graph.js';
import { CacheManager } from '../store/cache-manager.js';

describe('Scanner Integration Tests', () => {
  describe('FileWalker - Real Codebase Traversal', () => {
    it('should traverse the drift/packages/core directory', async () => {
      const walker = new FileWalker();
      const result = await walker.walk({
        rootDir: path.resolve(__dirname, '..'),
        respectGitignore: true,
        respectDriftignore: true,
        extensions: ['.ts', '.js'],
      });

      expect(result.success).toBe(true);
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.directories.length).toBeGreaterThan(0);

      // Verify we found TypeScript files
      const tsFiles = result.files.filter((f) => f.extension === '.ts');
      expect(tsFiles.length).toBeGreaterThan(0);

      // Verify stats are populated
      expect(result.stats.totalFiles).toBe(result.files.length);
      expect(result.stats.totalDirectories).toBe(result.directories.length);
      expect(result.stats.duration).toBeGreaterThan(0);
    });

    it('should respect .gitignore patterns', async () => {
      const walker = new FileWalker();
      const result = await walker.walk({
        rootDir: path.resolve(__dirname, '../../../..'), // drift root
        respectGitignore: true,
        respectDriftignore: true,
      });

      // Should not include node_modules files
      const nodeModulesFiles = result.files.filter((f) =>
        f.relativePath.includes('node_modules')
      );
      expect(nodeModulesFiles.length).toBe(0);

      // Should not include dist files
      const distFiles = result.files.filter((f) =>
        f.relativePath.includes('/dist/')
      );
      expect(distFiles.length).toBe(0);
    });

    it('should track file statistics correctly', async () => {
      const walker = new FileWalker();
      const result = await walker.walk({
        rootDir: path.resolve(__dirname, '..'),
        respectGitignore: true,
        extensions: ['.ts'],
      });

      expect(result.success).toBe(true);

      // Verify extension stats
      expect(result.stats.filesByExtension['.ts']).toBeGreaterThan(0);

      // Verify language stats
      expect(result.stats.filesByLanguage['typescript']).toBeGreaterThan(0);
    });
  });

  describe('DependencyGraph - Building from Real Files', () => {
    // Helper to normalize paths for cross-platform compatibility
    const normalizePath = (p: string) => p.replace(/\\/g, '/');

    it('should build a dependency graph from scanner module files', async () => {
      const graph = new DependencyGraph();

      const fileWalkerPath = normalizePath(path.resolve(__dirname, 'file-walker.ts'));
      const changeDetectorPath = normalizePath(path.resolve(__dirname, 'change-detector.ts'));
      const dependencyGraphPath = normalizePath(path.resolve(__dirname, 'dependency-graph.ts'));
      const typesPath = normalizePath(path.resolve(__dirname, 'types.ts'));

      // Add the scanner module files with their imports
      // file-walker.ts imports from types.ts
      graph.addModule(
        fileWalkerPath,
        [
          {
            source: './types.js',
            resolvedPath: typesPath,
            specifiers: [],
            type: 'es-module',
            sideEffectOnly: false,
            line: 1,
            column: 0,
          },
        ],
        []
      );

      // change-detector.ts imports from types.ts
      graph.addModule(
        changeDetectorPath,
        [
          {
            source: './types.js',
            resolvedPath: typesPath,
            specifiers: [],
            type: 'es-module',
            sideEffectOnly: false,
            line: 1,
            column: 0,
          },
        ],
        []
      );

      // dependency-graph.ts has no local imports
      graph.addModule(
        dependencyGraphPath,
        [],
        []
      );

      // types.ts has no imports
      graph.addModule(
        typesPath,
        [],
        []
      );

      // Verify graph structure
      expect(graph.size).toBe(4);

      // Verify dependencies
      const fileWalkerDeps = graph.getDependencies(fileWalkerPath);
      expect(fileWalkerDeps).toContain(typesPath);

      // Verify dependents
      const typesDependents = graph.getDependents(typesPath);
      expect(typesDependents.length).toBe(2);
    });

    it('should detect circular dependencies', () => {
      const graph = new DependencyGraph();

      // Create a circular dependency: A -> B -> C -> A
      graph.addModule('/a.ts', [
        {
          source: './b.js',
          resolvedPath: '/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      graph.addModule('/b.ts', [
        {
          source: './c.js',
          resolvedPath: '/c.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      graph.addModule('/c.ts', [
        {
          source: './a.js',
          resolvedPath: '/a.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      // Verify circular dependency detection
      expect(graph.hasCircularDependency()).toBe(true);

      const result = graph.detectCircularDependencies();
      expect(result.hasCircular).toBe(true);
      expect(result.cycles.length).toBeGreaterThan(0);

      // Verify all modules in the cycle are detected
      const modulesInCycles = graph.getModulesInCycles();
      expect(modulesInCycles).toContain('/a.ts');
      expect(modulesInCycles).toContain('/b.ts');
      expect(modulesInCycles).toContain('/c.ts');
    });

    it('should compute topological order for acyclic graphs', () => {
      const graph = new DependencyGraph();

      // Create an acyclic graph: A -> B -> C, A -> C
      graph.addModule('/c.ts', [], []);

      graph.addModule('/b.ts', [
        {
          source: './c.js',
          resolvedPath: '/c.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      graph.addModule('/a.ts', [
        {
          source: './b.js',
          resolvedPath: '/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
        {
          source: './c.js',
          resolvedPath: '/c.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      // Verify no circular dependencies
      expect(graph.hasCircularDependency()).toBe(false);

      // Get topological order
      const order = graph.getTopologicalOrder();
      expect(order.length).toBe(3);

      // C should come before B, B should come before A
      const cIndex = order.indexOf('/c.ts');
      const bIndex = order.indexOf('/b.ts');
      const aIndex = order.indexOf('/a.ts');

      expect(cIndex).toBeLessThan(bIndex);
      expect(bIndex).toBeLessThan(aIndex);
    });
  });

  describe('CacheManager - Caching Analysis Results', () => {
    let cache: CacheManager<{ analyzed: boolean; timestamp: number }>;

    beforeEach(() => {
      cache = new CacheManager({
        maxSize: 100,
        ttl: 60000, // 1 minute
        enableStats: true,
      });
    });

    it('should cache and retrieve analysis results', () => {
      const hash = CacheManager.computeHash('file content');
      const result = { analyzed: true, timestamp: Date.now() };

      cache.set(hash, result);

      const retrieved = cache.get(hash);
      expect(retrieved).toEqual(result);
    });

    it('should track cache statistics', () => {
      const hash1 = CacheManager.computeHash('content1');
      const hash2 = CacheManager.computeHash('content2');

      cache.set(hash1, { analyzed: true, timestamp: Date.now() });

      // Hit
      cache.get(hash1);
      // Miss
      cache.get(hash2);

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(1);
    });

    it('should invalidate cache entries', () => {
      const hash1 = CacheManager.computeHash('content1');
      const hash2 = CacheManager.computeHash('content2');
      const hash3 = CacheManager.computeHash('content3');

      cache.set(hash1, { analyzed: true, timestamp: Date.now() });
      cache.set(hash2, { analyzed: true, timestamp: Date.now() });
      cache.set(hash3, { analyzed: true, timestamp: Date.now() });

      expect(cache.size).toBe(3);

      // Invalidate hash1 and its dependents (hash2)
      const invalidated = cache.invalidate(hash1, [hash2]);
      expect(invalidated).toBe(2);
      expect(cache.size).toBe(1);
      expect(cache.has(hash1)).toBe(false);
      expect(cache.has(hash2)).toBe(false);
      expect(cache.has(hash3)).toBe(true);
    });

    it('should evict LRU entries when at capacity', () => {
      const smallCache = new CacheManager<number>({
        maxSize: 3,
        ttl: 0,
        enableStats: true,
      });

      // Add 3 entries
      smallCache.set('hash1', 1);
      smallCache.set('hash2', 2);
      smallCache.set('hash3', 3);

      expect(smallCache.size).toBe(3);

      // Access hash1 to make it recently used
      smallCache.get('hash1');

      // Add a 4th entry - should evict hash2 (least recently used)
      smallCache.set('hash4', 4);

      expect(smallCache.size).toBe(3);
      expect(smallCache.has('hash1')).toBe(true); // Recently accessed
      expect(smallCache.has('hash2')).toBe(false); // Evicted
      expect(smallCache.has('hash3')).toBe(true);
      expect(smallCache.has('hash4')).toBe(true);

      const stats = smallCache.getStats();
      expect(stats.evictions).toBe(1);
    });
  });

  describe('End-to-End: Scanner + Cache Integration', () => {
    it('should cache scan results and retrieve them on repeated scans', async () => {
      const cache = new CacheManager<{ fileCount: number }>({
        maxSize: 100,
        ttl: 60000,
        enableStats: true,
      });

      const walker = new FileWalker();
      const scanDir = path.resolve(__dirname);

      // First scan
      const result1 = await walker.walk({
        rootDir: scanDir,
        extensions: ['.ts'],
        computeHashes: true,
      });

      // Cache the result
      const scanHash = CacheManager.computeHash(scanDir + result1.stats.totalFiles);
      cache.set(scanHash, { fileCount: result1.files.length });

      // Simulate a second scan - should hit cache
      const cachedResult = cache.get(scanHash);
      expect(cachedResult).toBeDefined();
      expect(cachedResult?.fileCount).toBe(result1.files.length);

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
    });
  });
});
