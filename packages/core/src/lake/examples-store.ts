/**
 * Examples Store
 *
 * Manages pre-extracted code examples for patterns.
 * This allows drift_code_examples to return instantly without reading source files.
 *
 * Storage structure:
 * .drift/lake/examples/
 *   ├── index.json           # Example index (pattern -> file mapping)
 *   └── patterns/
 *       ├── {pattern-id}.json  # Pre-extracted examples for each pattern
 *       └── ...
 *
 * Key features:
 * - Pre-extracted code snippets with context
 * - Quality scoring for example selection
 * - Incremental updates per pattern
 */

import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  LAKE_DIRS,
  DEFAULT_DATA_LAKE_CONFIG,
} from './types.js';

import type {
  PatternExamples,
  CodeExample,
  DataLakeConfig,
} from './types.js';
import type { PatternCategory } from '../store/types.js';

// ============================================================================
// Constants
// ============================================================================

const EXAMPLES_DIR = 'examples';
const PATTERNS_SUBDIR = 'patterns';
const INDEX_FILE = 'index.json';
const STORE_VERSION = '1.0.0';

// Default context lines around examples
const DEFAULT_CONTEXT_LINES = 5;

// ============================================================================
// Types
// ============================================================================

export interface ExamplesIndex {
  version: string;
  generatedAt: string;
  totalPatterns: number;
  totalExamples: number;
  patterns: ExampleIndexEntry[];
}

export interface ExampleIndexEntry {
  patternId: string;
  patternName: string;
  category: PatternCategory;
  exampleCount: number;
  bestQuality: number;
  lastUpdated: string;
}

export interface ExampleExtractionOptions {
  /** Maximum examples per pattern */
  maxExamples?: number;
  /** Lines of context around each example */
  contextLines?: number;
  /** Minimum quality score to include */
  minQuality?: number;
  /** Include outlier examples */
  includeOutliers?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function generateChecksum(data: unknown): string {
  const content = JSON.stringify(data);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function sanitizePatternId(id: string): string {
  // Convert pattern ID to safe filename
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

// ============================================================================
// Examples Store Class
// ============================================================================

export class ExamplesStore extends EventEmitter {
  private readonly config: DataLakeConfig;
  private readonly examplesDir: string;
  private readonly patternsDir: string;

  // In-memory cache
  private indexCache: ExamplesIndex | null = null;
  private examplesCache: Map<string, PatternExamples> = new Map();

  constructor(config: Partial<DataLakeConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DATA_LAKE_CONFIG, ...config };
    this.examplesDir = path.join(
      this.config.rootDir,
      LAKE_DIRS.root,
      LAKE_DIRS.lake,
      EXAMPLES_DIR
    );
    this.patternsDir = path.join(this.examplesDir, PATTERNS_SUBDIR);
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    await ensureDir(this.examplesDir);
    await ensureDir(this.patternsDir);
  }

  // ==========================================================================
  // Index Operations
  // ==========================================================================

  /**
   * Get the examples index
   */
  async getIndex(): Promise<ExamplesIndex | null> {
    if (this.indexCache) {
      return this.indexCache;
    }

    const indexPath = path.join(this.examplesDir, INDEX_FILE);
    if (!(await fileExists(indexPath))) {
      return null;
    }

    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      this.indexCache = JSON.parse(content);
      return this.indexCache;
    } catch {
      return null;
    }
  }

  /**
   * Save the examples index
   */
  async saveIndex(index: ExamplesIndex): Promise<void> {
    await ensureDir(this.examplesDir);
    
    const indexPath = path.join(this.examplesDir, INDEX_FILE);
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
    
    this.indexCache = index;
    this.emit('index:saved');
  }

  /**
   * Build examples index from pattern examples
   */
  async buildIndex(): Promise<ExamplesIndex> {
    const patternIds = await this.listPatterns();
    const entries: ExampleIndexEntry[] = [];
    let totalExamples = 0;

    for (const patternId of patternIds) {
      const examples = await this.getPatternExamples(patternId);
      if (!examples) {continue;}

      const bestQuality = examples.examples.length > 0
        ? Math.max(...examples.examples.map(e => e.quality))
        : 0;

      totalExamples += examples.examples.length;

      entries.push({
        patternId: examples.patternId,
        patternName: examples.patternName,
        category: examples.category,
        exampleCount: examples.examples.length,
        bestQuality,
        lastUpdated: examples.generatedAt,
      });
    }

    const index: ExamplesIndex = {
      version: STORE_VERSION,
      generatedAt: new Date().toISOString(),
      totalPatterns: entries.length,
      totalExamples,
      patterns: entries,
    };

    await this.saveIndex(index);
    return index;
  }

  // ==========================================================================
  // Pattern Examples Operations
  // ==========================================================================

  /**
   * Get examples for a specific pattern
   */
  async getPatternExamples(patternId: string): Promise<PatternExamples | null> {
    // Check cache first
    const cached = this.examplesCache.get(patternId);
    if (cached) {
      return cached;
    }

    const filePath = path.join(this.patternsDir, `${sanitizePatternId(patternId)}.json`);
    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      const examples: PatternExamples = {
        patternId: data.patternId,
        patternName: data.patternName,
        category: data.category,
        generatedAt: data.generatedAt,
        examples: data.examples,
      };
      
      this.examplesCache.set(patternId, examples);
      return examples;
    } catch {
      return null;
    }
  }

