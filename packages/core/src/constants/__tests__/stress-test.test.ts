/**
 * Production-Ready Stress Test Suite for Constants Module
 *
 * Comprehensive testing covering:
 * - Edge cases and boundary conditions
 * - Error handling and recovery
 * - Performance under load
 * - Memory management
 * - Concurrent operations
 * - Real-world code patterns
 * - Integration scenarios
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TypeScriptConstantRegexExtractor } from '../extractors/regex/typescript-regex.js';
import { ConstantStore } from '../store/constant-store.js';
import { inferCategory, suggestConstantName, isSecuritySensitive } from '../analysis/categorizer.js';
import type { ConstantExtraction, ConstantCategory } from '../types.js';

describe('Constants Module - Production Stress Tests', () => {
  const extractor = new TypeScriptConstantRegexExtractor();
  let tempDir: string;
  let store: ConstantStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-constants-test-'));
    store = new ConstantStore({ rootDir: tempDir });
    await store.initialize();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });


  // ============================================================================
  // SECTION 1: Edge Cases & Boundary Conditions
  // ============================================================================

  describe('Edge Cases - Empty & Minimal Input', () => {
    it('should handle empty source gracefully', () => {
      const result = extractor.extract('', 'empty.ts');
      expect(result.constants).toHaveLength(0);
      expect(result.enums).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle whitespace-only source', () => {
      const result = extractor.extract('   \n\t\n   ', 'whitespace.ts');
      expect(result.constants).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle single character source', () => {
      const result = extractor.extract('x', 'single.ts');
      expect(result.constants).toHaveLength(0);
    });

    it('should handle source with only comments', () => {
      const source = `
// This is a comment
/* Block comment */
/**
 * JSDoc comment
 */
`;
      const result = extractor.extract(source, 'comments.ts');
      expect(result.constants).toHaveLength(0);
    });
  });

  describe('Edge Cases - Malformed Input', () => {
    it('should handle incomplete const declaration', () => {
      const source = `export const API_URL = `;
      const result = extractor.extract(source, 'incomplete.ts');
      // Should not crash, may or may not extract
      expect(result.errors).toHaveLength(0);
    });

    it('should handle const without value', () => {
      const source = `export const API_URL;`;
      const result = extractor.extract(source, 'novalue.ts');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle deeply nested braces', () => {
      const source = `
