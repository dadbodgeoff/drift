/**
 * Environment Variable Scanner
 *
 * Unified scanner for detecting environment variable access patterns
 * across all supported languages.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { minimatch } from 'minimatch';

import { CSharpEnvExtractor } from './extractors/csharp-env-extractor.js';
import { GoEnvExtractor } from './extractors/go-env-extractor.js';
import { JavaEnvExtractor } from './extractors/java-env-extractor.js';
import { PhpEnvExtractor } from './extractors/php-env-extractor.js';
import { PythonEnvExtractor } from './extractors/python-env-extractor.js';
import { TypeScriptEnvExtractor } from './extractors/typescript-env-extractor.js';

import type { BaseEnvExtractor } from './extractors/base-env-extractor.js';
import type {
  EnvAccessMap,
  EnvAccessPoint,
  EnvVarInfo,
  EnvScanResult,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface EnvScannerConfig {
  rootDir: string;
  verbose?: boolean;
}

// ============================================================================
// Environment Scanner
// ============================================================================

/**
 * Environment Variable Scanner
 *
 * Scans codebases for environment variable access patterns.
 */
export class EnvScanner {
  private readonly config: EnvScannerConfig;
  private readonly extractors: BaseEnvExtractor[];

  constructor(config: EnvScannerConfig) {
    this.config = config;

    // Initialize all extractors
    this.extractors = [
      new TypeScriptEnvExtractor(),
      new PythonEnvExtractor(),
      new JavaEnvExtractor(),
      new CSharpEnvExtractor(),
      new PhpEnvExtractor(),
      new GoEnvExtractor(),
    ];
  }

