/**
 * C++ Data Access Extractor
 *
 * Extracts database access patterns from C++ code for:
 * - SQLite (sqlite3, SQLiteCpp)
 * - ODBC (native ODBC API)
 * - Qt SQL (QSqlQuery, QSqlDatabase)
 * - MySQL Connector/C++
 * - PostgreSQL (libpq, libpqxx)
 * - SOCI (database abstraction library)
 *
 * @license Apache-2.0
 */

import type { DataAccessPoint, DataOperation, ORMFramework } from '../../boundaries/types.js';

// =============================================================================
// Types
// =============================================================================

export interface CppDataAccessResult {
  accessPoints: DataAccessPoint[];
  tables: string[];
  frameworks: string[];
  errors: string[];
}

export interface CppDataAccessOptions {
  includeRawSql?: boolean;
  includePreparedStatements?: boolean;
}

// =============================================================================
// Regex Patterns
// =============================================================================

// SQLite patterns
const SQLITE_EXEC_PATTERN = /sqlite3_exec\s*\(\s*\w+\s*,\s*"([^"]+)"/gi;
const SQLITE_PREPARE_PATTERN = /sqlite3_prepare(?:_v[23])?\s*\(\s*\w+\s*,\s*"([^"]+)"/gi;
const SQLITECPP_EXEC_PATTERN = /(?:db|database)\.exec\s*\(\s*"([^"]+)"/gi;
const SQLITECPP_QUERY_PATTERN = /SQLite::Statement\s+\w+\s*\(\s*\w+\s*,\s*"([^"]+)"/gi;

// Qt SQL patterns
const QSQL_EXEC_PATTERN = /(?:query|QSqlQuery)\s*\.\s*exec\s*\(\s*"([^"]+)"/gi;
const QSQL_PREPARE_PATTERN = /(?:query|QSqlQuery)\s*\.\s*prepare\s*\(\s*"([^"]+)"/gi;
const QSQL_TABLE_MODEL_PATTERN = /setTable\s*\(\s*"(\w+)"/gi;

// ODBC patterns
const ODBC_EXEC_PATTERN = /SQLExecDirect\s*\(\s*\w+\s*,\s*\(SQLCHAR\s*\*\)\s*"([^"]+)"/gi;
const ODBC_PREPARE_PATTERN = /SQLPrepare\s*\(\s*\w+\s*,\s*\(SQLCHAR\s*\*\)\s*"([^"]+)"/gi;

// MySQL Connector patterns
const MYSQL_EXECUTE_PATTERN = /(?:stmt|statement)->execute\s*\(\s*"([^"]+)"/gi;
const MYSQL_QUERY_PATTERN = /(?:conn|connection)->query\s*\(\s*"([^"]+)"/gi;
const MYSQL_PREPARE_PATTERN = /(?:conn|connection)->prepareStatement\s*\(\s*"([^"]+)"/gi;

// PostgreSQL (libpq/libpqxx) patterns
const LIBPQ_EXEC_PATTERN = /PQexec\s*\(\s*\w+\s*,\s*"([^"]+)"/gi;
const LIBPQ_PREPARE_PATTERN = /PQprepare\s*\(\s*\w+\s*,\s*"[^"]*"\s*,\s*"([^"]+)"/gi;
const LIBPQXX_EXEC_PATTERN = /(?:txn|work|transaction)\s*\.\s*exec\s*\(\s*"([^"]+)"/gi;
const LIBPQXX_EXEC0_PATTERN = /(?:txn|work|transaction)\s*\.\s*exec0\s*\(\s*"([^"]+)"/gi;
const LIBPQXX_EXEC1_PATTERN = /(?:txn|work|transaction)\s*\.\s*exec1\s*\(\s*"([^"]+)"/gi;

// SOCI patterns
const SOCI_SQL_PATTERN = /sql\s*<<\s*"([^"]+)"/gi;
const SOCI_PREPARE_PATTERN = /soci::statement\s+\w+\s*=\s*\(\s*sql\.prepare\s*<<\s*"([^"]+)"/gi;