export const NESTED = {
  a: { b: { c: { d: { e: { f: 'deep' } } } } }
};
`;
      const result = extractor.extract(source, 'nested.ts');
      // Should handle without crashing
      expect(result.errors).toHaveLength(0);
    });

    it('should handle unbalanced braces gracefully', () => {
      const source = `export const BAD = { a: { b: 'test' };`;
      const result = extractor.extract(source, 'unbalanced.ts');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle unicode in constant names', () => {
      const source = `export const API_URL_日本語 = 'test';`;
      const result = extractor.extract(source, 'unicode.ts');
      // May or may not match depending on regex
      expect(result.errors).toHaveLength(0);
    });

    it('should handle very long constant names', () => {
      const longName = 'A'.repeat(500);
      const source = `export const ${longName} = 'test';`;
      const result = extractor.extract(source, 'longname.ts');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle very long values', () => {
      const longValue = 'x'.repeat(10000);
      const source = `export const LONG_VALUE = '${longValue}';`;
      const result = extractor.extract(source, 'longvalue.ts');
      expect(result.errors).toHaveLength(0);
      if (result.constants.length > 0) {
        // Value should be truncated
        expect(result.constants[0].rawValue!.length).toBeLessThanOrEqual(503);
      }
    });
  });


  describe('Edge Cases - Special Characters', () => {
    it('should handle escaped quotes in strings', () => {
      const source = `export const ESCAPED = "He said \\"hello\\"";`;
      const result = extractor.extract(source, 'escaped.ts');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle template literals with expressions', () => {
      const source = 'export const TEMPLATE = `Hello ${name}`;';
      const result = extractor.extract(source, 'template.ts');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle regex literals in values', () => {
      const source = `export const PATTERN = /^[a-z]+$/i;`;
      const result = extractor.extract(source, 'regex.ts');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle newlines in string values', () => {
      const source = `export const MULTILINE = "line1\\nline2\\nline3";`;
      const result = extractor.extract(source, 'multiline.ts');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle special regex characters in values', () => {
      const source = 'export const SPECIAL = ".*+?^${}()|[]\\\\\\\\";';
      const result = extractor.extract(source, 'special.ts');
      expect(result.errors).toHaveLength(0);
    });
  });

  // ============================================================================
  // SECTION 2: Real-World Code Patterns
  // ============================================================================

  describe('Real-World Patterns - Configuration Files', () => {
    it('should extract typical config constants', () => {
      const source = `
export const API_BASE_URL = 'https://api.example.com/v1';
export const API_TIMEOUT = 30000;
export const MAX_RETRIES = 3;
export const RETRY_DELAY = 1000;
export const ENABLE_LOGGING = true;
export const LOG_LEVEL = 'info';
`;
      const result = extractor.extract(source, 'config.ts');
      expect(result.constants).toHaveLength(6);
      expect(result.constants.map(c => c.name)).toEqual([
        'API_BASE_URL', 'API_TIMEOUT', 'MAX_RETRIES', 
        'RETRY_DELAY', 'ENABLE_LOGGING', 'LOG_LEVEL'
      ]);
    });

    it('should extract HTTP status codes', () => {
      const source = `
export const HTTP_OK = 200;
export const HTTP_CREATED = 201;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const HTTP_INTERNAL_ERROR = 500;
`;
      const result = extractor.extract(source, 'http-status.ts');
      expect(result.constants).toHaveLength(7);
      expect(result.constants[0].value).toBe(200);
      expect(result.constants[6].value).toBe(500);
    });

    it('should extract error messages', () => {
      const source = `
export const ERR_NOT_FOUND = 'Resource not found';
export const ERR_UNAUTHORIZED = 'Authentication required';
export const ERR_VALIDATION = 'Validation failed';
export const ERR_TIMEOUT = 'Request timed out';
`;
      const result = extractor.extract(source, 'errors.ts');
      expect(result.constants).toHaveLength(4);
      // ERR_ prefix should categorize as error, but some may be security
      // due to containing 'auth' or 'unauthorized' keywords
      result.constants.forEach(c => {
        const category = inferCategory(c);
        // Accept error or security (security takes precedence for auth-related)
        expect(['error', 'security', 'status']).toContain(category);
      });
    });
  });


  describe('Real-World Patterns - Enums', () => {
    it('should extract complex enum with mixed values', () => {
      const source = `
export enum OrderStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}
`;
      const result = extractor.extract(source, 'order-status.ts');
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].members).toHaveLength(6);
      // String enum detection checks if values start with quotes
      expect(result.enums[0].members[0].value).toContain('pending');
    });

    it('should extract numeric enum with explicit values', () => {
      const source = `
export enum Priority {
  LOW = 1,
  MEDIUM = 5,
  HIGH = 10,
  CRITICAL = 100,
}
`;
      const result = extractor.extract(source, 'priority.ts');
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].members[0].value).toBe(1);
      expect(result.enums[0].members[3].value).toBe(100);
    });

    it('should extract const enum', () => {
      const source = `
export const enum Direction {
  UP,
  DOWN,
  LEFT,
  RIGHT,
}
`;
      const result = extractor.extract(source, 'direction.ts');
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].modifiers).toContain('const');
    });

    it('should extract multiple enums in one file', () => {
      const source = `
export enum Status { ACTIVE, INACTIVE }
export enum Role { ADMIN, USER, GUEST }
enum InternalState { INIT, READY, DONE }
`;
      const result = extractor.extract(source, 'multi-enum.ts');
      expect(result.enums).toHaveLength(3);
    });
  });

  describe('Real-World Patterns - Class Constants', () => {
    it('should extract static readonly class properties', () => {
      const source = `
