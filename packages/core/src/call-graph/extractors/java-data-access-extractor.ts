/**
 * Java Semantic Data Access Extractor
 *
 * @deprecated This file is deprecated. Use the unified provider system instead:
 * - Import from 'driftdetect-core' or '../unified-provider/compat/index.js'
 * - The compat layer provides the same API but delegates to UnifiedLanguageProvider
 * 
 * This file is kept for reference but is no longer exported from the main index.
 * All data access extraction should go through the unified provider.
 *
 * Extracts data access points from Java using tree-sitter.
 * Provides accurate, semantic-aware detection of database operations.
 * 
 * Supports:
 * - Spring Data JPA: userRepository.findAll(), @Query annotations
 * - Hibernate/JPA: entityManager.find(), session.createQuery()
 * - JDBC: statement.executeQuery(), preparedStatement.execute()
 * - MyBatis: @Select, @Insert annotations
 * - jOOQ: dsl.select().from(USERS)
 */

import { BaseDataAccessExtractor, type DataAccessExtractionResult } from './data-access-extractor.js';
import {
  isJavaTreeSitterAvailable,
  createJavaParser,
} from '../../parsers/tree-sitter/java-loader.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type { CallGraphLanguage } from '../types.js';

/**
 * Java data access extractor using tree-sitter
 * @deprecated Use UnifiedDataAccessAdapter from unified-provider instead
 */
export class JavaDataAccessExtractor extends BaseDataAccessExtractor {
  readonly language: CallGraphLanguage = 'java';
  readonly extensions: string[] = ['.java'];

  private parser: TreeSitterParser | null = null;

  /**
   * Check if tree-sitter is available for Java
   */
  static isAvailable(): boolean {
    return isJavaTreeSitterAvailable();
  }

