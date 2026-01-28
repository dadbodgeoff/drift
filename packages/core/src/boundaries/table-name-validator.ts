/**
 * Table Name Validator
 * 
 * Enterprise-grade validation for detected table names.
 * Filters out false positives from comments, strings, and common words.
 * 
 * Uses a multi-layer filtering approach:
 * 1. Structural validation (length, characters)
 * 2. Semantic filtering (common words, reserved keywords)
 * 3. Context-aware scoring (confidence adjustment)
 */

// ============================================================================
// Types
// ============================================================================

export interface TableNameValidationResult {
  /** Whether the table name is valid */
  isValid: boolean;
  /** Confidence adjustment factor (0-1, multiply with original confidence) */
  confidenceMultiplier: number;
  /** Reason for rejection or confidence adjustment */
  reason?: string;
  /** Suggested normalized name (if applicable) */
  normalizedName?: string;
}

export interface TableNameValidatorConfig {
  /** Minimum length for table names (default: 2) */
  minLength?: number;
  /** Maximum length for table names (default: 64) */
  maxLength?: number;
  /** Allow numeric-only names (default: false) */
  allowNumeric?: boolean;
  /** Allow single-character names (default: false) */
  allowSingleChar?: boolean;
  /** Custom blocklist patterns */
  customBlocklist?: string[];
  /** Custom allowlist patterns (bypass validation) */
  customAllowlist?: string[];
  /** Strict mode - reject anything suspicious (default: false) */
  strictMode?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Common English words that are unlikely to be table names
 */
const COMMON_WORDS = new Set([
  // Articles
  'a', 'an', 'the',
  // Prepositions
  'in', 'on', 'at', 'to', 'for', 'of', 'by', 'with', 'from', 'as',
  // Conjunctions
  'and', 'or', 'but', 'if', 'then', 'else', 'when', 'while',
  // Pronouns
  'it', 'this', 'that', 'these', 'those', 'he', 'she', 'we', 'they',
  // Common verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'can', 'get', 'set', 'put', 'add', 'new', 'old',
  // Common adjectives
  'all', 'any', 'some', 'no', 'not', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 'just', 'also', 'now', 'here', 'there', 'where', 'how',
  'what', 'which', 'who', 'whom', 'why',
  // Common nouns (too generic)
  'data', 'info', 'item', 'items', 'thing', 'things', 'stuff', 'value',
  'values', 'result', 'results', 'response', 'request', 'error', 'errors',
  'message', 'messages', 'text', 'string', 'number', 'numbers', 'list',
  'array', 'object', 'objects', 'key', 'keys', 'name', 'names', 'type',
  'types', 'class', 'function', 'method', 'property', 'field', 'fields',
  // Common false positives from code analysis
  'unknown', 'undefined', 'null', 'none', 'default', 'module', 'router',
  'status', 'state', 'context', 'config', 'options', 'params', 'args',
  'body', 'query', 'path', 'url', 'uri', 'id', 'ids', 'uuid', 'record',
  'records', 'row', 'rows', 'column', 'columns', 'entry', 'entries',
  // Python/JS common variable names
  'self', 'cls', 'this', 'super', 'parent', 'child', 'children',
  // Time-related (often variables, not tables)
  'time', 'date', 'day', 'days', 'week', 'month', 'year', 'hour', 'minute',
  'second', 'timestamp', 'datetime', 'duration', 'interval', 'period',
  // Control flow / state
  'next', 'prev', 'previous', 'current', 'first', 'last', 'start', 'end',
  'begin', 'finish', 'done', 'complete', 'pending', 'active', 'inactive',
  'enabled', 'disabled', 'visible', 'hidden', 'open', 'closed', 'locked',
  'unlocked', 'valid', 'invalid', 'success', 'failed', 'failure',
  // Common service/utility names (not tables)
  'cache', 'lock', 'mutex', 'semaphore', 'queue', 'stack', 'buffer',
  'stream', 'pipe', 'channel', 'socket', 'connection', 'session',
  'client', 'server', 'host', 'port', 'endpoint', 'service', 'handler',
  'listener', 'observer', 'subscriber', 'publisher', 'producer', 'consumer',
  'worker', 'job', 'task', 'process', 'thread', 'pool', 'executor',
  // Error handling
  'exception', 'traceback', 'stacktrace', 'cause', 'reason', 'detail',
  // Generic programming terms
  'input', 'output', 'source', 'target', 'destination', 'origin',
  'payload', 'content', 'contents', 'format', 'encoding', 'charset',
  'length', 'size', 'count', 'total', 'sum', 'avg', 'min', 'max',
  'index', 'offset', 'limit', 'page', 'cursor', 'iterator', 'generator',
  // UI/Frontend specific
  'component', 'element', 'node', 'widget', 'view', 'layout', 'container',
  'wrapper', 'inner', 'outer', 'header', 'footer', 'sidebar', 'content',
  'modal', 'dialog', 'popup', 'tooltip', 'dropdown', 'menu', 'tab', 'panel',
  'form', 'button', 'link', 'icon', 'image', 'label', 'badge', 'tag',
  // Common camelCase/snake_case fragments
  'insert', 'update', 'delete', 'select', 'create', 'read', 'write',
  'fetch', 'load', 'save', 'store', 'remove', 'clear', 'reset', 'init',
  'setup', 'teardown', 'cleanup', 'dispose', 'destroy', 'close', 'open',
  // Metadata/config
  'metadata', 'meta', 'settings', 'preferences', 'configuration',
  // Common false positives from specific patterns
  'your', 'my', 'our', 'their', 'its',
  // Service/utility suffixes (when standalone)
  'mapper', 'matcher', 'parser', 'formatter', 'converter', 'transformer',
  'validator', 'sanitizer', 'encoder', 'decoder', 'serializer', 'deserializer',
  // Short words that are likely variables
  'pay', 'run', 'log', 'err', 'msg', 'req', 'res', 'ctx', 'env', 'app',
  'db', 'api', 'sql', 'orm', 'dto', 'dao', 'svc', 'mgr', 'cfg', 'opt',
]);

/**
 * SQL reserved keywords that shouldn't be table names
 */
const SQL_RESERVED = new Set([
  'select', 'from', 'where', 'insert', 'update', 'delete', 'create', 'drop',
  'alter', 'table', 'index', 'view', 'database', 'schema', 'grant', 'revoke',
  'commit', 'rollback', 'transaction', 'begin', 'end', 'declare', 'cursor',
  'fetch', 'open', 'close', 'null', 'true', 'false', 'and', 'or', 'not',
  'in', 'between', 'like', 'is', 'exists', 'case', 'when', 'then', 'else',
  'join', 'inner', 'outer', 'left', 'right', 'full', 'cross', 'on', 'using',
  'group', 'order', 'by', 'having', 'limit', 'offset', 'union', 'intersect',
  'except', 'distinct', 'all', 'as', 'asc', 'desc', 'primary', 'foreign',
  'key', 'references', 'constraint', 'unique', 'check', 'default', 'auto',
  'increment', 'serial', 'identity', 'sequence', 'trigger', 'procedure',
  'function', 'return', 'returns', 'set', 'get', 'into', 'values',
]);

/**
 * Programming language keywords
 */
const PROGRAMMING_KEYWORDS = new Set([
  // JavaScript/TypeScript
  'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum',
  'import', 'export', 'default', 'async', 'await', 'return', 'throw', 'try',
  'catch', 'finally', 'if', 'else', 'switch', 'case', 'break', 'continue',
  'for', 'while', 'do', 'new', 'this', 'super', 'extends', 'implements',
  'static', 'public', 'private', 'protected', 'readonly', 'abstract',
  'undefined', 'null', 'true', 'false', 'void', 'never', 'any', 'unknown',
  // Python
  'def', 'class', 'import', 'from', 'as', 'if', 'elif', 'else', 'for', 'while',
  'try', 'except', 'finally', 'with', 'return', 'yield', 'raise', 'pass',
  'break', 'continue', 'lambda', 'and', 'or', 'not', 'in', 'is', 'none',
  'true', 'false', 'self', 'cls', 'global', 'nonlocal', 'assert', 'del',
  // Common framework terms
  'router', 'controller', 'service', 'repository', 'model', 'entity',
  'component', 'module', 'provider', 'factory', 'builder', 'handler',
  'middleware', 'interceptor', 'guard', 'pipe', 'filter', 'decorator',
  'validator', 'transformer', 'serializer', 'deserializer', 'mapper',
]);

/**
 * Patterns that indicate false positives
 */
const FALSE_POSITIVE_PATTERNS = [
  // Numeric only
  /^\d+$/,
  // Single character (unless uppercase - might be a table alias)
  /^[a-z]$/,
  // Starts with number
  /^\d/,
  // Contains only special characters
  /^[^a-zA-Z0-9]+$/,
  // Placeholder patterns
  /^_+$/,
  /^placeholder/i,
  /^temp/i,
  /^tmp/i,
  /^test_?$/i,
  /^dummy/i,
  /^sample/i,
  /^example/i,
  /^foo$/i,
  /^bar$/i,
  /^baz$/i,
  /^xxx+$/i,
  // Internal/private markers
  /^__.*__$/,
  /^_[A-Z]/,
  // Underscore-prefixed names (usually private/internal references)
  /^_[a-z]+$/,  // e.g., _redis, _cache, _db
  // CamelCase patterns that look like variable names (not table names)
  // e.g., newCollapsed, toastTimeouts, apiClient, priceOptions
  /^[a-z]+[A-Z][a-z]+[A-Z]/,  // Multiple humps like "newCollapsedState"
  /^(new|old|current|prev|next|first|last|all|my|your|our|their)[A-Z]/i, // Prefixed variables
  /^(get|set|is|has|can|should|will|on|handle)[A-Z]/i, // Method-like names
  // ALL_CAPS that look like constants, not tables
  /^[A-Z][A-Z_]+[A-Z]$/, // e.g., CATEGORY_ORDER, MAX_RETRIES
  // Patterns ending with common suffixes that indicate variables
  /(Timeout|Interval|Handler|Callback|Listener|Observer|Promise|Future)s?$/i,
  /(Client|Service|Manager|Factory|Builder|Provider|Adapter|Wrapper)$/i,
  /(Options|Config|Settings|Params|Args|Props|State|Context)$/i,
  /(Response|Request|Payload|Body|Header|Query|Path)$/i,
  /(Ids?|Uuids?|Keys?|Values?|Items?|Elements?|Nodes?)$/i,
  // Snake_case patterns that look like variable names
  /_text$/i,  // e.g., response_text, error_text
  /_data$/i,  // e.g., response_data, request_data
  /_info$/i,  // e.g., user_info, file_info
  /_list$/i,  // e.g., item_list, user_list (unless plural table)
  /_map$/i,   // e.g., id_map, name_map
  /_set$/i,   // e.g., id_set, name_set
  /_dict$/i,  // e.g., config_dict, options_dict
  /_obj$/i,   // e.g., user_obj, config_obj
  /_str$/i,   // e.g., query_str, name_str
  /_num$/i,   // e.g., page_num, count_num
  /_val$/i,   // e.g., max_val, min_val
  /_ref$/i,   // e.g., user_ref, doc_ref
  /_ptr$/i,   // e.g., data_ptr, node_ptr
  /_idx$/i,   // e.g., start_idx, end_idx
  /_cnt$/i,   // e.g., retry_cnt, error_cnt
  /_len$/i,   // e.g., str_len, arr_len
  // Service/utility snake_case suffixes
  /_service$/i,   // e.g., user_service, auth_service
  /_client$/i,    // e.g., api_client, http_client
  /_handler$/i,   // e.g., error_handler, event_handler
  /_manager$/i,   // e.g., cache_manager, session_manager
  /_factory$/i,   // e.g., user_factory, connection_factory
  /_builder$/i,   // e.g., query_builder, request_builder
  /_provider$/i,  // e.g., auth_provider, data_provider
  /_adapter$/i,   // e.g., db_adapter, api_adapter
  /_wrapper$/i,   // e.g., response_wrapper, error_wrapper
  /_helper$/i,    // e.g., string_helper, date_helper
  /_util$/i,      // e.g., string_util, date_util
  /_utils$/i,     // e.g., string_utils, date_utils
  /_matcher$/i,   // e.g., fuzzy_matcher, pattern_matcher
  /_parser$/i,    // e.g., json_parser, xml_parser
  /_formatter$/i, // e.g., date_formatter, number_formatter
  /_validator$/i, // e.g., email_validator, input_validator
  /_converter$/i, // e.g., type_converter, unit_converter
  /_transformer$/i, // e.g., data_transformer, response_transformer
];

/**
 * Patterns that indicate likely valid table names
 */
const VALID_TABLE_PATTERNS = [
  // Plural nouns (common for tables)
  /s$/,
  // Snake_case with multiple words
  /_[a-z]/,
  // Contains 'table', 'tbl', 'tb'
  /table|tbl|tb_/i,
  // Common table name suffixes
  /_log$|_logs$|_history$|_audit$|_archive$/i,
  // Common table name prefixes
  /^app_|^sys_|^usr_|^ref_|^dim_|^fact_/i,
];

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Required<TableNameValidatorConfig> = {
  minLength: 2,
  maxLength: 64,
  allowNumeric: false,
  allowSingleChar: false,
  customBlocklist: [],
  customAllowlist: [],
  strictMode: false,
};

// ============================================================================
// TableNameValidator Class
// ============================================================================

export class TableNameValidator {
  private readonly config: Required<TableNameValidatorConfig>;
  private readonly customBlocklistSet: Set<string>;
  private readonly customAllowlistSet: Set<string>;

