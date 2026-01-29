/**
 * Learning Store
 * 
 * Persists and retrieves learned patterns from .drift/learned/
 * 
 * @requirements DRIFT-CORE - Store learned conventions for reuse
 */

import { promises as fs } from 'fs';
import * as path from 'path';

import type { StoredLearnedPatterns, PatternLearningConfig } from './types.js';

// ============================================================================
// Constants
// ============================================================================

const LEARNED_DIR = '.drift/learned';
const SCHEMA_VERSION = '1.0.0';

// ============================================================================
// Learning Store
// ============================================================================

export class LearningStore {
  private rootDir: string;
  private cache: Map<string, StoredLearnedPatterns> = new Map();

  constructor(rootDir: string = '.') {
    this.rootDir = rootDir;
  }

  /**
   * Get the path to the learned patterns directory
   */
  private getLearnedDir(): string {
    return path.join(this.rootDir, LEARNED_DIR);
  }

  /**
   * Get the path to a detector's learned patterns file
   */
  private getDetectorPath(detectorId: string): string {
    // Convert detector ID to safe filename (e.g., "api/route-structure" -> "api-route-structure.json")
    const safeId = detectorId.replace(/\//g, '-');
    return path.join(this.getLearnedDir(), `${safeId}.json`);
  }

  /**
   * Ensure the learned directory exists
   */
  private async ensureDir(): Promise<void> {
    const dir = this.getLearnedDir();
    await fs.mkdir(dir, { recursive: true });
  }

  /**
   * Load learned patterns for a detector
   */
  async load(detectorId: string): Promise<StoredLearnedPatterns | null> {
    // Check cache first
    const cached = this.cache.get(detectorId);
    if (cached) {
      return cached;
    }

    const filePath = this.getDetectorPath(detectorId);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as StoredLearnedPatterns;
      
      // Validate version
      if (data.version !== SCHEMA_VERSION) {
        console.warn(`Learned patterns for ${detectorId} have outdated schema version`);
        return null;
      }
      
      this.cache.set(detectorId, data);
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null; // File doesn't exist, need to learn
      }
      throw error;
    }
  }

  /**
   * Save learned patterns for a detector
   */
  async save(patterns: StoredLearnedPatterns): Promise<void> {
    await this.ensureDir();
    
    const filePath = this.getDetectorPath(patterns.detectorId);
    const content = JSON.stringify(patterns, null, 2);
    
    await fs.writeFile(filePath, content, 'utf-8');
    this.cache.set(patterns.detectorId, patterns);
  }

  /**
   * Check if learned patterns exist and are fresh
   */
  async hasFreshPatterns(
    detectorId: string,
    maxAgeMs: number = 24 * 60 * 60 * 1000 // 24 hours default
  ): Promise<boolean> {
    const patterns = await this.load(detectorId);
    if (!patterns) {
      return false;
    }

    const learnedAt = new Date(patterns.metadata.learnedAt).getTime();
    const age = Date.now() - learnedAt;
    
    return age < maxAgeMs;
  }

  /**
   * Clear learned patterns for a detector
   */
  async clear(detectorId: string): Promise<void> {
    const filePath = this.getDetectorPath(detectorId);
    this.cache.delete(detectorId);
    
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Clear all learned patterns
   */
  async clearAll(): Promise<void> {
    this.cache.clear();
    const dir = this.getLearnedDir();
    
    try {
      const files = await fs.readdir(dir);
      await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(f => fs.unlink(path.join(dir, f)))
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * List all detectors with learned patterns
   */
  async listDetectors(): Promise<string[]> {
    const dir = this.getLearnedDir();
    
    try {
      const files = await fs.readdir(dir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', '').replace(/-/g, '/'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Create a StoredLearnedPatterns object
   */
  static createStoredPatterns(
    detectorId: string,
    conventions: Record<string, unknown>,
    metadata: {
      filesAnalyzed: number;
      relevantFiles: number;
      hasEnoughData: boolean;
      configUsed: PatternLearningConfig;
    }
  ): StoredLearnedPatterns {
    return {
      detectorId,
      version: SCHEMA_VERSION,
      conventions: conventions as Record<string, import('./types.js').SerializedConvention>,
      metadata: {
        ...metadata,
        learnedAt: new Date().toISOString(),
      },
    };
  }
}

/**
 * Create a learning store instance
 */
export function createLearningStore(rootDir: string = '.'): LearningStore {
  return new LearningStore(rootDir);
}
