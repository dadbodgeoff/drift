/**
 * Go Data Access Extractor
 *
 * Extracts data access points from Go source code using tree-sitter.
 * Supports:
 * - GORM (most popular Go ORM)
 * - sqlx (SQL extensions)
 * - database/sql (standard library)
 * - Ent (Facebook's entity framework)
 * - Bun (lightweight ORM)
 */

import { BaseDataAccessExtractor, type DataAccessExtractionResult } from './data-access-extractor.js';
import { isGoTreeSitterAvailable, createGoParser } from '../../parsers/tree-sitter/go-loader.js';

import type { DataOperation } from '../../boundaries/types.js';
import type { TreeSitterParser, TreeSitterNode } from '../../parsers/tree-sitter/types.js';
import type { CallGraphLanguage } from '../types.js';

export class GoDataAccessExtractor extends BaseDataAccessExtractor {
  readonly language: CallGraphLanguage = 'go';
  readonly extensions: string[] = ['.go'];

  private parser: TreeSitterParser | null = null;

  static isAvailable(): boolean {
    return isGoTreeSitterAvailable();
  }

  extract(source: string, filePath: string): DataAccessExtractionResult {
    const result = this.createEmptyResult(filePath);

    if (!isGoTreeSitterAvailable()) {
      result.errors.push('Tree-sitter not available for Go parsing');
      return result;
    }

    try {
      if (!this.parser) {
        this.parser = createGoParser();
      }

      const tree = this.parser.parse(source);
      this.visitNode(tree.rootNode, result, filePath, source);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown parse error');
    }

    return result;
  }

  private visitNode(
    node: TreeSitterNode,
    result: DataAccessExtractionResult,
    filePath: string,
    source: string
  ): void {
    if (node.type === 'call_expression') {
      this.analyzeCallExpression(node, result, filePath, source);
    }

    for (const child of node.children) {
      this.visitNode(child, result, filePath, source);
    }
  }


  private analyzeCallExpression(
    node: TreeSitterNode,
    result: DataAccessExtractionResult,
    filePath: string,
    _source: string
  ): void {
    const chain = this.getMethodChain(node);

    const accessPoint =
      this.tryGormPattern(chain, node, filePath) ||
      this.trySqlxPattern(chain, node, filePath) ||
      this.tryDatabaseSqlPattern(chain, node, filePath) ||
      this.tryEntPattern(chain, node, filePath) ||
      this.tryBunPattern(chain, node, filePath);

    if (accessPoint) {
      const exists = result.accessPoints.some((ap) => ap.id === accessPoint.id);
      if (!exists) {
        result.accessPoints.push(accessPoint);
      }
    }
  }

