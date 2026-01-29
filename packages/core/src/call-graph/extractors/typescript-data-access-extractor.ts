/**
 * TypeScript/JavaScript Semantic Data Access Extractor
 *
 * @deprecated This file is deprecated. Use the unified provider system instead:
 * - Import from 'driftdetect-core' or '../unified-provider/compat/index.js'
 * - The compat layer provides the same API but delegates to UnifiedLanguageProvider
 * 
 * This file is kept for reference but is no longer exported from the main index.
 * All data access extraction should go through the unified provider.
 *
 * Extracts data access points from TypeScript/JavaScript using tree-sitter.
 * Provides accurate, semantic-aware detection of database operations.
 * 
 * Supports:
 * - Supabase: supabase.from('table').select()
 * - Prisma: prisma.user.findMany()
 * - TypeORM: userRepository.find()
 * - Sequelize: User.findAll()
 * - Drizzle: db.select().from(users)
 * - Knex: knex('users').select()
 * - Mongoose: User.find({})
 * - Raw SQL: db.query('SELECT * FROM users')
 */

import { BaseDataAccessExtractor, type DataAccessExtractionResult } from './data-access-extractor.js';
import {
  isTypeScriptTreeSitterAvailable,
  isJavaScriptTreeSitterAvailable,
  createParserForFile,
} from '../../parsers/tree-sitter/typescript-loader.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type { CallGraphLanguage } from '../types.js';

/**
 * TypeScript/JavaScript data access extractor using tree-sitter
 * @deprecated Use UnifiedDataAccessAdapter from unified-provider instead
 */
export class TypeScriptDataAccessExtractor extends BaseDataAccessExtractor {
  readonly language: CallGraphLanguage = 'typescript';
  readonly extensions: string[] = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

  private parserCache: Map<string, TreeSitterParser> = new Map();

  /**
   * Check if tree-sitter is available for TypeScript/JavaScript
   */
  static isAvailable(): boolean {
    return isTypeScriptTreeSitterAvailable() || isJavaScriptTreeSitterAvailable();
  }


  /**
   * Extract data access points from TypeScript/JavaScript source
   */
  extract(source: string, filePath: string): DataAccessExtractionResult {
    const result = this.createEmptyResult(filePath);
    result.language = this.getLanguageFromPath(filePath);

    const parser = this.getParser(filePath);
    if (!parser) {
      result.errors.push('Tree-sitter not available for TypeScript/JavaScript parsing');
      return result;
    }

    try {
      const tree = parser.parse(source);
      this.visitNode(tree.rootNode, result, filePath, source);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  private getLanguageFromPath(filePath: string): CallGraphLanguage {
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || 
        filePath.endsWith('.mts') || filePath.endsWith('.cts')) {
      return 'typescript';
    }
    return 'javascript';
  }

  private getParser(filePath: string): TreeSitterParser | null {
    // Determine parser type based on extension
    const ext = this.getParserExtension(filePath);
    
    if (!this.parserCache.has(ext)) {
      const parser = createParserForFile(filePath);
      if (parser) {
        this.parserCache.set(ext, parser);
      }
    }
    
    return this.parserCache.get(ext) ?? null;
  }

  private getParserExtension(filePath: string): string {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.tsx')) {return '.tsx';}
    if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) {return '.ts';}
    if (lower.endsWith('.jsx')) {return '.jsx';}
    return '.js';
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
    if (node.type === 'call_expression') {
      this.analyzeCallExpression(node, result, filePath, source);
    }

    // Check for tagged template expressions (SQL template tags)
    if (node.type === 'call_expression' && this.isTaggedTemplate(node)) {
      this.analyzeTaggedTemplate(node, result, filePath, source);
    }

    // Recurse into children
    for (const child of node.children) {
      this.visitNode(child, result, filePath, source);
    }
  }