  constructor(config: TableNameValidatorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.customBlocklistSet = new Set(this.config.customBlocklist.map(s => s.toLowerCase()));
    this.customAllowlistSet = new Set(this.config.customAllowlist.map(s => s.toLowerCase()));
  }

  /**
   * Validate a table name
   */
  validate(tableName: string, _context?: { file?: string; line?: number }): TableNameValidationResult {
    const normalized = tableName.trim();
    const lower = normalized.toLowerCase();

    // Check custom allowlist first (bypass all validation)
    if (this.customAllowlistSet.has(lower)) {
      return {
        isValid: true,
        confidenceMultiplier: 1.0,
        normalizedName: normalized,
      };
    }

    // Check custom blocklist
    if (this.customBlocklistSet.has(lower)) {
      return {
        isValid: false,
        confidenceMultiplier: 0,
        reason: 'Table name is in custom blocklist',
      };
    }

    // Structural validation
    const structuralResult = this.validateStructure(normalized);
    if (!structuralResult.isValid) {
      return structuralResult;
    }

    // Semantic validation
    const semanticResult = this.validateSemantics(normalized, lower);
    if (!semanticResult.isValid) {
      return semanticResult;
    }

    // Calculate confidence multiplier based on patterns
    const confidenceMultiplier = this.calculateConfidenceMultiplier(normalized, lower);

    return {
      isValid: true,
      confidenceMultiplier,
      normalizedName: normalized,
    };
  }

