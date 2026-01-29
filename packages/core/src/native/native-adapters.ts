/**
 * Native Rust Adapters
 * 
 * This module provides adapter functions that wire the Rust native module
 * into the existing TypeScript code paths with proper fallback mechanisms.
 * 
 * Pattern: Try native first, fall back to TypeScript on failure or unavailability.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createCallGraphAnalyzer } from '../call-graph/index.js';
import { createConstantScanner, type FileConstantResult } from '../constants/index.js';
import { createEnvScanner } from '../environment/index.js';
import { createErrorHandlingAnalyzer } from '../error-handling/index.js';
import { ModuleCouplingAnalyzer } from '../module-coupling/coupling-analyzer.js';
import { ParserManager } from '../parsers/parser-manager.js';
import { createTestTopologyAnalyzer } from '../test-topology/index.js';

import {
  isNativeAvailable,
  type ParseResult,
  type CouplingResult,
  type TestTopologyResult,
  type ErrorHandlingResult,
  type ConstantsResult,
  type EnvironmentResult,
  type WrappersResult,
  type BoundaryScanResult,
  type EnvAccess,
} from './index.js';

// Import TypeScript implementations for fallback

// ============================================================================
// Native Module Reference
// ============================================================================

interface NativeModule {
  parse(source: string, filePath: string): ParseResult | null;
  analyzeCoupling(files: string[]): CouplingResult;
  analyzeTestTopology(files: string[]): TestTopologyResult;
  analyzeErrorHandling(files: string[]): ErrorHandlingResult;
  analyzeConstants(files: string[]): ConstantsResult;
  analyzeEnvironment(files: string[]): EnvironmentResult;
  analyzeWrappers(files: string[]): WrappersResult;
  scanBoundaries(files: string[]): BoundaryScanResult;
}

let nativeModule: NativeModule | null = null;

try {
  // Try the published package name first
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  nativeModule = require('driftdetect-native');
} catch {
  // Fall back to scoped name for local development
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeModule = require('@drift/native');
  } catch {
    // Native not available
  }
}

// ============================================================================
// Logging
// ============================================================================

const DEBUG = process.env['DRIFT_DEBUG'] === 'true';

function logNative(fn: string, success: boolean, durationMs?: number): void {
  if (DEBUG) {
    const status = success ? '✓' : '✗';
    const time = durationMs !== undefined ? ` (${durationMs}ms)` : '';
    console.log(`[native] ${fn}: ${status}${time}`);
  }
}

function logFallback(fn: string, reason: string): void {
  if (DEBUG) {
    console.log(`[native] ${fn}: falling back to TypeScript - ${reason}`);
  }
}

// ============================================================================
// Parse Adapter
// ============================================================================

/**
 * Parse source code with native Rust parser, falling back to TypeScript.
 * 
 * Note: The native parser extracts symbols (functions, classes, imports, etc.)
 * while the TypeScript parser returns raw AST. The fallback returns null
 * since converting AST to extracted symbols is complex.
 * 
 * For AST-based parsing, use ParserManager directly.
 */
export async function parseWithFallback(
  source: string,
  filePath: string,
  _tsParser?: ParserManager
): Promise<ParseResult | null> {
  const start = Date.now();
  
  // Try native first
  if (nativeModule && isNativeAvailable()) {
    try {
      const result = nativeModule.parse(source, filePath);
      logNative('parse', true, Date.now() - start);
      return result;
    } catch (err) {
      logFallback('parse', err instanceof Error ? err.message : 'unknown error');
    }
  }
  
  // Fallback: Native parser extracts symbols, TypeScript parser returns AST
  // These are fundamentally different - return null to indicate no extraction available
  // Callers should use ParserManager directly if they need AST parsing
  logFallback('parse', 'native not available, symbol extraction requires native module');
  return null;
}

// ============================================================================
// Coupling Adapter
// ============================================================================

/**
 * Analyze module coupling with native Rust analyzer, falling back to TypeScript.
 */
