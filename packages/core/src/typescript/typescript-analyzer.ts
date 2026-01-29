/**
 * TypeScript/JavaScript Analyzer
 *
 * Main analyzer for TypeScript/JavaScript projects. Provides comprehensive analysis of:
 * - HTTP routes (Express, NestJS, Fastify, Next.js)
 * - React components and hooks
 * - Error handling patterns
 * - Data access patterns (Prisma, TypeORM, Drizzle, Sequelize)
 * - Async patterns
 * - Decorators (NestJS)
 */

import * as fs from 'fs';
import * as path from 'path';

import { createTypeScriptHybridExtractor } from '../call-graph/extractors/typescript-hybrid-extractor.js';

import type { FunctionExtraction, ClassExtraction, CallExtraction, ImportExtraction } from '../call-graph/types.js';

// ============================================================================
// Types
// ============================================================================

export interface TypeScriptAnalyzerConfig {
  rootDir: string;
  verbose?: boolean | undefined;
  includePatterns?: string[] | undefined;
  excludePatterns?: string[] | undefined;
}

export interface TypeScriptAnalysisResult {
  projectInfo: {
    name: string | null;
    version: string | null;
    hasTypeScript: boolean;
    hasJavaScript: boolean;
    files: number;
    tsFiles: number;
    jsFiles: number;
  };
  detectedFrameworks: string[];
  stats: TypeScriptAnalysisStats;
  functions: FunctionExtraction[];
  classes: ClassExtraction[];
  calls: CallExtraction[];
  imports: ImportExtraction[];
}

export interface TypeScriptAnalysisStats {
  fileCount: number;
  functionCount: number;
  classCount: number;
  componentCount: number;
  hookCount: number;
  asyncFunctionCount: number;
  decoratorCount: number;
  linesOfCode: number;
  testFileCount: number;
  analysisTimeMs: number;
}

export interface TSRoute {
  method: string;
  path: string;
  handler: string;
  framework: string;
  file: string;
  line: number;
  middleware: string[];
  decorators: string[];
}

export interface TSRoutesResult {
  routes: TSRoute[];
  byFramework: Record<string, number>;
}

export interface TSComponent {
  name: string;
  type: 'functional' | 'class';
  file: string;
  line: number;
  props: string[];
  hooks: string[];
  isExported: boolean;
}

export interface TSComponentsResult {
  components: TSComponent[];
  byType: Record<string, number>;
}

export interface TSHook {
  name: string;
  type: 'builtin' | 'custom';
  file: string;
  line: number;
  dependencies: string[];
}

export interface TSHooksResult {
  hooks: TSHook[];
  byType: Record<string, number>;
  customHooks: string[];
}

export interface TSErrorPattern {
  type: 'try-catch' | 'promise-catch' | 'error-boundary' | 'throw';
  file: string;
  line: number;
  context: string;
}

export interface TSErrorHandlingResult {
  stats: {
    tryCatchBlocks: number;
    promiseCatches: number;
    errorBoundaries: number;
    throwStatements: number;
  };
  patterns: TSErrorPattern[];
  issues: TSErrorIssue[];
}

export interface TSErrorIssue {
  type: string;
  file: string;
  line: number;
  message: string;
  suggestion?: string;
}

export interface TSDataAccessResult {
  accessPoints: TSDataAccessPoint[];
  byFramework: Record<string, number>;
  byOperation: Record<string, number>;
  models: string[];
}

export interface TSDataAccessPoint {
  model: string;
  operation: string;
  framework: string;
  file: string;
  line: number;
  isRawSql: boolean;
}

export interface TSDecorator {
  name: string;
  target: 'class' | 'method' | 'property' | 'parameter';
  file: string;
  line: number;
  arguments: string[];
}

export interface TSDecoratorsResult {
  decorators: TSDecorator[];
  byName: Record<string, number>;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Partial<TypeScriptAnalyzerConfig> = {
  verbose: false,
  includePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
  excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
};

const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];
const JS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];
const ALL_EXTENSIONS = [...TS_EXTENSIONS, ...JS_EXTENSIONS];

// ============================================================================
// TypeScript Analyzer Implementation
// ============================================================================

export class TypeScriptAnalyzer {
  private config: TypeScriptAnalyzerConfig;
  private extractor: ReturnType<typeof createTypeScriptHybridExtractor>;

