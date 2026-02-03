-- ============================================================================
-- Drift Unified Database Schema v1.0.0
-- 
-- This schema consolidates all Drift metadata into a single SQLite database.
-- It replaces 50+ JSON files with a professional, cloud-ready architecture.
--
-- Design Principles:
-- 1. Normalized tables with proper foreign keys
-- 2. Indexes for all common query patterns
-- 3. JSON columns for flexible nested data
-- 4. Triggers for automatic timestamp updates
-- 5. Views for backward-compatible queries
--
-- Migration: Run `drift migrate-storage` to convert from JSON files.
-- ============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- ============================================================================
-- PROJECT METADATA
-- ============================================================================

CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  drift_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,  -- JSON blob for complex values
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feature_flags (
  feature TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  built_at TEXT,
  config TEXT  -- JSON blob for feature-specific config
);

-- ============================================================================
-- PATTERNS
-- ============================================================================

CREATE TABLE IF NOT EXISTS patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  subcategory TEXT,
  status TEXT NOT NULL DEFAULT 'discovered' 
    CHECK (status IN ('discovered', 'approved', 'ignored')),
  
  -- Confidence
  confidence_score REAL NOT NULL DEFAULT 0.0,
  confidence_level TEXT NOT NULL DEFAULT 'uncertain'
    CHECK (confidence_level IN ('high', 'medium', 'low', 'uncertain')),
  confidence_frequency REAL,
  confidence_consistency REAL,
  confidence_age REAL,
  confidence_spread INTEGER,
  
  -- Detector info
  detector_type TEXT,
  detector_config TEXT,  -- JSON blob
  
  -- Metadata
  severity TEXT DEFAULT 'info' 
    CHECK (severity IN ('error', 'warning', 'info', 'hint')),
  auto_fixable INTEGER DEFAULT 0,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  approved_by TEXT,
  tags TEXT,  -- JSON array
  source TEXT,
  
  -- Counts (denormalized for fast queries)
  location_count INTEGER DEFAULT 0,
  outlier_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pattern_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  column_num INTEGER DEFAULT 0,
  end_line INTEGER,
  end_column INTEGER,
  is_outlier INTEGER DEFAULT 0,
  outlier_reason TEXT,
  deviation_score REAL,
  confidence REAL DEFAULT 1.0,
  snippet TEXT,
  
  UNIQUE(pattern_id, file, line, column_num)
);

CREATE TABLE IF NOT EXISTS pattern_variants (
  id TEXT PRIMARY KEY,
  pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'directory', 'file')),
  scope_value TEXT,
  reason TEXT NOT NULL,
  locations TEXT,  -- JSON array
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS pattern_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  code TEXT NOT NULL,
  context TEXT,
  quality REAL DEFAULT 1.0,
  is_outlier INTEGER DEFAULT 0,
  extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- CONTRACTS (API)
-- ============================================================================

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  method TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH')),
  endpoint TEXT NOT NULL,
  normalized_endpoint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered', 'verified', 'mismatch', 'ignored')),
  
  -- Backend info
  backend_method TEXT,
  backend_path TEXT,
  backend_normalized_path TEXT,
  backend_file TEXT,
  backend_line INTEGER,
  backend_framework TEXT,
  backend_response_fields TEXT,  -- JSON array
  
  -- Confidence
  confidence_score REAL DEFAULT 0.0,
  confidence_level TEXT DEFAULT 'low',
  match_confidence REAL,
  field_extraction_confidence REAL,
  
  -- Mismatches
  mismatches TEXT,  -- JSON array of mismatch descriptions
  
  -- Metadata
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT,
  verified_by TEXT,
  
  UNIQUE(method, normalized_endpoint)
);

CREATE TABLE IF NOT EXISTS contract_frontends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  library TEXT,
  response_fields TEXT  -- JSON array
);

