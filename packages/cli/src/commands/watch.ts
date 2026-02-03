/**
 * Drift Watch Command
 *
 * Real-time file watching with pattern detection and persistence.
 * Monitors file changes, detects patterns, persists to store, and emits events.
 *
 * @requirements Phase 1 - Watch mode should persist patterns to store
 * @requirements Phase 2 - Smart merge strategy for pattern updates
 * @requirements Phase 3 - File-level tracking for incremental updates
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import { getDefaultIgnoreDirectories } from 'driftdetect-core';
import { createPatternStore, type PatternStoreInterface } from 'driftdetect-core/storage';
import { createAllDetectorsArray, type BaseDetector } from 'driftdetect-detectors';

import type { Pattern, PatternCategory } from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

interface WatchOptions {
  verbose?: boolean;
  context?: string;
  categories?: string;
  debounce?: string;
  persist?: boolean;
}

interface DetectedPattern {
  patternId: string;
  detectorId: string;
  category: string;
  subcategory: string;
  name: string;
  description: string;
  confidence: number;
  locations: Array<{
    file: string;
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
  }>;
}

interface DetectedViolation {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  patternId: string;
  detectorId: string;
}

interface FileMapEntry {
  lastScanned: string;
  hash: string;
  patterns: string[];
}

interface FileMap {
  version: string;
  files: Record<string, FileMapEntry>;
  lastUpdated: string;
}

// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';
const FILE_MAP_PATH = 'index/file-map.json';
const LOCK_FILE_PATH = 'index/.lock';
const LOCK_TIMEOUT_MS = 10000; // 10 seconds max lock hold time
const LOCK_RETRY_MS = 100; // Retry every 100ms
const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.cs', '.css', '.scss', '.json', '.md'];
// Use enterprise-grade ignore list from core
const IGNORE_PATTERNS = getDefaultIgnoreDirectories();

// ============================================================================
// Location Deduplication
// ============================================================================

/**
 * Create a unique key for a location to enable deduplication
 */
function locationKey(loc: { file: string; line: number; column: number }): string {
  return `${loc.file}:${loc.line}:${loc.column}`;
}

/**
 * Add a location to an array only if it doesn't already exist
 */
function addUniqueLocation<T extends { file: string; line: number; column: number }>(
  locations: T[],
  location: T
): boolean {
  const key = locationKey(location);
  const existingKeys = new Set(locations.map(locationKey));
  if (existingKeys.has(key)) {
    return false;
  }
  locations.push(location);
  return true;
}

// ============================================================================
// Utility Functions
// ============================================================================

function timestamp(): string {
  return chalk.gray(`[${new Date().toLocaleTimeString()}]`);
}

function generateFileHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function generateStablePatternId(
  category: string,
  subcategory: string,
  detectorId: string,
  patternId: string
): string {
  const key = `${category}:${subcategory}:${detectorId}:${patternId}`;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function mapToPatternCategory(category: string): PatternCategory {
  const mapping: Record<string, PatternCategory> = {
    'api': 'api',
    'auth': 'auth',
    'security': 'security',
    'errors': 'errors',
    'structural': 'structural',
    'components': 'components',
    'styling': 'styling',
    'logging': 'logging',
    'testing': 'testing',
    'data-access': 'data-access',
    'config': 'config',
    'types': 'types',
    'performance': 'performance',
    'accessibility': 'accessibility',
    'documentation': 'documentation',
  };
  return mapping[category] || 'structural';
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fsPromises.mkdir(dirPath, { recursive: true });
}

// ============================================================================
// File Locking (Phase 4)
// ============================================================================

interface LockInfo {
  pid: number;
  timestamp: string;
  holder: string;
}

/**
 * Acquire a file lock for exclusive access to .drift directory
 * Uses a simple lock file with PID and timestamp
 */
async function acquireLock(rootDir: string, holder: string): Promise<boolean> {
  const lockPath = path.join(rootDir, DRIFT_DIR, LOCK_FILE_PATH);
  await ensureDir(path.dirname(lockPath));
  
  const startTime = Date.now();
  
  while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
    try {
      // Check if lock exists and is stale
      if (await fileExists(lockPath)) {
        const content = await fsPromises.readFile(lockPath, 'utf-8');
        const lockInfo = JSON.parse(content) as LockInfo;
        const lockAge = Date.now() - new Date(lockInfo.timestamp).getTime();
        
        // If lock is older than timeout, it's stale - remove it
        if (lockAge > LOCK_TIMEOUT_MS) {
          await fsPromises.unlink(lockPath);
        } else {
          // Lock is held by another process, wait and retry
          await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_MS));
          continue;
        }
      }
      
      // Try to create lock file exclusively
      const lockInfo: LockInfo = {
        pid: process.pid,
        timestamp: new Date().toISOString(),
        holder,
      };
      
      await fsPromises.writeFile(lockPath, JSON.stringify(lockInfo), { flag: 'wx' });
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EEXIST') {
        // Lock file was created by another process, retry
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_MS));
        continue;
      }
      // Other error, fail
      return false;
    }
  }
  
  // Timeout waiting for lock
  return false;
}

