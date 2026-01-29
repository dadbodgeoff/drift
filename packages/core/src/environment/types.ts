/**
 * Environment Variable Access Types
 *
 * Types for tracking environment variable and configuration access patterns.
 * Enables answering: "What config/env vars does this code access?"
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Supported languages for environment extraction
 */
export type EnvLanguage = 'typescript' | 'javascript' | 'python' | 'java' | 'csharp' | 'php' | 'go' | 'rust' | 'cpp';

/**
 * Environment access method
 */
export type EnvAccessMethod =
  // JavaScript/TypeScript
  | 'process.env'
  | 'import.meta.env'
  | 'dotenv'
  | 'config'
  // Python
  | 'os.environ'
  | 'os.getenv'
  | 'dotenv'
  | 'pydantic-settings'
  // Java
  | 'System.getenv'
  | 'System.getProperty'
  | 'Environment'
  | '@Value'
  | '@ConfigurationProperties'
  // C#
  | 'Environment.GetEnvironmentVariable'
  | 'IConfiguration'
  | 'ConfigurationManager'
  | 'appsettings'
  // PHP
  | 'getenv'
  | '$_ENV'
  | '$_SERVER'
  | 'env()'
  | 'config()'
  // Go
  | 'os.Getenv'
  | 'os.LookupEnv'
  | 'viper'
  | 'envconfig'
  // Rust
  | 'std::env::var'
  | 'std::env::var_os'
  | 'dotenvy'
  | 'config-rs'
  // C++
  | 'std::getenv'
  | 'getenv'
  | 'boost::program_options'
  | 'QSettings'
  // Generic
  | 'unknown';

/**
 * Environment variable sensitivity classification
 */
export type EnvSensitivity = 
  | 'secret'      // API keys, passwords, tokens
  | 'credential'  // Database URLs, connection strings
  | 'config'      // Feature flags, ports, hosts
  | 'unknown';

/**
 * An environment variable access point in code
 */
export interface EnvAccessPoint {
  /** Unique identifier */
  id: string;
  /** Variable name being accessed (e.g., "DATABASE_URL", "API_KEY") */
  varName: string;
  /** Access method used */
  method: EnvAccessMethod;
  /** Source file */
  file: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Surrounding code context */
  context: string;
  /** Language */
  language: EnvLanguage;
  /** Sensitivity classification */
  sensitivity: EnvSensitivity;
  /** Detection confidence (0-1) */
  confidence: number;
  /** Whether a default value is provided */
  hasDefault: boolean;
  /** Default value if detectable */
  defaultValue?: string | undefined;
  /** Whether this is required (no default, throws if missing) */
  isRequired: boolean;
  /** Function/method containing this access */
  containingFunction?: string | undefined;
}

/**
 * Environment variable information
 */
export interface EnvVarInfo {
  /** Variable name */
  name: string;
  /** Sensitivity classification */
  sensitivity: EnvSensitivity;
  /** All access points for this variable */
  accessedBy: EnvAccessPoint[];
  /** Files that access this variable */
  files: string[];
  /** Whether any access has a default */
  hasDefault: boolean;
  /** Whether any access requires the variable */
  isRequired: boolean;
}

/**
 * File environment access information
 */
export interface FileEnvInfo {
  /** File path */
  file: string;
  /** Variables accessed from this file */
  variables: string[];
  /** All access points in this file */
  accessPoints: EnvAccessPoint[];
  /** Sensitive variables accessed */
  sensitiveVars: string[];
}

/**
 * Complete environment access map
 */
export interface EnvAccessMap {
  /** Schema version */
  version: '1.0';
  /** Generation timestamp */
  generatedAt: string;
  /** Project root */
  projectRoot: string;
  
  /** Variable-centric access information */
  variables: Record<string, EnvVarInfo>;
  
  /** All access points indexed by ID */
  accessPoints: Record<string, EnvAccessPoint>;
  
  /** Statistics */
  stats: {
    totalVariables: number;
    totalAccessPoints: number;
    secretVariables: number;
    credentialVariables: number;
    configVariables: number;
    byLanguage: Record<string, number>;
    byMethod: Record<string, number>;
  };
}

// ============================================================================
// Extraction Types
// ============================================================================

/**
 * Result of extracting environment access from a single file
 */
export interface EnvExtractionResult {
  file: string;
  language: EnvLanguage;
  accessPoints: EnvAccessPoint[];
  errors: string[];
}

// ============================================================================
// Store Types
// ============================================================================

/**
 * Environment store configuration
 */
export interface EnvStoreConfig {
  rootDir: string;
}

/**
 * Environment scan result
 */
export interface EnvScanResult {
  /** Discovered access map */
  accessMap: EnvAccessMap;
  /** Scan statistics */
  stats: {
    filesScanned: number;
    variablesFound: number;
    accessPointsFound: number;
    secretsFound: number;
    scanDurationMs: number;
  };
}

// ============================================================================
// Sensitivity Detection
// ============================================================================

/**
 * Patterns for detecting sensitive environment variables
 */
export const SENSITIVE_VAR_PATTERNS: Record<EnvSensitivity, RegExp[]> = {
  secret: [
    /api[_-]?key/i,
    /secret/i,
    /token/i,
    /password/i,
    /passwd/i,
    /private[_-]?key/i,
    /auth[_-]?key/i,
    /access[_-]?key/i,
    /signing[_-]?key/i,
    /encryption[_-]?key/i,
    /jwt[_-]?secret/i,
    /session[_-]?secret/i,
    /webhook[_-]?secret/i,
    /stripe[_-]?secret/i,
    /aws[_-]?secret/i,
  ],
  credential: [
    /database[_-]?url/i,
    /db[_-]?url/i,
    /connection[_-]?string/i,
    /redis[_-]?url/i,
    /mongo[_-]?uri/i,
    /postgres[_-]?url/i,
    /mysql[_-]?url/i,
    /supabase[_-]?url/i,
    /smtp[_-]?/i,
    /mail[_-]?/i,
    /s3[_-]?/i,
    /aws[_-]?access/i,
  ],
  config: [
    /port/i,
    /host/i,
    /url/i,
    /env/i,
    /node[_-]?env/i,
    /debug/i,
    /log[_-]?level/i,
    /feature[_-]?/i,
    /enable[_-]?/i,
    /disable[_-]?/i,
    /timeout/i,
    /limit/i,
    /max[_-]?/i,
    /min[_-]?/i,
  ],
  unknown: [],
};

/**
 * Classify environment variable sensitivity
 */
export function classifyEnvSensitivity(varName: string): EnvSensitivity {
  // Check secret patterns first (highest priority)
  for (const pattern of SENSITIVE_VAR_PATTERNS.secret) {
    if (pattern.test(varName)) {return 'secret';}
  }
  
  // Check credential patterns
  for (const pattern of SENSITIVE_VAR_PATTERNS.credential) {
    if (pattern.test(varName)) {return 'credential';}
  }
  
  // Check config patterns
  for (const pattern of SENSITIVE_VAR_PATTERNS.config) {
    if (pattern.test(varName)) {return 'config';}
  }
  
  return 'unknown';
}
