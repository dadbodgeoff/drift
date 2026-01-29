/**
 * Rust Analyzer
 *
 * Main analyzer for Rust projects. Uses a unified architecture with:
 * - Primary: Tree-sitter AST parsing via RustHybridExtractor
 * - Fallback: Regex patterns when tree-sitter unavailable
 *
 * Provides comprehensive analysis of:
 * - HTTP routes (Actix, Axum, Rocket, Warp)
 * - Error handling patterns (Result, thiserror, anyhow)
 * - Trait analysis and implementations
 * - Data access patterns (SQLx, Diesel, SeaORM)
 * - Async/concurrency patterns
 *
 * @license Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';

import { extractRustDataAccess } from '../call-graph/extractors/rust-data-access-extractor.js';
import { createRustHybridExtractor, type RustHybridExtractor } from '../call-graph/extractors/rust-hybrid-extractor.js';
import { RustTreeSitterParser } from '../parsers/tree-sitter/tree-sitter-rust-parser.js';

import type { DataAccessPoint } from '../boundaries/types.js';
import type { FunctionExtraction, ClassExtraction, CallExtraction } from '../call-graph/types.js';

// ============================================================================
// Types
// ============================================================================

export interface RustAnalyzerOptions {
  rootDir: string;
  verbose?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
}

export interface RustAnalysisResult {
  crateName: string | null;
  edition: string | null;
  detectedFrameworks: string[];
  crates: RustCrate[];
  stats: RustAnalysisStats;
  functions: FunctionExtraction[];
  types: ClassExtraction[];
  calls: CallExtraction[];
  dataAccessPoints: DataAccessPoint[];
}

export interface RustCrate {
  name: string;
  path: string;
  files: string[];
  functions: FunctionExtraction[];
  types: ClassExtraction[];
}

export interface RustAnalysisStats {
  fileCount: number;
  functionCount: number;
  structCount: number;
  traitCount: number;
  enumCount: number;
  linesOfCode: number;
  testFileCount: number;
  testFunctionCount: number;
  analysisTimeMs: number;
}

export interface RustRoute {
  method: string;
  path: string;
  handler: string;
  framework: string;
  file: string;
  line: number;
  middleware: string[];
}

export interface RustRoutesResult {
  routes: RustRoute[];
  byFramework: Record<string, number>;
}

export interface RustErrorHandlingResult {
  stats: {
    resultTypes: number;
    customErrors: number;
    thiserrorDerives: number;
    anyhowUsage: number;
    unwrapCalls: number;
    expectCalls: number;
  };
  patterns: RustErrorPattern[];
  issues: RustErrorIssue[];
  customErrors: RustCustomError[];
}

export interface RustErrorPattern {
  type: 'propagated' | 'wrapped' | 'logged' | 'ignored';
  file: string;
  line: number;
  context: string;
}

export interface RustErrorIssue {
  type: string;
  file: string;
  line: number;
  message: string;
  suggestion?: string;
}

export interface RustCustomError {
  name: string;
  file: string;
  line: number;
  variants: string[];
}

export interface RustTraitsResult {
  traits: RustTrait[];
  implementations: RustTraitImpl[];
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

export interface RustDataAccessResult {
  accessPoints: DataAccessPoint[];
  byFramework: Record<string, number>;
  byOperation: Record<string, number>;
  tables: string[];
}

export interface RustAsyncResult {
  asyncFunctions: RustAsyncFunction[];
  runtime: string | null;
  stats: {
    asyncFunctions: number;
    awaitPoints: number;
    spawnedTasks: number;
    channels: number;
    mutexes: number;
  };
  issues: RustAsyncIssue[];
}

export interface RustAsyncFunction {
  name: string;
  file: string;
  line: number;
  hasAwait: boolean;
}

export interface RustAsyncIssue {
  type: string;
  file: string;
  line: number;
  message: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Partial<RustAnalyzerOptions> = {
  verbose: false,
  includePatterns: ['**/*.rs'],
  excludePatterns: ['**/target/**', '**/node_modules/**', '**/.git/**'],
};

// ============================================================================
// Rust Analyzer Implementation
// ============================================================================

export class RustAnalyzer {
  private config: RustAnalyzerOptions;
  private extractor: RustHybridExtractor;
  private astParser: RustTreeSitterParser;

  constructor(options: RustAnalyzerOptions) {
    this.config = { ...DEFAULT_CONFIG, ...options } as RustAnalyzerOptions;
    this.extractor = createRustHybridExtractor();
    this.astParser = new RustTreeSitterParser();
  }