-- ============================================================================
-- CONSTRAINTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS constraints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered', 'approved', 'ignored', 'custom')),
  language TEXT DEFAULT 'all',
  
  -- Definition
  invariant TEXT NOT NULL,  -- JSON blob
  scope TEXT,  -- JSON blob
  enforcement_level TEXT DEFAULT 'warning'
    CHECK (enforcement_level IN ('error', 'warning', 'info')),
  enforcement_message TEXT,
  enforcement_autofix TEXT,
  
  -- Confidence
  confidence_score REAL DEFAULT 0.0,
  confidence_evidence INTEGER DEFAULT 0,
  confidence_violations INTEGER DEFAULT 0,
  
  -- Metadata
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  approved_by TEXT,
  ignored_at TEXT,
  ignore_reason TEXT,
  tags TEXT,  -- JSON array
  notes TEXT
);

-- ============================================================================
-- BOUNDARIES (Data Access)
-- ============================================================================

CREATE TABLE IF NOT EXISTS data_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  framework TEXT,
  confidence REAL DEFAULT 1.0,
  fields TEXT,  -- JSON array
  
  UNIQUE(name, file)
);

CREATE TABLE IF NOT EXISTS sensitive_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  field_name TEXT NOT NULL,
  sensitivity TEXT NOT NULL 
    CHECK (sensitivity IN ('pii', 'financial', 'auth', 'health', 'custom')),
  reason TEXT,
  
  UNIQUE(table_name, field_name)
);

CREATE TABLE IF NOT EXISTS data_access_points (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('read', 'write', 'delete')),
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  column_num INTEGER DEFAULT 0,
  context TEXT,
  fields TEXT,  -- JSON array of accessed fields
  is_raw_sql INTEGER DEFAULT 0,
  confidence REAL DEFAULT 1.0,
  function_id TEXT  -- Link to call graph
);

-- ============================================================================
-- ENVIRONMENT VARIABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS env_variables (
  name TEXT PRIMARY KEY,
  sensitivity TEXT NOT NULL DEFAULT 'unknown'
    CHECK (sensitivity IN ('secret', 'credential', 'config', 'unknown')),
  has_default INTEGER DEFAULT 0,
  is_required INTEGER DEFAULT 0,
  default_value TEXT
);

CREATE TABLE IF NOT EXISTS env_access_points (
  id TEXT PRIMARY KEY,
  var_name TEXT NOT NULL REFERENCES env_variables(name) ON DELETE CASCADE,
  method TEXT NOT NULL,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  column_num INTEGER DEFAULT 0,
  context TEXT,
  language TEXT,
  confidence REAL DEFAULT 1.0,
  has_default INTEGER DEFAULT 0,
  default_value TEXT,
  is_required INTEGER DEFAULT 0
);

-- ============================================================================
-- CALL GRAPH
-- ============================================================================

CREATE TABLE IF NOT EXISTS functions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  qualified_name TEXT,
  file TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  language TEXT NOT NULL,
  is_exported INTEGER DEFAULT 0,
  is_entry_point INTEGER DEFAULT 0,
  is_data_accessor INTEGER DEFAULT 0,
  is_constructor INTEGER DEFAULT 0,
  is_async INTEGER DEFAULT 0,
  decorators TEXT,  -- JSON array
  parameters TEXT,  -- JSON array
  signature TEXT
);

CREATE TABLE IF NOT EXISTS function_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caller_id TEXT NOT NULL REFERENCES functions(id) ON DELETE CASCADE,
  callee_id TEXT REFERENCES functions(id) ON DELETE SET NULL,
  callee_name TEXT NOT NULL,
  line INTEGER NOT NULL,
  column_num INTEGER DEFAULT 0,
  resolved INTEGER DEFAULT 0,
  confidence REAL DEFAULT 0.5,
  argument_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS function_data_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  function_id TEXT NOT NULL REFERENCES functions(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('read', 'write', 'delete')),
  fields TEXT,  -- JSON array
  line INTEGER NOT NULL,
  confidence REAL DEFAULT 1.0
);