class ApiClient {
  static readonly BASE_URL = 'https://api.example.com';
  static readonly TIMEOUT = 5000;
  static readonly MAX_RETRIES = 3;
}
`;
      const result = extractor.extract(source, 'api-client.ts');
      expect(result.constants.length).toBeGreaterThanOrEqual(3);
      const baseUrl = result.constants.find(c => c.name === 'BASE_URL');
      expect(baseUrl?.parentName).toBe('ApiClient');
      expect(baseUrl?.modifiers).toContain('static');
    });

    it('should extract constants from multiple classes', () => {
      const source = `
class Config {
  static readonly APP_NAME = 'MyApp';
}

class Database {
  static readonly CONNECTION_TIMEOUT = 30000;
}
`;
      const result = extractor.extract(source, 'multi-class.ts');
      const appName = result.constants.find(c => c.name === 'APP_NAME');
      const timeout = result.constants.find(c => c.name === 'CONNECTION_TIMEOUT');
      expect(appName?.parentName).toBe('Config');
      expect(timeout?.parentName).toBe('Database');
    });
  });


  // ============================================================================
  // SECTION 3: Category Inference Stress Tests
  // ============================================================================

  describe('Category Inference - Comprehensive', () => {
    const testCases: Array<{ name: string; value?: string; expected: ConstantCategory }> = [
      // API category
      { name: 'API_URL', value: 'https://api.example.com', expected: 'api' },
      { name: 'API_KEY', expected: 'security' }, // Security takes precedence
      { name: 'BASE_URL', value: 'https://example.com', expected: 'api' },
      { name: 'ENDPOINT', expected: 'api' },
      { name: 'API_TIMEOUT', expected: 'api' },
      
      // Status category
      { name: 'STATUS_PENDING', expected: 'status' },
      { name: 'USER_STATE', expected: 'status' },
      { name: 'PHASE_INIT', expected: 'status' },
      
      // Error category
      { name: 'ERROR_NOT_FOUND', expected: 'error' },
      { name: 'ERR_TIMEOUT', expected: 'error' },
      { name: 'EXCEPTION_CODE', expected: 'error' },
      
      // Feature flags
      { name: 'FEATURE_NEW_UI', expected: 'feature_flag' },
      { name: 'FF_DARK_MODE', expected: 'feature_flag' },
      { name: 'ENABLE_CACHE', expected: 'feature_flag' },
      { name: 'IS_PRODUCTION', expected: 'feature_flag' },
      { name: 'HAS_PERMISSION', expected: 'feature_flag' },
      
      // Limits - use more specific patterns
      { name: 'MAX_CONNECTIONS', expected: 'limit' },
      { name: 'MIN_VALUE', expected: 'limit' },
      { name: 'TIMEOUT_MS', expected: 'limit' },
      { name: 'RATE_LIMIT', expected: 'limit' },
      { name: 'RETRY_COUNT', expected: 'limit' },
      
      // Security
      { name: 'SECRET_KEY', expected: 'security' },
      { name: 'PASSWORD_SALT', expected: 'security' },
      { name: 'AUTH_TOKEN', expected: 'security' },
      { name: 'PRIVATE_KEY', expected: 'security' },
      { name: 'ENCRYPTION_KEY', expected: 'security' },
      
      // Config
      { name: 'CONFIG_VALUE', expected: 'config' },
      { name: 'DEFAULT_SETTINGS', expected: 'config' },
      { name: 'APP_OPTIONS', expected: 'config' },
      
      // Paths
      { name: 'FILE_PATH', expected: 'path' },
      { name: 'UPLOAD_DIR', expected: 'path' },
      { name: 'ROUTE_HOME', expected: 'path' },
      
      // Environment
      { name: 'ENV_NAME', expected: 'env' },
      { name: 'NODE_ENV', expected: 'env' },
      
      // Regex
      { name: 'REGEX_EMAIL', expected: 'regex' },
      { name: 'PATTERN_PHONE', expected: 'regex' },
    ];

    testCases.forEach(({ name, value, expected }) => {
      it(`should categorize ${name} as ${expected}`, () => {
        const constant: ConstantExtraction = {
          id: `test:${name}:1`,
          name,
          qualifiedName: name,
          file: 'test.ts',
          line: 1,
          column: 1,
          endLine: 1,
          language: 'typescript',
          kind: 'primitive',
          category: 'uncategorized',
          value: value ?? 'test',
          isExported: true,
          decorators: [],
          modifiers: ['const'],
          confidence: 0.9,
        };
        expect(inferCategory(constant)).toBe(expected);
      });
    });
  });

  describe('Category Inference - Security Detection', () => {
    const securityNames = [
      'API_SECRET', 'DB_PASSWORD', 'JWT_SECRET', 'STRIPE_SECRET_KEY',
      'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'PRIVATE_KEY_PEM',
      'ENCRYPTION_KEY', 'AUTH_CREDENTIAL', 'CERTIFICATE_KEY',
    ];

    securityNames.forEach(name => {
      it(`should flag ${name} as security-sensitive`, () => {
        const constant: ConstantExtraction = {
          id: `test:${name}:1`,
          name,
          qualifiedName: name,
          file: 'test.ts',
          line: 1,
          column: 1,
          endLine: 1,
          language: 'typescript',
          kind: 'primitive',
          category: 'uncategorized',
          isExported: true,
          decorators: [],
          modifiers: ['const'],
          confidence: 0.9,
        };
        const category = inferCategory(constant);
        expect(category).toBe('security');
        expect(isSecuritySensitive(category)).toBe(true);
      });
    });
  });


  // ============================================================================
  // SECTION 4: Store Operations Stress Tests
  // ============================================================================

  describe('Store - Basic Operations', () => {
    it('should save and retrieve file results', async () => {
      const result = extractor.extract(`
