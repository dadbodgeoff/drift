/**
 * drift_dependencies - Package Dependencies Lookup
 * 
 * Layer: Surgical
 * Token Budget: 300 target, 800 max
 * 
 * Returns package dependencies and their versions across all supported languages.
 * Solves: AI needs to know installed packages before suggesting imports.
 * 
 * Supported:
 * - JavaScript/TypeScript: package.json
 * - Python: requirements.txt, pyproject.toml
 * - Java: pom.xml, build.gradle
 * - PHP: composer.json
 * - C#: *.csproj
 * - Go: go.mod
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createResponseBuilder, Errors, metrics } from '../../infrastructure/index.js';

// ============================================================================
// Types
// ============================================================================

export type DependencyLanguage = 'javascript' | 'python' | 'java' | 'php' | 'csharp' | 'go';

export interface DependenciesArgs {
  /** Search for specific package */
  search?: string;
  /** Filter: prod, dev, peer, all */
  type?: 'prod' | 'dev' | 'peer' | 'all';
  /** Category filter: framework, testing, utility, database, ui, all */
  category?: 'framework' | 'testing' | 'utility' | 'database' | 'ui' | 'all';
  /** Language filter */
  language?: DependencyLanguage | 'all';
  /** Max results */
  limit?: number;
}

export interface DependencyInfo {
  name: string;
  version: string;
  type: 'prod' | 'dev' | 'peer';
  category: string;
  language: DependencyLanguage;
  source: string;
}

export interface DependenciesData {
  dependencies: DependencyInfo[];
  byCategory: Record<string, number>;
  byLanguage: Record<string, number>;
  byType: { prod: number; dev: number; peer: number };
  stats: {
    total: number;
    languages: DependencyLanguage[];
    frameworks: string[];
    testingLibs: string[];
  };
}

// ============================================================================
// Package Categories (multi-language)
// ============================================================================

const PACKAGE_CATEGORIES: Record<string, string[]> = {
  framework: [
    // JS/TS
    'react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'gatsby', 'remix',
    'express', 'fastify', 'koa', 'hapi', 'nestjs', '@nestjs',
    // Python
    'django', 'flask', 'fastapi', 'tornado', 'pyramid', 'starlette',
    // Java
    'spring', 'spring-boot', 'quarkus', 'micronaut', 'jakarta',
    // PHP
    'laravel', 'symfony', 'slim', 'lumen', 'codeigniter',
    // Go
    'gin', 'echo', 'fiber', 'chi', 'gorilla',
    // C#
    'aspnetcore', 'blazor',
  ],
  testing: [
    // JS/TS
    'jest', 'vitest', 'mocha', 'chai', 'jasmine', 'ava', 'cypress', 'playwright',
    '@testing-library', 'enzyme', 'supertest',
    // Python
    'pytest', 'unittest', 'nose', 'hypothesis', 'tox', 'coverage',
    // Java
    'junit', 'testng', 'mockito', 'assertj', 'hamcrest',
    // PHP
    'phpunit', 'pest', 'mockery', 'codeception',
    // Go
    'testify', 'gomock', 'ginkgo',
    // C#
    'xunit', 'nunit', 'mstest', 'moq', 'fluentassertions',
  ],
  database: [
    // JS/TS
    'prisma', 'typeorm', 'sequelize', 'mongoose', 'knex', 'drizzle',
    'pg', 'mysql', 'mysql2', 'sqlite3', 'mongodb', 'redis', 'ioredis',
    // Python
    'sqlalchemy', 'django-orm', 'peewee', 'tortoise-orm', 'psycopg2', 'pymongo',
    // Java
    'hibernate', 'mybatis', 'jpa', 'jdbc', 'r2dbc',
    // PHP
    'eloquent', 'doctrine', 'propel',
    // Go
    'gorm', 'sqlx', 'ent', 'pgx',
    // C#
    'entityframework', 'dapper', 'npgsql',
  ],
  utility: [
    'lodash', 'underscore', 'ramda', 'date-fns', 'moment', 'dayjs',
    'axios', 'node-fetch', 'got', 'requests', 'httpx',
    'zod', 'yup', 'joi', 'pydantic', 'marshmallow',
  ],
  build: [
    'webpack', 'vite', 'esbuild', 'rollup', 'parcel', 'turbo',
    'typescript', 'babel', '@babel', 'eslint', 'prettier',
  ],
};