// Raw SQL patterns
const RAW_SQL_PATTERN = /(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s+/gi;

// =============================================================================
// Helper Functions
// =============================================================================

let accessPointCounter = 0;

function generateAccessPointId(): string {
  return `cpp-dap-${Date.now()}-${++accessPointCounter}`;
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
 * Extract data access patterns from C++ source code
 */
export function extractCppDataAccess(
  source: string,
  filePath: string,
  options: CppDataAccessOptions = {}
): CppDataAccessResult {
  const accessPoints: DataAccessPoint[] = [];
  const tables = new Set<string>();
  const frameworks = new Set<string>();
  const errors: string[] = [];

  // Reset counter for consistent IDs within a file
  accessPointCounter = 0;

  try {
    // SQLite extraction
    extractSqlitePatterns(source, filePath, accessPoints, tables, frameworks);

    // Qt SQL extraction
    extractQtSqlPatterns(source, filePath, accessPoints, tables, frameworks);

    // ODBC extraction
    extractOdbcPatterns(source, filePath, accessPoints, tables, frameworks);

    // MySQL Connector extraction
    extractMySqlPatterns(source, filePath, accessPoints, tables, frameworks);

    // PostgreSQL extraction
    extractPostgresPatterns(source, filePath, accessPoints, tables, frameworks);

    // SOCI extraction
    extractSociPatterns(source, filePath, accessPoints, tables, frameworks);

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
// SQLite Extraction
// =============================================================================

function extractSqlitePatterns(
  source: string,
  filePath: string,
  accessPoints: DataAccessPoint[],
  tables: Set<string>,
  frameworks: Set<string>
): void {
  let match;

  // sqlite3_exec()
  SQLITE_EXEC_PATTERN.lastIndex = 0;
  while ((match = SQLITE_EXEC_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('sqlite3');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'sqlite' as ORMFramework, 0.95, true, fields
      ));
    }
  }

  // sqlite3_prepare()
  SQLITE_PREPARE_PATTERN.lastIndex = 0;
  while ((match = SQLITE_PREPARE_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('sqlite3');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'sqlite' as ORMFramework, 0.95, true, fields
      ));
    }
  }

  // SQLiteCpp db.exec()
  SQLITECPP_EXEC_PATTERN.lastIndex = 0;
  while ((match = SQLITECPP_EXEC_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('sqlitecpp');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'sqlite' as ORMFramework, 0.9, true, fields
      ));
    }
  }

  // SQLiteCpp Statement
  SQLITECPP_QUERY_PATTERN.lastIndex = 0;
  while ((match = SQLITECPP_QUERY_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('sqlitecpp');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'sqlite' as ORMFramework, 0.9, true, fields
      ));
    }
  }
}

// =============================================================================
// Qt SQL Extraction
// =============================================================================

function extractQtSqlPatterns(
  source: string,
  filePath: string,
  accessPoints: DataAccessPoint[],
  tables: Set<string>,
  frameworks: Set<string>
): void {
  let match;

  // QSqlQuery.exec()
  QSQL_EXEC_PATTERN.lastIndex = 0;
  while ((match = QSQL_EXEC_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('qt-sql');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'qt-sql' as ORMFramework, 0.9, true, fields
      ));
    }
  }

  // QSqlQuery.prepare()
  QSQL_PREPARE_PATTERN.lastIndex = 0;
  while ((match = QSQL_PREPARE_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('qt-sql');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'qt-sql' as ORMFramework, 0.9, true, fields
      ));
    }
  }

  // QSqlTableModel.setTable()
  QSQL_TABLE_MODEL_PATTERN.lastIndex = 0;
  while ((match = QSQL_TABLE_MODEL_PATTERN.exec(source)) !== null) {
    const table = match[1] ?? '';
    
    if (table) {
      tables.add(table);
      frameworks.add('qt-sql');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, 'read',
        'qt-sql' as ORMFramework, 0.85, false
      ));
    }
  }
}

// =============================================================================
// ODBC Extraction
// =============================================================================

function extractOdbcPatterns(
  source: string,
  filePath: string,
  accessPoints: DataAccessPoint[],
  tables: Set<string>,
  frameworks: Set<string>
): void {
  let match;

  // SQLExecDirect()
  ODBC_EXEC_PATTERN.lastIndex = 0;
  while ((match = ODBC_EXEC_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('odbc');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'odbc' as ORMFramework, 0.9, true, fields
      ));
    }
  }

  // SQLPrepare()
  ODBC_PREPARE_PATTERN.lastIndex = 0;
  while ((match = ODBC_PREPARE_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('odbc');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'odbc' as ORMFramework, 0.9, true, fields
      ));
    }
  }
}

// =============================================================================
// MySQL Connector Extraction
// =============================================================================

function extractMySqlPatterns(
  source: string,
  filePath: string,
  accessPoints: DataAccessPoint[],
  tables: Set<string>,
  frameworks: Set<string>
): void {
  let match;

  // stmt->execute()
  MYSQL_EXECUTE_PATTERN.lastIndex = 0;
  while ((match = MYSQL_EXECUTE_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('mysql-connector');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'mysql' as ORMFramework, 0.9, true, fields
      ));
    }
  }

  // conn->query()
  MYSQL_QUERY_PATTERN.lastIndex = 0;
  while ((match = MYSQL_QUERY_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('mysql-connector');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'mysql' as ORMFramework, 0.9, true, fields
      ));
    }
  }

  // conn->prepareStatement()
  MYSQL_PREPARE_PATTERN.lastIndex = 0;
  while ((match = MYSQL_PREPARE_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('mysql-connector');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'mysql' as ORMFramework, 0.9, true, fields
      ));
    }
  }
}

