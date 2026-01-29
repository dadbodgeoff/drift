/**
 * ManifestStore - Storage and management for the pattern manifest
 *
 * The manifest provides a complete architectural map of a codebase.
 * This store handles:
 * - Loading/saving the manifest
 * - Incremental updates (only re-scan changed files)
 * - Forward and reverse index queries
 *
 * @requirements PATTERN-LOCATION-DISCOVERY.md
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

import type {
  Manifest,
  ManifestPattern,
  ManifestSummary,
  SemanticLocation,
  PatternQuery,
  PatternQueryResult,
  FileQuery,
  FileQueryResult,
} from './types.js';
import type { PatternCategory } from '../store/types.js';

/** Current manifest format version */
const MANIFEST_VERSION = '2.0.0';

/** Default manifest file path */
const DEFAULT_MANIFEST_PATH = '.drift/index/manifest.json';

/**
 * ManifestStore manages the pattern location manifest
 */
export class ManifestStore {
  private manifest: Manifest | null = null;
  private manifestPath: string;
  private projectRoot: string;
  private dirty = false;

  constructor(projectRoot: string, manifestPath?: string) {
    this.projectRoot = projectRoot;
    this.manifestPath = manifestPath || path.join(projectRoot, DEFAULT_MANIFEST_PATH);
  }

