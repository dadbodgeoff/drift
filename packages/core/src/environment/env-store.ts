/**
 * Environment Variable Store
 *
 * Persistent storage for environment variable access patterns.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {
  EnvAccessMap,
  EnvAccessPoint,
  EnvVarInfo,
  FileEnvInfo,
  EnvStoreConfig,
  EnvSensitivity,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';
const ENV_DIR = 'environment';
const ACCESS_MAP_FILE = 'access-map.json';

// ============================================================================
// Environment Store
// ============================================================================

/**
 * Environment Variable Store
 *
 * Manages persistent storage of environment variable access patterns.
 */
export class EnvStore {
  private readonly config: EnvStoreConfig;
  private accessMap: EnvAccessMap | null = null;
  private initialized = false;

  constructor(config: EnvStoreConfig) {
    this.config = config;
  }

  /**
   * Initialize the store
   */
  async initialize(): Promise<void> {
    if (this.initialized) {return;}

    try {
      await this.loadAccessMap();
    } catch {
      // No existing data, start fresh
      this.accessMap = this.createEmptyAccessMap();
    }

    this.initialized = true;
  }

  /**
   * Get the current access map
   */
  getAccessMap(): EnvAccessMap {
    if (!this.accessMap) {
      return this.createEmptyAccessMap();
    }
    return this.accessMap;
  }

  /**
   * Update the access map
   */
  async updateAccessMap(accessMap: EnvAccessMap): Promise<void> {
    this.accessMap = accessMap;
    await this.saveAccessMap();
  }

  /**
   * Get information about a specific variable
   */
  getVariable(varName: string): EnvVarInfo | null {
    if (!this.accessMap) {return null;}
    return this.accessMap.variables[varName] ?? null;
  }

  /**
   * Get all variables by sensitivity
   */
  getVariablesBySensitivity(sensitivity: EnvSensitivity): EnvVarInfo[] {
    if (!this.accessMap) {return [];}
    return Object.values(this.accessMap.variables)
      .filter(v => v.sensitivity === sensitivity);
  }

  /**
   * Get all secret variables
   */
  getSecrets(): EnvVarInfo[] {
    return this.getVariablesBySensitivity('secret');
  }

  /**
   * Get all credential variables
   */
  getCredentials(): EnvVarInfo[] {
    return this.getVariablesBySensitivity('credential');
  }

  /**
   * Get environment access for a file
   */
  getFileAccess(filePattern: string): FileEnvInfo[] {
    if (!this.accessMap) {return [];}

    const results: FileEnvInfo[] = [];
    const fileAccessMap = new Map<string, EnvAccessPoint[]>();

    // Group access points by file
    for (const point of Object.values(this.accessMap.accessPoints)) {
      if (this.matchesPattern(point.file, filePattern)) {
        if (!fileAccessMap.has(point.file)) {
          fileAccessMap.set(point.file, []);
        }
        fileAccessMap.get(point.file)!.push(point);
      }
    }

    // Build file info
    for (const [file, accessPoints] of fileAccessMap) {
      const variables = [...new Set(accessPoints.map(ap => ap.varName))];
      const sensitiveVars = accessPoints
        .filter(ap => ap.sensitivity === 'secret' || ap.sensitivity === 'credential')
        .map(ap => ap.varName);

      results.push({
        file,
        variables,
        accessPoints,
        sensitiveVars: [...new Set(sensitiveVars)],
      });
    }

    return results;
  }

  /**
   * Get required variables (no default, marked as required)
   */
  getRequiredVariables(): EnvVarInfo[] {
    if (!this.accessMap) {return [];}
    return Object.values(this.accessMap.variables)
      .filter(v => v.isRequired && !v.hasDefault);
  }

  /**
   * Get variables without defaults
   */
  getVariablesWithoutDefaults(): EnvVarInfo[] {
    if (!this.accessMap) {return [];}
    return Object.values(this.accessMap.variables)
      .filter(v => !v.hasDefault);
  }

  /**
   * Check if store has data
   */
  hasData(): boolean {
    return this.accessMap !== null && this.accessMap.stats.totalVariables > 0;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createEmptyAccessMap(): EnvAccessMap {
    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      projectRoot: this.config.rootDir,
      variables: {},
      accessPoints: {},
      stats: {
        totalVariables: 0,
        totalAccessPoints: 0,
        secretVariables: 0,
        credentialVariables: 0,
        configVariables: 0,
        byLanguage: {},
        byMethod: {},
      },
    };
  }

  private async loadAccessMap(): Promise<void> {
    const filePath = path.join(this.config.rootDir, DRIFT_DIR, ENV_DIR, ACCESS_MAP_FILE);
    const content = await fs.readFile(filePath, 'utf-8');
    this.accessMap = JSON.parse(content);
  }

  private async saveAccessMap(): Promise<void> {
    if (!this.accessMap) {return;}

    const dirPath = path.join(this.config.rootDir, DRIFT_DIR, ENV_DIR);
    await fs.mkdir(dirPath, { recursive: true });

    const filePath = path.join(dirPath, ACCESS_MAP_FILE);
    await fs.writeFile(filePath, JSON.stringify(this.accessMap, null, 2));
  }

  private matchesPattern(file: string, pattern: string): boolean {
    // Simple pattern matching
    if (pattern === '*' || pattern === '**/*') {return true;}
    if (pattern.startsWith('**/')) {
      return file.includes(pattern.slice(3));
    }
    if (pattern.endsWith('*')) {
      return file.startsWith(pattern.slice(0, -1));
    }
    return file === pattern || file.includes(pattern);
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new EnvStore instance
 */
export function createEnvStore(config: EnvStoreConfig): EnvStore {
  return new EnvStore(config);
}