-- ============================================================================
-- AUDIT & HISTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  scan_hash TEXT,
  health_score INTEGER,
  total_patterns INTEGER,
  auto_approve_eligible INTEGER,
  flagged_for_review INTEGER,
  likely_false_positives INTEGER,
  duplicate_candidates INTEGER,
  avg_confidence REAL,
  cross_validation_score REAL,
  summary TEXT  -- JSON blob for category breakdown
);

CREATE TABLE IF NOT EXISTS pattern_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  pattern_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'approved', 'ignored', 'updated', 'deleted')),
  previous_status TEXT,
  new_status TEXT,
  changed_by TEXT,
  details TEXT
);

CREATE TABLE IF NOT EXISTS health_trends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  health_score INTEGER,
  avg_confidence REAL,
  total_patterns INTEGER,
  approved_count INTEGER,
  duplicate_groups INTEGER,
  cross_validation_score REAL
);

CREATE TABLE IF NOT EXISTS scan_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  files_scanned INTEGER,
  patterns_found INTEGER,
  patterns_approved INTEGER,
  errors INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT,
  checksum TEXT
);

-- ============================================================================
-- DNA (Component Styling)
-- ============================================================================

CREATE TABLE IF NOT EXISTS dna_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- Singleton
  version TEXT NOT NULL DEFAULT '1.0.0',
  generated_at TEXT NOT NULL,
  health_score INTEGER,
  genetic_diversity REAL,
  summary TEXT  -- JSON blob
);

CREATE TABLE IF NOT EXISTS dna_genes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dominant_variant TEXT,
  frequency REAL,
  confidence REAL,
  variants TEXT,  -- JSON blob
  evidence TEXT   -- JSON blob
);

CREATE TABLE IF NOT EXISTS dna_mutations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gene_id TEXT NOT NULL REFERENCES dna_genes(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  expected TEXT,
  actual TEXT,
  impact TEXT CHECK (impact IN ('high', 'medium', 'low')),
  reason TEXT
);

-- ============================================================================
-- TEST TOPOLOGY
-- ============================================================================

CREATE TABLE IF NOT EXISTS test_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT NOT NULL UNIQUE,
  test_framework TEXT,
  test_count INTEGER DEFAULT 0,
  last_run TEXT,
  status TEXT DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS test_coverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_file TEXT NOT NULL,
  source_file TEXT NOT NULL,
  function_id TEXT,
  coverage_type TEXT CHECK (coverage_type IN ('unit', 'integration', 'e2e')),
  confidence REAL DEFAULT 1.0,
  
  UNIQUE(test_file, source_file, function_id)
);

-- ============================================================================
-- CONSTANTS ANALYSIS
-- ============================================================================

CREATE TABLE IF NOT EXISTS constants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  value TEXT,
  type TEXT,
  category TEXT CHECK (category IN (
    'config', 'api', 'status', 'error', 'feature_flag', 
    'limit', 'regex', 'path', 'env', 'security', 'uncategorized'
  )),
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  language TEXT,
  exported INTEGER DEFAULT 0,
  is_magic INTEGER DEFAULT 0,
  is_secret INTEGER DEFAULT 0,
  usage_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS constant_usages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  constant_id TEXT NOT NULL REFERENCES constants(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  context TEXT
);

-- ============================================================================
-- DECISIONS (from decision mining)
-- ============================================================================

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT CHECK (category IN (
    'technology-adoption', 'technology-removal', 'pattern-introduction',
    'pattern-migration', 'architecture-change', 'api-change',
    'security-enhancement', 'performance-optimization', 'refactoring',
    'testing-strategy', 'infrastructure', 'other'
  )),
  status TEXT DEFAULT 'discovered' CHECK (status IN ('discovered', 'confirmed', 'rejected')),
  confidence REAL DEFAULT 0.0,
  
  -- Source
  commit_hash TEXT,
  commit_date TEXT,
  author TEXT,
  
  -- Impact
  files_affected TEXT,  -- JSON array
  patterns_affected TEXT,  -- JSON array
  
  -- Metadata
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  confirmed_by TEXT
);

