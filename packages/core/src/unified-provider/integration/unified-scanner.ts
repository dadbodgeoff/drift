/**
 * Unified Scanner
 *
 * A drop-in replacement for SemanticDataAccessScanner that uses
 * the new UnifiedLanguageProvider for extraction.
 *
 * Features:
 * - Auto-detection of project stack from package files
 * - Smart scanning based on detected ORMs/frameworks
 * - Support for TypeScript/JavaScript, Python, C#, Java, PHP
 * - Compatible with existing SemanticScanResult interface
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { minimatch } from 'minimatch';

import { toDataAccessPoint } from './unified-data-access-adapter.js';
import { UnifiedLanguageProvider, createUnifiedProvider } from '../provider/unified-language-provider.js';

import type { DataAccessPoint } from '../../boundaries/types.js';
import type { UnifiedLanguage } from '../types.js';

// ============================================================================
// Types (compatible with SemanticDataAccessScanner)
// ============================================================================

export interface UnifiedScannerConfig {
  rootDir: string;
  verbose?: boolean;
  /** Auto-detect project stack from package files */
  autoDetect?: boolean;
  /** Languages to scan (default: all) */
  languages?: UnifiedLanguage[];
}

export interface UnifiedScanResult {
  /** All detected data access points */
  accessPoints: Map<string, DataAccessPoint[]>;
  /** Statistics about the scan */
  stats: {
    filesScanned: number;
    accessPointsFound: number;
    byLanguage: Record<string, number>;
    byOrm: Record<string, number>;
    errors: number;
  };
  /** Detected project stack */
  detectedStack: DetectedStack | undefined;
  /** Any errors encountered */
  errors: Array<{ file: string; error: string }>;
}

export interface DetectedStack {
  languages: string[];
  orms: string[];
  frameworks: string[];
}

// ============================================================================
// Project Stack Detector
// ============================================================================

/**
 * Detect project stack from package/config files
 */
async function detectProjectStack(rootDir: string): Promise<DetectedStack> {
  const stack: DetectedStack = {
    languages: [],
    orms: [],
    frameworks: [],
  };

  // Check for Node.js/TypeScript (package.json)
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkgContent = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    stack.languages.push('typescript', 'javascript');

    // Detect ORMs
    if (allDeps['@supabase/supabase-js']) {stack.orms.push('supabase');}
    if (allDeps['@prisma/client'] || allDeps['prisma']) {stack.orms.push('prisma');}
    if (allDeps['typeorm']) {stack.orms.push('typeorm');}
    if (allDeps['sequelize']) {stack.orms.push('sequelize');}
    if (allDeps['drizzle-orm']) {stack.orms.push('drizzle');}
    if (allDeps['knex']) {stack.orms.push('knex');}
    if (allDeps['mongoose']) {stack.orms.push('mongoose');}
    if (allDeps['pg'] || allDeps['mysql2'] || allDeps['better-sqlite3']) {stack.orms.push('raw-sql');}

    // Detect frameworks
    if (allDeps['next']) {stack.frameworks.push('nextjs');}
    if (allDeps['express']) {stack.frameworks.push('express');}
    if (allDeps['fastify']) {stack.frameworks.push('fastify');}
    if (allDeps['@nestjs/core']) {stack.frameworks.push('nestjs');}
  } catch {
    // No package.json
  }

  // Check for Python (requirements.txt, pyproject.toml)
  try {
    let pythonDeps = '';
    try {
      pythonDeps = await fs.readFile(path.join(rootDir, 'requirements.txt'), 'utf-8');
    } catch {
      try {
        pythonDeps = await fs.readFile(path.join(rootDir, 'pyproject.toml'), 'utf-8');
      } catch {
        // No Python deps
      }
    }

    if (pythonDeps) {
      stack.languages.push('python');

      if (pythonDeps.includes('django')) {stack.orms.push('django');}
      if (pythonDeps.includes('sqlalchemy')) {stack.orms.push('sqlalchemy');}
      if (pythonDeps.includes('supabase')) {stack.orms.push('supabase-python');}
    }
  } catch {
    // No Python deps
  }

  // Check for C# (.csproj files)
  try {
    const entries = await fs.readdir(rootDir);
    for (const entry of entries) {
      if (entry.endsWith('.csproj')) {
        stack.languages.push('csharp');
        const csprojContent = await fs.readFile(path.join(rootDir, entry), 'utf-8');
        
        if (csprojContent.includes('Microsoft.EntityFrameworkCore')) {stack.orms.push('ef-core');}
        if (csprojContent.includes('Dapper')) {stack.orms.push('dapper');}
        if (csprojContent.includes('Microsoft.AspNetCore')) {stack.frameworks.push('aspnet');}
        break;
      }
    }
  } catch {
    // No .csproj
  }

  // Check for Java (pom.xml, build.gradle)
  try {
    let javaDeps = '';
    try {
      javaDeps = await fs.readFile(path.join(rootDir, 'pom.xml'), 'utf-8');
    } catch {
      try {
        javaDeps = await fs.readFile(path.join(rootDir, 'build.gradle'), 'utf-8');
      } catch {
        // No Java deps
      }
    }

    if (javaDeps) {
      stack.languages.push('java');

      if (javaDeps.includes('spring-data-jpa') || javaDeps.includes('spring-boot-starter-data-jpa')) {
        stack.orms.push('spring-data-jpa');
      }
      if (javaDeps.includes('hibernate')) {stack.orms.push('hibernate');}
      if (javaDeps.includes('spring-boot')) {stack.frameworks.push('spring-boot');}
    }
  } catch {
    // No Java deps
  }

  // Check for PHP (composer.json)
  try {
    const composerPath = path.join(rootDir, 'composer.json');
    const composerContent = await fs.readFile(composerPath, 'utf-8');
    const composer = JSON.parse(composerContent);
    const allDeps = { ...composer.require, ...composer['require-dev'] };

    stack.languages.push('php');

    if (allDeps['laravel/framework']) {
      stack.frameworks.push('laravel');
      stack.orms.push('eloquent');
    }
    if (allDeps['doctrine/orm']) {stack.orms.push('doctrine');}
  } catch {
    // No composer.json
  }

  return stack;
}

