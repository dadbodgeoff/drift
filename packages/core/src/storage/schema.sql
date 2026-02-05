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
-- IEC 61131-3 CODE FACTORY TABLES
-- ============================================================================
-- Enterprise-grade analysis for industrial automation code.
-- Stores POUs, state machines, safety interlocks, tribal knowledge, and migration scores.
-- ============================================================================

-- ST Files (Structured Text source files)
CREATE TABLE IF NOT EXISTS st_files (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  vendor TEXT,
  language TEXT DEFAULT 'st',
  line_count INTEGER,
  hash TEXT NOT NULL,
  parsed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Program Organization Units (POUs)
CREATE TABLE IF NOT EXISTS st_pous (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES st_files(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('PROGRAM', 'FUNCTION_BLOCK', 'FUNCTION', 'CLASS', 'INTERFACE')),
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  extends TEXT,
  implements JSON,
  vendor_attributes JSON,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ST Variables
CREATE TABLE IF NOT EXISTS st_variables (
  id TEXT PRIMARY KEY,
  pou_id TEXT REFERENCES st_pous(id) ON DELETE CASCADE,
  file_id TEXT REFERENCES st_files(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK(section IN ('VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR', 'VAR_GLOBAL', 'VAR_TEMP', 'VAR_CONSTANT', 'VAR_EXTERNAL')),
  name TEXT NOT NULL,
  data_type TEXT NOT NULL,
  initial_value TEXT,
  is_array INTEGER DEFAULT 0,
  array_bounds JSON,
  comment TEXT,
  line_number INTEGER,
  is_safety_critical INTEGER DEFAULT 0,
  io_address TEXT
);

-- ST Docstrings (Documentation extracted from comments)
CREATE TABLE IF NOT EXISTS st_docstrings (
  id TEXT PRIMARY KEY,
  pou_id TEXT REFERENCES st_pous(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES st_files(id) ON DELETE CASCADE,
  summary TEXT,
  description TEXT,
  raw_text TEXT,
  author TEXT,
  date TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  associated_block TEXT,
  associated_block_type TEXT,
  quality_score REAL DEFAULT 0.0,
  extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Docstring parameters
CREATE TABLE IF NOT EXISTS st_doc_params (
  id TEXT PRIMARY KEY,
  docstring_id TEXT NOT NULL REFERENCES st_docstrings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  param_type TEXT,
  direction TEXT CHECK(direction IN ('in', 'out', 'inout'))
);

-- Docstring history entries
CREATE TABLE IF NOT EXISTS st_doc_history (
  id TEXT PRIMARY KEY,
  docstring_id TEXT NOT NULL REFERENCES st_docstrings(id) ON DELETE CASCADE,
  date TEXT,
  author TEXT,
  description TEXT NOT NULL
);

-- State machines
CREATE TABLE IF NOT EXISTS st_state_machines (
  id TEXT PRIMARY KEY,
  pou_id TEXT NOT NULL REFERENCES st_pous(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  state_variable TEXT NOT NULL,
  state_variable_type TEXT,
  state_count INTEGER NOT NULL,
  has_deadlocks INTEGER DEFAULT 0,
  has_gaps INTEGER DEFAULT 0,
  unreachable_states JSON,
  gap_values JSON,
  mermaid_diagram TEXT,
  ascii_diagram TEXT,
  plantuml_diagram TEXT,
  start_line INTEGER,
  end_line INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- State machine states
CREATE TABLE IF NOT EXISTS st_sm_states (
  id TEXT PRIMARY KEY,
  state_machine_id TEXT NOT NULL REFERENCES st_state_machines(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  name TEXT,
  documentation TEXT,
  is_initial INTEGER DEFAULT 0,
  is_final INTEGER DEFAULT 0,
  actions JSON,
  line_number INTEGER
);

-- State machine transitions
CREATE TABLE IF NOT EXISTS st_sm_transitions (
  id TEXT PRIMARY KEY,
  state_machine_id TEXT NOT NULL REFERENCES st_state_machines(id) ON DELETE CASCADE,
  from_state_id TEXT NOT NULL REFERENCES st_sm_states(id) ON DELETE CASCADE,
  to_state_id TEXT NOT NULL REFERENCES st_sm_states(id) ON DELETE CASCADE,
  guard_condition TEXT,
  actions JSON,
  documentation TEXT,
  line_number INTEGER
);

-- Safety interlocks
CREATE TABLE IF NOT EXISTS st_safety_interlocks (
  id TEXT PRIMARY KEY,
  pou_id TEXT REFERENCES st_pous(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES st_files(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('interlock', 'estop', 'permissive', 'safety-relay', 'safety-device', 'bypass')),
  line_number INTEGER,
  is_bypassed INTEGER DEFAULT 0,
  bypass_condition TEXT,
  confidence REAL DEFAULT 0.0,
  severity TEXT CHECK(severity IN ('critical', 'high', 'medium', 'low')),
  related_interlocks JSON
);

-- Safety bypasses (CRITICAL - must track all bypasses)
CREATE TABLE IF NOT EXISTS st_safety_bypasses (
  id TEXT PRIMARY KEY,
  pou_id TEXT REFERENCES st_pous(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES st_files(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  line_number INTEGER,
  affected_interlocks JSON,
  condition TEXT,
  severity TEXT CHECK(severity IN ('critical', 'high', 'medium', 'low')),
  detected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Safety critical warnings
CREATE TABLE IF NOT EXISTS st_safety_warnings (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES st_files(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('bypass-detected', 'unprotected-output', 'missing-estop', 'interlock-gap')),
  message TEXT NOT NULL,
  severity TEXT CHECK(severity IN ('critical', 'high', 'medium', 'low')),
  line_number INTEGER,
  remediation TEXT
);

-- Tribal knowledge
CREATE TABLE IF NOT EXISTS st_tribal_knowledge (
  id TEXT PRIMARY KEY,
  pou_id TEXT REFERENCES st_pous(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES st_files(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('warning', 'caution', 'danger', 'note', 'todo', 'fixme', 'hack', 'workaround', 'do-not-change', 'magic-number', 'history', 'author', 'equipment', 'mystery')),
  content TEXT NOT NULL,
  context TEXT,
  line_number INTEGER,
  importance TEXT CHECK(importance IN ('critical', 'high', 'medium', 'low')),
  extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- I/O mappings
CREATE TABLE IF NOT EXISTS st_io_mappings (
  id TEXT PRIMARY KEY,
  pou_id TEXT REFERENCES st_pous(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES st_files(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  address_type TEXT NOT NULL CHECK(address_type IN ('IX', 'QX', 'IW', 'QW', 'ID', 'QD', 'IB', 'QB', 'MW', 'MD', 'MB')),
  variable_name TEXT,
  description TEXT,
  line_number INTEGER,
  is_input INTEGER DEFAULT 1,
  bit_size INTEGER DEFAULT 1
);

-- ST Call graph edges
CREATE TABLE IF NOT EXISTS st_call_graph (
  id TEXT PRIMARY KEY,
  caller_pou_id TEXT NOT NULL REFERENCES st_pous(id) ON DELETE CASCADE,
  callee_pou_id TEXT REFERENCES st_pous(id) ON DELETE SET NULL,
  callee_name TEXT NOT NULL,
  call_type TEXT NOT NULL CHECK(call_type IN ('instantiation', 'method_call', 'function_call')),
  line_number INTEGER,
  arguments JSON
);

-- Migration scores
CREATE TABLE IF NOT EXISTS st_migration_scores (
  id TEXT PRIMARY KEY,
  pou_id TEXT NOT NULL REFERENCES st_pous(id) ON DELETE CASCADE,
  overall_score REAL NOT NULL,
  documentation_score REAL,
  safety_score REAL,
  complexity_score REAL,
  dependencies_score REAL,
  testability_score REAL,
  grade TEXT CHECK(grade IN ('A', 'B', 'C', 'D', 'F')),
  blockers JSON,
  warnings JSON,
  suggestions JSON,
  calculated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI Context exports
CREATE TABLE IF NOT EXISTS st_ai_contexts (
  id TEXT PRIMARY KEY,
  target_language TEXT NOT NULL,
  context_json TEXT NOT NULL,
  token_estimate INTEGER,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Analysis runs for ST files
CREATE TABLE IF NOT EXISTS st_analysis_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
  files_analyzed INTEGER DEFAULT 0,
  pous_found INTEGER DEFAULT 0,
  state_machines_found INTEGER DEFAULT 0,
  interlocks_found INTEGER DEFAULT 0,
  bypasses_found INTEGER DEFAULT 0,
  tribal_knowledge_found INTEGER DEFAULT 0,
  errors JSON,
  summary JSON
);

-- ============================================================================
-- IEC 61131-3 INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_st_files_path ON st_files(path);
CREATE INDEX IF NOT EXISTS idx_st_pous_file ON st_pous(file_id);
CREATE INDEX IF NOT EXISTS idx_st_pous_type ON st_pous(type);
CREATE INDEX IF NOT EXISTS idx_st_pous_name ON st_pous(name);
CREATE INDEX IF NOT EXISTS idx_st_variables_pou ON st_variables(pou_id);
CREATE INDEX IF NOT EXISTS idx_st_variables_safety ON st_variables(is_safety_critical);
CREATE INDEX IF NOT EXISTS idx_st_variables_io ON st_variables(io_address);
CREATE INDEX IF NOT EXISTS idx_st_docstrings_pou ON st_docstrings(pou_id);
CREATE INDEX IF NOT EXISTS idx_st_docstrings_file ON st_docstrings(file_id);
CREATE INDEX IF NOT EXISTS idx_st_state_machines_pou ON st_state_machines(pou_id);
CREATE INDEX IF NOT EXISTS idx_st_sm_states_machine ON st_sm_states(state_machine_id);
CREATE INDEX IF NOT EXISTS idx_st_sm_transitions_machine ON st_sm_transitions(state_machine_id);
CREATE INDEX IF NOT EXISTS idx_st_safety_interlocks_type ON st_safety_interlocks(type);
CREATE INDEX IF NOT EXISTS idx_st_safety_interlocks_bypassed ON st_safety_interlocks(is_bypassed);
CREATE INDEX IF NOT EXISTS idx_st_safety_interlocks_pou ON st_safety_interlocks(pou_id);
CREATE INDEX IF NOT EXISTS idx_st_safety_bypasses_pou ON st_safety_bypasses(pou_id);
CREATE INDEX IF NOT EXISTS idx_st_tribal_knowledge_type ON st_tribal_knowledge(type);
CREATE INDEX IF NOT EXISTS idx_st_tribal_knowledge_importance ON st_tribal_knowledge(importance);
CREATE INDEX IF NOT EXISTS idx_st_tribal_knowledge_pou ON st_tribal_knowledge(pou_id);
CREATE INDEX IF NOT EXISTS idx_st_io_mappings_address ON st_io_mappings(address);
CREATE INDEX IF NOT EXISTS idx_st_io_mappings_pou ON st_io_mappings(pou_id);
CREATE INDEX IF NOT EXISTS idx_st_call_graph_caller ON st_call_graph(caller_pou_id);
CREATE INDEX IF NOT EXISTS idx_st_call_graph_callee ON st_call_graph(callee_pou_id);
CREATE INDEX IF NOT EXISTS idx_st_migration_scores_grade ON st_migration_scores(grade);
CREATE INDEX IF NOT EXISTS idx_st_migration_scores_pou ON st_migration_scores(pou_id);

-- ============================================================================
-- IEC 61131-3 VIEWS
-- ============================================================================

-- ST Project status view
CREATE VIEW IF NOT EXISTS v_st_status AS
SELECT 
  (SELECT COUNT(*) FROM st_files) as total_files,
  (SELECT COUNT(*) FROM st_pous) as total_pous,
  (SELECT COUNT(*) FROM st_pous WHERE type = 'PROGRAM') as programs,
  (SELECT COUNT(*) FROM st_pous WHERE type = 'FUNCTION_BLOCK') as function_blocks,
  (SELECT COUNT(*) FROM st_pous WHERE type = 'FUNCTION') as functions,
  (SELECT COUNT(*) FROM st_state_machines) as state_machines,
  (SELECT COUNT(*) FROM st_safety_interlocks) as safety_interlocks,
  (SELECT COUNT(*) FROM st_safety_bypasses) as safety_bypasses,
  (SELECT COUNT(*) FROM st_tribal_knowledge) as tribal_knowledge,
  (SELECT COUNT(*) FROM st_docstrings) as docstrings,
  (SELECT AVG(overall_score) FROM st_migration_scores) as avg_migration_score;

-- Safety summary view
CREATE VIEW IF NOT EXISTS v_st_safety_summary AS
SELECT 
  (SELECT COUNT(*) FROM st_safety_interlocks WHERE type = 'interlock') as interlocks,
  (SELECT COUNT(*) FROM st_safety_interlocks WHERE type = 'estop') as estops,
  (SELECT COUNT(*) FROM st_safety_interlocks WHERE type = 'permissive') as permissives,
  (SELECT COUNT(*) FROM st_safety_interlocks WHERE type = 'safety-relay') as safety_relays,
  (SELECT COUNT(*) FROM st_safety_interlocks WHERE type = 'safety-device') as safety_devices,
  (SELECT COUNT(*) FROM st_safety_bypasses) as bypasses,
  (SELECT COUNT(*) FROM st_safety_warnings WHERE severity = 'critical') as critical_warnings;

-- Migration readiness view
CREATE VIEW IF NOT EXISTS v_st_migration_readiness AS
SELECT 
  p.id as pou_id,
  p.name as pou_name,
  p.type as pou_type,
  m.overall_score,
  m.grade,
  m.documentation_score,
  m.safety_score,
  m.complexity_score,
  m.dependencies_score,
  m.testability_score
FROM st_pous p
LEFT JOIN st_migration_scores m ON p.id = m.pou_id
ORDER BY m.overall_score DESC;

-- ============================================================================
-- IEC 61131-3 FULL-TEXT SEARCH
-- ============================================================================

CREATE VIRTUAL TABLE IF NOT EXISTS fts_st_docstrings USING fts5(
  pou_id,
  summary,
  description,
  raw_text,
  content='st_docstrings',
  content_rowid='rowid'
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_st_tribal_knowledge USING fts5(
  pou_id,
  type,
  content,
  context,
  content='st_tribal_knowledge',
  content_rowid='rowid'
);

-- ============================================================================
-- SCHEMA VERSION
-- ============================================================================

-- Insert schema version if not exists
INSERT OR IGNORE INTO project (id, name, root_path, drift_version, schema_version)
VALUES ('schema_version', 'Drift Schema', '.', '2.0.0', 1);