  /**
   * Validate structural properties of the table name
   */
  private validateStructure(name: string): TableNameValidationResult {
    // Length checks
    if (name.length < this.config.minLength) {
      return {
        isValid: false,
        confidenceMultiplier: 0,
        reason: `Table name too short (min: ${this.config.minLength})`,
      };
    }

    if (name.length > this.config.maxLength) {
      return {
        isValid: false,
        confidenceMultiplier: 0,
        reason: `Table name too long (max: ${this.config.maxLength})`,
      };
    }

    // Numeric-only check
    if (!this.config.allowNumeric && /^\d+$/.test(name)) {
      return {
        isValid: false,
        confidenceMultiplier: 0,
        reason: 'Numeric-only table names are not allowed',
      };
    }

    // Single character check
    if (!this.config.allowSingleChar && name.length === 1) {
      return {
        isValid: false,
        confidenceMultiplier: 0,
        reason: 'Single-character table names are not allowed',
      };
    }

    // Check false positive patterns
    for (const pattern of FALSE_POSITIVE_PATTERNS) {
      if (pattern.test(name)) {
        return {
          isValid: false,
          confidenceMultiplier: 0,
          reason: `Table name matches false positive pattern: ${pattern}`,
        };
      }
    }

    return { isValid: true, confidenceMultiplier: 1.0 };
  }

