/**
 * Contract type definitions
 *
 * Contracts represent the relationship between backend API endpoints
 * and frontend TypeScript types. They enable detection of mismatches
 * between what the backend returns and what the frontend expects.
 *
 * @requirements - Track BE↔FE type mismatches (the "silent failure killer")
 */

// ============================================================================
// Contract Status Types
// ============================================================================

/**
 * Status of a contract in the system
 *
 * - discovered: Contract found but not yet reviewed
 * - verified: Contract verified as correct
 * - mismatch: Contract has field mismatches
 * - ignored: Contract explicitly ignored by user
 */
export type ContractStatus = 'discovered' | 'verified' | 'mismatch' | 'ignored';

// ============================================================================
// Field Types
// ============================================================================

/**
 * A field in an API response or TypeScript type
 */
export interface ContractField {
  /** Field name */
  name: string;
  
  /** Field type (e.g., 'string', 'number', 'boolean', 'object', 'array') */
  type: string;
  
  /** Whether the field is optional */
  optional: boolean;
  
  /** Whether the field is nullable */
  nullable: boolean;
  
  /** Nested fields (for objects) */
  children?: ContractField[];
  
  /** Array element type (for arrays) */
  arrayType?: string;
  
  /** Line number where field is defined */
  line?: number;
}

/**
 * A mismatch between backend and frontend field definitions
 */
export interface FieldMismatch {
  /** Field name/path (e.g., 'user.email' for nested) */
  fieldPath: string;
  
  /** Type of mismatch */
  mismatchType: 'missing_in_frontend' | 'missing_in_backend' | 'type_mismatch' | 'optionality_mismatch' | 'nullability_mismatch';
  
  /** Backend field definition (if exists) */
  backendField?: ContractField;
  
  /** Frontend field definition (if exists) */
  frontendField?: ContractField;
  
  /** Human-readable description of the mismatch */
  description: string;
  
  /** Severity of the mismatch */
  severity: 'error' | 'warning' | 'info';
}

// ============================================================================
// Endpoint Types
// ============================================================================

/**
 * HTTP methods
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Backend endpoint definition extracted from source code
 */
export interface BackendEndpoint {
  /** HTTP method */
  method: HttpMethod;
  
  /** Route path (e.g., '/api/users/{id}') */
  path: string;
  
  /** Normalized path for matching (e.g., '/api/users/:id') */
  normalizedPath: string;
  
  /** File where endpoint is defined */
  file: string;
  
  /** Line number of endpoint definition */
  line: number;
  
  /** Response fields extracted from the endpoint */
  responseFields: ContractField[];
  
  /** Request body fields (for POST/PUT/PATCH) */
  requestFields?: ContractField[];
  
  /** Response type name (if using a schema/model) */
  responseTypeName?: string;
  
  /** Framework detected (e.g., 'fastapi', 'express', 'flask') */
  framework: string;
}

/**
 * Frontend API call definition extracted from source code
 */
export interface FrontendApiCall {
  /** HTTP method */
  method: HttpMethod;
  
  /** Route path (e.g., '/api/users/${id}') */
  path: string;
  
  /** Normalized path for matching */
  normalizedPath: string;
  
  /** File where API call is made */
  file: string;
  
  /** Line number of API call */
  line: number;
  
  /** TypeScript type used for the response */
  responseType?: string;
  
  /** Fields expected in the response */
  responseFields: ContractField[];
  
  /** Request body type */
  requestType?: string;
  
  /** Request body fields */
  requestFields?: ContractField[];
  
  /** Library used (e.g., 'fetch', 'axios', 'react-query') */
  library: string;
}

// ============================================================================
// Contract Types
// ============================================================================

/**
 * Confidence information for a contract
 */
export interface ContractConfidence {
  /** Overall confidence score (0.0 to 1.0) */
  score: number;
  
  /** Confidence level */
  level: 'high' | 'medium' | 'low' | 'uncertain';
  
  /** How confident we are in the endpoint matching */
  matchConfidence: number;
  
  /** How confident we are in the field extraction */
  fieldExtractionConfidence: number;
}

/**
 * Metadata for a contract
 */
export interface ContractMetadata {
  /** ISO timestamp when contract was first detected */
  firstSeen: string;
  
  /** ISO timestamp when contract was last seen */
  lastSeen: string;
  
  /** ISO timestamp when contract was verified (if verified) */
  verifiedAt?: string;
  
  /** User who verified the contract */
  verifiedBy?: string;
  
