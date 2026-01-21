/**
 * Data Boundaries Types
 * 
 * Types for tracking which code accesses which database tables/fields,
 * and optionally enforcing access boundaries.
 */

// ============================================================================
// Access Map Types (Discovery)
// ============================================================================

/**
 * Operation type for data access
 */
export type DataOperation = 'read' | 'write' | 'delete' | 'unknown';

/**
 * Sensitivity classification for fields
 */
export type SensitivityType = 'pii' | 'credentials' | 'financial' | 'health' | 'unknown';

/**
 * ORM framework identifier
 */
export type ORMFramework = 
  | 'efcore' 
  | 'django' 
  | 'sqlalchemy' 
  | 'prisma' 
  | 'typeorm' 
  | 'sequelize'
  | 'drizzle'
  | 'knex'
  | 'unknown';

/**
 * A detected ORM model/entity
 */
export interface ORMModel {
  /** Model/class name (e.g., "User") */
  name: string;
  /** Mapped table name if detectable (e.g., "users") */
  tableName: string | null;
  /** Known fields/columns */
  fields: string[];
  /** Source file */
  file: string;
  /** Line number of definition */
  line: number;
  /** Detected ORM framework */
  framework: ORMFramework;
  /** Detection confidence */
  confidence: number;
}

/**
 * A sensitive field detection
 */
export interface SensitiveField {
  /** Field/column name */
  field: string;
  /** Table name if known */
  table: string | null;
  /** Sensitivity classification */
  sensitivityType: SensitivityType;
  /** Source file where detected */
  file: string;
  /** Line number */
  line: number;
  /** Detection confidence */
  confidence: number;
}

/**
 * A data access point in code
 */
export interface DataAccessPoint {
  /** Unique identifier */
  id: string;
  /** Table/model being accessed */
  table: string;
  /** Fields accessed (if detectable) */
  fields: string[];
  /** Type of operation */
  operation: DataOperation;
  /** Source file */
  file: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Surrounding code context */
  context: string;
  /** Whether this is raw SQL vs ORM */
  isRawSql: boolean;
  /** Detection confidence */
  confidence: number;
}

/**
 * Table access information
 */
export interface TableAccessInfo {
  /** Table name */
  name: string;
  /** Associated ORM model if known */
  model: string | null;
  /** Known fields */
  fields: string[];
  /** Sensitive fields in this table */
  sensitiveFields: SensitiveField[];
  /** All access points to this table */
  accessedBy: DataAccessPoint[];
}

/**
 * File access information
 */
export interface FileAccessInfo {
  /** File path */
  file: string;
  /** Tables accessed from this file */
  tables: string[];
  /** All access points in this file */
  accessPoints: DataAccessPoint[];
}

/**
 * Complete data access map
 */
export interface DataAccessMap {
  /** Schema version */
  version: '1.0';
  /** Generation timestamp */
  generatedAt: string;
  /** Project root */
  projectRoot: string;
  
  /** Discovered ORM models */
  models: ORMModel[];
  
  /** Table-centric access information */
  tables: Record<string, TableAccessInfo>;
  
  /** All access points indexed by ID */
  accessPoints: Record<string, DataAccessPoint>;
  
  /** Detected sensitive fields */
  sensitiveFields: SensitiveField[];
  
  /** Statistics */
  stats: {
    totalTables: number;
    totalAccessPoints: number;
    totalSensitiveFields: number;
    totalModels: number;
  };
}

// ============================================================================
// Boundary Rules Types (Enforcement - Opt-in)
// ============================================================================

/**
 * Severity level for boundary violations
 */
export type BoundarySeverity = 'error' | 'warning' | 'info';

/**
 * A boundary rule definition
 */
export interface BoundaryRule {
  /** Unique rule identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Field-level restrictions (e.g., ["users.ssn", "users.password_hash"]) */
  fields?: string[];
  /** Table-level restrictions (e.g., ["audit_logs", "payments"]) */
  tables?: string[];
  /** Operation restrictions */
  operations?: DataOperation[];
  /** Glob patterns for allowed file paths */
  allowedPaths: string[];
  /** Glob patterns for excluded paths (e.g., tests) */
  excludePaths?: string[];
  /** Violation severity */
  severity: BoundarySeverity;
  /** Whether rule is enabled */
  enabled?: boolean;
}

/**
 * Sensitivity tier configuration
 */
export interface SensitivityTiers {
  /** Critical fields - strictest protection */
  critical: string[];
  /** Sensitive fields - moderate protection */
  sensitive: string[];
  /** General fields - no restrictions (default) */
  general: string[];
}

/**
 * Complete boundary rules configuration
 */
export interface BoundaryRules {
  /** Schema version */
  version: '1.0';
  /** Sensitivity tier definitions */
  sensitivity: SensitivityTiers;
  /** Boundary rules */
  boundaries: BoundaryRule[];
  /** Global exclude patterns (e.g., test files) */
  globalExcludes?: string[];
}

/**
 * A boundary violation
 */
export interface BoundaryViolation {
  /** Violation ID */
  id: string;
  /** Rule that was violated */
  ruleId: string;
  /** Rule description */
  ruleDescription: string;
  /** Severity */
  severity: BoundarySeverity;
  /** File where violation occurred */
  file: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Violation message */
  message: string;
  /** Table accessed */
  table: string;
  /** Fields accessed */
  fields: string[];
  /** Operation performed */
  operation: DataOperation;
  /** Suggested fix */
  suggestion?: string;
}

// ============================================================================
// Store Configuration
// ============================================================================

/**
 * BoundaryStore configuration
 */
export interface BoundaryStoreConfig {
  /** Project root directory */
  rootDir: string;
}

/**
 * Boundary scan result
 */
export interface BoundaryScanResult {
  /** Discovered access map */
  accessMap: DataAccessMap;
  /** Violations (if rules defined) */
  violations: BoundaryViolation[];
  /** Scan statistics */
  stats: {
    filesScanned: number;
    tablesFound: number;
    accessPointsFound: number;
    sensitiveFieldsFound: number;
    violationsFound: number;
    scanDurationMs: number;
  };
}
