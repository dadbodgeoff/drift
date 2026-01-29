/**
 * Semantic Data Access Scanner
 *
 * @deprecated This file is deprecated. Use the unified provider system instead:
 * - Import from 'driftdetect-core' or '../unified-provider/compat/index.js'
 * - Use UnifiedScanner from '../unified-provider/integration/unified-scanner.js'
 * 
 * This file is kept for reference but is no longer exported from the main index.
 * All data access extraction should go through the unified provider.
 *
 * Unified scanner that uses tree-sitter extractors for accurate data access detection.
 * Features:
 * - Auto-detection of project stack from package files
 * - Smart scanning based on detected ORMs/frameworks
 * - Support for TypeScript/JavaScript, Python, C#, Java, PHP
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { minimatch } from 'minimatch';

import { CSharpDataAccessExtractor } from './csharp-data-access-extractor.js';
import { JavaDataAccessExtractor } from './java-data-access-extractor.js';
import { PhpDataAccessExtractor } from './php-data-access-extractor.js';
import { PythonDataAccessExtractor } from './python-data-access-extractor.js';
import { TypeScriptDataAccessExtractor } from './typescript-data-access-extractor.js';

import type { BaseDataAccessExtractor } from './data-access-extractor.js';
import type { DataAccessPoint } from '../../boundaries/types.js';

// ============================================================================
// Types
// ============================================================================

export interface SemanticScannerConfig {
  rootDir: string;
  verbose?: boolean;
  /** Auto-detect project stack from package files */
  autoDetect?: boolean;
}

export interface SemanticScanResult {
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
    if (allDeps['react']) {stack.frameworks.push('react');}
    if (allDeps['vue']) {stack.frameworks.push('vue');}
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
      if (pythonDeps.includes('tortoise')) {stack.orms.push('tortoise');}
      if (pythonDeps.includes('peewee')) {stack.orms.push('peewee');}
      if (pythonDeps.includes('psycopg') || pythonDeps.includes('pymysql')) {stack.orms.push('raw-sql');}

      if (pythonDeps.includes('fastapi')) {stack.frameworks.push('fastapi');}
      if (pythonDeps.includes('flask')) {stack.frameworks.push('flask');}
      if (pythonDeps.includes('django')) {stack.frameworks.push('django');}
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
      if (javaDeps.includes('mybatis')) {stack.orms.push('mybatis');}
      if (javaDeps.includes('jooq')) {stack.orms.push('jooq');}
      if (javaDeps.includes('jdbc')) {stack.orms.push('jdbc');}

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
    if (allDeps['illuminate/database']) {stack.orms.push('eloquent');}
  } catch {
    // No composer.json
  }

  return stack;
}


// ============================================================================
// Semantic Data Access Scanner
// ============================================================================

/**
 * Semantic Data Access Scanner
 *
 * Uses tree-sitter for all supported languages for accurate data access detection.
 * Features auto-detection of project stack for smarter scanning.
 */
export class SemanticDataAccessScanner {
  private readonly config: SemanticScannerConfig;
  private readonly extractors: BaseDataAccessExtractor[];

  constructor(config: SemanticScannerConfig) {
    this.config = config;

    // Initialize all extractors - all use tree-sitter
    this.extractors = [
      new TypeScriptDataAccessExtractor(),
      new PythonDataAccessExtractor(),
      new CSharpDataAccessExtractor(),
      new JavaDataAccessExtractor(),
      new PhpDataAccessExtractor(),
    ];
  }

