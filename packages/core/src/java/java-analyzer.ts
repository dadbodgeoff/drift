/**
 * Java Analyzer
 *
 * Main analyzer for Java projects. Provides comprehensive analysis of:
 * - HTTP routes (Spring MVC, JAX-RS, Micronaut, Quarkus)
 * - Classes and methods
 * - Error handling patterns
 * - Data access patterns (Spring Data JPA, Hibernate, JDBC, MyBatis)
 * - Annotations
 */

import * as fs from 'fs';
import * as path from 'path';

import { createJavaHybridExtractor } from '../call-graph/extractors/java-hybrid-extractor.js';

import type { FunctionExtraction, ClassExtraction, CallExtraction, ImportExtraction } from '../call-graph/types.js';

// ============================================================================
// Types
// ============================================================================

export interface JavaAnalyzerConfig {
  rootDir: string;
  verbose?: boolean | undefined;
  includePatterns?: string[] | undefined;
  excludePatterns?: string[] | undefined;
}

export interface JavaAnalysisResult {
  projectInfo: {
    name: string | null;
    version: string | null;
    files: number;
    buildTool: string | null;
  };
  detectedFrameworks: string[];
  stats: JavaAnalysisStats;
  functions: FunctionExtraction[];
  classes: ClassExtraction[];
  calls: CallExtraction[];
  imports: ImportExtraction[];
}

export interface JavaAnalysisStats {
  fileCount: number;
  classCount: number;
  interfaceCount: number;
  methodCount: number;
  annotationCount: number;
  linesOfCode: number;
  testFileCount: number;
  analysisTimeMs: number;
}

export interface JavaRoute {
  method: string;
  path: string;
  handler: string;
  framework: string;
  file: string;
  line: number;
  annotations: string[];
}

export interface JavaRoutesResult {
  routes: JavaRoute[];
  byFramework: Record<string, number>;
}

export interface JavaErrorPattern {
  type: 'try-catch' | 'throw' | 'custom-exception' | 'exception-handler';
  file: string;
  line: number;
  context: string;
}

export interface JavaErrorHandlingResult {
  stats: {
    tryCatchBlocks: number;
    throwStatements: number;
    customExceptions: number;
    exceptionHandlers: number;
  };
  patterns: JavaErrorPattern[];
  issues: JavaErrorIssue[];
}

export interface JavaErrorIssue {
  type: string;
  file: string;
  line: number;
  message: string;
  suggestion?: string | undefined;
}

export interface JavaDataAccessResult {
  accessPoints: JavaDataAccessPoint[];
  byFramework: Record<string, number>;
  byOperation: Record<string, number>;
  repositories: string[];
}

export interface JavaDataAccessPoint {
  entity: string;
  operation: string;
  framework: string;
  file: string;
  line: number;
  isRawSql: boolean;
}

export interface JavaAnnotation {
  name: string;
  target: 'class' | 'method' | 'field' | 'parameter';
  file: string;
  line: number;
  arguments: string[];
}

export interface JavaAnnotationsResult {
  annotations: JavaAnnotation[];
  byName: Record<string, number>;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Partial<JavaAnalyzerConfig> = {
  verbose: false,
  includePatterns: ['**/*.java'],
  excludePatterns: ['**/target/**', '**/build/**', '**/.gradle/**', '**/.git/**'],
};

// ============================================================================
// Java Analyzer Implementation
// ============================================================================

export class JavaAnalyzer {
  private config: JavaAnalyzerConfig;
  private extractor: ReturnType<typeof createJavaHybridExtractor>;

  constructor(config: JavaAnalyzerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as JavaAnalyzerConfig;
    this.extractor = createJavaHybridExtractor();
  }