  private isTaggedTemplate(node: TreeSitterNode): boolean {
    // Check if this is a tagged template literal
    return node.children.some(c => c.type === 'template_string');
  }


  /**
   * Analyze a call expression for data access patterns
   */
  private analyzeCallExpression(
    node: TreeSitterNode,
    result: DataAccessExtractionResult,
    filePath: string,
    _source: string
  ): void {
    // Get the full call chain
    const chain = this.getCallChain(node);
    
    // Try each pattern
    const accessPoint = 
      this.trySupabasePattern(chain, node, filePath) ||
      this.tryPrismaPattern(chain, node, filePath) ||
      this.tryTypeORMPattern(chain, node, filePath) ||
      this.trySequelizePattern(chain, node, filePath) ||
      this.tryDrizzlePattern(chain, node, filePath) ||
      this.tryKnexPattern(chain, node, filePath) ||
      this.tryMongoosePattern(chain, node, filePath) ||
      this.tryRawSQLPattern(chain, node, filePath);

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
   * e.g., supabase.from('users').select('*') -> 
   *   names: ['supabase', 'from', 'select']
   *   args: [[], ['users'], ['*']]
   */
  private getCallChain(node: TreeSitterNode): { names: string[]; args: TreeSitterNode[][] } {
    const names: string[] = [];
    const args: TreeSitterNode[][] = [];
    
    let current: TreeSitterNode | null = node;
    
    while (current) {
      if (current.type === 'call_expression') {
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
        
        if (funcNode.type === 'member_expression') {
          const propNode = funcNode.childForFieldName('property');
          if (propNode) {
            names.unshift(propNode.text);
          }
          const objNode = funcNode.childForFieldName('object');
          current = objNode;
        } else if (funcNode.type === 'identifier') {
          names.unshift(funcNode.text);
          break;
        } else {
          break;
        }
      } else if (current.type === 'member_expression') {
        const propNode = current.childForFieldName('property');
        if (propNode) {
          names.unshift(propNode.text);
        }
        args.unshift([]); // No args for property access
        const objNode = current.childForFieldName('object');
        current = objNode;
      } else if (current.type === 'identifier') {
        names.unshift(current.text);
        args.unshift([]); // No args for identifier
        break;
      } else {
        break;
      }
    }
    
    return { names, args };
  }


  /**
   * Try to match Supabase pattern: supabase.from('table').select()
   */
  private trySupabasePattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    const fromIndex = chain.names.indexOf('from');
    if (fromIndex === -1) {return null;}

    // Get table name from .from('table')
    const fromArgs = chain.args[fromIndex];
    if (!fromArgs || fromArgs.length === 0) {return null;}

    const tableArg = fromArgs[0];
    if (!tableArg) {return null;}

    const table = this.extractStringValue(tableArg);
    if (!table) {return null;}

    // Determine operation from the chain
    let operation: DataOperation = 'read';
    let fields: string[] = [];
    const whereFields: string[] = [];

    for (let i = fromIndex + 1; i < chain.names.length; i++) {
      const method = chain.names[i];
      const methodArgs = chain.args[i];

      if (method === 'select' && methodArgs && methodArgs.length > 0) {
        const selectArg = methodArgs[0];
        if (selectArg) {
          const selectStr = this.extractStringValue(selectArg);
          if (selectStr) {
            fields = this.extractFieldsFromString(selectStr);
          }
        }
        operation = 'read';
      } else if (method === 'insert' || method === 'upsert') {
        operation = 'write';
        if (methodArgs && methodArgs.length > 0 && methodArgs[0]) {
          fields = this.extractFieldsFromObject(methodArgs[0]);
        }
      } else if (method === 'update') {
        operation = 'write';
        if (methodArgs && methodArgs.length > 0 && methodArgs[0]) {
          fields = this.extractFieldsFromObject(methodArgs[0]);
        }
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
      tableFromLiteral: true, // Table name comes from string literal in .from('table')
    });
  }