-- ============================================================================
-- COUPLING ANALYSIS
-- ============================================================================

CREATE TABLE IF NOT EXISTS module_coupling (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_module TEXT NOT NULL,
  target_module TEXT NOT NULL,
  coupling_type TEXT CHECK (coupling_type IN ('import', 'call', 'type', 'inheritance')),
  strength INTEGER DEFAULT 1,
  
  UNIQUE(source_module, target_module, coupling_type)
);

CREATE TABLE IF NOT EXISTS coupling_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_hash TEXT NOT NULL UNIQUE,
  modules TEXT NOT NULL,  -- JSON array of module paths
  length INTEGER NOT NULL,
  severity TEXT CHECK (severity IN ('info', 'warning', 'critical')),
  detected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- ERROR HANDLING ANALYSIS
-- ============================================================================

CREATE TABLE IF NOT EXISTS error_boundaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  type TEXT CHECK (type IN ('try-catch', 'error-boundary', 'middleware', 'global')),
  catches TEXT,  -- JSON array of caught error types
  rethrows INTEGER DEFAULT 0,
  logs INTEGER DEFAULT 0,
  swallows INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS error_handling_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  function_id TEXT,
  gap_type TEXT CHECK (gap_type IN ('unhandled', 'swallowed', 'generic-catch', 'missing-finally')),
  severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description TEXT
);

-- ============================================================================
-- WRAPPER DETECTION
-- ============================================================================

CREATE TABLE IF NOT EXISTS wrappers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  category TEXT CHECK (category IN (
    'state-management', 'data-fetching', 'side-effects', 'authentication',
    'authorization', 'validation', 'dependency-injection', 'middleware',
    'testing', 'logging', 'caching', 'error-handling', 'async-utilities',
    'form-handling', 'routing', 'factory', 'decorator', 'utility', 'other'
  )),
  wraps TEXT,  -- What it wraps (e.g., 'useState', 'fetch')
  confidence REAL DEFAULT 0.0,
  usage_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wrapper_clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_name TEXT NOT NULL,
  category TEXT,
  wrapper_ids TEXT NOT NULL,  -- JSON array
  confidence REAL DEFAULT 0.0,
  pattern_description TEXT
);

-- ============================================================================
-- QUALITY GATES
-- ============================================================================

CREATE TABLE IF NOT EXISTS quality_gate_runs (
  id TEXT PRIMARY KEY,
  branch TEXT,
  base_branch TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'passed', 'failed')),
  gates_run TEXT,  -- JSON array of gate names
  results TEXT,    -- JSON blob of gate results
  policy TEXT
);

CREATE TABLE IF NOT EXISTS quality_gate_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch TEXT NOT NULL,
  snapshot_at TEXT NOT NULL,
  health_score INTEGER,
  pattern_count INTEGER,
  violation_count INTEGER,
  data TEXT  -- JSON blob
);

-- ============================================================================
-- LEARNING DATA
-- ============================================================================

CREATE TABLE IF NOT EXISTS learned_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  detector_id TEXT NOT NULL,
  pattern_signature TEXT NOT NULL,
  occurrences INTEGER DEFAULT 1,
  confidence REAL DEFAULT 0.0,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  auto_approved INTEGER DEFAULT 0,
  
  UNIQUE(detector_id, pattern_signature)
);

-- ============================================================================
-- SYNC LOG (for cloud sync)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  synced INTEGER DEFAULT 0
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Patterns
CREATE INDEX IF NOT EXISTS idx_patterns_category ON patterns(category);
CREATE INDEX IF NOT EXISTS idx_patterns_status ON patterns(status);
CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence_score);
CREATE INDEX IF NOT EXISTS idx_patterns_severity ON patterns(severity);
CREATE INDEX IF NOT EXISTS idx_pattern_locations_file ON pattern_locations(file);
CREATE INDEX IF NOT EXISTS idx_pattern_locations_pattern ON pattern_locations(pattern_id);
CREATE INDEX IF NOT EXISTS idx_pattern_locations_outlier ON pattern_locations(is_outlier);
CREATE INDEX IF NOT EXISTS idx_pattern_examples_pattern ON pattern_examples(pattern_id);

