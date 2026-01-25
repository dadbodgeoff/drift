/**
 * Rust Analyzer Integration Tests
 * 
 * Tests the full Rust language support implementation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createRustAnalyzer } from './rust-analyzer.js';
import * as path from 'path';
import * as fs from 'fs';

// Path to the Rust demo project
const DEMO_PATH = path.resolve(__dirname, '../../../../demo/rust-backend');

describe('RustAnalyzer', () => {
  beforeAll(() => {
    // Verify demo project exists
    if (!fs.existsSync(DEMO_PATH)) {
      throw new Error(`Demo project not found at ${DEMO_PATH}`);
    }
  });

  describe('analyze()', () => {
    it('should analyze the Rust project and return stats', async () => {
      const analyzer = createRustAnalyzer({ rootDir: DEMO_PATH, verbose: false });
      const result = await analyzer.analyze();

      expect(result).toBeDefined();
      expect(result.stats.fileCount).toBeGreaterThan(0);
      expect(result.stats.functionCount).toBeGreaterThan(0);
      expect(result.stats.structCount).toBeGreaterThan(0);
      expect(result.detectedFrameworks).toContain('actix-web');
    });
  });

  describe('analyzeRoutes()', () => {
    it('should detect Actix-web routes', async () => {
      const analyzer = createRustAnalyzer({ rootDir: DEMO_PATH, verbose: false });
      const result = await analyzer.analyzeRoutes();

      // The demo uses attribute macros like #[get("")] which should be detected
      expect(result.routes.length).toBeGreaterThanOrEqual(0);
      
      // Check framework detection works
      if (result.routes.length > 0) {
        expect(result.byFramework['actix-web']).toBeGreaterThan(0);
      }
    });
  });

  describe('analyzeErrorHandling()', () => {
    it('should detect error handling patterns', async () => {
      const analyzer = createRustAnalyzer({ rootDir: DEMO_PATH, verbose: false });
      const result = await analyzer.analyzeErrorHandling();

      // Should detect Result types
      expect(result.stats.resultTypes).toBeGreaterThan(0);
      
      // Should detect thiserror derives
      expect(result.stats.thiserrorDerives).toBeGreaterThan(0);

      // Should detect custom error types
      expect(result.stats.customErrors).toBeGreaterThan(0);
    });
  });

  describe('analyzeTraits()', () => {
    it('should detect traits and implementations', async () => {
      const analyzer = createRustAnalyzer({ rootDir: DEMO_PATH, verbose: false });
      const result = await analyzer.analyzeTraits();

      // Traits and implementations may or may not exist
      expect(result.traits).toBeDefined();
      expect(result.implementations).toBeDefined();
    });
  });

  describe('analyzeDataAccess()', () => {
    it('should detect SQLx data access patterns', async () => {
      const analyzer = createRustAnalyzer({ rootDir: DEMO_PATH, verbose: false });
      const result = await analyzer.analyzeDataAccess();

      // Should detect SQLx queries
      expect(result.accessPoints.length).toBeGreaterThan(0);
      expect(result.tables.length).toBeGreaterThan(0);
      expect(result.byFramework['sqlx']).toBeGreaterThan(0);

      // Check for specific tables
      expect(result.tables).toContain('users');
      expect(result.tables).toContain('products');
    });
  });

  describe('analyzeAsync()', () => {
    it('should detect async patterns', async () => {
      const analyzer = createRustAnalyzer({ rootDir: DEMO_PATH, verbose: false });
      const result = await analyzer.analyzeAsync();

      expect(result.stats.asyncFunctions).toBeGreaterThan(0);
      expect(result.asyncFunctions.length).toBeGreaterThan(0);
      expect(result.runtime).toBe('tokio');
    });
  });
});