  constructor(config: TypeScriptAnalyzerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as TypeScriptAnalyzerConfig;
    this.extractor = createTypeScriptHybridExtractor();
  }

  /**
   * Full project analysis
   */
  async analyze(): Promise<TypeScriptAnalysisResult> {
    const startTime = Date.now();

    const files = await this.findFiles();
    const packageJson = await this.parsePackageJson();

    const allFunctions: FunctionExtraction[] = [];
    const allClasses: ClassExtraction[] = [];
    const allCalls: CallExtraction[] = [];
    const allImports: ImportExtraction[] = [];
    const detectedFrameworks = new Set<string>();

    let linesOfCode = 0;
    let testFileCount = 0;
    let tsFiles = 0;
    let jsFiles = 0;
    let componentCount = 0;
    let hookCount = 0;
    let asyncFunctionCount = 0;
    let decoratorCount = 0;

    for (const file of files) {
      const source = await fs.promises.readFile(file, 'utf-8');
      linesOfCode += source.split('\n').length;

      const ext = path.extname(file);
      if (TS_EXTENSIONS.includes(ext)) {tsFiles++;}
      if (JS_EXTENSIONS.includes(ext)) {jsFiles++;}

      const isTestFile = this.isTestFile(file);
      if (isTestFile) {testFileCount++;}

      const result = this.extractor.extract(source, file);

      // Detect frameworks from imports
      for (const imp of result.imports) {
        const framework = this.detectFramework(imp.source);
        if (framework) {detectedFrameworks.add(framework);}
      }

      // Count components
      componentCount += this.countComponents(result.functions, result.classes, source);

      // Count hooks
      hookCount += this.countHooks(result.calls);

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
        name: packageJson.name,
        version: packageJson.version,
        hasTypeScript: tsFiles > 0,
        hasJavaScript: jsFiles > 0,
        files: files.length,
        tsFiles,
        jsFiles,
      },
      detectedFrameworks: Array.from(detectedFrameworks),
      stats: {
        fileCount: files.length,
        functionCount: allFunctions.length,
        classCount: allClasses.length,
        componentCount,
        hookCount,
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
  async analyzeRoutes(): Promise<TSRoutesResult> {
    const files = await this.findFiles();
    const routes: TSRoute[] = [];

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
   * Analyze React components
   */
  async analyzeComponents(): Promise<TSComponentsResult> {
    const files = await this.findFiles();
    const components: TSComponent[] = [];

    for (const file of files) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const result = this.extractor.extract(source, file);
      const fileComponents = this.extractComponents(result.functions, result.classes, source, file);
      components.push(...fileComponents);
    }

    const byType: Record<string, number> = {
      functional: components.filter(c => c.type === 'functional').length,
      class: components.filter(c => c.type === 'class').length,
    };

    return { components, byType };
  }

  /**
   * Analyze React hooks usage
   */
  async analyzeHooks(): Promise<TSHooksResult> {
    const files = await this.findFiles();
    const hooks: TSHook[] = [];
    const customHooks = new Set<string>();

    for (const file of files) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const result = this.extractor.extract(source, file);
      const fileHooks = this.extractHooks(result.calls, result.functions, source, file);
      hooks.push(...fileHooks);

      // Find custom hook definitions
      for (const func of result.functions) {
        if (func.name.startsWith('use') && func.name.length > 3) {
          customHooks.add(func.name);
        }
      }
    }

    const byType: Record<string, number> = {
      builtin: hooks.filter(h => h.type === 'builtin').length,
      custom: hooks.filter(h => h.type === 'custom').length,
    };

    return { hooks, byType, customHooks: Array.from(customHooks) };
  }

  /**
   * Analyze error handling patterns
   */
  async analyzeErrorHandling(): Promise<TSErrorHandlingResult> {
    const files = await this.findFiles();

    let tryCatchBlocks = 0;
    let promiseCatches = 0;
    let errorBoundaries = 0;
    let throwStatements = 0;
    const patterns: TSErrorPattern[] = [];
    const issues: TSErrorIssue[] = [];

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

        // Promise .catch()
        if (/\.catch\s*\(/.test(line)) {
          promiseCatches++;
          patterns.push({ type: 'promise-catch', file, line: lineNum, context: line.trim() });
        }

        // Error boundaries (React)
        if (/componentDidCatch|getDerivedStateFromError/.test(line)) {
          errorBoundaries++;
          patterns.push({ type: 'error-boundary', file, line: lineNum, context: line.trim() });
        }

        // Throw statements
        if (/\bthrow\s+/.test(line)) {
          throwStatements++;
          patterns.push({ type: 'throw', file, line: lineNum, context: line.trim() });
        }

        // Empty catch blocks
        if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
          issues.push({
            type: 'empty-catch',
            file,
            line: lineNum,
            message: 'Empty catch block swallows errors silently',
            suggestion: 'Log the error or handle it appropriately',
          });
        }
      }
    }

