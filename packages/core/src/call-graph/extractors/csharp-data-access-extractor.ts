/**
 * C# Semantic Data Access Extractor
 *
 * @deprecated This file is deprecated. Use the unified provider system instead:
 * - Import from 'driftdetect-core' or '../unified-provider/compat/index.js'
 * - The compat layer provides the same API but delegates to UnifiedLanguageProvider
 * 
 * This file is kept for reference but is no longer exported from the main index.
 * All data access extraction should go through the unified provider.
 *
 * Extracts data access points from C# using tree-sitter.
 * Provides accurate, semantic-aware detection of database operations.
 * 
 * Supports:
 * - Entity Framework Core: dbContext.Users.Where().ToListAsync()
 * - Dapper: connection.Query<User>("SELECT * FROM users")
 * - ADO.NET: command.ExecuteReader()
 * - Raw SQL via EF: dbContext.Database.ExecuteSqlRaw()
 */

import { BaseDataAccessExtractor, type DataAccessExtractionResult } from './data-access-extractor.js';
import {
  isCSharpTreeSitterAvailable,
  createCSharpParser,
} from '../../parsers/tree-sitter/csharp-loader.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type { CallGraphLanguage } from '../types.js';

/**
 * C# data access extractor using tree-sitter
 * @deprecated Use UnifiedDataAccessAdapter from unified-provider instead
 */
export class CSharpDataAccessExtractor extends BaseDataAccessExtractor {
  readonly language: CallGraphLanguage = 'csharp';
  readonly extensions: string[] = ['.cs'];

  private parser: TreeSitterParser | null = null;

  /**
   * Check if tree-sitter is available for C#
   */
  static isAvailable(): boolean {
    return isCSharpTreeSitterAvailable();
  }

