/**
 * Unified Storage Types
 *
 * Type definitions for the unified SQLite storage layer.
 * These types define the interface between the application and the database.
 *
 * @module storage/types
 */

import type { PatternCategory, PatternStatus, ConfidenceLevel, Severity } from '../store/types.js';

// ============================================================================
// Database Configuration
// ============================================================================

/**
 * Configuration for the unified store
 */
export interface UnifiedStoreConfig {
  /** Root directory of the project */
  rootDir: string;
  /** Database file name (default: drift.db) */
  dbFileName?: string;
  /** Enable WAL mode (default: true) */
  walMode?: boolean;
  /** Enable foreign keys (default: true) */
  foreignKeys?: boolean;
  /** Enable sync logging for cloud sync (default: true) */
  syncLogging?: boolean;
  /** Connection timeout in ms (default: 5000) */
  timeout?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_UNIFIED_STORE_CONFIG: Required<UnifiedStoreConfig> = {
  rootDir: '.',
  dbFileName: 'drift.db',
  walMode: true,
  foreignKeys: true,
  syncLogging: true,
  timeout: 5000,
  verbose: false,
};

// ============================================================================
// Repository Interfaces
// ============================================================================

/**
 * Base repository interface with common operations
 */
export interface IRepository<T, ID = string> {
  /** Create a new entity */
  create(entity: T): Promise<ID>;
  /** Read an entity by ID */
  read(id: ID): Promise<T | null>;
  /** Update an entity */
  update(id: ID, updates: Partial<T>): Promise<void>;
  /** Delete an entity */
  delete(id: ID): Promise<boolean>;
  /** Check if entity exists */
  exists(id: ID): Promise<boolean>;
  /** Count entities */
  count(filter?: Partial<T>): Promise<number>;
}

/**
 * Pattern repository interface
 */
export interface IPatternRepository extends IRepository<DbPattern> {
  // Bulk operations
  bulkCreate(patterns: DbPattern[]): Promise<string[]>;
  bulkUpdate(updates: Array<{ id: string; updates: Partial<DbPattern> }>): Promise<void>;
  
  // Queries
  findByCategory(category: PatternCategory): Promise<DbPattern[]>;
  findByStatus(status: PatternStatus): Promise<DbPattern[]>;
  findByFile(file: string): Promise<DbPattern[]>;
  findByConfidence(min: number, max?: number): Promise<DbPattern[]>;
  search(query: PatternSearchQuery): Promise<DbPattern[]>;
  
  // Aggregations
  countByCategory(): Promise<Record<PatternCategory, number>>;
  countByStatus(): Promise<Record<PatternStatus, number>>;
  
  // State transitions
  approve(id: string, approvedBy?: string): Promise<void>;
  ignore(id: string): Promise<void>;
  
  // Locations
  addLocation(patternId: string, location: DbPatternLocation): Promise<void>;
  removeLocation(patternId: string, file: string, line: number): Promise<void>;
  getLocations(patternId: string): Promise<DbPatternLocation[]>;
  getOutliers(patternId: string): Promise<DbPatternLocation[]>;
  
  // Examples
  addExample(patternId: string, example: DbPatternExample): Promise<void>;
  getExamples(patternId: string, limit?: number): Promise<DbPatternExample[]>;
}

/**
 * Contract repository interface
 */
export interface IContractRepository extends IRepository<DbContract> {
  findByStatus(status: DbContractStatus): Promise<DbContract[]>;
  findByMethod(method: DbHttpMethod): Promise<DbContract[]>;
  findByEndpoint(endpoint: string): Promise<DbContract[]>;
  findWithMismatches(): Promise<DbContract[]>;
  
  verify(id: string, verifiedBy?: string): Promise<void>;
  markMismatch(id: string): Promise<void>;
  ignore(id: string): Promise<void>;
  
  addFrontend(contractId: string, frontend: DbContractFrontend): Promise<void>;
  getFrontends(contractId: string): Promise<DbContractFrontend[]>;
}

/**
 * Constraint repository interface
 */
export interface IConstraintRepository extends IRepository<DbConstraint> {
  findByCategory(category: string): Promise<DbConstraint[]>;
  findByStatus(status: DbConstraintStatus): Promise<DbConstraint[]>;
  findByLanguage(language: string): Promise<DbConstraint[]>;
  findForFile(filePath: string): Promise<DbConstraint[]>;
  