// ============================================================================
// Unified Scanner
// ============================================================================

/**
 * Unified Scanner
 *
 * Uses the UnifiedLanguageProvider for all extraction, providing
 * a consistent interface compatible with SemanticDataAccessScanner.
 */
export class UnifiedScanner {
  private readonly config: UnifiedScannerConfig;
  private readonly provider: UnifiedLanguageProvider;

  constructor(config: UnifiedScannerConfig) {
    this.config = config;
    this.provider = createUnifiedProvider({
      projectRoot: config.rootDir,
      languages: config.languages,
      extractDataAccess: true,
      extractCallGraph: false, // Only extract data access for scanning
    });
  }

  /**
   * Scan files for data access patterns
   */
  async scanFiles(files: string[]): Promise<UnifiedScanResult> {
    const accessPoints = new Map<string, DataAccessPoint[]>();
    const errors: Array<{ file: string; error: string }> = [];
    const stats = {
      filesScanned: 0,
      accessPointsFound: 0,
      byLanguage: {} as Record<string, number>,
      byOrm: {} as Record<string, number>,
      errors: 0,
    };

    // Auto-detect project stack if enabled
    let detectedStack: DetectedStack | undefined;
    if (this.config.autoDetect !== false) {
      detectedStack = await detectProjectStack(this.config.rootDir);
      if (this.config.verbose && detectedStack.orms.length > 0) {
        console.log(`Detected stack: ${detectedStack.languages.join(', ')}`);
        console.log(`Detected ORMs: ${detectedStack.orms.join(', ')}`);
      }
    }

    for (const file of files) {
      // Skip type definition files
      if (file.endsWith('.d.ts')) {continue;}

      // Skip test files
      if (this.isTestFile(file)) {continue;}

      try {
        const filePath = path.join(this.config.rootDir, file);
        const source = await fs.readFile(filePath, 'utf-8');

        // Quick check if file might have data access
        if (!this.mightHaveDataAccess(source, detectedStack)) {continue;}

        stats.filesScanned++;

        const result = await this.provider.extract(source, file);

        if (result.dataAccess.length > 0) {
          const points = result.dataAccess.map(toDataAccessPoint);
          accessPoints.set(file, points);
          stats.accessPointsFound += points.length;

          // Track by language
          const lang = result.language;
          stats.byLanguage[lang] = (stats.byLanguage[lang] ?? 0) + points.length;

          // Track by ORM
          for (const access of result.dataAccess) {
            const orm = access.orm;
            if (orm) {
              stats.byOrm[orm] = (stats.byOrm[orm] ?? 0) + 1;
            }
          }
        }

        if (result.errors.length > 0) {
          for (const error of result.errors) {
            errors.push({ file, error });
            stats.errors++;
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({ file, error: errorMsg });
        stats.errors++;

        if (this.config.verbose) {
          console.error(`Error scanning ${file}:`, errorMsg);
        }
      }
    }

    return { accessPoints, stats, detectedStack, errors };
  }

  /**
   * Scan directory with glob patterns
   */
  async scanDirectory(options: {
    patterns?: string[];
    ignorePatterns?: string[];
  } = {}): Promise<UnifiedScanResult> {
    const patterns = options.patterns ?? [
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
      '**/*.py',
      '**/*.cs',
      '**/*.java',
      '**/*.php',
      '**/*.go',
      '**/*.rs',
      '**/*.cpp', '**/*.cc', '**/*.cxx', '**/*.hpp', '**/*.h',
    ];
    const ignorePatterns = options.ignorePatterns ?? [
      'node_modules', '.git', 'dist', 'build', '__pycache__',
      '.drift', '.venv', 'venv', 'bin', 'obj', 'target', 'vendor',
    ];

    const files = await this.findFiles(patterns, ignorePatterns);
    return this.scanFiles(files);
  }

  /**
   * Check if a file is a test file
   */
  private isTestFile(file: string): boolean {
    const lowerFile = file.toLowerCase();
    const testPatterns = [
      /\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /_test\.[jt]sx?$/, /_spec\.[jt]sx?$/,
      /\/__tests__\//, /\/test\//, /\/tests\//,
      /test_.*\.py$/, /_test\.py$/, /conftest\.py$/,
      /Test\.java$/, /Tests\.java$/, /IT\.java$/,
      /Tests?\.cs$/, /\.Tests?\//, /Spec\.cs$/,
      /Test\.php$/,
    ];
    return testPatterns.some(pattern => pattern.test(lowerFile));
  }

  /**
   * Quick check if file might have data access
   */
  private mightHaveDataAccess(content: string, stack?: DetectedStack): boolean {
    // ORM-specific patterns based on detected stack
    if (stack && stack.orms.length > 0) {
      const ormPatterns: Record<string, string[]> = {
        'supabase': ['.from(', 'supabase', 'createClient'],
        'prisma': ['prisma.', '@prisma/client'],
        'django': ['.objects.', 'models.Model'],
        'sqlalchemy': ['.query(', 'session.add', 'session.delete'],
        'typeorm': ['@Entity', 'getRepository', 'Repository'],
        'sequelize': ['sequelize.', '.findAll(', '.findOne('],
        'drizzle': ['drizzle-orm', 'db.select', 'db.insert'],
        'knex': ['knex(', '.table('],
        'mongoose': ['mongoose', '.find(', '.findOne(', 'Schema'],
        'ef-core': ['DbContext', '.Where(', '.ToList', '.SaveChanges'],
        'spring-data-jpa': ['Repository', '@Query', 'JpaRepository'],
        'eloquent': ['::where(', '::find(', '->save(', 'DB::'],
      };

      for (const orm of stack.orms) {
        const patterns = ormPatterns[orm];
        if (patterns?.some(p => content.includes(p))) {
          return true;
        }
      }
    }

    // Generic patterns
    const patterns = [
      '.from(', '.select(', '.insert(', '.update(', '.delete(',
      'prisma.', '.objects.', '.query(', 'session.add',
      '@Entity', 'getRepository', 'sequelize.', '.findAll(',
      'drizzle-orm', 'knex(', 'mongoose', 'Schema(',
      'DbContext', '.Where(', '.ToList', '.SaveChanges',
      'JpaRepository', 'EntityManager', '::where(', '::find(',
      'SELECT ', 'INSERT ', 'UPDATE ', 'DELETE ',
    ];

    return patterns.some(p => content.includes(p));
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
 * Create a new UnifiedScanner instance
 */
export function createUnifiedScanner(config: UnifiedScannerConfig): UnifiedScanner {
  return new UnifiedScanner(config);
}

export { detectProjectStack };
