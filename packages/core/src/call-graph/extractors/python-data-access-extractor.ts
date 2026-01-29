/**
 * Python Semantic Data Access Extractor
 *
 * @deprecated This file is deprecated. Use the unified provider system instead:
 * - Import from 'driftdetect-core' or '../unified-provider/compat/index.js'
 * - The compat layer provides the same API but delegates to UnifiedLanguageProvider
 * 
 * This file is kept for reference but is no longer exported from the main index.
 * All data access extraction should go through the unified provider.
 *
 * Extracts data access points from Python using tree-sitter.
 * Provides accurate, semantic-aware detection of database operations.
 * 
 * Supports:
 * - Django ORM: User.objects.filter()
 * - SQLAlchemy: session.query(User).filter()
 * - Supabase Python: supabase.table('users').select()
 * - Raw SQL: cursor.execute('SELECT * FROM users')
 * - Tortoise ORM: await User.filter()
 * - Peewee: User.select()
 */

import { BaseDataAccessExtractor, type DataAccessExtractionResult } from './data-access-extractor.js';
import { isTreeSitterAvailable, createPythonParser } from '../../parsers/tree-sitter/loader.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type { CallGraphLanguage } from '../types.js';

/**
 * Python data access extractor using tree-sitter
 * @deprecated Use UnifiedDataAccessAdapter from unified-provider instead
 */
export class PythonDataAccessExtractor extends BaseDataAccessExtractor {
  readonly language: CallGraphLanguage = 'python';
  readonly extensions: string[] = ['.py', '.pyw', '.pyi'];

  private parser: TreeSitterParser | null = null;

  /**
   * Check if tree-sitter is available
   */
  static isAvailable(): boolean {
    return isTreeSitterAvailable();
  }

