/**
 * Python Analyzer
 *
 * Main analyzer for Python projects. Provides comprehensive analysis of:
 * - HTTP routes (Flask, FastAPI, Django, Starlette)
 * - Classes and functions
 * - Error handling patterns
 * - Data access patterns (Django ORM, SQLAlchemy, Tortoise, Peewee)
 * - Async patterns
 * - Decorators
 */

import * as fs from 'fs';
import * as path from 'path';

import { createPythonHybridExtractor } from '../call-graph/extractors/python-hybrid-extractor.js';

import type { FunctionExtraction, ClassExtraction, CallExtraction, ImportExtraction } from '../call-graph/types.js';

// ============================================================================
// Types
// ============================================================================

export interface PythonAnalyzerConfig {
  rootDir: string;
  verbose?: boolean | undefined;
  includePatterns?: string[] | undefined;
  excludePatterns?: string[] | undefined;
}

export interface PythonAnalysisResult {
  projectInfo: {
    name: string | null;
    version: string | null;
    files: number;
  };
  detectedFrameworks: string[];
  stats: PythonAnalysisStats;
  functions: FunctionExtraction[];
  classes: ClassExtraction[];
  calls: CallExtraction[];
  imports: ImportExtraction[];
}

export interface PythonAnalysisStats {
  fileCount: number;
  functionCount: number;
  classCount: number;
  asyncFunctionCount: number;
  decoratorCount: number;
  linesOfCode: number;
  testFileCount: number;
  analysisTimeMs: number;
}

export interface PyRoute {
  method: string;
  path: string;
  handler: string;
  framework: string;
  file: string;
  line: number;
  decorators: string[];
}

export interface PyRoutesResult {
  routes: PyRoute[];
  byFramework: Record<string, number>;
}

export interface PyErrorPattern {
  type: 'try-except' | 'raise' | 'custom-exception' | 'context-manager';
  file: string;
  line: number;
  context: string;
}

export interface PyErrorHandlingResult {
  stats: {
    tryExceptBlocks: number;
    raiseStatements: number;
    customExceptions: number;
    contextManagers: number;
  };
  patterns: PyErrorPattern[];
  issues: PyErrorIssue[];
}

export interface PyErrorIssue {
  type: string;
  file: string;
  line: number;
  message: string;
  suggestion?: string | undefined;
}

export interface PyDataAccessResult {
  accessPoints: PyDataAccessPoint[];
  byFramework: Record<string, number>;
  byOperation: Record<string, number>;
  models: string[];
}

export interface PyDataAccessPoint {
  model: string;
  operation: string;
  framework: string;
  file: string;
  line: number;
  isRawSql: boolean;
}

export interface PyDecorator {
  name: string;
  file: string;
  line: number;
  arguments: string[];
}

export interface PyDecoratorsResult {
  decorators: PyDecorator[];
  byName: Record<string, number>;
}

export interface PyAsyncResult {
  asyncFunctions: PyAsyncFunction[];
  awaitCalls: number;
  asyncContextManagers: number;
}

export interface PyAsyncFunction {
  name: string;
  file: string;
  line: number;
  awaitCount: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Partial<PythonAnalyzerConfig> = {
  verbose: false,
  includePatterns: ['**/*.py'],
  excludePatterns: ['**/venv/**', '**/.venv/**', '**/site-packages/**', '**/__pycache__/**', '**/.git/**'],
};

const PY_EXTENSIONS = ['.py', '.pyw', '.pyi'];

// ============================================================================
// Python Analyzer Implementation
// ============================================================================

export class PythonAnalyzer {
  private config: PythonAnalyzerConfig;
  private extractor: ReturnType<typeof createPythonHybridExtractor>;

  constructor(config: PythonAnalyzerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as PythonAnalyzerConfig;
    this.extractor = createPythonHybridExtractor();
  }