  approve(id: string, approvedBy?: string): Promise<void>;
  ignore(id: string, reason?: string): Promise<void>;
  
  getCounts(): Promise<DbConstraintCounts>;
}

/**
 * Boundary repository interface
 */
export interface IBoundaryRepository {
  // Models
  addModel(model: DbDataModel): Promise<number>;
  getModels(): Promise<DbDataModel[]>;
  getModelByTable(tableName: string): Promise<DbDataModel | null>;
  
  // Sensitive fields
  addSensitiveField(field: DbSensitiveField): Promise<number>;
  getSensitiveFields(tableName?: string): Promise<DbSensitiveField[]>;
  
  // Access points
  addAccessPoint(point: DbDataAccessPoint): Promise<void>;
  getAccessPoints(tableName?: string): Promise<DbDataAccessPoint[]>;
  getAccessPointsByFile(file: string): Promise<DbDataAccessPoint[]>;
  
  // Queries
  getTableAccess(tableName: string): Promise<DbTableAccess>;
  getSensitiveAccess(): Promise<DbSensitiveAccess[]>;
}

/**
 * Environment repository interface
 */
export interface IEnvironmentRepository {
  // Variables
  addVariable(variable: DbEnvVariable): Promise<void>;
  getVariable(name: string): Promise<DbEnvVariable | null>;
  getVariables(sensitivity?: DbEnvSensitivity): Promise<DbEnvVariable[]>;
  getSecrets(): Promise<DbEnvVariable[]>;
  getRequired(): Promise<DbEnvVariable[]>;
  
  // Access points
  addAccessPoint(point: DbEnvAccessPoint): Promise<void>;
  getAccessPoints(varName?: string): Promise<DbEnvAccessPoint[]>;
  getAccessPointsByFile(file: string): Promise<DbEnvAccessPoint[]>;
}

/**
 * Call graph repository interface
 */
export interface ICallGraphRepository {
  // Functions
  addFunction(func: DbFunction): Promise<void>;
  getFunction(id: string): Promise<DbFunction | null>;
  getFunctionByName(name: string, file?: string): Promise<DbFunction | null>;
  getFunctionsByFile(file: string): Promise<DbFunction[]>;
  getEntryPoints(): Promise<DbFunction[]>;
  getDataAccessors(): Promise<DbFunction[]>;
  
  // Calls
  addCall(call: DbFunctionCall): Promise<void>;
  getCallers(functionId: string): Promise<DbFunctionCall[]>;
  getCallees(functionId: string): Promise<DbFunctionCall[]>;
  
  // Data access
  addDataAccess(access: DbFunctionDataAccess): Promise<void>;
  getDataAccess(functionId: string): Promise<DbFunctionDataAccess[]>;
  
  // Analysis
  getCallChain(functionId: string, maxDepth?: number): Promise<DbCallChainNode[]>;
  getReachableTables(functionId: string): Promise<string[]>;
}

/**
 * Audit repository interface
 */
export interface IAuditRepository {
  // Snapshots
  addSnapshot(snapshot: DbAuditSnapshot): Promise<number>;
  getLatestSnapshot(): Promise<DbAuditSnapshot | null>;
  getSnapshot(date: string): Promise<DbAuditSnapshot | null>;
  getSnapshots(startDate?: string, endDate?: string): Promise<DbAuditSnapshot[]>;
  
  // History
  addHistoryEvent(event: DbPatternHistoryEvent): Promise<void>;
  getHistory(patternId: string): Promise<DbPatternHistoryEvent[]>;
  getHistoryByDate(date: string): Promise<DbPatternHistoryEvent[]>;
  
  // Trends
  addTrend(trend: DbHealthTrend): Promise<void>;
  getTrends(days?: number): Promise<DbHealthTrend[]>;
  
  // Scans
  addScan(scan: DbScanHistory): Promise<void>;
  getLatestScan(): Promise<DbScanHistory | null>;
  getScans(limit?: number): Promise<DbScanHistory[]>;
}

/**
 * DNA repository interface
 */
export interface IDNARepository {
  // Profile
  getProfile(): Promise<DbDNAProfile | null>;
  saveProfile(profile: DbDNAProfile): Promise<void>;
  
  // Genes
  addGene(gene: DbDNAGene): Promise<void>;
  getGene(id: string): Promise<DbDNAGene | null>;
  getGenes(): Promise<DbDNAGene[]>;
  