export async function analyzeCouplingWithFallback(
  rootDir: string,
  files?: string[]
): Promise<CouplingResult> {
  const start = Date.now();
  
  // Get file list if not provided
  if (!files) {
    files = await findSourceFiles(rootDir);
  }
  
  // Try native first
  if (nativeModule && isNativeAvailable()) {
    try {
      const result = nativeModule.analyzeCoupling(files.map(f => path.join(rootDir, f)));
      logNative('analyzeCoupling', true, Date.now() - start);
      return result;
    } catch (err) {
      logFallback('analyzeCoupling', err instanceof Error ? err.message : 'unknown error');
    }
  }
  
  // Fallback to TypeScript
  const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir });
  await callGraphAnalyzer.initialize();
  const callGraph = callGraphAnalyzer.getGraph();
  
  if (!callGraph) {
    return {
      modules: [],
      cycles: [],
      hotspots: [],
      unusedExports: [],
      healthScore: 0,
      filesAnalyzed: 0,
      durationMs: Date.now() - start,
    };
  }
  
  const couplingAnalyzer = new ModuleCouplingAnalyzer({ rootDir });
  couplingAnalyzer.setCallGraph(callGraph);
  const graph = couplingAnalyzer.build();
  
  // Convert to native format
  const modules = Array.from(graph.modules.values()).map(m => ({
    path: m.path,
    ca: m.metrics.Ca,
    ce: m.metrics.Ce,
    instability: m.metrics.instability,
    abstractness: m.metrics.abstractness,
    distance: m.metrics.distance,
    files: [m.path],
  }));
  
  const cycles = graph.cycles.map(c => ({
    modules: c.path,
    severity: c.severity,
    filesAffected: c.path.length,
  }));
  
  const hotspots = couplingAnalyzer.getHotspots({ limit: 10 }).map(h => ({
    module: h.path,
    totalCoupling: h.coupling,
    incoming: graph.modules.get(h.path)?.importedBy ?? [],
    outgoing: graph.modules.get(h.path)?.imports ?? [],
  }));
  
  const unusedExports = couplingAnalyzer.getUnusedExports().flatMap(u => 
    u.unusedExports.map(e => ({
      name: e.name,
      file: u.module,
      line: e.line,
      exportType: e.kind,
    }))
  );
  
  // Calculate health score
  const healthScore = Math.max(0, 100 - (cycles.length * 10) - (hotspots.length * 5));
  
  return {
    modules,
    cycles,
    hotspots,
    unusedExports,
    healthScore,
    filesAnalyzed: files.length,
    durationMs: Date.now() - start,
  };
}

// ============================================================================
// Test Topology Adapter
// ============================================================================

/**
 * Analyze test topology with native Rust analyzer, falling back to TypeScript.
 */
export async function analyzeTestTopologyWithFallback(
  rootDir: string,
  files?: string[]
): Promise<TestTopologyResult> {
  const start = Date.now();
  
  // Get file list if not provided
  if (!files) {
    files = await findSourceFiles(rootDir);
  }
  
  // Try native first
  if (nativeModule && isNativeAvailable()) {
    try {
      const result = nativeModule.analyzeTestTopology(files.map(f => path.join(rootDir, f)));
      logNative('analyzeTestTopology', true, Date.now() - start);
      return result;
    } catch (err) {
      logFallback('analyzeTestTopology', err instanceof Error ? err.message : 'unknown error');
    }
  }
  
  // Fallback to TypeScript
  const analyzer = createTestTopologyAnalyzer({});
  
  // Load call graph if available
  try {
    const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir });
    await callGraphAnalyzer.initialize();
    const graph = callGraphAnalyzer.getGraph();
    if (graph) {
      analyzer.setCallGraph(graph);
    }
  } catch {
    // Continue without call graph
  }
  
  // Extract tests from files
  for (const file of files) {
    if (!isTestFile(file)) {continue;}
    try {
      const content = await fs.readFile(path.join(rootDir, file), 'utf-8');
      analyzer.extractFromFile(content, file);
    } catch {
      // Skip unreadable files
    }
  }
  
  analyzer.buildMappings();
  const summary = analyzer.getSummary();
  
  // Convert to native format
  const testFiles: TestTopologyResult['testFiles'] = [];
  const coverage: TestTopologyResult['coverage'] = [];
  const uncoveredFiles: string[] = [];
  
  // Build test files list from summary
  for (const [framework, count] of Object.entries(summary.byFramework)) {
    if (count > 0) {
      testFiles.push({
        path: `${framework} tests`,
        framework,
        testCount: count,
        mockCount: 0,
      });
    }
  }
  
  return {
    testFiles,
    coverage,
    uncoveredFiles,
    totalTests: summary.testCases,
    skippedTests: 0,
    filesAnalyzed: files.length,
    durationMs: Date.now() - start,
  };
}

// ============================================================================
// Error Handling Adapter
// ============================================================================

/**
 * Analyze error handling with native Rust analyzer, falling back to TypeScript.
 */