  /** Tags for categorization */
  tags?: string[];
  
  /** Custom metadata */
  custom?: Record<string, unknown>;
}

/**
 * A contract between a backend endpoint and frontend type
 *
 * This is the primary contract type used throughout the system.
 */
export interface Contract {
  /** Unique contract identifier */
  id: string;
  
  /** HTTP method */
  method: HttpMethod;
  
  /** Normalized endpoint path */
  endpoint: string;
  
  /** Backend endpoint definition */
  backend: BackendEndpoint;
  
  /** Frontend API call definitions (may have multiple calls to same endpoint) */
  frontend: FrontendApiCall[];
  
  /** Field mismatches detected */
  mismatches: FieldMismatch[];
  
  /** Contract status */
  status: ContractStatus;
  
  /** Confidence information */
  confidence: ContractConfidence;
  
  /** Contract metadata */
  metadata: ContractMetadata;
}

/**
 * Stored contract format (used in JSON files)
 */
export interface StoredContract {
  /** Unique contract ID */
  id: string;
  
  /** HTTP method */
  method: HttpMethod;
  
  /** Normalized endpoint path */
  endpoint: string;
  
  /** Backend endpoint definition */
  backend: BackendEndpoint;
  
  /** Frontend API call definitions */
  frontend: FrontendApiCall[];
  
  /** Field mismatches detected */
  mismatches: FieldMismatch[];
  
  /** Confidence information */
  confidence: ContractConfidence;
  
  /** Contract metadata */
  metadata: ContractMetadata;
}

// ============================================================================
// Contract File Types
// ============================================================================

/**
 * Format of a contract file stored in .drift/contracts/
 */
export interface ContractFile {
  /** Schema version */
  version: string;
  
  /** Contract status this file contains */
  status: ContractStatus;
  
  /** Contracts in this file */
  contracts: StoredContract[];
  
  /** ISO timestamp of last update */
  lastUpdated: string;
  
  /** Checksum for integrity verification */
  checksum?: string;
}

/**
 * Current schema version for contract files
 */
export const CONTRACT_FILE_VERSION = '1.0.0';

// ============================================================================
// Contract Query Types
// ============================================================================

/**
 * Query options for filtering contracts
 */
export interface ContractQuery {
  /** Filter by contract IDs */
  ids?: string[];
  
  /** Filter by status */
  status?: ContractStatus | ContractStatus[];
  
  /** Filter by HTTP method */
  method?: HttpMethod | HttpMethod[];
  
  /** Filter by endpoint path (partial match) */
  endpoint?: string;
  
  /** Filter contracts with mismatches */
  hasMismatches?: boolean;
  
  /** Filter by minimum mismatch count */
  minMismatches?: number;
  
  /** Filter by backend file */
  backendFile?: string;
  
  /** Filter by frontend file */
  frontendFile?: string;
  
  /** Filter by minimum confidence score */
  minConfidence?: number;
  
  /** Search in endpoint path */
  search?: string;
}

/**
 * Sort options for contract queries
 */
export interface ContractSortOptions {
  /** Field to sort by */
  field: 'endpoint' | 'method' | 'mismatchCount' | 'confidence' | 'firstSeen' | 'lastSeen';
  
  /** Sort direction */
  direction: 'asc' | 'desc';
}

/**
 * Complete query options for contracts
 */
export interface ContractQueryOptions {
  /** Filter criteria */
  filter?: ContractQuery;
  
  /** Sort options */
  sort?: ContractSortOptions;
  
  /** Pagination */
  pagination?: {
    offset?: number;
    limit?: number;
  };
}

/**
 * Result of a contract query
 */
export interface ContractQueryResult {
  /** Matching contracts */
  contracts: Contract[];
  
  /** Total count (before pagination) */
  total: number;
  
  /** Whether there are more results */
  hasMore: boolean;
  
  /** Query execution time in milliseconds */
  executionTime: number;
}

// ============================================================================
// Contract Statistics Types
// ============================================================================

/**
 * Statistics about contracts
 */
export interface ContractStats {
  /** Total number of contracts */
  totalContracts: number;
  
  /** Contracts by status */
  byStatus: Record<ContractStatus, number>;
  
  /** Contracts by HTTP method */
  byMethod: Record<HttpMethod, number>;
  
  /** Total number of mismatches */
  totalMismatches: number;
  
  /** Mismatches by type */
  mismatchesByType: Record<FieldMismatch['mismatchType'], number>;
  
  /** ISO timestamp of last update */
  lastUpdated: string;
}
