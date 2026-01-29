/**
 * PHP Analyzer
 *
 * Main analyzer for PHP projects. Provides comprehensive analysis of:
 * - HTTP routes (Laravel, Symfony, Slim, Lumen)
 * - Classes and methods
 * - Error handling patterns
 * - Data access patterns (Eloquent, Doctrine, PDO)
 * - Traits and interfaces
 */

import * as fs from 'fs';
import * as path from 'path';

import { createPhpHybridExtractor } from '../call-graph/extractors/php-hybrid-extractor.js';

import type { FunctionExtraction, ClassExtraction, CallExtraction, ImportExtraction } from '../call-graph/types.js';

// ============================================================================
// Types
// ============================================================================

export interface PhpAnalyzerConfig {
  rootDir: string;
  verbose?: boolean | undefined;
  includePatterns?: string[] | undefined;
  excludePatterns?: string[] | undefined;
}

export interface PhpAnalysisResult {
  projectInfo: {
    name: string | null;
    version: string | null;
    files: number;
    framework: string | null;
  };
  detectedFrameworks: string[];
  stats: PhpAnalysisStats;
  functions: FunctionExtraction[];
  classes: ClassExtraction[];
  calls: CallExtraction[];
  imports: ImportExtraction[];
}

export interface PhpAnalysisStats {
  fileCount: number;
  classCount: number;
  traitCount: number;
  interfaceCount: number;
  functionCount: number;
  methodCount: number;
  linesOfCode: number;
  testFileCount: number;
  analysisTimeMs: number;
}

export interface PhpRoute {
  method: string;
  path: string;
  handler: string;
  framework: string;
  file: string;
  line: number;
  middleware: string[];
}

export interface PhpRoutesResult {
  routes: PhpRoute[];
  byFramework: Record<string, number>;
}

export interface PhpErrorPattern {
  type: 'try-catch' | 'throw' | 'custom-exception' | 'error-handler';
  file: string;
  line: number;
  context: string;
}

export interface PhpErrorHandlingResult {
  stats: {
    tryCatchBlocks: number;
    throwStatements: number;
    customExceptions: number;
    errorHandlers: number;
  };
  patterns: PhpErrorPattern[];
  issues: PhpErrorIssue[];
}

export interface PhpErrorIssue {
  type: string;
  file: string;
  line: number;
  message: string;
  suggestion?: string | undefined;
}

export interface PhpDataAccessResult {
  accessPoints: PhpDataAccessPoint[];
  byFramework: Record<string, number>;
  byOperation: Record<string, number>;
  models: string[];
}

export interface PhpDataAccessPoint {
  model: string;
  operation: string;
  framework: string;
  file: string;
  line: number;
  isRawSql: boolean;
}

export interface PhpTraitsResult {
  traits: PhpTrait[];
  usages: PhpTraitUsage[];
}

export interface PhpTrait {
  name: string;
  file: string;
  line: number;
  methods: string[];
}

export interface PhpTraitUsage {
  trait: string;
  usedIn: string;
  file: string;
  line: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Partial<PhpAnalyzerConfig> = {
  verbose: false,
  includePatterns: ['**/*.php'],
  excludePatterns: ['**/vendor/**', '**/node_modules/**', '**/.git/**'],
};

// ============================================================================
// PHP Analyzer Implementation
// ============================================================================

export class PhpAnalyzer {
  private config: PhpAnalyzerConfig;
  private extractor: ReturnType<typeof createPhpHybridExtractor>;

  constructor(config: PhpAnalyzerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as PhpAnalyzerConfig;
    this.extractor = createPhpHybridExtractor();
  }

