/**
 * Rust Analyzer
 *
 * Comprehensive Rust project analysis including:
 * - Route detection (Actix, Axum, Rocket, Warp)
 * - Error handling patterns (Result, thiserror, anyhow)
 * - Trait analysis
 * - Data access patterns (SQLx, Diesel, SeaORM)
 * - Async patterns
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface RustAnalyzerOptions {
  rootDir: string;
  verbose?: boolean;
}

export interface RustRoute {
  method: string;
  path: string;
  handler: string;
  file: string;
  line: number;
  framework: string;
}

export interface RustErrorPattern {
  type: 'propagated' | 'mapped' | 'logged' | 'unwrapped';
  file: string;
  line: number;
  context: string;
}

export interface RustCustomError {
  name: string;
  file: string;
  line: number;
  variants: string[];
}

export interface RustTrait {
  name: string;
  file: string;
  line: number;
  methods: string[];
  implementations: string[];
}

export interface RustTraitImpl {
  traitName: string;
  forType: string;
  file: string;
  line: number;
}

export interface RustDataAccessPoint {
  table: string;
  operation: 'read' | 'write' | 'delete' | 'unknown';
  framework: string;
  file: string;
  line: number;
}

export interface RustAsyncFunction {
  name: string;
  file: string;
  line: number;
  hasAwait: boolean;
}

export interface RustCrate {
  name: string;
  path: string;
  files: string[];
  functions: string[];
}

export interface RustIssue {
  message: string;
  file: string;
  line: number;
  suggestion?: string;
}

// ============================================================================
// Analyzer Implementation
// ============================================================================

export class RustAnalyzer {
  private rootDir: string;
  // @ts-expect-error - verbose is reserved for future use
  private verbose: boolean;

  constructor(options: RustAnalyzerOptions) {
    this.rootDir = options.rootDir;
    this.verbose = options.verbose ?? false;
  }

  /**
   * Full project analysis
   */
  async analyze(): Promise<{
    crateName: string | null;
    edition: string | null;
    crates: RustCrate[];
    detectedFrameworks: string[];
    stats: {
      fileCount: number;
      functionCount: number;
      structCount: number;
      traitCount: number;
      enumCount: number;
      linesOfCode: number;
      testFileCount: number;
      testFunctionCount: number;
      analysisTimeMs: number;
    };
  }> {
    const startTime = performance.now();
    const files = await this.findRustFiles();
    
    let crateName: string | null = null;
    let edition: string | null = null;
    const frameworks: Set<string> = new Set();
    let functionCount = 0;
    let structCount = 0;
    let traitCount = 0;
    let enumCount = 0;
    let linesOfCode = 0;
    let testFileCount = 0;
    let testFunctionCount = 0;

    // Parse Cargo.toml
    const cargoPath = path.join(this.rootDir, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      const cargoContent = fs.readFileSync(cargoPath, 'utf-8');
      const nameMatch = cargoContent.match(/name\s*=\s*"([^"]+)"/);
      const editionMatch = cargoContent.match(/edition\s*=\s*"([^"]+)"/);
      crateName = nameMatch?.[1] ?? null;
      edition = editionMatch?.[1] ?? null;

      // Detect frameworks from dependencies
      if (cargoContent.includes('actix-web')) frameworks.add('actix-web');
      if (cargoContent.includes('axum')) frameworks.add('axum');
      if (cargoContent.includes('rocket')) frameworks.add('rocket');
      if (cargoContent.includes('warp')) frameworks.add('warp');
      if (cargoContent.includes('sqlx')) frameworks.add('sqlx');
      if (cargoContent.includes('diesel')) frameworks.add('diesel');
      if (cargoContent.includes('sea-orm')) frameworks.add('sea-orm');
      if (cargoContent.includes('tokio')) frameworks.add('tokio');
      if (cargoContent.includes('async-std')) frameworks.add('async-std');
    }

    // Analyze files
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      linesOfCode += lines.length;

      // Count constructs
      functionCount += (content.match(/\bfn\s+\w+/g) || []).length;
      structCount += (content.match(/\bstruct\s+\w+/g) || []).length;
      traitCount += (content.match(/\btrait\s+\w+/g) || []).length;
      enumCount += (content.match(/\benum\s+\w+/g) || []).length;

      // Test files
      if (file.includes('test') || content.includes('#[cfg(test)]')) {
        testFileCount++;
        testFunctionCount += (content.match(/#\[test\]/g) || []).length;
        testFunctionCount += (content.match(/#\[tokio::test\]/g) || []).length;
      }
    }

    // Build crate structure
    const crates = this.buildCrateStructure(files);

    return {
      crateName,
      edition,
      crates,
      detectedFrameworks: Array.from(frameworks),
      stats: {
        fileCount: files.length,
        functionCount,
        structCount,
        traitCount,
        enumCount,
        linesOfCode,
        testFileCount,
        testFunctionCount,
        analysisTimeMs: performance.now() - startTime,
      },
    };
  }

  /**
   * Analyze HTTP routes
   */
  async analyzeRoutes(): Promise<{
    routes: RustRoute[];
    byFramework: Record<string, number>;
  }> {
    const files = await this.findRustFiles();
    const routes: RustRoute[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const relPath = path.relative(this.rootDir, file);

      // Actix-web routes
      this.extractActixRoutes(content, relPath, routes);
      
      // Axum routes
      this.extractAxumRoutes(content, relPath, routes);
      
      // Rocket routes
      this.extractRocketRoutes(content, relPath, routes);
      
      // Warp routes
      this.extractWarpRoutes(content, relPath, routes);
    }

    // Count by framework
    const byFramework: Record<string, number> = {};
    for (const route of routes) {
      byFramework[route.framework] = (byFramework[route.framework] ?? 0) + 1;
    }

    return { routes, byFramework };
  }

  /**
   * Analyze error handling patterns
   */
  async analyzeErrorHandling(): Promise<{
    patterns: RustErrorPattern[];
    customErrors: RustCustomError[];
    issues: RustIssue[];
    stats: {
      resultTypes: number;
      customErrors: number;
      thiserrorDerives: number;
      anyhowUsage: number;
      unwrapCalls: number;
      expectCalls: number;
    };
  }> {
    const files = await this.findRustFiles();
    const patterns: RustErrorPattern[] = [];
    const customErrors: RustCustomError[] = [];
    const issues: RustIssue[] = [];
    let resultTypes = 0;
    let thiserrorDerives = 0;
    let anyhowUsage = 0;
    let unwrapCalls = 0;
    let expectCalls = 0;

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const relPath = path.relative(this.rootDir, file);
      const lines = content.split('\n');

      // Count Result types
      resultTypes += (content.match(/Result</g) || []).length;

      // Count thiserror derives
      thiserrorDerives += (content.match(/#\[derive\([^)]*Error[^)]*\)\]/g) || []).length;

      // Count anyhow usage
      anyhowUsage += (content.match(/anyhow::/g) || []).length;
      anyhowUsage += (content.match(/use anyhow/g) || []).length;

      // Count unwrap/expect calls
      const unwraps = content.match(/\.unwrap\(\)/g) || [];
      const expects = content.match(/\.expect\(/g) || [];
      unwrapCalls += unwraps.length;
      expectCalls += expects.length;

      // Extract patterns
      lines.forEach((line, idx) => {
        // Propagated errors (?)
        if (line.includes('?') && !line.includes('//')) {
          patterns.push({
            type: 'propagated',
            file: relPath,
            line: idx + 1,
            context: line.trim(),
          });
        }

        // Mapped errors
        if (line.includes('.map_err(')) {
          patterns.push({
            type: 'mapped',
            file: relPath,
            line: idx + 1,
            context: line.trim(),
          });
        }

        // Unwrapped (potential issue)
        if (line.includes('.unwrap()') && !file.includes('test')) {
          patterns.push({
            type: 'unwrapped',
            file: relPath,
            line: idx + 1,
            context: line.trim(),
          });
          issues.push({
            message: 'Unwrap in non-test code may panic',
            file: relPath,
            line: idx + 1,
            suggestion: 'Consider using ? operator or proper error handling',
          });
        }
      });

      // Extract custom error types
      const errorEnumPattern = /#\[derive\([^)]*Error[^)]*\)\]\s*(?:pub\s+)?enum\s+(\w+)/g;
      let match;
      while ((match = errorEnumPattern.exec(content)) !== null) {
        const name = match[1];
        if (name) {
          customErrors.push({
            name,
            file: relPath,
            line: this.getLineNumber(content, match.index),
            variants: [],
          });
        }
      }
    }

    return {
      patterns,
      customErrors,
      issues,
      stats: {
        resultTypes,
        customErrors: customErrors.length,
        thiserrorDerives,
        anyhowUsage,
        unwrapCalls,
        expectCalls,
      },
    };
  }

  /**
   * Analyze traits
   */
  async analyzeTraits(): Promise<{
    traits: RustTrait[];
    implementations: RustTraitImpl[];
  }> {
    const files = await this.findRustFiles();
    const traits: RustTrait[] = [];
    const implementations: RustTraitImpl[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const relPath = path.relative(this.rootDir, file);

      // Extract trait definitions
      const traitPattern = /(?:pub\s+)?trait\s+(\w+)(?:<[^>]+>)?\s*(?::\s*[^{]+)?\s*\{/g;
      let match;
      while ((match = traitPattern.exec(content)) !== null) {
        const name = match[1];
        if (name) {
          traits.push({
            name,
            file: relPath,
            line: this.getLineNumber(content, match.index),
            methods: [],
            implementations: [],
          });
        }
      }

      // Extract impl blocks
      const implPattern = /impl(?:<[^>]+>)?\s+(\w+)(?:<[^>]+>)?\s+for\s+(\w+)/g;
      while ((match = implPattern.exec(content)) !== null) {
        const traitName = match[1];
        const forType = match[2];
        if (traitName && forType) {
          implementations.push({
            traitName,
            forType,
            file: relPath,
            line: this.getLineNumber(content, match.index),
          });

          // Link to trait
          const trait = traits.find(t => t.name === traitName);
          if (trait) {
            trait.implementations.push(forType);
          }
        }
      }
    }

    return { traits, implementations };
  }

  /**
   * Analyze data access patterns
   */
  async analyzeDataAccess(): Promise<{
    accessPoints: RustDataAccessPoint[];
    tables: string[];
    byFramework: Record<string, number>;
    byOperation: Record<string, number>;
  }> {
    const files = await this.findRustFiles();
    const accessPoints: RustDataAccessPoint[] = [];
    const tables: Set<string> = new Set();

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const relPath = path.relative(this.rootDir, file);

      // SQLx patterns
      this.extractSqlxAccess(content, relPath, accessPoints, tables);
      
      // Diesel patterns
      this.extractDieselAccess(content, relPath, accessPoints, tables);
      
      // SeaORM patterns
      this.extractSeaOrmAccess(content, relPath, accessPoints, tables);
    }

    // Count by framework and operation
    const byFramework: Record<string, number> = {};
    const byOperation: Record<string, number> = {};
    for (const ap of accessPoints) {
      byFramework[ap.framework] = (byFramework[ap.framework] ?? 0) + 1;
      byOperation[ap.operation] = (byOperation[ap.operation] ?? 0) + 1;
    }

    return {
      accessPoints,
      tables: Array.from(tables),
      byFramework,
      byOperation,
    };
  }

  /**
   * Analyze async patterns
   */
  async analyzeAsync(): Promise<{
    asyncFunctions: RustAsyncFunction[];
    runtime: string | null;
    issues: RustIssue[];
    stats: {
      asyncFunctions: number;
      awaitPoints: number;
      spawnedTasks: number;
      channels: number;
      mutexes: number;
    };
  }> {
    const files = await this.findRustFiles();
    const asyncFunctions: RustAsyncFunction[] = [];
    const issues: RustIssue[] = [];
    let runtime: string | null = null;
    let awaitPoints = 0;
    let spawnedTasks = 0;
    let channels = 0;
    let mutexes = 0;

    // Check Cargo.toml for runtime
    const cargoPath = path.join(this.rootDir, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      const cargoContent = fs.readFileSync(cargoPath, 'utf-8');
      if (cargoContent.includes('tokio')) runtime = 'tokio';
      else if (cargoContent.includes('async-std')) runtime = 'async-std';
      else if (cargoContent.includes('smol')) runtime = 'smol';
    }

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const relPath = path.relative(this.rootDir, file);

      // Count async functions
      const asyncFnPattern = /async\s+fn\s+(\w+)/g;
      let match;
      while ((match = asyncFnPattern.exec(content)) !== null) {
        const name = match[1];
        if (name) {
          asyncFunctions.push({
            name,
            file: relPath,
            line: this.getLineNumber(content, match.index),
            hasAwait: true,
          });
        }
      }

      // Count await points
      awaitPoints += (content.match(/\.await/g) || []).length;

      // Count spawned tasks
      spawnedTasks += (content.match(/tokio::spawn/g) || []).length;
      spawnedTasks += (content.match(/task::spawn/g) || []).length;

      // Count channels
      channels += (content.match(/mpsc::channel/g) || []).length;
      channels += (content.match(/oneshot::channel/g) || []).length;
      channels += (content.match(/broadcast::channel/g) || []).length;

      // Count mutexes
      mutexes += (content.match(/Mutex::new/g) || []).length;
      mutexes += (content.match(/RwLock::new/g) || []).length;

      // Check for blocking in async
      if (content.includes('std::thread::sleep') && content.includes('async fn')) {
        issues.push({
          message: 'Blocking sleep in async context',
          file: relPath,
          line: 1,
          suggestion: 'Use tokio::time::sleep or async-std equivalent',
        });
      }
    }

    return {
      asyncFunctions,
      runtime,
      issues,
      stats: {
        asyncFunctions: asyncFunctions.length,
        awaitPoints,
        spawnedTasks,
        channels,
        mutexes,
      },
    };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private async findRustFiles(): Promise<string[]> {
    const results: string[] = [];
    const excludePatterns = ['target', 'node_modules', '.git'];

    const walk = async (dir: string): Promise<void> => {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          // Skip excluded directories
          if (excludePatterns.some(p => entry.name === p || entry.name.startsWith('.'))) {
            continue;
          }
          
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.rs')) {
            results.push(fullPath);
          }
        }
      } catch {
        // Ignore permission errors
      }
    };

    await walk(this.rootDir);
    return results;
  }

  private getLineNumber(content: string, index: number): number {
    return content.slice(0, index).split('\n').length;
  }

  private buildCrateStructure(files: string[]): RustCrate[] {
    const crates: Map<string, RustCrate> = new Map();

    for (const file of files) {
      const relPath = path.relative(this.rootDir, file);
      const parts = relPath.split(path.sep);
      const crateName = parts[0] === 'src' ? 'main' : parts[0] ?? 'main';

      if (!crates.has(crateName)) {
        crates.set(crateName, {
          name: crateName,
          path: path.dirname(file),
          files: [],
          functions: [],
        });
      }

      const crate = crates.get(crateName)!;
      crate.files.push(relPath);

      // Extract function names
      const content = fs.readFileSync(file, 'utf-8');
      const fnPattern = /fn\s+(\w+)/g;
      let match;
      while ((match = fnPattern.exec(content)) !== null) {
        if (match[1]) {
          crate.functions.push(match[1]);
        }
      }
    }

    return Array.from(crates.values());
  }

  private extractActixRoutes(content: string, file: string, routes: RustRoute[]): void {
    // #[get("/path")], #[post("/path")], etc.
    const attrPattern = /#\[(get|post|put|delete|patch|head|options)\s*\(\s*"([^"]+)"\s*\)\]/gi;
    let match;
    while ((match = attrPattern.exec(content)) !== null) {
      const method = match[1]?.toUpperCase() ?? 'GET';
      const routePath = match[2] ?? '/';
      const line = this.getLineNumber(content, match.index);
      
      // Find handler name
      const afterAttr = content.slice(match.index + match[0].length);
      const handlerMatch = afterAttr.match(/async\s+fn\s+(\w+)|fn\s+(\w+)/);
      const handler = handlerMatch?.[1] ?? handlerMatch?.[2] ?? 'unknown';

      routes.push({ method, path: routePath, handler, file, line, framework: 'actix-web' });
    }

    // .route("/path", web::get().to(handler))
    const routePattern = /\.route\s*\(\s*"([^"]+)"\s*,\s*web::(get|post|put|delete|patch)\s*\(\s*\)\s*\.to\s*\(\s*(\w+)/gi;
    while ((match = routePattern.exec(content)) !== null) {
      routes.push({
        method: match[2]?.toUpperCase() ?? 'GET',
        path: match[1] ?? '/',
        handler: match[3] ?? 'unknown',
        file,
        line: this.getLineNumber(content, match.index),
        framework: 'actix-web',
      });
    }
  }

  private extractAxumRoutes(content: string, file: string, routes: RustRoute[]): void {
    // .route("/path", get(handler))
    const routePattern = /\.route\s*\(\s*"([^"]+)"\s*,\s*(get|post|put|delete|patch)\s*\(\s*(\w+)/gi;
    let match;
    while ((match = routePattern.exec(content)) !== null) {
      routes.push({
        method: match[2]?.toUpperCase() ?? 'GET',
        path: match[1] ?? '/',
        handler: match[3] ?? 'unknown',
        file,
        line: this.getLineNumber(content, match.index),
        framework: 'axum',
      });
    }
  }

  private extractRocketRoutes(content: string, file: string, routes: RustRoute[]): void {
    // #[get("/path")], #[post("/path")], etc.
    const attrPattern = /#\[(get|post|put|delete|patch|head|options)\s*\(\s*"([^"]+)"/gi;
    let match;
    while ((match = attrPattern.exec(content)) !== null) {
      const method = match[1]?.toUpperCase() ?? 'GET';
      const routePath = match[2] ?? '/';
      const line = this.getLineNumber(content, match.index);
      
      // Find handler name
      const afterAttr = content.slice(match.index + match[0].length);
      const handlerMatch = afterAttr.match(/async\s+fn\s+(\w+)|fn\s+(\w+)/);
      const handler = handlerMatch?.[1] ?? handlerMatch?.[2] ?? 'unknown';

      routes.push({ method, path: routePath, handler, file, line, framework: 'rocket' });
    }
  }

  private extractWarpRoutes(content: string, file: string, routes: RustRoute[]): void {
    // warp::path("segment").and(warp::get())
    const pathPattern = /warp::path\s*\(\s*"([^"]+)"\s*\)[^;]*\.(get|post|put|delete|patch)\s*\(\s*\)/gi;
    let match;
    while ((match = pathPattern.exec(content)) !== null) {
      routes.push({
        method: match[2]?.toUpperCase() ?? 'GET',
        path: `/${match[1]}`,
        handler: 'filter',
        file,
        line: this.getLineNumber(content, match.index),
        framework: 'warp',
      });
    }
  }

  private extractSqlxAccess(content: string, file: string, accessPoints: RustDataAccessPoint[], tables: Set<string>): void {
    // sqlx::query!("SELECT * FROM users")
    const queryPattern = /sqlx::query(?:_as)?!?\s*\(\s*"([^"]+)"/gi;
    let match;
    while ((match = queryPattern.exec(content)) !== null) {
      const sql = match[1] ?? '';
      const { table, operation } = this.parseSql(sql);
      if (table) {
        tables.add(table);
        accessPoints.push({
          table,
          operation,
          framework: 'sqlx',
          file,
          line: this.getLineNumber(content, match.index),
        });
      }
    }
  }

  private extractDieselAccess(content: string, file: string, accessPoints: RustDataAccessPoint[], tables: Set<string>): void {
    // users::table.filter(...).load(...)
    const tablePattern = /(\w+)::table\s*\.(filter|select|find|insert_into|update|delete)/gi;
    let match;
    while ((match = tablePattern.exec(content)) !== null) {
      const table = match[1] ?? 'unknown';
      const method = match[2]?.toLowerCase() ?? '';
      tables.add(table);
      
      let operation: 'read' | 'write' | 'delete' | 'unknown' = 'unknown';
      if (['filter', 'select', 'find'].includes(method)) operation = 'read';
      else if (['insert_into', 'update'].includes(method)) operation = 'write';
      else if (method === 'delete') operation = 'delete';

      accessPoints.push({
        table,
        operation,
        framework: 'diesel',
        file,
        line: this.getLineNumber(content, match.index),
      });
    }
  }

  private extractSeaOrmAccess(content: string, file: string, accessPoints: RustDataAccessPoint[], tables: Set<string>): void {
    // Entity::find().all(&db)
    const entityPattern = /(\w+)::(?:find|insert|update|delete)/gi;
    let match;
    while ((match = entityPattern.exec(content)) !== null) {
      const entity = match[1] ?? 'unknown';
      const method = match[0].split('::')[1]?.toLowerCase() ?? '';
      tables.add(entity);
      
      let operation: 'read' | 'write' | 'delete' | 'unknown' = 'unknown';
      if (method.startsWith('find')) operation = 'read';
      else if (method.startsWith('insert') || method.startsWith('update')) operation = 'write';
      else if (method.startsWith('delete')) operation = 'delete';

      accessPoints.push({
        table: entity,
        operation,
        framework: 'sea-orm',
        file,
        line: this.getLineNumber(content, match.index),
      });
    }
  }

  private parseSql(sql: string): { table: string; operation: 'read' | 'write' | 'delete' | 'unknown' } {
    const upperSql = sql.toUpperCase().trim();
    let operation: 'read' | 'write' | 'delete' | 'unknown' = 'unknown';
    let table = '';

    if (upperSql.startsWith('SELECT')) {
      operation = 'read';
      const fromMatch = sql.match(/FROM\s+["'`]?(\w+)["'`]?/i);
      table = fromMatch?.[1] ?? '';
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

    return { table, operation };
  }
}

/**
 * Create a Rust analyzer
 */
export function createRustAnalyzer(options: RustAnalyzerOptions): RustAnalyzer {
  return new RustAnalyzer(options);
}