/**
 * Release the file lock
 */
async function releaseLock(rootDir: string): Promise<void> {
  const lockPath = path.join(rootDir, DRIFT_DIR, LOCK_FILE_PATH);
  
  try {
    // Only release if we own the lock
    if (await fileExists(lockPath)) {
      const content = await fsPromises.readFile(lockPath, 'utf-8');
      const lockInfo = JSON.parse(content) as LockInfo;
      
      if (lockInfo.pid === process.pid) {
        await fsPromises.unlink(lockPath);
      }
    }
  } catch {
    // Ignore errors during release
  }
}

/**
 * Execute a function with file lock protection
 */
async function withLock<T>(
  rootDir: string,
  holder: string,
  fn: () => Promise<T>
): Promise<T> {
  const acquired = await acquireLock(rootDir, holder);
  if (!acquired) {
    throw new Error('Failed to acquire lock - another process may be writing');
  }
  
  try {
    return await fn();
  } finally {
    await releaseLock(rootDir);
  }
}

// ============================================================================
// File Map Management (Phase 3)
// ============================================================================

async function loadFileMap(rootDir: string): Promise<FileMap> {
  const mapPath = path.join(rootDir, DRIFT_DIR, FILE_MAP_PATH);
  
  if (await fileExists(mapPath)) {
    try {
      const content = await fsPromises.readFile(mapPath, 'utf-8');
      return JSON.parse(content) as FileMap;
    } catch {
      // Corrupted file, start fresh
    }
  }
  
  return {
    version: '1.0.0',
    files: {},
    lastUpdated: new Date().toISOString(),
  };
}

async function saveFileMap(rootDir: string, fileMap: FileMap): Promise<void> {
  const mapPath = path.join(rootDir, DRIFT_DIR, FILE_MAP_PATH);
  await ensureDir(path.dirname(mapPath));
  
  fileMap.lastUpdated = new Date().toISOString();
  
  // Atomic write: write to temp file, then rename
  const tempPath = `${mapPath}.tmp`;
  await fsPromises.writeFile(tempPath, JSON.stringify(fileMap, null, 2));
  await fsPromises.rename(tempPath, mapPath);
}

// ============================================================================
// Pattern Detection
// ============================================================================

