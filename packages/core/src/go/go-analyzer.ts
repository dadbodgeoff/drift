/**
 * Go Analyzer
 *
 * Main analyzer for Go projects. Provides comprehensive analysis of:
 * - HTTP routes (Gin, Echo, Fiber, Chi, net/http)
 * - Error handling patterns
 * - Interface implementations
 * - Data access patterns (GORM, sqlx, database/sql, Ent, Bun)
 * - Goroutine/concurrency patterns
 */

import * as fs from 'fs';
import * as path from 'path';

import { createGoDataAccessExtractor, type GoDataAccessExtractor } from '../call-graph/extractors/go-data-access-extractor.js';
import { createGoHybridExtractor, type GoHybridExtractor } from '../call-graph/extractors/go-hybrid-extractor.js';

import type { DataAccessPoint } from '../boundaries/types.js';
import type { FunctionExtraction, ClassExtraction, CallExtraction } from '../call-graph/types.js';

// ============================================================================
// Types
// ============================================================================

export interface GoAnalyzerConfig {
  /** Root directory */
  rootDir: string;
  /** Enable verbose output */
  verbose?: boolean | undefined;
  /** Include patterns */
  includePatterns?: string[];
  /** Exclude patterns */
  excludePatterns?: string[];
}

export interface GoAnalysisResult {
  /** Module name from go.mod */
  moduleName: string | null;
  /** Go version from go.mod */
  goVersion: string | null;
  /** Detected frameworks */
  detectedFrameworks: string[];
  /** Packages found */
  packages: GoPackage[];
  /** Statistics */
  stats: GoAnalysisStats;
  /** All functions */
  functions: FunctionExtraction[];
  /** All structs/interfaces */
  types: ClassExtraction[];
  /** All calls */
  calls: CallExtraction[];
  /** Data access points */
  dataAccessPoints: DataAccessPoint[];
}

export interface GoPackage {
  name: string;
  path: string;
  files: string[];
  functions: FunctionExtraction[];
  types: ClassExtraction[];
}

export interface GoAnalysisStats {
  fileCount: number;
  functionCount: number;
  structCount: number;
  interfaceCount: number;
  linesOfCode: number;
  testFileCount: number;
  testFunctionCount: number;
  analysisTimeMs: number;
}

export interface GoRoute {
  method: string;
  path: string;
  handler: string;
  framework: string;
  file: string;
  line: number;
  middleware: string[];
}

export interface GoRoutesResult {
  routes: GoRoute[];
  byFramework: Record<string, number>;
}

export interface GoErrorHandlingResult {
  stats: {
    errorChecks: number;
    wrappedErrors: number;
    sentinelErrors: number;
    customErrorTypes: number;
    uncheckedErrors: number;
  };
  patterns: GoErrorPattern[];
  issues: GoErrorIssue[];
  sentinelErrors: GoSentinelError[];
  customErrors: GoCustomError[];
}

export interface GoErrorPattern {
  type: 'propagated' | 'wrapped' | 'logged' | 'ignored';
  file: string;
  line: number;
  context: string;
}

export interface GoErrorIssue {
  type: string;
  file: string;
  line: number;
  message: string;
  suggestion?: string;
}

export interface GoSentinelError {
  name: string;
  file: string;
  line: number;
  message: string;
}

export interface GoCustomError {
  name: string;
  file: string;
  line: number;
  implementsError: boolean;
}

export interface GoInterfacesResult {
  interfaces: GoInterface[];
  implementations: GoImplementation[];
}

export interface GoInterface {
  name: string;
  package: string;
  methods: string[];
  implementations: string[];
  file: string;
  line: number;
}

export interface GoImplementation {
  struct: string;
  interface: string;
  file: string;
  line: number;
}

export interface GoDataAccessResult {
  accessPoints: DataAccessPoint[];
  byFramework: Record<string, number>;
  byOperation: Record<string, number>;
  tables: string[];
}