// ============================================================================
// Handler
// ============================================================================

export async function handleDependencies(
  args: DependenciesArgs,
  rootDir: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const startTime = Date.now();
  const builder = createResponseBuilder<DependenciesData>();
  
  const searchPattern = args.search?.toLowerCase();
  const typeFilter = args.type ?? 'all';
  const categoryFilter = args.category ?? 'all';
  const languageFilter = args.language ?? 'all';
  const limit = args.limit ?? 50;
  
  // Collect dependencies from all languages
  const allDeps: DependencyInfo[] = [];
  
  // JavaScript/TypeScript: package.json
  const jsDeps = await parsePackageJson(rootDir);
  allDeps.push(...jsDeps);
  
  // Python: requirements.txt, pyproject.toml
  const pyDeps = await parsePythonDeps(rootDir);
  allDeps.push(...pyDeps);
  
  // PHP: composer.json
  const phpDeps = await parseComposerJson(rootDir);
  allDeps.push(...phpDeps);
  
  // Go: go.mod
  const goDeps = await parseGoMod(rootDir);
  allDeps.push(...goDeps);
  
  // Java: pom.xml, build.gradle
  const javaDeps = await parseJavaDeps(rootDir);
  allDeps.push(...javaDeps);
  
  // C#: *.csproj
  const csharpDeps = await parseCsprojDeps(rootDir);
  allDeps.push(...csharpDeps);
  
  if (allDeps.length === 0) {
    throw Errors.custom(
      'NO_DEPENDENCIES',
      'No dependency files found (package.json, requirements.txt, composer.json, go.mod, pom.xml, *.csproj)',
      ['drift_status']
    );
  }
  
  // Apply filters
  let filtered = allDeps;
  
  if (searchPattern) {
    filtered = filtered.filter(d => d.name.toLowerCase().includes(searchPattern));
  }
  if (typeFilter !== 'all') {
    filtered = filtered.filter(d => d.type === typeFilter);
  }
  if (categoryFilter !== 'all') {
    filtered = filtered.filter(d => d.category === categoryFilter);
  }
  if (languageFilter !== 'all') {
    filtered = filtered.filter(d => d.language === languageFilter);
  }
  
  // Sort and limit
  filtered.sort((a, b) => a.name.localeCompare(b.name));
  const limited = filtered.slice(0, limit);
  
  // Calculate stats
  const byCategory: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};
  for (const dep of allDeps) {
    byCategory[dep.category] = (byCategory[dep.category] ?? 0) + 1;
    byLanguage[dep.language] = (byLanguage[dep.language] ?? 0) + 1;
  }
  
  const byType = {
    prod: allDeps.filter(d => d.type === 'prod').length,
    dev: allDeps.filter(d => d.type === 'dev').length,
    peer: allDeps.filter(d => d.type === 'peer').length,
  };
  
  const languages = [...new Set(allDeps.map(d => d.language))] as DependencyLanguage[];
  const frameworks = allDeps.filter(d => d.category === 'framework').map(d => d.name);
  const testingLibs = allDeps.filter(d => d.category === 'testing').map(d => d.name);
  
  const data: DependenciesData = {
    dependencies: limited,
    byCategory,
    byLanguage,
    byType,
    stats: { total: allDeps.length, languages, frameworks, testingLibs },
  };
  
  // Build summary
  const langSummary = languages.length > 1 ? ` across ${languages.join(', ')}` : '';
  let summary = `Found ${allDeps.length} dependencies${langSummary}`;
  if (frameworks.length > 0) {
    summary += `. Frameworks: ${frameworks.slice(0, 3).join(', ')}`;
  }
  
  metrics.recordRequest('drift_dependencies', Date.now() - startTime, true, false);
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: ['Use drift_imports to get correct import statements'],
      relatedTools: ['drift_imports', 'drift_signature'],
    })
    .buildContent();
}

// ============================================================================
// Language-Specific Parsers
// ============================================================================

async function parsePackageJson(rootDir: string): Promise<DependencyInfo[]> {
  const deps: DependencyInfo[] = [];
  const files = await findFiles(rootDir, ['package.json'], ['node_modules']);
  
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const pkg = JSON.parse(content);
      const source = path.relative(rootDir, file);
      
      for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
        if (!deps.some(d => d.name === name)) {
          deps.push({ name, version: String(version), type: 'prod', category: categorize(name), language: 'javascript', source });
        }
      }
      for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
        if (!deps.some(d => d.name === name)) {
          deps.push({ name, version: String(version), type: 'dev', category: categorize(name), language: 'javascript', source });
        }
      }
      for (const [name, version] of Object.entries(pkg.peerDependencies ?? {})) {
        if (!deps.some(d => d.name === name)) {
          deps.push({ name, version: String(version), type: 'peer', category: categorize(name), language: 'javascript', source });
        }
      }
    } catch { /* skip invalid */ }
  }
  return deps;
}

