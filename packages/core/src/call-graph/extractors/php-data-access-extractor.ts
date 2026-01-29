/**
 * PHP Semantic Data Access Extractor
 *
 * @deprecated This file is deprecated. Use the unified provider system instead:
 * - Import from 'driftdetect-core' or '../unified-provider/compat/index.js'
 * - The compat layer provides the same API but delegates to UnifiedLanguageProvider
 * 
 * This file is kept for reference but is no longer exported from the main index.
 * All data access extraction should go through the unified provider.
 *
 * Extracts data access points from PHP using tree-sitter.
 * Provides accurate, semantic-aware detection of database operations.
 * 
 * Supports:
 * - Laravel Eloquent: User::where()->get(), $user->save()
 * - Laravel Query Builder: DB::table('users')->get()
 * - Doctrine ORM: $em->getRepository()->find()
 * - PDO: $pdo->query("SELECT...")
 * - Raw SQL: DB::select("SELECT...")
 */

import { BaseDataAccessExtractor, type DataAccessExtractionResult } from './data-access-extractor.js';
import {
  isPhpTreeSitterAvailable,
  createPhpParser,
} from '../../parsers/tree-sitter/php-loader.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type { CallGraphLanguage } from '../types.js';

/**
 * PHP data access extractor using tree-sitter
 * @deprecated Use UnifiedDataAccessAdapter from unified-provider instead
 */
export class PhpDataAccessExtractor extends BaseDataAccessExtractor {
  readonly language: CallGraphLanguage = 'php';
  readonly extensions: string[] = ['.php'];

  private parser: TreeSitterParser | null = null;

  /**
   * Check if tree-sitter is available for PHP
   */
  static isAvailable(): boolean {
    return isPhpTreeSitterAvailable();
  }

  /**
   * Extract data access points from PHP source
   */
  extract(source: string, filePath: string): DataAccessExtractionResult {
    const result = this.createEmptyResult(filePath);

    if (!isPhpTreeSitterAvailable()) {
      result.errors.push('Tree-sitter not available for PHP parsing');
      return result;
    }


    try {
      if (!this.parser) {
        this.parser = createPhpParser();
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
    // Check for method calls (->method())
    if (node.type === 'member_call_expression') {
      this.analyzeMemberCall(node, result, filePath, source);
    }

    // Check for static method calls (Class::method())
    if (node.type === 'scoped_call_expression') {
      this.analyzeStaticCall(node, result, filePath, source);
    }

    // Recurse into children
    for (const child of node.children) {
      this.visitNode(child, result, filePath, source);
    }
  }

  /**
   * Analyze a member call expression (->method())
   */
  private analyzeMemberCall(
    node: TreeSitterNode,
    result: DataAccessExtractionResult,
    filePath: string,
    _source: string
  ): void {
    const chain = this.getCallChain(node);
    
    const accessPoint = 
      this.tryEloquentInstancePattern(chain, node, filePath) ||
      this.tryDoctrinePattern(chain, node, filePath) ||
      this.tryPdoPattern(chain, node, filePath);

    if (accessPoint) {
      const exists = result.accessPoints.some(ap => ap.id === accessPoint.id);
      if (!exists) {
        result.accessPoints.push(accessPoint);
      }
    }
  }

  /**
   * Analyze a static call expression (Class::method())
   */
  private analyzeStaticCall(
    node: TreeSitterNode,
    result: DataAccessExtractionResult,
    filePath: string,
    _source: string
  ): void {
    const chain = this.getStaticCallChain(node);
    
    const accessPoint = 
      this.tryEloquentStaticPattern(chain, node, filePath) ||
      this.tryLaravelDbPattern(chain, node, filePath);

    if (accessPoint) {
      const exists = result.accessPoints.some(ap => ap.id === accessPoint.id);
      if (!exists) {
        result.accessPoints.push(accessPoint);
      }
    }
  }

  /**
   * Get the call chain from a member call expression
   */
  private getCallChain(node: TreeSitterNode): { names: string[]; args: TreeSitterNode[][] } {
    const names: string[] = [];
    const args: TreeSitterNode[][] = [];
    
    let current: TreeSitterNode | null = node;
    
    while (current) {
      if (current.type === 'member_call_expression') {
        const nameNode = current.childForFieldName('name');
        if (nameNode) {
          names.unshift(nameNode.text);
        }
        
        const argsNode = current.childForFieldName('arguments');
        if (argsNode) {
          const argList: TreeSitterNode[] = [];
          for (const child of argsNode.children) {
            if (child.type !== '(' && child.type !== ')' && child.type !== ',' && child.type !== 'argument') {
              argList.push(child);
            } else if (child.type === 'argument') {
              argList.push(child);
            }
          }
          args.unshift(argList);
        } else {
          args.unshift([]);
        }
        
        current = current.childForFieldName('object');
      } else if (current.type === 'member_access_expression') {
        const nameNode = current.childForFieldName('name');
        if (nameNode) {
          names.unshift(nameNode.text);
          args.unshift([]);
        }
        current = current.childForFieldName('object');
      } else if (current.type === 'variable_name' || current.type === 'name') {
        names.unshift(current.text.replace(/^\$/, ''));
        args.unshift([]);
        break;
      } else {
        break;
      }
    }
    
    return { names, args };
  }

  /**
   * Get the call chain from a static call expression
   */
  private getStaticCallChain(node: TreeSitterNode): { className: string; names: string[]; args: TreeSitterNode[][] } {
    const names: string[] = [];
    const args: TreeSitterNode[][] = [];
    let className = '';
    
    // Get the class name
    const scopeNode = node.childForFieldName('scope');
    if (scopeNode) {
      className = scopeNode.text;
    }
    
    // Get the method name
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      names.push(nameNode.text);
    }
    
    // Get arguments
    const argsNode = node.childForFieldName('arguments');
    if (argsNode) {
      const argList: TreeSitterNode[] = [];
      for (const child of argsNode.children) {
        if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
          argList.push(child);
        }
      }
      args.push(argList);
    } else {
      args.push([]);
    }
    
    // Check if there's a chained call
    let parent = node.parent;
    while (parent) {
      if (parent.type === 'member_call_expression') {
        const chainNameNode = parent.childForFieldName('name');
        if (chainNameNode) {
          names.push(chainNameNode.text);
        }
        const chainArgsNode = parent.childForFieldName('arguments');
        if (chainArgsNode) {
          const argList: TreeSitterNode[] = [];
          for (const child of chainArgsNode.children) {
            if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
              argList.push(child);
            }
          }
          args.push(argList);
        } else {
          args.push([]);
        }
      }
      parent = parent.parent;
    }
    