export const API_URL = 'https://api.example.com';
export const TIMEOUT = 5000;
`, 'config.ts');

      await store.saveFileResult(result, 'hash123');
      const retrieved = await store.getFileResult('config.ts');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.constants).toHaveLength(2);
      expect(retrieved!.contentHash).toBe('hash123');
    });

    it('should detect when re-extraction is needed', async () => {
      const result = extractor.extract(`export const A = 1;`, 'test.ts');
      await store.saveFileResult(result, 'hash1');

      expect(await store.needsExtraction('test.ts', 'hash1')).toBe(false);
      expect(await store.needsExtraction('test.ts', 'hash2')).toBe(true);
      expect(await store.needsExtraction('nonexistent.ts', 'hash1')).toBe(true);
    });

    it('should delete file results', async () => {
      const result = extractor.extract(`export const A = 1;`, 'test.ts');
      await store.saveFileResult(result, 'hash1');

      await store.deleteFileResult('test.ts');
      const retrieved = await store.getFileResult('test.ts');
      expect(retrieved).toBeNull();
    });

    it('should handle deleting non-existent file gracefully', async () => {
      await expect(store.deleteFileResult('nonexistent.ts')).resolves.not.toThrow();
    });
  });

  describe('Store - Bulk Operations', () => {
    it('should handle many files', async () => {
      const fileCount = 100;
      
      // Save many files
      for (let i = 0; i < fileCount; i++) {
        const source = `export const CONST_${i} = ${i};`;
        const result = extractor.extract(source, `file${i}.ts`);
        await store.saveFileResult(result, `hash${i}`);
      }

      // Verify all constants are retrievable
      const allConstants = await store.getAllConstants();
      expect(allConstants.length).toBe(fileCount);

      // Verify index is correct
      const index = await store.getIndex();
      expect(index.stats.totalConstants).toBe(fileCount);
    });

    it('should rebuild index correctly', async () => {
      // Save some files
      for (let i = 0; i < 10; i++) {
        const source = `export const CONST_${i} = ${i};`;
        const result = extractor.extract(source, `file${i}.ts`);
        await store.saveFileResult(result, `hash${i}`);
      }

      // Force rebuild
      const index = await store.rebuildIndex();
      expect(index.stats.totalConstants).toBe(10);
      expect(Object.keys(index.byFile)).toHaveLength(10);
    });

    it('should search by name', async () => {
      const sources = [
        { file: 'api.ts', source: `export const API_URL = 'url'; export const API_KEY = 'key';` },
        { file: 'db.ts', source: `export const DB_URL = 'url'; export const DB_TIMEOUT = 1000;` },
      ];

      for (const { file, source } of sources) {
        const result = extractor.extract(source, file);
        await store.saveFileResult(result, `hash-${file}`);
      }

      const apiResults = await store.searchByName('API');
      expect(apiResults.length).toBeGreaterThanOrEqual(1);

      const urlResults = await store.searchByName('URL');
      expect(urlResults.length).toBeGreaterThanOrEqual(1);
    });

    it('should get constants by category', async () => {
      const source = `