  /**
   * Extract data access points from Python source
   */
  extract(source: string, filePath: string): DataAccessExtractionResult {
    const result = this.createEmptyResult(filePath);

    if (!isTreeSitterAvailable()) {
      result.errors.push('Tree-sitter not available for Python parsing');
      return result;
    }

    try {
      if (!this.parser) {
        this.parser = createPythonParser();
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
    // Check for call expressions
    if (node.type === 'call') {
      this.analyzeCallExpression(node, result, filePath, source);
    }

    // Recurse into children
    for (const child of node.children) {
      this.visitNode(child, result, filePath, source);
    }
  }

  /**
   * Analyze a call expression for data access patterns
   */
  private analyzeCallExpression(
    node: TreeSitterNode,
    result: DataAccessExtractionResult,
    filePath: string,
    source: string
  ): void {
    // Get the full call chain
    const chain = this.getCallChain(node);
    
    // Try each pattern
    const accessPoint = 
      this.tryDjangoPattern(chain, node, filePath, source) ||
      this.trySQLAlchemyPattern(chain, node, filePath, source) ||
      this.trySupabasePythonPattern(chain, node, filePath, source) ||
      this.tryTortoisePattern(chain, node, filePath, source) ||
      this.tryPeeweePattern(chain, node, filePath, source) ||
      this.tryRawSQLPattern(chain, node, filePath, source);

    if (accessPoint) {
      // Avoid duplicates
      const exists = result.accessPoints.some(ap => ap.id === accessPoint.id);
      if (!exists) {
        result.accessPoints.push(accessPoint);
      }
    }
  }

  /**
   * Get the call chain from a call expression
   * e.g., User.objects.filter() -> ['User', 'objects', 'filter']
   */
  private getCallChain(node: TreeSitterNode): { names: string[]; args: TreeSitterNode[][] } {
    const names: string[] = [];
    const args: TreeSitterNode[][] = [];
    
    let current: TreeSitterNode | null = node;
    
    while (current) {
      if (current.type === 'call') {
        // Get arguments
        const argsNode = current.childForFieldName('arguments');
        if (argsNode) {
          const argList: TreeSitterNode[] = [];
          for (const child of argsNode.children) {
            if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
              argList.push(child);
            }
          }
          args.unshift(argList);
        } else {
          args.unshift([]);
        }
        
        const funcNode = current.childForFieldName('function');
        if (!funcNode) {break;}
        
        if (funcNode.type === 'attribute') {
          const attrNode = funcNode.childForFieldName('attribute');
          if (attrNode) {
            names.unshift(attrNode.text);
          }
          const objNode = funcNode.childForFieldName('object');
          current = objNode;
        } else if (funcNode.type === 'identifier') {
          names.unshift(funcNode.text);
          break;
        } else {
          break;
        }
      } else if (current.type === 'attribute') {
        const attrNode = current.childForFieldName('attribute');
        if (attrNode) {
          names.unshift(attrNode.text);
        }
        const objNode = current.childForFieldName('object');
        current = objNode;
      } else if (current.type === 'identifier') {
        names.unshift(current.text);
        break;
      } else {
        break;
      }
    }
    
    return { names, args };
  }

  /**
   * Try to match Django ORM pattern: Model.objects.filter()
   */
  private tryDjangoPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string,
    _source: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    // Look for .objects. in the chain
    const objectsIndex = chain.names.indexOf('objects');
    if (objectsIndex === -1 || objectsIndex === 0) {return null;}

    // Model name is before 'objects'
    const modelName = chain.names[objectsIndex - 1];
    if (!modelName || !/^[A-Z]/.test(modelName)) {return null;}

    // Method is after 'objects'
    const methodName = chain.names[objectsIndex + 1];
    if (!methodName) {return null;}

    const djangoMethods = ['get', 'filter', 'exclude', 'all', 'first', 'last', 'create', 'update', 'delete', 
                          'get_or_create', 'update_or_create', 'bulk_create', 'bulk_update', 'count', 'exists',
                          'values', 'values_list', 'annotate', 'aggregate', 'order_by', 'distinct'];
    if (!djangoMethods.includes(methodName)) {return null;}

    const operation = this.detectOperation(methodName);
    if (!operation) {return null;}

    // Extract fields from values() or values_list()
    let fields: string[] = [];
    const whereFields: string[] = [];

    if (methodName === 'values' || methodName === 'values_list') {
      const methodArgs = chain.args[objectsIndex + 1];
      if (methodArgs) {
        fields = this.extractStringArgs(methodArgs);
      }
    }

    // Extract fields from filter/exclude/get kwargs
    if (methodName === 'filter' || methodName === 'exclude' || methodName === 'get') {
      const methodArgs = chain.args[objectsIndex + 1];
      if (methodArgs) {
        for (const arg of methodArgs) {
          if (arg.type === 'keyword_argument') {
            const nameNode = arg.childForFieldName('name');
            if (nameNode) {
              // Django uses field__lookup syntax, extract base field
              const fieldName = nameNode.text.split('__')[0];
              if (fieldName) {
                whereFields.push(fieldName);
              }
            }
          }
        }
      }
    }

    // Merge fields
    const allFields = [...new Set([...fields, ...whereFields])];

    return this.createAccessPoint({
      table: this.inferTableFromName(modelName),
      fields: allFields,
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'django',
      tableFromLiteral: false, // Table name inferred from model name
    });
  }

  /**
   * Try to match SQLAlchemy pattern: session.query(Model).filter()
   */
  private trySQLAlchemyPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string,
    _source: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    // Look for .query() in the chain
    const queryIndex = chain.names.indexOf('query');
    if (queryIndex === -1) {return null;}

    // Get model from query(Model) argument
    const queryArgs = chain.args[queryIndex];
    if (!queryArgs || queryArgs.length === 0) {return null;}

    const modelArg = queryArgs[0];
    if (modelArg?.type !== 'identifier') {return null;}

    const modelName = modelArg.text;
    if (!/^[A-Z]/.test(modelName)) {return null;}

    // Determine operation from chain
    let operation: DataOperation = 'read';
    for (let i = queryIndex + 1; i < chain.names.length; i++) {
      const method = chain.names[i];
      if (method === 'delete') {
        operation = 'delete';
        break;
      }
      if (method === 'update') {
        operation = 'write';
        break;
      }
    }

    // Check for session.add/delete patterns
    if (chain.names.includes('add') || chain.names.includes('add_all') || chain.names.includes('merge')) {
      operation = 'write';
    }