  /**
   * Extract data access points from C# source
   */
  extract(source: string, filePath: string): DataAccessExtractionResult {
    const result = this.createEmptyResult(filePath);

    if (!isCSharpTreeSitterAvailable()) {
      result.errors.push('Tree-sitter not available for C# parsing');
      return result;
    }


    try {
      if (!this.parser) {
        this.parser = createCSharpParser();
      }

      const tree = this.parser.parse(source);
      this.visitNode(tree.rootNode, result, filePath, source);

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  /**
   * Visit AST nodes to find data access patterns
   */
  private visitNode(
    node: TreeSitterNode,
    result: DataAccessExtractionResult,
    filePath: string,
    source: string
  ): void {
    // Check for invocation expressions (method calls)
    if (node.type === 'invocation_expression') {
      this.analyzeInvocation(node, result, filePath, source);
    }

    // Check for LINQ query expressions
    if (node.type === 'query_expression') {
      this.analyzeLinqQuery(node, result, filePath, source);
    }

    // Recurse into children
    for (const child of node.children) {
      this.visitNode(child, result, filePath, source);
    }
  }

  /**
   * Analyze a method invocation for data access patterns
   */
  private analyzeInvocation(
    node: TreeSitterNode,
    result: DataAccessExtractionResult,
    filePath: string,
    source: string
  ): void {
    const chain = this.getInvocationChain(node);
    
    const accessPoint = 
      this.tryEFCorePattern(chain, node, filePath) ||
      this.tryDapperPattern(chain, node, filePath, source) ||
      this.tryAdoNetPattern(chain, node, filePath, source) ||
      this.tryEFRawSqlPattern(chain, node, filePath, source);

    if (accessPoint) {
      const exists = result.accessPoints.some(ap => ap.id === accessPoint.id);
      if (!exists) {
        result.accessPoints.push(accessPoint);
      }
    }
  }

  /**
   * Get the invocation chain from a method call
   */
  private getInvocationChain(node: TreeSitterNode): { names: string[]; node: TreeSitterNode }[] {
    const chain: { names: string[]; node: TreeSitterNode }[] = [];
    let current: TreeSitterNode | null = node;

    while (current) {
      if (current.type === 'invocation_expression') {
        const funcNode = current.childForFieldName('function');
        if (funcNode?.type === 'member_access_expression') {
          const memberName = funcNode.childForFieldName('name')?.text;
          if (memberName) {
            chain.unshift({ names: [memberName], node: current });
          }
          current = funcNode.childForFieldName('expression');
        } else if (funcNode?.type === 'identifier') {
          chain.unshift({ names: [funcNode.text], node: current });
          break;
        } else {
          break;
        }
      } else if (current.type === 'member_access_expression') {
        const memberName = current.childForFieldName('name')?.text;
        if (memberName) {
          chain.unshift({ names: [memberName], node: current });
        }
        current = current.childForFieldName('expression');
      } else if (current.type === 'identifier') {
        chain.unshift({ names: [current.text], node: current });
        break;
      } else {
        break;
      }
    }

    return chain;
  }


  /**
   * Try to match Entity Framework Core pattern
   */
  private tryEFCorePattern(
    chain: { names: string[]; node: TreeSitterNode }[],
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    if (chain.length < 2) {return null;}

    const firstPart = chain[0]?.names[0]?.toLowerCase() ?? '';
    if (!firstPart.includes('context') && !firstPart.includes('db') && !firstPart.startsWith('_')) {
      return null;
    }

    const tablePart = chain[1]?.names[0];
    if (!tablePart || !/^[A-Z]/.test(tablePart)) {return null;}

    const efMethods = {
      read: ['Where', 'FirstOrDefault', 'FirstOrDefaultAsync', 'First', 'FirstAsync', 
             'Single', 'SingleOrDefault', 'SingleAsync', 'SingleOrDefaultAsync',
             'ToList', 'ToListAsync', 'ToArray', 'ToArrayAsync',
             'Find', 'FindAsync', 'Any', 'AnyAsync', 'All', 'AllAsync',
             'Count', 'CountAsync', 'Sum', 'SumAsync', 'Average', 'AverageAsync',
             'Max', 'MaxAsync', 'Min', 'MinAsync', 'Select', 'Include', 'ThenInclude'],
      write: ['Add', 'AddAsync', 'AddRange', 'AddRangeAsync', 
              'Update', 'UpdateRange', 'Attach', 'AttachRange'],
      delete: ['Remove', 'RemoveRange'],
    };

    let operation: DataOperation = 'read';
    const whereFields: string[] = [];

    for (const item of chain) {
      const methodName = item.names[0];
      if (!methodName) {continue;}
      
      if (efMethods.write.includes(methodName)) {
        operation = 'write';
        break;
      }
      if (efMethods.delete.includes(methodName)) {
        operation = 'delete';
        break;
      }

      // Extract fields from Where clause lambda expressions
      if (methodName === 'Where' || methodName === 'FirstOrDefault' || methodName === 'Single' ||
          methodName === 'Any' || methodName === 'All' || methodName === 'Count') {
        const extractedFields = this.extractFieldsFromLambda(item.node);
        whereFields.push(...extractedFields);
      }
    }

    return this.createAccessPoint({
      table: this.inferTableFromName(tablePart),
      fields: whereFields,
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'efcore',
      tableFromLiteral: false, // Table name inferred from DbSet property name
    });
  }

  /**
   * Extract field names from lambda expressions in Where clauses
   * e.g., .Where(u => u.Email == email) -> ['Email']
   */
  private extractFieldsFromLambda(node: TreeSitterNode): string[] {
    const fields: string[] = [];
    
    // Find lambda expression in arguments
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) {return fields;}

    // Recursively search for member access expressions
    const findMemberAccess = (n: TreeSitterNode): void => {
      if (n.type === 'member_access_expression') {
        const memberName = n.childForFieldName('name')?.text;
        if (memberName && /^[A-Z]/.test(memberName)) {
          fields.push(memberName);
        }
      }
      for (const child of n.children) {
        findMemberAccess(child);
      }
    };

    findMemberAccess(argsNode);
    return [...new Set(fields)];
  }

  /**
   * Try to match Dapper pattern
   */
  private tryDapperPattern(
    chain: { names: string[]; node: TreeSitterNode }[],
    node: TreeSitterNode,
    filePath: string,
    _source: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    const dapperMethods = ['Query', 'QueryAsync', 'QueryFirst', 'QueryFirstAsync',
                          'QueryFirstOrDefault', 'QueryFirstOrDefaultAsync',
                          'QuerySingle', 'QuerySingleAsync', 'QuerySingleOrDefault',
                          'QuerySingleOrDefaultAsync', 'QueryMultiple', 'QueryMultipleAsync',
                          'Execute', 'ExecuteAsync', 'ExecuteScalar', 'ExecuteScalarAsync'];

    const methodItem = chain.find(item => dapperMethods.includes(item.names[0] ?? ''));
    if (!methodItem) {return null;}

    const argsNode = methodItem.node.childForFieldName('arguments');
    if (!argsNode) {return null;}

    let sqlText = '';
    for (const arg of argsNode.children) {
      if (arg.type === 'argument') {
        const expr = arg.childForFieldName('expression');
        if (expr?.type === 'string_literal' || expr?.type === 'verbatim_string_literal') {
          sqlText = expr.text.replace(/^[@$]?"/, '').replace(/"$/, '');
          break;
        }
      }
    }

    if (!sqlText) {return null;}

    const { table, operation, fields } = this.parseSQLStatement(sqlText);
    if (!table || table === 'unknown') {return null;}

    return this.createAccessPoint({
      table,
      fields,
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      isRawSql: true,
      framework: 'dapper',
      tableFromLiteral: true, // Table name extracted from SQL string
    });
  }


  /**
   * Try to match ADO.NET pattern
   */
  private tryAdoNetPattern(
    chain: { names: string[]; node: TreeSitterNode }[],
    node: TreeSitterNode,
    filePath: string,
    _source: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    const adoMethods = {
      read: ['ExecuteReader', 'ExecuteReaderAsync', 'ExecuteScalar', 'ExecuteScalarAsync'],
      write: ['ExecuteNonQuery', 'ExecuteNonQueryAsync'],
    };

    let operation: DataOperation | null = null;
    for (const item of chain) {
      const methodName = item.names[0] ?? '';
      if (adoMethods.read.includes(methodName)) {
        operation = 'read';
        break;
      }
      if (adoMethods.write.includes(methodName)) {
        operation = 'write';
        break;
      }
    }

    if (!operation) {return null;}

    return this.createAccessPoint({
      table: 'unknown',
      fields: [],
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      isRawSql: true,
      framework: 'raw-sql',
      tableFromLiteral: false, // Table name unknown for ADO.NET without SQL parsing
    });
  }

  /**
   * Try to match EF Core raw SQL pattern
   */
  private tryEFRawSqlPattern(
    chain: { names: string[]; node: TreeSitterNode }[],
    node: TreeSitterNode,
    filePath: string,
    _source: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    const rawSqlMethods = ['ExecuteSqlRaw', 'ExecuteSqlRawAsync', 
                          'ExecuteSqlInterpolated', 'ExecuteSqlInterpolatedAsync',
                          'FromSqlRaw', 'FromSqlInterpolated'];

    const methodItem = chain.find(item => rawSqlMethods.includes(item.names[0] ?? ''));
    if (!methodItem) {return null;}

    if (!chain.some(item => item.names[0] === 'Database')) {return null;}

    const argsNode = methodItem.node.childForFieldName('arguments');
    if (!argsNode) {return null;}

    let sqlText = '';
    for (const arg of argsNode.children) {
      if (arg.type === 'argument') {
        const expr = arg.childForFieldName('expression');
        if (expr?.type === 'string_literal' || expr?.type === 'verbatim_string_literal' ||
            expr?.type === 'interpolated_string_expression') {
          sqlText = expr.text.replace(/^[@$]?"/, '').replace(/"$/, '');
          break;
        }
      }
    }

    if (!sqlText) {return null;}

    const { table, operation, fields } = this.parseSQLStatement(sqlText);

    return this.createAccessPoint({
      table: table || 'unknown',
      fields,
      operation: operation || 'unknown',
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      isRawSql: true,
      framework: 'efcore',
      tableFromLiteral: true, // Table name extracted from SQL string
    });
  }

  /**
   * Analyze LINQ query expressions
   */
  private analyzeLinqQuery(
    node: TreeSitterNode,
    result: DataAccessExtractionResult,
    filePath: string,
    _source: string
  ): void {
    const fromClause = node.children.find(c => c.type === 'from_clause');
    if (!fromClause) {return;}

    const inExpr = fromClause.childForFieldName('expression');
    if (!inExpr) {return;}

    let tableName = 'unknown';
    if (inExpr.type === 'member_access_expression') {
      const memberName = inExpr.childForFieldName('name')?.text;
      if (memberName && /^[A-Z]/.test(memberName)) {
        tableName = this.inferTableFromName(memberName);
      }
    }

    const accessPoint = this.createAccessPoint({
      table: tableName,
      fields: [],
      operation: 'read',
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'efcore',
      tableFromLiteral: false, // Table name inferred from LINQ source
    });

    const exists = result.accessPoints.some(ap => ap.id === accessPoint.id);
    if (!exists) {
      result.accessPoints.push(accessPoint);
    }
  }

  /**
   * Parse a SQL statement to extract table, operation, and fields
   */
  private parseSQLStatement(sql: string): { table: string; operation: DataOperation; fields: string[] } {
    const upperSql = sql.toUpperCase().trim();
    let operation: DataOperation = 'unknown';
    let table = 'unknown';
    const fields: string[] = [];

    if (upperSql.startsWith('SELECT')) {operation = 'read';}
    else if (upperSql.startsWith('INSERT')) {operation = 'write';}
    else if (upperSql.startsWith('UPDATE')) {operation = 'write';}
    else if (upperSql.startsWith('DELETE')) {operation = 'delete';}

    const fromMatch = sql.match(/FROM\s+["'`\[]?(\w+)["'`\]]?/i);
    const intoMatch = sql.match(/INTO\s+["'`\[]?(\w+)["'`\]]?/i);
    const updateMatch = sql.match(/UPDATE\s+["'`\[]?(\w+)["'`\]]?/i);

    if (fromMatch?.[1]) {table = fromMatch[1];}
    else if (intoMatch?.[1]) {table = intoMatch[1];}
    else if (updateMatch?.[1]) {table = updateMatch[1];}

    return { table, operation, fields };
  }
}

/**
 * Create a C# data access extractor
 */
export function createCSharpDataAccessExtractor(): CSharpDataAccessExtractor {
  return new CSharpDataAccessExtractor();
}