  /**
   * Full project analysis
   */
  async analyze(): Promise<RustAnalysisResult> {
    const startTime = Date.now();

    const rustFiles = await this.findRustFiles();
    const cargoInfo = await this.parseCargoToml();

    const crates = new Map<string, RustCrate>();
    const allFunctions: FunctionExtraction[] = [];
    const allTypes: ClassExtraction[] = [];
    const allCalls: CallExtraction[] = [];
    const allDataAccess: DataAccessPoint[] = [];
    const detectedFrameworks = new Set<string>();

    let linesOfCode = 0;
    let testFileCount = 0;
    let testFunctionCount = 0;
    let enumCount = 0;

    for (const file of rustFiles) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const relPath = path.relative(this.config.rootDir, file);
      linesOfCode += source.split('\n').length;

      const isTestFile = file.includes('/tests/') || file.endsWith('_test.rs');
      if (isTestFile) {testFileCount++;}

      // Extract code structure using hybrid extractor (AST + regex fallback)
      const result = this.extractor.extract(source, relPath);

      // Extract data access patterns using function-based API
      const dataResult = extractRustDataAccess(source, relPath);
      allDataAccess.push(...dataResult.accessPoints);

      // Use AST parser for accurate enum counting
      const astResult = this.astParser.parse(source);
      enumCount += astResult.enums.length;

      // Detect frameworks from imports
      for (const imp of result.imports) {
        const framework = this.detectFramework(imp.source);
        if (framework) {detectedFrameworks.add(framework);}
      }

      // Organize by crate
      const crateName = this.getCrateName(relPath);
      const cratePath = path.dirname(file);

      if (!crates.has(cratePath)) {
        crates.set(cratePath, {
          name: crateName,
          path: cratePath,
          files: [],
          functions: [],
          types: [],
        });
      }

      const crate = crates.get(cratePath)!;
      crate.files.push(relPath);
      crate.functions.push(...result.functions);
      crate.types.push(...result.classes);

      allFunctions.push(...result.functions);
      allTypes.push(...result.classes);
      allCalls.push(...result.calls);

      // Count test functions
      if (isTestFile) {
        testFunctionCount += (source.match(/#\[test\]/g) || []).length;
        testFunctionCount += (source.match(/#\[tokio::test\]/g) || []).length;
      }
    }

    const analysisTimeMs = Date.now() - startTime;

    // Count structs vs traits
    const structCount = allTypes.filter(t => !t.baseClasses?.length).length;
    const traitCount = allTypes.filter(t => t.baseClasses?.length).length;

    return {
      crateName: cargoInfo.crateName,
      edition: cargoInfo.edition,
      detectedFrameworks: Array.from(detectedFrameworks),
      crates: Array.from(crates.values()),
      stats: {
        fileCount: rustFiles.length,
        functionCount: allFunctions.length,
        structCount,
        traitCount,
        enumCount,
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
  async analyzeRoutes(): Promise<RustRoutesResult> {
    const rustFiles = await this.findRustFiles();
    const routes: RustRoute[] = [];

    for (const file of rustFiles) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const relPath = path.relative(this.config.rootDir, file);
      const fileRoutes = this.extractRoutes(source, relPath);
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
  async analyzeErrorHandling(): Promise<RustErrorHandlingResult> {
    const rustFiles = await this.findRustFiles();

    let resultTypes = 0;
    let thiserrorDerives = 0;
    let anyhowUsage = 0;
    let unwrapCalls = 0;
    let expectCalls = 0;
    const patterns: RustErrorPattern[] = [];
    const issues: RustErrorIssue[] = [];
    const customErrors: RustCustomError[] = [];

    for (const file of rustFiles) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const relPath = path.relative(this.config.rootDir, file);
      const lines = source.split('\n');
      const isTestFile = file.includes('/tests/') || file.endsWith('_test.rs');

      // Use AST parser for accurate enum extraction
      const astResult = this.astParser.parse(source);

      // Extract custom error enums from AST
      for (const enumDef of astResult.enums) {
        if (enumDef.derives.includes('Error') || enumDef.name.endsWith('Error')) {
          if (enumDef.derives.includes('Error')) {thiserrorDerives++;}
          customErrors.push({
            name: enumDef.name,
            file: relPath,
            line: enumDef.startLine,
            variants: enumDef.variants.map(v => v.name),
          });
        }
      }

      // Use hybrid extractor to find method calls
      const extraction = this.extractor.extract(source, relPath);

      for (const call of extraction.calls) {
        if (call.calleeName === 'unwrap') {
          unwrapCalls++;
          if (!isTestFile) {
            issues.push({
              type: 'unwrap-in-production',
              file: relPath,
              line: call.line,
              message: 'Unwrap in non-test code may panic',
              suggestion: 'Consider using ? operator or proper error handling',
            });
          }
        }
        if (call.calleeName === 'expect') {
          expectCalls++;
        }
      }

      // Extract patterns from lines (regex fallback for simple patterns)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const lineNum = i + 1;

        // Count Result types
        if (/Result\s*</.test(line)) {resultTypes++;}

        // Count anyhow usage
        if (/anyhow::/.test(line) || /use anyhow/.test(line)) {anyhowUsage++;}

        // Error propagation with ?
        if (line.includes('?') && !line.includes('//')) {
          patterns.push({ type: 'propagated', file: relPath, line: lineNum, context: line.trim() });
        }

        // Wrapped errors with map_err
        if (line.includes('.map_err(')) {
          patterns.push({ type: 'wrapped', file: relPath, line: lineNum, context: line.trim() });
        }

        // Logged errors
        if (/log::(error|warn)/.test(line) || /tracing::(error|warn)/.test(line)) {
          patterns.push({ type: 'logged', file: relPath, line: lineNum, context: line.trim() });
        }

        // Ignored errors
        if (/let\s+_\s*=/.test(line) && /\?/.test(line) === false) {
          patterns.push({ type: 'ignored', file: relPath, line: lineNum, context: line.trim() });
        }
      }
    }

    return {
      stats: {
        resultTypes,
        customErrors: customErrors.length,
        thiserrorDerives,
        anyhowUsage,
        unwrapCalls,
        expectCalls,
      },
      patterns,
      issues,
      customErrors,
    };
  }

  /**
   * Analyze traits and implementations
   */
  async analyzeTraits(): Promise<RustTraitsResult> {
    const rustFiles = await this.findRustFiles();
    const traits: RustTrait[] = [];
    const implementations: RustTraitImpl[] = [];

    for (const file of rustFiles) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const relPath = path.relative(this.config.rootDir, file);

      // Use AST parser for accurate trait extraction
      const astResult = this.astParser.parse(source);

      for (const trait of astResult.traits) {
        traits.push({
          name: trait.name,
          file: relPath,
          line: trait.startLine,
          methods: trait.methods.map(m => m.name),
          implementations: [],
        });
      }

      for (const impl of astResult.impls) {
        if (impl.traitName) {
          implementations.push({
            traitName: impl.traitName,
            forType: impl.targetType,
            file: relPath,
            line: impl.startLine,
          });

          // Link to trait
          const trait = traits.find(t => t.name === impl.traitName);
          if (trait) {
            trait.implementations.push(impl.targetType);
          }
        }
      }
    }

    return { traits, implementations };
  }

  /**
   * Analyze data access patterns
   */
  async analyzeDataAccess(): Promise<RustDataAccessResult> {
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
   * Analyze async/concurrency patterns
   */
  async analyzeAsync(): Promise<RustAsyncResult> {
    const rustFiles = await this.findRustFiles();
    const asyncFunctions: RustAsyncFunction[] = [];
    const issues: RustAsyncIssue[] = [];
    let runtime: string | null = null;
    let awaitPoints = 0;
    let spawnedTasks = 0;
    let channels = 0;
    let mutexes = 0;

    // Check Cargo.toml for runtime
    const cargoInfo = await this.parseCargoToml();
    if (cargoInfo.dependencies.includes('tokio')) {runtime = 'tokio';}
    else if (cargoInfo.dependencies.includes('async-std')) {runtime = 'async-std';}
    else if (cargoInfo.dependencies.includes('smol')) {runtime = 'smol';}

    for (const file of rustFiles) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const relPath = path.relative(this.config.rootDir, file);

      // Use hybrid extractor for accurate async function detection
      const extraction = this.extractor.extract(source, relPath);

      for (const func of extraction.functions) {
        if (func.isAsync) {
          asyncFunctions.push({
            name: func.name,
            file: relPath,
            line: func.startLine,
            hasAwait: true,
          });
        }
      }

      // Count patterns (regex is fine for these simple counts)
      awaitPoints += (source.match(/\.await/g) || []).length;
      spawnedTasks += (source.match(/tokio::spawn/g) || []).length;
      spawnedTasks += (source.match(/task::spawn/g) || []).length;
      channels += (source.match(/mpsc::channel/g) || []).length;
      channels += (source.match(/oneshot::channel/g) || []).length;
      channels += (source.match(/broadcast::channel/g) || []).length;
      mutexes += (source.match(/Mutex::new/g) || []).length;
      mutexes += (source.match(/RwLock::new/g) || []).length;

      // Check for blocking in async
      if (source.includes('std::thread::sleep') && source.includes('async fn')) {
        issues.push({
          type: 'blocking-in-async',
          file: relPath,
          line: 1,
          message: 'Blocking sleep in async context detected',
        });
      }
    }

    return {
      asyncFunctions,
      runtime,
      stats: {
        asyncFunctions: asyncFunctions.length,
        awaitPoints,
        spawnedTasks,
        channels,
        mutexes,
      },
      issues,
    };
  }


  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async findRustFiles(): Promise<string[]> {
    const results: string[] = [];
    const excludePatterns = this.config.excludePatterns ?? ['target', 'node_modules', '.git'];

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
        const shouldExclude = excludePatterns.some(pattern => {
          if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
            return regex.test(relativePath);
          }
          return relativePath.includes(pattern.replace(/\*\*/g, ''));
        });

        if (shouldExclude) {continue;}

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.rs')) {
          results.push(fullPath);
        }
      }
    };

    await walk(this.config.rootDir);
    return results;
  }