  /**
   * Full project analysis
   */
  async analyze(): Promise<PythonAnalysisResult> {
    const startTime = Date.now();

    const files = await this.findFiles();
    const projectInfo = await this.parseProjectInfo();

    const allFunctions: FunctionExtraction[] = [];
    const allClasses: ClassExtraction[] = [];
    const allCalls: CallExtraction[] = [];
    const allImports: ImportExtraction[] = [];
    const detectedFrameworks = new Set<string>();

    let linesOfCode = 0;
    let testFileCount = 0;
    let asyncFunctionCount = 0;
    let decoratorCount = 0;

    for (const file of files) {
      const source = await fs.promises.readFile(file, 'utf-8');
      linesOfCode += source.split('\n').length;

      const isTestFile = this.isTestFile(file);
      if (isTestFile) {testFileCount++;}

      const result = this.extractor.extract(source, file);

      // Detect frameworks from imports
      for (const imp of result.imports) {
        const framework = this.detectFramework(imp.source);
        if (framework) {detectedFrameworks.add(framework);}
      }

      // Count async functions
      asyncFunctionCount += result.functions.filter(f => f.isAsync).length;

      // Count decorators
      decoratorCount += result.functions.reduce((sum, f) => sum + f.decorators.length, 0);

      allFunctions.push(...result.functions);
      allClasses.push(...result.classes);
      allCalls.push(...result.calls);
      allImports.push(...result.imports);
    }

    const analysisTimeMs = Date.now() - startTime;

    return {
      projectInfo: {
        name: projectInfo.name,
        version: projectInfo.version,
        files: files.length,
      },
      detectedFrameworks: Array.from(detectedFrameworks),
      stats: {
        fileCount: files.length,
        functionCount: allFunctions.length,
        classCount: allClasses.length,
        asyncFunctionCount,
        decoratorCount,
        linesOfCode,
        testFileCount,
        analysisTimeMs,
      },
      functions: allFunctions,
      classes: allClasses,
      calls: allCalls,
      imports: allImports,
    };
  }

  /**
   * Analyze HTTP routes
   */
  async analyzeRoutes(): Promise<PyRoutesResult> {
    const files = await this.findFiles();
    const routes: PyRoute[] = [];

    for (const file of files) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const fileRoutes = this.extractRoutes(source, file);
      routes.push(...fileRoutes);
    }

    const byFramework: Record<string, number> = {};
    for (const route of routes) {
      byFramework[route.framework] = (byFramework[route.framework] || 0) + 1;
    }

    return { routes, byFramework };
  }