-- Contracts
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_endpoint ON contracts(normalized_endpoint);
CREATE INDEX IF NOT EXISTS idx_contracts_method ON contracts(method);
CREATE INDEX IF NOT EXISTS idx_contract_frontends_contract ON contract_frontends(contract_id);

-- Constraints
CREATE INDEX IF NOT EXISTS idx_constraints_category ON constraints(category);
CREATE INDEX IF NOT EXISTS idx_constraints_status ON constraints(status);
CREATE INDEX IF NOT EXISTS idx_constraints_language ON constraints(language);

-- Boundaries
CREATE INDEX IF NOT EXISTS idx_data_models_table ON data_models(table_name);
CREATE INDEX IF NOT EXISTS idx_data_access_table ON data_access_points(table_name);
CREATE INDEX IF NOT EXISTS idx_data_access_file ON data_access_points(file);
CREATE INDEX IF NOT EXISTS idx_sensitive_fields_table ON sensitive_fields(table_name);

-- Environment
CREATE INDEX IF NOT EXISTS idx_env_access_var ON env_access_points(var_name);
CREATE INDEX IF NOT EXISTS idx_env_access_file ON env_access_points(file);
CREATE INDEX IF NOT EXISTS idx_env_variables_sensitivity ON env_variables(sensitivity);

-- Call Graph
CREATE INDEX IF NOT EXISTS idx_functions_file ON functions(file);
CREATE INDEX IF NOT EXISTS idx_functions_name ON functions(name);
CREATE INDEX IF NOT EXISTS idx_functions_entry_point ON functions(is_entry_point);
CREATE INDEX IF NOT EXISTS idx_function_calls_caller ON function_calls(caller_id);
CREATE INDEX IF NOT EXISTS idx_function_calls_callee ON function_calls(callee_id);
CREATE INDEX IF NOT EXISTS idx_function_data_access_function ON function_data_access(function_id);
CREATE INDEX IF NOT EXISTS idx_function_data_access_table ON function_data_access(table_name);

-- Audit
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_snapshots(date);
CREATE INDEX IF NOT EXISTS idx_pattern_history_date ON pattern_history(date);
CREATE INDEX IF NOT EXISTS idx_pattern_history_pattern ON pattern_history(pattern_id);
CREATE INDEX IF NOT EXISTS idx_health_trends_date ON health_trends(date);
CREATE INDEX IF NOT EXISTS idx_scan_history_date ON scan_history(started_at);

-- DNA
CREATE INDEX IF NOT EXISTS idx_dna_mutations_gene ON dna_mutations(gene_id);

-- Test Topology
CREATE INDEX IF NOT EXISTS idx_test_coverage_test ON test_coverage(test_file);
CREATE INDEX IF NOT EXISTS idx_test_coverage_source ON test_coverage(source_file);

-- Constants
CREATE INDEX IF NOT EXISTS idx_constants_category ON constants(category);
CREATE INDEX IF NOT EXISTS idx_constants_file ON constants(file);
CREATE INDEX IF NOT EXISTS idx_constant_usages_constant ON constant_usages(constant_id);

-- Decisions
CREATE INDEX IF NOT EXISTS idx_decisions_category ON decisions(category);
CREATE INDEX IF NOT EXISTS idx_decisions_date ON decisions(commit_date);

-- Coupling
CREATE INDEX IF NOT EXISTS idx_module_coupling_source ON module_coupling(source_module);
CREATE INDEX IF NOT EXISTS idx_module_coupling_target ON module_coupling(target_module);