  /**
   * Validate semantic properties of the table name
   */
  private validateSemantics(name: string, lower: string): TableNameValidationResult {
    // Common words check
    if (COMMON_WORDS.has(lower)) {
      return {
        isValid: false,
        confidenceMultiplier: 0,
        reason: `'${name}' is a common English word, unlikely to be a table name`,
      };
    }

    // SQL reserved keywords (in strict mode)
    if (this.config.strictMode && SQL_RESERVED.has(lower)) {
      return {
        isValid: false,
        confidenceMultiplier: 0,
        reason: `'${name}' is a SQL reserved keyword`,
      };
    }

    // Programming keywords (in strict mode)
    if (this.config.strictMode && PROGRAMMING_KEYWORDS.has(lower)) {
      return {
        isValid: false,
        confidenceMultiplier: 0,
        reason: `'${name}' is a programming keyword`,
      };
    }

    return { isValid: true, confidenceMultiplier: 1.0 };
  }

  /**
   * Calculate confidence multiplier based on how "table-like" the name is
   */
  private calculateConfidenceMultiplier(name: string, lower: string): number {
    let multiplier = 1.0;

    // Boost for valid table patterns
    for (const pattern of VALID_TABLE_PATTERNS) {
      if (pattern.test(name)) {
        multiplier = Math.min(multiplier * 1.1, 1.0);
      }
    }

    // Reduce for SQL reserved keywords (non-strict mode)
    if (SQL_RESERVED.has(lower)) {
      multiplier *= 0.5;
    }

    // Reduce for programming keywords (non-strict mode)
    if (PROGRAMMING_KEYWORDS.has(lower)) {
      multiplier *= 0.6;
    }

    // Reduce for very short names (2-3 chars)
    if (name.length <= 3) {
      multiplier *= 0.7;
    }

    // Reduce for names that look like variables (camelCase starting lowercase)
    if (/^[a-z][a-zA-Z]+$/.test(name) && !/[_-]/.test(name)) {
      multiplier *= 0.8;
    }

    // Boost for snake_case (common table naming convention)
    if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(name)) {
      multiplier = Math.min(multiplier * 1.2, 1.0);
    }