  private getMethodChain(node: TreeSitterNode): { names: string[]; args: TreeSitterNode[][] } {
    const names: string[] = [];
    const args: TreeSitterNode[][] = [];

    let current: TreeSitterNode | null = node;

    while (current) {
      if (current.type === 'call_expression') {
        const funcNode = current.childForFieldName('function');
        const argsNode = current.childForFieldName('arguments');

        if (funcNode?.type === 'selector_expression') {
          const fieldNode = funcNode.childForFieldName('field');
          if (fieldNode) {
            names.unshift(fieldNode.text);
          }
          current = funcNode.childForFieldName('operand');
        } else if (funcNode?.type === 'identifier') {
          names.unshift(funcNode.text);
          break;
        } else {
          break;
        }

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
      } else if (current.type === 'selector_expression') {
        const fieldNode = current.childForFieldName('field');
        if (fieldNode) {
          names.unshift(fieldNode.text);
          args.unshift([]);
        }
        current = current.childForFieldName('operand');
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
   * GORM patterns:
   * db.Find(&users)
   * db.Where("name = ?", name).First(&user)
   * db.Create(&user)
   * db.Model(&User{}).Where(...).Update(...)
   * db.Delete(&user)
   */
  private tryGormPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    const gormReadMethods = ['Find', 'First', 'Last', 'Take', 'Scan', 'Pluck', 'Count', 'Row', 'Rows'];
    const gormWriteMethods = ['Create', 'Save', 'Update', 'Updates', 'UpdateColumn', 'UpdateColumns'];
    const gormDeleteMethods = ['Delete', 'Unscoped'];
    const gormChainMethods = [
      'Where',
      'Or',
      'Not',
      'Limit',
      'Offset',
      'Order',
      'Group',
      'Having',
      'Joins',
      'Preload',
      'Select',
      'Omit',
      'Model',
      'Table',
    ];

    // Check if this looks like a GORM chain
    const hasGormMethod = chain.names.some(
      (n) =>
        gormReadMethods.includes(n) ||
        gormWriteMethods.includes(n) ||
        gormDeleteMethods.includes(n) ||
        gormChainMethods.includes(n)
    );

    if (!hasGormMethod) {return null;}

    // Determine operation from terminal method
    let operation: DataOperation = 'unknown';
    let table = 'unknown';

    for (let i = chain.names.length - 1; i >= 0; i--) {
      const method = chain.names[i]!;

      if (gormReadMethods.includes(method)) {
        operation = 'read';
        const methodArgs = chain.args[i];
        if (methodArgs && methodArgs.length > 0) {
          table = this.inferTableFromGoArg(methodArgs[0]!);
        }
        break;
      } else if (gormWriteMethods.includes(method)) {
        operation = 'write';
        const methodArgs = chain.args[i];
        if (methodArgs && methodArgs.length > 0) {
          table = this.inferTableFromGoArg(methodArgs[0]!);
        }
        break;
      } else if (gormDeleteMethods.includes(method)) {
        operation = 'delete';
        const methodArgs = chain.args[i];
        if (methodArgs && methodArgs.length > 0) {
          table = this.inferTableFromGoArg(methodArgs[0]!);
        }
        break;
      } else if (method === 'Model' || method === 'Table') {
        const methodArgs = chain.args[i];
        if (methodArgs && methodArgs.length > 0) {
          table = this.inferTableFromGoArg(methodArgs[0]!);
        }
      }
    }

    if (operation === 'unknown') {return null;}

    return this.createAccessPoint({
      table,
      fields: [],
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'gorm',
      tableFromLiteral: false,
    });
  }


  /**
   * sqlx patterns:
   * db.Select(&users, "SELECT * FROM users WHERE ...")
   * db.Get(&user, "SELECT * FROM users WHERE id = ?", id)
   * db.Exec("INSERT INTO users ...")
   * db.NamedExec("INSERT INTO users ...", user)
   */
  private trySqlxPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    const sqlxReadMethods = ['Select', 'Get', 'Queryx', 'QueryRowx', 'NamedQuery'];
    const sqlxWriteMethods = ['Exec', 'NamedExec', 'MustExec'];

    const lastMethod = chain.names[chain.names.length - 1];
    if (!lastMethod) {return null;}

    let operation: DataOperation = 'unknown';
    let table = 'unknown';

    if (sqlxReadMethods.includes(lastMethod)) {
      operation = 'read';
    } else if (sqlxWriteMethods.includes(lastMethod)) {
      operation = 'write';
    }

    if (operation === 'unknown') {return null;}

    // Try to extract SQL from string argument
    const methodArgs = chain.args[chain.args.length - 1];
    if (methodArgs) {
      for (const arg of methodArgs) {
        const sqlText = this.extractStringValue(arg);
        if (sqlText) {
          const parsed = this.parseSQLStatement(sqlText);
          table = parsed.table;
          if (parsed.operation !== 'unknown') {
            operation = parsed.operation;
          }
          break;
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
      framework: 'sqlx',
      tableFromLiteral: true,
    });
  }

  /**
   * database/sql patterns:
   * db.Query("SELECT * FROM users")
   * db.QueryRow("SELECT * FROM users WHERE id = ?", id)
   * db.Exec("INSERT INTO users ...")
   * stmt.Query(args...)
   */
  private tryDatabaseSqlPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    const sqlReadMethods = ['Query', 'QueryRow', 'QueryContext', 'QueryRowContext'];
    const sqlWriteMethods = ['Exec', 'ExecContext'];

    const lastMethod = chain.names[chain.names.length - 1];
    if (!lastMethod) {return null;}

    let operation: DataOperation = 'unknown';
    let table = 'unknown';

    if (sqlReadMethods.includes(lastMethod)) {
      operation = 'read';
    } else if (sqlWriteMethods.includes(lastMethod)) {
      operation = 'write';
    }

    if (operation === 'unknown') {return null;}

    // Try to extract SQL from string argument
    const methodArgs = chain.args[chain.args.length - 1];
    if (methodArgs && methodArgs.length > 0) {
      const sqlText = this.extractStringValue(methodArgs[0]!);
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
      tableFromLiteral: true,
    });
  }


  /**
   * Ent patterns:
   * client.User.Query().All(ctx)
   * client.User.Create().SetName("...").Save(ctx)
   * client.User.Delete().Where(...).Exec(ctx)
   */
  private tryEntPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    const entReadMethods = ['All', 'Only', 'First', 'Count', 'Exist', 'IDs'];
    const entWriteMethods = ['Save', 'SaveX'];
    const entDeleteMethods = ['Exec', 'ExecX'];
    const entBuilderMethods = ['Query', 'Create', 'Update', 'Delete'];

    // Check for Ent patterns
    const hasEntBuilder = chain.names.some((n) => entBuilderMethods.includes(n));
    if (!hasEntBuilder) {return null;}

    let operation: DataOperation = 'unknown';
    let table = 'unknown';