-- Error Handling
CREATE INDEX IF NOT EXISTS idx_error_boundaries_file ON error_boundaries(file);
CREATE INDEX IF NOT EXISTS idx_error_gaps_severity ON error_handling_gaps(severity);
CREATE INDEX IF NOT EXISTS idx_error_gaps_file ON error_handling_gaps(file);

-- Wrappers
CREATE INDEX IF NOT EXISTS idx_wrappers_category ON wrappers(category);
CREATE INDEX IF NOT EXISTS idx_wrappers_file ON wrappers(file);

-- Quality Gates
CREATE INDEX IF NOT EXISTS idx_quality_gate_runs_branch ON quality_gate_runs(branch);
CREATE INDEX IF NOT EXISTS idx_quality_gate_snapshots_branch ON quality_gate_snapshots(branch);

-- Sync Log
CREATE INDEX IF NOT EXISTS idx_sync_log_synced ON sync_log(synced);
CREATE INDEX IF NOT EXISTS idx_sync_log_table ON sync_log(table_name);

-- ============================================================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- ============================================================================

-- Update pattern location counts
CREATE TRIGGER IF NOT EXISTS update_pattern_location_count_insert
AFTER INSERT ON pattern_locations
BEGIN
  UPDATE patterns SET 
    location_count = (SELECT COUNT(*) FROM pattern_locations WHERE pattern_id = NEW.pattern_id AND is_outlier = 0),
    outlier_count = (SELECT COUNT(*) FROM pattern_locations WHERE pattern_id = NEW.pattern_id AND is_outlier = 1)
  WHERE id = NEW.pattern_id;
END;

CREATE TRIGGER IF NOT EXISTS update_pattern_location_count_delete
AFTER DELETE ON pattern_locations
BEGIN
  UPDATE patterns SET 
    location_count = (SELECT COUNT(*) FROM pattern_locations WHERE pattern_id = OLD.pattern_id AND is_outlier = 0),
    outlier_count = (SELECT COUNT(*) FROM pattern_locations WHERE pattern_id = OLD.pattern_id AND is_outlier = 1)
  WHERE id = OLD.pattern_id;
END;

CREATE TRIGGER IF NOT EXISTS update_pattern_location_count_update
AFTER UPDATE OF is_outlier ON pattern_locations
BEGIN
  UPDATE patterns SET 
    location_count = (SELECT COUNT(*) FROM pattern_locations WHERE pattern_id = NEW.pattern_id AND is_outlier = 0),
    outlier_count = (SELECT COUNT(*) FROM pattern_locations WHERE pattern_id = NEW.pattern_id AND is_outlier = 1)
  WHERE id = NEW.pattern_id;
END;

-- Sync log triggers for patterns
CREATE TRIGGER IF NOT EXISTS log_pattern_insert
AFTER INSERT ON patterns
BEGIN
  INSERT INTO sync_log (table_name, row_id, operation) 
  VALUES ('patterns', NEW.id, 'INSERT');
END;

CREATE TRIGGER IF NOT EXISTS log_pattern_update
AFTER UPDATE ON patterns
BEGIN
  INSERT INTO sync_log (table_name, row_id, operation) 
  VALUES ('patterns', NEW.id, 'UPDATE');
END;

CREATE TRIGGER IF NOT EXISTS log_pattern_delete
AFTER DELETE ON patterns
BEGIN
  INSERT INTO sync_log (table_name, row_id, operation) 
  VALUES ('patterns', OLD.id, 'DELETE');
END;

-- Sync log triggers for constraints
CREATE TRIGGER IF NOT EXISTS log_constraint_insert
AFTER INSERT ON constraints
BEGIN
  INSERT INTO sync_log (table_name, row_id, operation) 
  VALUES ('constraints', NEW.id, 'INSERT');
END;

CREATE TRIGGER IF NOT EXISTS log_constraint_update
AFTER UPDATE ON constraints
BEGIN
  INSERT INTO sync_log (table_name, row_id, operation) 
  VALUES ('constraints', NEW.id, 'UPDATE');