  /**
   * Load manifest from disk
   */
  async load(): Promise<Manifest | null> {
    try {
      const content = await fs.readFile(this.manifestPath, 'utf-8');
      this.manifest = JSON.parse(content) as Manifest;
      this.dirty = false;
      return this.manifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist, return null
        return null;
      }
      throw error;
    }
  }

  /**
   * Save manifest to disk (atomic write)
   */
  async save(): Promise<void> {
    if (!this.manifest) {
      throw new Error('No manifest to save');
    }

    // Update generated timestamp
    this.manifest.generated = new Date().toISOString();

    // Recalculate summary
    this.manifest.summary = this.calculateSummary();

    // Recalculate codebase hash
    this.manifest.codebaseHash = this.calculateCodebaseHash();

    // Ensure directory exists
    const dir = path.dirname(this.manifestPath);
    await fs.mkdir(dir, { recursive: true });

    // Atomic write: write to temp file, then rename
    const tempPath = `${this.manifestPath}.tmp`;
    const content = JSON.stringify(this.manifest, null, 2);
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, this.manifestPath);

    this.dirty = false;
  }

  /**
   * Create a new empty manifest
   */
  create(): Manifest {
    this.manifest = {
      version: MANIFEST_VERSION,
      generated: new Date().toISOString(),
      codebaseHash: '',
      projectRoot: this.projectRoot,
      summary: {
        totalPatterns: 0,
        patternsByStatus: { discovered: 0, approved: 0, ignored: 0 },
        patternsByCategory: {},
        totalFiles: 0,
        totalLocations: 0,
        totalOutliers: 0,
      },
      patterns: {},
      files: {},
    };
    this.dirty = true;
    return this.manifest;
  }

  /**
   * Get the current manifest (load if not loaded)
   */
  async get(): Promise<Manifest> {
    if (!this.manifest) {
      const loaded = await this.load();
      if (!loaded) {
        return this.create();
      }
    }
    return this.manifest!;
  }

  /**
   * Check if a file has changed since last scan
   */
  async hasFileChanged(filePath: string): Promise<boolean> {
    if (!this.manifest) {
      return true;
    }

    const relativePath = path.relative(this.projectRoot, filePath);
    const fileEntry = this.manifest.files[relativePath];

    if (!fileEntry) {
      return true; // New file
    }

    const currentHash = await this.hashFile(filePath);
    return currentHash !== fileEntry.hash;
  }

  /**
   * Get files that have changed since last scan
   */
  async getChangedFiles(files: string[]): Promise<string[]> {
    const changed: string[] = [];

    for (const file of files) {
      if (await this.hasFileChanged(file)) {
        changed.push(file);
      }
    }

    return changed;
  }

  /**
   * Update manifest with new pattern data
   */
  updatePattern(pattern: ManifestPattern): void {
    if (!this.manifest) {
      this.create();
    }

    this.manifest!.patterns[pattern.id] = pattern;
    this.dirty = true;

    // Update reverse index for each location
    for (const location of pattern.locations) {
      this.addFilePattern(location.file, pattern.id, location.hash);
    }
  }

  /**
   * Update manifest with multiple patterns
   */
  updatePatterns(patterns: ManifestPattern[]): void {
    for (const pattern of patterns) {
      this.updatePattern(pattern);
    }
  }

  /**
   * Remove patterns for a file (before re-scanning)
   */
  clearFilePatterns(filePath: string): void {
    if (!this.manifest) {return;}

    const relativePath = path.relative(this.projectRoot, filePath);
    const fileEntry = this.manifest.files[relativePath];

    if (!fileEntry) {return;}

    // Remove this file's locations from each pattern
    for (const patternId of fileEntry.patterns) {
      const pattern = this.manifest.patterns[patternId];
      if (pattern) {
        pattern.locations = pattern.locations.filter(loc => loc.file !== relativePath);
        pattern.outliers = pattern.outliers.filter(loc => loc.file !== relativePath);

        // Remove pattern if no locations left
        if (pattern.locations.length === 0 && pattern.outliers.length === 0) {
          delete this.manifest.patterns[patternId];
        }
      }
    }

    // Clear file entry
    delete this.manifest.files[relativePath];
    this.dirty = true;
  }

  /**
   * Query patterns by various criteria
   */
  queryPatterns(query: PatternQuery): PatternQueryResult[] {
    if (!this.manifest) {return [];}

    const results: PatternQueryResult[] = [];

    for (const [id, pattern] of Object.entries(this.manifest.patterns)) {
      // Filter by pattern name/id
      if (query.pattern) {
        const searchTerm = query.pattern.toLowerCase();
        if (!id.toLowerCase().includes(searchTerm) &&
            !pattern.name.toLowerCase().includes(searchTerm)) {
          continue;
        }
      }

      // Filter by category
      if (query.category && pattern.category !== query.category) {
        continue;
      }

      // Filter by status
      if (query.status && pattern.status !== query.status) {
        continue;
      }

      // Filter by confidence
      if (query.minConfidence !== undefined && pattern.confidence < query.minConfidence) {
        continue;
      }

      // Filter by file path
      let locations = pattern.locations;
      if (query.filePath) {
        const pathPattern = query.filePath;
        locations = locations.filter(loc => this.matchGlob(loc.file, pathPattern));
      }

      if (locations.length === 0) {continue;}

      // Apply limit
      const limitedLocations = query.limit ? locations.slice(0, query.limit) : locations;

      results.push({
        patternId: id,
        patternName: pattern.name,
        category: pattern.category,
        locations: limitedLocations,
        totalCount: locations.length,
      });
    }

    return results;
  }

  /**
   * Query patterns in a specific file
   */
  queryFile(query: FileQuery): FileQueryResult | null {
    if (!this.manifest) {return null;}

    // Handle glob patterns
    const matchingFiles = Object.keys(this.manifest.files).filter(f =>
      this.matchGlob(f, query.path)
    );

    if (matchingFiles.length === 0) {return null;}

    // For now, return first matching file
    const filePath = matchingFiles[0];
    if (!filePath) {return null;}
    
    const fileEntry = this.manifest.files[filePath];

    if (!fileEntry) {return null;}

    const patterns: FileQueryResult['patterns'] = [];

    for (const patternId of fileEntry.patterns) {
      const pattern = this.manifest.patterns[patternId];
      if (!pattern) {continue;}

      // Filter by category
      if (query.category && pattern.category !== query.category) {
        continue;
      }

      // Get locations in this file
      const locations = pattern.locations.filter(loc => loc.file === filePath);

      patterns.push({
        id: patternId,
        name: pattern.name,
        category: pattern.category,
        locations,
      });
    }

    return {
      file: filePath,
      patterns,
      metadata: fileEntry,
    };
  }

  /**
   * Get pattern by ID
   */
  getPattern(patternId: string): ManifestPattern | null {
    return this.manifest?.patterns[patternId] || null;
  }

  /**
   * Get all patterns
   */
  getAllPatterns(): ManifestPattern[] {
    if (!this.manifest) {return [];}
    return Object.values(this.manifest.patterns);
  }

  /**
   * Get patterns by category
   */
  getPatternsByCategory(category: PatternCategory): ManifestPattern[] {
    if (!this.manifest) {return [];}
    return Object.values(this.manifest.patterns).filter(p => p.category === category);
  }

  /**
   * Check if manifest needs saving
   */
  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Get manifest summary
   */
  getSummary(): ManifestSummary | null {
    return this.manifest?.summary || null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private addFilePattern(filePath: string, patternId: string, hash: string): void {
    if (!this.manifest) {return;}

    if (!this.manifest.files[filePath]) {
      this.manifest.files[filePath] = {
        hash,
        patterns: [],
        lastScanned: new Date().toISOString(),
      };
    }

    const fileEntry = this.manifest.files[filePath];
    if (!fileEntry.patterns.includes(patternId)) {
      fileEntry.patterns.push(patternId);
    }
    fileEntry.hash = hash;
    fileEntry.lastScanned = new Date().toISOString();
  }

  private calculateSummary(): ManifestSummary {
    if (!this.manifest) {
      return {
        totalPatterns: 0,
        patternsByStatus: { discovered: 0, approved: 0, ignored: 0 },
        patternsByCategory: {},
        totalFiles: 0,
        totalLocations: 0,
        totalOutliers: 0,
      };
    }

    const patterns = Object.values(this.manifest.patterns);
    const patternsByStatus = { discovered: 0, approved: 0, ignored: 0 };
    const patternsByCategory: Record<string, number> = {};
    let totalLocations = 0;
    let totalOutliers = 0;

    for (const pattern of patterns) {
      patternsByStatus[pattern.status]++;
      patternsByCategory[pattern.category] = (patternsByCategory[pattern.category] || 0) + 1;
      totalLocations += pattern.locations.length;
      totalOutliers += pattern.outliers.length;
    }

    return {
      totalPatterns: patterns.length,
      patternsByStatus,
      patternsByCategory,
      totalFiles: Object.keys(this.manifest.files).length,
      totalLocations,
      totalOutliers,
    };
  }

  private calculateCodebaseHash(): string {
    if (!this.manifest) {return '';}

    // Hash all file hashes together
    const fileHashes = Object.values(this.manifest.files)
      .map(f => f.hash)
      .sort()
      .join('');

    return createHash('sha256').update(fileHashes).digest('hex').substring(0, 12);
  }

  private async hashFile(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return createHash('sha256').update(content).digest('hex').substring(0, 12);
    } catch {
      return '';
    }
  }

  private matchGlob(filePath: string, pattern: string): boolean {
    // Simple glob matching (supports * and **)
    const regexPattern = pattern
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{GLOBSTAR}}/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }
}

/**
 * Hash file content for change detection
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 12);
}

/**
 * Create a semantic location from basic location data
 */
export function createSemanticLocation(
  file: string,
  range: { start: number; end: number },
  type: SemanticLocation['type'],
  name: string,
  options?: {
    signature?: string;
    confidence?: number;
    snippet?: string;
    language?: string;
    hash?: string;
    members?: SemanticLocation[];
  }
): SemanticLocation {
  const result: SemanticLocation = {
    file,
    hash: options?.hash || '',
    range,
    type,
    name,
    confidence: options?.confidence ?? 0.9,
  };
  
  if (options?.signature) {
    result.signature = options.signature;
  }
  if (options?.snippet) {
    result.snippet = options.snippet;
  }
  if (options?.language) {
    result.language = options.language;
  }
  if (options?.members) {
    result.members = options.members;
  }
  
  return result;
}
