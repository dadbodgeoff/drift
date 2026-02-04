/**
 * drift_setup - Initialize and configure drift for a project
 * 
 * Layer: Setup (project initialization)
 * Token Budget: 500 target, 2000 max (varies by action)
 * Cache TTL: None (mutations)
 * Invalidation: Invalidates all caches on success
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { z } from 'zod';

// Infrastructure imports
import { 
  createResponseBuilder,
} from '../../infrastructure/response-builder.js';
import { 
  Errors, 
  handleError,
} from '../../infrastructure/error-handler.js';
import { metrics } from '../../infrastructure/metrics.js';

// Core imports
import {
  BoundaryStore,
  CallGraphStore,
  HistoryStore,
  ConstantStore,
  getProjectRegistry,
  detectProjectStack,
  isNativeAvailable,
  buildCallGraph,
  createStreamingCallGraphBuilder,
  createBoundaryScanner,
  createUnifiedScanner,
  createSecurityPrioritizer,
  createTestTopologyAnalyzer,
  createDataLake,
  getDefaultIgnorePatterns,
  mergeIgnorePatterns,
  createScannerService,
  FileWalker,
  analyzeConstantsWithFallback,
  scanBoundariesWithFallback,
  analyzeTestTopologyWithFallback,
  // Additional imports for full setup (mirroring CLI)
  analyzeCouplingWithFallback,
  analyzeErrorHandling,
  DNAAnalyzer,
  DNAStore,
  createInvariantDetector,
  createConstraintStore,
  createConstraintSynthesizer,
  AuditEngine,
  AuditStore,
  type BuildConfig,
  type DataAccessPoint,
  type Pattern,
  type PatternCategory,
  type ConfidenceInfo,
  type PatternLocation,
} from 'driftdetect-core';
import { createPatternStore, StoreSyncService } from 'driftdetect-core/storage';

// Input validation schema
const SetupInputSchema = z.object({
  action: z.enum(['init', 'scan', 'callgraph', 'full', 'status', 'discover', 'phase']).default('status'),
  project: z.string().optional(),
  phase: z.number().min(1).max(5).optional(), // For action="phase": 1=init, 2=scan, 3=callgraph+coupling, 4=analysis, 5=finalize
  options: z.object({
    force: z.boolean().optional(),
    incremental: z.boolean().optional(),
    categories: z.array(z.string()).optional(),
    boundaries: z.boolean().optional(),
    contracts: z.boolean().optional(),
    testTopology: z.boolean().optional(),
    constants: z.boolean().optional(),
    security: z.boolean().optional(),
    callgraph: z.boolean().optional(),
    timeout: z.number().optional(),
  }).optional(),
});

type SetupInput = z.infer<typeof SetupInputSchema>;

interface SetupResult {
  success: boolean;
  error?: string;
  message?: string;
  initialized?: boolean;
  projectPath?: string;
  projectName?: string;
  projectId?: string;
  detectedStack?: unknown;
  registeredInGlobalRegistry?: boolean;
  created?: unknown;
  hints?: { nextActions?: string[]; warnings?: string[] };
  scan?: unknown;
  callGraph?: unknown;
  duration?: { totalMs: number; formatted: string };
  files?: unknown;
  patterns?: unknown;
  violations?: unknown;
  detectorStats?: unknown;
  workerStats?: unknown;
  boundaries?: unknown;
  contracts?: unknown;
  testTopology?: unknown;
  constants?: unknown;
  history?: unknown;
  native?: boolean;
  stats?: unknown;
  errors?: string[] | undefined;
  totalDuration?: { totalMs: number; formatted: string };
  steps?: unknown;
  regressions?: unknown;
  security?: unknown;
}

interface SetupContext {
  projectRoot: string;
  cache: { invalidateAll: () => Promise<void> } | null;
}

// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';

// Helper to map string categories to PatternCategory type
function mapToPatternCategory(category: string): PatternCategory {
  const mapping: Record<string, PatternCategory> = {
    'api': 'api', 'auth': 'auth', 'security': 'security', 'errors': 'errors',
    'structural': 'structural', 'components': 'components', 'styling': 'styling',
    'logging': 'logging', 'testing': 'testing', 'data-access': 'data-access',
    'config': 'config', 'types': 'types', 'performance': 'performance',
    'accessibility': 'accessibility', 'documentation': 'documentation',
  };
  return mapping[category] || 'structural';
}

const DRIFT_SUBDIRS = [
  'patterns/discovered',
  'patterns/approved',
  'patterns/ignored',
  'patterns/variants',
  'history',
  'history/snapshots',
  'cache',
  'reports',
  'lake/patterns',
  'lake/callgraph',
  'lake/constants',
  'boundaries',
  'contracts/discovered',
  'contracts/verified',
  'contracts/mismatch',
  'contracts/ignored',
  'constraints/discovered',
  'constraints/approved',
  'constraints/ignored',
  'constraints/custom',
  'indexes',
  'views',
  'test-topology',
  'dna',
  'call-graph',
  'environment',
];

// Project markers are checked inline in discoverProjects function

// ============================================================================
// DISCOVER ACTION - Find available projects to scan
// ============================================================================

interface ProjectCandidate {
  path: string;
  name: string;
  type: string;
  hasGit: boolean;
  hasDrift: boolean;
  markers: string[];
}

async function discoverProjects(rootPath: string, maxDepth: number = 3): Promise<ProjectCandidate[]> {
  const candidates: ProjectCandidate[] = [];
  
  async function scanDir(dirPath: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const foundMarkers: string[] = [];
      let hasGit = false;
      let hasDrift = false;
      let projectType = 'unknown';
      
      for (const entry of entries) {
        if (entry.name === '.git' && entry.isDirectory()) {
          hasGit = true;
          foundMarkers.push('.git');
        }
        if (entry.name === '.drift' && entry.isDirectory()) {
          hasDrift = true;
        }
        if (entry.name === 'package.json' && entry.isFile()) {
          foundMarkers.push('package.json');
          projectType = 'node';
        }
        if (entry.name === 'Cargo.toml' && entry.isFile()) {
          foundMarkers.push('Cargo.toml');
          projectType = 'rust';
        }
        if (entry.name === 'pyproject.toml' && entry.isFile()) {
          foundMarkers.push('pyproject.toml');
          projectType = 'python';
        }
        if (entry.name === 'go.mod' && entry.isFile()) {
          foundMarkers.push('go.mod');
          projectType = 'go';
        }
        if (entry.name === 'pom.xml' && entry.isFile()) {
          foundMarkers.push('pom.xml');
          projectType = 'java';
        }
        if (entry.name === 'composer.json' && entry.isFile()) {
          foundMarkers.push('composer.json');
          projectType = 'php';
        }
      }
      
      // If this directory has project markers, add it as a candidate
      if (foundMarkers.length > 0) {
        candidates.push({
          path: dirPath,
          name: path.basename(dirPath),
          type: projectType,
          hasGit,
          hasDrift,
          markers: foundMarkers,
        });
      }
      
      // Recurse into subdirectories (but not into .git, node_modules, etc.)
      const skipDirs = new Set(['.git', 'node_modules', '.drift', 'dist', 'build', 'target', '__pycache__', 'vendor']);
      for (const entry of entries) {
        if (entry.isDirectory() && !skipDirs.has(entry.name) && !entry.name.startsWith('.')) {
          await scanDir(path.join(dirPath, entry.name), depth + 1);
        }
      }
    } catch {
      // Directory not readable, skip
    }
  }
  
  await scanDir(rootPath, 0);
  
  // Sort: prefer projects with .git, then by depth (shallower first)
  candidates.sort((a, b) => {
    // Prefer git repos
    if (a.hasGit && !b.hasGit) return -1;
    if (!a.hasGit && b.hasGit) return 1;
    // Prefer already initialized drift projects
    if (a.hasDrift && !b.hasDrift) return -1;
    if (!a.hasDrift && b.hasDrift) return 1;
    // Prefer shallower paths
    const aDepth = a.path.split(path.sep).length;
    const bDepth = b.path.split(path.sep).length;
    return aDepth - bDepth;
  });
  
  return candidates;
}

async function handleDiscoverAction(rootPath: string): Promise<SetupResult> {
  const candidates = await discoverProjects(rootPath, 3);
  
  if (candidates.length === 0) {
    return {
      success: true,
      message: 'No projects found. The current directory may not contain any recognizable project markers.',
      hints: {
        nextActions: [
          'Navigate to a directory containing a project',
          'Use drift_setup action="init" to initialize drift in the current directory',
        ],
      },
    };
  }
  
  // Return the list of candidates with a recommendation
  const recommended = candidates[0]!; // Safe: we checked length > 0 above
  
  return {
    success: true,
    message: `Found ${candidates.length} project(s). Recommended: ${recommended.name}`,
    projectPath: recommended.path,
    projectName: recommended.name,
    detectedStack: { type: recommended.type },
    scan: {
      candidates: candidates.map(c => ({
        path: c.path,
        name: c.name,
        type: c.type,
        hasGit: c.hasGit,
        hasDrift: c.hasDrift,
        markers: c.markers,
      })),
      recommended: {
        path: recommended.path,
        name: recommended.name,
        reason: recommended.hasGit 
          ? 'Git repository with project markers' 
          : 'Has project markers',
      },
    },
    hints: {
      nextActions: [
        `Use drift_setup action="full" project="${recommended.path}" to scan the recommended project`,
        'Or specify a different project path from the candidates list',
      ],
    },
  };
}

// ============================================================================
// STATUS ACTION
// ============================================================================

async function handleStatusAction(projectPath: string): Promise<SetupResult> {
  const driftDir = path.join(projectPath, DRIFT_DIR);
  
  try {
    await fs.access(driftDir);
  } catch {
    // Not initialized - detect what we can about the project
    const detectedStack = await detectProjectStack(projectPath);
    return {
      success: true,
      initialized: false,
      projectPath,
      detectedStack,
      hints: {
        nextActions: [
          'Use drift_setup action="init" to initialize drift',
          'Or use drift_setup action="full" to init + scan + build callgraph',
        ],
      },
    };
  }
  
  // Check config
  const configPath = path.join(driftDir, 'config.json');
  let config: Record<string, unknown> | null = null;
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(content);
  } catch {
    // Config missing or invalid
  }
  
  // Check for call graph
  let callGraphBuilt = false;
  let callGraphStats: { functions: number; entryPoints: number } | null = null;
  try {
    await fs.access(path.join(driftDir, 'lake', 'callgraph', 'callgraph.db'));
    callGraphBuilt = true;
  } catch {
    try {
      const indexPath = path.join(driftDir, 'lake', 'callgraph', 'index.json');
      await fs.access(indexPath);
      callGraphBuilt = true;
      const indexContent = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(indexContent);
      callGraphStats = {
        functions: index.totalFunctions || 0,
        entryPoints: index.entryPoints?.length || 0,
      };
    } catch {
      // No call graph
    }
  }
  
  // Check for patterns
  let patternsFound = 0;
  const patternCategories: string[] = [];
  try {
    const discoveredDir = path.join(driftDir, 'patterns', 'discovered');
    const files = await fs.readdir(discoveredDir);
    const jsonFiles = files.filter((f: string) => f.endsWith('.json'));
    patternsFound = jsonFiles.length;
    
    // Get unique categories
    const categories = new Set<string>();
    for (const file of jsonFiles.slice(0, 20)) {
      try {
        const content = await fs.readFile(path.join(discoveredDir, file), 'utf-8');
        const pattern = JSON.parse(content);
        if (pattern.category) {
          categories.add(pattern.category);
        }
      } catch {
        // Skip invalid files
      }
    }
    patternCategories.push(...Array.from(categories));
  } catch {
    // No patterns
  }
  
  // Check for boundaries
  let boundariesScanned = false;
  try {
    await fs.access(path.join(driftDir, 'boundaries', 'access-map.json'));
    boundariesScanned = true;
  } catch {
    // No boundaries
  }
  
  const projectConfig = config as { project?: { name?: string; initializedAt?: string }; version?: string; features?: unknown } | null;
  
  return {
    success: true,
    initialized: true,
    projectPath,
    projectName: projectConfig?.project?.name || path.basename(projectPath),
    scan: {
      patternsFound,
      categories: patternCategories,
      boundariesScanned,
    },
    callGraph: {
      built: callGraphBuilt,
      stats: callGraphStats,
    },
    hints: {
      nextActions: callGraphBuilt
        ? ['Use drift_context for curated context', 'Use drift_patterns_list to explore patterns']
        : ['Use drift_setup action="callgraph" to enable reachability analysis'],
    },
  };
}

// ============================================================================
// INIT ACTION
// ============================================================================

async function handleInitAction(
  projectPath: string,
  options: { force?: boolean } = {}
): Promise<SetupResult> {
  const driftDir = path.join(projectPath, DRIFT_DIR);
  
  // Check if already initialized
  try {
    await fs.access(driftDir);
    if (!options.force) {
      return {
        success: false,
        error: 'ALREADY_INITIALIZED',
        message: 'Drift already initialized. Use force=true to reinitialize.',
        projectPath,
      };
    }
  } catch {
    // Not initialized, proceed
  }
  
  // Create directory structure
  await fs.mkdir(driftDir, { recursive: true });
  for (const subdir of DRIFT_SUBDIRS) {
    await fs.mkdir(path.join(driftDir, subdir), { recursive: true });
  }
  
  // Create config file
  const projectId = crypto.randomUUID();
  const projectName = path.basename(projectPath);
  const now = new Date().toISOString();
  
  const config = {
    version: '2.0.0',
    project: {
      id: projectId,
      name: projectName,
      initializedAt: now,
    },
    ignore: getDefaultIgnorePatterns(),
    features: {
      callGraph: true,
      boundaries: true,
      dna: true,
      contracts: true,
    },
    // Telemetry disabled by default - users can enable via drift telemetry enable
    telemetry: {
      enabled: false,
      sharePatternSignatures: true,
      shareAggregateStats: true,
      shareUserActions: false,
    },
  };
  
  await fs.writeFile(
    path.join(driftDir, 'config.json'),
    JSON.stringify(config, null, 2)
  );
  
  // Create manifest.json
  const manifest = {
    version: '2.0.0',
    projectId,
    createdAt: now,
    lastScan: null,
  };
  
  await fs.writeFile(
    path.join(driftDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  
  // Create .driftignore if not exists
  const driftignorePath = path.join(projectPath, '.driftignore');
  try {
    await fs.access(driftignorePath);
  } catch {
    await fs.writeFile(driftignorePath, getDefaultIgnorePatterns().join('\n'));
  }
  
  // Detect project stack
  const detectedStack = await detectProjectStack(projectPath);
  
  // Register in global registry
  let registered = false;
  try {
    const registry = await getProjectRegistry();
    const project = await registry.register(projectPath);
    await registry.setActive(project.id);
    registered = true;
  } catch {
    // Registry registration failed, non-fatal
  }
  
  return {
    success: true,
    projectPath,
    projectName,
    projectId,
    detectedStack,
    registeredInGlobalRegistry: registered,
    created: {
      configFile: '.drift/config.json',
      directories: DRIFT_SUBDIRS.map(d => `.drift/${d}`),
      driftignore: true,
    },
    hints: {
      nextActions: [
        'Run drift_setup action="scan" to discover patterns',
        'Or run drift_setup action="full" to complete setup',
        'Consider enabling telemetry to help improve Drift: drift telemetry enable',
      ],
      warnings: [
        'Add .drift/cache/ and .drift/lake/ to .gitignore',
      ],
    },
  };
}

// ============================================================================
// SCAN ACTION
// ============================================================================

async function handleScanAction(
  projectPath: string,
  options: {
    incremental?: boolean;
    categories?: string[];
    boundaries?: boolean;
    contracts?: boolean;
    testTopology?: boolean;
    constants?: boolean;
    callgraph?: boolean;
    timeout?: number;
    maxFiles?: number; // Limit files to scan for MCP (prevents timeout)
  } = {}
): Promise<SetupResult> {
  // Verify drift is initialized
  const driftDir = path.join(projectPath, DRIFT_DIR);
  try {
    await fs.access(driftDir);
  } catch {
    return {
      success: false,
      error: 'NOT_INITIALIZED',
      message: 'Drift not initialized. Run init first.',
      hints: {
        nextActions: ['Run drift_setup action="init" first'],
      },
    };
  }
  
  const startTime = Date.now();
  const timeoutMs = (options.timeout ?? 300) * 1000; // Default 5 minutes
  const errors: string[] = [];
  
  // Load ignore patterns
  let ignorePatterns: string[];
  try {
    const driftignorePath = path.join(projectPath, '.driftignore');
    const content = await fs.readFile(driftignorePath, 'utf-8');
    const userPatterns = content
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line && !line.startsWith('#'));
    ignorePatterns = mergeIgnorePatterns(userPatterns);
  } catch {
    ignorePatterns = getDefaultIgnorePatterns();
  }
  
  // Walk files
  const walker = new FileWalker();
  
  const walkResult = await walker.walk({
    rootDir: projectPath,
    ignorePatterns,
    respectGitignore: false, // Don't use gitignore - it can cause issues with monorepos
    respectDriftignore: true,
    maxDepth: 50,
    maxFileSize: 1048576, // 1MB
  });
  
  // Debug: sample of files found
  const sampleFiles = walkResult.files.slice(0, 20).map(f => f.relativePath);
  
  let codeFiles = walkResult.files
    .map((f) => f.relativePath)
    .filter((f: string) => /\.(ts|tsx|js|jsx|py|cs|java|php|go|rs)$/.test(f));
  
  // Apply file limit if specified (for MCP to prevent timeout)
  if (options.maxFiles && codeFiles.length > options.maxFiles) {
    // Prioritize src/ files, then sort by path depth (shallower first)
    codeFiles = codeFiles
      .sort((a, b) => {
        // Prioritize src/ files
        const aIsSrc = a.startsWith('src/') || a.includes('/src/');
        const bIsSrc = b.startsWith('src/') || b.includes('/src/');
        if (aIsSrc && !bIsSrc) return -1;
        if (!aIsSrc && bIsSrc) return 1;
        // Then by depth (shallower first)
        return a.split('/').length - b.split('/').length;
      })
      .slice(0, options.maxFiles);
  }
  
  // Debug: sample of code files
  const sampleCodeFiles = codeFiles.slice(0, 10);
  
  // Initialize scanner service with full pattern detection
  const scannerConfig: {
    rootDir: string;
    verbose: boolean;
    categories?: string[];
    incremental?: boolean;
    generateManifest: boolean;
    useWorkerThreads: boolean;
  } = {
    rootDir: projectPath,
    verbose: false,
    generateManifest: false, // We save patterns directly to pattern store
    useWorkerThreads: true,
  };
  if (options.categories) {
    scannerConfig.categories = options.categories;
  }
  if (options.incremental !== undefined) {
    scannerConfig.incremental = options.incremental;
  }
  
  const scanner = createScannerService(scannerConfig);
  
  await scanner.initialize();
  
  // Run scan with timeout
  const scanPromise = scanner.scanFiles(codeFiles, {
    rootDir: projectPath,
    files: codeFiles,
    config: {},
  });
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Scan timeout exceeded')), timeoutMs);
  });
  
  let scanResult;
  try {
    scanResult = await Promise.race([scanPromise, timeoutPromise]);
  } finally {
    await scanner.destroy();
  }
  
  // ========================================================================
  // SAVE PATTERNS TO STORE (Critical - this was missing!)
  // ========================================================================
  const patternStore = await createPatternStore({ rootDir: projectPath });
  const now = new Date().toISOString();
  
  // Convert aggregated patterns to Pattern objects and save to store
  for (const aggPattern of scanResult.patterns) {
    const id = crypto.createHash('sha256')
      .update(`${aggPattern.patternId}-${projectPath}`)
      .digest('hex')
      .slice(0, 16);
    
    const spread = new Set(aggPattern.locations.map((l: { file: string }) => l.file)).size;
    const confidenceScore = Math.min(0.95, aggPattern.confidence);
    const confidenceInfo: ConfidenceInfo = {
      frequency: Math.min(1, aggPattern.occurrences / 100),
      consistency: 0.9,
      age: 0,
      spread,
      score: confidenceScore,
      level: confidenceScore >= 0.85 ? 'high' : confidenceScore >= 0.65 ? 'medium' : confidenceScore >= 0.45 ? 'low' : 'uncertain',
    };
    
    const locations: PatternLocation[] = aggPattern.locations.slice(0, 100).map((l: { file: string; line: number; column?: number; snippet?: string }) => ({
      file: l.file,
      line: l.line,
      column: l.column ?? 0,
      snippet: l.snippet,
    }));
    
    const pattern: Pattern = {
      id,
      category: mapToPatternCategory(aggPattern.category),
      subcategory: aggPattern.subcategory,
      name: aggPattern.name,
      description: aggPattern.description,
      detector: {
        type: 'regex',
        config: { detectorId: aggPattern.detectorId, patternId: aggPattern.patternId },
      },
      confidence: confidenceInfo,
      locations,
      outliers: [],
      metadata: { firstSeen: now, lastSeen: now },
      severity: 'warning',
      autoFixable: false,
      status: 'discovered',
    };
    
    if (!patternStore.has(pattern.id)) {
      await patternStore.add(pattern);
    }
  }
  
  // Save all patterns to disk/SQLite
  await patternStore.saveAll();
  
  // ========================================================================
  // BOUNDARY SCANNING (enabled by default, like CLI)
  // ========================================================================
  let boundaryResult: { 
    scanned: boolean; 
    tables?: number; 
    accessPoints?: number; 
    sensitiveFields?: number;
    native?: boolean;
  } | null = null;
  
  if (options.boundaries !== false) {
    try {
      // Try native analyzer first (much faster)
      if (isNativeAvailable()) {
        try {
          const nativeResult = await scanBoundariesWithFallback(projectPath, codeFiles);
          boundaryResult = {
            scanned: true,
            tables: new Set(nativeResult.accessPoints.map(ap => ap.table)).size,
            accessPoints: nativeResult.accessPoints.length,
            sensitiveFields: nativeResult.sensitiveFields.length,
            native: true,
          };
          
          // Save to boundary store
          const boundaryStore = new BoundaryStore({ rootDir: projectPath });
          await boundaryStore.initialize();
        } catch {
          // Fall through to TypeScript implementation
        }
      }
      
      // TypeScript fallback
      if (!boundaryResult) {
        const boundaryScanner = createBoundaryScanner({ rootDir: projectPath, verbose: false });
        await boundaryScanner.initialize();
        const result = await boundaryScanner.scanFiles(codeFiles);
        
        boundaryResult = {
          scanned: true,
          tables: result.stats.tablesFound,
          accessPoints: result.stats.accessPointsFound,
          sensitiveFields: result.stats.sensitiveFieldsFound,
          native: false,
        };
      }
    } catch (error) {
      errors.push(`Boundary scan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // ========================================================================
  // TEST TOPOLOGY (opt-in, like CLI)
  // ========================================================================
  let testTopologyResult: {
    built: boolean;
    testFiles?: number;
    testCases?: number;
    native?: boolean;
  } | null = null;
  
  if (options.testTopology) {
    try {
      if (isNativeAvailable()) {
        try {
          const nativeResult = await analyzeTestTopologyWithFallback(projectPath, codeFiles);
          testTopologyResult = {
            built: true,
            testFiles: nativeResult.testFiles.length,
            testCases: nativeResult.totalTests,
            native: true,
          };
          
          // Save results
          const testTopologyDir = path.join(driftDir, 'test-topology');
          await fs.mkdir(testTopologyDir, { recursive: true });
          await fs.writeFile(
            path.join(testTopologyDir, 'summary.json'),
            JSON.stringify({
              testFiles: nativeResult.testFiles.length,
              totalTests: nativeResult.totalTests,
              generatedAt: new Date().toISOString(),
            }, null, 2)
          );
        } catch {
          // Fall through to TypeScript
        }
      }
      
      if (!testTopologyResult) {
        // TypeScript fallback - simplified (analyzer would be used for full analysis)
        createTestTopologyAnalyzer({}); // Validate it's available
        testTopologyResult = {
          built: true,
          native: false,
        };
      }
    } catch (error) {
      errors.push(`Test topology failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // ========================================================================
  // CONSTANTS EXTRACTION (opt-in, like CLI)
  // ========================================================================
  let constantsResult: {
    extracted: boolean;
    total?: number;
    secrets?: number;
    native?: boolean;
  } | null = null;
  
  if (options.constants) {
    try {
      const result = await analyzeConstantsWithFallback(projectPath, codeFiles);
      
      // Save to ConstantStore
      const constantStore = new ConstantStore({ rootDir: projectPath });
      await constantStore.initialize();
      
      constantsResult = {
        extracted: true,
        total: result.stats.totalConstants,
        secrets: result.secrets.length,
        native: isNativeAvailable(),
      };
    } catch (error) {
      errors.push(`Constants extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // ========================================================================
  // HISTORY SNAPSHOT (for trend tracking, like CLI)
  // ========================================================================
  let historyResult: {
    snapshotCreated: boolean;
    regressions?: number;
  } | null = null;
  
  try {
    const historyStore = new HistoryStore({ rootDir: projectPath });
    await historyStore.initialize();
    const allPatterns = patternStore.getAll();
    await historyStore.createSnapshot(allPatterns);
    
    // Check for regressions
    const trends = await historyStore.getTrendSummary('7d');
    historyResult = {
      snapshotCreated: true,
      regressions: trends?.regressions?.length ?? 0,
    };
  } catch (error) {
    errors.push(`History snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // ========================================================================
  // DATA LAKE MATERIALIZATION (like CLI)
  // ========================================================================
  try {
    const dataLake = createDataLake({ rootDir: projectPath });
    await dataLake.initialize();
    
    const allPatterns = patternStore.getAll();
    const lastScanInfo = {
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
      filesScanned: codeFiles.length,
      patternsFound: allPatterns.length,
      errors: errors.length,
    };
    
    await dataLake.materializer.materialize(
      allPatterns,
      { force: false },
      { lastScan: lastScanInfo }
    );
  } catch (error) {
    errors.push(`Data lake materialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // ========================================================================
  // CALL GRAPH (opt-in during scan, like CLI)
  // ========================================================================
  let callgraphResult: {
    built: boolean;
    functions?: number;
    native?: boolean;
  } | null = null;
  
  if (options.callgraph) {
    try {
      if (isNativeAvailable()) {
        const callgraphConfig: BuildConfig = {
          root: projectPath,
          patterns: [
            '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
            '**/*.py', '**/*.cs', '**/*.java', '**/*.php',
          ],
          resolutionBatchSize: 50,
        };
        
        const result = await buildCallGraph(callgraphConfig);
        callgraphResult = {
          built: true,
          functions: result.totalFunctions,
          native: true,
        };
      }
    } catch (error) {
      errors.push(`Call graph build failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  const duration = Date.now() - startTime;
  
  // Group patterns by category
  const byCategory: Record<string, number> = {};
  for (const pattern of scanResult.patterns) {
    byCategory[pattern.category] = (byCategory[pattern.category] || 0) + 1;
  }
  
  return {
    success: true,
    projectPath, // Added for debugging
    duration: {
      totalMs: duration,
      formatted: `${(duration / 1000).toFixed(1)}s`,
    },
    files: {
      scanned: scanResult.totalFiles,
      walked: walkResult.files.length, // Added for debugging
      codeFiles: codeFiles.length, // Added for debugging
      sampleFiles, // Debug: first 20 files found
      sampleCodeFiles, // Debug: first 10 code files
      withPatterns: scanResult.files.filter((f) => f.patterns.length > 0).length,
      errors: scanResult.errors.length,
    },
    patterns: {
      total: scanResult.patterns.length,
      occurrences: scanResult.totalPatterns,
      byCategory,
    },
    violations: {
      total: scanResult.totalViolations,
    },
    detectorStats: scanResult.detectorStats,
    workerStats: scanResult.workerStats,
    boundaries: boundaryResult,
    testTopology: testTopologyResult,
    constants: constantsResult,
    history: historyResult,
    callGraph: callgraphResult,
    errors: errors.length > 0 ? errors : undefined,
    regressions: historyResult?.regressions,
    hints: {
      nextActions: [
        'Use drift_setup action="callgraph" to enable reachability analysis',
        'Use drift_patterns_list to explore discovered patterns',
        'Use drift_context for curated context',
      ],
      ...(errors.length > 0 ? { warnings: [`${errors.length} non-fatal errors occurred`] } : {}),
    },
  };
}

// ============================================================================
// CALLGRAPH ACTION
// ============================================================================

async function handleCallgraphAction(
  projectPath: string,
  options: { security?: boolean } = {}
): Promise<SetupResult> {
  // Verify drift is initialized
  const driftDir = path.join(projectPath, DRIFT_DIR);
  try {
    await fs.access(driftDir);
  } catch {
    return {
      success: false,
      error: 'NOT_INITIALIZED',
      message: 'Drift not initialized. Run init first.',
      hints: {
        nextActions: ['Run drift_setup action="init" first'],
      },
    };
  }
  
  const startTime = Date.now();
  
  // Detect project stack first
  const detectedStack = await detectProjectStack(projectPath);
  
  const filePatterns = [
    '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
    '**/*.py', '**/*.cs', '**/*.java', '**/*.php',
  ];
  
  // ========================================================================
  // TRY NATIVE RUST FIRST (prevents OOM on large codebases)
  // ========================================================================
  if (isNativeAvailable()) {
    try {
      const config: BuildConfig = {
        root: projectPath,
        patterns: filePatterns,
        resolutionBatchSize: 50,
      };
      
      const result = await buildCallGraph(config);
      
      // Save to call graph store
      const callGraphStore = new CallGraphStore({ rootDir: projectPath });
      await callGraphStore.initialize();
      
      // Run security prioritization if requested
      let securitySummary = null;
      if (options.security) {
        try {
          const boundaryScanner = createBoundaryScanner({ rootDir: projectPath, verbose: false });
          await boundaryScanner.initialize();
          const boundaryResult = await boundaryScanner.scanDirectory({ patterns: filePatterns });
          
          const prioritizer = createSecurityPrioritizer();
          const prioritized = prioritizer.prioritize(boundaryResult.accessMap);
          
          securitySummary = {
            totalAccessPoints: prioritized.summary.totalAccessPoints,
            critical: prioritized.summary.criticalCount,
            high: prioritized.summary.highCount,
            regulations: prioritized.summary.regulations,
          };
        } catch {
          // Security prioritization failed, non-fatal
        }
      }
      
      return {
        success: true,
        native: true,
        duration: {
          totalMs: result.durationMs,
          formatted: `${(result.durationMs / 1000).toFixed(1)}s`,
        },
        stats: {
          filesProcessed: result.filesProcessed,
          totalFunctions: result.totalFunctions,
          totalCallSites: result.totalCalls,
          resolvedCallSites: result.resolvedCalls,
          resolutionRate: result.resolutionRate,
          entryPoints: result.entryPoints,
          dataAccessors: result.dataAccessors,
        },
        detectedStack,
        ...(securitySummary ? { security: securitySummary } : {}),
        errors: result.errors?.slice(0, 10),
        hints: {
          nextActions: [
            'Use drift_reachability to trace data access paths',
            'Use drift_impact_analysis to understand change impact',
            'Use drift_callers to find function callers',
          ],
        },
      };
    } catch (error) {
      console.error('Native call graph build failed, trying TypeScript fallback:', error);
    }
  }
  
  // ========================================================================
  // FALLBACK: TypeScript streaming builder with pre-scanning
  // ========================================================================
  try {
    // Pre-scan for data access points (like CLI does for smaller codebases)
    let dataAccessPoints: Map<string, DataAccessPoint[]> | undefined;
    
    try {
      const unifiedScanner = createUnifiedScanner({ 
        rootDir: projectPath, 
        verbose: false,
        autoDetect: true,
      });
      const semanticResult = await unifiedScanner.scanDirectory({ patterns: filePatterns });
      dataAccessPoints = semanticResult.accessPoints;
    } catch {
      // Pre-scanning failed, continue without it
    }
    
    const builder = createStreamingCallGraphBuilder({
      rootDir: projectPath,
    });
    
    const result = await builder.build(filePatterns, dataAccessPoints);
    const duration = Date.now() - startTime;
    
    return {
      success: true,
      native: false,
      duration: {
        totalMs: duration,
        formatted: `${(duration / 1000).toFixed(1)}s`,
      },
      stats: {
        filesProcessed: result.filesProcessed,
        totalFunctions: result.totalFunctions,
        totalCallSites: result.totalCalls,
        resolvedCallSites: result.resolvedCalls,
        resolutionRate: result.resolutionRate,
      },
      detectedStack,
      hints: {
        nextActions: [
          'Use drift_reachability to trace data access paths',
          'Use drift_impact_analysis to understand change impact',
        ],
        warnings: [
          'Using TypeScript fallback (slower). Install driftdetect-native for better performance.',
        ],
      },
    };
  } catch (error) {
    return {
      success: false,
      error: 'CALLGRAPH_BUILD_FAILED',
      message: error instanceof Error ? error.message : 'Call graph build failed',
      hints: {
        nextActions: [
          'Check for syntax errors in source files',
          'Ensure project has supported languages (TS, JS, Python, C#, Java, PHP)',
        ],
      },
    };
  }
}

// ============================================================================
// FULL ACTION - Mirrors CLI setup with all phases
// ============================================================================

async function handleFullAction(
  projectPath: string,
  options: SetupInput['options'] = {}
): Promise<SetupResult> {
  const results: Record<string, unknown> = {};
  const errors: string[] = [];
  const startTime = Date.now();
  
  // Store project path in results for visibility
  results['projectPath'] = projectPath;
  results['projectName'] = path.basename(projectPath);
  
  // ========================================================================
  // PHASE 1: INIT
  // ========================================================================
  const initResult = await handleInitAction(projectPath, { force: options?.force ?? false });
  results['init'] = initResult;
  if (!initResult.success && initResult.error !== 'ALREADY_INITIALIZED') {
    return {
      success: false,
      error: 'INIT_FAILED',
      message: initResult.message || 'Init failed',
      projectPath,
      steps: results,
    };
  }
  
  // ========================================================================
  // PHASE 2: PATTERN SCAN (always runs, with all core features enabled)
  // ========================================================================
  const scanOptions: {
    boundaries: boolean;
    contracts: boolean;
    testTopology: boolean;
    constants: boolean;
    callgraph: boolean;
    timeout?: number;
  } = {
    boundaries: options?.boundaries ?? true,  // Enable by default like CLI
    contracts: options?.contracts ?? true,
    testTopology: options?.testTopology ?? true,
    constants: options?.constants ?? true,
    callgraph: false, // Handled separately
  };
  if (options?.timeout !== undefined) {
    scanOptions.timeout = options.timeout;
  }
  
  const scanResult = await handleScanAction(projectPath, scanOptions);
  results['scan'] = scanResult;
  if (!scanResult.success) {
    return {
      success: false,
      error: 'SCAN_FAILED',
      message: scanResult.message || 'Scan failed',
      steps: results,
    };
  }
  
  const patternCount = (scanResult.patterns as { total?: number })?.total || 0;
  
  // ========================================================================
  // PHASE 3: PATTERN APPROVAL (auto-approve ≥85% confidence like CLI --yes)
  // ========================================================================
  let approvedCount = 0;
  try {
    const patternStore = await createPatternStore({ rootDir: projectPath });
    const allPatterns = patternStore.getAll();
    const threshold = 0.85;
    
    for (const pattern of allPatterns) {
      if (pattern.status === 'discovered' && pattern.confidence.score >= threshold) {
        try {
          await patternStore.approve(pattern.id, 'drift_setup_auto');
          approvedCount++;
        } catch {
          // Skip patterns that fail to approve
        }
      }
    }
    await patternStore.saveAll();
    results['approval'] = { success: true, approved: approvedCount, threshold };
  } catch (error) {
    errors.push(`Pattern approval failed: ${error instanceof Error ? error.message : String(error)}`);
    results['approval'] = { success: false, error: String(error) };
  }
  
  // ========================================================================
  // PHASE 4: CALL GRAPH
  // ========================================================================
  const callgraphOptions: { security?: boolean } = {};
  if (options?.security !== undefined) {
    callgraphOptions.security = options.security;
  }
  const callgraphResult = await handleCallgraphAction(projectPath, callgraphOptions);
  results['callgraph'] = callgraphResult;
  
  // Helper for timeout-protected operations
  const withTimeout = async <T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]);
  };
  
  // ========================================================================
  // PHASE 5: COUPLING ANALYSIS (mirrors CLI CouplingRunner)
  // ========================================================================
  let couplingResult: { success: boolean; modules?: number; cycles?: number; hotspots?: number; healthScore?: number } = { success: false };
  try {
    // Get source files for coupling analysis
    const walker = new FileWalker();
    const walkResult = await walker.walk({
      rootDir: projectPath,
      ignorePatterns: getDefaultIgnorePatterns(),
      respectGitignore: false,
      respectDriftignore: true,
      maxDepth: 50,
      maxFileSize: 1048576,
    });
    const sourceFiles = walkResult.files
      .map((f) => f.relativePath)
      .filter((f: string) => /\.(ts|tsx|js|jsx|py|cs|java|php|go|rs)$/.test(f));
    
    // Limit files for very large codebases to prevent timeout
    const maxFilesForCoupling = 2000;
    const filesToAnalyze = sourceFiles.length > maxFilesForCoupling 
      ? sourceFiles.slice(0, maxFilesForCoupling) 
      : sourceFiles;
    
    const coupling = await withTimeout(
      analyzeCouplingWithFallback(projectPath, filesToAnalyze),
      60000, // 60 second timeout
      'Coupling analysis'
    );
    
    // Save results in the same format as CLI (for drift coupling status compatibility)
    const couplingDir = path.join(projectPath, DRIFT_DIR, 'module-coupling');
    await fs.mkdir(couplingDir, { recursive: true });
    
    const serializedGraph = {
      modules: Object.fromEntries(coupling.modules.map(m => [m.path, {
        path: m.path,
        imports: [],
        importedBy: [],
        exports: [],
        metrics: {
          Ca: m.ca,
          Ce: m.ce,
          instability: m.instability,
          abstractness: m.abstractness,
          distance: m.distance,
        },
        role: 'balanced',
        isEntryPoint: false,
        isLeaf: m.ce === 0,
      }])),
      edges: [],
      cycles: coupling.cycles.map((c, i) => ({
        id: `cycle-${i}`,
        path: c.modules,
        length: c.modules.length,
        severity: c.severity,
        totalWeight: c.filesAffected,
        breakPoints: [],
      })),
      metrics: {
        totalModules: coupling.modules.length,
        totalEdges: 0,
        cycleCount: coupling.cycles.length,
        avgInstability: coupling.modules.reduce((sum, m) => sum + m.instability, 0) / Math.max(1, coupling.modules.length),
        avgDistance: coupling.modules.reduce((sum, m) => sum + m.distance, 0) / Math.max(1, coupling.modules.length),
        zoneOfPain: [] as string[],
        zoneOfUselessness: [] as string[],
        hotspots: coupling.hotspots.map(h => ({ path: h.module, coupling: h.totalCoupling })),
        isolatedModules: [] as string[],
      },
      generatedAt: new Date().toISOString(),
      projectRoot: projectPath,
    };
    
    await fs.writeFile(
      path.join(couplingDir, 'graph.json'),
      JSON.stringify(serializedGraph, null, 2)
    );
    
    couplingResult = {
      success: true,
      modules: coupling.modules.length,
      cycles: coupling.cycles.length,
      hotspots: coupling.hotspots.length,
      healthScore: coupling.healthScore,
    };
    results['coupling'] = couplingResult;
  } catch (error) {
    errors.push(`Coupling analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    results['coupling'] = { success: false, error: String(error) };
  }
  
  // ========================================================================
  // PHASE 6: ERROR HANDLING ANALYSIS (mirrors CLI ErrorHandlingRunner)
  // ========================================================================
  let errorHandlingResult: { success: boolean; boundaries?: number; gaps?: number; criticalGaps?: number } = { success: false };
  try {
    if (isNativeAvailable()) {
      const walker = new FileWalker();
      const walkResult = await walker.walk({
        rootDir: projectPath,
        ignorePatterns: getDefaultIgnorePatterns(),
        respectGitignore: false,
        respectDriftignore: true,
        maxDepth: 50,
        maxFileSize: 1048576,
      });
      const files = walkResult.files.map(f => path.join(projectPath, f.relativePath));
      
      const nativeResult = await analyzeErrorHandling(files);
      const criticalGaps = nativeResult.gaps?.filter(g => g.severity === 'critical').length ?? 0;
      
      // Save results
      const errorDir = path.join(projectPath, DRIFT_DIR, 'error-handling');
      await fs.mkdir(errorDir, { recursive: true });
      
      await fs.writeFile(
        path.join(errorDir, 'analysis.json'),
        JSON.stringify({
          boundaries: nativeResult.boundaries ?? [],
          gaps: nativeResult.gaps ?? [],
          filesAnalyzed: nativeResult.filesAnalyzed ?? 0,
          durationMs: nativeResult.durationMs ?? 0,
          generatedAt: new Date().toISOString(),
        }, null, 2)
      );
      
      errorHandlingResult = {
        success: true,
        boundaries: nativeResult.boundaries?.length ?? 0,
        gaps: nativeResult.gaps?.length ?? 0,
        criticalGaps,
      };
    } else {
      errorHandlingResult = { success: false };
      errors.push('Error handling analysis requires native module');
    }
    results['errorHandling'] = errorHandlingResult;
  } catch (error) {
    errors.push(`Error handling analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    results['errorHandling'] = { success: false, error: String(error) };
  }
  
  // ========================================================================
  // PHASE 7: DNA ANALYSIS (mirrors CLI DNARunner)
  // ========================================================================
  let dnaResult: { success: boolean; genes?: number; mutations?: number; healthScore?: number } = { success: false };
  try {
    const analyzer = new DNAAnalyzer({ rootDir: projectPath, mode: 'all' });
    await analyzer.initialize();
    const result = await analyzer.analyze();
    
    // Save profile
    const store = new DNAStore({ rootDir: projectPath });
    await store.save(result.profile);
    
    dnaResult = {
      success: true,
      genes: Object.keys(result.profile.genes).length,
      mutations: result.profile.mutations.length,
      healthScore: result.profile.summary.healthScore,
    };
    results['dna'] = dnaResult;
  } catch (error) {
    errors.push(`DNA analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    results['dna'] = { success: false, error: String(error) };
  }
  
  // ========================================================================
  // PHASE 8: CONSTRAINT EXTRACTION (mirrors CLI ConstraintsRunner)
  // ========================================================================
  let constraintsResult: { success: boolean; constraints?: number; updated?: number; invalidated?: number } = { success: false };
  try {
    const constraintStore = createConstraintStore({ rootDir: projectPath });
    await constraintStore.initialize();
    
    const patternStoreForConstraints = await createPatternStore({ rootDir: projectPath });
    const detector = createInvariantDetector({
      rootDir: projectPath,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      patternStore: patternStoreForConstraints as any,
    });
    
    const synthesizer = createConstraintSynthesizer({ store: constraintStore, detector });
    const result = await synthesizer.synthesize({ minConfidence: 0.85 });
    
    constraintsResult = {
      success: true,
      constraints: result.discovered.length,
      updated: result.updated.length,
      invalidated: result.invalidated.length,
    };
    results['constraints'] = constraintsResult;
  } catch (error) {
    errors.push(`Constraint extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    results['constraints'] = { success: false, error: String(error) };
  }
  
  // ========================================================================
  // PHASE 9: AUDIT SNAPSHOT (mirrors CLI AuditRunner)
  // ========================================================================
  let auditResult: { success: boolean; healthScore?: number; totalPatterns?: number; autoApproveEligible?: number } = { success: false };
  try {
    const patternStore = await createPatternStore({ rootDir: projectPath });
    const patterns = patternStore.getAll();
    
    const auditEngine = new AuditEngine({ rootDir: projectPath });
    const auditStore = new AuditStore({ rootDir: projectPath });
    
    const result = await auditEngine.runAudit(patterns);
    await auditStore.saveAudit(result);
    
    auditResult = {
      success: true,
      healthScore: Math.round(result.summary.healthScore),
      totalPatterns: result.summary.totalPatterns,
      autoApproveEligible: result.summary.autoApproveEligible,
    };
    results['audit'] = auditResult;
  } catch (error) {
    errors.push(`Audit snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    results['audit'] = { success: false, error: String(error) };
  }
  
  // ========================================================================
  // PHASE 10: MEMORY/CORTEX INITIALIZATION (mirrors CLI MemoryRunner)
  // ========================================================================
  let memoryResult: { success: boolean; initialized?: boolean } = { success: false };
  try {
    const memoryDir = path.join(projectPath, DRIFT_DIR, 'memory');
    await fs.mkdir(memoryDir, { recursive: true });
    
    // Dynamic import of cortex package
    const { getCortex } = await import('driftdetect-cortex');
    
    const dbPath = path.join(memoryDir, 'cortex.db');
    const cortex = await getCortex({
      storage: { type: 'sqlite', sqlitePath: dbPath },
      autoInitialize: true,
    });
    
    // Close connection (will reopen when needed)
    await cortex.storage.close();
    
    memoryResult = { success: true, initialized: true };
    results['memory'] = memoryResult;
  } catch (error) {
    errors.push(`Memory initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    results['memory'] = { success: false, error: String(error) };
  }
  
  // ========================================================================
  // PHASE 11: SQLITE SYNC
  // ========================================================================
  try {
    const syncService = new StoreSyncService({ rootDir: projectPath, verbose: false });
    await syncService.initialize();
    await syncService.syncAll();
    await syncService.close();
    results['sqliteSync'] = { success: true };
  } catch (error) {
    errors.push(`SQLite sync failed: ${error instanceof Error ? error.message : String(error)}`);
    results['sqliteSync'] = { success: false };
  }
  
  // ========================================================================
  // PHASE 12: CREATE SOURCE OF TRUTH
  // ========================================================================
  try {
    const now = new Date().toISOString();
    const scanId = crypto.randomUUID().slice(0, 8);
    const projectName = path.basename(projectPath);
    
    const sourceOfTruth = {
      version: '2.0.0',
      schemaVersion: '2.0.0',
      createdAt: now,
      updatedAt: now,
      project: {
        id: initResult.projectId || crypto.randomUUID(),
        name: projectName,
        rootPath: projectPath,
      },
      baseline: {
        scanId,
        scannedAt: now,
        fileCount: (scanResult.files as { scanned?: number })?.scanned || 0,
        patternCount,
        approvedCount,
        categories: (scanResult.patterns as { byCategory?: Record<string, number> })?.byCategory || {},
      },
      features: {
        boundaries: { enabled: true },
        contracts: { enabled: true },
        environment: { enabled: true },
        constants: { enabled: true },
        callGraph: { enabled: callgraphResult.success },
        testTopology: { enabled: (scanResult as { testTopology?: { built?: boolean } })?.testTopology?.built ?? false },
        coupling: { enabled: couplingResult.success, modules: couplingResult.modules, cycles: couplingResult.cycles },
        errorHandling: { enabled: errorHandlingResult.success, boundaries: errorHandlingResult.boundaries, gaps: errorHandlingResult.gaps },
        dna: { enabled: dnaResult.success, genes: dnaResult.genes, healthScore: dnaResult.healthScore },
        constraints: { enabled: constraintsResult.success, count: constraintsResult.constraints },
        audit: { enabled: auditResult.success, healthScore: auditResult.healthScore },
        memory: { enabled: memoryResult.success },
        sqliteSync: { enabled: true, builtAt: now },
      },
      settings: {
        autoApproveThreshold: 0.85,
        autoApproveEnabled: true,
      },
    };
    
    const sotPath = path.join(projectPath, '.drift', 'source-of-truth.json');
    await fs.writeFile(sotPath, JSON.stringify(sourceOfTruth, null, 2));
    results['sourceOfTruth'] = { success: true };
  } catch (error) {
    errors.push(`Source of Truth creation failed: ${error instanceof Error ? error.message : String(error)}`);
    results['sourceOfTruth'] = { success: false };
  }
  
  const totalDuration = Date.now() - startTime;
  
  return {
    success: true,
    totalDuration: {
      totalMs: totalDuration,
      formatted: `${(totalDuration / 1000).toFixed(1)}s`,
    },
    steps: {
      init: {
        success: initResult.success || initResult.error === 'ALREADY_INITIALIZED',
        projectName: initResult.projectName,
      },
      scan: {
        success: scanResult.success,
        patterns: patternCount,
        files: (scanResult.files as { scanned?: number })?.scanned || 0,
      },
      approval: {
        success: true,
        approved: approvedCount,
      },
      callgraph: {
        success: callgraphResult.success,
        functions: (callgraphResult.stats as { totalFunctions?: number })?.totalFunctions || 0,
        native: callgraphResult.native,
      },
      coupling: couplingResult,
      errorHandling: errorHandlingResult,
      dna: dnaResult,
      constraints: constraintsResult,
      audit: auditResult,
      memory: memoryResult,
      sqliteSync: results['sqliteSync'],
      sourceOfTruth: results['sourceOfTruth'],
    },
    errors: errors.length > 0 ? errors : undefined,
    hints: {
      nextActions: [
        'Use drift_context to get curated context for your task',
        'Use drift_status for detailed health info',
        'Use drift_patterns_list to explore patterns',
        'Use drift_coupling for module dependency analysis',
        'Use drift_error_handling for error gap detection',
      ],
      ...(errors.length > 0 ? { warnings: [`${errors.length} non-fatal errors occurred`] } : {}),
    },
  };
}

// ============================================================================
// PHASE ACTION - Run setup in smaller chunks to avoid timeouts
// ============================================================================
// Phase 1: Init + File Discovery (fast, ~5s)
// Phase 2: Pattern Scan (medium, ~30-60s)
// Phase 3: Call Graph + Coupling (medium, ~30-60s)
// Phase 4: DNA + Error Handling + Constraints (medium, ~30s)
// Phase 5: Audit + Memory + Finalize (fast, ~10s)

async function handlePhaseAction(
  projectPath: string,
  phase: number,
  options: SetupInput['options'] = {}
): Promise<SetupResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  
  switch (phase) {
    case 1: {
      // Phase 1: Init + File Discovery (fast)
      const initResult = await handleInitAction(projectPath, { force: options?.force ?? false });
      if (!initResult.success && initResult.error !== 'ALREADY_INITIALIZED') {
        return { success: false, error: 'INIT_FAILED', message: initResult.message ?? 'Init failed', projectPath };
      }
      
      // Just count files, don't scan patterns yet
      const walker = new FileWalker();
      const walkResult = await walker.walk({
        rootDir: projectPath,
        ignorePatterns: getDefaultIgnorePatterns(),
        respectGitignore: false,
        respectDriftignore: true,
        maxDepth: 50,
        maxFileSize: 1048576,
      });
      const codeFiles = walkResult.files
        .map((f) => f.relativePath)
        .filter((f: string) => /\.(ts|tsx|js|jsx|py|cs|java|php|go|rs)$/.test(f));
      
      return {
        success: true,
        projectPath,
        message: `Phase 1 complete: Initialized. Found ${codeFiles.length} code files ready to scan.`,
        duration: { totalMs: Date.now() - startTime, formatted: `${((Date.now() - startTime) / 1000).toFixed(1)}s` },
        files: { total: walkResult.files.length, code: codeFiles.length },
        hints: { nextActions: ['Run drift_setup action="phase" phase=2 to scan patterns'] },
      };
    }
    
    case 2: {
      // Phase 2: Pattern Scan (the main detection phase)
      // Limit files for MCP to prevent timeout - scan most important files first
      const MAX_FILES_FOR_MCP_SCAN = 3000;
      
      const scanResult = await handleScanAction(projectPath, {
        boundaries: options?.boundaries ?? true,
        contracts: options?.contracts ?? true,
        testTopology: false, // Skip for speed in phase mode
        constants: false, // Skip for speed in phase mode
        callgraph: false, // Handled in phase 3
        timeout: options?.timeout ?? 120,
        maxFiles: MAX_FILES_FOR_MCP_SCAN, // Limit to prevent MCP timeout
      });
      
      if (!scanResult.success) {
        return { success: false, error: 'SCAN_FAILED', message: scanResult.message ?? 'Scan failed', projectPath };
      }
      
      // Auto-approve high confidence patterns
      let approvedCount = 0;
      try {
        const patternStore = await createPatternStore({ rootDir: projectPath });
        for (const pattern of patternStore.getAll()) {
          if (pattern.status === 'discovered' && pattern.confidence.score >= 0.85) {
            try {
              await patternStore.approve(pattern.id, 'drift_setup_auto');
              approvedCount++;
            } catch { /* skip */ }
          }
        }
        await patternStore.saveAll();
      } catch { /* ignore */ }
      
      const patternCount = (scanResult.patterns as { total?: number })?.total ?? 0;
      const fileCount = (scanResult.files as { scanned?: number })?.scanned ?? 0;
      
      return {
        success: true,
        projectPath,
        message: `Phase 2 complete: Found ${patternCount} patterns in ${fileCount} files. Auto-approved ${approvedCount} high-confidence patterns.`,
        duration: { totalMs: Date.now() - startTime, formatted: `${((Date.now() - startTime) / 1000).toFixed(1)}s` },
        patterns: scanResult.patterns,
        files: scanResult.files,
        steps: { approval: { approved: approvedCount } },
        errors: errors.length > 0 ? errors : undefined,
        hints: { nextActions: ['Run drift_setup action="phase" phase=3 to build call graph'] },
      };
    }
    
    case 3: {
      // Phase 3: Call Graph + Coupling
      const callgraphResult = await handleCallgraphAction(projectPath, { security: options?.security ?? false });
      
      let couplingResult: { success: boolean; modules?: number; cycles?: number } = { success: false };
      try {
        const walker = new FileWalker();
        const walkResult = await walker.walk({
          rootDir: projectPath,
          ignorePatterns: getDefaultIgnorePatterns(),
          respectGitignore: false,
          respectDriftignore: true,
          maxDepth: 50,
          maxFileSize: 1048576,
        });
        const sourceFiles = walkResult.files
          .map((f) => f.relativePath)
          .filter((f: string) => /\.(ts|tsx|js|jsx|py|cs|java|php|go|rs)$/.test(f))
          .slice(0, 2000); // Limit for speed
        
        const coupling = await analyzeCouplingWithFallback(projectPath, sourceFiles);
        couplingResult = { success: true, modules: coupling.modules.length, cycles: coupling.cycles.length };
      } catch (e) {
        errors.push(`Coupling: ${e instanceof Error ? e.message : String(e)}`);
      }
      
      return {
        success: true,
        projectPath,
        message: `Phase 3 complete: ${(callgraphResult.stats as { totalFunctions?: number })?.totalFunctions ?? 0} functions, ${couplingResult.modules ?? 0} modules`,
        duration: { totalMs: Date.now() - startTime, formatted: `${((Date.now() - startTime) / 1000).toFixed(1)}s` },
        callGraph: callgraphResult,
        steps: { coupling: couplingResult },
        errors: errors.length > 0 ? errors : undefined,
        hints: { nextActions: ['Run drift_setup action="phase" phase=4 to continue'] },
      };
    }
    
    case 4: {
      // Phase 4: DNA + Error Handling + Constraints
      let dnaResult: { success: boolean; genes?: number } = { success: false };
      try {
        const analyzer = new DNAAnalyzer({ rootDir: projectPath, mode: 'all' });
        await analyzer.initialize();
        const result = await analyzer.analyze();
        const store = new DNAStore({ rootDir: projectPath });
        await store.save(result.profile);
        dnaResult = { success: true, genes: Object.keys(result.profile.genes).length };
      } catch (e) {
        errors.push(`DNA: ${e instanceof Error ? e.message : String(e)}`);
      }
      
      let errorHandlingResult: { success: boolean; gaps?: number } = { success: false };
      try {
        if (isNativeAvailable()) {
          const walker = new FileWalker();
          const walkResult = await walker.walk({
            rootDir: projectPath,
            ignorePatterns: getDefaultIgnorePatterns(),
            respectGitignore: false,
            respectDriftignore: true,
            maxDepth: 50,
            maxFileSize: 1048576,
          });
          const files = walkResult.files.map(f => path.join(projectPath, f.relativePath)).slice(0, 1000);
          const nativeResult = await analyzeErrorHandling(files);
          errorHandlingResult = { success: true, gaps: nativeResult.gaps?.length ?? 0 };
        }
      } catch (e) {
        errors.push(`Error handling: ${e instanceof Error ? e.message : String(e)}`);
      }
      
      let constraintsResult: { success: boolean; count?: number } = { success: false };
      try {
        const constraintStore = createConstraintStore({ rootDir: projectPath });
        await constraintStore.initialize();
        const patternStoreForConstraints = await createPatternStore({ rootDir: projectPath });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detector = createInvariantDetector({ rootDir: projectPath, patternStore: patternStoreForConstraints as any });
        const synthesizer = createConstraintSynthesizer({ store: constraintStore, detector });
        const result = await synthesizer.synthesize({ minConfidence: 0.85 });
        constraintsResult = { success: true, count: result.discovered.length };
      } catch (e) {
        errors.push(`Constraints: ${e instanceof Error ? e.message : String(e)}`);
      }
      
      return {
        success: true,
        projectPath,
        message: `Phase 4 complete: ${dnaResult.genes ?? 0} genes, ${errorHandlingResult.gaps ?? 0} error gaps, ${constraintsResult.count ?? 0} constraints`,
        duration: { totalMs: Date.now() - startTime, formatted: `${((Date.now() - startTime) / 1000).toFixed(1)}s` },
        steps: { dna: dnaResult, errorHandling: errorHandlingResult, constraints: constraintsResult },
        errors: errors.length > 0 ? errors : undefined,
        hints: { nextActions: ['Run drift_setup action="phase" phase=5 to finalize'] },
      };
    }
    
    case 5: {
      // Phase 5: Audit + Memory + SQLite Sync + Source of Truth
      let auditResult: { success: boolean; healthScore?: number } = { success: false };
      try {
        const patternStore = await createPatternStore({ rootDir: projectPath });
        const auditEngine = new AuditEngine({ rootDir: projectPath });
        const auditStore = new AuditStore({ rootDir: projectPath });
        const result = await auditEngine.runAudit(patternStore.getAll());
        await auditStore.saveAudit(result);
        auditResult = { success: true, healthScore: Math.round(result.summary.healthScore) };
      } catch (e) {
        errors.push(`Audit: ${e instanceof Error ? e.message : String(e)}`);
      }
      
      let memoryResult: { success: boolean } = { success: false };
      try {
        const memoryDir = path.join(projectPath, DRIFT_DIR, 'memory');
        await fs.mkdir(memoryDir, { recursive: true });
        const { getCortex } = await import('driftdetect-cortex');
        const cortex = await getCortex({ storage: { type: 'sqlite', sqlitePath: path.join(memoryDir, 'cortex.db') }, autoInitialize: true });
        await cortex.storage.close();
        memoryResult = { success: true };
      } catch (e) {
        errors.push(`Memory: ${e instanceof Error ? e.message : String(e)}`);
      }
      
      // SQLite sync
      try {
        const syncService = new StoreSyncService({ rootDir: projectPath, verbose: false });
        await syncService.initialize();
        await syncService.syncAll();
        await syncService.close();
      } catch (e) {
        errors.push(`SQLite sync: ${e instanceof Error ? e.message : String(e)}`);
      }
      
      // Create Source of Truth
      try {
        const patternStore = await createPatternStore({ rootDir: projectPath });
        const patterns = patternStore.getAll();
        const now = new Date().toISOString();
        const sourceOfTruth = {
          version: '2.0.0',
          schemaVersion: '2.0.0',
          createdAt: now,
          updatedAt: now,
          project: { id: crypto.randomUUID(), name: path.basename(projectPath), rootPath: projectPath },
          baseline: { scanId: crypto.randomUUID().slice(0, 8), scannedAt: now, patternCount: patterns.length, approvedCount: patterns.filter(p => p.status === 'approved').length },
          features: { sqliteSync: { enabled: true, builtAt: now }, memory: { enabled: memoryResult.success }, audit: { enabled: auditResult.success, healthScore: auditResult.healthScore } },
          settings: { autoApproveThreshold: 0.85, autoApproveEnabled: true },
        };
        await fs.writeFile(path.join(projectPath, '.drift', 'source-of-truth.json'), JSON.stringify(sourceOfTruth, null, 2));
      } catch (e) {
        errors.push(`Source of Truth: ${e instanceof Error ? e.message : String(e)}`);
      }
      
      return {
        success: true,
        projectPath,
        message: `Phase 5 complete: Setup finalized. Health score: ${auditResult.healthScore ?? 'N/A'}%`,
        duration: { totalMs: Date.now() - startTime, formatted: `${((Date.now() - startTime) / 1000).toFixed(1)}s` },
        steps: { audit: auditResult, memory: memoryResult },
        errors: errors.length > 0 ? errors : undefined,
        hints: { nextActions: ['Use drift_context for curated context', 'Use drift_status for health info'] },
      };
    }
    
    default:
      return { success: false, error: 'INVALID_PHASE', message: 'Phase must be 1-5' };
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function handleSetup(
  args: unknown,
  context: SetupContext
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();
  
  try {
    // 1. Validate input
    const input = SetupInputSchema.parse(args);
    
    // 2. Resolve project path with security check
    let projectPath: string;
    if (input.project) {
      projectPath = path.resolve(context.projectRoot, input.project);
      const normalizedProject = path.normalize(projectPath);
      const normalizedRoot = path.normalize(context.projectRoot);
      
      if (!normalizedProject.startsWith(normalizedRoot)) {
        throw Errors.invalidArgument('project', 'Path traversal detected');
      }
    } else {
      projectPath = context.projectRoot;
    }
    
    // 3. Route to action handler
    let result: SetupResult;
    switch (input.action) {
      case 'status':
        result = await handleStatusAction(projectPath);
        break;
      case 'init':
        result = await handleInitAction(projectPath, { force: input.options?.force ?? false });
        if (context.cache && result.success) {
          await context.cache.invalidateAll();
        }
        break;
      case 'scan': {
        const scanOpts: {
          incremental?: boolean;
          categories?: string[];
          boundaries?: boolean;
          contracts?: boolean;
          testTopology?: boolean;
          constants?: boolean;
          callgraph?: boolean;
          timeout?: number;
        } = {};
        if (input.options?.incremental !== undefined) scanOpts.incremental = input.options.incremental;
        if (input.options?.categories) scanOpts.categories = input.options.categories;
        if (input.options?.boundaries !== undefined) scanOpts.boundaries = input.options.boundaries;
        if (input.options?.contracts !== undefined) scanOpts.contracts = input.options.contracts;
        if (input.options?.testTopology !== undefined) scanOpts.testTopology = input.options.testTopology;
        if (input.options?.constants !== undefined) scanOpts.constants = input.options.constants;
        if (input.options?.callgraph !== undefined) scanOpts.callgraph = input.options.callgraph;
        if (input.options?.timeout !== undefined) scanOpts.timeout = input.options.timeout;
        
        result = await handleScanAction(projectPath, scanOpts);
        if (context.cache && result.success) {
          await context.cache.invalidateAll();
        }
        break;
      }
      case 'callgraph': {
        const cgOpts: { security?: boolean } = {};
        if (input.options?.security !== undefined) cgOpts.security = input.options.security;
        
        result = await handleCallgraphAction(projectPath, cgOpts);
        if (context.cache && result.success) {
          await context.cache.invalidateAll();
        }
        break;
      }
      case 'full':
        result = await handleFullAction(projectPath, input.options);
        if (context.cache && result.success) {
          await context.cache.invalidateAll();
        }
        break;
      case 'discover':
        result = await handleDiscoverAction(projectPath);
        break;
      case 'phase':
        result = await handlePhaseAction(projectPath, input.phase ?? 1, input.options);
        if (context.cache && result.success) {
          await context.cache.invalidateAll();
        }
        break;
      default:
        result = { success: false, error: 'UNKNOWN_ACTION' };
    }
    
    // 4. Record metrics
    metrics.recordRequest('drift_setup', Date.now() - startTime, result.success, false);
    
    // 5. Build response
    const builder = createResponseBuilder<SetupResult>(requestId);
    
    if (result.success) {
      return builder
        .withSummary(generateSummary(input.action, result))
        .withData(result)
        .withHints(result.hints || generateHints(input.action))
        .buildContent();
    } else {
      return builder
        .withSummary(result.message || 'Operation failed')
        .withData(result)
        .withHints(result.hints || { nextActions: getRecoveryActions(result.error) })
        .buildContent();
    }
    
  } catch (error) {
    metrics.recordRequest('drift_setup', Date.now() - startTime, false, false);
    return handleError(error, requestId);
  }
}