  /**
   * Analyze error handling patterns
   */
  async analyzeErrorHandling(): Promise<PyErrorHandlingResult> {
    const files = await this.findFiles();

    let tryExceptBlocks = 0;
    let raiseStatements = 0;
    let customExceptions = 0;
    let contextManagers = 0;
    const patterns: PyErrorPattern[] = [];
    const issues: PyErrorIssue[] = [];

    for (const file of files) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const lines = source.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const lineNum = i + 1;

        // Try-except blocks
        if (/^\s*try\s*:/.test(line)) {
          tryExceptBlocks++;
          patterns.push({ type: 'try-except', file, line: lineNum, context: line.trim() });
        }

        // Raise statements
        if (/\braise\s+/.test(line)) {
          raiseStatements++;
          patterns.push({ type: 'raise', file, line: lineNum, context: line.trim() });
        }

        // Custom exception classes
        if (/class\s+\w+.*\(.*Exception.*\)/.test(line) || /class\s+\w+.*\(.*Error.*\)/.test(line)) {
          customExceptions++;
          patterns.push({ type: 'custom-exception', file, line: lineNum, context: line.trim() });
        }

        // Context managers (with statement)
        if (/^\s*with\s+/.test(line)) {
          contextManagers++;
          patterns.push({ type: 'context-manager', file, line: lineNum, context: line.trim() });
        }

        // Bare except (bad practice)
        if (/except\s*:/.test(line) && !/except\s+\w+/.test(line)) {
          issues.push({
            type: 'bare-except',
            file,
            line: lineNum,
            message: 'Bare except catches all exceptions including KeyboardInterrupt',
            suggestion: 'Use except Exception: or catch specific exceptions',
          });
        }

        // Pass in except (swallowed exception)
        if (/except.*:\s*$/.test(line) && i + 1 < lines.length && /^\s*pass\s*$/.test(lines[i + 1]!)) {
          issues.push({
            type: 'swallowed-exception',
            file,
            line: lineNum,
            message: 'Exception is caught but silently ignored',
            suggestion: 'Log the exception or handle it appropriately',
          });
        }
      }
    }

    return {
      stats: { tryExceptBlocks, raiseStatements, customExceptions, contextManagers },
      patterns,
      issues,
    };
  }

  /**
   * Analyze data access patterns
   */
  async analyzeDataAccess(): Promise<PyDataAccessResult> {
    const files = await this.findFiles();
    const accessPoints: PyDataAccessPoint[] = [];
    const models = new Set<string>();

    for (const file of files) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const fileAccessPoints = this.extractDataAccess(source, file);
      accessPoints.push(...fileAccessPoints);

      for (const ap of fileAccessPoints) {
        if (ap.model && ap.model !== 'unknown') {
          models.add(ap.model);
        }
      }
    }

    const byFramework: Record<string, number> = {};
    const byOperation: Record<string, number> = {};

    for (const ap of accessPoints) {
      byFramework[ap.framework] = (byFramework[ap.framework] || 0) + 1;
      byOperation[ap.operation] = (byOperation[ap.operation] || 0) + 1;
    }

    return { accessPoints, byFramework, byOperation, models: Array.from(models) };
  }

  /**
   * Analyze decorators
   */
  async analyzeDecorators(): Promise<PyDecoratorsResult> {
    const files = await this.findFiles();
    const decorators: PyDecorator[] = [];

    for (const file of files) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const fileDecorators = this.extractDecorators(source, file);
      decorators.push(...fileDecorators);
    }

    const byName: Record<string, number> = {};
    for (const dec of decorators) {
      byName[dec.name] = (byName[dec.name] || 0) + 1;
    }

    return { decorators, byName };
  }

  /**
   * Analyze async patterns
   */
  async analyzeAsync(): Promise<PyAsyncResult> {
    const files = await this.findFiles();
    const asyncFunctions: PyAsyncFunction[] = [];
    let awaitCalls = 0;
    let asyncContextManagers = 0;

    for (const file of files) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const result = this.extractor.extract(source, file);
      const lines = source.split('\n');

      // Find async functions
      for (const func of result.functions) {
        if (func.isAsync) {
          // Count awaits in function body
          let funcAwaitCount = 0;
          for (let i = func.bodyStartLine - 1; i < func.bodyEndLine && i < lines.length; i++) {
            const matches = lines[i]!.match(/\bawait\b/g);
            if (matches) {funcAwaitCount += matches.length;}
          }
          asyncFunctions.push({
            name: func.qualifiedName,
            file,
            line: func.startLine,
            awaitCount: funcAwaitCount,
          });
        }
      }

      // Count total awaits and async context managers
      for (const line of lines) {
        const awaitMatches = line.match(/\bawait\b/g);
        if (awaitMatches) {awaitCalls += awaitMatches.length;}
        if (/async\s+with\b/.test(line)) {asyncContextManagers++;}
      }
    }

    return { asyncFunctions, awaitCalls, asyncContextManagers };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async findFiles(): Promise<string[]> {
    const results: string[] = [];
    const excludePatterns = this.config.excludePatterns ?? ['venv', '.venv', 'site-packages', '__pycache__', '.git'];

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.config.rootDir, fullPath);

        const shouldExclude = excludePatterns.some((pattern) => {
          if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            return regex.test(relativePath);
          }
          return relativePath.includes(pattern);
        });

        if (shouldExclude) {continue;}

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (PY_EXTENSIONS.includes(ext)) {
            results.push(fullPath);
          }
        }
      }
    };

    await walk(this.config.rootDir);
    return results;
  }

  private async parseProjectInfo(): Promise<{ name: string | null; version: string | null }> {
    // Try pyproject.toml
    const pyprojectPath = path.join(this.config.rootDir, 'pyproject.toml');
    try {
      const content = await fs.promises.readFile(pyprojectPath, 'utf-8');
      const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/);
      const versionMatch = content.match(/version\s*=\s*["']([^"']+)["']/);
      return {
        name: nameMatch?.[1] ?? null,
        version: versionMatch?.[1] ?? null,
      };
    } catch {
      // Try setup.py
      const setupPath = path.join(this.config.rootDir, 'setup.py');
      try {
        const content = await fs.promises.readFile(setupPath, 'utf-8');
        const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/);
        const versionMatch = content.match(/version\s*=\s*["']([^"']+)["']/);
        return {
          name: nameMatch?.[1] ?? null,
          version: versionMatch?.[1] ?? null,
        };
      } catch {
        return { name: null, version: null };
      }
    }
  }

  private detectFramework(importSource: string): string | null {
    const frameworks: Record<string, string> = {
      'flask': 'flask',
      'fastapi': 'fastapi',
      'django': 'django',
      'starlette': 'starlette',
      'tornado': 'tornado',
      'aiohttp': 'aiohttp',
      'sanic': 'sanic',
      'sqlalchemy': 'sqlalchemy',
      'tortoise': 'tortoise',
      'peewee': 'peewee',
      'mongoengine': 'mongoengine',
      'pymongo': 'pymongo',
      'redis': 'redis',
      'celery': 'celery',
      'pytest': 'pytest',
      'unittest': 'unittest',
    };

    for (const [prefix, name] of Object.entries(frameworks)) {
      if (importSource.startsWith(prefix)) {return name;}
    }

    return null;
  }

  private isTestFile(file: string): boolean {
    const testPatterns = [
      /test_.*\.py$/,
      /.*_test\.py$/,
      /tests?\/.*\.py$/,
      /conftest\.py$/,
    ];
    return testPatterns.some((p) => p.test(file));
  }

  private extractRoutes(source: string, file: string): PyRoute[] {
    const routes: PyRoute[] = [];
    const lines = source.split('\n');

    // Flask patterns: @app.route('/path'), @blueprint.route('/path')
    const flaskPattern = /@(?:app|blueprint|\w+)\.route\s*\(\s*['"]([^'"]+)['"]/gi;

    // FastAPI patterns: @app.get('/path'), @router.post('/path')
    const fastapiPattern = /@(?:app|router|\w+)\.(get|post|put|delete|patch|head|options)\s*\(\s*['"]([^'"]+)['"]/gi;

    // Django patterns: path('route/', view)
    const djangoPattern = /path\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/gi;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      let match;

      // Flask
      while ((match = flaskPattern.exec(line)) !== null) {
        const methods = this.extractFlaskMethods(line);
        for (const method of methods) {
          routes.push({
            method,
            path: match[1]!,
            handler: this.extractNextFunction(lines, i),
            framework: 'flask',
            file,
            line: lineNum,
            decorators: [line.trim()],
          });
        }
      }
      flaskPattern.lastIndex = 0;

      // FastAPI
      while ((match = fastapiPattern.exec(line)) !== null) {
        routes.push({
          method: match[1]!.toUpperCase(),
          path: match[2]!,
          handler: this.extractNextFunction(lines, i),
          framework: 'fastapi',
          file,
          line: lineNum,
          decorators: [line.trim()],
        });
      }
      fastapiPattern.lastIndex = 0;

      // Django
      while ((match = djangoPattern.exec(line)) !== null) {
        routes.push({
          method: 'ALL',
          path: '/' + match[1]!,
          handler: match[2]!,
          framework: 'django',
          file,
          line: lineNum,
          decorators: [],
        });
      }
      djangoPattern.lastIndex = 0;
    }

    return routes;
  }

  private extractFlaskMethods(line: string): string[] {
    const methodsMatch = line.match(/methods\s*=\s*\[([^\]]+)\]/i);
    if (methodsMatch) {
      return methodsMatch[1]!
        .split(',')
        .map(m => m.trim().replace(/['"]/g, '').toUpperCase())
        .filter(m => m);
    }
    return ['GET'];
  }

  private extractNextFunction(lines: string[], decoratorLine: number): string {
    for (let i = decoratorLine + 1; i < Math.min(decoratorLine + 10, lines.length); i++) {
      const match = lines[i]!.match(/(?:async\s+)?def\s+(\w+)/);
      if (match) {return match[1]!;}
      // Stop if we hit another decorator or non-decorator line
      if (!lines[i]!.trim().startsWith('@') && lines[i]!.trim() !== '') {
        break;
      }
    }
    return 'unknown';
  }

  private extractDataAccess(source: string, file: string): PyDataAccessPoint[] {
    const accessPoints: PyDataAccessPoint[] = [];
    const lines = source.split('\n');

    // Django ORM: Model.objects.filter()
    const djangoPattern = /(\w+)\.objects\.(filter|get|create|update|delete|all|first|last|count|exists)/gi;

    // SQLAlchemy: session.query(Model)
    const sqlalchemyPattern = /session\.query\s*\(\s*(\w+)\s*\)/gi;

    // Raw SQL: cursor.execute(), connection.execute()
    const rawSqlPattern = /(?:cursor|connection|conn|db)\.execute\s*\(/gi;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      let match;

      // Django ORM
      while ((match = djangoPattern.exec(line)) !== null) {
        accessPoints.push({
          model: match[1]!,
          operation: this.normalizeOperation(match[2]!),
          framework: 'django',
          file,
          line: lineNum,
          isRawSql: false,
        });
      }
      djangoPattern.lastIndex = 0;

      // SQLAlchemy
      while ((match = sqlalchemyPattern.exec(line)) !== null) {
        accessPoints.push({
          model: match[1]!,
          operation: 'read',
          framework: 'sqlalchemy',
          file,
          line: lineNum,
          isRawSql: false,
        });
      }
      sqlalchemyPattern.lastIndex = 0;

      // Raw SQL
      if (rawSqlPattern.test(line)) {
        accessPoints.push({
          model: 'raw',
          operation: 'query',
          framework: 'raw-sql',
          file,
          line: lineNum,
          isRawSql: true,
        });
      }
      rawSqlPattern.lastIndex = 0;
    }

    return accessPoints;
  }

  private normalizeOperation(op: string): string {
    const opLower = op.toLowerCase();
    if (['filter', 'get', 'all', 'first', 'last', 'count', 'exists'].includes(opLower)) {return 'read';}
    if (['create', 'save', 'insert'].includes(opLower)) {return 'write';}
    if (['update'].includes(opLower)) {return 'update';}
    if (['delete', 'remove'].includes(opLower)) {return 'delete';}
    return 'unknown';
  }

  private extractDecorators(source: string, file: string): PyDecorator[] {
    const decorators: PyDecorator[] = [];
    const lines = source.split('\n');

    const decoratorPattern = /@(\w+)(?:\s*\(([^)]*)\))?/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      let match;
      while ((match = decoratorPattern.exec(line)) !== null) {
        decorators.push({
          name: match[1]!,
          file,
          line: lineNum,
          arguments: match[2] ? match[2].split(',').map(a => a.trim()) : [],
        });
      }
      decoratorPattern.lastIndex = 0;
    }

    return decorators;
  }
}

/**
 * Factory function
 */
export function createPythonAnalyzer(config: PythonAnalyzerConfig): PythonAnalyzer {
  return new PythonAnalyzer(config);
}