  /**
   * Check if a method name is a where clause method
   */
  private isWhereClauseMethod(method: string): boolean {
    const whereClauseMethods = [
      // Supabase/PostgREST
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
      'contains', 'containedBy', 'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte',
      'rangeAdjacent', 'overlaps', 'textSearch', 'match', 'not', 'or', 'filter',
      // Prisma
      'where', 'findFirst', 'findUnique',
      // TypeORM/Sequelize
      'where', 'andWhere', 'orWhere', 'whereIn', 'whereNotIn',
      // Knex
      'where', 'whereNot', 'whereIn', 'whereNotIn', 'whereNull', 'whereNotNull',
      'whereBetween', 'whereNotBetween', 'whereRaw', 'whereExists',
      // Mongoose
      'where', 'equals', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'regex',
    ];
    return whereClauseMethods.includes(method);
  }

  /**
   * Extract field name from a where clause method call
   */
  private extractWhereClauseField(args: TreeSitterNode[]): string | null {
    if (args.length === 0) {return null;}

    // For methods like .eq('field', value), .where('field', value)
    // The first argument is typically the field name
    const firstArg = args[0];
    if (!firstArg) {return null;}

    // Direct string argument: .eq('email', value)
    const strValue = this.extractStringValue(firstArg);
    if (strValue) {
      return strValue;
    }

    // Object argument: .where({ email: value })
    if (firstArg.type === 'object') {
      const objectFields = this.extractFieldsFromObject(firstArg);
      return objectFields[0] ?? null;
    }

    // Identifier: .where(email, value) - less common but possible
    if (firstArg.type === 'identifier') {
      return firstArg.text;
    }

    return null;
  }

  /**
   * Try to match Prisma pattern: prisma.user.findMany()
   */
  private tryPrismaPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    if (chain.names.length < 3) {return null;}
    
    const firstPart = chain.names[0]?.toLowerCase();
    if (!firstPart?.includes('prisma')) {return null;}

    const modelName = chain.names[1];
    const methodName = chain.names[2];
    
    if (!modelName || !methodName) {return null;}

    // Skip if model name looks like a method
    const prismaClientMethods = ['$connect', '$disconnect', '$transaction', '$queryRaw', '$executeRaw'];
    if (prismaClientMethods.includes(modelName)) {return null;}

    const operation = this.detectOperation(methodName);
    if (!operation) {return null;}

    // Extract fields from select/include
    let fields: string[] = [];
    const methodArgs = chain.args[2];
    if (methodArgs && methodArgs.length > 0 && methodArgs[0]) {
      fields = this.extractPrismaFields(methodArgs[0]);
    }