  /**
   * Full project analysis
   */
  async analyze(): Promise<PhpAnalysisResult> {
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
    let traitCount = 0;
    let interfaceCount = 0;
    let methodCount = 0;

    for (const file of files) {
      const source = await fs.promises.readFile(file, 'utf-8');
      linesOfCode += source.split('\n').length;

      const isTestFile = this.isTestFile(file);
      if (isTestFile) {testFileCount++;}

      const result = this.extractor.extract(source, file);

      // Detect frameworks from imports/use statements
      for (const imp of result.imports) {
        const framework = this.detectFramework(imp.source);
        if (framework) {detectedFrameworks.add(framework);}
      }

      // Count traits and interfaces
      traitCount += (source.match(/\btrait\s+\w+/g) || []).length;
      interfaceCount += (source.match(/\binterface\s+\w+/g) || []).length;

      // Count methods
      methodCount += result.functions.filter(f => f.isMethod).length;

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
        framework: projectInfo.framework,
      },
      detectedFrameworks: Array.from(detectedFrameworks),
      stats: {
        fileCount: files.length,
        classCount: allClasses.length,
        traitCount,
        interfaceCount,
        functionCount: allFunctions.filter(f => !f.isMethod).length,
        methodCount,
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
  async analyzeRoutes(): Promise<PhpRoutesResult> {
    const files = await this.findFiles();
    const routes: PhpRoute[] = [];

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
  async analyzeErrorHandling(): Promise<PhpErrorHandlingResult> {
    const files = await this.findFiles();

    let tryCatchBlocks = 0;
    let throwStatements = 0;
    let customExceptions = 0;
    let errorHandlers = 0;
    const patterns: PhpErrorPattern[] = [];
    const issues: PhpErrorIssue[] = [];

    for (const file of files) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const lines = source.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const lineNum = i + 1;

        // Try-catch blocks
        if (/\btry\s*\{/.test(line)) {
          tryCatchBlocks++;
          patterns.push({ type: 'try-catch', file, line: lineNum, context: line.trim() });
        }

        // Throw statements
        if (/\bthrow\s+new\s+/.test(line)) {
          throwStatements++;
          patterns.push({ type: 'throw', file, line: lineNum, context: line.trim() });
        }

        // Custom exception classes
        if (/class\s+\w+.*extends\s+.*Exception/.test(line)) {
          customExceptions++;
          patterns.push({ type: 'custom-exception', file, line: lineNum, context: line.trim() });
        }

        // Laravel exception handlers
        if (/function\s+render\s*\(.*\$exception/.test(line) || /function\s+report\s*\(.*Throwable/.test(line)) {
          errorHandlers++;
          patterns.push({ type: 'error-handler', file, line: lineNum, context: line.trim() });
        }

        // Empty catch blocks
        if (/catch\s*\([^)]+\)\s*\{\s*\}/.test(line)) {
          issues.push({
            type: 'empty-catch',
            file,
            line: lineNum,
            message: 'Empty catch block swallows exceptions silently',
            suggestion: 'Log the exception or handle it appropriately',
          });
        }

        // Catching generic Exception without re-throwing
        if (/catch\s*\(\s*\\?Exception\s+\$/.test(line)) {
          issues.push({
            type: 'generic-catch',
            file,
            line: lineNum,
            message: 'Catching generic Exception may hide specific errors',
            suggestion: 'Catch specific exception types when possible',
          });
        }
      }
    }

    return {
      stats: { tryCatchBlocks, throwStatements, customExceptions, errorHandlers },
      patterns,
      issues,
    };
  }

  /**
   * Analyze data access patterns
   */
  async analyzeDataAccess(): Promise<PhpDataAccessResult> {
    const files = await this.findFiles();
    const accessPoints: PhpDataAccessPoint[] = [];
    const models = new Set<string>();

    for (const file of files) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const fileAccessPoints = this.extractDataAccess(source, file);
      accessPoints.push(...fileAccessPoints);

      for (const ap of fileAccessPoints) {
        if (ap.model && ap.model !== 'unknown' && ap.model !== 'raw') {
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
   * Analyze traits
   */
  async analyzeTraits(): Promise<PhpTraitsResult> {
    const files = await this.findFiles();
    const traits: PhpTrait[] = [];
    const usages: PhpTraitUsage[] = [];

    for (const file of files) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const lines = source.split('\n');

      let currentClass: string | null = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const lineNum = i + 1;

        // Track current class
        const classMatch = line.match(/class\s+(\w+)/);
        if (classMatch) {
          currentClass = classMatch[1]!;
        }

        // Trait definitions
        const traitMatch = line.match(/trait\s+(\w+)/);
        if (traitMatch) {
          const methods: string[] = [];
          // Look for methods in trait
          for (let j = i + 1; j < lines.length; j++) {
            if (/^\s*\}/.test(lines[j]!)) {break;}
            const methodMatch = lines[j]!.match(/function\s+(\w+)/);
            if (methodMatch) {methods.push(methodMatch[1]!);}
          }
          traits.push({
            name: traitMatch[1]!,
            file,
            line: lineNum,
            methods,
          });
        }

        // Trait usages
        const useMatch = line.match(/use\s+(\w+(?:\s*,\s*\w+)*)\s*;/);
        if (useMatch && currentClass && !/^use\s+[A-Z].*\\/.test(line)) {
          const traitNames = useMatch[1]!.split(',').map(t => t.trim());
          for (const traitName of traitNames) {
            usages.push({
              trait: traitName,
              usedIn: currentClass,
              file,
              line: lineNum,
            });
          }
        }
      }
    }

    return { traits, usages };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async findFiles(): Promise<string[]> {
    const results: string[] = [];
    const excludePatterns = this.config.excludePatterns ?? ['vendor', 'node_modules', '.git'];

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
        } else if (entry.isFile() && entry.name.endsWith('.php')) {
          results.push(fullPath);
        }
      }
    };

    await walk(this.config.rootDir);
    return results;
  }

  private async parseProjectInfo(): Promise<{ name: string | null; version: string | null; framework: string | null }> {
    const composerPath = path.join(this.config.rootDir, 'composer.json');
    try {
      const content = await fs.promises.readFile(composerPath, 'utf-8');
      const pkg = JSON.parse(content);

      // Detect framework from dependencies
      let framework: string | null = null;
      const deps = { ...pkg.require, ...pkg['require-dev'] };
      if (deps['laravel/framework']) {framework = 'laravel';}
      else if (deps['symfony/framework-bundle']) {framework = 'symfony';}
      else if (deps['slim/slim']) {framework = 'slim';}
      else if (deps['laravel/lumen-framework']) {framework = 'lumen';}

      return {
        name: pkg.name ?? null,
        version: pkg.version ?? null,
        framework,
      };
    } catch {
      return { name: null, version: null, framework: null };
    }
  }

  private detectFramework(importSource: string): string | null {
    const frameworks: Record<string, string> = {
      'Illuminate': 'laravel',
      'Laravel': 'laravel',
      'Symfony': 'symfony',
      'Slim': 'slim',
      'Doctrine': 'doctrine',
      'Eloquent': 'eloquent',
      'PHPUnit': 'phpunit',
      'Pest': 'pest',
    };

    for (const [prefix, name] of Object.entries(frameworks)) {
      if (importSource.includes(prefix)) {return name;}
    }

    return null;
  }

  private isTestFile(file: string): boolean {
    const testPatterns = [
      /Test\.php$/,
      /Tests\.php$/,
      /\/tests?\//i,
      /Spec\.php$/,
    ];
    return testPatterns.some((p) => p.test(file));
  }

  private extractRoutes(source: string, file: string): PhpRoute[] {
    const routes: PhpRoute[] = [];
    const lines = source.split('\n');

    // Laravel patterns: Route::get('/path', [Controller::class, 'method'])
    const laravelPattern = /Route::(get|post|put|delete|patch|options|any)\s*\(\s*['"]([^'"]+)['"]/gi;

    // Symfony patterns: #[Route('/path', methods: ['GET'])]
    const symfonyPattern = /#\[Route\s*\(\s*['"]([^'"]+)['"]/gi;

    // Slim patterns: $app->get('/path', function)
    const slimPattern = /\$app->(get|post|put|delete|patch|options)\s*\(\s*['"]([^'"]+)['"]/gi;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      let match;

      // Laravel
      while ((match = laravelPattern.exec(line)) !== null) {
        routes.push({
          method: match[1]!.toUpperCase(),
          path: match[2]!,
          handler: this.extractLaravelHandler(line),
          framework: 'laravel',
          file,
          line: lineNum,
          middleware: this.extractLaravelMiddleware(lines, i),
        });
      }
      laravelPattern.lastIndex = 0;

      // Symfony
      while ((match = symfonyPattern.exec(line)) !== null) {
        const methods = this.extractSymfonyMethods(line);
        for (const method of methods) {
          routes.push({
            method,
            path: match[1]!,
            handler: this.extractNextMethod(lines, i),
            framework: 'symfony',
            file,
            line: lineNum,
            middleware: [],
          });
        }
      }
      symfonyPattern.lastIndex = 0;

      // Slim
      while ((match = slimPattern.exec(line)) !== null) {
        routes.push({
          method: match[1]!.toUpperCase(),
          path: match[2]!,
          handler: 'closure',
          framework: 'slim',
          file,
          line: lineNum,
          middleware: [],
        });
      }
      slimPattern.lastIndex = 0;
    }

    return routes;
  }

  private extractLaravelHandler(line: string): string {
    // [Controller::class, 'method']
    const match = line.match(/\[\s*(\w+)::class\s*,\s*['"](\w+)['"]\s*\]/);
    if (match) {return `${match[1]}@${match[2]}`;}

    // 'Controller@method'
    const stringMatch = line.match(/['"](\w+@\w+)['"]/);
    if (stringMatch) {return stringMatch[1]!;}

    return 'closure';
  }

  private extractLaravelMiddleware(lines: string[], routeLine: number): string[] {
    const middleware: string[] = [];
    // Look for ->middleware() on same or next line
    for (let i = routeLine; i < Math.min(routeLine + 3, lines.length); i++) {
      const match = lines[i]!.match(/->middleware\s*\(\s*\[?([^\])]+)\]?\s*\)/);
      if (match) {
        const mws = match[1]!.split(',').map(m => m.trim().replace(/['"]/g, ''));
        middleware.push(...mws);
      }
    }
    return middleware;
  }

  private extractSymfonyMethods(line: string): string[] {
    const methodsMatch = line.match(/methods:\s*\[([^\]]+)\]/);
    if (methodsMatch) {
      return methodsMatch[1]!
        .split(',')
        .map(m => m.trim().replace(/['"]/g, '').toUpperCase())
        .filter(m => m);
    }
    return ['GET'];
  }

  private extractNextMethod(lines: string[], annotationLine: number): string {
    for (let i = annotationLine + 1; i < Math.min(annotationLine + 10, lines.length); i++) {
      const match = lines[i]!.match(/function\s+(\w+)/);
      if (match) {return match[1]!;}
    }
    return 'unknown';
  }

  private extractDataAccess(source: string, file: string): PhpDataAccessPoint[] {
    const accessPoints: PhpDataAccessPoint[] = [];
    const lines = source.split('\n');

    // Laravel Eloquent: Model::where(), $model->save()
    const eloquentStaticPattern = /(\w+)::(where|find|findOrFail|all|first|firstOrFail|create|insert|update|delete|destroy)/gi;
    const eloquentInstancePattern = /\$\w+->(save|update|delete|refresh|push)/gi;

    // Laravel Query Builder: DB::table('users')
    const dbPattern = /DB::table\s*\(\s*['"](\w+)['"]\s*\)/gi;

    // Doctrine: $em->getRepository(), $em->persist()
    const doctrinePattern = /\$\w+->(getRepository|persist|remove|flush|find)/gi;

    // PDO: $pdo->query(), $stmt->execute()
    const pdoPattern = /\$(?:pdo|db|conn|stmt)->(query|execute|prepare)/gi;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      let match;

      // Eloquent static
      while ((match = eloquentStaticPattern.exec(line)) !== null) {
        accessPoints.push({
          model: match[1]!,
          operation: this.normalizeOperation(match[2]!),
          framework: 'eloquent',
          file,
          line: lineNum,
          isRawSql: false,
        });
      }
      eloquentStaticPattern.lastIndex = 0;

      // Eloquent instance
      while ((match = eloquentInstancePattern.exec(line)) !== null) {
        accessPoints.push({
          model: 'unknown',
          operation: this.normalizeOperation(match[1]!),
          framework: 'eloquent',
          file,
          line: lineNum,
          isRawSql: false,
        });
      }
      eloquentInstancePattern.lastIndex = 0;

      // DB facade
      while ((match = dbPattern.exec(line)) !== null) {
        accessPoints.push({
          model: match[1]!,
          operation: 'query',
          framework: 'eloquent',
          file,
          line: lineNum,
          isRawSql: false,
        });
      }
      dbPattern.lastIndex = 0;

      // Doctrine
      while ((match = doctrinePattern.exec(line)) !== null) {
        accessPoints.push({
          model: 'unknown',
          operation: this.normalizeOperation(match[1]!),
          framework: 'doctrine',
          file,
          line: lineNum,
          isRawSql: false,
        });
      }
      doctrinePattern.lastIndex = 0;

      // PDO
      if (pdoPattern.test(line)) {
        accessPoints.push({
          model: 'raw',
          operation: 'query',
          framework: 'pdo',
          file,
          line: lineNum,
          isRawSql: true,
        });
      }
      pdoPattern.lastIndex = 0;
    }

    return accessPoints;
  }

  private normalizeOperation(op: string): string {
    const opLower = op.toLowerCase();
    if (['where', 'find', 'findorfail', 'all', 'first', 'firstorfail', 'get', 'getrepository', 'query'].includes(opLower)) {return 'read';}
    if (['create', 'insert', 'save', 'persist', 'push'].includes(opLower)) {return 'write';}
    if (['update', 'refresh'].includes(opLower)) {return 'update';}
    if (['delete', 'destroy', 'remove'].includes(opLower)) {return 'delete';}
    return 'unknown';
  }
}

/**
 * Factory function
 */
export function createPhpAnalyzer(config: PhpAnalyzerConfig): PhpAnalyzer {
  return new PhpAnalyzer(config);
}