  /**
   * Scan files for data access patterns using semantic parsing
   */
  async scanFiles(files: string[]): Promise<SemanticScanResult> {
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
      // Skip type definition files - they don't contain runtime data access
      if (file.endsWith('.d.ts')) {continue;}

      // Skip test files by filename pattern
      if (this.isTestFile(file)) {continue;}

      const extractor = this.getExtractor(file);
      if (!extractor) {continue;}

      try {
        const filePath = path.join(this.config.rootDir, file);
        const source = await fs.readFile(filePath, 'utf-8');

        // Skip files that don't look like they have data access
        if (!this.mightHaveDataAccess(source, detectedStack)) {continue;}

        stats.filesScanned++;

        const result = extractor.extract(source, file);

        if (result.accessPoints.length > 0) {
          accessPoints.set(file, result.accessPoints);
          stats.accessPointsFound += result.accessPoints.length;

          // Track by language
          const lang = result.language;
          stats.byLanguage[lang] = (stats.byLanguage[lang] ?? 0) + result.accessPoints.length;

          // Track by ORM (infer from context)
          for (const ap of result.accessPoints) {
            const orm = this.inferOrm(ap.context);
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
   * Check if a file is a test file based on filename patterns
   */
  private isTestFile(file: string): boolean {
    const lowerFile = file.toLowerCase();
    
    // Common test file patterns
    const testPatterns = [
      // JavaScript/TypeScript
      /\.test\.[jt]sx?$/,
      /\.spec\.[jt]sx?$/,
      /_test\.[jt]sx?$/,
      /_spec\.[jt]sx?$/,
      /\/__tests__\//,
      /\/test\//,
      /\/tests\//,
      /\.stories\.[jt]sx?$/, // Storybook
      
      // Python
      /test_.*\.py$/,
      /_test\.py$/,
      /\/tests?\//,
      /conftest\.py$/,
      
      // Java
      /Test\.java$/,
      /Tests\.java$/,
      /IT\.java$/, // Integration tests
      /\/test\//,
      
      // C#
      /Tests?\.cs$/,
      /\.Tests?\//,
      /Spec\.cs$/,
      
      // PHP
      /Test\.php$/,
      /\/tests?\//,
    ];
    
    return testPatterns.some(pattern => pattern.test(lowerFile));
  }

  /**
   * Scan directory with glob patterns
   */
  async scanDirectory(options: {
    patterns?: string[];
    ignorePatterns?: string[];
  } = {}): Promise<SemanticScanResult> {
    const patterns = options.patterns ?? [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.cs',
      '**/*.java',
      '**/*.php',
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
  private getExtractor(file: string): BaseDataAccessExtractor | null {
    for (const extractor of this.extractors) {
      if (extractor.canHandle(file)) {
        return extractor;
      }
    }
    return null;
  }


  /**
   * Quick check if file might have data access (avoid parsing everything)
   */
  private mightHaveDataAccess(content: string, stack?: DetectedStack): boolean {
    // Skip test files - check both filename patterns and content
    const testPatterns = ['@pytest', 'describe(', 'it(', 'test(', '[Fact]', '[Theory]',
                         '@Test', '@Before', '@After', 'PHPUnit', 'jest.mock', 'vi.mock',
                         'unittest.TestCase', 'TestCase', '@pytest.fixture', 'mock.patch',
                         'sinon.stub', 'expect(', 'assert.', 'assertEquals'];
    if (testPatterns.some(p => content.includes(p))) {
      // But allow if they also have actual data access
      const hasDataAccess = ['.from(', '.query(', 'SELECT', 'prisma.', 'DbContext', '.Where(']
        .some(p => content.includes(p));
      if (!hasDataAccess) {return false;}
    }

    // If we detected specific ORMs, prioritize those patterns
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
        'dapper': ['.Query<', '.QueryAsync<', '.Execute('],
        'spring-data-jpa': ['Repository', '@Query', 'JpaRepository'],
        'hibernate': ['Session', 'EntityManager', 'createQuery'],
        'eloquent': ['::where(', '::find(', '->save(', 'DB::'],
        'doctrine': ['getRepository', 'EntityManager', 'persist'],
      };

      for (const orm of stack.orms) {
        const patterns = ormPatterns[orm];
        if (patterns?.some(p => content.includes(p))) {
          return true;
        }
      }
    }

    // Generic ORM/database patterns
    const patterns = [
      // Supabase
      '.from(', '.select(', '.insert(', '.update(', '.delete(',
      // Prisma
      'prisma.', '@prisma/client',
      // Django
      '.objects.', 'models.Model',
      // SQLAlchemy
      '.query(', 'session.add', 'session.delete',
      // TypeORM
      '@Entity', 'getRepository', 'Repository',
      // Sequelize
      'sequelize.', '.findAll(', '.findOne(',
      // Drizzle
      'drizzle-orm', 'db.select', 'db.insert',
      // Knex
      'knex(', '.table(',
      // Mongoose
      'mongoose', 'Schema(',
      // Entity Framework Core
      'DbContext', '.Where(', '.FirstOrDefault', '.ToList', '.ToListAsync',
      '.Add(', '.AddRange(', '.Remove(', '.SaveChanges',
      // Dapper
      '.Query<', '.QueryAsync<', '.Execute(', '.ExecuteAsync(',
      // ADO.NET
      'ExecuteReader', 'ExecuteNonQuery', 'SqlCommand',
      // Spring Data JPA
      'JpaRepository', 'CrudRepository', '@Query',
      // Hibernate
      'EntityManager', 'Session', 'createQuery',
      // Laravel Eloquent
      '::where(', '::find(', '::all(', '->save(', 'DB::table',
      // Doctrine
      'getRepository(', 'EntityManager', '->persist(',
      // Raw SQL
      'SELECT ', 'INSERT ', 'UPDATE ', 'DELETE ',
      'execute(', 'query(',
    ];

    return patterns.some(p => content.includes(p));
  }

  /**
   * Infer ORM from context string
   */
  private inferOrm(context: string): string | null {
    const lower = context.toLowerCase();

    // JavaScript/TypeScript ORMs
    if (lower.includes('supabase') || (lower.includes('.from(') && lower.includes('.select('))) {return 'supabase';}
    if (lower.includes('prisma')) {return 'prisma';}
    if (lower.includes('repository') && !lower.includes('jpa')) {return 'typeorm';}
    if (lower.includes('sequelize') || lower.includes('.findall(')) {return 'sequelize';}
    if (lower.includes('drizzle')) {return 'drizzle';}
    if (lower.includes('knex')) {return 'knex';}
    if (lower.includes('mongoose') || lower.includes('schema(')) {return 'mongoose';}

    // Python ORMs
    if (lower.includes('.objects.')) {return 'django';}
    if (lower.includes('session.query') || lower.includes('sqlalchemy')) {return 'sqlalchemy';}

    // C# ORMs
    if (lower.includes('dbcontext') || lower.includes('.tolistasync(')) {return 'ef-core';}
    if (lower.includes('.query<') || lower.includes('.queryasync<')) {return 'dapper';}
    if (lower.includes('executereader') || lower.includes('executenonquery')) {return 'ado-net';}

    // Java ORMs
    if (lower.includes('jparepository') || lower.includes('crudrepository')) {return 'spring-data-jpa';}
    if (lower.includes('entitymanager') || lower.includes('session.get')) {return 'hibernate';}
    if (lower.includes('@select') || lower.includes('@insert')) {return 'mybatis';}
    if (lower.includes('dsl.select') || lower.includes('insertinto')) {return 'jooq';}

    // PHP ORMs
    if (lower.includes('::where(') || lower.includes('::find(') || lower.includes('eloquent')) {return 'eloquent';}
    if (lower.includes('db::table') || lower.includes('db::select')) {return 'laravel-db';}
    if (lower.includes('getrepository(') || lower.includes('->persist(')) {return 'doctrine';}

    // Raw SQL
    if (/\b(select|insert|update|delete)\b/i.test(context)) {return 'raw-sql';}

    return null;
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
 * Create a new SemanticDataAccessScanner instance
 */
export function createSemanticDataAccessScanner(config: SemanticScannerConfig): SemanticDataAccessScanner {
  return new SemanticDataAccessScanner(config);
}

/**
 * Detect project stack from package files
 */
export { detectProjectStack };