// =============================================================================
// PostgreSQL Extraction
// =============================================================================

function extractPostgresPatterns(
  source: string,
  filePath: string,
  accessPoints: DataAccessPoint[],
  tables: Set<string>,
  frameworks: Set<string>
): void {
  let match;

  // PQexec()
  LIBPQ_EXEC_PATTERN.lastIndex = 0;
  while ((match = LIBPQ_EXEC_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('libpq');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'postgres' as ORMFramework, 0.9, true, fields
      ));
    }
  }

  // PQprepare()
  LIBPQ_PREPARE_PATTERN.lastIndex = 0;
  while ((match = LIBPQ_PREPARE_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('libpq');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'postgres' as ORMFramework, 0.9, true, fields
      ));
    }
  }

  // libpqxx txn.exec()
  LIBPQXX_EXEC_PATTERN.lastIndex = 0;
  while ((match = LIBPQXX_EXEC_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('libpqxx');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'postgres' as ORMFramework, 0.9, true, fields
      ));
    }
  }

  // libpqxx txn.exec0()
  LIBPQXX_EXEC0_PATTERN.lastIndex = 0;
  while ((match = LIBPQXX_EXEC0_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('libpqxx');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'postgres' as ORMFramework, 0.9, true, fields
      ));
    }
  }

  // libpqxx txn.exec1()
  LIBPQXX_EXEC1_PATTERN.lastIndex = 0;
  while ((match = LIBPQXX_EXEC1_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('libpqxx');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'postgres' as ORMFramework, 0.9, true, fields
      ));
    }
  }
}

// =============================================================================
// SOCI Extraction
// =============================================================================

function extractSociPatterns(
  source: string,
  filePath: string,
  accessPoints: DataAccessPoint[],
  tables: Set<string>,
  frameworks: Set<string>
): void {
  let match;

  // sql << "..."
  SOCI_SQL_PATTERN.lastIndex = 0;
  while ((match = SOCI_SQL_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('soci');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'soci' as ORMFramework, 0.9, true, fields
      ));
    }
  }

  // soci::statement with prepare
  SOCI_PREPARE_PATTERN.lastIndex = 0;
  while ((match = SOCI_PREPARE_PATTERN.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      frameworks.add('soci');
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'soci' as ORMFramework, 0.9, true, fields
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
  // Pattern for SQL in string literals
  const stringPattern = /"([^"]*(?:SELECT|INSERT|UPDATE|DELETE)[^"]*)"/gi;
  let match;

  while ((match = stringPattern.exec(source)) !== null) {
    const sql = match[1] ?? '';
    const { table, operation, fields } = parseSql(sql);
    
    if (table) {
      tables.add(table);
      
      accessPoints.push(createDataAccessPoint(
        filePath, source, match.index, table, operation,
        'raw-sql' as ORMFramework, 0.7, true, fields
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
 * Detect which C++ database frameworks are used in the source
 */
export function detectCppDatabaseFrameworks(source: string): string[] {
  const frameworks: string[] = [];

  // SQLite
  if (source.includes('sqlite3_') || source.includes('#include <sqlite3.h>')) {
    frameworks.push('sqlite3');
  }
  if (source.includes('SQLite::') || source.includes('#include <SQLiteCpp/')) {
    frameworks.push('sqlitecpp');
  }

  // Qt SQL
  if (source.includes('QSqlQuery') || source.includes('QSqlDatabase') || 
      source.includes('#include <QSql')) {
    frameworks.push('qt-sql');
  }

  // ODBC
  if (source.includes('SQLExec') || source.includes('SQLPrepare') ||
      source.includes('#include <sql.h>') || source.includes('#include <sqlext.h>')) {
    frameworks.push('odbc');
  }

  // MySQL Connector
  if (source.includes('mysql::') || source.includes('#include <mysql') ||
      source.includes('mysqlx::')) {
    frameworks.push('mysql-connector');
  }

  // PostgreSQL
  if (source.includes('PQexec') || source.includes('PQprepare') ||
      source.includes('#include <libpq-fe.h>')) {
    frameworks.push('libpq');
  }
  if (source.includes('pqxx::') || source.includes('#include <pqxx/')) {
    frameworks.push('libpqxx');
  }

  // SOCI
  if (source.includes('soci::') || source.includes('#include <soci/')) {
    frameworks.push('soci');
  }

  return frameworks;
}

/**
 * Check if source contains any database access patterns
 */
export function hasCppDataAccess(source: string): boolean {
  return detectCppDatabaseFrameworks(source).length > 0 ||
         RAW_SQL_PATTERN.test(source);
}