    return {
      stats: { tryCatchBlocks, promiseCatches, errorBoundaries, throwStatements },
      patterns,
      issues,
    };
  }

  /**
   * Analyze data access patterns
   */
  async analyzeDataAccess(): Promise<TSDataAccessResult> {
    const files = await this.findFiles();
    const accessPoints: TSDataAccessPoint[] = [];
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
   * Analyze decorators (NestJS, TypeORM, etc.)
   */
  async analyzeDecorators(): Promise<TSDecoratorsResult> {
    const files = await this.findFiles();
    const decorators: TSDecorator[] = [];

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

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async findFiles(): Promise<string[]> {
    const results: string[] = [];
    const excludePatterns = this.config.excludePatterns ?? ['node_modules', 'dist', 'build', '.git'];

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
          if (ALL_EXTENSIONS.includes(ext)) {
            results.push(fullPath);
          }
        }
      }
    };

    await walk(this.config.rootDir);
    return results;
  }

  private async parsePackageJson(): Promise<{ name: string | null; version: string | null }> {
    const pkgPath = path.join(this.config.rootDir, 'package.json');

    try {
      const content = await fs.promises.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      return {
        name: pkg.name ?? null,
        version: pkg.version ?? null,
      };
    } catch {
      return { name: null, version: null };
    }
  }

  private detectFramework(importSource: string): string | null {
    const frameworks: Record<string, string> = {
      'react': 'react',
      'next': 'nextjs',
      '@nestjs': 'nestjs',
      'express': 'express',
      'fastify': 'fastify',
      'koa': 'koa',
      'hono': 'hono',
      '@prisma/client': 'prisma',
      'typeorm': 'typeorm',
      'drizzle-orm': 'drizzle',
      'sequelize': 'sequelize',
      'mongoose': 'mongoose',
      '@tanstack/react-query': 'react-query',
      'redux': 'redux',
      'zustand': 'zustand',
      'vue': 'vue',
      'svelte': 'svelte',
      'angular': 'angular',
    };

    for (const [prefix, name] of Object.entries(frameworks)) {
      if (importSource.startsWith(prefix)) {return name;}
    }

    return null;
  }

  private isTestFile(file: string): boolean {
    const testPatterns = [
      /\.test\.[jt]sx?$/,
      /\.spec\.[jt]sx?$/,
      /__tests__\//,
      /\.stories\.[jt]sx?$/,
    ];
    return testPatterns.some((p) => p.test(file));
  }

  private countComponents(
    functions: FunctionExtraction[],
    classes: ClassExtraction[],
    source: string
  ): number {
    let count = 0;

    // Functional components: functions that return JSX
    for (const func of functions) {
      if (this.isReactComponent(func.name, source)) {
        count++;
      }
    }

    // Class components: classes extending React.Component
    for (const cls of classes) {
      if (cls.baseClasses.some((b) => b.includes('Component') || b.includes('PureComponent'))) {
        count++;
      }
    }

    return count;
  }

  private isReactComponent(name: string, source: string): boolean {
    // Component names start with uppercase
    if (!/^[A-Z]/.test(name)) {return false;}

    // Check if function returns JSX
    const funcPattern = new RegExp(`function\\s+${name}|const\\s+${name}\\s*=`);
    if (!funcPattern.test(source)) {return false;}

    // Look for JSX return
    return /<[A-Z]|<[a-z]+[^>]*>/.test(source);
  }

  private countHooks(calls: CallExtraction[]): number {
    return calls.filter((c) => c.calleeName.startsWith('use') && c.calleeName.length > 3).length;
  }

  private extractRoutes(source: string, file: string): TSRoute[] {
    const routes: TSRoute[] = [];
    const lines = source.split('\n');

    // Express patterns: app.get('/path', handler) or router.get('/path', handler)
    const expressPattern = /\.(get|post|put|delete|patch|head|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

    // NestJS patterns: @Get('/path'), @Post('/path'), etc.
    const nestPattern = /@(Get|Post|Put|Delete|Patch|Head|Options)\s*\(\s*['"`]?([^'"`)\s]*)['"`]?\s*\)/gi;

    // Next.js API routes: export async function GET/POST/etc
    const nextPattern = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/gi;

    // Fastify patterns: fastify.get('/path', handler)
    const fastifyPattern = /fastify\.(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      let match;

      // Express
      while ((match = expressPattern.exec(line)) !== null) {
        routes.push({
          method: match[1]!.toUpperCase(),
          path: match[2]!,
          handler: this.extractHandler(line),
          framework: 'express',
          file,
          line: lineNum,
          middleware: this.extractMiddleware(line),
          decorators: [],
        });
      }
      expressPattern.lastIndex = 0;

      // NestJS
      while ((match = nestPattern.exec(line)) !== null) {
        routes.push({
          method: match[1]!.toUpperCase(),
          path: match[2] || '/',
          handler: this.extractNestHandler(lines, i),
          framework: 'nestjs',
          file,
          line: lineNum,
          middleware: [],
          decorators: this.extractNestDecorators(lines, i),
        });
      }
      nestPattern.lastIndex = 0;

      // Next.js
      while ((match = nextPattern.exec(line)) !== null) {
        routes.push({
          method: match[1]!.toUpperCase(),
          path: this.extractNextPath(file),
          handler: match[1]!,
          framework: 'nextjs',
          file,
          line: lineNum,
          middleware: [],
          decorators: [],
        });
      }
      nextPattern.lastIndex = 0;

      // Fastify
      while ((match = fastifyPattern.exec(line)) !== null) {
        routes.push({
          method: match[1]!.toUpperCase(),
          path: match[2]!,
          handler: this.extractHandler(line),
          framework: 'fastify',
          file,
          line: lineNum,
          middleware: [],
          decorators: [],
        });
      }
      fastifyPattern.lastIndex = 0;
    }

    return routes;
  }

  private extractHandler(line: string): string {
    const match = line.match(/,\s*(\w+)\s*[,)]/);
    return match?.[1] ?? 'anonymous';
  }

  private extractMiddleware(line: string): string[] {
    const middleware: string[] = [];
    const middlewarePattern = /,\s*(\w+)\s*,/g;
    let match;
    while ((match = middlewarePattern.exec(line)) !== null) {
      middleware.push(match[1]!);
    }
    return middleware;
  }

  private extractNestHandler(lines: string[], startIndex: number): string {
    for (let i = startIndex + 1; i < Math.min(startIndex + 5, lines.length); i++) {
      const match = lines[i]!.match(/(?:async\s+)?(\w+)\s*\(/);
      if (match) {return match[1]!;}
    }
    return 'unknown';
  }

  private extractNestDecorators(lines: string[], startIndex: number): string[] {
    const decorators: string[] = [];
    for (let i = startIndex - 1; i >= Math.max(0, startIndex - 10); i--) {
      const match = lines[i]!.match(/@(\w+)/);
      if (match) {
        decorators.push(match[1]!);
      } else if (!/^\s*$/.test(lines[i]!)) {
        break;
      }
    }
    return decorators;
  }

  private extractNextPath(file: string): string {
    // Convert file path to API route
    // e.g., app/api/users/route.ts -> /api/users
    const match = file.match(/(?:app|pages)(\/api\/[^.]+)/);
    if (match) {
      return match[1]!.replace(/\/route$/, '').replace(/\/\[([^\]]+)\]/g, '/:$1');
    }
    return '/';
  }

  private extractComponents(
    functions: FunctionExtraction[],
    classes: ClassExtraction[],
    source: string,
    file: string
  ): TSComponent[] {
    const components: TSComponent[] = [];

    // Functional components
    for (const func of functions) {
      if (this.isReactComponent(func.name, source)) {
        components.push({
          name: func.name,
          type: 'functional',
          file,
          line: func.startLine,
          props: this.extractProps(func.name, source),
          hooks: this.extractHooksInFunction(func.name, source),
          isExported: func.isExported,
        });
      }
    }

    // Class components
    for (const cls of classes) {
      if (cls.baseClasses.some((b) => b.includes('Component') || b.includes('PureComponent'))) {
        components.push({
          name: cls.name,
          type: 'class',
          file,
          line: cls.startLine,
          props: this.extractClassProps(cls.name, source),
          hooks: [],
          isExported: cls.isExported,
        });
      }
    }

    return components;
  }

  private extractProps(funcName: string, source: string): string[] {
    const props: string[] = [];
    const propsPattern = new RegExp(`${funcName}\\s*[:(]\\s*\\{([^}]+)\\}`, 'g');
    const match = propsPattern.exec(source);
    if (match) {
      const propsStr = match[1]!;
      const propMatches = propsStr.match(/(\w+)\s*[,:?]/g);
      if (propMatches) {
        for (const p of propMatches) {
          props.push(p.replace(/[,:?]/g, '').trim());
        }
      }
    }
    return props;
  }

  private extractClassProps(className: string, source: string): string[] {
    const props: string[] = [];
    const propsPattern = new RegExp(`interface\\s+${className}Props\\s*\\{([^}]+)\\}`, 'g');
    const match = propsPattern.exec(source);
    if (match) {
      const propsStr = match[1]!;
      const propMatches = propsStr.match(/(\w+)\s*[,:?]/g);
      if (propMatches) {
        for (const p of propMatches) {
          props.push(p.replace(/[,:?]/g, '').trim());
        }
      }
    }
    return props;
  }

  private extractHooksInFunction(funcName: string, source: string): string[] {
    const hooks: string[] = [];
    const funcPattern = new RegExp(`function\\s+${funcName}[^{]*\\{([\\s\\S]*?)\\n\\}`, 'g');
    const match = funcPattern.exec(source);
    if (match) {
      const body = match[1]!;
      const hookMatches = body.match(/use\w+/g);
      if (hookMatches) {
        hooks.push(...new Set(hookMatches));
      }
    }
    return hooks;
  }

  private extractHooks(
    calls: CallExtraction[],
    _functions: FunctionExtraction[],
    _source: string,
    file: string
  ): TSHook[] {
    const hooks: TSHook[] = [];
    const builtinHooks = [
      'useState', 'useEffect', 'useContext', 'useReducer', 'useCallback',
      'useMemo', 'useRef', 'useImperativeHandle', 'useLayoutEffect',
      'useDebugValue', 'useDeferredValue', 'useTransition', 'useId',
      'useSyncExternalStore', 'useInsertionEffect',
    ];

    for (const call of calls) {
      if (call.calleeName.startsWith('use') && call.calleeName.length > 3) {
        const isBuiltin = builtinHooks.includes(call.calleeName);
        hooks.push({
          name: call.calleeName,
          type: isBuiltin ? 'builtin' : 'custom',
          file,
          line: call.line,
          dependencies: [],
        });
      }
    }

    return hooks;
  }

  private extractDataAccess(source: string, file: string): TSDataAccessPoint[] {
    const accessPoints: TSDataAccessPoint[] = [];
    const lines = source.split('\n');

    // Prisma patterns: prisma.user.findMany(), prisma.$queryRaw
    const prismaPattern = /prisma\.(\w+)\.(findMany|findFirst|findUnique|create|update|delete|upsert|count|aggregate)/gi;
    const prismaRawPattern = /prisma\.\$queryRaw/gi;

    // TypeORM patterns: repository.find(), getRepository(User).find()
    const typeormPattern = /(?:repository|getRepository\(\w+\))\.(find|findOne|save|remove|delete|update|insert)/gi;

    // Drizzle patterns: db.select().from(users)
    const drizzlePattern = /db\.(select|insert|update|delete)\(\)/gi;

    // Sequelize patterns: User.findAll(), Model.create()
    const sequelizePattern = /(\w+)\.(findAll|findOne|findByPk|create|update|destroy|bulkCreate)/gi;

    // Mongoose patterns: Model.find(), Model.findById()
    const mongoosePattern = /(\w+)\.(find|findOne|findById|create|updateOne|deleteOne|aggregate)/gi;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      let match;

      // Prisma
      while ((match = prismaPattern.exec(line)) !== null) {
        accessPoints.push({
          model: match[1]!,
          operation: this.normalizeOperation(match[2]!),
          framework: 'prisma',
          file,
          line: lineNum,
          isRawSql: false,
        });
      }
      prismaPattern.lastIndex = 0;

      // Prisma raw
      if (prismaRawPattern.test(line)) {
        accessPoints.push({
          model: 'raw',
          operation: 'query',
          framework: 'prisma',
          file,
          line: lineNum,
          isRawSql: true,
        });
      }
      prismaRawPattern.lastIndex = 0;

      // TypeORM
      while ((match = typeormPattern.exec(line)) !== null) {
        accessPoints.push({
          model: 'unknown',
          operation: this.normalizeOperation(match[1]!),
          framework: 'typeorm',
          file,
          line: lineNum,
          isRawSql: false,
        });
      }
      typeormPattern.lastIndex = 0;

      // Drizzle
      while ((match = drizzlePattern.exec(line)) !== null) {
        accessPoints.push({
          model: 'unknown',
          operation: this.normalizeOperation(match[1]!),
          framework: 'drizzle',
          file,
          line: lineNum,
          isRawSql: false,
        });
      }
      drizzlePattern.lastIndex = 0;

      // Sequelize
      while ((match = sequelizePattern.exec(line)) !== null) {
        accessPoints.push({
          model: match[1]!,
          operation: this.normalizeOperation(match[2]!),
          framework: 'sequelize',
          file,
          line: lineNum,
          isRawSql: false,
        });
      }
      sequelizePattern.lastIndex = 0;

      // Mongoose
      while ((match = mongoosePattern.exec(line)) !== null) {
        accessPoints.push({
          model: match[1]!,
          operation: this.normalizeOperation(match[2]!),
          framework: 'mongoose',
          file,
          line: lineNum,
          isRawSql: false,
        });
      }
      mongoosePattern.lastIndex = 0;
    }

    return accessPoints;
  }

  private normalizeOperation(op: string): string {
    const readOps = ['find', 'findMany', 'findFirst', 'findUnique', 'findOne', 'findAll', 'findById', 'findByPk', 'select', 'count', 'aggregate'];
    const writeOps = ['create', 'insert', 'save', 'bulkCreate', 'upsert'];
    const updateOps = ['update', 'updateOne', 'updateMany'];
    const deleteOps = ['delete', 'remove', 'destroy', 'deleteOne', 'deleteMany'];

    const opLower = op.toLowerCase();
    if (readOps.some((r) => opLower.includes(r.toLowerCase()))) {return 'read';}
    if (writeOps.some((w) => opLower.includes(w.toLowerCase()))) {return 'write';}
    if (updateOps.some((u) => opLower.includes(u.toLowerCase()))) {return 'update';}
    if (deleteOps.some((d) => opLower.includes(d.toLowerCase()))) {return 'delete';}
    return 'unknown';
  }

  private extractDecorators(source: string, file: string): TSDecorator[] {
    const decorators: TSDecorator[] = [];
    const lines = source.split('\n');

    const decoratorPattern = /@(\w+)\s*\(([^)]*)\)?/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      let match;
      while ((match = decoratorPattern.exec(line)) !== null) {
        const target = this.determineDecoratorTarget(lines, i);
        decorators.push({
          name: match[1]!,
          target,
          file,
          line: lineNum,
          arguments: match[2] ? match[2].split(',').map((a) => a.trim()) : [],
        });
      }
      decoratorPattern.lastIndex = 0;
    }

    return decorators;
  }

  private determineDecoratorTarget(
    lines: string[],
    decoratorLine: number
  ): 'class' | 'method' | 'property' | 'parameter' {
    // Look at the next non-decorator line
    for (let i = decoratorLine + 1; i < Math.min(decoratorLine + 10, lines.length); i++) {
      const line = lines[i]!.trim();
      if (line.startsWith('@')) {continue;}
      if (/^(export\s+)?(abstract\s+)?class\s/.test(line)) {return 'class';}
      if (/^(async\s+)?(\w+)\s*\(/.test(line)) {return 'method';}
      if (/^\w+\s*[?:]/.test(line)) {return 'property';}
      break;
    }
    return 'method';
  }
}

/**
 * Factory function
 */
export function createTypeScriptAnalyzer(config: TypeScriptAnalyzerConfig): TypeScriptAnalyzer {
  return new TypeScriptAnalyzer(config);
}