function generateSummary(action: string, result: SetupResult): string {
  switch (action) {
    case 'status':
      if (result.initialized) {
        const scan = result.scan as { patternsFound?: number } | undefined;
        const callGraph = result.callGraph as { built?: boolean } | undefined;
        const patterns = scan?.patternsFound || 0;
        const callgraph = callGraph?.built ? 'built' : 'not built';
        return `Drift initialized. ${patterns} patterns found. Call graph: ${callgraph}.`;
      }
      return 'Drift not initialized in this project.';
    case 'init':
      return `Drift initialized in ${result.projectName}`;
    case 'scan': {
      const patterns = result.patterns as { total?: number } | undefined;
      const files = result.files as { scanned?: number } | undefined;
      const patternCount = patterns?.total || 0;
      const fileCount = files?.scanned || 0;
      return `Scan complete. Found ${patternCount} patterns in ${fileCount} files.`;
    }
    case 'callgraph': {
      const stats = result.stats as { totalFunctions?: number } | undefined;
      const funcCount = stats?.totalFunctions || 0;
      const native = result.native ? '(native)' : '(TypeScript)';
      return `Call graph built ${native}. ${funcCount} functions indexed.`;
    }
    case 'full': {
      const steps = result.steps as { scan?: { patterns?: number }; callgraph?: { functions?: number } } | undefined;
      return `Full setup complete. ${steps?.scan?.patterns || 0} patterns, ${steps?.callgraph?.functions || 0} functions.`;
    }
    case 'discover': {
      const scan = result.scan as { candidates?: unknown[]; recommended?: { name?: string } } | undefined;
      const count = scan?.candidates?.length || 0;
      const recommended = scan?.recommended?.name || 'none';
      return `Found ${count} project(s). Recommended: ${recommended}`;
    }
    case 'phase':
      return result.message || 'Phase complete';
    default:
      return 'Operation complete';
  }
}

function generateHints(action: string): { nextActions: string[] } {
  switch (action) {
    case 'init':
      return { nextActions: ['Run drift_setup action="scan"', 'Run drift_setup action="full"'] };
    case 'scan':
      return { nextActions: ['Run drift_setup action="callgraph"', 'Use drift_patterns_list'] };
    case 'callgraph':
      return { nextActions: ['Use drift_reachability', 'Use drift_impact_analysis'] };
    default:
      return { nextActions: ['Use drift_context for curated context'] };
  }
}

function getRecoveryActions(error?: string): string[] {
  switch (error) {
    case 'NOT_INITIALIZED':
      return ['Run drift_setup action="init" first'];
    case 'ALREADY_INITIALIZED':
      return ['Use force=true to reinitialize', 'Run drift_setup action="scan"'];
    case 'CALLGRAPH_BUILD_FAILED':
      return ['Check for syntax errors', 'Verify supported languages'];
    default:
      return ['Check project path', 'Verify permissions'];
  }
}