async function detectPatternsInFile(
  filePath: string,
  content: string,
  detectors: BaseDetector[],
  categories: string[] | null,
  rootDir: string
): Promise<{ patterns: DetectedPattern[]; violations: DetectedViolation[] }> {
  const patterns: DetectedPattern[] = [];
  const violations: DetectedViolation[] = [];
  
  const ext = path.extname(filePath).toLowerCase();
  const relativePath = path.relative(rootDir, filePath);
  
  // Determine language
  type SupportedLanguage = 'typescript' | 'javascript' | 'python' | 'css' | 'json' | 'markdown';
  let language: SupportedLanguage = 'typescript';
  if (['.ts', '.tsx'].includes(ext)) {language = 'typescript';}
  else if (['.js', '.jsx'].includes(ext)) {language = 'javascript';}
  else if (['.py'].includes(ext)) {language = 'python';}
  else if (['.css', '.scss'].includes(ext)) {language = 'css';}
  else if (['.json'].includes(ext)) {language = 'json';}
  else if (['.md'].includes(ext)) {language = 'markdown';}
  
  const isTestFile = /\.(test|spec)\.[jt]sx?$/.test(filePath) || 
                     filePath.includes('__tests__') ||
                     filePath.includes('/test/') ||
                     filePath.includes('/tests/');
  
  const isTypeDefinition = ext === '.d.ts';
  
  const projectContext = {
    rootDir,
    files: [relativePath],
    config: {},
  };
  
  // Aggregate patterns by detector+patternId
  const patternMap = new Map<string, DetectedPattern>();
  
  for (const detector of detectors) {
    if (categories && !categories.includes(detector.category)) {
      continue;
    }
    
    if (!detector.supportsLanguage(language)) {
      continue;
    }
    
    try {
      const context = {
        file: relativePath,
        content,
        ast: null,
        imports: [],
        exports: [],
        projectContext,
        language,
        extension: ext,
        isTestFile,
        isTypeDefinition,
      };
      
      const result = await detector.detect(context);
      const info = detector.getInfo();
      
      // Process matches (patterns)
      if (result.patterns && result.patterns.length > 0) {
        for (const match of result.patterns) {
          const key = `${info.category}:${info.subcategory}:${detector.id}:${match.patternId}`;
          
          if (!patternMap.has(key)) {
            patternMap.set(key, {
              patternId: match.patternId,
              detectorId: detector.id,
              category: info.category,
              subcategory: info.subcategory,
              name: info.name,
              description: info.description,
              confidence: match.confidence,
              locations: [],
            });
          }
          
          const pattern = patternMap.get(key)!;
          const loc: { file: string; line: number; column: number; endLine?: number; endColumn?: number } = {
            file: relativePath,
            line: match.location?.line ?? 1,
            column: match.location?.column ?? 0,
          };
          if (match.location?.endLine !== undefined) {
            loc.endLine = match.location.endLine;
          }
          if (match.location?.endColumn !== undefined) {
            loc.endColumn = match.location.endColumn;
          }
          addUniqueLocation(pattern.locations, loc);
        }
      }
      
      // Process violations
      if (result.violations && result.violations.length > 0) {
        for (const v of result.violations) {
          violations.push({
            file: relativePath,
            line: v.range?.start?.line ?? 1,
            column: v.range?.start?.character ?? 0,
            endLine: v.range?.end?.line,
            endColumn: v.range?.end?.character,
            message: v.message,
            severity: v.severity as 'error' | 'warning' | 'info' | 'hint',
            patternId: v.patternId,
            detectorId: detector.id,
          });
        }
      }
    } catch {
      // Skip detector errors
    }
  }
  
  patterns.push(...patternMap.values());
  return { patterns, violations };
}

// ============================================================================
// Pattern Store Integration (Phase 1 & 2)
// ============================================================================

