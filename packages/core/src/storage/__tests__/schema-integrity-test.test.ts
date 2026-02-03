/**
 * Schema Integrity Tests
 * 
 * Tests the SQLite schema to ensure:
 * 1. All tables are created correctly
 * 2. All indexes exist
 * 3. All views work
 * 4. All triggers fire correctly
 * 5. Foreign key constraints work
 * 6. Check constraints work
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { UnifiedStore } from '../unified-store.js';

// ============================================================================
// Test Utilities
// ============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-schema-test-'));
}

function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================================
// Test Suite: Schema Integrity
// ============================================================================

describe('Schema Integrity Tests', () => {
  let tempDir: string;
  let store: UnifiedStore;

  beforeEach(async () => {
    tempDir = createTempDir();
    store = new UnifiedStore({ rootDir: tempDir });
    await store.initialize();
  });

  afterEach(async () => {
    if (store) await store.close();
    cleanupTempDir(tempDir);
  });

  describe('Table Existence', () => {
    const expectedTables = [
      'project', 'config', 'feature_flags',
      'patterns', 'pattern_locations', 'pattern_variants', 'pattern_examples',
      'contracts', 'contract_frontends',
      'constraints',
      'data_models', 'sensitive_fields', 'data_access_points',
      'env_variables', 'env_access_points',
      'functions', 'function_calls', 'function_data_access',
      'audit_snapshots', 'pattern_history', 'health_trends', 'scan_history',
      'dna_profile', 'dna_genes', 'dna_mutations',
      'test_files', 'test_coverage',
      'sync_log',
      'learned_patterns',
      'decisions',
      'wrappers', 'wrapper_clusters',
      'module_coupling', 'coupling_cycles',
      'error_boundaries', 'error_handling_gaps',
      'constants', 'constant_usages',
      'quality_gate_runs', 'quality_gate_snapshots',
    ];

    it('should have all required tables', () => {
      const db = store.getDatabase();
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `).all() as Array<{ name: string }>;
      
      const tableNames = tables.map(t => t.name);
      
      for (const expected of expectedTables) {
        expect(tableNames).toContain(expected);
      }
    });
  });

  describe('Index Existence', () => {
    const expectedIndexes = [
      'idx_patterns_category',
      'idx_patterns_status',
      'idx_patterns_confidence',
      'idx_pattern_locations_file',
      'idx_pattern_locations_pattern',
      'idx_contracts_status',
      'idx_contracts_endpoint',
      'idx_constraints_category',
      'idx_constraints_status',
      'idx_data_access_table',
      'idx_data_access_file',
      'idx_sensitive_fields_table',
      'idx_env_access_var',
      'idx_env_access_file',
      'idx_functions_file',
      'idx_functions_name',
      'idx_function_calls_caller',
      'idx_function_calls_callee',
      'idx_audit_date',
      'idx_pattern_history_date',
      'idx_pattern_history_pattern',
    ];

    it('should have all required indexes', () => {
      const db = store.getDatabase();
      const indexes = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name NOT LIKE 'sqlite_%'
      `).all() as Array<{ name: string }>;
      
      const indexNames = indexes.map(i => i.name);
      
      for (const expected of expectedIndexes) {
        expect(indexNames).toContain(expected);
      }
    });
  });

  describe('View Existence and Functionality', () => {
    it('should have v_status view', () => {
      const db = store.getDatabase();
      const result = db.prepare('SELECT * FROM v_status').get();
      expect(result).toBeDefined();
    });

    it('should have v_category_counts view', () => {
      const db = store.getDatabase();
      
      // Add some patterns first
      db.prepare(`
        INSERT INTO patterns (id, name, category, status, confidence_score, confidence_level, first_seen, last_seen)
        VALUES ('view-test-1', 'Test 1', 'api', 'discovered', 0.5, 'medium', datetime('now'), datetime('now'))
      `).run();
      
      db.prepare(`
        INSERT INTO patterns (id, name, category, status, confidence_score, confidence_level, first_seen, last_seen)
        VALUES ('view-test-2', 'Test 2', 'api', 'approved', 0.8, 'high', datetime('now'), datetime('now'))
      `).run();
      
      const result = db.prepare('SELECT * FROM v_category_counts WHERE category = ?').get('api') as any;
      expect(result).toBeDefined();
      expect(result.count).toBe(2);
    });

    it('should have v_pattern_index view', () => {
      const db = store.getDatabase();
      
      db.prepare(`
        INSERT INTO patterns (id, name, category, status, confidence_score, confidence_level, first_seen, last_seen)
        VALUES ('index-test', 'Index Test', 'security', 'discovered', 0.9, 'high', datetime('now'), datetime('now'))
      `).run();
      
      const result = db.prepare('SELECT * FROM v_pattern_index WHERE id = ?').get('index-test');
      expect(result).toBeDefined();
    });

    it('should have v_file_patterns view', () => {
      const db = store.getDatabase();
      
      db.prepare(`
        INSERT INTO patterns (id, name, category, status, confidence_score, confidence_level, first_seen, last_seen)
        VALUES ('file-view-test', 'File View Test', 'api', 'discovered', 0.5, 'medium', datetime('now'), datetime('now'))
      `).run();
      
      db.prepare(`
        INSERT INTO pattern_locations (pattern_id, file, line, column_num, is_outlier, confidence)
        VALUES ('file-view-test', 'src/test.ts', 10, 0, 0, 1.0)
      `).run();
      
      const result = db.prepare('SELECT * FROM v_file_patterns WHERE file = ?').get('src/test.ts');
      expect(result).toBeDefined();
    });

    it('should have v_security_summary view', () => {
      const db = store.getDatabase();
      const result = db.prepare('SELECT * FROM v_security_summary').get();
      expect(result).toBeDefined();
    });
  });

  describe('Trigger Functionality', () => {
    it('should log INSERT operations to sync_log', () => {
      const db = store.getDatabase();
      
      db.prepare(`
        INSERT INTO patterns (id, name, category, status, confidence_score, confidence_level, first_seen, last_seen)
        VALUES ('trigger-test-insert', 'Trigger Test', 'api', 'discovered', 0.5, 'medium', datetime('now'), datetime('now'))
      `).run();
      
      const syncEntry = db.prepare(`
        SELECT * FROM sync_log WHERE table_name = 'patterns' AND row_id = 'trigger-test-insert' AND operation = 'INSERT'
      `).get();
      
      expect(syncEntry).toBeDefined();
    });

    it('should log UPDATE operations to sync_log', () => {
      const db = store.getDatabase();
      
      db.prepare(`
        INSERT INTO patterns (id, name, category, status, confidence_score, confidence_level, first_seen, last_seen)
        VALUES ('trigger-test-update', 'Trigger Test', 'api', 'discovered', 0.5, 'medium', datetime('now'), datetime('now'))
      `).run();
      
      db.prepare(`
        UPDATE patterns SET name = 'Updated Name' WHERE id = 'trigger-test-update'
      `).run();
      
      const syncEntry = db.prepare(`
        SELECT * FROM sync_log WHERE table_name = 'patterns' AND row_id = 'trigger-test-update' AND operation = 'UPDATE'
      `).get();
      
      expect(syncEntry).toBeDefined();
    });

    it('should log DELETE operations to sync_log', () => {
      const db = store.getDatabase();
      
      db.prepare(`
        INSERT INTO patterns (id, name, category, status, confidence_score, confidence_level, first_seen, last_seen)
        VALUES ('trigger-test-delete', 'Trigger Test', 'api', 'discovered', 0.5, 'medium', datetime('now'), datetime('now'))
      `).run();
      
      db.prepare(`
        DELETE FROM patterns WHERE id = 'trigger-test-delete'
      `).run();
      
      const syncEntry = db.prepare(`
        SELECT * FROM sync_log WHERE table_name = 'patterns' AND row_id = 'trigger-test-delete' AND operation = 'DELETE'
      `).get();
      
      expect(syncEntry).toBeDefined();
    });
  });

  describe('Foreign Key Constraints', () => {
    it('should enforce FK on pattern_locations -> patterns', () => {
      const db = store.getDatabase();
      
      expect(() => {
        db.prepare(`
          INSERT INTO pattern_locations (pattern_id, file, line, column_num, is_outlier, confidence)
          VALUES ('non-existent-pattern', 'test.ts', 1, 0, 0, 1.0)
        `).run();
      }).toThrow();
    });

    it('should enforce FK on contract_frontends -> contracts', () => {
      const db = store.getDatabase();
      
      expect(() => {
        db.prepare(`
          INSERT INTO contract_frontends (contract_id, method, path, normalized_path, file, line)
          VALUES ('non-existent-contract', 'GET', '/api/test', '/api/test', 'test.ts', 1)
        `).run();
      }).toThrow();
    });

    it('should enforce FK on dna_mutations -> dna_genes', () => {
      const db = store.getDatabase();
      
      expect(() => {
        db.prepare(`
          INSERT INTO dna_mutations (gene_id, file, line, expected, actual, impact, reason)
          VALUES ('non-existent-gene', 'test.ts', 1, 'expected', 'actual', 'high', 'test')
        `).run();
      }).toThrow();
    });

    it('should cascade delete pattern_locations when pattern is deleted', () => {
      const db = store.getDatabase();
      
      db.prepare(`
        INSERT INTO patterns (id, name, category, status, confidence_score, confidence_level, first_seen, last_seen)
        VALUES ('cascade-test', 'Cascade Test', 'api', 'discovered', 0.5, 'medium', datetime('now'), datetime('now'))
      `).run();
      
      db.prepare(`
        INSERT INTO pattern_locations (pattern_id, file, line, column_num, is_outlier, confidence)
        VALUES ('cascade-test', 'test.ts', 1, 0, 0, 1.0)
      `).run();
      
      db.prepare(`DELETE FROM patterns WHERE id = 'cascade-test'`).run();
      
      const locations = db.prepare(`
        SELECT * FROM pattern_locations WHERE pattern_id = 'cascade-test'
      `).all();
      
      expect(locations.length).toBe(0);
    });
  });

  describe('Check Constraints', () => {
    it('should enforce status check on patterns', () => {
      const db = store.getDatabase();
      
      expect(() => {
        db.prepare(`
          INSERT INTO patterns (id, name, category, status, confidence_score, confidence_level, first_seen, last_seen)
          VALUES ('check-test', 'Check Test', 'api', 'invalid_status', 0.5, 'medium', datetime('now'), datetime('now'))
        `).run();
      }).toThrow();
    });

    it('should enforce confidence_level check on patterns', () => {
      const db = store.getDatabase();
      
      expect(() => {
        db.prepare(`
          INSERT INTO patterns (id, name, category, status, confidence_score, confidence_level, first_seen, last_seen)
          VALUES ('check-test-2', 'Check Test', 'api', 'discovered', 0.5, 'invalid_level', datetime('now'), datetime('now'))
        `).run();
      }).toThrow();
    });

    it('should enforce operation check on data_access_points', () => {
      const db = store.getDatabase();
      
      expect(() => {
        db.prepare(`
          INSERT INTO data_access_points (id, table_name, operation, file, line)
          VALUES ('check-test-3', 'users', 'invalid_op', 'test.ts', 1)
        `).run();
      }).toThrow();
    });

    it('should enforce sensitivity check on sensitive_fields', () => {
      const db = store.getDatabase();
      
      expect(() => {
        db.prepare(`
          INSERT INTO sensitive_fields (table_name, field_name, sensitivity)
          VALUES ('users', 'email', 'invalid_sensitivity')
        `).run();
      }).toThrow();
    });

    it('should enforce impact check on dna_mutations', () => {
      const db = store.getDatabase();
      
      // First add a gene
      db.prepare(`
        INSERT INTO dna_genes (id, name, dominant_variant, frequency, confidence)
        VALUES ('impact-gene', 'Impact Gene', 'variant', 0.8, 0.9)
      `).run();
      
      expect(() => {
        db.prepare(`
          INSERT INTO dna_mutations (gene_id, file, line, expected, actual, impact, reason)
          VALUES ('impact-gene', 'test.ts', 1, 'expected', 'actual', 'invalid_impact', 'test')
        `).run();
      }).toThrow();
    });
  });

  describe('Unique Constraints', () => {
    it('should enforce unique pattern IDs', () => {
      const db = store.getDatabase();
      
      db.prepare(`
        INSERT INTO patterns (id, name, category, status, confidence_score, confidence_level, first_seen, last_seen)
        VALUES ('unique-test', 'Unique Test', 'api', 'discovered', 0.5, 'medium', datetime('now'), datetime('now'))
      `).run();
      
      expect(() => {
        db.prepare(`
          INSERT INTO patterns (id, name, category, status, confidence_score, confidence_level, first_seen, last_seen)
          VALUES ('unique-test', 'Duplicate', 'security', 'approved', 0.8, 'high', datetime('now'), datetime('now'))
        `).run();
      }).toThrow();
    });

    it('should enforce unique contract method+endpoint', () => {
      const db = store.getDatabase();
      
      db.prepare(`
        INSERT INTO contracts (id, method, endpoint, normalized_endpoint, status, first_seen, last_seen)
        VALUES ('contract-unique-1', 'GET', '/api/users', '/api/users', 'discovered', datetime('now'), datetime('now'))
      `).run();
      
      expect(() => {
        db.prepare(`
          INSERT INTO contracts (id, method, endpoint, normalized_endpoint, status, first_seen, last_seen)
          VALUES ('contract-unique-2', 'GET', '/api/users', '/api/users', 'discovered', datetime('now'), datetime('now'))
        `).run();
      }).toThrow();
    });

    it('should enforce unique sensitive_fields table+field', () => {
      const db = store.getDatabase();
      
      db.prepare(`
        INSERT INTO sensitive_fields (table_name, field_name, sensitivity)
        VALUES ('users', 'email', 'pii')
      `).run();
      
      expect(() => {
        db.prepare(`
          INSERT INTO sensitive_fields (table_name, field_name, sensitivity)
          VALUES ('users', 'email', 'auth')
        `).run();
      }).toThrow();
    });
  });

  describe('Default Values', () => {
    it('should set default status on patterns', () => {
      const db = store.getDatabase();
      
      db.prepare(`
        INSERT INTO patterns (id, name, category, confidence_score, confidence_level, first_seen, last_seen)
        VALUES ('default-test', 'Default Test', 'api', 0.5, 'medium', datetime('now'), datetime('now'))
      `).run();
      
      const pattern = db.prepare(`SELECT status FROM patterns WHERE id = 'default-test'`).get() as any;
      expect(pattern.status).toBe('discovered');
    });

    it('should set default confidence_level on patterns', () => {
      const db = store.getDatabase();
      
      db.prepare(`
        INSERT INTO patterns (id, name, category, confidence_score, first_seen, last_seen)
        VALUES ('default-test-2', 'Default Test 2', 'api', 0.5, datetime('now'), datetime('now'))
      `).run();
      
      const pattern = db.prepare(`SELECT confidence_level FROM patterns WHERE id = 'default-test-2'`).get() as any;
      expect(pattern.confidence_level).toBe('uncertain');
    });

    it('should set default timestamps', () => {
      const db = store.getDatabase();
      
      db.prepare(`
        INSERT INTO patterns (id, name, category, confidence_score, confidence_level)
        VALUES ('default-test-3', 'Default Test 3', 'api', 0.5, 'medium')
      `).run();
      
      const pattern = db.prepare(`SELECT first_seen, last_seen FROM patterns WHERE id = 'default-test-3'`).get() as any;
      expect(pattern.first_seen).toBeDefined();
      expect(pattern.last_seen).toBeDefined();
    });
  });

  describe('WAL Mode', () => {
    it('should be in WAL mode', () => {
      const db = store.getDatabase();
      const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
      expect(result[0].journal_mode).toBe('wal');
    });
  });

  describe('Foreign Keys Enabled', () => {
    it('should have foreign keys enabled', () => {
      const db = store.getDatabase();
      const result = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>;
      expect(result[0].foreign_keys).toBe(1);
    });
  });
});