    return this.createAccessPoint({
      table: this.inferTableFromName(modelName),
      fields,
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'prisma',
      tableFromLiteral: false, // Table name inferred from model name
    });
  }


  /**
   * Try to match TypeORM pattern: repository.find() or Entity.find()
   */
  private tryTypeORMPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    if (chain.names.length < 2) {return null;}

    const receiverName = chain.names[0];
    const methodName = chain.names[1];
    
    if (!receiverName || !methodName) {return null;}

    const isRepository = receiverName.toLowerCase().includes('repository') ||
                        receiverName.toLowerCase().includes('repo');
    const isEntity = /^[A-Z]/.test(receiverName) && 
                    !['Array', 'Object', 'String', 'Number', 'Boolean', 'Promise', 'Map', 'Set'].includes(receiverName);

    if (!isRepository && !isEntity) {return null;}

    const typeormMethods = ['find', 'findOne', 'findOneBy', 'findBy', 'findAndCount', 'save', 'insert', 'update', 'delete', 'remove', 'count'];
    if (!typeormMethods.includes(methodName)) {return null;}

    const operation = this.detectOperation(methodName);
    if (!operation) {return null;}

    return this.createAccessPoint({
      table: this.inferTableFromName(receiverName),
      fields: [],
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'typeorm',
      tableFromLiteral: false, // Table name inferred from repository/entity name
    });
  }

  /**
   * Try to match Sequelize pattern: Model.findAll()
   */
  private trySequelizePattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    if (chain.names.length < 2) {return null;}

    const modelName = chain.names[0];
    const methodName = chain.names[1];
    
    if (!modelName || !methodName) {return null;}
    if (!/^[A-Z]/.test(modelName)) {return null;}

    const sequelizeMethods = ['findAll', 'findOne', 'findByPk', 'findOrCreate', 'create', 'bulkCreate', 'update', 'destroy', 'count'];
    if (!sequelizeMethods.includes(methodName)) {return null;}

    const operation = this.detectOperation(methodName);
    if (!operation) {return null;}

    // Extract fields from attributes option
    let fields: string[] = [];
    const methodArgs = chain.args[1];
    if (methodArgs && methodArgs.length > 0 && methodArgs[0]) {
      fields = this.extractSequelizeFields(methodArgs[0]);
    }

    return this.createAccessPoint({
      table: this.inferTableFromName(modelName),
      fields,
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'sequelize',
      tableFromLiteral: false, // Table name inferred from model name
    });
  }

  /**
   * Try to match Drizzle pattern: db.select().from(table)
   */
  private tryDrizzlePattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    const fromIndex = chain.names.indexOf('from');
    if (fromIndex === -1) {return null;}

    const hasSelect = chain.names.includes('select') || chain.names.includes('selectDistinct');
    const hasInsert = chain.names.includes('insert');
    const hasUpdate = chain.names.includes('update');
    const hasDelete = chain.names.includes('delete');

    if (!hasSelect && !hasInsert && !hasUpdate && !hasDelete) {return null;}

    const fromArgs = chain.args[fromIndex];
    if (!fromArgs || fromArgs.length === 0) {return null;}

    const tableArg = fromArgs[0];
    if (!tableArg) {return null;}

    let table = 'unknown';
    let tableFromLiteral = false;
    if (tableArg.type === 'identifier') {
      table = this.inferTableFromName(tableArg.text);
      tableFromLiteral = false; // Variable reference
    } else {
      const strVal = this.extractStringValue(tableArg);
      if (strVal) {
        table = strVal;
        tableFromLiteral = true; // String literal
      }
    }

    let operation: DataOperation = 'read';
    if (hasInsert) {operation = 'write';}
    if (hasUpdate) {operation = 'write';}
    if (hasDelete) {operation = 'delete';}

    return this.createAccessPoint({
      table,
      fields: [],
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'drizzle',
      tableFromLiteral,
    });
  }


  /**
   * Try to match Knex pattern: knex('table').select()
   */
  private tryKnexPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    if (chain.names.length < 2) {return null;}

    const firstPart = chain.names[0]?.toLowerCase();
    if (!firstPart?.includes('knex') && !firstPart?.includes('db')) {return null;}

    const firstArgs = chain.args[0];
    if (!firstArgs || firstArgs.length === 0) {return null;}

    const tableArg = firstArgs[0];
    if (!tableArg) {return null;}

    const table = this.extractStringValue(tableArg);
    if (!table) {return null;}

    let operation: DataOperation = 'read';
    for (const method of chain.names) {
      const op = this.detectOperation(method);
      if (op) {
        operation = op;
        break;
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
      framework: 'knex',
      tableFromLiteral: true, // Table name from string literal in knex('table')
    });
  }

  /**
   * Try to match Mongoose pattern: User.find({})
   */
  private tryMongoosePattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    if (chain.names.length < 2) {return null;}

    const modelName = chain.names[0];
    const methodName = chain.names[1];
    
    if (!modelName || !methodName) {return null;}
    if (!/^[A-Z]/.test(modelName)) {return null;}

    const mongooseMethods = {
      read: ['find', 'findOne', 'findById', 'findOneAndUpdate', 'findByIdAndUpdate',
             'countDocuments', 'estimatedDocumentCount', 'distinct', 'exists',
             'aggregate', 'populate', 'lean', 'exec'],
      write: ['create', 'insertMany', 'save', 'updateOne', 'updateMany',
              'findOneAndUpdate', 'findByIdAndUpdate', 'replaceOne', 'bulkWrite'],
      delete: ['deleteOne', 'deleteMany', 'findOneAndDelete', 'findByIdAndDelete',
               'findOneAndRemove', 'findByIdAndRemove', 'remove'],
    };

    let operation: DataOperation | null = null;
    
    if (mongooseMethods.read.includes(methodName)) {
      operation = 'read';
    } else if (mongooseMethods.write.includes(methodName)) {
      operation = 'write';
    } else if (mongooseMethods.delete.includes(methodName)) {
      operation = 'delete';
    }

    if (!operation) {return null;}

    // Extract fields from projection
    let fields: string[] = [];
    const methodArgs = chain.args[1];
    if (methodArgs && methodArgs.length >= 2) {
      const projectionArg = methodArgs[1];
      if (projectionArg) {
        if (projectionArg.type === 'object') {
          fields = this.extractFieldsFromObject(projectionArg);
        } else {
          const strVal = this.extractStringValue(projectionArg);
          if (strVal) {
            fields = strVal.split(/\s+/).filter(f => f && !f.startsWith('-'));
          }
        }
      }
    }

    return this.createAccessPoint({
      table: this.inferTableFromName(modelName),
      fields,
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'mongoose',
      tableFromLiteral: false, // Table name inferred from model name
    });
  }


  /**
   * Try to match raw SQL pattern: db.query('SELECT * FROM users')
   */
  private tryRawSQLPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    const queryMethods = ['query', 'execute', 'raw', 'rawQuery', '$queryRaw', '$executeRaw', 'sql'];
    const methodIndex = chain.names.findIndex(n => queryMethods.includes(n));
    
    if (methodIndex === -1) {return null;}

    const methodArgs = chain.args[methodIndex];
    if (!methodArgs || methodArgs.length === 0) {return null;}

    const sqlArg = methodArgs[0];
    if (!sqlArg) {return null;}

    let sqlText = this.extractStringValue(sqlArg);
    if (!sqlText && sqlArg.type === 'template_string') {
      sqlText = sqlArg.text;
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
      framework: 'raw-sql',
      tableFromLiteral: true, // Table name extracted from SQL string
    });
  }

  /**
   * Analyze tagged template expressions for SQL
   */
  private analyzeTaggedTemplate(
    node: TreeSitterNode,
    result: DataAccessExtractionResult,
    filePath: string,
    _source: string
  ): void {
    // Get the tag name
    const funcNode = node.childForFieldName('function');
    if (!funcNode) {return;}

    let tagName = '';
    if (funcNode.type === 'identifier') {
      tagName = funcNode.text;
    } else if (funcNode.type === 'member_expression') {
      const propNode = funcNode.childForFieldName('property');
      if (propNode) {tagName = propNode.text;}
    }

    const sqlTags = ['sql', 'Sql', 'SQL', 'raw', 'query'];
    if (!sqlTags.includes(tagName)) {return;}

    // Get the template content
    const templateNode = node.children.find(c => c.type === 'template_string');
    if (!templateNode) {return;}

    const sqlText = templateNode.text;
    if (!sqlText) {return;}

    const { table, operation, fields } = this.parseSQLStatement(sqlText);
    if (!table || table === 'unknown') {return;}

    const accessPoint = this.createAccessPoint({
      table,
      fields,
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      isRawSql: true,
      framework: 'raw-sql',
      tableFromLiteral: true, // Table name extracted from SQL template
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

    if (upperSql.startsWith('SELECT')) {
      operation = 'read';
    } else if (upperSql.startsWith('INSERT')) {
      operation = 'write';
    } else if (upperSql.startsWith('UPDATE')) {
      operation = 'write';
    } else if (upperSql.startsWith('DELETE')) {
      operation = 'delete';
    }

    const fromMatch = sql.match(/FROM\s+["'`]?(\w+)["'`]?/i);
    const intoMatch = sql.match(/INTO\s+["'`]?(\w+)["'`]?/i);
    const updateMatch = sql.match(/UPDATE\s+["'`]?(\w+)["'`]?/i);

    if (fromMatch?.[1]) {table = fromMatch[1];}
    else if (intoMatch?.[1]) {table = intoMatch[1];}
    else if (updateMatch?.[1]) {table = updateMatch[1];}

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
   * Extract string value from a node
   */
  private extractStringValue(node: TreeSitterNode | null): string | null {
    if (!node) {return null;}

    if (node.type === 'string') {
      // Remove quotes
      return node.text.replace(/^['"`]|['"`]$/g, '');
    }
    if (node.type === 'template_string') {
      // Remove backticks
      return node.text.replace(/^`|`$/g, '');
    }

    return null;
  }

  /**
   * Extract fields from an object literal
   */
  private extractFieldsFromObject(node: TreeSitterNode | null): string[] {
    if (!node) {return [];}
    
    const fields: string[] = [];

    if (node.type === 'object') {
      for (const child of node.children) {
        if (child.type === 'pair') {
          const keyNode = child.childForFieldName('key');
          if (keyNode) {
            if (keyNode.type === 'property_identifier' || keyNode.type === 'identifier') {
              fields.push(keyNode.text);
            } else if (keyNode.type === 'string') {
              fields.push(keyNode.text.replace(/^['"`]|['"`]$/g, ''));
            }
          }
        } else if (child.type === 'shorthand_property_identifier') {
          fields.push(child.text);
        }
      }
    } else if (node.type === 'array') {
      // For array of objects, extract from first element
      const firstElem = node.children.find(c => c.type === 'object');
      if (firstElem) {
        return this.extractFieldsFromObject(firstElem);
      }
    }

    return fields;
  }


  /**
   * Extract fields from Prisma select/include options
   */
  private extractPrismaFields(node: TreeSitterNode | null): string[] {
    if (node?.type !== 'object') {return [];}

    const fields: string[] = [];

    for (const child of node.children) {
      if (child.type === 'pair') {
        const keyNode = child.childForFieldName('key');
        const valueNode = child.childForFieldName('value');
        
        if (keyNode && (keyNode.text === 'select' || keyNode.text === 'include')) {
          if (valueNode?.type === 'object') {
            for (const selectChild of valueNode.children) {
              if (selectChild.type === 'pair') {
                const selectKey = selectChild.childForFieldName('key');
                if (selectKey) {
                  fields.push(selectKey.text);
                }
              }
            }
          }
        }
      }
    }

    return fields;
  }

  /**
   * Extract fields from Sequelize attributes option
   */
  private extractSequelizeFields(node: TreeSitterNode | null): string[] {
    if (node?.type !== 'object') {return [];}

    const fields: string[] = [];

    for (const child of node.children) {
      if (child.type === 'pair') {
        const keyNode = child.childForFieldName('key');
        const valueNode = child.childForFieldName('value');
        
        if (keyNode?.text === 'attributes') {
          if (valueNode?.type === 'array') {
            for (const elem of valueNode.children) {
              if (elem.type === 'string') {
                fields.push(elem.text.replace(/^['"`]|['"`]$/g, ''));
              }
            }
          }
        }
      }
    }

    return fields;
  }
}

/**
 * Create a TypeScript data access extractor
 */
export function createTypeScriptDataAccessExtractor(): TypeScriptDataAccessExtractor {
  return new TypeScriptDataAccessExtractor();
}