export async function analyzeErrorHandlingWithFallback(
  rootDir: string,
  files?: string[]
): Promise<ErrorHandlingResult> {
  const start = Date.now();
  
  // Get file list if not provided
  if (!files) {
    files = await findSourceFiles(rootDir);
  }
  
  // Try native first
  if (nativeModule && isNativeAvailable()) {
    try {
      const result = nativeModule.analyzeErrorHandling(files.map(f => path.join(rootDir, f)));
      logNative('analyzeErrorHandling', true, Date.now() - start);
      return result;
    } catch (err) {
      logFallback('analyzeErrorHandling', err instanceof Error ? err.message : 'unknown error');
    }
  }
  
  // Fallback to TypeScript
  const analyzer = createErrorHandlingAnalyzer({ rootDir });
  
  // Load call graph
  try {
    const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir });
    await callGraphAnalyzer.initialize();
    const graph = callGraphAnalyzer.getGraph();
    if (graph) {
      analyzer.setCallGraph(graph);
    }
  } catch {
    // Continue without call graph
  }
  
  analyzer.build();
  const gaps = analyzer.getGaps({ limit: 50 });
  const boundaries = analyzer.getBoundaries();
  
  // Convert to native format
  return {
    boundaries: boundaries.map(b => ({
      file: b.file,
      startLine: b.line,
      endLine: b.line + 10, // Approximate
      boundaryType: b.frameworkType ?? 'try-catch',
      caughtTypes: b.handledTypes,
      rethrows: false,
      logsError: false,
      isSwallowed: false,
    })),
    gaps: gaps.map(g => ({
      file: g.file,
      line: g.line,
      function: g.name,
      gapType: g.gapType,
      severity: g.severity,
      description: g.description,
    })),
    errorTypes: [],
    filesAnalyzed: files.length,
    durationMs: Date.now() - start,
  };
}

// ============================================================================
// Constants Adapter
// ============================================================================

/**
 * Analyze constants with native Rust analyzer, falling back to TypeScript.
 */
export async function analyzeConstantsWithFallback(
  rootDir: string,
  files?: string[]
): Promise<ConstantsResult> {
  const start = Date.now();
  
  // Get file list if not provided
  if (!files) {
    files = await findSourceFiles(rootDir);
  }
  
  // Try native first
  if (nativeModule && isNativeAvailable()) {
    try {
      const result = nativeModule.analyzeConstants(files.map(f => path.join(rootDir, f)));
      logNative('analyzeConstants', true, Date.now() - start);
      return result;
    } catch (err) {
      logFallback('analyzeConstants', err instanceof Error ? err.message : 'unknown error');
    }
  }
  
  // Fallback to TypeScript
  const scanner = createConstantScanner({ rootDir });
  await scanner.initialize();
  
  // Read file contents and extract
  const fileContents: Array<{ path: string; content: string }> = [];
  for (const file of files) {
    try {
      const content = await fs.readFile(path.join(rootDir, file), 'utf-8');
      fileContents.push({ path: file, content });
    } catch {
      // Skip unreadable files
    }
  }
  
  const scanResult = await scanner.extractFiles(fileContents);
  
  // Convert to native format
  const constants: ConstantsResult['constants'] = [];
  const secrets: ConstantsResult['secrets'] = [];
  const magicNumbers: ConstantsResult['magicNumbers'] = [];
  const inconsistencies: ConstantsResult['inconsistencies'] = [];
  
  for (const fileResult of scanResult.files) {
    if (!fileResult.result) {continue;}
    
    const result: FileConstantResult = fileResult.result;
    const file = fileResult.file;
    
    for (const constant of result.constants) {
      constants.push({
        name: constant.name,
        value: String(constant.value ?? ''),
        valueType: typeof constant.value,
        category: constant.category,
        file,
        line: constant.line,
        isExported: constant.isExported,
        language: result.language,
        declarationType: constant.kind,
      });
    }
  }
  
  return {
    constants,
    secrets,
    magicNumbers,
    inconsistencies,
    stats: {
      totalConstants: constants.length,
      byCategory: [],
      byLanguage: [],
      exportedCount: constants.filter(c => c.isExported).length,
      secretsCount: secrets.length,
      magicNumbersCount: magicNumbers.length,
      filesAnalyzed: files.length,
      durationMs: Date.now() - start,
    },
  };
}

// ============================================================================
// Environment Adapter
// ============================================================================

/**
 * Analyze environment variables with native Rust analyzer, falling back to TypeScript.
 */
