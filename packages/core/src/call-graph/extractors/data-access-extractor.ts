/**
 * Semantic Data Access Extractor
 *
 * Extracts data access points from source code using semantic parsing.
 * Works alongside the call graph extractors to provide accurate data access detection.
 * 
 * Supports:
 * - Supabase (JavaScript/TypeScript/Python)
 * - Prisma (TypeScript)
 * - Django ORM (Python)
 * - SQLAlchemy (Python)
 * - TypeORM (TypeScript)
 * - Sequelize (JavaScript)
 * - Drizzle (TypeScript)
 * - Knex (JavaScript)
 * - Entity Framework Core (C#)
 * - Raw SQL queries
 */

import type { DataAccessPoint, DataOperation, ORMFramework, ConfidenceBreakdown } from '../../boundaries/types.js';
import type { CallGraphLanguage } from '../types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of data access extraction
 */
export interface DataAccessExtractionResult {
  file: string;
  language: CallGraphLanguage;
  accessPoints: DataAccessPoint[];
  errors: string[];
}

/**
 * ORM/Database client pattern configuration
 */
interface ORMPattern {
  /** Pattern name for debugging */
  name: string;
  /** Method names that indicate data access */
  methods: {
    read: string[];
    write: string[];
    delete: string[];
  };
  /** How to extract table name from the call chain */
  tableExtraction: 'firstArg' | 'receiver' | 'chainedFrom' | 'methodArg';
  /** Languages this pattern applies to */
  languages: CallGraphLanguage[];
}

// ============================================================================
// ORM Patterns
// ============================================================================