  private async parseCargoToml(): Promise<{
    crateName: string | null;
    edition: string | null;
    dependencies: string[];
  }> {
    const cargoPath = path.join(this.config.rootDir, 'Cargo.toml');

    try {
      const content = await fs.promises.readFile(cargoPath, 'utf-8');
      const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
      const editionMatch = content.match(/edition\s*=\s*"([^"]+)"/);

      // Extract dependencies
      const dependencies: string[] = [];
      const depSection = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
      if (depSection) {
        const depLines = depSection[1]?.split('\n') ?? [];
        for (const line of depLines) {
          const depMatch = line.match(/^(\w[\w-]*)\s*=/);
          if (depMatch) {
            dependencies.push(depMatch[1]!);
          }
        }
      }

      return {
        crateName: nameMatch?.[1] ?? null,
        edition: editionMatch?.[1] ?? null,
        dependencies,
      };
    } catch {
      return { crateName: null, edition: null, dependencies: [] };
    }
  }

  private getCrateName(filePath: string): string {
    const parts = filePath.split(path.sep);
    return parts[0] === 'src' ? 'main' : parts[0] ?? 'main';
  }

  private detectFramework(importPath: string): string | null {
    const frameworks: Record<string, string> = {
      'actix_web': 'actix-web',
      'actix-web': 'actix-web',
      'axum': 'axum',
      'rocket': 'rocket',
      'warp': 'warp',
      'sqlx': 'sqlx',
      'diesel': 'diesel',
      'sea_orm': 'sea-orm',
      'sea-orm': 'sea-orm',
      'tokio': 'tokio',
      'async_std': 'async-std',
      'async-std': 'async-std',
    };

    for (const [prefix, name] of Object.entries(frameworks)) {
      if (importPath.includes(prefix)) {return name;}
    }

    return null;
  }

  private extractRoutes(source: string, file: string): RustRoute[] {
    const routes: RustRoute[] = [];
    const lines = source.split('\n');

    // Determine framework from imports
    let framework = 'unknown';
    if (source.includes('actix_web') || source.includes('actix-web')) {framework = 'actix-web';}
    else if (source.includes('axum::')) {framework = 'axum';}
    else if (source.includes('rocket::')) {framework = 'rocket';}
    else if (source.includes('warp::')) {framework = 'warp';}

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      // Actix/Rocket attribute style: #[get("/path")] or #[post("/path")]
      const attrMatch = line.match(/#\[(get|post|put|delete|patch|head|options)\s*\(\s*"([^"]+)"/i);
      if (attrMatch) {
        // Look for the handler function on the next non-empty line
        let handler = 'unknown';
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const nextLine = lines[j]!;
          const fnMatch = nextLine.match(/(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
          if (fnMatch) {
            handler = fnMatch[1]!;
            break;
          }
        }
        routes.push({
          method: attrMatch[1]!.toUpperCase(),
          path: attrMatch[2]!,
          handler,
          framework: framework !== 'unknown' ? framework : 'actix-web',
          file,
          line: lineNum,
          middleware: [],
        });
      }

      // Axum style: .route("/path", get(handler))
      const axumMatch = line.match(/\.route\s*\(\s*"([^"]+)"\s*,\s*(get|post|put|delete|patch)\s*\(\s*(\w+)/i);
      if (axumMatch) {
        routes.push({
          method: axumMatch[2]!.toUpperCase(),
          path: axumMatch[1]!,
          handler: axumMatch[3]!,
          framework: 'axum',
          file,
          line: lineNum,
          middleware: [],
        });
      }

      // Warp style: warp::path("segment").and(warp::get())
      const warpMatch = line.match(/warp::path\s*\(\s*"([^"]+)"\s*\)/);
      if (warpMatch) {
        const methodMatch = line.match(/\.(get|post|put|delete|patch)\s*\(\s*\)/i);
        routes.push({
          method: methodMatch ? methodMatch[1]!.toUpperCase() : 'GET',
          path: `/${warpMatch[1]}`,
          handler: 'filter',
          framework: 'warp',
          file,
          line: lineNum,
          middleware: [],
        });
      }
    }

    return routes;
  }
}

/**
 * Factory function
 */
export function createRustAnalyzer(options: RustAnalyzerOptions): RustAnalyzer {
  return new RustAnalyzer(options);
}