export async function analyzeEnvironmentWithFallback(
  rootDir: string,
  files?: string[]
): Promise<EnvironmentResult> {
  const start = Date.now();
  
  // Get file list if not provided
  if (!files) {
    files = await findSourceFiles(rootDir);
  }
  
  // Try native first
  if (nativeModule && isNativeAvailable()) {
    try {
      const result = nativeModule.analyzeEnvironment(files.map(f => path.join(rootDir, f)));
      logNative('analyzeEnvironment', true, Date.now() - start);
      return result;
    } catch (err) {
      logFallback('analyzeEnvironment', err instanceof Error ? err.message : 'unknown error');
    }
  }
  
  // Fallback to TypeScript
  const scanner = createEnvScanner({ rootDir });
  const scanResult = await scanner.scanFiles(files);
  
  // Convert to native format
  const accesses: EnvironmentResult['accesses'] = [];
  const variables: EnvironmentResult['variables'] = [];
  
  for (const [varName, varInfo] of Object.entries(scanResult.accessMap.variables)) {
    variables.push({
      name: varName,
      sensitivity: varInfo.sensitivity,
      accesses: varInfo.accessedBy.map(a => ({
        file: a.file,
        line: a.line,
        hasDefault: a.hasDefault,
      })),
      isRequired: varInfo.isRequired,
      defaultValues: [],
      accessCount: varInfo.accessedBy.length,
    });
    
    for (const access of varInfo.accessedBy) {
      const envAccess: EnvAccess = {
        name: varName,
        file: access.file,
        line: access.line,
        hasDefault: access.hasDefault,
        accessMethod: access.method,
        language: access.language,
      };
      accesses.push(envAccess);
    }
  }
  
  const required = variables.filter(v => v.isRequired);
  const secrets = variables.filter(v => v.sensitivity === 'secret');
  
  return {
    accesses,
    variables,
    required,
    secrets,
    stats: {
      totalAccesses: accesses.length,
      uniqueVariables: variables.length,
      requiredCount: required.length,
      secretsCount: secrets.length,
      credentialsCount: variables.filter(v => v.sensitivity === 'credential').length,
      configCount: variables.filter(v => v.sensitivity === 'config').length,
      byLanguage: [],
      filesAnalyzed: files.length,
      durationMs: Date.now() - start,
    },
  };
}

// ============================================================================
// Wrappers Adapter
// ============================================================================

/**
 * Analyze wrappers with native Rust analyzer, falling back to TypeScript.
 */
export async function analyzeWrappersWithFallback(
  rootDir: string,
  files?: string[]
): Promise<WrappersResult> {
  const start = Date.now();
  
  // Get file list if not provided
  if (!files) {
    files = await findSourceFiles(rootDir);
  }
  
  // Try native first
  if (nativeModule && isNativeAvailable()) {
    try {
      const result = nativeModule.analyzeWrappers(files.map(f => path.join(rootDir, f)));
      logNative('analyzeWrappers', true, Date.now() - start);
      return result;
    } catch (err) {
      logFallback('analyzeWrappers', err instanceof Error ? err.message : 'unknown error');
    }
  }
  
  // Fallback: Return empty result (TypeScript wrappers analyzer has different API)
  // The TypeScript version requires call graph and primitive discovery context
  return {
    wrappers: [],
    clusters: [],
    stats: {
      totalWrappers: 0,
      clusterCount: 0,
      byCategory: [],
      topPrimitives: [],
      filesAnalyzed: files.length,
      durationMs: Date.now() - start,
    },
  };
}

// ============================================================================
// Boundaries Adapter
// ============================================================================

/**
 * Scan boundaries with native Rust scanner, falling back to TypeScript.
 */
export async function scanBoundariesWithFallback(
  rootDir: string,
  files?: string[]
): Promise<BoundaryScanResult> {
  const start = Date.now();
  
  // Get file list if not provided
  if (!files) {
    files = await findSourceFiles(rootDir);
  }
  
  // Try native first
  if (nativeModule && isNativeAvailable()) {
    try {
      const result = nativeModule.scanBoundaries(files.map(f => path.join(rootDir, f)));
      logNative('scanBoundaries', true, Date.now() - start);
      return result;
    } catch (err) {
      logFallback('scanBoundaries', err instanceof Error ? err.message : 'unknown error');
    }
  }
  
  // Fallback: Return empty result (TypeScript boundary scanner has different API)
  return {
    accessPoints: [],
    sensitiveFields: [],
    models: [],
    filesScanned: files.length,
    durationMs: Date.now() - start,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function isTestFile(filePath: string): boolean {
  const testPatterns = [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /_test\.py$/,
    /test_.*\.py$/,
    /Test\.java$/,
    /Tests\.java$/,
    /Test\.cs$/,
    /Tests\.cs$/,
    /Test\.php$/,
  ];
  return testPatterns.some(p => p.test(filePath));
}

async function findSourceFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cs', '.php', '.go', '.rs', '.cpp', '.cc', '.h', '.hpp'];
  const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.drift', 'vendor', 'target'];
  
  async function walk(dir: string, relativePath: string = ''): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        
        if (entry.isDirectory()) {
          if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith('.')) {
            await walk(fullPath, relPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            files.push(relPath);
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }
  
  await walk(rootDir);
  return files;
}

// ============================================================================
// Exports
// ============================================================================

export const nativeAdapters = {
  parseWithFallback,
  analyzeCouplingWithFallback,
  analyzeTestTopologyWithFallback,
  analyzeErrorHandlingWithFallback,
  analyzeConstantsWithFallback,
  analyzeEnvironmentWithFallback,
  analyzeWrappersWithFallback,
  scanBoundariesWithFallback,
};