function mergePatternIntoStore(
  store: PatternStoreInterface,
  detected: DetectedPattern,
  violations: DetectedViolation[],
  file: string
): string {
  const stableId = generateStablePatternId(
    detected.category,
    detected.subcategory,
    detected.detectorId,
    detected.patternId
  );
  
  const now = new Date().toISOString();
  const existingPattern = store.get(stableId);
  
  // Get violations for this pattern as outliers
  const patternViolations = violations.filter(
    v => v.detectorId === detected.detectorId && v.patternId === detected.patternId
  );
  
  const newOutliers = patternViolations.map(v => ({
    file: v.file,
    line: v.line,
    column: v.column,
    reason: v.message,
    deviationScore: v.severity === 'error' ? 1.0 : v.severity === 'warning' ? 0.7 : 0.4,
  }));
  
  if (existingPattern) {
    // Phase 2: Smart merge - update existing pattern
    // Remove old locations from this file, add new ones
    const otherFileLocations = existingPattern.locations.filter(loc => loc.file !== file);
    const mergedLocations = [...otherFileLocations, ...detected.locations].slice(0, 100);
    
    // Same for outliers - filter to only include required fields
    const otherFileOutliers = existingPattern.outliers.filter(o => o.file !== file);
    const mergedOutliers = [
      ...otherFileOutliers,
      ...newOutliers,
    ];
    
    // Update pattern preserving status
    store.update(stableId, {
      locations: mergedLocations,
      outliers: mergedOutliers,
      metadata: {
        ...existingPattern.metadata,
        lastSeen: now,
      },
      confidence: {
        ...existingPattern.confidence,
        score: Math.max(existingPattern.confidence.score, detected.confidence),
      },
    });
  } else {
    // New pattern - add to store
    const confidenceScore = Math.min(0.95, detected.confidence);
    
    const newPattern: Pattern = {
      id: stableId,
      category: mapToPatternCategory(detected.category),
      subcategory: detected.subcategory,
      name: detected.name,
      description: detected.description,
      detector: {
        type: 'regex',
        config: {
          detectorId: detected.detectorId,
          patternId: detected.patternId,
        },
      },
      confidence: {
        frequency: Math.min(1, detected.locations.length / 10),
        consistency: 0.9,
        age: 0,
        spread: 1,
        score: confidenceScore,
        level: confidenceScore >= 0.85 ? 'high' : confidenceScore >= 0.65 ? 'medium' : confidenceScore >= 0.45 ? 'low' : 'uncertain',
      },
      locations: detected.locations.slice(0, 100),
      outliers: newOutliers,
      metadata: {
        firstSeen: now,
        lastSeen: now,
        source: 'auto-detected',
        tags: [detected.category, detected.subcategory],
      },
      severity: patternViolations.length > 0 
        ? (patternViolations.some(v => v.severity === 'error') ? 'error' : 'warning')
        : 'info',
      autoFixable: false,
      status: 'discovered',
    };
    
    store.add(newPattern);
  }
  
  return stableId;
}

function removeFileFromStore(store: PatternStoreInterface, file: string): void {
  // Remove all locations and outliers for this file from all patterns
  const allPatterns = store.getAll();
  
  for (const pattern of allPatterns) {
    const hasLocationsInFile = pattern.locations.some(loc => loc.file === file);
    const hasOutliersInFile = pattern.outliers.some(o => o.file === file);
    
    if (hasLocationsInFile || hasOutliersInFile) {
      const newLocations = pattern.locations.filter(loc => loc.file !== file);
      const newOutliers = pattern.outliers.filter(o => o.file !== file);
      
      if (newLocations.length === 0 && newOutliers.length === 0) {
        // Pattern has no more locations - delete it
        store.delete(pattern.id);
      } else {
        // Update pattern with remaining locations
        store.update(pattern.id, {
          locations: newLocations,
          outliers: newOutliers,
        });
      }
    }
  }
}


// ============================================================================
// Console Output
// ============================================================================

function printViolations(
  filePath: string,
  violations: DetectedViolation[],
  patternsUpdated: number,
  verbose: boolean
): void {
  const relativePath = path.relative(process.cwd(), filePath);
  
  if (violations.length === 0) {
    const patternInfo = patternsUpdated > 0 ? chalk.cyan(` (${patternsUpdated} patterns)`) : '';
    console.log(`${timestamp()} ${chalk.green('✓')} ${relativePath}${patternInfo}`);
    return;
  }
  
  const errors = violations.filter(v => v.severity === 'error');
  const warnings = violations.filter(v => v.severity === 'warning');
  
  let summary = '';
  if (errors.length > 0) {summary += chalk.red(`${errors.length} error${errors.length > 1 ? 's' : ''}`);}
  if (warnings.length > 0) {
    if (summary) {summary += ', ';}
    summary += chalk.yellow(`${warnings.length} warning${warnings.length > 1 ? 's' : ''}`);
  }
  
  const patternInfo = patternsUpdated > 0 ? chalk.cyan(` | ${patternsUpdated} patterns`) : '';
  console.log(`${timestamp()} ${chalk.red('✗')} ${relativePath} - ${summary}${patternInfo}`);
  
  if (verbose) {
    for (const v of violations) {
      const icon = v.severity === 'error' ? chalk.red('●') : chalk.yellow('●');
      console.log(`    ${icon} Line ${v.line}: ${v.message}`);
    }
  }
}