async function parsePythonDeps(rootDir: string): Promise<DependencyInfo[]> {
  const deps: DependencyInfo[] = [];
  
  // requirements.txt
  const reqFiles = await findFiles(rootDir, ['requirements.txt', 'requirements-dev.txt', 'requirements-test.txt']);
  for (const file of reqFiles) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const source = path.relative(rootDir, file);
      const isDev = file.includes('dev') || file.includes('test');
      
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) {continue;}
        const match = trimmed.match(/^([a-zA-Z0-9_-]+)([<>=!~]+.*)?$/);
        if (match?.[1]) {
          const name = match[1];
          const version = match[2] ?? '*';
          if (!deps.some(d => d.name === name)) {
            deps.push({ name, version, type: isDev ? 'dev' : 'prod', category: categorize(name), language: 'python', source });
          }
        }
      }
    } catch { /* skip */ }
  }
  
  // pyproject.toml (basic parsing)
  const pyprojectFiles = await findFiles(rootDir, ['pyproject.toml']);
  for (const file of pyprojectFiles) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const source = path.relative(rootDir, file);
      
      // Simple regex for dependencies array
      const depsMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depsMatch?.[1]) {
        const depLines = depsMatch[1].match(/"([^"]+)"/g) ?? [];
        for (const dep of depLines) {
          const clean = dep.replace(/"/g, '');
          const match = clean.match(/^([a-zA-Z0-9_-]+)/);
          if (match?.[1] && !deps.some(d => d.name === match[1])) {
            deps.push({ name: match[1], version: '*', type: 'prod', category: categorize(match[1]), language: 'python', source });
          }
        }
      }
    } catch { /* skip */ }
  }
  
  return deps;
}

async function parseComposerJson(rootDir: string): Promise<DependencyInfo[]> {
  const deps: DependencyInfo[] = [];
  const files = await findFiles(rootDir, ['composer.json'], ['vendor']);
  
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const pkg = JSON.parse(content);
      const source = path.relative(rootDir, file);
      
      for (const [name, version] of Object.entries(pkg.require ?? {})) {
        if (name !== 'php' && !name.startsWith('ext-') && !deps.some(d => d.name === name)) {
          deps.push({ name, version: String(version), type: 'prod', category: categorize(name), language: 'php', source });
        }
      }
      for (const [name, version] of Object.entries(pkg['require-dev'] ?? {})) {
        if (!deps.some(d => d.name === name)) {
          deps.push({ name, version: String(version), type: 'dev', category: categorize(name), language: 'php', source });
        }
      }
    } catch { /* skip */ }
  }
  return deps;
}

async function parseGoMod(rootDir: string): Promise<DependencyInfo[]> {
  const deps: DependencyInfo[] = [];
  const files = await findFiles(rootDir, ['go.mod']);
  
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const source = path.relative(rootDir, file);
      
      // Parse require block
      const requireMatch = content.match(/require\s*\(([\s\S]*?)\)/);
      if (requireMatch?.[1]) {
        for (const line of requireMatch[1].split('\n')) {
          const match = line.trim().match(/^(\S+)\s+(\S+)/);
          if (match?.[1] && match[2]) {
            const name = match[1];
            const version = match[2];
            if (!deps.some(d => d.name === name)) {
              deps.push({ name, version, type: 'prod', category: categorize(name), language: 'go', source });
            }
          }
        }
      }
      
      // Single-line requires
      const singleRequires = content.matchAll(/^require\s+(\S+)\s+(\S+)/gm);
      for (const match of singleRequires) {
        if (match[1] && match[2] && !deps.some(d => d.name === match[1])) {
          deps.push({ name: match[1], version: match[2], type: 'prod', category: categorize(match[1]), language: 'go', source });
        }
      }
    } catch { /* skip */ }
  }
  return deps;
}