  // Mutations
  addMutation(mutation: DbDNAMutation): Promise<void>;
  getMutations(geneId?: string): Promise<DbDNAMutation[]>;
}

/**
 * Test topology repository interface
 */
export interface ITestTopologyRepository {
  // Test files
  addTestFile(file: DbTestFile): Promise<void>;
  getTestFiles(): Promise<DbTestFile[]>;
  getTestFile(file: string): Promise<DbTestFile | null>;
  
  // Coverage
  addCoverage(coverage: DbTestCoverage): Promise<void>;
  getCoverage(sourceFile: string): Promise<DbTestCoverage[]>;
  getTestsForFile(sourceFile: string): Promise<string[]>;
  getUncoveredFiles(): Promise<string[]>;
}

// ============================================================================
// Database Entity Types
// ============================================================================

/**
 * Pattern entity in database
 */
export interface DbPattern {
  id: string;
  name: string;
  description: string | null;
  category: PatternCategory;
  subcategory: string | null;
  status: PatternStatus;
  
  // Confidence
  confidence_score: number;
  confidence_level: ConfidenceLevel;
  confidence_frequency: number | null;
  confidence_consistency: number | null;
  confidence_age: number | null;
  confidence_spread: number | null;
  
  // Detector
  detector_type: string | null;
  detector_config: string | null;  // JSON
  
  // Metadata
  severity: Severity;
  auto_fixable: number;
  first_seen: string;
  last_seen: string;
  approved_at: string | null;
  approved_by: string | null;
  tags: string | null;  // JSON array
  source: string | null;
  
  // Counts
  location_count: number;
  outlier_count: number;
}

/**
 * Pattern location entity
 */
export interface DbPatternLocation {
  id?: number;
  pattern_id: string;
  file: string;
  line: number;
  column_num: number;
  end_line: number | null;
  end_column: number | null;
  is_outlier: number;
  outlier_reason: string | null;
  deviation_score: number | null;
  confidence: number;
  snippet: string | null;
}

/**
 * Pattern example entity
 */
export interface DbPatternExample {
  id?: number;
  pattern_id: string;
  file: string;
  line: number;
  end_line: number;
  code: string;
  context: string | null;
  quality: number;
  is_outlier: number;
  extracted_at: string;
}

/**
 * Pattern variant entity
 */
export interface DbPatternVariant {
  id: string;
  pattern_id: string;
  name: string;
  scope: 'global' | 'directory' | 'file';
  scope_value: string | null;
  reason: string;
  locations: string | null;  // JSON array
  active: number;
  created_at: string;
  created_by: string | null;
  expires_at: string | null;
}

/**
 * Contract entity
 */
export type DbHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type DbContractStatus = 'discovered' | 'verified' | 'mismatch' | 'ignored';

export interface DbContract {
  id: string;
  method: DbHttpMethod;
  endpoint: string;
  normalized_endpoint: string;
  status: DbContractStatus;
  
  // Backend
  backend_method: string | null;
  backend_path: string | null;
  backend_normalized_path: string | null;
  backend_file: string | null;
  backend_line: number | null;
  backend_framework: string | null;
  backend_response_fields: string | null;  // JSON
  
  // Confidence
  confidence_score: number;
  confidence_level: string;
  match_confidence: number | null;
  field_extraction_confidence: number | null;
  
  // Mismatches
  mismatches: string | null;  // JSON
  
  // Metadata
  first_seen: string;
  last_seen: string;
  verified_at: string | null;
  verified_by: string | null;
}

/**
 * Contract frontend entity
 */
export interface DbContractFrontend {
  id?: number;
  contract_id: string;
  method: string;
  path: string;
  normalized_path: string;
  file: string;
  line: number;
  library: string | null;
  response_fields: string | null;  // JSON
}

/**
 * Constraint entity
 */
export type DbConstraintStatus = 'discovered' | 'approved' | 'ignored' | 'custom';

export interface DbConstraint {
  id: string;
  name: string;
  description: string | null;
  category: string;
  status: DbConstraintStatus;
  language: string;
  
  // Definition
  invariant: string;  // JSON
  scope: string | null;  // JSON
  enforcement_level: 'error' | 'warning' | 'info';
  enforcement_message: string | null;
  enforcement_autofix: string | null;
  