    return { className, names, args };
  }


  /**
   * Try to match Laravel Eloquent static pattern
   * e.g., User::where('active', true)->get(), User::find(1)
   */
  private tryEloquentStaticPattern(
    chain: { className: string; names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    const { className, names, args } = chain;
    
    if (!className || names.length === 0) {return null;}

    // Skip if it's DB:: (handled separately)
    if (className === 'DB') {return null;}

    // Check if it looks like a model (PascalCase, not a framework class)
    if (!/^[A-Z]/.test(className)) {return null;}
    const frameworkClasses = ['App', 'Auth', 'Cache', 'Config', 'Cookie', 'Crypt', 
                             'Event', 'File', 'Gate', 'Hash', 'Http', 'Lang', 
                             'Log', 'Mail', 'Notification', 'Queue', 'Redirect',
                             'Request', 'Response', 'Route', 'Schema', 'Session',
                             'Storage', 'URL', 'Validator', 'View'];
    if (frameworkClasses.includes(className)) {return null;}

    const eloquentMethods = {
      read: ['find', 'findOrFail', 'findMany', 'findOrNew', 'first', 'firstOrFail',
             'firstOrNew', 'firstOrCreate', 'firstWhere', 'get', 'all', 'pluck',
             'value', 'count', 'max', 'min', 'avg', 'sum', 'exists', 'doesntExist',
             'where', 'whereIn', 'whereNotIn', 'whereBetween', 'whereNull',
             'whereNotNull', 'whereDate', 'whereMonth', 'whereDay', 'whereYear',
             'whereTime', 'whereColumn', 'orWhere', 'orderBy', 'latest', 'oldest',
             'take', 'limit', 'skip', 'offset', 'with', 'withCount', 'has', 'whereHas'],
      write: ['create', 'insert', 'insertOrIgnore', 'insertGetId', 'update',
              'updateOrCreate', 'updateOrInsert', 'upsert', 'increment', 'decrement'],
      delete: ['delete', 'destroy', 'forceDelete', 'truncate'],
    };

    // Where clause methods that take field as first argument
    const whereClauseMethods = ['where', 'whereIn', 'whereNotIn', 'whereBetween', 
                                'whereNull', 'whereNotNull', 'whereDate', 'whereMonth',
                                'whereDay', 'whereYear', 'whereTime', 'whereColumn',
                                'orWhere', 'firstWhere', 'whereHas'];

    let operation: DataOperation | null = null;
    const whereFields: string[] = [];
    const firstMethod = names[0];

    // Check all methods in chain for operation type and extract where fields
    for (let i = 0; i < names.length; i++) {
      const method = names[i];
      const methodArgs = args[i];

      if (!method) {continue;}

      if (eloquentMethods.write.includes(method)) {
        operation = 'write';
        break;
      }
      if (eloquentMethods.delete.includes(method)) {
        operation = 'delete';
        break;
      }

      // Extract fields from where clause methods
      if (whereClauseMethods.includes(method) && methodArgs && methodArgs.length > 0) {
        const fieldName = this.extractWhereClauseField(methodArgs);
        if (fieldName) {
          whereFields.push(fieldName);
        }
      }
    }

    // Default to read if we have query methods
    if (!operation && firstMethod) {
      if (eloquentMethods.read.includes(firstMethod)) {
        operation = 'read';
      }
    }

    if (!operation) {return null;}

    return this.createAccessPoint({
      table: this.inferTableFromName(className),
      fields: [...new Set(whereFields)],
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'eloquent',
      tableFromLiteral: false, // Table name inferred from model class name
    });
  }

  /**
   * Extract field name from a where clause method call
   */
  private extractWhereClauseField(args: TreeSitterNode[]): string | null {
    if (args.length === 0) {return null;}

    const firstArg = args[0];
    if (!firstArg) {return null;}

    // Handle argument wrapper
    const actualArg = firstArg.type === 'argument' ? firstArg.namedChildren[0] : firstArg;
    if (!actualArg) {return null;}

    // String argument: ->where('email', value)
    const strValue = this.extractStringValue(actualArg);
    if (strValue) {
      return strValue;
    }

    return null;
  }

  /**
   * Try to match Laravel DB facade pattern
   * e.g., DB::table('users')->get(), DB::select("SELECT...")
   */
  private tryLaravelDbPattern(
    chain: { className: string; names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    const { className, names, args } = chain;
    
    if (className !== 'DB') {return null;}
    if (names.length === 0) {return null;}

    const firstMethod = names[0];
    const firstArgs = args[0];

    // DB::table('users') pattern
    if (firstMethod === 'table' && firstArgs && firstArgs.length > 0 && firstArgs[0]) {
      const tableArg = firstArgs[0];
      const table = this.extractStringValue(tableArg);
      
      if (!table) {return null;}

      // Where clause methods
      const whereClauseMethods = ['where', 'whereIn', 'whereNotIn', 'whereBetween', 
                                  'whereNull', 'whereNotNull', 'orWhere'];

      // Determine operation from chained methods and extract where fields
      let operation: DataOperation = 'read';
      const whereFields: string[] = [];

      for (let i = 1; i < names.length; i++) {
        const method = names[i];
        const methodArgs = args[i];

        if (!method) {continue;}

        if (['insert', 'insertOrIgnore', 'insertGetId', 'update', 'upsert',
             'increment', 'decrement'].includes(method)) {
          operation = 'write';
          break;
        }
        if (['delete', 'truncate'].includes(method)) {
          operation = 'delete';
          break;
        }

        // Extract fields from where clause methods
        if (whereClauseMethods.includes(method) && methodArgs && methodArgs.length > 0) {
          const fieldName = this.extractWhereClauseField(methodArgs);
          if (fieldName) {
            whereFields.push(fieldName);
          }
        }
      }

      return this.createAccessPoint({
        table,
        fields: [...new Set(whereFields)],
        operation,
        file: filePath,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        context: node.text.slice(0, 200),
        framework: 'eloquent',
        tableFromLiteral: true, // Table name from string literal in DB::table('name')
      });
    }

    // DB::select(), DB::insert(), DB::update(), DB::delete() with raw SQL
    const rawMethods = {
      read: ['select', 'selectOne'],
      write: ['insert', 'update', 'statement'],
      delete: ['delete'],
    };

    let operation: DataOperation | null = null;
    if (rawMethods.read.includes(firstMethod ?? '')) {operation = 'read';}
    else if (rawMethods.write.includes(firstMethod ?? '')) {operation = 'write';}
    else if (rawMethods.delete.includes(firstMethod ?? '')) {operation = 'delete';}

    if (!operation) {return null;}

    // Try to extract table from SQL
    let table = 'unknown';
    if (firstArgs && firstArgs.length > 0 && firstArgs[0]) {
      const sqlArg = firstArgs[0];
      const sqlText = this.extractStringValue(sqlArg);
      if (sqlText) {
        const parsed = this.parseSQLStatement(sqlText);
        table = parsed.table;
      }
    }

    return this.createAccessPoint({
      table,
      fields: [],
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
   * Try to match Eloquent instance pattern
   * e.g., $user->save(), $user->delete()
   */
  private tryEloquentInstancePattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    if (chain.names.length < 2) {return null;}

    const methodName = chain.names[chain.names.length - 1];
    if (!methodName) {return null;}

    const instanceMethods = {
      write: ['save', 'update', 'push', 'touch', 'increment', 'decrement',
              'fill', 'forceFill', 'refresh', 'replicate'],
      delete: ['delete', 'forceDelete', 'destroy'],
    };

    let operation: DataOperation | null = null;
    if (instanceMethods.write.includes(methodName)) {
      operation = 'write';
    } else if (instanceMethods.delete.includes(methodName)) {
      operation = 'delete';
    }

    if (!operation) {return null;}

    // Try to infer model from variable name
    const varName = chain.names[0] ?? 'unknown';
    const table = this.inferTableFromName(varName);

    return this.createAccessPoint({
      table,
      fields: [],
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'eloquent',
      tableFromLiteral: false, // Table name inferred from variable name
    });
  }

  /**
   * Try to match Doctrine ORM pattern
   * e.g., $em->getRepository(User::class)->find(1)
   */
  private tryDoctrinePattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    // Look for EntityManager patterns
    const hasGetRepository = chain.names.includes('getRepository');
    const hasFind = chain.names.includes('find') || chain.names.includes('findOneBy') ||
                   chain.names.includes('findBy') || chain.names.includes('findAll');
    const hasPersist = chain.names.includes('persist');
    const hasRemove = chain.names.includes('remove');
    const hasFlush = chain.names.includes('flush');

    if (!hasGetRepository && !hasPersist && !hasRemove) {return null;}

    let operation: DataOperation = 'read';
    if (hasPersist || hasFlush) {operation = 'write';}
    if (hasRemove) {operation = 'delete';}
    if (hasFind) {operation = 'read';}

    // Try to extract entity class from getRepository(Entity::class)
    let table = 'unknown';
    const repoIdx = chain.names.indexOf('getRepository');
    if (repoIdx !== -1 && chain.args[repoIdx]) {
      const repoArgs = chain.args[repoIdx];
      if (repoArgs && repoArgs.length > 0 && repoArgs[0]) {
        const entityArg = repoArgs[0];
        if (entityArg.type === 'class_constant_access_expression') {
          const classNode = entityArg.childForFieldName('class');
          if (classNode) {
            table = this.inferTableFromName(classNode.text);
          }
        }
      }
    }

    return this.createAccessPoint({
      table,
      fields: [],
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'doctrine',
      tableFromLiteral: false, // Table name inferred from entity class
    });
  }

  /**
   * Try to match PDO pattern
   * e.g., $pdo->query("SELECT..."), $stmt->execute()
   */
  private tryPdoPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    if (chain.names.length < 2) {return null;}

    const varName = chain.names[0]?.toLowerCase() ?? '';
    const methodName = chain.names[1];

    // Check if it looks like PDO
    const isPdo = varName.includes('pdo') || varName.includes('db') ||
                 varName.includes('conn') || varName.includes('stmt');
    if (!isPdo) {return null;}

    const pdoMethods = {
      read: ['query', 'prepare'],
      write: ['exec', 'execute'],
    };

    let operation: DataOperation | null = null;
    if (pdoMethods.read.includes(methodName ?? '')) {operation = 'read';}
    else if (pdoMethods.write.includes(methodName ?? '')) {operation = 'write';}

    if (!operation) {return null;}

    // Try to extract SQL
    let table = 'unknown';
    const methodArgs = chain.args[1];
    if (methodArgs && methodArgs.length > 0) {
      const sqlArg = methodArgs[0];
      if (sqlArg) {
        const sqlText = this.extractStringValue(sqlArg);
        if (sqlText) {
          const parsed = this.parseSQLStatement(sqlText);
          table = parsed.table;
          if (parsed.operation !== 'unknown') {
            operation = parsed.operation;
          }
        }
      }
    }

    return this.createAccessPoint({
      table,
      fields: [],
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
   * Extract string value from a node
   */
  private extractStringValue(node: TreeSitterNode | null): string | null {
    if (!node) {return null;}

    // Handle argument wrapper
    if (node.type === 'argument') {
      const child = node.namedChildren[0];
      if (child) {return this.extractStringValue(child);}
    }

    if (node.type === 'string' || node.type === 'encapsed_string') {
      // Remove quotes
      return node.text.replace(/^['"]|['"]$/g, '');
    }

    return null;
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

    const fromMatch = sql.match(/FROM\s+["'`]?(\w+)["'`]?/i);
    const intoMatch = sql.match(/INTO\s+["'`]?(\w+)["'`]?/i);
    const updateMatch = sql.match(/UPDATE\s+["'`]?(\w+)["'`]?/i);

    if (fromMatch?.[1]) {table = fromMatch[1];}
    else if (intoMatch?.[1]) {table = intoMatch[1];}
    else if (updateMatch?.[1]) {table = updateMatch[1];}

    return { table, operation, fields };
  }
}

/**
 * Create a PHP data access extractor
 */
export function createPhpDataAccessExtractor(): PhpDataAccessExtractor {
  return new PhpDataAccessExtractor();
}