  /**
   * Full project analysis
   */
  async analyze(): Promise<JavaAnalysisResult> {
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
    let annotationCount = 0;
    let interfaceCount = 0;

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

      // Count annotations
      annotationCount += result.functions.reduce((sum, f) => sum + f.decorators.length, 0);

      // Count interfaces (classes with no methods that look like interfaces)
      interfaceCount += source.split('\n').filter(l => /\binterface\s+\w+/.test(l)).length;

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
        buildTool: projectInfo.buildTool,
      },
      detectedFrameworks: Array.from(detectedFrameworks),
      stats: {
        fileCount: files.length,
        classCount: allClasses.length,
        interfaceCount,
        methodCount: allFunctions.length,
        annotationCount,
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
  async analyzeRoutes(): Promise<JavaRoutesResult> {
    const files = await this.findFiles();
    const routes: JavaRoute[] = [];

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
  async analyzeErrorHandling(): Promise<JavaErrorHandlingResult> {
    const files = await this.findFiles();

    let tryCatchBlocks = 0;
    let throwStatements = 0;
    let customExceptions = 0;
    let exceptionHandlers = 0;
    const patterns: JavaErrorPattern[] = [];
    const issues: JavaErrorIssue[] = [];

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
        if (/\bthrow\s+new\s+/.test(line) || /\bthrow\s+\w+/.test(line)) {
          throwStatements++;
          patterns.push({ type: 'throw', file, line: lineNum, context: line.trim() });
        }

        // Custom exception classes
        if (/class\s+\w+.*extends\s+.*Exception/.test(line) || /class\s+\w+.*extends\s+.*Error/.test(line)) {
          customExceptions++;
          patterns.push({ type: 'custom-exception', file, line: lineNum, context: line.trim() });
        }

        // Spring @ExceptionHandler
        if (/@ExceptionHandler/.test(line)) {
          exceptionHandlers++;
          patterns.push({ type: 'exception-handler', file, line: lineNum, context: line.trim() });
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

        // Catching generic Exception
        if (/catch\s*\(\s*Exception\s+\w+\s*\)/.test(line)) {
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
      stats: { tryCatchBlocks, throwStatements, customExceptions, exceptionHandlers },
      patterns,
      issues,
    };
  }

  /**
   * Analyze data access patterns
   */
  async analyzeDataAccess(): Promise<JavaDataAccessResult> {
    const files = await this.findFiles();
    const accessPoints: JavaDataAccessPoint[] = [];
    const repositories = new Set<string>();

    for (const file of files) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const fileAccessPoints = this.extractDataAccess(source, file);
      accessPoints.push(...fileAccessPoints);

      // Find repository interfaces
      const repoMatches = source.match(/interface\s+(\w+Repository)/g);
      if (repoMatches) {
        for (const match of repoMatches) {
          const name = match.replace('interface ', '');
          repositories.add(name);
        }
      }
    }

    const byFramework: Record<string, number> = {};
    const byOperation: Record<string, number> = {};

    for (const ap of accessPoints) {
      byFramework[ap.framework] = (byFramework[ap.framework] || 0) + 1;
      byOperation[ap.operation] = (byOperation[ap.operation] || 0) + 1;
    }

    return { accessPoints, byFramework, byOperation, repositories: Array.from(repositories) };
  }

  /**
   * Analyze annotations
   */
  async analyzeAnnotations(): Promise<JavaAnnotationsResult> {
    const files = await this.findFiles();
    const annotations: JavaAnnotation[] = [];

    for (const file of files) {
      const source = await fs.promises.readFile(file, 'utf-8');
      const fileAnnotations = this.extractAnnotations(source, file);
      annotations.push(...fileAnnotations);
    }

    const byName: Record<string, number> = {};
    for (const ann of annotations) {
      byName[ann.name] = (byName[ann.name] || 0) + 1;
    }

    return { annotations, byName };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async findFiles(): Promise<string[]> {
    const results: string[] = [];
    const excludePatterns = this.config.excludePatterns ?? ['target', 'build', '.gradle', '.git'];

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
        } else if (entry.isFile() && entry.name.endsWith('.java')) {
          results.push(fullPath);
        }
      }
    };

    await walk(this.config.rootDir);
    return results;
  }

  private async parseProjectInfo(): Promise<{ name: string | null; version: string | null; buildTool: string | null }> {
    // Try pom.xml (Maven)
    const pomPath = path.join(this.config.rootDir, 'pom.xml');
    try {
      const content = await fs.promises.readFile(pomPath, 'utf-8');
      const nameMatch = content.match(/<artifactId>([^<]+)<\/artifactId>/);
      const versionMatch = content.match(/<version>([^<]+)<\/version>/);
      return {
        name: nameMatch?.[1] ?? null,
        version: versionMatch?.[1] ?? null,
        buildTool: 'maven',
      };
    } catch {
      // Try build.gradle (Gradle)
      const gradlePath = path.join(this.config.rootDir, 'build.gradle');
      try {
        const content = await fs.promises.readFile(gradlePath, 'utf-8');
        const nameMatch = content.match(/rootProject\.name\s*=\s*['"]([^'"]+)['"]/);
        const versionMatch = content.match(/version\s*=\s*['"]([^'"]+)['"]/);
        return {
          name: nameMatch?.[1] ?? null,
          version: versionMatch?.[1] ?? null,
          buildTool: 'gradle',
        };
      } catch {
        return { name: null, version: null, buildTool: null };
      }
    }
  }