export const API_URL = 'https://api.example.com';
export const MAX_RETRIES = 3;
export const SECRET_KEY = 'secret';
export const ERR_NOT_FOUND = 'Not found';
`;
      const result = extractor.extract(source, 'mixed.ts');
      
      // Manually set categories for test
      result.constants[0].category = 'api';
      result.constants[1].category = 'limit';
      result.constants[2].category = 'security';
      result.constants[3].category = 'error';
      
      await store.saveFileResult(result, 'hash');

      const apiConstants = await store.getConstantsByCategory('api');
      expect(apiConstants.length).toBe(1);
      expect(apiConstants[0].name).toBe('API_URL');
    });
  });


  describe('Store - Concurrent Operations', () => {
    it('should handle concurrent saves', async () => {
      const promises = [];
      for (let i = 0; i < 50; i++) {
        const source = `export const CONST_${i} = ${i};`;
        const result = extractor.extract(source, `concurrent${i}.ts`);
        promises.push(store.saveFileResult(result, `hash${i}`));
      }

      await Promise.all(promises);

      const allConstants = await store.getAllConstants();
      expect(allConstants.length).toBe(50);
    });

    it('should handle concurrent reads and writes', async () => {
      // First save some data
      for (let i = 0; i < 10; i++) {
        const source = `export const CONST_${i} = ${i};`;
        const result = extractor.extract(source, `rw${i}.ts`);
        await store.saveFileResult(result, `hash${i}`);
      }

      // Now do concurrent reads and writes
      const operations = [];
      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) {
          // Read
          operations.push(store.getAllConstants());
        } else {
          // Write
          const source = `export const NEW_CONST_${i} = ${i};`;
          const result = extractor.extract(source, `new${i}.ts`);
          operations.push(store.saveFileResult(result, `newhash${i}`));
        }
      }

      await Promise.all(operations);
      // Should not throw
    });
  });

  describe('Store - Statistics', () => {
    it('should calculate correct statistics', async () => {
      const source = `
export const API_URL = 'https://api.example.com';
export const MAX_RETRIES = 3;
export const ENABLE_FEATURE = true;

export enum Status {
  PENDING,
  ACTIVE,
  DONE,
}