  // Confidence
  confidence_score: number;
  confidence_evidence: number;
  confidence_violations: number;
  
  // Metadata
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  approved_by: string | null;
  ignored_at: string | null;
  ignore_reason: string | null;
  tags: string | null;  // JSON
  notes: string | null;
}

/**
 * Constraint counts
 */
export interface DbConstraintCounts {
  total: number;
  byStatus: Record<DbConstraintStatus, number>;
  byCategory: Record<string, number>;
  byLanguage: Record<string, number>;
  byEnforcement: Record<'error' | 'warning' | 'info', number>;
}

/**
 * Data model entity
 */
export interface DbDataModel {
  id?: number;
  name: string;
  table_name: string;
  file: string;
  line: number;
  framework: string | null;
  confidence: number;
  fields: string | null;  // JSON
}

/**
 * Sensitive field entity
 */
export interface DbSensitiveField {
  id?: number;
  table_name: string;
  field_name: string;
  sensitivity: 'pii' | 'financial' | 'auth' | 'health' | 'custom';
  reason: string | null;
}

/**
 * Data access point entity
 */
export interface DbDataAccessPoint {
  id: string;
  table_name: string;
  operation: 'read' | 'write' | 'delete';
  file: string;
  line: number;
  column_num: number;
  context: string | null;
  fields: string | null;  // JSON
  is_raw_sql: number;
  confidence: number;
  function_id: string | null;
}

/**
 * Table access summary
 */
export interface DbTableAccess {
  table_name: string;
  model: DbDataModel | null;
  fields: string[];
  sensitive_fields: DbSensitiveField[];
  access_points: DbDataAccessPoint[];
}

/**
 * Sensitive access summary
 */
export interface DbSensitiveAccess {
  table_name: string;
  field_name: string;
  sensitivity: string;
  access_points: DbDataAccessPoint[];
}

/**
 * Environment variable entity
 */
export type DbEnvSensitivity = 'secret' | 'credential' | 'config' | 'unknown';

export interface DbEnvVariable {
  name: string;
  sensitivity: DbEnvSensitivity;
  has_default: number;
  is_required: number;
  default_value: string | null;
}

/**
 * Environment access point entity
 */
export interface DbEnvAccessPoint {
  id: string;
  var_name: string;
  method: string;
  file: string;
  line: number;
  column_num: number;
  context: string | null;
  language: string | null;
  confidence: number;
  has_default: number;
  default_value: string | null;
  is_required: number;
}

/**
 * Function entity
 */
export interface DbFunction {
  id: string;
  name: string;
  qualified_name: string | null;
  file: string;
  start_line: number;
  end_line: number;
  language: string;
  is_exported: number;
  is_entry_point: number;
  is_data_accessor: number;
  is_constructor: number;
  is_async: number;
  decorators: string | null;  // JSON
  parameters: string | null;  // JSON
  signature: string | null;
}

/**
 * Function call entity
 */
export interface DbFunctionCall {
  id?: number;
  caller_id: string;
  callee_id: string | null;
  callee_name: string;
  line: number;
  column_num: number;
  resolved: number;
  confidence: number;
  argument_count: number;
}

/**
 * Function data access entity
 */
export interface DbFunctionDataAccess {
  id?: number;
  function_id: string;
  table_name: string;
  operation: 'read' | 'write' | 'delete';
  fields: string | null;  // JSON
  line: number;
  confidence: number;
}

/**
 * Call chain node for traversal
 */
export interface DbCallChainNode {
  function: DbFunction;
  depth: number;
  path: string[];
}

/**
 * Audit snapshot entity
 */
export interface DbAuditSnapshot {
  id?: number;
  date: string;
  scan_hash: string | null;
  health_score: number | null;
  total_patterns: number | null;
  auto_approve_eligible: number | null;
  flagged_for_review: number | null;
  likely_false_positives: number | null;
  duplicate_candidates: number | null;
  avg_confidence: number | null;
  cross_validation_score: number | null;
  summary: string | null;  // JSON
}

/**
 * Pattern history event entity
 */
export interface DbPatternHistoryEvent {
  id?: number;
  date: string;
  pattern_id: string;
  action: 'created' | 'approved' | 'ignored' | 'updated' | 'deleted';
  previous_status: string | null;
  new_status: string | null;
  changed_by: string | null;
  details: string | null;
}

/**
 * Health trend entity
 */
export interface DbHealthTrend {
  id?: number;
  date: string;
  health_score: number | null;
  avg_confidence: number | null;
  total_patterns: number | null;
  approved_count: number | null;
  duplicate_groups: number | null;
  cross_validation_score: number | null;
}

/**
 * Scan history entity
 */
export interface DbScanHistory {
  id?: number;
  scan_id: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  files_scanned: number | null;
  patterns_found: number | null;
  patterns_approved: number | null;
  errors: number;
  status: 'running' | 'completed' | 'failed';
  error_message: string | null;
  checksum: string | null;
}

/**
 * DNA profile entity
 */
export interface DbDNAProfile {
  id: number;
  version: string;
  generated_at: string;
  health_score: number | null;
  genetic_diversity: number | null;
  summary: string | null;  // JSON
}

/**
 * DNA gene entity
 */
export interface DbDNAGene {
  id: string;
  name: string;
  dominant_variant: string | null;
  frequency: number | null;
  confidence: number | null;
  variants: string | null;  // JSON
  evidence: string | null;  // JSON
}

/**
 * DNA mutation entity
 */
export interface DbDNAMutation {
  id?: number;
  gene_id: string;
  file: string;
  line: number;
  expected: string | null;
  actual: string | null;
  impact: 'high' | 'medium' | 'low' | null;
  reason: string | null;
}

/**
 * Test file entity
 */
export interface DbTestFile {
  id?: number;
  file: string;
  test_framework: string | null;
  test_count: number;
  last_run: string | null;
  status: string;
}

/**
 * Test coverage entity
 */
export interface DbTestCoverage {
  id?: number;
  test_file: string;
  source_file: string;
  function_id: string | null;
  coverage_type: 'unit' | 'integration' | 'e2e' | null;
  confidence: number;
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Pattern search query
 */
export interface PatternSearchQuery {
  ids?: string[];
  category?: PatternCategory | PatternCategory[];
  subcategory?: string | string[];
  status?: PatternStatus | PatternStatus[];
  minConfidence?: number;
  maxConfidence?: number;
  confidenceLevel?: ConfidenceLevel | ConfidenceLevel[];
  severity?: Severity | Severity[];
  autoFixable?: boolean;
  file?: string;
  files?: string[];
  hasOutliers?: boolean;
  minOutliers?: number;
  tags?: string[];
  source?: string;
  search?: string;
  createdAfter?: string;
  createdBefore?: string;
  seenAfter?: string;
  seenBefore?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'name' | 'confidence' | 'severity' | 'firstSeen' | 'lastSeen' | 'outlierCount' | 'locationCount';
  orderDir?: 'asc' | 'desc';
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
  cursor?: string;
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  cursor?: string;
}

// ============================================================================
// Unified Store Interface
// ============================================================================

/**
 * The unified store interface
 * 
 * This is the main interface for all database operations.
 * It provides access to all repositories and transaction support.
 */
export interface IUnifiedStore {
  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
  