  /**
   * Extract data access points from Java source
   */
  extract(source: string, filePath: string): DataAccessExtractionResult {
    const result = this.createEmptyResult(filePath);

    if (!isJavaTreeSitterAvailable()) {
      result.errors.push('Tree-sitter not available for Java parsing');
      return result;
    }

    try {
      if (!this.parser) {
        this.parser = createJavaParser();
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
    // Check for method invocations
    if (node.type === 'method_invocation') {
      this.analyzeMethodInvocation(node, result, filePath, source);
    }

    // Check for annotations (MyBatis @Select, Spring @Query)
    if (node.type === 'annotation') {
      this.analyzeAnnotation(node, result, filePath, source);
    }

    // Recurse into children
    for (const child of node.children) {
      this.visitNode(child, result, filePath, source);
    }
  }

  /**
   * Analyze a method invocation for data access patterns
   */
  private analyzeMethodInvocation(
    node: TreeSitterNode,
    result: DataAccessExtractionResult,
    filePath: string,
    _source: string
  ): void {
    const chain = this.getMethodChain(node);
    
    const accessPoint = 
      this.trySpringDataPattern(chain, node, filePath) ||
      this.tryJpaEntityManagerPattern(chain, node, filePath) ||
      this.tryHibernateSessionPattern(chain, node, filePath) ||
      this.tryJdbcPattern(chain, node, filePath) ||
      this.tryJooqPattern(chain, node, filePath);

    if (accessPoint) {
      const exists = result.accessPoints.some(ap => ap.id === accessPoint.id);
      if (!exists) {
        result.accessPoints.push(accessPoint);
      }
    }
  }

  /**
   * Get the method call chain
   * e.g., userRepository.findByEmail(email) -> ['userRepository', 'findByEmail']
   */
  private getMethodChain(node: TreeSitterNode): { names: string[]; args: TreeSitterNode[][] } {
    const names: string[] = [];
    const args: TreeSitterNode[][] = [];
    
    let current: TreeSitterNode | null = node;
    
    while (current) {
      if (current.type === 'method_invocation') {
        // Get method name
        const nameNode = current.childForFieldName('name');
        if (nameNode) {
          names.unshift(nameNode.text);
        }
        
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
        
        // Get object (receiver)
        const objNode = current.childForFieldName('object');
        current = objNode;
      } else if (current.type === 'field_access') {
        const fieldNode = current.childForFieldName('field');
        if (fieldNode) {
          names.unshift(fieldNode.text);
          args.unshift([]);
        }
        current = current.childForFieldName('object');
      } else if (current.type === 'identifier') {
        names.unshift(current.text);
        args.unshift([]);
        break;
      } else {
        break;
      }
    }
    
    return { names, args };
  }


  /**
   * Try to match Spring Data JPA pattern
   * e.g., userRepository.findAll(), userRepository.findByEmail(email)
   */
  private trySpringDataPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    if (chain.names.length < 2) {return null;}

    const receiverName = chain.names[0];
    const methodName = chain.names[1];
    
    if (!receiverName || !methodName) {return null;}

    // Check if receiver looks like a repository
    const isRepository = receiverName.toLowerCase().includes('repository') ||
                        receiverName.toLowerCase().includes('repo') ||
                        receiverName.toLowerCase().includes('dao');
    if (!isRepository) {return null;}

    // Spring Data JPA method patterns
    const springDataMethods = {
      read: ['findAll', 'findById', 'findOne', 'getOne', 'getById', 'getReferenceById',
             'existsById', 'count', 'findAllById'],
      write: ['save', 'saveAll', 'saveAndFlush', 'saveAllAndFlush', 'flush'],
      delete: ['delete', 'deleteById', 'deleteAll', 'deleteAllById', 'deleteInBatch',
               'deleteAllInBatch', 'deleteAllByIdInBatch'],
    };

    // Check for derived query methods (findBy*, countBy*, existsBy*, deleteBy*)
    const derivedQueryPrefixes = ['findBy', 'findAllBy', 'getBy', 'queryBy', 'readBy',
                                  'countBy', 'existsBy', 'deleteBy', 'removeBy'];

    let operation: DataOperation | null = null;
    const whereFields: string[] = [];

    // Check standard methods
    if (springDataMethods.read.includes(methodName)) {
      operation = 'read';
    } else if (springDataMethods.write.includes(methodName)) {
      operation = 'write';
    } else if (springDataMethods.delete.includes(methodName)) {
      operation = 'delete';
    }

    // Check derived query methods and extract field names
    if (!operation) {
      for (const prefix of derivedQueryPrefixes) {
        if (methodName.startsWith(prefix)) {
          if (prefix.startsWith('delete') || prefix.startsWith('remove')) {
            operation = 'delete';
          } else if (prefix.startsWith('count') || prefix.startsWith('exists')) {
            operation = 'read';
          } else {
            operation = 'read';
          }
          
          // Extract field names from derived query method
          // e.g., findByEmailAndStatus -> ['email', 'status']
          const fieldPart = methodName.substring(prefix.length);
          const extractedFields = this.extractFieldsFromDerivedQuery(fieldPart);
          whereFields.push(...extractedFields);
          break;
        }
      }
    }

    if (!operation) {return null;}

    // Infer table from repository name
    const table = this.inferTableFromRepositoryName(receiverName);

    return this.createAccessPoint({
      table,
      fields: whereFields,
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'spring-data',
      tableFromLiteral: false, // Table name inferred from repository name
    });
  }

  /**
   * Extract field names from Spring Data derived query method names
   * e.g., "EmailAndStatusOrderByCreatedAt" -> ['email', 'status']
   */
  private extractFieldsFromDerivedQuery(fieldPart: string): string[] {
    const fields: string[] = [];
    
    // Remove OrderBy, Distinct, etc. suffixes
    const cleanPart = fieldPart
      .replace(/OrderBy.*$/, '')
      .replace(/Distinct$/, '')
      .replace(/First\d*$/, '')
      .replace(/Top\d*$/, '');
    
    // Split by And/Or
    const parts = cleanPart.split(/(?:And|Or)(?=[A-Z])/);
    
    for (const part of parts) {
      if (!part) {continue;}
      
      // Remove comparison suffixes
      const fieldName = part
        .replace(/(?:Is|Equals|Not|Like|StartingWith|EndingWith|Containing|In|NotIn|Between|LessThan|LessThanEqual|GreaterThan|GreaterThanEqual|After|Before|IsNull|IsNotNull|True|False|IgnoreCase)$/, '');
      
      if (fieldName) {
        // Convert PascalCase to snake_case for consistency
        const snakeCase = fieldName
          .replace(/([A-Z])/g, '_$1')
          .toLowerCase()
          .replace(/^_/, '');
        fields.push(snakeCase);
      }
    }
    
    return fields;
  }

  /**
   * Try to match JPA EntityManager pattern
   * e.g., entityManager.find(User.class, id), entityManager.createQuery()
   */
  private tryJpaEntityManagerPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    if (chain.names.length < 2) {return null;}

    const receiverName = chain.names[0]?.toLowerCase() ?? '';
    const methodName = chain.names[1];
    
    if (!methodName) {return null;}

    // Check if receiver looks like EntityManager
    if (!receiverName.includes('entitymanager') && !receiverName.includes('em') &&
        receiverName !== 'manager') {
      return null;
    }

    const emMethods = {
      read: ['find', 'getReference', 'createQuery', 'createNamedQuery', 'createNativeQuery'],
      write: ['persist', 'merge', 'flush', 'refresh'],
      delete: ['remove'],
    };

    let operation: DataOperation | null = null;
    let table = 'unknown';

    if (emMethods.read.includes(methodName)) {
      operation = 'read';
    } else if (emMethods.write.includes(methodName)) {
      operation = 'write';
    } else if (emMethods.delete.includes(methodName)) {
      operation = 'delete';
    }

    if (!operation) {return null;}

    // Try to extract entity class from find(Entity.class, id)
    const methodArgs = chain.args[1];
    if (methodArgs && methodArgs.length > 0 && methodArgs[0]) {
      const firstArg = methodArgs[0];
      if (firstArg.type === 'class_literal') {
        const typeNode = firstArg.childForFieldName('type');
        if (typeNode) {
          table = this.inferTableFromName(typeNode.text);
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
      framework: 'hibernate',
      tableFromLiteral: false, // Table name inferred from entity class
    });
  }


  /**
   * Try to match Hibernate Session pattern
   * e.g., session.get(User.class, id), session.createQuery()
   */
  private tryHibernateSessionPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    if (chain.names.length < 2) {return null;}

    const receiverName = chain.names[0]?.toLowerCase() ?? '';
    const methodName = chain.names[1];
    
    if (!methodName) {return null;}

    // Check if receiver looks like Hibernate Session
    if (!receiverName.includes('session') && receiverName !== 'sess') {
      return null;
    }

    const sessionMethods = {
      read: ['get', 'load', 'byId', 'createQuery', 'createCriteria', 'createNativeQuery',
             'getNamedQuery', 'createNamedQuery'],
      write: ['save', 'saveOrUpdate', 'update', 'merge', 'persist', 'flush', 'refresh'],
      delete: ['delete', 'remove'],
    };

    let operation: DataOperation | null = null;
    let table = 'unknown';

    if (sessionMethods.read.includes(methodName)) {
      operation = 'read';
    } else if (sessionMethods.write.includes(methodName)) {
      operation = 'write';
    } else if (sessionMethods.delete.includes(methodName)) {
      operation = 'delete';
    }

    if (!operation) {return null;}

    // Try to extract entity class
    const methodArgs = chain.args[1];
    if (methodArgs && methodArgs.length > 0 && methodArgs[0]) {
      const firstArg = methodArgs[0];
      if (firstArg.type === 'class_literal') {
        const typeNode = firstArg.childForFieldName('type');
        if (typeNode) {
          table = this.inferTableFromName(typeNode.text);
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
      framework: 'hibernate',
      tableFromLiteral: false, // Table name inferred from entity class
    });
  }

  /**
   * Try to match JDBC pattern
   * e.g., statement.executeQuery("SELECT..."), preparedStatement.execute()
   */
  private tryJdbcPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    if (chain.names.length < 2) {return null;}

    const receiverName = chain.names[0]?.toLowerCase() ?? '';
    const methodName = chain.names[1];
    
    if (!methodName) {return null;}

    // Check if receiver looks like JDBC Statement/PreparedStatement
    const isJdbc = receiverName.includes('statement') || receiverName.includes('stmt') ||
                   receiverName.includes('ps') || receiverName.includes('pstmt');
    if (!isJdbc) {return null;}

    const jdbcMethods = {
      read: ['executeQuery'],
      write: ['executeUpdate', 'execute', 'executeBatch', 'executeLargeBatch', 'executeLargeUpdate'],
    };

    let operation: DataOperation | null = null;

    if (jdbcMethods.read.includes(methodName)) {
      operation = 'read';
    } else if (jdbcMethods.write.includes(methodName)) {
      operation = 'write';
    }

    if (!operation) {return null;}

    // Try to extract SQL from argument
    let table = 'unknown';
    const methodArgs = chain.args[1];
    if (methodArgs && methodArgs.length > 0 && methodArgs[0]) {
      const sqlArg = methodArgs[0];
      const sqlText = this.extractStringValue(sqlArg);
      if (sqlText) {
        const parsed = this.parseSQLStatement(sqlText);
        table = parsed.table;
        if (parsed.operation !== 'unknown') {
          operation = parsed.operation;
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
   * Try to match jOOQ pattern
   * e.g., dsl.select().from(USERS), dsl.insertInto(USERS)
   */
  private tryJooqPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    // Look for jOOQ patterns: select().from(), insertInto(), update(), deleteFrom()
    const hasSelect = chain.names.includes('select') || chain.names.includes('selectFrom');
    const hasInsert = chain.names.includes('insertInto');
    const hasUpdate = chain.names.includes('update');
    const hasDelete = chain.names.includes('deleteFrom') || chain.names.includes('delete');
    const hasFrom = chain.names.includes('from');

    if (!hasSelect && !hasInsert && !hasUpdate && !hasDelete) {return null;}

    let operation: DataOperation = 'read';
    let table = 'unknown';

    if (hasInsert) {
      operation = 'write';
      const insertIdx = chain.names.indexOf('insertInto');
      const insertArgs = chain.args[insertIdx];
      if (insertArgs && insertArgs.length > 0 && insertArgs[0]) {
        table = this.extractTableFromJooqArg(insertArgs[0]);
      }
    } else if (hasUpdate) {
      operation = 'write';
      const updateIdx = chain.names.indexOf('update');
      const updateArgs = chain.args[updateIdx];
      if (updateArgs && updateArgs.length > 0 && updateArgs[0]) {
        table = this.extractTableFromJooqArg(updateArgs[0]);
      }
    } else if (hasDelete) {
      operation = 'delete';
      const deleteIdx = chain.names.indexOf('deleteFrom') !== -1 
        ? chain.names.indexOf('deleteFrom') 
        : chain.names.indexOf('delete');
      const deleteArgs = chain.args[deleteIdx];
      if (deleteArgs && deleteArgs.length > 0 && deleteArgs[0]) {
        table = this.extractTableFromJooqArg(deleteArgs[0]);
      }
    } else if (hasFrom) {
      operation = 'read';
      const fromIdx = chain.names.indexOf('from');
      const fromArgs = chain.args[fromIdx];
      if (fromArgs && fromArgs.length > 0 && fromArgs[0]) {
        table = this.extractTableFromJooqArg(fromArgs[0]);
      }
    }

    if (table === 'unknown' && !hasFrom) {return null;}

    return this.createAccessPoint({
      table,
      fields: [],
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'jooq',
      tableFromLiteral: false, // Table name from jOOQ constant
    });
  }


  /**
   * Analyze annotations for SQL queries
   * e.g., @Query("SELECT u FROM User u"), @Select("SELECT * FROM users")
   */
  private analyzeAnnotation(
    node: TreeSitterNode,
    result: DataAccessExtractionResult,
    filePath: string,
    _source: string
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) {return;}

    const annotationName = nameNode.text;
    
    // Spring Data @Query, MyBatis @Select/@Insert/@Update/@Delete
    const sqlAnnotations = ['Query', 'Select', 'Insert', 'Update', 'Delete',
                           'NativeQuery', 'NamedQuery', 'NamedNativeQuery'];
    
    if (!sqlAnnotations.includes(annotationName)) {return;}

    // Get annotation arguments
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) {return;}

    // Find the SQL string in the annotation
    let sqlText = '';
    for (const child of argsNode.children) {
      if (child.type === 'string_literal') {
        sqlText = child.text.replace(/^"|"$/g, '');
        break;
      }
      if (child.type === 'element_value_pair') {
        const valueNode = child.childForFieldName('value');
        if (valueNode?.type === 'string_literal') {
          sqlText = valueNode.text.replace(/^"|"$/g, '');
          break;
        }
      }
    }

    if (!sqlText) {return;}

    // Determine operation from annotation name or SQL
    let operation: DataOperation = 'unknown';
    if (annotationName === 'Select' || annotationName === 'Query') {
      operation = 'read';
    } else if (annotationName === 'Insert') {
      operation = 'write';
    } else if (annotationName === 'Update') {
      operation = 'write';
    } else if (annotationName === 'Delete') {
      operation = 'delete';
    }

    // Parse SQL for more details
    const parsed = this.parseSQLStatement(sqlText);
    if (parsed.operation !== 'unknown') {
      operation = parsed.operation;
    }

    const accessPoint = this.createAccessPoint({
      table: parsed.table,
      fields: parsed.fields,
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: `@${annotationName}("${sqlText.slice(0, 100)}...")`,
      isRawSql: true,
      framework: 'raw-sql',
      tableFromLiteral: true, // Table name extracted from SQL annotation
    });

    const exists = result.accessPoints.some(ap => ap.id === accessPoint.id);
    if (!exists) {
      result.accessPoints.push(accessPoint);
    }
  }

  /**
   * Extract table name from jOOQ table reference
   */
  private extractTableFromJooqArg(node: TreeSitterNode): string {
    // jOOQ uses constants like USERS, USER_TABLE, etc.
    if (node.type === 'identifier' || node.type === 'field_access') {
      const text = node.text;
      // Convert USERS -> users, USER_TABLE -> user_table
      return text.toLowerCase().replace(/_table$/i, '');
    }
    return 'unknown';
  }

  /**
   * Extract string value from a node
   */
  private extractStringValue(node: TreeSitterNode): string | null {
    if (node.type === 'string_literal') {
      return node.text.replace(/^"|"$/g, '');
    }
    return null;
  }

  /**
   * Infer table name from repository name
   * e.g., userRepository -> users, UserRepo -> users
   */
  private inferTableFromRepositoryName(name: string): string {
    const cleaned = name
      .replace(/Repository$/i, '')
      .replace(/Repo$/i, '')
      .replace(/DAO$/i, '')
      .replace(/^_+/, '');
    
    return this.inferTableFromName(cleaned);
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

    // Handle JPQL/HQL (FROM Entity) and SQL (FROM table)
    const fromMatch = sql.match(/FROM\s+["'`]?(\w+)["'`]?/i);
    const intoMatch = sql.match(/INTO\s+["'`]?(\w+)["'`]?/i);
    const updateMatch = sql.match(/UPDATE\s+["'`]?(\w+)["'`]?/i);

    if (fromMatch?.[1]) {table = this.inferTableFromName(fromMatch[1]);}
    else if (intoMatch?.[1]) {table = this.inferTableFromName(intoMatch[1]);}
    else if (updateMatch?.[1]) {table = this.inferTableFromName(updateMatch[1]);}

    return { table, operation, fields };
  }
}

/**
 * Create a Java data access extractor
 */
export function createJavaDataAccessExtractor(): JavaDataAccessExtractor {
  return new JavaDataAccessExtractor();
}