async function parseJavaDeps(rootDir: string): Promise<DependencyInfo[]> {
  const deps: DependencyInfo[] = [];
  
  // pom.xml
  const pomFiles = await findFiles(rootDir, ['pom.xml']);
  for (const file of pomFiles) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const source = path.relative(rootDir, file);
      
      // Simple regex for dependencies
      const depMatches = content.matchAll(/<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?(?:<version>([^<]+)<\/version>)?[\s\S]*?(?:<scope>([^<]+)<\/scope>)?[\s\S]*?<\/dependency>/g);
      for (const match of depMatches) {
        const name = `${match[1]}:${match[2]}`;
        const version = match[3] ?? '*';
        const scope = match[4] ?? 'compile';
        const type = scope === 'test' ? 'dev' : 'prod';
        if (!deps.some(d => d.name === name)) {
          deps.push({ name, version, type, category: categorize(match[2] ?? ''), language: 'java', source });
        }
      }
    } catch { /* skip */ }
  }
  
  // build.gradle (basic)
  const gradleFiles = await findFiles(rootDir, ['build.gradle', 'build.gradle.kts']);
  for (const file of gradleFiles) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const source = path.relative(rootDir, file);
      
      const depMatches = content.matchAll(/(?:implementation|api|testImplementation|compileOnly)\s*[("']([^"')]+)[)"']/g);
      for (const match of depMatches) {
        if (match[1]) {
          const parts = match[1].split(':');
          const name = parts.length >= 2 ? `${parts[0]}:${parts[1]}` : match[1];
          const version = parts[2] ?? '*';
          const type = match[0]?.includes('test') ? 'dev' : 'prod';
          if (!deps.some(d => d.name === name)) {
            deps.push({ name, version, type, category: categorize(parts[1] ?? ''), language: 'java', source });
          }
        }
      }
    } catch { /* skip */ }
  }
  
  return deps;
}

async function parseCsprojDeps(rootDir: string): Promise<DependencyInfo[]> {
  const deps: DependencyInfo[] = [];
  const files = await findFiles(rootDir, ['*.csproj'], ['bin', 'obj']);
  
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const source = path.relative(rootDir, file);
      
      const pkgRefs = content.matchAll(/<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g);
      for (const match of pkgRefs) {
        if (match[1] && !deps.some(d => d.name === match[1])) {
          deps.push({ name: match[1], version: match[2] ?? '*', type: 'prod', category: categorize(match[1]), language: 'csharp', source });
        }
      }
    } catch { /* skip */ }
  }
  return deps;
}

// ============================================================================
// Helpers
// ============================================================================

async function findFiles(rootDir: string, patterns: string[], exclude: string[] = []): Promise<string[]> {
  const results: string[] = [];
  
  async function walk(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          if (!exclude.includes(entry.name) && !entry.name.startsWith('.')) {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          for (const pattern of patterns) {
            if (pattern.includes('*')) {
              const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
              if (regex.test(entry.name)) {results.push(fullPath);}
            } else if (entry.name === pattern) {
              results.push(fullPath);
            }
          }
        }
      }
    } catch { /* skip inaccessible */ }
  }
  
  await walk(rootDir);
  return results;
}

function categorize(name: string): string {
  const lower = name.toLowerCase();
  for (const [category, packages] of Object.entries(PACKAGE_CATEGORIES)) {
    for (const pkg of packages) {
      if (lower === pkg || lower.includes(pkg) || lower.startsWith(pkg)) {
        return category;
      }
    }
  }
  if (lower.includes('test') || lower.includes('mock')) {return 'testing';}
  if (lower.includes('db') || lower.includes('sql')) {return 'database';}
  return 'other';
}

/**
 * Tool definition for MCP registration
 */
export const dependenciesToolDefinition = {
  name: 'drift_dependencies',
  description: 'Look up installed dependencies across all languages (JS/TS, Python, Java, PHP, C#, Go). Use before suggesting imports to verify packages are installed.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      search: { type: 'string', description: 'Search for specific package by name' },
      type: { type: 'string', enum: ['prod', 'dev', 'peer', 'all'], description: 'Filter by dependency type (default: all)' },
      category: { type: 'string', enum: ['framework', 'testing', 'utility', 'database', 'ui', 'all'], description: 'Filter by category (default: all)' },
      language: { type: 'string', enum: ['javascript', 'python', 'java', 'php', 'csharp', 'go', 'all'], description: 'Filter by language (default: all)' },
      limit: { type: 'number', description: 'Max results to return (default: 50)' },
    },
  },
};