  // Transactions
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  
  // Repositories
  patterns: IPatternRepository;
  contracts: IContractRepository;
  constraints: IConstraintRepository;
  boundaries: IBoundaryRepository;
  environment: IEnvironmentRepository;
  callGraph: ICallGraphRepository;
  audit: IAuditRepository;
  dna: IDNARepository;
  testTopology: ITestTopologyRepository;
  
  // Export/Import (for CLI and cloud sync)
  export(format: 'json' | 'sqlite'): Promise<Buffer>;
  import(data: Buffer, format: 'json' | 'sqlite'): Promise<void>;
  
  // Sync
  getSyncLog(since?: string): Promise<SyncLogEntry[]>;
  markSynced(ids: number[]): Promise<void>;
  
  // Maintenance
  vacuum(): Promise<void>;
  checkpoint(): Promise<void>;
  getStats(): Promise<StoreStats>;
}

/**
 * Sync log entry
 */
export interface SyncLogEntry {
  id: number;
  table_name: string;
  row_id: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  timestamp: string;
  synced: number;
}

/**
 * Store statistics
 */
export interface StoreStats {
  patterns: number;
  contracts: number;
  constraints: number;
  functions: number;
  accessPoints: number;
  envVariables: number;
  testFiles: number;
  dbSizeBytes: number;
  lastScan: string | null;
}