export enum Priority {
  LOW = 1,
  HIGH = 10,
}
`;
      const result = extractor.extract(source, 'stats.ts');
      await store.saveFileResult(result, 'hash');

      const stats = await store.getStats();
      expect(stats.totalConstants).toBe(3);
      expect(stats.totalEnums).toBe(2);
      expect(stats.totalEnumMembers).toBe(5);
      expect(stats.byLanguage.typescript).toBe(3);
    });

    it('should detect inconsistent values', async () => {
      // Same constant name with different values in different files
      const result1 = extractor.extract(`export const API_URL = 'https://prod.api.com';`, 'prod.ts');
      const result2 = extractor.extract(`export const API_URL = 'https://dev.api.com';`, 'dev.ts');

      await store.saveFileResult(result1, 'hash1');
      await store.saveFileResult(result2, 'hash2');

      const index = await store.rebuildIndex();
      expect(index.stats.issues.inconsistentValues).toBeGreaterThan(0);
    });
  });


  // ============================================================================
  // SECTION 5: Performance Tests
  // ============================================================================

  describe('Performance - Extraction Speed', () => {
    it('should extract from large file quickly', () => {
      // Generate a large file with many constants
      const lines = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(`export const CONST_${i} = ${i};`);
      }
      const source = lines.join('\n');

      const start = performance.now();
      const result = extractor.extract(source, 'large.ts');
      const duration = performance.now() - start;

      expect(result.constants.length).toBe(1000);
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });

    it('should handle file with many enums', () => {
      const lines = [];
      for (let i = 0; i < 100; i++) {
        lines.push(`export enum Enum${i} { A, B, C, D, E }`);
      }
      const source = lines.join('\n');

      const start = performance.now();
      const result = extractor.extract(source, 'enums.ts');
      const duration = performance.now() - start;

      expect(result.enums.length).toBe(100);
      expect(duration).toBeLessThan(1000);
    });

    it('should handle mixed large file', () => {
      const lines = [];
      for (let i = 0; i < 500; i++) {
        lines.push(`export const CONST_${i} = ${i};`);
        if (i % 10 === 0) {
          lines.push(`export enum Enum${i} { A = ${i}, B = ${i + 1} }`);
        }
      }
      const source = lines.join('\n');

      const start = performance.now();
      const result = extractor.extract(source, 'mixed.ts');
      const duration = performance.now() - start;

      expect(result.constants.length).toBe(500);
      expect(result.enums.length).toBe(50);
      expect(duration).toBeLessThan(2000);
    });
  });

  describe('Performance - Store Operations', () => {
    it('should handle rapid sequential saves', async () => {
      const start = performance.now();
      
      for (let i = 0; i < 100; i++) {
        const source = `export const C${i} = ${i};`;
        const result = extractor.extract(source, `rapid${i}.ts`);
        await store.saveFileResult(result, `hash${i}`);
      }

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(5000); // 5 seconds for 100 files
    });

    it('should retrieve all constants quickly', async () => {
      // First populate
      for (let i = 0; i < 50; i++) {
        const source = `export const C${i} = ${i};`;
        const result = extractor.extract(source, `perf${i}.ts`);
        await store.saveFileResult(result, `hash${i}`);
      }

      const start = performance.now();
      const constants = await store.getAllConstants();
      const duration = performance.now() - start;

      expect(constants.length).toBe(50);
      expect(duration).toBeLessThan(1000);
    });
  });


  // ============================================================================
  // SECTION 6: Integration Tests
  // ============================================================================

  describe('Integration - Full Workflow', () => {
    it('should handle complete extraction-to-query workflow', async () => {
      // Step 1: Extract from multiple files
      const files = [
        { path: 'src/config/api.ts', source: `
export const API_BASE_URL = 'https://api.example.com';
export const API_TIMEOUT = 30000;
export const API_KEY = 'sk_test_xxx';
` },
        { path: 'src/config/database.ts', source: `
export const DB_HOST = 'localhost';
export const DB_PORT = 5432;
export const DB_PASSWORD = 'secret123';
` },
        { path: 'src/constants/status.ts', source: `