  private detectFramework(importSource: string): string | null {
    const frameworks: Record<string, string> = {
      'org.springframework': 'spring',
      'javax.ws.rs': 'jax-rs',
      'jakarta.ws.rs': 'jakarta-rs',
      'io.micronaut': 'micronaut',
      'io.quarkus': 'quarkus',
      'org.hibernate': 'hibernate',
      'javax.persistence': 'jpa',
      'jakarta.persistence': 'jakarta-persistence',
      'org.mybatis': 'mybatis',
      'org.jooq': 'jooq',
      'org.junit': 'junit',
      'org.mockito': 'mockito',
      'org.assertj': 'assertj',
    };

    for (const [prefix, name] of Object.entries(frameworks)) {
      if (importSource.startsWith(prefix)) {return name;}
    }

    return null;
  }

  private isTestFile(file: string): boolean {
    const testPatterns = [
      /Test\.java$/,
      /Tests\.java$/,
      /IT\.java$/,
      /\/test\//,
      /\/tests\//,
    ];
    return testPatterns.some((p) => p.test(file));
  }

  private extractRoutes(source: string, file: string): JavaRoute[] {
    const routes: JavaRoute[] = [];
    const lines = source.split('\n');

    // Spring MVC patterns: @GetMapping, @PostMapping, @RequestMapping
    const springPattern = /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?["']?([^"')]+)["']?\s*\)?/gi;

    // JAX-RS patterns: @GET @Path("/path")
    const jaxrsMethodPattern = /@(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/gi;
    const jaxrsPathPattern = /@Path\s*\(\s*["']([^"']+)["']\s*\)/gi;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      let match;

      // Spring MVC
      while ((match = springPattern.exec(line)) !== null) {
        const annotation = match[1]!;
        let method = 'GET';
        if (annotation.toLowerCase().includes('post')) {method = 'POST';}
        else if (annotation.toLowerCase().includes('put')) {method = 'PUT';}
        else if (annotation.toLowerCase().includes('delete')) {method = 'DELETE';}
        else if (annotation.toLowerCase().includes('patch')) {method = 'PATCH';}

        routes.push({
          method,
          path: match[2]!,
          handler: this.extractNextMethod(lines, i),
          framework: 'spring',
          file,
          line: lineNum,
          annotations: [line.trim()],
        });
      }
      springPattern.lastIndex = 0;

      // JAX-RS
      if (jaxrsMethodPattern.test(line)) {
        const methodMatch = line.match(/@(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/i);
        if (methodMatch) {
          // Look for @Path on same or adjacent lines
          let pathValue = '/';
          for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 3); j++) {
            const pathMatch = lines[j]!.match(/@Path\s*\(\s*["']([^"']+)["']\s*\)/);
            if (pathMatch) {
              pathValue = pathMatch[1]!;
              break;
            }
          }

          routes.push({
            method: methodMatch[1]!.toUpperCase(),
            path: pathValue,
            handler: this.extractNextMethod(lines, i),
            framework: 'jax-rs',
            file,
            line: lineNum,
            annotations: [line.trim()],
          });
        }
      }
      jaxrsMethodPattern.lastIndex = 0;
      jaxrsPathPattern.lastIndex = 0;
    }

