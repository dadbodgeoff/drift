-- ============================================================================
-- IEC 61131-3 Docstring Storage Schema
-- 
-- This schema stores extracted documentation from industrial automation code.
-- It's a new extraction type for drift - capturing institutional knowledge
-- from legacy PLC codebases.
-- ============================================================================

-- ============================================================================
-- DOCSTRINGS (Primary extraction - PhD's request)
-- ============================================================================

CREATE TABLE IF NOT EXISTS st_docstrings (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  
  -- Content
  summary TEXT,
  description TEXT,
  raw TEXT,  -- Original comment text
  
  -- Associated code block
  associated_block TEXT,  -- PROGRAM/FUNCTION_BLOCK/FUNCTION name
  block_type TEXT CHECK (block_type IN ('PROGRAM', 'FUNCTION_BLOCK', 'FUNCTION')),
  
  -- Structured data (JSON)
  params TEXT,      -- JSON array of {name, type, description}
  returns TEXT,     -- Return value description
  author TEXT,
  date TEXT,
  history TEXT,     -- JSON array of {year, author, description}
  warnings TEXT,    -- JSON array of warning strings
  tags TEXT,        -- JSON array of custom tags
  
  -- Metadata
  language TEXT DEFAULT 'structured-text',
  confidence REAL DEFAULT 1.0,
  extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(file, line)
);

-- ============================================================================
-- STATE MACHINES
-- ============================================================================

CREATE TABLE IF NOT EXISTS st_state_machines (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  
  -- State machine info
  variable TEXT NOT NULL,  -- e.g., nState, iStep
  state_count INTEGER NOT NULL,
  states TEXT NOT NULL,    -- JSON array of {value, line, label, hasComment}
  
  -- Associated block
  parent_block TEXT,
  
  -- Metadata
  extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(file, line, variable)
);

-- ============================================================================
-- SAFETY INTERLOCKS
-- ============================================================================

CREATE TABLE IF NOT EXISTS st_safety_interlocks (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  
  -- Interlock info
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('interlock', 'permissive', 'estop', 'bypass')),
  is_bypassed INTEGER DEFAULT 0,
  
  -- Context
  parent_block TEXT,
  context TEXT,  -- Surrounding code
  
  -- Metadata
  severity TEXT DEFAULT 'info' CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(file, name)
);

-- ============================================================================
-- TRIBAL KNOWLEDGE
-- ============================================================================

CREATE TABLE IF NOT EXISTS st_tribal_knowledge (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  
  -- Knowledge item
  type TEXT NOT NULL CHECK (type IN (
    'warning', 'caution', 'note', 'todo', 'hack', 'workaround',
    'do-not-change', 'magic-number', 'history', 'author', 'equipment'
  )),
  content TEXT NOT NULL,
  context TEXT,  -- Surrounding code
  
  -- Metadata
  importance TEXT DEFAULT 'medium' CHECK (importance IN ('critical', 'high', 'medium', 'low')),
  extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- PLC BLOCKS (PROGRAM, FUNCTION_BLOCK, FUNCTION)
-- ============================================================================

CREATE TABLE IF NOT EXISTS st_blocks (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  end_line INTEGER,
  
  -- Block info
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('PROGRAM', 'FUNCTION_BLOCK', 'FUNCTION')),
  
  -- Variables (JSON arrays)
  var_input TEXT,
  var_output TEXT,
  var_in_out TEXT,
  var_local TEXT,
  var_temp TEXT,
  
  -- Metadata
  has_docstring INTEGER DEFAULT 0,
  docstring_id TEXT REFERENCES st_docstrings(id),
  extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(file, name)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_st_docstrings_file ON st_docstrings(file);
CREATE INDEX IF NOT EXISTS idx_st_docstrings_block ON st_docstrings(associated_block);
CREATE INDEX IF NOT EXISTS idx_st_state_machines_file ON st_state_machines(file);
CREATE INDEX IF NOT EXISTS idx_st_state_machines_variable ON st_state_machines(variable);
CREATE INDEX IF NOT EXISTS idx_st_safety_file ON st_safety_interlocks(file);
CREATE INDEX IF NOT EXISTS idx_st_safety_type ON st_safety_interlocks(type);
CREATE INDEX IF NOT EXISTS idx_st_safety_bypassed ON st_safety_interlocks(is_bypassed);
CREATE INDEX IF NOT EXISTS idx_st_tribal_file ON st_tribal_knowledge(file);
CREATE INDEX IF NOT EXISTS idx_st_tribal_type ON st_tribal_knowledge(type);
CREATE INDEX IF NOT EXISTS idx_st_blocks_file ON st_blocks(file);
CREATE INDEX IF NOT EXISTS idx_st_blocks_type ON st_blocks(type);

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Summary view for IEC 61131-3 analysis
CREATE VIEW IF NOT EXISTS v_st_summary AS
SELECT 
  (SELECT COUNT(*) FROM st_docstrings) as total_docstrings,
  (SELECT COUNT(*) FROM st_state_machines) as total_state_machines,
  (SELECT COUNT(*) FROM st_safety_interlocks) as total_interlocks,
  (SELECT COUNT(*) FROM st_safety_interlocks WHERE is_bypassed = 1) as bypassed_interlocks,
  (SELECT COUNT(*) FROM st_tribal_knowledge) as total_tribal_knowledge,
  (SELECT COUNT(*) FROM st_blocks) as total_blocks;

-- Docstrings with their blocks
CREATE VIEW IF NOT EXISTS v_st_documented_blocks AS
SELECT 
  b.name as block_name,
  b.type as block_type,
  b.file,
  b.line as block_line,
  d.summary,
  d.params,
  d.history,
  d.warnings
FROM st_blocks b
LEFT JOIN st_docstrings d ON b.docstring_id = d.id
ORDER BY b.file, b.line;

-- Safety overview
CREATE VIEW IF NOT EXISTS v_st_safety_overview AS
SELECT 
  type,
  COUNT(*) as count,
  SUM(CASE WHEN is_bypassed = 1 THEN 1 ELSE 0 END) as bypassed_count
FROM st_safety_interlocks
GROUP BY type;