const ORM_PATTERNS: ORMPattern[] = [
  // Supabase
  {
    name: 'supabase',
    methods: {
      read: ['select', 'single', 'maybeSingle'],
      write: ['insert', 'update', 'upsert'],
      delete: ['delete'],
    },
    tableExtraction: 'chainedFrom', // .from('table').select()
    languages: ['typescript', 'javascript', 'python'],
  },
  // Prisma
  {
    name: 'prisma',
    methods: {
      read: ['findUnique', 'findFirst', 'findMany', 'findUniqueOrThrow', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy'],
      write: ['create', 'createMany', 'update', 'updateMany', 'upsert'],
      delete: ['delete', 'deleteMany'],
    },
    tableExtraction: 'receiver', // prisma.user.findMany()
    languages: ['typescript', 'javascript'],
  },
  // Django ORM
  {
    name: 'django',
    methods: {
      read: ['get', 'filter', 'exclude', 'all', 'first', 'last', 'values', 'values_list', 'annotate', 'aggregate', 'count', 'exists'],
      write: ['create', 'update', 'bulk_create', 'bulk_update', 'get_or_create', 'update_or_create', 'save'],
      delete: ['delete'],
    },
    tableExtraction: 'receiver', // User.objects.filter()
    languages: ['python'],
  },
  // SQLAlchemy
  {
    name: 'sqlalchemy',
    methods: {
      read: ['query', 'get', 'filter', 'filter_by', 'all', 'first', 'one', 'one_or_none', 'scalar', 'count'],
      write: ['add', 'add_all', 'merge', 'flush', 'commit'],
      delete: ['delete'],
    },
    tableExtraction: 'methodArg', // session.query(User)
    languages: ['python'],
  },
  // TypeORM
  {
    name: 'typeorm',
    methods: {
      read: ['find', 'findOne', 'findOneBy', 'findBy', 'findAndCount', 'findOneOrFail', 'count', 'query'],
      write: ['save', 'insert', 'update', 'upsert'],
      delete: ['delete', 'remove', 'softDelete', 'softRemove'],
    },
    tableExtraction: 'receiver', // userRepository.find()
    languages: ['typescript', 'javascript'],
  },
  // Sequelize
  {
    name: 'sequelize',
    methods: {
      read: ['findAll', 'findOne', 'findByPk', 'findOrCreate', 'findAndCountAll', 'count', 'max', 'min', 'sum'],
      write: ['create', 'bulkCreate', 'update', 'upsert'],
      delete: ['destroy'],
    },
    tableExtraction: 'receiver', // User.findAll()
    languages: ['typescript', 'javascript'],
  },
  // Drizzle
  {
    name: 'drizzle',
    methods: {
      read: ['select', 'selectDistinct'],
      write: ['insert', 'update'],
      delete: ['delete'],
    },
    tableExtraction: 'chainedFrom', // db.select().from(users)
    languages: ['typescript', 'javascript'],
  },
  // Knex
  {
    name: 'knex',
    methods: {
      read: ['select', 'first', 'pluck', 'count', 'min', 'max', 'sum', 'avg'],
      write: ['insert', 'update'],
      delete: ['delete', 'del', 'truncate'],
    },
    tableExtraction: 'firstArg', // knex('users').select()
    languages: ['typescript', 'javascript'],
  },
];

// ============================================================================
// Base Data Access Extractor
// ============================================================================

/**
 * Base class for semantic data access extraction
 */
export abstract class BaseDataAccessExtractor {
  abstract readonly language: CallGraphLanguage;
  abstract readonly extensions: string[];

  /**
   * Extract data access points from source code
   */
  abstract extract(source: string, filePath: string): DataAccessExtractionResult;

  /**
   * Check if this extractor can handle a file
   */
  canHandle(filePath: string): boolean {
    const ext = this.getExtension(filePath);
    return this.extensions.includes(ext);
  }

  protected getExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    return lastDot >= 0 ? filePath.slice(lastDot) : '';
  }

  /**
   * Create an empty result
   */
  protected createEmptyResult(file: string): DataAccessExtractionResult {
    return {
      file,
      language: this.language,
      accessPoints: [],
      errors: [],
    };
  }

  /**
   * Create a data access point with dynamic confidence scoring
   */
  protected createAccessPoint(opts: {
    table: string;
    fields?: string[];
    operation: DataOperation;
    file: string;
    line: number;
    column: number;
    context: string;
    isRawSql?: boolean;
    confidence?: number;
    framework?: ORMFramework;
    /** Whether table name came from a string literal (vs inferred) */
    tableFromLiteral?: boolean;
  }): DataAccessPoint {
    const framework = opts.framework ?? 'unknown';
    const isRawSql = opts.isRawSql ?? false;
    const tableFromLiteral = opts.tableFromLiteral ?? false;
    const fields = opts.fields ?? [];
    
    // Calculate dynamic confidence based on what we found
    const breakdown = this.calculateConfidenceBreakdown({
      table: opts.table,
      fields,
      operation: opts.operation,
      framework,
      tableFromLiteral,
      isRawSql,
    });
    
    // Use calculated confidence unless explicitly overridden
    const confidence = opts.confidence ?? breakdown.factors.tableName * 0.3 +
                                          breakdown.factors.fields * 0.2 +
                                          breakdown.factors.operation * 0.2 +
                                          breakdown.factors.framework * 0.2 +
                                          breakdown.factors.literal * 0.1;

    const result: DataAccessPoint = {
      id: `${opts.file}:${opts.line}:${opts.column}:${opts.table}`,
      table: opts.table,
      fields,
      operation: opts.operation,
      file: opts.file,
      line: opts.line,
      column: opts.column,
      context: opts.context.slice(0, 200),
      isRawSql,
      confidence: Math.round(confidence * 100) / 100, // Round to 2 decimal places
      confidenceBreakdown: breakdown,
    };
    
    // Only add framework if it's known
    if (framework !== 'unknown') {
      result.framework = framework;
    }
    
    return result;
  }

  /**
   * Calculate confidence breakdown based on detection quality
   */
  protected calculateConfidenceBreakdown(opts: {
    table: string;
    fields: string[];
    operation: DataOperation;
    framework: ORMFramework;
    tableFromLiteral: boolean;
    isRawSql: boolean;
  }): ConfidenceBreakdown {
    // Table name factor (0.3 weight)
    // - 1.0: Explicit table name from string literal
    // - 0.7: Table name inferred from model/variable name
    // - 0.3: Unknown table
    let tableNameScore = 0.3;
    let tableNameFound = false;
    if (opts.table && opts.table !== 'unknown') {
      tableNameFound = true;
      tableNameScore = opts.tableFromLiteral ? 1.0 : 0.7;
    }

    // Fields factor (0.2 weight)
    // - 1.0: Multiple specific fields found
    // - 0.7: Single field found
    // - 0.5: No fields but that's expected (e.g., delete)
    // - 0.3: No fields when we'd expect them
    let fieldsScore = 0.3;
    let fieldsFound = false;
    if (opts.fields.length > 1) {
      fieldsScore = 1.0;
      fieldsFound = true;
    } else if (opts.fields.length === 1) {
      fieldsScore = 0.7;
      fieldsFound = true;
    } else if (opts.operation === 'delete') {
      fieldsScore = 0.5; // Fields not expected for delete
    }

    // Operation factor (0.2 weight)
    // - 1.0: Clear operation (read/write/delete)
    // - 0.3: Unknown operation
    const operationScore = opts.operation !== 'unknown' ? 1.0 : 0.3;
    const operationClear = opts.operation !== 'unknown';

    // Framework factor (0.2 weight)
    // - 1.0: Known ORM/framework matched
    // - 0.5: Raw SQL (valid but less structured)
    // - 0.3: Unknown framework
    let frameworkScore = 0.3;
    let frameworkMatched = false;
    if (opts.framework && opts.framework !== 'unknown') {
      frameworkMatched = true;
      frameworkScore = opts.isRawSql ? 0.5 : 1.0;
    }

    // Literal factor (0.1 weight)
    // - 1.0: Table name from string literal
    // - 0.5: Table name from variable/inference
    const literalScore = opts.tableFromLiteral ? 1.0 : 0.5;

    // Build explanation
    const explanationParts: string[] = [];
    if (tableNameFound) {
      explanationParts.push(opts.tableFromLiteral ? 'table name from literal' : 'table name inferred');
    } else {
      explanationParts.push('table name unknown');
    }
    if (fieldsFound) {
      explanationParts.push(`${opts.fields.length} field(s) detected`);
    }
    if (operationClear) {
      explanationParts.push(`${opts.operation} operation`);
    }
    if (frameworkMatched) {
      explanationParts.push(`${opts.framework} pattern`);
    }

    return {
      tableNameFound,
      fieldsFound,
      operationClear,
      frameworkMatched,
      fromLiteral: opts.tableFromLiteral,
      factors: {
        tableName: tableNameScore,
        fields: fieldsScore,
        operation: operationScore,
        framework: frameworkScore,
        literal: literalScore,
      },
      explanation: explanationParts.join(', '),
    };
  }

  /**
   * Detect operation type from method name
   */
  protected detectOperation(methodName: string): DataOperation | null {
    const lowerMethod = methodName.toLowerCase();
    
    // Check all ORM patterns
    for (const pattern of ORM_PATTERNS) {
      if (pattern.methods.read.some(m => lowerMethod.includes(m.toLowerCase()))) {
        return 'read';
      }
      if (pattern.methods.write.some(m => lowerMethod.includes(m.toLowerCase()))) {
        return 'write';
      }
      if (pattern.methods.delete.some(m => lowerMethod.includes(m.toLowerCase()))) {
        return 'delete';
      }
    }

    // Generic patterns
    if (/^(get|find|fetch|load|read|select|query|search|list|count|exists)/.test(lowerMethod)) {
      return 'read';
    }
    if (/^(create|insert|add|save|update|upsert|put|set|write|store|merge)/.test(lowerMethod)) {
      return 'write';
    }
    if (/^(delete|remove|destroy|drop|truncate|clear)/.test(lowerMethod)) {
      return 'delete';
    }

    return null;
  }

  /**
   * Extract fields from a select clause or similar
   */
  protected extractFieldsFromString(selectStr: string): string[] {
    // Handle common patterns: 'field1, field2', ['field1', 'field2'], { field1: true }
    const fields: string[] = [];
    
    // Remove quotes and brackets
    const cleaned = selectStr.replace(/['"[\]{}]/g, '');
    
    // Split by comma
    const parts = cleaned.split(/\s*,\s*/);
    
    for (const part of parts) {
      const trimmed = part.trim();
      // Skip * and empty
      if (trimmed && trimmed !== '*') {
        // Handle 'field: true' or 'field as alias'
        const fieldMatch = trimmed.match(/^(\w+)/);
        if (fieldMatch?.[1]) {
          fields.push(fieldMatch[1]);
        }
      }
    }
    
    return fields;
  }

  /**
   * Infer table name from variable/receiver name
   */
  protected inferTableFromName(name: string): string {
    // Common patterns: userRepository -> users, UserModel -> users, etc.
    const cleaned = name
      .replace(/Repository$/i, '')
      .replace(/Model$/i, '')
      .replace(/Service$/i, '')
      .replace(/DAO$/i, '')
      .replace(/Entity$/i, '')
      .replace(/^_+/, '');
    
    // Convert to snake_case and pluralize
    const snakeCase = cleaned
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
    
    // Simple pluralization
    if (!snakeCase.endsWith('s')) {
      return snakeCase + 's';
    }
    return snakeCase;
  }
}