    // Find the entity name (usually after 'client')
    const clientIdx = chain.names.indexOf('client');
    if (clientIdx >= 0 && clientIdx + 1 < chain.names.length) {
      table = this.inferTableFromName(chain.names[clientIdx + 1]!);
    }

    // Determine operation
    if (chain.names.includes('Query')) {
      operation = 'read';
    } else if (chain.names.includes('Create') || chain.names.includes('Update')) {
      operation = 'write';
    } else if (chain.names.includes('Delete')) {
      operation = 'delete';
    }

    // Refine based on terminal method
    for (const method of chain.names) {
      if (entReadMethods.includes(method)) {operation = 'read';}
      else if (entWriteMethods.includes(method)) {operation = 'write';}
      else if (entDeleteMethods.includes(method) && chain.names.includes('Delete')) {operation = 'delete';}
    }

    if (operation === 'unknown') {return null;}

    return this.createAccessPoint({
      table,
      fields: [],
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'ent',
      tableFromLiteral: false,
    });
  }

  /**
   * Bun patterns:
   * db.NewSelect().Model(&users).Scan(ctx)
   * db.NewInsert().Model(&user).Exec(ctx)
   * db.NewUpdate().Model(&user).Exec(ctx)
   * db.NewDelete().Model(&user).Exec(ctx)
   */
  private tryBunPattern(
    chain: { names: string[]; args: TreeSitterNode[][] },
    node: TreeSitterNode,
    filePath: string
  ): ReturnType<typeof this.createAccessPoint> | null {
    const bunBuilders = ['NewSelect', 'NewInsert', 'NewUpdate', 'NewDelete', 'NewRaw'];

    const hasBuilder = chain.names.some((n) => bunBuilders.includes(n));
    if (!hasBuilder) {return null;}

    let operation: DataOperation = 'unknown';
    let table = 'unknown';

    if (chain.names.includes('NewSelect')) {operation = 'read';}
    else if (chain.names.includes('NewInsert')) {operation = 'write';}
    else if (chain.names.includes('NewUpdate')) {operation = 'write';}
    else if (chain.names.includes('NewDelete')) {operation = 'delete';}

    // Try to get table from Model() argument
    const modelIdx = chain.names.indexOf('Model');
    if (modelIdx >= 0) {
      const modelArgs = chain.args[modelIdx];
      if (modelArgs && modelArgs.length > 0) {
        table = this.inferTableFromGoArg(modelArgs[0]!);
      }
    }

    if (operation === 'unknown') {return null;}

    return this.createAccessPoint({
      table,
      fields: [],
      operation,
      file: filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      context: node.text.slice(0, 200),
      framework: 'bun',
      tableFromLiteral: false,
    });
  }


  /**
   * Infer table name from Go argument (e.g., &User{}, &users)
   */
  private inferTableFromGoArg(node: TreeSitterNode): string {
    const text = node.text;

    // &User{} or User{}
    const structMatch = text.match(/&?(\w+)\{\}/);
    if (structMatch) {
      return this.inferTableFromName(structMatch[1]!);
    }

    // &users (pointer to slice variable)
    const varMatch = text.match(/&(\w+)/);
    if (varMatch) {
      return this.inferTableFromName(varMatch[1]!);
    }

    return 'unknown';
  }

  /**
   * Extract string value from a node
   */
  private extractStringValue(node: TreeSitterNode): string | null {
    if (node.type === 'interpreted_string_literal' || node.type === 'raw_string_literal') {
      return node.text.replace(/^["`]|["`]$/g, '');
    }
    return null;
  }

  /**
   * Parse SQL statement to extract table and operation
   */
  private parseSQLStatement(sql: string): { table: string; operation: DataOperation; fields: string[] } {
    const upperSql = sql.toUpperCase().trim();
    let operation: DataOperation = 'unknown';
    let table = 'unknown';

    if (upperSql.startsWith('SELECT')) {operation = 'read';}
    else if (upperSql.startsWith('INSERT')) {operation = 'write';}
    else if (upperSql.startsWith('UPDATE')) {operation = 'write';}
    else if (upperSql.startsWith('DELETE')) {operation = 'delete';}

    const fromMatch = sql.match(/FROM\s+["'`]?(\w+)["'`]?/i);
    const intoMatch = sql.match(/INTO\s+["'`]?(\w+)["'`]?/i);
    const updateMatch = sql.match(/UPDATE\s+["'`]?(\w+)["'`]?/i);

    if (fromMatch?.[1]) {table = fromMatch[1].toLowerCase();}
    else if (intoMatch?.[1]) {table = intoMatch[1].toLowerCase();}
    else if (updateMatch?.[1]) {table = updateMatch[1].toLowerCase();}

    return { table, operation, fields: [] };
  }
}

/**
 * Create a Go data access extractor instance
 */
export function createGoDataAccessExtractor(): GoDataAccessExtractor {
  return new GoDataAccessExtractor();
}