    return Math.max(0.1, Math.min(1.0, multiplier));
  }

  /**
   * Batch validate multiple table names
   */
  validateBatch(tableNames: string[]): Map<string, TableNameValidationResult> {
    const results = new Map<string, TableNameValidationResult>();
    for (const name of tableNames) {
      results.set(name, this.validate(name));
    }
    return results;
  }

  /**
   * Filter a list of table names, returning only valid ones
   */
  filterValid(tableNames: string[]): string[] {
    return tableNames.filter(name => this.validate(name).isValid);
  }

  /**
   * Get statistics about validation results
   */
  getValidationStats(tableNames: string[]): {
    total: number;
    valid: number;
    invalid: number;
    rejectionReasons: Record<string, number>;
  } {
    const stats = {
      total: tableNames.length,
      valid: 0,
      invalid: 0,
      rejectionReasons: {} as Record<string, number>,
    };

    for (const name of tableNames) {
      const result = this.validate(name);
      if (result.isValid) {
        stats.valid++;
      } else {
        stats.invalid++;
        const reason = result.reason ?? 'Unknown';
        stats.rejectionReasons[reason] = (stats.rejectionReasons[reason] ?? 0) + 1;
      }
    }

    return stats;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new TableNameValidator instance
 */
export function createTableNameValidator(config?: TableNameValidatorConfig): TableNameValidator {
  return new TableNameValidator(config);
}

/**
 * Default validator instance for convenience
 */
export const defaultTableNameValidator = new TableNameValidator();