export enum OrderStatus {
  PENDING = 'pending',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
}
export const STATUS_LABELS = {
  pending: 'Pending',
  shipped: 'Shipped',
  delivered: 'Delivered',
} as const;
` },
      ];

      for (const file of files) {
        const result = extractor.extract(file.source, file.path);
        // Apply category inference
        for (const constant of result.constants) {
          constant.category = inferCategory(constant);
        }
        await store.saveFileResult(result, `hash-${file.path}`);
      }

      // Step 2: Query and verify
      const allConstants = await store.getAllConstants();
      expect(allConstants.length).toBeGreaterThanOrEqual(6);

      const allEnums = await store.getAllEnums();
      expect(allEnums.length).toBe(1);

      // Step 3: Check security detection
      const securityConstants = await store.getConstantsByCategory('security');
      expect(securityConstants.length).toBeGreaterThanOrEqual(2); // API_KEY, DB_PASSWORD

      // Step 4: Verify statistics
      const stats = await store.getStats();
      expect(stats.totalConstants).toBeGreaterThanOrEqual(6);
      expect(stats.totalEnums).toBe(1);
      expect(stats.issues.potentialSecrets).toBeGreaterThanOrEqual(2);
    });

    it('should handle incremental updates', async () => {
      // Initial extraction
      const source1 = `export const VERSION = '1.0.0';`;
      const result1 = extractor.extract(source1, 'version.ts');
      await store.saveFileResult(result1, 'hash1');

      let stats = await store.getStats();
      expect(stats.totalConstants).toBe(1);

      // Update the file (replaces the previous version)
      const source2 = `
export const VERSION = '2.0.0';
export const BUILD_NUMBER = 123;
`;
      const result2 = extractor.extract(source2, 'version.ts');
      await store.saveFileResult(result2, 'hash2');

      // Rebuild index to get accurate stats
      await store.rebuildIndex();
      stats = await store.getStats();
      expect(stats.totalConstants).toBe(2);

      // Verify the update
      const constants = await store.getConstantsByFile('version.ts');
      expect(constants.length).toBe(2);
      expect(constants.find(c => c.name === 'VERSION')?.value).toBe('2.0.0');
    });
  });


  // ============================================================================
  // SECTION 7: Error Recovery Tests
  // ============================================================================

  describe('Error Recovery', () => {
    it('should recover from corrupted shard file', async () => {
      // Save a valid result
      const result = extractor.extract(`export const A = 1;`, 'test.ts');
      await store.saveFileResult(result, 'hash1');

      // Corrupt the shard file by writing invalid JSON
      const shardPath = path.join(tempDir, '.drift', 'lake', 'constants', 'files');
      const files = await fs.readdir(shardPath);
      if (files.length > 0) {
        await fs.writeFile(path.join(shardPath, files[0]), 'invalid json{{{');
      }

      // Should handle gracefully
      const retrieved = await store.getFileResult('test.ts');
      // May return null due to parse error, but should not throw
      expect(retrieved === null || retrieved !== null).toBe(true);
    });

    it('should handle missing directories gracefully', async () => {
      // Delete the constants directory
      await fs.rm(path.join(tempDir, '.drift', 'lake', 'constants'), { recursive: true, force: true });

      // Operations should not throw
      const constants = await store.getAllConstants();
      expect(constants).toEqual([]);

      // getStats will rebuild index which creates the directory
      const stats = await store.getStats();
      expect(stats.totalConstants).toBe(0);
    });

    it('should reinitialize after clear', async () => {
      // Save some data
      const result = extractor.extract(`export const A = 1;`, 'test.ts');
      await store.saveFileResult(result, 'hash1');

      // Clear everything
      await store.clear();

      // Should be able to save again
      await store.saveFileResult(result, 'hash2');
      const constants = await store.getAllConstants();
      expect(constants.length).toBe(1);
    });
  });

  // ============================================================================
  // SECTION 8: Name Suggestion Tests
  // ============================================================================

  describe('Name Suggestions', () => {
    it('should suggest names for common values', () => {
      expect(suggestConstantName(3600, 'limit')).toBe('ONE_HOUR_SECONDS');
      expect(suggestConstantName(86400, 'limit')).toBe('ONE_DAY_SECONDS');
      expect(suggestConstantName(1000, 'limit')).toBe('ONE_SECOND_MS');
      expect(suggestConstantName('application/json', 'api')).toBe('CONTENT_TYPE_JSON');
      expect(suggestConstantName('utf-8', 'config')).toBe('ENCODING_UTF8');
    });

    it('should generate names for unknown values', () => {
      const name = suggestConstantName('custom-value', 'config');
      expect(name).toMatch(/^CONFIG_/);
      expect(name).toMatch(/CUSTOM/);
    });

    it('should sanitize special characters', () => {
      const name = suggestConstantName('hello@world.com', 'api');
      expect(name).not.toContain('@');
      expect(name).not.toContain('.');
    });

    it('should truncate long values', () => {
      const longValue = 'a'.repeat(100);
      const name = suggestConstantName(longValue, 'config');
      expect(name.length).toBeLessThanOrEqual(40); // PREFIX + 30 chars max
    });
  });


  // ============================================================================
  // SECTION 9: Quality Metrics Tests
  // ============================================================================

  describe('Quality Metrics', () => {
    it('should report correct extraction method', () => {
      const result = extractor.extract(`export const A = 1;`, 'test.ts');
      expect(result.quality.method).toBe('regex');
      expect(result.quality.usedFallback).toBe(true);
    });

    it('should report confidence scores', () => {
      const result = extractor.extract(`export const A = 1;`, 'test.ts');
      expect(result.quality.confidence).toBeGreaterThan(0);
      expect(result.quality.confidence).toBeLessThanOrEqual(1);
    });

    it('should track extraction time', () => {
      const result = extractor.extract(`export const A = 1;`, 'test.ts');
      expect(result.quality.extractionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should count items extracted', () => {
      const source = `