END;

CREATE TRIGGER IF NOT EXISTS log_constraint_delete
AFTER DELETE ON constraints
BEGIN
  INSERT INTO sync_log (table_name, row_id, operation) 
  VALUES ('constraints', OLD.id, 'DELETE');
END;

-- Sync log triggers for contracts
CREATE TRIGGER IF NOT EXISTS log_contract_insert
AFTER INSERT ON contracts
BEGIN
  INSERT INTO sync_log (table_name, row_id, operation) 
  VALUES ('contracts', NEW.id, 'INSERT');
END;

CREATE TRIGGER IF NOT EXISTS log_contract_update
AFTER UPDATE ON contracts
BEGIN
  INSERT INTO sync_log (table_name, row_id, operation) 
  VALUES ('contracts', NEW.id, 'UPDATE');
END;

CREATE TRIGGER IF NOT EXISTS log_contract_delete
AFTER DELETE ON contracts
BEGIN
  INSERT INTO sync_log (table_name, row_id, operation) 
  VALUES ('contracts', OLD.id, 'DELETE');
END;

-- ============================================================================
-- VIEWS FOR BACKWARD COMPATIBILITY
-- ============================================================================

-- Status view (replaces views/status.json)
CREATE VIEW IF NOT EXISTS v_status AS
SELECT 
  (SELECT COUNT(*) FROM patterns) as total_patterns,
  (SELECT COUNT(*) FROM patterns WHERE status = 'approved') as approved,
  (SELECT COUNT(*) FROM patterns WHERE status = 'discovered') as discovered,
  (SELECT COUNT(*) FROM patterns WHERE status = 'ignored') as ignored,
  (SELECT health_score FROM audit_snapshots ORDER BY date DESC LIMIT 1) as health_score,
  (SELECT AVG(confidence_score) FROM patterns) as avg_confidence;

-- Pattern index view (replaces views/pattern-index.json)
CREATE VIEW IF NOT EXISTS v_pattern_index AS
SELECT 
  id,
  name,
  category,
  subcategory,
  status,
  confidence_score,
  confidence_level,
  location_count,
  outlier_count,
  severity
FROM patterns
ORDER BY confidence_score DESC;

-- Category counts view (replaces indexes/by-category.json)
CREATE VIEW IF NOT EXISTS v_category_counts AS
SELECT 
  category,
  COUNT(*) as count,
  SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
  SUM(CASE WHEN status = 'discovered' THEN 1 ELSE 0 END) as discovered,
  AVG(confidence_score) as avg_confidence
FROM patterns
GROUP BY category;

-- File patterns view (replaces indexes/by-file.json)
CREATE VIEW IF NOT EXISTS v_file_patterns AS
SELECT 
  pl.file,
  COUNT(DISTINCT pl.pattern_id) as pattern_count,
  GROUP_CONCAT(DISTINCT p.category) as categories
FROM pattern_locations pl
JOIN patterns p ON pl.pattern_id = p.id
GROUP BY pl.file;

-- Security summary view (replaces views/security-summary.json)
CREATE VIEW IF NOT EXISTS v_security_summary AS
SELECT 
  (SELECT COUNT(DISTINCT table_name) FROM data_models) as total_tables,
  (SELECT COUNT(DISTINCT table_name) FROM sensitive_fields) as sensitive_tables,
  (SELECT COUNT(*) FROM data_access_points) as total_access_points,
  (SELECT COUNT(*) FROM data_access_points 
   WHERE table_name IN (SELECT table_name FROM sensitive_fields)) as sensitive_access_count;

-- ============================================================================
-- SCHEMA VERSION
-- ============================================================================

-- Insert schema version if not exists
INSERT OR IGNORE INTO project (id, name, root_path, drift_version, schema_version)
VALUES ('schema_version', 'Drift Schema', '.', '2.0.0', 1);