export interface GoGoroutinesResult {
  goroutines: GoGoroutine[];
  stats: {
    goStatements: number;
    channels: number;
    mutexes: number;
    waitGroups: number;
  };
  issues: GoConcurrencyIssue[];
}

export interface GoGoroutine {
  file: string;
  line: number;
  function: string;
  hasRecover: boolean;
  channelOps: number;
}

export interface GoConcurrencyIssue {
  type: string;
  file: string;
  line: number;
  message: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Partial<GoAnalyzerConfig> = {
  verbose: false,
  includePatterns: ['**/*.go'],
  excludePatterns: ['**/vendor/**', '**/node_modules/**', '**/.git/**'],
};

// ============================================================================
// Go Analyzer Implementation
// ============================================================================

export class GoAnalyzer {
  private config: GoAnalyzerConfig;
  private extractor: GoHybridExtractor;
  private dataAccessExtractor: GoDataAccessExtractor;

  constructor(config: GoAnalyzerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as GoAnalyzerConfig;
    this.extractor = createGoHybridExtractor();
    this.dataAccessExtractor = createGoDataAccessExtractor();
  }

  /**
   * Full project analysis
   */
  async analyze(): Promise<GoAnalysisResult> {
    const startTime = Date.now();

    const goFiles = await this.findGoFiles();
    const goMod = await this.parseGoMod();

    const packages = new Map<string, GoPackage>();
    const allFunctions: FunctionExtraction[] = [];
    const allTypes: ClassExtraction[] = [];
    const allCalls: CallExtraction[] = [];
    const allDataAccess: DataAccessPoint[] = [];
    const detectedFrameworks = new Set<string>();

    let linesOfCode = 0;
    let testFileCount = 0;
    let testFunctionCount = 0;

    for (const file of goFiles) {
      const source = await fs.promises.readFile(file, 'utf-8');
      linesOfCode += source.split('\n').length;

      const isTestFile = file.endsWith('_test.go');
      if (isTestFile) {testFileCount++;}

      // Extract code structure
      const result = this.extractor.extract(source, file);

      // Extract data access
      const dataResult = this.dataAccessExtractor.extract(source, file);
      allDataAccess.push(...dataResult.accessPoints);

      // Detect frameworks from imports
      for (const imp of result.imports) {
        const framework = this.detectFramework(imp.source);
        if (framework) {detectedFrameworks.add(framework);}
      }

      // Organize by package
      const pkgName = this.getPackageName(source);
      const pkgPath = path.dirname(file);

      if (!packages.has(pkgPath)) {
        packages.set(pkgPath, {
          name: pkgName,
          path: pkgPath,
          files: [],
          functions: [],
          types: [],
        });
      }

      const pkg = packages.get(pkgPath)!;
      pkg.files.push(file);
      pkg.functions.push(...result.functions);
      pkg.types.push(...result.classes);

      allFunctions.push(...result.functions);
      allTypes.push(...result.classes);
      allCalls.push(...result.calls);

      // Count test functions
      if (isTestFile) {
        testFunctionCount += result.functions.filter(
          (f) => f.name.startsWith('Test') || f.name.startsWith('Benchmark')
        ).length;
      }
    }

    const analysisTimeMs = Date.now() - startTime;

    return {
      moduleName: goMod.moduleName,
      goVersion: goMod.goVersion,
      detectedFrameworks: Array.from(detectedFrameworks),
      packages: Array.from(packages.values()),
      stats: {
        fileCount: goFiles.length,
        functionCount: allFunctions.length,
        structCount: allTypes.filter((t) => !this.isInterface(t)).length,
        interfaceCount: allTypes.filter((t) => this.isInterface(t)).length,
        linesOfCode,
        testFileCount,
        testFunctionCount,
        analysisTimeMs,
      },
      functions: allFunctions,
      types: allTypes,
      calls: allCalls,
      dataAccessPoints: allDataAccess,
    };
  }