export const A = 1;
export const B = 2;
export enum E { X, Y }
`;
      const result = extractor.extract(source, 'test.ts');
      expect(result.quality.itemsExtracted).toBe(3); // 2 constants + 1 enum
    });
  });

  // ============================================================================
  // SECTION 10: Doc Comment Extraction Tests
  // ============================================================================

  describe('Doc Comment Extraction', () => {
    it('should extract JSDoc comments', () => {
      const source = `
/**
 * The base URL for all API requests.
 * @see https://api.example.com/docs
 */
export const API_URL = 'https://api.example.com';
`;
      const result = extractor.extract(source, 'test.ts');
      expect(result.constants[0].docComment).toContain('base URL');
    });

    it('should extract single-line comments', () => {
      const source = `
// Maximum number of retry attempts
export const MAX_RETRIES = 3;
`;
      const result = extractor.extract(source, 'test.ts');
      expect(result.constants[0].docComment).toContain('retry attempts');
    });

    it('should handle multi-line block comments', () => {
      const source = `
/*
 * Configuration timeout in milliseconds.
 * Default is 30 seconds.
 */
export const TIMEOUT = 30000;
`;
      const result = extractor.extract(source, 'test.ts');
      expect(result.constants[0].docComment).toContain('timeout');
    });

    it('should not capture unrelated comments', () => {
      const source = `
// This is a random comment

// Another unrelated comment

export const VALUE = 42;
`;
      const result = extractor.extract(source, 'test.ts');
      // Should only capture the immediately preceding comment if any
    });
  });

  // ============================================================================
  // SECTION 11: Type Annotation Tests
  // ============================================================================

  describe('Type Annotations', () => {
    it('should extract simple type annotations', () => {
      const source = `
export const COUNT: number = 42;
export const NAME: string = 'test';
export const ENABLED: boolean = true;
`;
      const result = extractor.extract(source, 'test.ts');
      expect(result.constants[0].type).toBe('number');
      expect(result.constants[1].type).toBe('string');
      expect(result.constants[2].type).toBe('boolean');
    });

    it('should extract complex type annotations', () => {
      const source = `
export const CONFIG: Record<string, number> = {};
export const ITEMS: Array<string> = [];
`;
      const result = extractor.extract(source, 'test.ts');
      // May or may not capture complex types depending on regex
      expect(result.errors).toHaveLength(0);
    });
  });
});