    return this.createAccessPoint({
      table: this.inferTableFromName(modelName),
      fields: [],
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'sqlalchemy',
      tableFromLiteral: false, // Table name inferred from model name
    });
  }

  /**
   * Try to match Supabase Python pattern: supabase.table('users').select()
   */
  private trySupabasePythonPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string,
    _source: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    // Look for .table() or .from() in the chain
    const tableIndex = chain.names.findIndex(n => n === 'table' || n === 'from');
    if (tableIndex === -1) {return null;}

    // Check if it looks like supabase
    const firstPart = chain.names[0]?.toLowerCase();
    if (!firstPart?.includes('supabase') && !firstPart?.includes('client')) {return null;}

    // Get table name from .table('name') or .from('name')
    const tableArgs = chain.args[tableIndex];
    if (!tableArgs || tableArgs.length === 0) {return null;}

    const tableArg = tableArgs[0];
    if (tableArg?.type !== 'string') {return null;}

    // Extract string content (remove quotes)
    const table = tableArg.text.replace(/^['"]|['"]$/g, '');

    // Determine operation
    let operation: DataOperation = 'read';
    let fields: string[] = [];
    const whereFields: string[] = [];

    for (let i = tableIndex + 1; i < chain.names.length; i++) {
      const method = chain.names[i];
      const methodArgs = chain.args[i];

      if (method === 'select' && methodArgs && methodArgs.length > 0) {
        const selectArg = methodArgs[0];
        if (selectArg?.type === 'string') {
          fields = this.extractFieldsFromString(selectArg.text.replace(/^['"]|['"]$/g, ''));
        }
        operation = 'read';
      } else if (method === 'insert' || method === 'upsert') {
        operation = 'write';
      } else if (method === 'update') {
        operation = 'write';
      } else if (method === 'delete') {
        operation = 'delete';
      }
      // Extract fields from where clause methods
      else if (method && this.isWhereClauseMethod(method) && methodArgs && methodArgs.length > 0) {
        const fieldName = this.extractWhereClauseField(methodArgs);
        if (fieldName) {
          whereFields.push(fieldName);
        }
      }
    }

    // Merge select fields with where clause fields (deduplicated)
    const allFields = [...new Set([...fields, ...whereFields])];

    return this.createAccessPoint({
      table,
      fields: allFields,
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'supabase',
      tableFromLiteral: true, // Table name from string literal in .table('name')
    });
  }

  /**
   * Check if a method name is a where clause method
   */
  private isWhereClauseMethod(method: string): boolean {
    const whereClauseMethods = [
      // Supabase/PostgREST
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is_', 'in_',
      'contains', 'contained_by', 'range_gt', 'range_gte', 'range_lt', 'range_lte',
      'range_adjacent', 'overlaps', 'text_search', 'match', 'not_', 'or_', 'filter',
      // Django ORM
      'filter', 'exclude', 'get',
      // SQLAlchemy
      'filter', 'filter_by', 'where',
      // Peewee
      'where',
    ];
    return whereClauseMethods.includes(method);
  }

  /**
   * Extract field name from a where clause method call
   */
  private extractWhereClauseField(args: TreeSitterNode[]): string | null {
    if (args.length === 0) {return null;}

    const firstArg = args[0];
    if (!firstArg) {return null;}

    // String argument: .eq('email', value)
    if (firstArg.type === 'string') {
      return firstArg.text.replace(/^['"]|['"]$/g, '');
    }

    // Keyword argument: filter(email=value) - extract from keyword_argument
    if (firstArg.type === 'keyword_argument') {
      const nameNode = firstArg.childForFieldName('name');
      if (nameNode) {
        return nameNode.text;
      }
    }

    // Identifier
    if (firstArg.type === 'identifier') {
      return firstArg.text;
    }

    return null;
  }

  /**
   * Try to match Tortoise ORM pattern: await Model.filter()
   */
  private tryTortoisePattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string,
    _source: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    if (chain.names.length < 2) {return null;}

    const modelName = chain.names[0];
    const methodName = chain.names[1];

    if (!modelName || !methodName) {return null;}
    if (!/^[A-Z]/.test(modelName)) {return null;}

    const tortoiseMethods = ['filter', 'get', 'get_or_none', 'all', 'first', 'create', 'update', 'delete',
                            'get_or_create', 'update_or_create', 'bulk_create', 'bulk_update', 'count', 'exists'];
    if (!tortoiseMethods.includes(methodName)) {return null;}

    // Skip if it looks like Django (has .objects)
    if (chain.names.includes('objects')) {return null;}

    const operation = this.detectOperation(methodName);
    if (!operation) {return null;}

    return this.createAccessPoint({
      table: this.inferTableFromName(modelName),
      fields: [],
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'tortoise',
      tableFromLiteral: false, // Table name inferred from model name
    });
  }

  /**
   * Try to match Peewee pattern: Model.select()
   */
  private tryPeeweePattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string,
    _source: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    if (chain.names.length < 2) {return null;}

    const modelName = chain.names[0];
    const methodName = chain.names[1];

    if (!modelName || !methodName) {return null;}
    if (!/^[A-Z]/.test(modelName)) {return null;}

    const peeweeMethods = ['select', 'get', 'get_or_none', 'get_or_create', 'create', 'insert', 'insert_many',
                          'update', 'delete', 'delete_instance'];
    if (!peeweeMethods.includes(methodName)) {return null;}

    // Skip if it looks like Django (has .objects)
    if (chain.names.includes('objects')) {return null;}

    const operation = this.detectOperation(methodName);
    if (!operation) {return null;}

    return this.createAccessPoint({
      table: this.inferTableFromName(modelName),
      fields: [],
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'peewee',
      tableFromLiteral: false, // Table name inferred from model name
    });
  }

  /**
   * Try to match raw SQL pattern: cursor.execute('SELECT * FROM users')
   */
  private tryRawSQLPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string,
    _source: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    // Look for execute/executemany/raw methods
    const sqlMethods = ['execute', 'executemany', 'raw', 'executescript', 'mogrify'];
    const methodIndex = chain.names.findIndex(n => sqlMethods.includes(n));
    
    if (methodIndex === -1) {return null;}

    const methodArgs = chain.args[methodIndex];
    if (!methodArgs || methodArgs.length === 0) {return null;}

    const sqlArg = methodArgs[0];
    if (!sqlArg) {return null;}

    let sqlText = '';
    if (sqlArg.type === 'string') {
      sqlText = sqlArg.text.replace(/^['"]|['"]$/g, '').replace(/^f['"]|['"]$/g, '');
    } else if (sqlArg.type === 'concatenated_string') {
      // Handle multi-line strings
      sqlText = sqlArg.text;
    }

    if (!sqlText) {return null;}

    // Parse SQL to extract table and operation
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
      framework: 'raw-sql',
      tableFromLiteral: true, // Table name extracted from SQL string
    });
  }

  /**
   * Parse a SQL statement to extract table, operation, and fields
   */
  private parseSQLStatement(sql: string): { table: string; operation: DataOperation; fields: string[] } {
    const upperSql = sql.toUpperCase().trim();
    let operation: DataOperation = 'unknown';
    let table = 'unknown';
    const fields: string[] = [];

    // Determine operation
    if (upperSql.startsWith('SELECT')) {
      operation = 'read';
    } else if (upperSql.startsWith('INSERT')) {
      operation = 'write';
    } else if (upperSql.startsWith('UPDATE')) {
      operation = 'write';
    } else if (upperSql.startsWith('DELETE')) {
      operation = 'delete';
    }

    // Extract table name
    const fromMatch = sql.match(/FROM\s+["'`]?(\w+)["'`]?/i);
    const intoMatch = sql.match(/INTO\s+["'`]?(\w+)["'`]?/i);
    const updateMatch = sql.match(/UPDATE\s+["'`]?(\w+)["'`]?/i);

    if (fromMatch?.[1]) {table = fromMatch[1];}
    else if (intoMatch?.[1]) {table = intoMatch[1];}
    else if (updateMatch?.[1]) {table = updateMatch[1];}

    // Extract fields from SELECT
    if (operation === 'read') {
      const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
      if (selectMatch?.[1] && selectMatch[1] !== '*') {
        const fieldList = selectMatch[1].split(',').map(f => f.trim());
        for (const field of fieldList) {
          const fieldName = field.split(/\s+as\s+/i)[0]?.trim();
          if (fieldName && !fieldName.includes('(')) {
            fields.push(fieldName.replace(/["'`]/g, ''));
          }
        }
      }
    }

    return { table, operation, fields };
  }

  /**
   * Extract string arguments from a list of nodes
   */
  private extractStringArgs(args: TreeSitterNode[]): string[] {
    const strings: string[] = [];
    for (const arg of args) {
      if (arg.type === 'string') {
        strings.push(arg.text.replace(/^['"]|['"]$/g, ''));
      }
    }
    return strings;
  }
}

/**
 * Create a Python data access extractor
 */
export function createPythonDataAccessExtractor(): PythonDataAccessExtractor {
  return new PythonDataAccessExtractor();
}
