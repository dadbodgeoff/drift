/**
 * Native Rust Core Integration
 *
 * This module provides a unified interface to the Rust native addon with
 * automatic fallback to pure TypeScript implementations when native fails.
 *
 * Architecture:
 * - Try to load @drift/native (Rust NAPI addon)
 * - If unavailable, fall back to TypeScript implementations
 * - All functions have identical signatures regardless of backend
 */

// Types matching the Rust NAPI bindings
export interface ScanConfig {
  root: string;
  patterns: string[];
  extraIgnores?: string[];
  computeHashes?: boolean;
  maxFileSize?: number;
  threads?: number;
}

export interface FileInfo {
  path: string;
  size: number;
  hash?: string;
  language?: string;
}

export interface ScanResult {
  root: string;
  files: FileInfo[];
  stats: {
    totalFiles: number;
    totalBytes: number;
    dirsSkipped: number;
    filesSkipped: number;
    durationMs: number;
  };
  errors: string[];
}

export interface ParseResult {
  language: string;
  functions: FunctionInfo[];
  classes: ClassInfo[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  calls: CallSite[];
  errors: ParseError[];
  parseTimeUs: number;
}

export interface FunctionInfo {
  name: string;
  qualifiedName?: string;
  isExported: boolean;
  isAsync: boolean;
  startLine: number;
  endLine: number;
  decorators: string[];
}

export interface ClassInfo {
  name: string;
  extends?: string;
  implements: string[];
  isExported: boolean;
  startLine: number;
  endLine: number;
}

export interface ImportInfo {
  source: string;
  named: string[];
  default?: string;
  namespace?: string;
  isTypeOnly: boolean;
  line: number;
}

export interface ExportInfo {
  name: string;
  fromSource?: string;
  isDefault: boolean;
  line: number;
}

export interface CallSite {
  callee: string;
  receiver?: string;
  argCount: number;
  line: number;
}

export interface ParseError {
  message: string;
  line: number;
}

export interface BuildConfig {
  root: string;
  patterns: string[];
  resolutionBatchSize?: number;
}

export interface BuildResult {
  filesProcessed: number;
  totalFunctions: number;
  totalCalls: number;
  resolvedCalls: number;
  resolutionRate: number;
  entryPoints: number;
  dataAccessors: number;
  errors: string[];
  durationMs: number;
}

export interface DataAccessPoint {
  table: string;
  operation: 'read' | 'write' | 'delete';
  fields: string[];
  file: string;
  line: number;
  confidence: number;
  framework?: string;
}

export interface SensitiveField {
  field: string;
  table?: string;
  sensitivityType: 'pii' | 'credentials' | 'financial' | 'health';
  file: string;
  line: number;
  confidence: number;
}

export interface BoundaryScanResult {
  accessPoints: DataAccessPoint[];
  sensitiveFields: SensitiveField[];
  models: ORMModel[];
  filesScanned: number;
  durationMs: number;
}

export interface ORMModel {
  name: string;
  tableName: string;
  fields: string[];
  file: string;
  line: number;
  framework: string;
  confidence: number;
}

export interface CouplingResult {
  modules: ModuleMetrics[];
  cycles: DependencyCycle[];
  hotspots: CouplingHotspot[];
  unusedExports: UnusedExport[];
  healthScore: number;
  filesAnalyzed: number;
  durationMs: number;
}

export interface ModuleMetrics {
  path: string;
  ca: number;
  ce: number;
  instability: number;
  abstractness: number;
  distance: number;
  files: string[];
}

export interface DependencyCycle {
  modules: string[];
  severity: 'info' | 'warning' | 'critical';
  filesAffected: number;
}

export interface CouplingHotspot {
  module: string;
  totalCoupling: number;
  incoming: string[];
  outgoing: string[];
}

export interface UnusedExport {
  name: string;
  file: string;
  line: number;
  exportType: string;
}

export interface TestTopologyResult {
  testFiles: TestFile[];
  coverage: TestCoverage[];
  uncoveredFiles: string[];
  totalTests: number;
  skippedTests: number;
  filesAnalyzed: number;
  durationMs: number;
}

export interface TestFile {
  path: string;
  testsFile?: string;
  framework: string;
  testCount: number;
  mockCount: number;
}

export interface TestCoverage {
  sourceFile: string;
  testFiles: string[];
  coveragePercent?: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface ErrorHandlingResult {
  boundaries: ErrorBoundary[];
  gaps: ErrorGap[];
  errorTypes: ErrorType[];
  filesAnalyzed: number;
  durationMs: number;
}

export interface ErrorBoundary {
  file: string;
  startLine: number;
  endLine: number;
  boundaryType: string;
  caughtTypes: string[];
  rethrows: boolean;
  logsError: boolean;
  isSwallowed: boolean;
}

export interface ErrorGap {
  file: string;
  line: number;
  function: string;
  gapType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface ErrorType {
  name: string;
  file: string;
  line: number;
  extends?: string;
  isExported: boolean;
}

// Reachability types
export interface CodeLocation {
  file: string;
  line: number;
  column?: number;
  functionId?: string;
}

export interface CallPathNode {
  functionId: string;
  functionName: string;
  file: string;
  line: number;
}

export interface ReachableDataAccess {
  table: string;
  operation: 'read' | 'write' | 'delete';
  fields: string[];
  file: string;
  line: number;
  confidence: number;
  framework?: string;
  path: CallPathNode[];
  depth: number;
}

export interface SensitiveFieldAccess {
  field: string;
  table?: string;
  sensitivityType: 'pii' | 'credentials' | 'financial' | 'health';
  file: string;
  line: number;
  confidence: number;
  paths: CallPathNode[][];
  accessCount: number;
}

export interface ReachabilityResult {
  origin: CodeLocation;
  reachableAccess: ReachableDataAccess[];
  tables: string[];
  sensitiveFields: SensitiveFieldAccess[];
  maxDepth: number;
  functionsTraversed: number;
}

export interface ReachabilityOptions {
  maxDepth?: number;
  sensitiveOnly?: boolean;
  tables?: string[];
  includeUnresolved?: boolean;
}

export interface InverseAccessPath {
  entryPoint: string;
  path: CallPathNode[];
  accessTable: string;
  accessOperation: 'read' | 'write' | 'delete';
  accessFields: string[];
  accessFile: string;
  accessLine: number;
}

export interface InverseReachabilityResult {
  targetTable: string;
  targetField?: string;
  accessPaths: InverseAccessPath[];
  entryPoints: string[];
  totalAccessors: number;
}

export interface CallGraphFunction {
  id: string;
  name: string;
  qualifiedName: string;
  file: string;
  startLine: number;
  endLine: number;
  calls: CallGraphCallSite[];
  dataAccess: CallGraphDataAccess[];
  isEntryPoint: boolean;
}

export interface CallGraphCallSite {
  calleeName: string;
  resolved: boolean;
  resolvedCandidates: string[];
  line: number;
}

export interface CallGraphDataAccess {
  table: string;
  operation: 'read' | 'write' | 'delete';
  fields: string[];
  file: string;
  line: number;
  confidence: number;
  framework?: string;
}

export interface CallGraphInput {
  functions: CallGraphFunction[];
  entryPoints: string[];
  dataAccessors: string[];
}

// Unified Analyzer types
export interface DetectedPattern {
  category: string;
  patternType: string;
  subcategory?: string;
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  matchedText: string;
  confidence: number;
  detectionMethod: 'ast' | 'regex' | 'structural';
}

export interface FilePatterns {
  file: string;
  language: string;
  patterns: DetectedPattern[];
  parseTimeUs: number;
  detectTimeUs: number;
}

export interface ResolutionStats {
  totalCalls: number;
  resolvedCalls: number;
  resolutionRate: number;
  sameFileResolutions: number;
  crossFileResolutions: number;
  unresolvedCalls: number;
}

export interface CallGraphSummary {
  totalFunctions: number;
  entryPoints: number;
  dataAccessors: number;
  maxCallDepth: number;
}

export interface AnalysisMetrics {
  filesProcessed: number;
  totalLines: number;
  parseTimeMs: number;
  detectTimeMs: number;
  resolveTimeMs: number;
  totalTimeMs: number;
}

export interface UnifiedResult {
  filePatterns: FilePatterns[];
  resolution: ResolutionStats;
  callGraph: CallGraphSummary;
  metrics: AnalysisMetrics;
  totalPatterns: number;
  totalViolations: number;
}

export interface UnifiedOptions {
  patterns: string[];
  categories?: string[];
  maxResolutionDepth?: number;
  parallel?: boolean;
  threads?: number;
}

// Constants Analysis types
export interface ConstantInfo {
  name: string;
  value: string;
  valueType: string;
  category: string;
  file: string;
  line: number;
  isExported: boolean;
  language: string;
  declarationType: string;
}

export interface SecretCandidate {
  name: string;
  maskedValue: string;
  secretType: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  file: string;
  line: number;
  confidence: number;
  reason: string;
}

export interface MagicNumber {
  value: number;
  file: string;
  line: number;
  context: string;
  suggestedName?: string;
}

export interface ValueLocation {
  value: string;
  file: string;
  line: number;
}

export interface ValueInconsistency {
  namePattern: string;
  values: ValueLocation[];
  severity: string;
}

export interface ConstantsStats {
  totalConstants: number;
  byCategory: { category: string; count: number }[];
  byLanguage: { language: string; count: number }[];
  exportedCount: number;
  secretsCount: number;
  magicNumbersCount: number;
  filesAnalyzed: number;
  durationMs: number;
}

export interface ConstantsResult {
  constants: ConstantInfo[];
  secrets: SecretCandidate[];
  magicNumbers: MagicNumber[];
  inconsistencies: ValueInconsistency[];
  stats: ConstantsStats;
}

// Environment Analysis types
export interface EnvAccess {
  name: string;
  file: string;
  line: number;
  hasDefault: boolean;
  defaultValue?: string;
  accessMethod: string;
  language: string;
}

export interface EnvAccessLocation {
  file: string;
  line: number;
  hasDefault: boolean;
}

export interface EnvVariable {
  name: string;
  sensitivity: 'secret' | 'credential' | 'config' | 'unknown';
  accesses: EnvAccessLocation[];
  isRequired: boolean;
  defaultValues: string[];
  accessCount: number;
}

export interface EnvironmentStats {
  totalAccesses: number;
  uniqueVariables: number;
  requiredCount: number;
  secretsCount: number;
  credentialsCount: number;
  configCount: number;
  byLanguage: { language: string; count: number }[];
  filesAnalyzed: number;
  durationMs: number;
}

export interface EnvironmentResult {
  accesses: EnvAccess[];
  variables: EnvVariable[];
  required: EnvVariable[];
  secrets: EnvVariable[];
  stats: EnvironmentStats;
}

// Wrappers Analysis types
export interface WrapperInfo {
  name: string;
  file: string;
  line: number;
  wraps: string[];
  category: string;
  isExported: boolean;
  usageCount: number;
  confidence: number;
}

export interface WrapperCluster {
  id: string;
  category: string;
  wrappedPrimitive: string;
  wrappers: WrapperInfo[];
  confidence: number;
  totalUsage: number;
}

export interface WrappersStats {
  totalWrappers: number;
  clusterCount: number;
  byCategory: { category: string; count: number }[];
  topPrimitives: { primitive: string; count: number }[];
  filesAnalyzed: number;
  durationMs: number;
}

export interface WrappersResult {
  wrappers: WrapperInfo[];
  clusters: WrapperCluster[];
  stats: WrappersStats;
}

// Native module interface
interface NativeModule {
  scan(config: ScanConfig): ScanResult;
  parse(source: string, filePath: string): ParseResult | null;
  supportedLanguages(): string[];
  version(): string;
  buildCallGraph(config: BuildConfig): BuildResult;
  scanBoundaries(files: string[]): BoundaryScanResult;
  scanBoundariesSource(source: string, filePath: string): BoundaryScanResult;
  analyzeCoupling(files: string[]): CouplingResult;
  analyzeTestTopology(files: string[]): TestTopologyResult;
  analyzeErrorHandling(files: string[]): ErrorHandlingResult;
  analyzeReachability(
    graphInput: CallGraphInput,
    functionId: string,
    options: ReachabilityOptions
  ): ReachabilityResult;
  analyzeInverseReachability(
    graphInput: CallGraphInput,
    table: string,
    field?: string,
    maxDepth?: number
  ): InverseReachabilityResult;
  // SQLite-backed reachability (recommended for large codebases)
  analyzeReachabilitySqlite(
    rootDir: string,
    functionId: string,
    options: ReachabilityOptions
  ): ReachabilityResult;
  analyzeInverseReachabilitySqlite(
    rootDir: string,
    table: string,
    field?: string,
    maxDepth?: number
  ): InverseReachabilityResult;
  isCallGraphAvailable(rootDir: string): boolean;
  getCallGraphStats(rootDir: string): {
    totalFunctions: number;
    totalCalls: number;
    resolvedCalls: number;
    entryPoints: number;
    dataAccessors: number;
  };
  getCallGraphEntryPoints(rootDir: string): Array<{
    id: string;
    name: string;
    file: string;
    line: number;
  }>;
  getCallGraphDataAccessors(rootDir: string): Array<{
    id: string;
    name: string;
    file: string;
    line: number;
    tables: string[];
  }>;
  getCallGraphCallers(rootDir: string, target: string): Array<{
    callerId: string;
    callerName: string;
    callerFile: string;
    line: number;
  }>;
  getCallGraphFileCallers(rootDir: string, filePath: string): Array<{
    callerId: string;
    callerName: string;
    callerFile: string;
    line: number;
  }>;
  analyzeUnified(root: string, options: UnifiedOptions): UnifiedResult;
  analyzeConstants(files: string[]): ConstantsResult;
  analyzeEnvironment(files: string[]): EnvironmentResult;
  analyzeWrappers(files: string[]): WrappersResult;
}

import { createRequire } from 'node:module';

// Create require function for ESM compatibility
const require = createRequire(import.meta.url);

// Try to load native module
let nativeModule: NativeModule | null = null;
let loadError: Error | null = null;

// For local development, try to load from crates/drift-napi first
const localNativePath = new URL('../../../../crates/drift-napi/index.js', import.meta.url).pathname;
try {
  nativeModule = require(localNativePath);
} catch {
  // Fall back to published packages
  try {
    nativeModule = require('driftdetect-native');
  } catch (err) {
    loadError = err as Error;
  }
}

/**
 * Check if native module is available
 */
export function isNativeAvailable(): boolean {
  return nativeModule !== null;
}

/**
 * Get native module load error (if any)
 */
export function getNativeLoadError(): Error | null {
  return loadError;
}

/**
 * Get native module version
 */
export function getNativeVersion(): string | null {
  return nativeModule?.version() ?? null;
}

/**
 * Get supported languages from native module
 */
export function getSupportedLanguages(): string[] {
  if (nativeModule) {
    return nativeModule.supportedLanguages();
  }
  // Fallback: return known supported languages
  return [
    'typescript',
    'javascript',
    'python',
    'java',
    'csharp',
    'php',
    'go',
    'rust',
    'cpp',
  ];
}

/**
 * Scan files using native scanner
 * 
 * Note: Native module is required for this function.
 */
export async function scan(config: ScanConfig): Promise<ScanResult> {
  if (nativeModule) {
    return nativeModule.scan(config);
  }

  // Native module required for scan
  throw new Error(
    'Native module required for scan(). ' +
    'Install @drift/native or use scanWithFallback from scanner module.'
  );
}

/**
 * Parse source code using native parser (with TS fallback)
 * 
 * Note: The native parser extracts functions, classes, imports, exports, and calls.
 * The TypeScript fallback is not available - native module is required.
 */
export async function parse(
  source: string,
  filePath: string
): Promise<ParseResult | null> {
  if (nativeModule) {
    return nativeModule.parse(source, filePath);
  }

  // Native module required for this function
  // The TypeScript parser has a different API (returns AST, not extracted symbols)
  throw new Error(
    'Native module required for parse(). ' +
    'Install @drift/native or use the TypeScript ParserManager directly for AST parsing.'
  );
}

/**
 * Build call graph using native builder (with TS fallback)
 */
export async function buildCallGraph(config: BuildConfig): Promise<BuildResult> {
  if (nativeModule) {
    return nativeModule.buildCallGraph(config);
  }

  // Native module required - TypeScript streaming builder has different API
  throw new Error(
    'Native module required for buildCallGraph(). ' +
    'Install @drift/native or use StreamingCallGraphBuilder directly.'
  );
}

/**
 * Scan boundaries using native scanner (with TS fallback)
 */
export async function scanBoundaries(files: string[]): Promise<BoundaryScanResult> {
  if (nativeModule) {
    return nativeModule.scanBoundaries(files);
  }

  // Native module required - TypeScript boundary scanner has different API
  throw new Error(
    'Native module required for scanBoundaries(). ' +
    'Install @drift/native or use BoundaryScanner directly.'
  );
}

/**
 * Analyze coupling using native analyzer (with TS fallback)
 */
export async function analyzeCoupling(files: string[]): Promise<CouplingResult> {
  if (nativeModule) {
    return nativeModule.analyzeCoupling(files);
  }

  // Native module required - TypeScript coupling analyzer has different API
  throw new Error(
    'Native module required for analyzeCoupling(). ' +
    'Install @drift/native or use CouplingAnalyzer directly.'
  );
}

/**
 * Analyze test topology using native analyzer (with TS fallback)
 */
export async function analyzeTestTopology(
  files: string[]
): Promise<TestTopologyResult> {
  if (nativeModule) {
    return nativeModule.analyzeTestTopology(files);
  }

  // Native module required - TypeScript test topology analyzer has different API
  throw new Error(
    'Native module required for analyzeTestTopology(). ' +
    'Install @drift/native or use TestTopologyAnalyzer directly.'
  );
}

/**
 * Analyze error handling using native analyzer (with TS fallback)
 */
export async function analyzeErrorHandling(
  files: string[]
): Promise<ErrorHandlingResult> {
  if (nativeModule) {
    return nativeModule.analyzeErrorHandling(files);
  }

  // Native module required - TypeScript error handling analyzer has different API
  throw new Error(
    'Native module required for analyzeErrorHandling(). ' +
    'Install @drift/native or use ErrorHandlingAnalyzer directly.'
  );
}

/**
 * Analyze reachability from a function using native analyzer (with TS fallback)
 * Answers: "What data can this function ultimately access?"
 */
export async function analyzeReachability(
  graphInput: CallGraphInput,
  functionId: string,
  options: ReachabilityOptions = {}
): Promise<ReachabilityResult> {
  if (nativeModule) {
    return nativeModule.analyzeReachability(graphInput, functionId, options);
  }

  // Native module required - TypeScript reachability analyzer has different API
  throw new Error(
    'Native module required for analyzeReachability(). ' +
    'Install @drift/native or use ReachabilityAnalyzer directly.'
  );
}

/**
 * Analyze inverse reachability using native analyzer (with TS fallback)
 * Answers: "Who can access this data?"
 */
export async function analyzeInverseReachability(
  graphInput: CallGraphInput,
  table: string,
  field?: string,
  maxDepth?: number
): Promise<InverseReachabilityResult> {
  if (nativeModule) {
    return nativeModule.analyzeInverseReachability(graphInput, table, field, maxDepth);
  }

  // Native module required - TypeScript reachability analyzer has different API
  throw new Error(
    'Native module required for analyzeInverseReachability(). ' +
    'Install @drift/native or use ReachabilityAnalyzer directly.'
  );
}

/**
 * Analyze reachability from a function using SQLite storage (recommended for large codebases)
 * Answers: "What data can this function ultimately access?"
 * 
 * This queries the SQLite call graph database directly, avoiding the need
 * to load the entire call graph into memory.
 * 
 * Requires: Call graph must be built first using buildCallGraph()
 */
export async function analyzeReachabilitySqlite(
  rootDir: string,
  functionId: string,
  options: ReachabilityOptions = {}
): Promise<ReachabilityResult> {
  if (nativeModule) {
    return nativeModule.analyzeReachabilitySqlite(rootDir, functionId, options);
  }

  throw new Error(
    'Native module required for analyzeReachabilitySqlite(). ' +
    'Install @drift/native for SQLite-backed reachability analysis.'
  );
}

/**
 * Analyze inverse reachability using SQLite storage (recommended for large codebases)
 * Answers: "Who can access this data?"
 * 
 * This queries the SQLite call graph database directly, avoiding the need
 * to load the entire call graph into memory.
 * 
 * Requires: Call graph must be built first using buildCallGraph()
 */
export async function analyzeInverseReachabilitySqlite(
  rootDir: string,
  table: string,
  field?: string,
  maxDepth?: number
): Promise<InverseReachabilityResult> {
  if (nativeModule) {
    return nativeModule.analyzeInverseReachabilitySqlite(rootDir, table, field, maxDepth);
  }

  throw new Error(
    'Native module required for analyzeInverseReachabilitySqlite(). ' +
    'Install @drift/native for SQLite-backed reachability analysis.'
  );
}

/**
 * Check if SQLite call graph database exists and has data
 * 
 * Use this to check if buildCallGraph() has been run before
 * calling the SQLite-backed reachability functions.
 */
export function isCallGraphAvailable(rootDir: string): boolean {
  if (nativeModule) {
    return nativeModule.isCallGraphAvailable(rootDir);
  }
  return false;
}

/**
 * Call graph statistics from SQLite database
 */
export interface CallGraphStats {
  totalFunctions: number;
  totalCalls: number;
  resolvedCalls: number;
  entryPoints: number;
  dataAccessors: number;
}

/**
 * Get call graph statistics from SQLite database
 * 
 * Returns statistics about the call graph including function count,
 * call site count, resolution rate, and entry point/data accessor counts.
 */
export function getCallGraphStats(rootDir: string): CallGraphStats | null {
  if (nativeModule && nativeModule.getCallGraphStats) {
    try {
      const stats = nativeModule.getCallGraphStats(rootDir);
      return {
        totalFunctions: Number(stats.totalFunctions),
        totalCalls: Number(stats.totalCalls),
        resolvedCalls: Number(stats.resolvedCalls),
        entryPoints: Number(stats.entryPoints),
        dataAccessors: Number(stats.dataAccessors),
      };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Entry point info from call graph
 */
export interface EntryPointInfo {
  id: string;
  name: string;
  file: string;
  line: number;
}

/**
 * Get all entry points from SQLite call graph
 * 
 * Returns list of functions marked as entry points (exported functions,
 * API handlers, main functions, etc.)
 */
export function getCallGraphEntryPoints(rootDir: string): EntryPointInfo[] {
  if (nativeModule && nativeModule.getCallGraphEntryPoints) {
    try {
      return nativeModule.getCallGraphEntryPoints(rootDir).map(ep => ({
        id: ep.id,
        name: ep.name,
        file: ep.file,
        line: Number(ep.line),
      }));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Data accessor info from call graph
 */
export interface DataAccessorInfo {
  id: string;
  name: string;
  file: string;
  line: number;
  tables: string[];
}

/**
 * Get all data accessors from SQLite call graph
 * 
 * Returns list of functions that access database tables.
 */
export function getCallGraphDataAccessors(rootDir: string): DataAccessorInfo[] {
  if (nativeModule && nativeModule.getCallGraphDataAccessors) {
    try {
      return nativeModule.getCallGraphDataAccessors(rootDir).map(da => ({
        id: da.id,
        name: da.name,
        file: da.file,
        line: Number(da.line),
        tables: da.tables,
      }));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Caller info from call graph
 */
export interface CallerInfo {
  callerId: string;
  callerName: string;
  callerFile: string;
  line: number;
}

/**
 * Get all callers of a function from SQLite call graph
 * 
 * The target can be either a function ID (file:name:line) or just a function name.
 * Returns list of functions that call the target.
 */
export function getCallGraphCallers(rootDir: string, target: string): CallerInfo[] {
  if (nativeModule && nativeModule.getCallGraphCallers) {
    try {
      return nativeModule.getCallGraphCallers(rootDir, target).map(c => ({
        callerId: c.callerId,
        callerName: c.callerName,
        callerFile: c.callerFile,
        line: Number(c.line),
      }));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Get all callers for all functions in a file from SQLite call graph
 * 
 * This is more efficient than calling getCallGraphCallers for each function
 * when analyzing impact of a file change.
 */
export function getCallGraphFileCallers(rootDir: string, filePath: string): CallerInfo[] {
  if (nativeModule && nativeModule.getCallGraphFileCallers) {
    try {
      return nativeModule.getCallGraphFileCallers(rootDir, filePath).map(c => ({
        callerId: c.callerId,
        callerName: c.callerName,
        callerFile: c.callerFile,
        line: Number(c.line),
      }));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Analyze codebase with unified pattern detection and resolution (with TS fallback)
 * 
 * This is the main entry point for AST-first pattern detection.
 * Combines pattern detection and call resolution in a single pass.
 */
export async function analyzeUnified(
  root: string,
  options: UnifiedOptions
): Promise<UnifiedResult> {
  if (nativeModule) {
    return nativeModule.analyzeUnified(root, options);
  }

  // Native module required - unified analyzer is Rust-only
  throw new Error(
    'Native module required for analyzeUnified(). ' +
    'Install @drift/native for AST-first pattern detection.'
  );
}

/**
 * Analyze files for constants, secrets, and magic numbers
 * 
 * Detects hardcoded values, potential secrets, magic numbers,
 * and value inconsistencies across the codebase.
 */
export async function analyzeConstants(
  files: string[]
): Promise<ConstantsResult> {
  if (nativeModule) {
    return nativeModule.analyzeConstants(files);
  }

  // Native module required
  throw new Error(
    'Native module required for analyzeConstants(). ' +
    'Install @drift/native for constants analysis.'
  );
}

/**
 * Analyze files for environment variable usage
 * 
 * Finds process.env, os.environ, and config access patterns.
 * Classifies variables by sensitivity (secret, credential, config).
 */
export async function analyzeEnvironment(
  files: string[]
): Promise<EnvironmentResult> {
  if (nativeModule) {
    return nativeModule.analyzeEnvironment(files);
  }

  // Native module required
  throw new Error(
    'Native module required for analyzeEnvironment(). ' +
    'Install @drift/native for environment analysis.'
  );
}

/**
 * Analyze files for wrapper patterns
 * 
 * Detects custom abstractions over framework primitives
 * (React hooks, fetch wrappers, validation wrappers, etc.)
 */
export async function analyzeWrappers(
  files: string[]
): Promise<WrappersResult> {
  if (nativeModule) {
    return nativeModule.analyzeWrappers(files);
  }

  // Native module required
  throw new Error(
    'Native module required for analyzeWrappers(). ' +
    'Install @drift/native for wrapper detection.'
  );
}

// Export convenience object
export const native = {
  isAvailable: isNativeAvailable,
  getLoadError: getNativeLoadError,
  getVersion: getNativeVersion,
  getSupportedLanguages,
  scan,
  parse,
  buildCallGraph,
  scanBoundaries,
  analyzeCoupling,
  analyzeTestTopology,
  analyzeErrorHandling,
  analyzeReachability,
  analyzeInverseReachability,
  // SQLite-backed reachability (recommended for large codebases)
  analyzeReachabilitySqlite,
  analyzeInverseReachabilitySqlite,
  isCallGraphAvailable,
  getCallGraphStats,
  getCallGraphEntryPoints,
  getCallGraphDataAccessors,
  analyzeUnified,
  analyzeConstants,
  analyzeEnvironment,
  analyzeWrappers,
};

// ============================================================================
// Native Adapters with TypeScript Fallback
// ============================================================================

// Re-export adapters that provide native-first with TypeScript fallback
export {
  parseWithFallback,
  analyzeCouplingWithFallback,
  analyzeTestTopologyWithFallback,
  analyzeErrorHandlingWithFallback,
  analyzeConstantsWithFallback,
  analyzeEnvironmentWithFallback,
  analyzeWrappersWithFallback,
  scanBoundariesWithFallback,
  nativeAdapters,
} from './native-adapters.js';