  /**
   * Analyze HTTP routes
   */
  async analyzeRoutes(): Promise<GoRoutesResult> {
    const goFiles = await this.findGoFiles();
    const routes: GoRoute[] = [];

    for (const file of goFiles) {
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
  async analyzeErrorHandling(): Promise<GoErrorHandlingResult> {
    const goFiles = await this.findGoFiles();

    let errorChecks = 0;
    let wrappedErrors = 0;
    let uncheckedErrors = 0;
    const patterns: GoErrorPattern[] = [];
    const issues: GoErrorIssue[] = [];
    const sentinelErrors: GoSentinelError[] = [];
    const customErrors: GoCustomError[] = [];

    for (const file of goFiles) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const lines = source.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const lineNum = i + 1;

        // Error checks: if err != nil
        if (/if\s+err\s*!=\s*nil/.test(line)) {
          errorChecks++;
          patterns.push({ type: 'propagated', file, line: lineNum, context: line.trim() });
        }

        // Wrapped errors: fmt.Errorf with %w
        if (/fmt\.Errorf\([^)]*%w/.test(line)) {
          wrappedErrors++;
          patterns.push({ type: 'wrapped', file, line: lineNum, context: line.trim() });
        }

        // Logged errors
        if (/log\.(Error|Fatal|Panic)/.test(line) && /err/.test(line)) {
          patterns.push({ type: 'logged', file, line: lineNum, context: line.trim() });
        }

        // Ignored errors: _ = someFunc()
        if (/^\s*_\s*=\s*\w+\(/.test(line)) {
          uncheckedErrors++;
          patterns.push({ type: 'ignored', file, line: lineNum, context: line.trim() });
          issues.push({
            type: 'ignored-error',
            file,
            line: lineNum,
            message: 'Error return value is ignored',
            suggestion: 'Handle the error or explicitly document why it can be ignored',
          });
        }

        // Sentinel errors: var ErrSomething = errors.New(...)
        const sentinelMatch = line.match(/var\s+(Err\w+)\s*=\s*errors\.New\s*\(\s*"([^"]+)"/);
        if (sentinelMatch) {
          sentinelErrors.push({
            name: sentinelMatch[1]!,
            file,
            line: lineNum,
            message: sentinelMatch[2]!,
          });
        }

        // Custom error types: type XxxError struct
        const customMatch = line.match(/type\s+(\w*Error)\s+struct/);
        if (customMatch) {
          customErrors.push({
            name: customMatch[1]!,
            file,
            line: lineNum,
            implementsError: this.checkErrorImplementation(source, customMatch[1]!),
          });
        }
      }
    }

    return {
      stats: {
        errorChecks,
        wrappedErrors,
        sentinelErrors: sentinelErrors.length,
        customErrorTypes: customErrors.length,
        uncheckedErrors,
      },
      patterns,
      issues,
      sentinelErrors,
      customErrors,
    };
  }

  /**
   * Analyze interfaces and implementations
   */
  async analyzeInterfaces(): Promise<GoInterfacesResult> {
    const analysis = await this.analyze();

    const interfaces: GoInterface[] = [];
    const implementations: GoImplementation[] = [];

    // Extract interfaces
    for (const type of analysis.types) {
      if (this.isInterface(type)) {
        interfaces.push({
          name: type.name,
          package: this.getPackageFromFile(type.startLine.toString()),
          methods: type.methods,
          implementations: [],
          file: '',
          line: type.startLine,
        });
      }
    }

    // Find implementations (simplified - checks method signatures)
    for (const type of analysis.types) {
      if (!this.isInterface(type)) {
        for (const iface of interfaces) {
          if (this.implementsInterface(type, iface, analysis.functions)) {
            iface.implementations.push(type.name);
            implementations.push({
              struct: type.name,
              interface: iface.name,
              file: '',
              line: type.startLine,
            });
          }
        }
      }
    }

    return { interfaces, implementations };
  }

  /**
   * Analyze data access patterns
   */
  async analyzeDataAccess(): Promise<GoDataAccessResult> {
    const analysis = await this.analyze();

    const byFramework: Record<string, number> = {};
    const byOperation: Record<string, number> = {};
    const tables = new Set<string>();

    for (const ap of analysis.dataAccessPoints) {
      byFramework[ap.framework ?? 'unknown'] = (byFramework[ap.framework ?? 'unknown'] || 0) + 1;
      byOperation[ap.operation] = (byOperation[ap.operation] || 0) + 1;
      if (ap.table && ap.table !== 'unknown') {
        tables.add(ap.table);
      }
    }

    return {
      accessPoints: analysis.dataAccessPoints,
      byFramework,
      byOperation,
      tables: Array.from(tables),
    };
  }

  /**
   * Analyze goroutines and concurrency
   */
  async analyzeGoroutines(): Promise<GoGoroutinesResult> {
    const goFiles = await this.findGoFiles();
    const goroutines: GoGoroutine[] = [];
    let goStatements = 0;
    let channels = 0;
    let mutexes = 0;
    let waitGroups = 0;
    const issues: GoConcurrencyIssue[] = [];

    for (const file of goFiles) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const lines = source.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const lineNum = i + 1;

        // go statements
        if (/^\s*go\s+/.test(line)) {
          goStatements++;
          const hasRecover = this.checkRecoverInGoroutine(lines, i);
          goroutines.push({
            file,
            line: lineNum,
            function: this.extractGoroutineFunc(line),
            hasRecover,
            channelOps: 0,
          });

          if (!hasRecover) {
            issues.push({
              type: 'missing-recover',
              file,
              line: lineNum,
              message: 'Goroutine without recover may cause silent panics',
            });
          }
        }

        // Channel declarations
        if (/make\s*\(\s*chan\s/.test(line) || /chan\s+\w+/.test(line)) {
          channels++;
        }

        // Mutex usage
        if (/sync\.(Mutex|RWMutex)/.test(line)) {
          mutexes++;
        }

        // WaitGroup usage
        if (/sync\.WaitGroup/.test(line)) {
          waitGroups++;
        }
      }
    }

    return {
      goroutines,
      stats: { goStatements, channels, mutexes, waitGroups },
      issues,
    };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async findGoFiles(): Promise<string[]> {
    const results: string[] = [];
    const excludePatterns = this.config.excludePatterns ?? ['vendor', 'node_modules', '.git'];

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return; // Skip inaccessible directories
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.config.rootDir, fullPath);

        // Check exclusions
        const shouldExclude = excludePatterns.some((pattern) => {
          if (pattern.includes('*')) {
            // Simple glob matching
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            return regex.test(relativePath);
          }
          return relativePath.includes(pattern);
        });

        if (shouldExclude) {continue;}

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.go')) {
          results.push(fullPath);
        }
      }
    };

    await walk(this.config.rootDir);
    return results;
  }

  private async parseGoMod(): Promise<{ moduleName: string | null; goVersion: string | null }> {
    const goModPath = path.join(this.config.rootDir, 'go.mod');

    try {
      const content = await fs.promises.readFile(goModPath, 'utf-8');
      const moduleMatch = content.match(/module\s+(\S+)/);
      const goMatch = content.match(/go\s+(\d+\.\d+)/);

      return {
        moduleName: moduleMatch?.[1] ?? null,
        goVersion: goMatch?.[1] ?? null,
      };
    } catch {
      return { moduleName: null, goVersion: null };
    }
  }

  private getPackageName(source: string): string {
    const match = source.match(/package\s+(\w+)/);
    return match?.[1] ?? 'main';
  }

  private detectFramework(importPath: string): string | null {
    const frameworks: Record<string, string> = {
      'github.com/gin-gonic/gin': 'gin',
      'github.com/labstack/echo': 'echo',
      'github.com/gofiber/fiber': 'fiber',
      'github.com/go-chi/chi': 'chi',
      'gorm.io/gorm': 'gorm',
      'github.com/jmoiron/sqlx': 'sqlx',
      'entgo.io/ent': 'ent',
      'github.com/uptrace/bun': 'bun',
    };

    for (const [prefix, name] of Object.entries(frameworks)) {
      if (importPath.startsWith(prefix)) {return name;}
    }

    return null;
  }

  private isInterface(type: ClassExtraction): boolean {
    // Interfaces typically have methods but no fields in our extraction
    return type.methods.length > 0 && type.baseClasses.length === 0;
  }

  private getPackageFromFile(_file: string): string {
    return 'unknown';
  }

  private implementsInterface(
    struct: ClassExtraction,
    iface: GoInterface,
    functions: FunctionExtraction[]
  ): boolean {
    // Check if struct has all interface methods
    const structMethods = functions
      .filter((f) => f.isMethod && f.className === struct.name)
      .map((f) => f.name);

    return iface.methods.every((m) => structMethods.includes(m));
  }

  private extractRoutes(source: string, file: string): GoRoute[] {
    const routes: GoRoute[] = [];
    const lines = source.split('\n');

    // Gin/Echo patterns: r.GET("/path", handler) or e.GET("/path", handler)
    // These frameworks use the same pattern
    const ginEchoPattern = /\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*"([^"]+)"\s*,\s*(\w+)/g;

    // Chi patterns: r.Get("/path", handler)
    const chiPattern = /\.(Get|Post|Put|Delete|Patch|Head|Options)\s*\(\s*"([^"]+)"\s*,\s*(\w+)/g;

    // net/http patterns: http.HandleFunc("/path", handler)
    const httpPattern = /http\.HandleFunc\s*\(\s*"([^"]+)"\s*,\s*(\w+)/g;

    // Determine framework from imports
    const framework = source.includes('gin-gonic') ? 'gin' :
                      source.includes('labstack/echo') ? 'echo' :
                      source.includes('gofiber/fiber') ? 'fiber' : 'unknown';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      let match;

      // Gin/Echo
      while ((match = ginEchoPattern.exec(line)) !== null) {
        routes.push({
          method: match[1]!,
          path: match[2]!,
          handler: match[3]!,
          framework: framework !== 'unknown' ? framework : 'gin',
          file,
          line: lineNum,
          middleware: [],
        });
      }
      ginEchoPattern.lastIndex = 0;

      // Chi
      while ((match = chiPattern.exec(line)) !== null) {
        routes.push({
          method: match[1]!.toUpperCase(),
          path: match[2]!,
          handler: match[3]!,
          framework: 'chi',
          file,
          line: lineNum,
          middleware: [],
        });
      }
      chiPattern.lastIndex = 0;

      // net/http
      while ((match = httpPattern.exec(line)) !== null) {
        routes.push({
          method: 'ANY',
          path: match[1]!,
          handler: match[2]!,
          framework: 'net/http',
          file,
          line: lineNum,
          middleware: [],
        });
      }
      httpPattern.lastIndex = 0;
    }

    return routes;
  }

  private checkErrorImplementation(source: string, typeName: string): boolean {
    const pattern = new RegExp(`func\\s*\\(\\w*\\s*\\*?${typeName}\\)\\s*Error\\s*\\(\\s*\\)\\s*string`);
    return pattern.test(source);
  }

  private checkRecoverInGoroutine(lines: string[], startIndex: number): boolean {
    // Simple check: look for recover() in the next few lines
    for (let i = startIndex; i < Math.min(startIndex + 20, lines.length); i++) {
      if (/recover\s*\(\s*\)/.test(lines[i]!)) {
        return true;
      }
      // Stop at next function declaration
      if (/^func\s/.test(lines[i]!)) {
        break;
      }
    }
    return false;
  }

  private extractGoroutineFunc(line: string): string {
    const match = line.match(/go\s+(\w+(?:\.\w+)?)\s*\(/);
    if (match) {return match[1]!;}

    if (/go\s+func\s*\(/.test(line)) {return 'anonymous';}

    return 'unknown';
  }
}

/**
 * Factory function
 */
export function createGoAnalyzer(config: GoAnalyzerConfig): GoAnalyzer {
  return new GoAnalyzer(config);
}