  /**
   * Scan files for environment variable access patterns
   */
  async scanFiles(files: string[]): Promise<EnvScanResult> {
    const startTime = Date.now();
    const accessPoints = new Map<string, EnvAccessPoint[]>();
    const errors: Array<{ file: string; error: string }> = [];
    const stats = {
      filesScanned: 0,
      variablesFound: 0,
      accessPointsFound: 0,
      secretsFound: 0,
      scanDurationMs: 0,
    };

    for (const file of files) {
      // Skip type definition files
      if (file.endsWith('.d.ts')) {continue;}

      const extractor = this.getExtractor(file);
      if (!extractor) {continue;}

      try {
        const filePath = path.join(this.config.rootDir, file);
        const source = await fs.readFile(filePath, 'utf-8');

        // Quick check if file might have env access
        if (!this.mightHaveEnvAccess(source)) {continue;}

        stats.filesScanned++;

        const result = extractor.extract(source, file);

        if (result.accessPoints.length > 0) {
          accessPoints.set(file, result.accessPoints);
          stats.accessPointsFound += result.accessPoints.length;
        }

        if (result.errors.length > 0) {
          for (const error of result.errors) {
            errors.push({ file, error });
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({ file, error: errorMsg });

        if (this.config.verbose) {
          console.error(`Error scanning ${file}:`, errorMsg);
        }
      }
    }

    // Build access map
    const accessMap = this.buildAccessMap(accessPoints);
    stats.variablesFound = accessMap.stats.totalVariables;
    stats.secretsFound = accessMap.stats.secretVariables;
    stats.scanDurationMs = Date.now() - startTime;

    return { accessMap, stats };
  }

  /**
   * Scan directory with glob patterns
   */
  async scanDirectory(options: {
    patterns?: string[];
    ignorePatterns?: string[];
  } = {}): Promise<EnvScanResult> {
    const patterns = options.patterns ?? [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.cs',
      '**/*.java',
      '**/*.php',
      '**/*.go',
    ];
    const ignorePatterns = options.ignorePatterns ?? [
      'node_modules',
      '.git',
      'dist',
      'build',
      '__pycache__',
      '.drift',
      '.venv',
      'venv',
      'bin',
      'obj',
      'target',
      'vendor',
    ];

    const files = await this.findFiles(patterns, ignorePatterns);
    return this.scanFiles(files);
  }

  /**
   * Get the appropriate extractor for a file
   */
  private getExtractor(file: string): BaseEnvExtractor | null {
    for (const extractor of this.extractors) {
      if (extractor.canHandle(file)) {
        return extractor;
      }
    }
    return null;
  }

  /**
   * Quick check if file might have environment access
   */
  private mightHaveEnvAccess(content: string): boolean {
    const patterns = [
      // JavaScript/TypeScript
      'process.env',
      'import.meta.env',
      'dotenv',
      'config(',
      // Python
      'os.environ',
      'os.getenv',
      'load_dotenv',
      'BaseSettings',
      // Java
      'System.getenv',
      'System.getProperty',
      '@Value',
      'Environment.',
      '@ConfigurationProperties',
      // C#
      'Environment.GetEnvironmentVariable',
      'IConfiguration',
      'ConfigurationManager',
      'GetConnectionString',
      // PHP
      'getenv(',
      '$_ENV',
      '$_SERVER',
      'env(',
      'config(',
      // Go
      'os.Getenv',
      'os.LookupEnv',
      'viper.',
      'envconfig',
    ];

    return patterns.some(p => content.includes(p));
  }

  /**
   * Build the access map from extracted access points
   */
  private buildAccessMap(accessPoints: Map<string, EnvAccessPoint[]>): EnvAccessMap {
    const variables: Record<string, EnvVarInfo> = {};
    const allAccessPoints: Record<string, EnvAccessPoint> = {};
    const stats = {
      totalVariables: 0,
      totalAccessPoints: 0,
      secretVariables: 0,
      credentialVariables: 0,
      configVariables: 0,
      byLanguage: {} as Record<string, number>,
      byMethod: {} as Record<string, number>,
    };

    for (const [file, points] of accessPoints) {
      for (const point of points) {
        // Skip internal markers
        if (point.varName.startsWith('__')) {continue;}

        // Add to all access points
        allAccessPoints[point.id] = point;
        stats.totalAccessPoints++;

        // Track by language
        stats.byLanguage[point.language] = (stats.byLanguage[point.language] ?? 0) + 1;

        // Track by method
        stats.byMethod[point.method] = (stats.byMethod[point.method] ?? 0) + 1;

        // Add to variable info
        if (!variables[point.varName]) {
          variables[point.varName] = {
            name: point.varName,
            sensitivity: point.sensitivity,
            accessedBy: [],
            files: [],
            hasDefault: false,
            isRequired: true,
          };
          stats.totalVariables++;

          // Track by sensitivity
          if (point.sensitivity === 'secret') {stats.secretVariables++;}
          else if (point.sensitivity === 'credential') {stats.credentialVariables++;}
          else if (point.sensitivity === 'config') {stats.configVariables++;}
        }

        const varInfo = variables[point.varName];
        if (varInfo) {
          varInfo.accessedBy.push(point);
          if (!varInfo.files.includes(file)) {
            varInfo.files.push(file);
          }
          if (point.hasDefault) {
            varInfo.hasDefault = true;
          }
          if (!point.isRequired) {
            varInfo.isRequired = false;
          }
        }
      }
    }

    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      projectRoot: this.config.rootDir,
      variables,
      accessPoints: allAccessPoints,
      stats,
    };
  }

  /**
   * Find files matching patterns
   */
  private async findFiles(patterns: string[], ignorePatterns: string[]): Promise<string[]> {
    const files: string[] = [];

    const walk = async (dir: string, relativePath: string = ''): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          if (!ignorePatterns.includes(entry.name) && !entry.name.startsWith('.')) {
            await walk(fullPath, relPath);
          }
        } else if (entry.isFile()) {
          for (const pattern of patterns) {
            if (minimatch(relPath, pattern)) {
              files.push(relPath);
              break;
            }
          }
        }
      }
    };

    await walk(this.config.rootDir);
    return files;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new EnvScanner instance
 */
export function createEnvScanner(config: EnvScannerConfig): EnvScanner {
  return new EnvScanner(config);
}