  /**
   * Save examples for a pattern
   */
  async savePatternExamples(examples: PatternExamples): Promise<void> {
    await ensureDir(this.patternsDir);
    
    const filePath = path.join(this.patternsDir, `${sanitizePatternId(examples.patternId)}.json`);
    const examplesFile = {
      version: STORE_VERSION,
      checksum: generateChecksum(examples.examples),
      ...examples,
    };
    
    await fs.writeFile(filePath, JSON.stringify(examplesFile, null, 2));
    this.examplesCache.set(examples.patternId, examples);
    
    this.emit('examples:saved', examples.patternId);
  }

  /**
   * Get examples for multiple patterns
   */
  async getMultiplePatternExamples(patternIds: string[]): Promise<PatternExamples[]> {
    const results: PatternExamples[] = [];
    
    const examples = await Promise.all(
      patternIds.map(id => this.getPatternExamples(id))
    );
    
    for (const ex of examples) {
      if (ex) {
        results.push(ex);
      }
    }
    
    return results;
  }

  /**
   * Get examples by category
   */
  async getExamplesByCategory(category: PatternCategory): Promise<PatternExamples[]> {
    const index = await this.getIndex();
    if (!index) {return [];}

    const patternIds = index.patterns
      .filter(p => p.category === category)
      .map(p => p.patternId);

    return this.getMultiplePatternExamples(patternIds);
  }