function updateContextFile(contextPath: string, stats: { patterns: number; violations: number }): void {
  try {
    const content = `# Drift Context (Auto-updated)

Last updated: ${new Date().toISOString()}

## Current Stats
- Patterns tracked: ${stats.patterns}
- Active violations: ${stats.violations}

This file is auto-updated by \`drift watch\`.
Run \`drift export --format ai-context\` for full pattern details.

## Quick Commands
- \`drift where <pattern>\` - Find pattern locations
- \`drift files <path>\` - See patterns in a specific file
- \`drift status\` - View pattern summary
- \`drift dashboard\` - Open web UI
`;
    
    fs.writeFileSync(contextPath, content);
  } catch {
    // Silently fail context updates
  }
}

// ============================================================================
// Watch Command Implementation
// ============================================================================

async function watchCommand(options: WatchOptions): Promise<void> {
  const rootDir = process.cwd();
  const verbose = options.verbose ?? false;
  const contextPath = options.context;
  const debounceMs = parseInt(options.debounce ?? '300', 10);
  const categories = options.categories?.split(',').map(c => c.trim()) ?? null;
  const persist = options.persist !== false; // Default to true
  
  console.log(chalk.cyan('\n🔍 Drift Watch Mode\n'));
  console.log(`  Watching: ${chalk.white(rootDir)}`);
  if (categories) {
    console.log(`  Categories: ${chalk.white(categories.join(', '))}`);
  }
  if (contextPath) {
    console.log(`  Context file: ${chalk.white(contextPath)}`);
  }
  console.log(`  Debounce: ${chalk.white(`${debounceMs}ms`)}`);
  console.log(`  Persistence: ${chalk.white(persist ? 'enabled' : 'disabled')}`);
  console.log(chalk.gray('\n  Press Ctrl+C to stop\n'));
  console.log(chalk.gray('─'.repeat(50)));
  
  // Initialize pattern store (Phase 3: SQLite is default)
  let store: PatternStoreInterface | null = null;
  let fileMap: FileMap | null = null;
  
  if (persist) {
    try {
      store = await createPatternStore({ rootDir });
      fileMap = await loadFileMap(rootDir);
      
      const stats = store.getStats();
      console.log(`${timestamp()} Loaded ${chalk.cyan(String(stats.totalPatterns))} existing patterns`);
    } catch (error) {
      console.log(`${timestamp()} ${chalk.yellow('Warning: Could not initialize store, running without persistence')}`);
      console.log(chalk.gray(`  ${(error as Error).message}`));
      store = null;
    }
  }
  
  // Load detectors
  const detectors = await createAllDetectorsArray();
  console.log(`${timestamp()} Loaded ${chalk.cyan(String(detectors.length))} detectors`);
  
  // Track pending scans (for debouncing)
  const pendingScans = new Map<string, NodeJS.Timeout>();
  
  // Track save debounce
  let saveTimeout: NodeJS.Timeout | null = null;
  const SAVE_DEBOUNCE_MS = 1000;
  
  function scheduleSave(): void {
    if (!store || !fileMap) {return;}
    
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    
    saveTimeout = setTimeout(async () => {
      try {
        // Use file locking for concurrent write protection (Phase 4)
        await withLock(rootDir, 'drift-watch', async () => {
          await store.saveAll();
          await saveFileMap(rootDir, fileMap);
        });
        if (verbose) {
          console.log(`${timestamp()} ${chalk.gray('Saved patterns to disk')}`);
        }
      } catch (error) {
        console.log(`${timestamp()} ${chalk.red('Failed to save:')} ${(error as Error).message}`);
      }
    }, SAVE_DEBOUNCE_MS);
  }
  
  /**
   * Handle file change
   */
  async function handleFileChange(filePath: string): Promise<void> {
    const relativePath = path.relative(rootDir, filePath);
    
    // Check if file should be ignored
    for (const pattern of IGNORE_PATTERNS) {
      if (relativePath.includes(pattern)) {
        return;
      }
    }
    
    // Check extension
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return;
    }
    
    // Debounce
    const existing = pendingScans.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }
    
    pendingScans.set(filePath, setTimeout(async () => {
      pendingScans.delete(filePath);
      
      try {
        // Check if file still exists
        if (!fs.existsSync(filePath)) {
          // File was deleted
          if (store && fileMap) {
            removeFileFromStore(store, relativePath);
            delete fileMap.files[relativePath];
            scheduleSave();
          }
          console.log(`${timestamp()} ${chalk.gray('Deleted:')} ${relativePath}`);
          return;
        }
        
        // Read file content
        const content = fs.readFileSync(filePath, 'utf-8');
        const fileHash = generateFileHash(content);
        
        // Check if file actually changed (Phase 3)
        if (fileMap && fileMap.files[relativePath]?.hash === fileHash) {
          if (verbose) {
            console.log(`${timestamp()} ${chalk.gray('Unchanged:')} ${relativePath}`);
          }
          return;
        }
        
        // Detect patterns
        const { patterns, violations } = await detectPatternsInFile(
          filePath,
          content,
          detectors,
          categories,
          rootDir
        );
        
        // Update store (Phase 1 & 2)
        let patternsUpdated = 0;
        const patternIds: string[] = [];
        
        if (store) {
          // First, remove old data for this file
          removeFileFromStore(store, relativePath);
          
          // Then add new patterns
          for (const detected of patterns) {
            const patternId = mergePatternIntoStore(store, detected, violations, relativePath);
            patternIds.push(patternId);
            patternsUpdated++;
          }
          
          // Update file map
          if (fileMap) {
            fileMap.files[relativePath] = {
              lastScanned: new Date().toISOString(),
              hash: fileHash,
              patterns: patternIds,
            };
          }
          
          scheduleSave();
        }
        
        // Print results
        printViolations(filePath, violations, patternsUpdated, verbose);
        
        // Update context file
        if (contextPath && store) {
          const stats = store.getStats();
          updateContextFile(contextPath, {
            patterns: stats.totalPatterns,
            violations: stats.totalOutliers,
          });
        }
        
      } catch (error) {
        console.log(`${timestamp()} ${chalk.red('Error processing')} ${relativePath}: ${(error as Error).message}`);
      }
    }, debounceMs));
  }
  
  /**
   * Handle file deletion
   */
  function handleFileDelete(filePath: string): void {
    const relativePath = path.relative(rootDir, filePath);
    
    if (store && fileMap) {
      removeFileFromStore(store, relativePath);
      delete fileMap.files[relativePath];
      scheduleSave();
    }
    
    console.log(`${timestamp()} ${chalk.gray('Removed:')} ${relativePath}`);
  }
  
  // Watch for file changes
  const watchers: fs.FSWatcher[] = [];
  
  function watchDirectory(dir: string): void {
    try {
      const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) {return;}
        
        const fullPath = path.join(dir, filename);
        
        if (eventType === 'rename') {
          // Could be create or delete
          if (fs.existsSync(fullPath)) {
            handleFileChange(fullPath);
          } else {
            handleFileDelete(fullPath);
          }
        } else {
          handleFileChange(fullPath);
        }
      });
      
      watchers.push(watcher);
    } catch (err) {
      console.error(chalk.red(`Failed to watch ${dir}:`), err);
    }
  }
  
  // Start watching
  watchDirectory(rootDir);
  console.log(`${timestamp()} ${chalk.green('Watching for changes...')}\n`);
  
  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log(chalk.gray('\n\nStopping watch mode...'));
    
    // Clear pending operations
    for (const watcher of watchers) {
      watcher.close();
    }
    for (const timeout of pendingScans.values()) {
      clearTimeout(timeout);
    }
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    
    // Final save
    if (store && fileMap) {
      try {
        await withLock(rootDir, 'drift-watch-exit', async () => {
          await store.saveAll();
          await saveFileMap(rootDir, fileMap);
        });
        console.log(chalk.green('Saved patterns before exit'));
      } catch (error) {
        console.log(chalk.red('Failed to save on exit:'), (error as Error).message);
      }
    }
    
    process.exit(0);
  });
  
  // Keep process alive
  await new Promise(() => {});
}

// ============================================================================
// Command Definition
// ============================================================================

export const watchCommandDef = new Command('watch')
  .description('Watch for file changes and detect patterns in real-time')
  .option('--verbose', 'Show detailed output')
  .option('--context <file>', 'Auto-update AI context file on changes')
  .option('-c, --categories <categories>', 'Filter by categories (comma-separated)')
  .option('--debounce <ms>', 'Debounce delay in milliseconds', '300')
  .option('--no-persist', 'Disable pattern persistence (only show violations)')
  .action(watchCommand);
