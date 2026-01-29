/**
 * Rust Data Access Extractor
 *
 * Extracts database access patterns from Rust code for:
 * - SQLx (compile-time checked SQL)
 * - Diesel (type-safe ORM)
 * - SeaORM (async ORM)
 * - tokio-postgres (raw PostgreSQL)
 *
 * @license Apache-2.0
 */

import type { DataAccessPoint, DataOperation, ORMFramework } from '../../boundaries/types.js';

// =============================================================================
// Types
// =============================================================================

export interface RustDataAccessResult {
  accessPoints: DataAccessPoint[];
  tables: string[];
  frameworks: string[];
  errors: string[];
}

export interface RustDataAccessOptions {
  includeRawSql?: boolean;
  includeMacros?: boolean;
}

// =============================================================================
// Regex Patterns
// =============================================================================

// SQLx patterns
const SQLX_QUERY_PATTERN = /sqlx::query(?:_as)?!?\s*\(\s*r?#?"([^"]+)"#?\s*\)/gi;
const SQLX_QUERY_AS_PATTERN = /sqlx::query_as!?\s*::<\s*([^>]+)\s*>\s*\(\s*r?#?"([^"]+)"#?\s*\)/gi;
const SQLX_QUERY_SCALAR_PATTERN = /sqlx::query_scalar!?\s*\(\s*r?#?"([^"]+)"#?\s*\)/gi;

// Diesel patterns
const DIESEL_TABLE_PATTERN = /(\w+)::table\s*\.(filter|select|find|first|load|get_result|execute)/gi;
const DIESEL_INSERT_PATTERN = /diesel::insert_into\s*\(\s*(\w+)::table\s*\)/gi;
const DIESEL_UPDATE_PATTERN = /diesel::update\s*\(\s*(\w+)::table/gi;
const DIESEL_DELETE_PATTERN = /diesel::delete\s*\(\s*(\w+)::table/gi;

// SeaORM patterns
const SEAORM_ENTITY_PATTERN = /(\w+)::Entity::(?:find|insert|update|delete)/gi;
const SEAORM_FIND_PATTERN = /(\w+)::Entity::find(?:_by_id)?\s*\(/gi;
const SEAORM_INSERT_PATTERN = /(\w+)::ActiveModel\s*\{/gi;
const SEAORM_QUERY_PATTERN = /\.filter\s*\(\s*(\w+)::Column::/gi;

// tokio-postgres patterns
const TOKIO_PG_QUERY_PATTERN = /client\.(?:query|execute|query_one|query_opt)\s*\(\s*r?#?"([^"]+)"#?\s*,/gi;

// Raw SQL patterns
const RAW_SQL_PATTERN = /(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s+/gi;

// =============================================================================
// Helper Functions
// =============================================================================

let accessPointCounter = 0;

function generateAccessPointId(): string {
  return `rust-dap-${Date.now()}-${++accessPointCounter}`;
}

function getLineNumber(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function getContextLines(source: string, index: number, contextSize = 2): string {
  const lines = source.split('\n');
  const lineNum = getLineNumber(source, index) - 1;
  const start = Math.max(0, lineNum - contextSize);
  const end = Math.min(lines.length, lineNum + contextSize + 1);
  return lines.slice(start, end).join('\n');
}

function createDataAccessPoint(
  filePath: string,
  source: string,
  matchIndex: number,
  table: string,
  operation: DataOperation,
  framework: ORMFramework,
  confidence: number,
  isRawSql: boolean,
  fields: string[] = []
): DataAccessPoint {
  return {
    id: generateAccessPointId(),
    file: filePath,
    line: getLineNumber(source, matchIndex),
    column: 0,
    table,
    fields,
    operation,
    framework,
    context: getContextLines(source, matchIndex),
    isRawSql,
    confidence,
  };
}

// =============================================================================
// Extractor Implementation
// =============================================================================

/**
 * Extract data access patterns from Rust source code
 */
export function extractRustDataAccess(
  source: string,
  filePath: string,
  options: RustDataAccessOptions = {}
): RustDataAccessResult {
  const accessPoints: DataAccessPoint[] = [];
  const tables = new Set<string>();
  const frameworks = new Set<string>();
  const errors: string[] = [];

  // Reset counter for consistent IDs within a file
  accessPointCounter = 0;

  try {
    // SQLx extraction
    extractSqlxPatterns(source, filePath, accessPoints, tables, frameworks);

    // Diesel extraction
    extractDieselPatterns(source, filePath, accessPoints, tables, frameworks);

    // SeaORM extraction
    extractSeaOrmPatterns(source, filePath, accessPoints, tables, frameworks);

    // tokio-postgres extraction
    extractTokioPostgresPatterns(source, filePath, accessPoints, tables, frameworks);

    // Raw SQL extraction (if enabled)
    if (options.includeRawSql) {
      extractRawSqlPatterns(source, filePath, accessPoints, tables);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown extraction error');
  }

  return {
    accessPoints,
    tables: Array.from(tables),
    frameworks: Array.from(frameworks),
    errors,
  };
}

// =============================================================================
// SQLx Extraction
// =============================================================================

function extractSqlxPatterns(
  source: string,
  filePath: string,
  accessPoints: DataAccessPoint[],
  tables: Set<string>,
  frameworks: Set<string>
): void {
  let match;

  // sqlx::query!("...")
  SQLX_QUERY_PATTERN.lastIndex = 0;
  while ((match = SQLX_QUERY_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('sqlx');
      
      accessPoints.push(createDataAccessPoint(
        filePath,
        source,
        match.index,
        table,
        operation,
        'sqlx',
        0.95,
        true,
        fields
      ));
    }
  }

  // sqlx::query_as::<Type>("...")
  SQLX_QUERY_AS_PATTERN.lastIndex = 0;
  while ((match = SQLX_QUERY_AS_PATTERN.exec(source)) !== null) {
    const sql = match[2] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('sqlx');
      
      accessPoints.push(createDataAccessPoint(
        filePath,
        source,
        match.index,
        table,
        operation,
        'sqlx',
        0.95,
        true,
        fields
      ));
    }
  }

  // sqlx::query_scalar!("...")
  SQLX_QUERY_SCALAR_PATTERN.lastIndex = 0;
  while ((match = SQLX_QUERY_SCALAR_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('sqlx');
      
      accessPoints.push(createDataAccessPoint(
        filePath,
        source,
        match.index,
        table,
        operation,
        'sqlx',
        0.95,
        true,
        fields
      ));
    }
  }
}

// =============================================================================
// Diesel Extraction
// =============================================================================

function extractDieselPatterns(
  source: string,
  filePath: string,
  accessPoints: DataAccessPoint[],
  tables: Set<string>,
  frameworks: Set<string>
): void {
  let match;

  // users::table.filter(...).load(...)
  DIESEL_TABLE_PATTERN.lastIndex = 0;
  while ((match = DIESEL_TABLE_PATTERN.exec(source)) !== null) {
    const table = match[1] ?? 'unknown';
    const method = match[2]?.toLowerCase() ?? '';
    
    tables.add(table);
    frameworks.add('diesel');
    
    const operation = dieselMethodToOperation(method);
    
    accessPoints.push(createDataAccessPoint(
      filePath,
      source,
      match.index,
      table,
      operation,
      'diesel',
      0.9,
      false
    ));
  }

  // diesel::insert_into(users::table)
  DIESEL_INSERT_PATTERN.lastIndex = 0;
  while ((match = DIESEL_INSERT_PATTERN.exec(source)) !== null) {
    const table = match[1] ?? 'unknown';
    
    tables.add(table);
    frameworks.add('diesel');
    
    accessPoints.push(createDataAccessPoint(
      filePath,
      source,
      match.index,
      table,
      'write',
      'diesel',
      0.95,
      false
    ));
  }

  // diesel::update(users::table)
  DIESEL_UPDATE_PATTERN.lastIndex = 0;
  while ((match = DIESEL_UPDATE_PATTERN.exec(source)) !== null) {
    const table = match[1] ?? 'unknown';
    
    tables.add(table);
    frameworks.add('diesel');
    
    accessPoints.push(createDataAccessPoint(
      filePath,
      source,
      match.index,
      table,
      'write',
      'diesel',
      0.95,
      false
    ));
  }

  // diesel::delete(users::table)
  DIESEL_DELETE_PATTERN.lastIndex = 0;
  while ((match = DIESEL_DELETE_PATTERN.exec(source)) !== null) {
    const table = match[1] ?? 'unknown';
    
    tables.add(table);
    frameworks.add('diesel');
    
    accessPoints.push(createDataAccessPoint(
      filePath,
      source,
      match.index,
      table,
      'delete',
      'diesel',
      0.95,
      false
    ));
  }
}

function dieselMethodToOperation(method: string): DataOperation {
  switch (method) {
    case 'filter':
    case 'select':
    case 'find':
    case 'first':
    case 'load':
    case 'get_result':
      return 'read';
    case 'execute':
      return 'unknown';
    default:
      return 'unknown';
  }
}

// =============================================================================
// SeaORM Extraction
// =============================================================================

function extractSeaOrmPatterns(
  source: string,
  filePath: string,
  accessPoints: DataAccessPoint[],
  tables: Set<string>,
  frameworks: Set<string>
): void {
  let match;

  // User::Entity::find()
  SEAORM_ENTITY_PATTERN.lastIndex = 0;
  while ((match = SEAORM_ENTITY_PATTERN.exec(source)) !== null) {
    const entity = match[1] ?? 'unknown';
    const fullMatch = match[0];
    
    tables.add(entity);
    frameworks.add('sea-orm');
    
    let operation: DataOperation = 'unknown';
    if (fullMatch.includes('find')) {operation = 'read';}
    else if (fullMatch.includes('insert')) {operation = 'write';}
    else if (fullMatch.includes('update')) {operation = 'write';}
    else if (fullMatch.includes('delete')) {operation = 'delete';}
    
    accessPoints.push(createDataAccessPoint(
      filePath,
      source,
      match.index,
      entity,
      operation,
      'sea-orm',
      0.9,
      false
    ));
  }

  // User::Entity::find_by_id()
  SEAORM_FIND_PATTERN.lastIndex = 0;
  while ((match = SEAORM_FIND_PATTERN.exec(source)) !== null) {
    const entity = match[1] ?? 'unknown';
    
    tables.add(entity);
    frameworks.add('sea-orm');
    
    accessPoints.push(createDataAccessPoint(
      filePath,
      source,
      match.index,
      entity,
      'read',
      'sea-orm',
      0.9,
      false
    ));
  }

  // User::ActiveModel { ... }
  SEAORM_INSERT_PATTERN.lastIndex = 0;
  while ((match = SEAORM_INSERT_PATTERN.exec(source)) !== null) {
    const entity = match[1] ?? 'unknown';
    
    tables.add(entity);
    frameworks.add('sea-orm');
    
    accessPoints.push(createDataAccessPoint(
      filePath,
      source,
      match.index,
      entity,
      'write',
      'sea-orm',
      0.85,
      false
    ));
  }

  // .filter(user::Column::...)
  SEAORM_QUERY_PATTERN.lastIndex = 0;
  while ((match = SEAORM_QUERY_PATTERN.exec(source)) !== null) {
    const entity = match[1] ?? 'unknown';
    
    tables.add(entity);
    frameworks.add('sea-orm');
    
    accessPoints.push(createDataAccessPoint(
      filePath,
      source,
      match.index,
      entity,
      'read',
      'sea-orm',
      0.8,
      false
    ));
  }
}

// =============================================================================
// tokio-postgres Extraction
// =============================================================================

function extractTokioPostgresPatterns(
  source: string,
  filePath: string,
  accessPoints: DataAccessPoint[],
  tables: Set<string>,
  frameworks: Set<string>
): void {
  let match;

  TOKIO_PG_QUERY_PATTERN.lastIndex = 0;
  while ((match = TOKIO_PG_QUERY_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('tokio-postgres');
      
      accessPoints.push(createDataAccessPoint(
        filePath,
        source,
        match.index,
        table,
        operation,
        'tokio-postgres',
        0.9,
        true,
        fields
      ));
    }
  }
}

// =============================================================================
// Raw SQL Extraction
// =============================================================================

function extractRawSqlPatterns(
  source: string,
  filePath: string,
  accessPoints: DataAccessPoint[],
  tables: Set<string>
): void {
  const stringPattern = /r?#?"([^"]*(?:SELECT|INSERT|UPDATE|DELETE)[^"]*)"#?/gi;
  let match;

  while ((match = stringPattern.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      
      accessPoints.push(createDataAccessPoint(
        filePath,
        source,
        match.index,
        table,
        operation,
        'raw-sql',
        0.7,
        true,
        fields
      ));
    }
  }
}

// =============================================================================
// SQL Parsing Utilities
// =============================================================================

function parseSql(sql: string): { table: string; operation: DataOperation; fields: string[] } {
  const upperSql = sql.toUpperCase().trim();
  let operation: DataOperation = 'unknown';
  let table = '';
  const fields: string[] = [];

  if (upperSql.startsWith('SELECT')) {
    operation = 'read';
    const fromMatch = sql.match(/FROM\s+["'`]?(\w+)["'`]?/i);
    table = fromMatch?.[1] ?? '';
    
    // Extract selected fields
    const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
    if (selectMatch?.[1] && selectMatch[1] !== '*') {
      const fieldList = selectMatch[1].split(',').map(f => {
        const parts = f.trim().split(/\s+/);
        return parts[0] ?? '';
      });
      fields.push(...fieldList.filter((f): f is string => !!f && f !== '*'));
    }
  } else if (upperSql.startsWith('INSERT')) {
    operation = 'write';
    const intoMatch = sql.match(/INTO\s+["'`]?(\w+)["'`]?/i);
    table = intoMatch?.[1] ?? '';
  } else if (upperSql.startsWith('UPDATE')) {
    operation = 'write';
    const updateMatch = sql.match(/UPDATE\s+["'`]?(\w+)["'`]?/i);
    table = updateMatch?.[1] ?? '';
  } else if (upperSql.startsWith('DELETE')) {
    operation = 'delete';
    const fromMatch = sql.match(/FROM\s+["'`]?(\w+)["'`]?/i);
    table = fromMatch?.[1] ?? '';
  }

  return { table, operation, fields };
}

// =============================================================================
// Framework Detection
// =============================================================================

/**
 * Detect which Rust database frameworks are used in the source
 */
export function detectRustDatabaseFrameworks(source: string): string[] {
  const frameworks: string[] = [];

  if (source.includes('sqlx::') || source.includes('use sqlx')) {
    frameworks.push('sqlx');
  }
  if (source.includes('diesel::') || source.includes('use diesel')) {
    frameworks.push('diesel');
  }
  if (source.includes('sea_orm::') || source.includes('use sea_orm')) {
    frameworks.push('sea-orm');
  }
  if (source.includes('tokio_postgres::') || source.includes('use tokio_postgres')) {
    frameworks.push('tokio-postgres');
  }
  if (source.includes('postgres::') || source.includes('use postgres')) {
    frameworks.push('postgres');
  }
  if (source.includes('rusqlite::') || source.includes('use rusqlite')) {
    frameworks.push('rusqlite');
  }

  return frameworks;
}

/**
 * Check if source contains any database access patterns
 */
export function hasRustDataAccess(source: string): boolean {
  return detectRustDatabaseFrameworks(source).length > 0 ||
         RAW_SQL_PATTERN.test(source);
}