  /**
   * List all patterns with examples
   */
  async listPatterns(): Promise<string[]> {
    if (!(await fileExists(this.patternsDir))) {
      return [];
    }

    const files = await fs.readdir(this.patternsDir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  /**
   * Delete examples for a pattern
   */
  async deletePatternExamples(patternId: string): Promise<void> {
    const filePath = path.join(this.patternsDir, `${sanitizePatternId(patternId)}.json`);
    
    try {
      await fs.unlink(filePath);
      this.examplesCache.delete(patternId);
      this.emit('examples:deleted', patternId);
    } catch {
      // Ignore if doesn't exist
    }
  }

  // ==========================================================================
  // Example Extraction
  // ==========================================================================

  /**
   * Extract examples from source code for a pattern
   * 
   * This method reads source files and extracts code snippets with context.
   * It's called during scan/materialize, not at query time.
   */
  async extractExamples(
    patternId: string,
    patternName: string,
    category: PatternCategory,
    locations: Array<{ file: string; line: number; endLine?: number }>,
    outliers: Array<{ file: string; line: number; endLine?: number }>,
    options: ExampleExtractionOptions = {}
  ): Promise<PatternExamples> {
    const {
      maxExamples = 5,
      contextLines = DEFAULT_CONTEXT_LINES,
      minQuality = 0.3,
      includeOutliers = true,
    } = options;

    const examples: CodeExample[] = [];

    // Extract from regular locations
    for (const loc of locations) {
      if (examples.length >= maxExamples) {break;}

      const example = await this.extractSingleExample(
        loc.file,
        loc.line,
        loc.endLine,
        contextLines,
        false
      );

      if (example && example.quality >= minQuality) {
        examples.push(example);
      }
    }

    // Extract from outliers if requested
    if (includeOutliers && examples.length < maxExamples) {
      for (const out of outliers) {
        if (examples.length >= maxExamples) {break;}

        const example = await this.extractSingleExample(
          out.file,
          out.line,
          out.endLine,
          contextLines,
          true
        );

        if (example && example.quality >= minQuality) {
          examples.push(example);
        }
      }
    }

    // Sort by quality (best first)
    examples.sort((a, b) => b.quality - a.quality);

    const patternExamples: PatternExamples = {
      patternId,
      patternName,
      category,
      generatedAt: new Date().toISOString(),
      examples,
    };

    await this.savePatternExamples(patternExamples);
    return patternExamples;
  }

  /**
   * Extract a single example from a source file
   */
  private async extractSingleExample(
    file: string,
    line: number,
    endLine: number | undefined,
    contextLines: number,
    isOutlier: boolean
  ): Promise<CodeExample | null> {
    const filePath = path.join(this.config.rootDir, file);
    
    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      
      const actualEndLine = endLine ?? line;
      const startContext = Math.max(0, line - contextLines - 1);
      const endContext = Math.min(lines.length, actualEndLine + contextLines);
      
      // Extract the main code
      const codeLines = lines.slice(line - 1, actualEndLine);
      const code = codeLines.join('\n');
      
      // Extract context (before and after)
      const contextBefore = lines.slice(startContext, line - 1).join('\n');
      const contextAfter = lines.slice(actualEndLine, endContext).join('\n');
      const context = [contextBefore, code, contextAfter].filter(Boolean).join('\n');
      
      // Calculate quality score
      const quality = this.calculateExampleQuality(code, lines.length, isOutlier);

      return {
        file,
        line,
        endLine: actualEndLine,
        code,
        context,
        quality,
        isOutlier,
      };
    } catch {
      return null;
    }
  }

  /**
   * Calculate quality score for an example
   */
  private calculateExampleQuality(
    code: string,
    totalLines: number,
    isOutlier: boolean
  ): number {
    let score = 0.5; // Base score

    // Prefer shorter, focused examples
    const codeLines = code.split('\n').length;
    if (codeLines >= 3 && codeLines <= 20) {
      score += 0.2;
    } else if (codeLines > 50) {
      score -= 0.2;
    }

    // Prefer examples from larger files (more context)
    if (totalLines > 100) {
      score += 0.1;
    }

    // Penalize outliers slightly
    if (isOutlier) {
      score -= 0.1;
    }

    // Prefer examples with meaningful content
    if (code.includes('function') || code.includes('class') || code.includes('const')) {
      score += 0.1;
    }

    // Penalize examples that are mostly comments
    const commentLines = code.split('\n').filter(l => 
      l.trim().startsWith('//') || l.trim().startsWith('*') || l.trim().startsWith('/*')
    ).length;
    if (commentLines > codeLines / 2) {
      score -= 0.2;
    }

    return Math.max(0, Math.min(1, score));
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Invalidate caches
   */
  invalidateCache(patternId?: string): void {
    if (patternId) {
      this.examplesCache.delete(patternId);
    } else {
      this.indexCache = null;
      this.examplesCache.clear();
    }
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { cachedPatterns: number; hasIndex: boolean } {
    return {
      cachedPatterns: this.examplesCache.size,
      hasIndex: this.indexCache !== null,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createExamplesStore(config: Partial<DataLakeConfig> = {}): ExamplesStore {
  return new ExamplesStore(config);
}