    return routes;
  }

  private extractNextMethod(lines: string[], annotationLine: number): string {
    for (let i = annotationLine + 1; i < Math.min(annotationLine + 10, lines.length); i++) {
      const match = lines[i]!.match(/(?:public|private|protected)?\s*(?:\w+\s+)?(\w+)\s*\(/);
      if (match && !lines[i]!.trim().startsWith('@')) {return match[1]!;}
    }
    return 'unknown';
  }

  private extractDataAccess(source: string, file: string): JavaDataAccessPoint[] {
    const accessPoints: JavaDataAccessPoint[] = [];
    const lines = source.split('\n');

    // Spring Data JPA: repository.findAll(), repository.save()
    const springDataPattern = /(\w+Repository)\.(\w+)\s*\(/gi;

    // JPA EntityManager: entityManager.find(), entityManager.persist()
    const emPattern = /entityManager\.(\w+)\s*\(/gi;

    // Hibernate Session: session.get(), session.save()
    const sessionPattern = /session\.(\w+)\s*\(/gi;

    // JDBC: statement.executeQuery(), preparedStatement.execute()
    const jdbcPattern = /(?:statement|preparedStatement|stmt|ps)\.execute\w*\s*\(/gi;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      let match;

      // Spring Data JPA
      while ((match = springDataPattern.exec(line)) !== null) {
        accessPoints.push({
          entity: match[1]!.replace('Repository', ''),
          operation: this.normalizeOperation(match[2]!),
          framework: 'spring-data',
          file,
          line: lineNum,
          isRawSql: false,
        });
      }
      springDataPattern.lastIndex = 0;

      // EntityManager
      while ((match = emPattern.exec(line)) !== null) {
        accessPoints.push({
          entity: 'unknown',
          operation: this.normalizeOperation(match[1]!),
          framework: 'jpa',
          file,
          line: lineNum,
          isRawSql: false,
        });
      }
      emPattern.lastIndex = 0;

      // Hibernate Session
      while ((match = sessionPattern.exec(line)) !== null) {
        accessPoints.push({
          entity: 'unknown',
          operation: this.normalizeOperation(match[1]!),
          framework: 'hibernate',
          file,
          line: lineNum,
          isRawSql: false,
        });
      }
      sessionPattern.lastIndex = 0;

      // JDBC
      if (jdbcPattern.test(line)) {
        accessPoints.push({
          entity: 'raw',
          operation: 'query',
          framework: 'jdbc',
          file,
          line: lineNum,
          isRawSql: true,
        });
      }
      jdbcPattern.lastIndex = 0;
    }

    return accessPoints;
  }

  private normalizeOperation(op: string): string {
    const opLower = op.toLowerCase();
    if (['find', 'findall', 'findby', 'get', 'getone', 'getbyid', 'query', 'createquery', 'count', 'exists'].some(o => opLower.includes(o))) {return 'read';}
    if (['save', 'saveall', 'persist', 'merge', 'insert'].some(o => opLower.includes(o))) {return 'write';}
    if (['update'].some(o => opLower.includes(o))) {return 'update';}
    if (['delete', 'remove'].some(o => opLower.includes(o))) {return 'delete';}
    return 'unknown';
  }

  private extractAnnotations(source: string, file: string): JavaAnnotation[] {
    const annotations: JavaAnnotation[] = [];
    const lines = source.split('\n');

    const annotationPattern = /@(\w+)(?:\s*\(([^)]*)\))?/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      let match;
      while ((match = annotationPattern.exec(line)) !== null) {
        const target = this.determineAnnotationTarget(lines, i);
        annotations.push({
          name: match[1]!,
          target,
          file,
          line: lineNum,
          arguments: match[2] ? match[2].split(',').map(a => a.trim()) : [],
        });
      }
      annotationPattern.lastIndex = 0;
    }

    return annotations;
  }

  private determineAnnotationTarget(lines: string[], annotationLine: number): 'class' | 'method' | 'field' | 'parameter' {
    for (let i = annotationLine + 1; i < Math.min(annotationLine + 5, lines.length); i++) {
      const line = lines[i]!.trim();
      if (line.startsWith('@')) {continue;}
      if (/\bclass\s+/.test(line) || /\binterface\s+/.test(line) || /\benum\s+/.test(line)) {return 'class';}
      if (/\b(public|private|protected)?\s*\w+\s+\w+\s*\(/.test(line)) {return 'method';}
      if (/\b(public|private|protected)?\s*\w+\s+\w+\s*[;=]/.test(line)) {return 'field';}
    }
    return 'method';
  }
}

/**
 * Factory function
 */
export function createJavaAnalyzer(config: JavaAnalyzerConfig): JavaAnalyzer {
  return new JavaAnalyzer(config);
}
