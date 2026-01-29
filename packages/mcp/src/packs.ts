/**
 * Pattern Packs - Pre-defined bundles of patterns for common tasks
 * 
 * Provides cached, task-oriented pattern context for AI agents.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { PatternStore, type Pattern, type Location } from 'driftdetect-core';

// ============================================================================
// File Filtering - Exclude noisy files from examples
// ============================================================================

/**
 * Files to exclude from pattern examples (documentation, config, etc.)
 * These files often contain keywords but aren't useful as code examples.
 */
const EXAMPLE_EXCLUDE_PATTERNS: RegExp[] = [
  // Documentation
  /README/i,
  /CHANGELOG/i,
  /CONTRIBUTING/i,
  /LICENSE/i,
  /\.md$/i,
  
  // CI/CD and config
  /\.github\//,
  /\.gitlab\//,
  /\.ya?ml$/i,
  /\.toml$/i,
  /Dockerfile/i,
  /docker-compose/i,
  
  // Package manifests (not useful as code examples)
  /package\.json$/i,
  /package-lock\.json$/i,
  /pnpm-lock\.yaml$/i,
  /yarn\.lock$/i,
  /requirements\.txt$/i,
  /pyproject\.toml$/i,
  /Cargo\.toml$/i,
  /go\.mod$/i,
  
  // Environment and secrets
  /\.env/i,
  /\.example$/i,
  
  // Generated/build files
  /dist\//,
  /build\//,
  /node_modules\//,
  /\.min\./,
];

/**
 * Deprecation markers that indicate legacy/deprecated code
 */
const DEPRECATION_MARKERS: RegExp[] = [
  /DEPRECATED/i,
  /LEGACY/i,
  /@deprecated/i,
  /TODO:\s*remove/i,
  /REMOVAL:\s*planned/i,
  /backward.?compat/i,
  /will be removed/i,
  /no longer (used|supported|maintained)/i,
];

/**
 * Check if a file should be excluded from examples
 */
function shouldExcludeFile(filePath: string): boolean {
  return EXAMPLE_EXCLUDE_PATTERNS.some(pattern => pattern.test(filePath));
}

/**
 * Check if content contains deprecation markers
 */
function isDeprecatedContent(content: string): boolean {
  // Check first 500 chars (usually where deprecation notices are)
  const header = content.slice(0, 500);
  return DEPRECATION_MARKERS.some(pattern => pattern.test(header));
}

/**
 * Score a location for example quality (higher = better)
 */
function scoreLocation(_loc: Location, filePath: string): number {
  let score = 1.0;
  
  // Penalize documentation files
  if (/\.md$/i.test(filePath)) {score *= 0.1;}
  if (/README/i.test(filePath)) {score *= 0.1;}
  
  // Penalize config files
  if (/\.ya?ml$/i.test(filePath)) {score *= 0.2;}
  if (/\.json$/i.test(filePath)) {score *= 0.3;}
  
  // Boost source code files
  if (/\.(ts|tsx|js|jsx)$/i.test(filePath)) {score *= 1.5;}
  if (/\.(py|rb|go|rs|java)$/i.test(filePath)) {score *= 1.5;}
  
  // Boost files in src/ directories
  if (/\/src\//i.test(filePath)) {score *= 1.3;}
  if (/\/lib\//i.test(filePath)) {score *= 1.2;}
  
  // Penalize test files slightly (still useful but prefer production code)
  if (/\.(test|spec)\./i.test(filePath)) {score *= 0.7;}
  if (/\/__tests__\//i.test(filePath)) {score *= 0.7;}
  
  return score;
}

// ============================================================================
// Types
// ============================================================================

export interface PackDefinition {
  name: string;
  description: string;
  categories: string[];
  patterns?: string[] | undefined;  // Optional pattern name filters
  maxExamples?: number;
  contextLines?: number;
  minConfidence?: number;  // Minimum confidence score (default: 0.5)
  includeDeprecated?: boolean;  // Include deprecated code (default: false)
}

export interface PackMeta {
  name: string;
  generatedAt: string;
  patternHash: string;
  sourceFiles: string[];
  packDefHash: string;
}

export interface PackResult {
  content: string;
  fromCache: boolean;
  generatedAt: string;
  staleReason?: string;
}

export interface PackUsage {
  categories: string[];
  patterns?: string[] | undefined;
  timestamp: string;
  context?: 'code_generation' | 'review' | 'onboarding' | 'unknown';
}

export interface SuggestedPack {
  name: string;
  description: string;
  categories: string[];
  patterns?: string[] | undefined;
  usageCount: number;
  lastUsed: string;
}

// ============================================================================
// Default Pack Definitions
// ============================================================================

export const DEFAULT_PACKS: PackDefinition[] = [
  {
    name: 'backend_route',
    description: 'Everything needed to build a new API endpoint',
    categories: ['api', 'auth', 'security', 'errors'],
    patterns: ['middleware', 'rate-limit', 'response', 'token', 'validation'],
    maxExamples: 2,
    contextLines: 12,
  },
  {
    name: 'react_component',
    description: 'Patterns for new React components',
    categories: ['components', 'styling', 'accessibility', 'types'],
    patterns: ['props', 'hooks', 'error-boundary', 'aria'],
    maxExamples: 2,
    contextLines: 15,
  },
  {
    name: 'data_layer',
    description: 'Database access and service patterns',
    categories: ['data-access', 'errors', 'types', 'logging'],
    patterns: ['repository', 'dto', 'validation', 'transaction'],
    maxExamples: 2,
    contextLines: 12,
  },
  {
    name: 'testing',
    description: 'Test structure and mocking patterns',
    categories: ['testing'],
    maxExamples: 3,
    contextLines: 20,
  },
  {
    name: 'security_audit',
    description: 'Security patterns for code review',
    categories: ['security', 'auth'],
    patterns: ['injection', 'xss', 'csrf', 'sanitization', 'secret'],
    maxExamples: 2,
    contextLines: 15,
  },
  {
    name: 'spring_boot',
    description: 'Patterns for Spring Boot API development',
    categories: ['api', 'auth', 'data-access', 'errors', 'config', 'testing'],
    patterns: ['controller', 'service', 'repository', 'entity', 'dto', 'validation', 'security', 'transaction'],
    maxExamples: 2,
    contextLines: 15,
  },
];

// ============================================================================
// Pack Manager
// ============================================================================

export class PackManager {
  private projectRoot: string;
  private store: PatternStore;
  private packsDir: string;
  private cacheDir: string;
  private customPacks: PackDefinition[] = [];

  constructor(projectRoot: string, store: PatternStore) {
    this.projectRoot = projectRoot;
    this.store = store;
    this.packsDir = path.join(projectRoot, '.drift', 'packs');
    this.cacheDir = path.join(projectRoot, '.drift', 'cache', 'packs');
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.ensureDirectories();
    await this.loadCustomPacks();
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.packsDir, { recursive: true });
    await fs.mkdir(this.cacheDir, { recursive: true });
  }

  private async loadCustomPacks(): Promise<void> {
    const customPacksPath = path.join(this.packsDir, 'packs.json');
    try {
      const content = await fs.readFile(customPacksPath, 'utf-8');
      this.customPacks = JSON.parse(content);
    } catch {
      // No custom packs defined - that's fine
      this.customPacks = [];
    }
  }

  getAllPacks(): PackDefinition[] {
    // Custom packs override defaults with same name
    const packMap = new Map<string, PackDefinition>();
    for (const pack of DEFAULT_PACKS) {
      packMap.set(pack.name, pack);
    }
    for (const pack of this.customPacks) {
      packMap.set(pack.name, pack);
    }
    return Array.from(packMap.values());
  }

  getPack(name: string): PackDefinition | undefined {
    return this.getAllPacks().find(p => p.name === name);
  }

  async getPackContent(name: string, options: { refresh?: boolean } = {}): Promise<PackResult> {
    const packDef = this.getPack(name);
    if (!packDef) {
      throw new Error(`Unknown pack: ${name}. Available: ${this.getAllPacks().map(p => p.name).join(', ')}`);
    }

    const cachePath = path.join(this.cacheDir, `${name}.md`);
    const metaPath = path.join(this.cacheDir, `${name}.meta.json`);

    // Check if we need to regenerate
    if (!options.refresh) {
      const staleCheck = await this.checkStaleness(packDef, metaPath);
      if (!staleCheck.isStale) {
        try {
          const content = await fs.readFile(cachePath, 'utf-8');
          const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as PackMeta;
          return {
            content,
            fromCache: true,
            generatedAt: meta.generatedAt,
          };
        } catch {
          // Cache read failed - regenerate
        }
      } else {
        // Will regenerate - include reason
        const result = await this.generatePack(packDef);
        const packResult: PackResult = {
          content: result.content,
          fromCache: result.fromCache,
          generatedAt: result.generatedAt,
        };
        if (staleCheck.reason) {
          packResult.staleReason = staleCheck.reason;
        }
        return packResult;
      }
    }

    return this.generatePack(packDef);
  }

  private async checkStaleness(
    packDef: PackDefinition,
    metaPath: string
  ): Promise<{ isStale: boolean; reason?: string }> {
    try {
      const metaContent = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaContent) as PackMeta;

      // Check 1: Pack definition changed
      const currentDefHash = this.hashPackDef(packDef);
      if (meta.packDefHash !== currentDefHash) {
        return { isStale: true, reason: 'Pack definition changed' };
      }

      // Check 2: Pattern content changed
      const currentPatternHash = await this.computePatternHash(packDef);
      if (meta.patternHash !== currentPatternHash) {
        return { isStale: true, reason: 'Patterns updated' };
      }

      // Check 3: Source files modified
      const cacheTime = new Date(meta.generatedAt).getTime();
      for (const file of meta.sourceFiles) {
        try {
          const filePath = path.join(this.projectRoot, file);
          const stat = await fs.stat(filePath);
          if (stat.mtimeMs > cacheTime) {
            return { isStale: true, reason: `Source file modified: ${file}` };
          }
        } catch {
          // File doesn't exist anymore - stale
          return { isStale: true, reason: `Source file removed: ${file}` };
        }
      }

      return { isStale: false };
    } catch {
      // No meta file - needs generation
      return { isStale: true, reason: 'No cache exists' };
    }
  }

  private async generatePack(packDef: PackDefinition): Promise<PackResult> {
    const maxExamples = packDef.maxExamples ?? 2;
    const contextLines = packDef.contextLines ?? 12;
    const includeDeprecated = packDef.includeDeprecated ?? false;
    const minConfidence = packDef.minConfidence ?? 0.5;

    // Get patterns matching the pack definition
    let patterns = this.store.getAll();

    // Filter by categories
    const cats = new Set(packDef.categories);
    patterns = patterns.filter(p => cats.has(p.category));

    // Filter by minimum confidence
    patterns = patterns.filter(p => p.confidence.score >= minConfidence);

    // Filter by pattern names if specified
    if (packDef.patterns && packDef.patterns.length > 0) {
      const patternFilters = packDef.patterns.map(p => p.toLowerCase());
      patterns = patterns.filter(p =>
        patternFilters.some(f =>
          p.name.toLowerCase().includes(f) ||
          p.subcategory.toLowerCase().includes(f) ||
          p.id.toLowerCase().includes(f)
        )
      );
    }

    // Deduplicate by subcategory
    const uniquePatterns = new Map<string, Pattern>();
    for (const p of patterns) {
      const key = `${p.category}/${p.subcategory}`;
      if (!uniquePatterns.has(key) || p.locations.length > uniquePatterns.get(key)!.locations.length) {
        uniquePatterns.set(key, p);
      }
    }

    // Limit to 25 patterns max
    const limitedPatterns = Array.from(uniquePatterns.entries()).slice(0, 25);

    // Read code snippets
    const fileCache = new Map<string, string[]>();
    const fileContentCache = new Map<string, string>();
    const sourceFiles = new Set<string>();
    let excludedCount = 0;
    let deprecatedCount = 0;

    const getFileLines = async (filePath: string): Promise<string[]> => {
      if (fileCache.has(filePath)) {
        return fileCache.get(filePath)!;
      }
      try {
        const fullPath = path.join(this.projectRoot, filePath);
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        fileCache.set(filePath, lines);
        fileContentCache.set(filePath, content);
        sourceFiles.add(filePath);
        return lines;
      } catch {
        return [];
      }
    };

    const extractSnippet = (lines: string[], startLine: number, endLine?: number): string => {
      const start = Math.max(0, startLine - contextLines - 1);
      const end = Math.min(lines.length, (endLine ?? startLine) + contextLines);
      return lines.slice(start, end).join('\n');
    };

    // Build output
    let output = `# Pattern Pack: ${packDef.name}\n\n`;
    output += `${packDef.description}\n\n`;
    output += `Generated: ${new Date().toISOString()}\n\n`;
    output += `---\n\n`;

    // Group by category
    const grouped = new Map<string, Array<{ pattern: Pattern; examples: Array<{ file: string; line: number; code: string }> }>>();

    for (const [, pattern] of limitedPatterns) {
      const examples: Array<{ file: string; line: number; code: string }> = [];
      const seenFiles = new Set<string>();

      // Sort locations by quality score (best examples first)
      const scoredLocations = pattern.locations
        .map(loc => ({ loc, score: scoreLocation(loc, loc.file) }))
        .filter(({ loc }) => !shouldExcludeFile(loc.file))
        .sort((a, b) => b.score - a.score);

      // Track excluded files
      const excludedFromPattern = pattern.locations.length - scoredLocations.length;
      excludedCount += excludedFromPattern;

      for (const { loc } of scoredLocations) {
        if (seenFiles.has(loc.file)) {continue;}
        if (examples.length >= maxExamples) {break;}

        const lines = await getFileLines(loc.file);
        if (lines.length === 0) {continue;}

        // Check for deprecation markers
        const content = fileContentCache.get(loc.file) || '';
        if (!includeDeprecated && isDeprecatedContent(content)) {
          deprecatedCount++;
          continue;
        }

        const snippet = extractSnippet(lines, loc.line, loc.endLine);
        if (snippet.trim()) {
          examples.push({ file: loc.file, line: loc.line, code: snippet });
          seenFiles.add(loc.file);
        }
      }

      if (examples.length > 0) {
        if (!grouped.has(pattern.category)) {
          grouped.set(pattern.category, []);
        }
        grouped.get(pattern.category)!.push({ pattern, examples });
      }
    }

    // Format output
    for (const [category, items] of grouped) {
      output += `## ${category.toUpperCase()}\n\n`;

      for (const { pattern, examples } of items) {
        output += `### ${pattern.subcategory}\n`;
        output += `**${pattern.name}** (${(pattern.confidence.score * 100).toFixed(0)}% confidence)\n`;
        if (pattern.description) {
          output += `${pattern.description}\n`;
        }
        output += '\n';

        for (const ex of examples) {
          output += `**${ex.file}:${ex.line}**\n`;
          output += '```\n';
          output += ex.code;
          output += '\n```\n\n';
        }
      }
    }

    // Add filtering stats at the end
    if (excludedCount > 0 || deprecatedCount > 0) {
      output += `---\n\n`;
      output += `*Filtering: ${excludedCount} non-source files excluded`;
      if (deprecatedCount > 0) {
        output += `, ${deprecatedCount} deprecated files skipped`;
      }
      output += `*\n`;
    }

    // Save cache
    const generatedAt = new Date().toISOString();
    const cachePath = path.join(this.cacheDir, `${packDef.name}.md`);
    const metaPath = path.join(this.cacheDir, `${packDef.name}.meta.json`);

    const meta: PackMeta = {
      name: packDef.name,
      generatedAt,
      patternHash: await this.computePatternHash(packDef),
      sourceFiles: Array.from(sourceFiles),
      packDefHash: this.hashPackDef(packDef),
    };

    await fs.writeFile(cachePath, output, 'utf-8');
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    return {
      content: output,
      fromCache: false,
      generatedAt,
    };
  }

  private hashPackDef(packDef: PackDefinition): string {
    const str = JSON.stringify({
      categories: packDef.categories,
      patterns: packDef.patterns,
      maxExamples: packDef.maxExamples,
      contextLines: packDef.contextLines,
    });
    return createHash('md5').update(str).digest('hex').slice(0, 12);
  }

  private async computePatternHash(packDef: PackDefinition): Promise<string> {
    let patterns = this.store.getAll();
    const cats = new Set(packDef.categories);
    patterns = patterns.filter(p => cats.has(p.category));

    // Hash pattern IDs and location counts
    const data = patterns.map(p => `${p.id}:${p.locations.length}`).sort().join('|');
    return createHash('md5').update(data).digest('hex').slice(0, 12);
  }

  async refreshAllPacks(): Promise<Map<string, PackResult>> {
    const results = new Map<string, PackResult>();
    for (const pack of this.getAllPacks()) {
      const result = await this.getPackContent(pack.name, { refresh: true });
      results.set(pack.name, result);
    }
    return results;
  }

  // ==========================================================================
  // Usage Tracking & Pack Learning
  // ==========================================================================

  /**
   * Track pack/category usage for learning
   */
  async trackUsage(usage: PackUsage): Promise<void> {
    const usageFile = path.join(this.packsDir, 'usage.json');
    
    let usageHistory: PackUsage[] = [];
    try {
      const content = await fs.readFile(usageFile, 'utf-8');
      usageHistory = JSON.parse(content);
    } catch {
      // No existing usage file
    }
    
    // Add new usage
    usageHistory.push({
      ...usage,
      timestamp: usage.timestamp || new Date().toISOString(),
    });
    
    // Keep last 1000 entries
    if (usageHistory.length > 1000) {
      usageHistory = usageHistory.slice(-1000);
    }
    
    await fs.writeFile(usageFile, JSON.stringify(usageHistory, null, 2), 'utf-8');
  }

  /**
   * Suggest packs based on usage patterns
   */
  async suggestPacks(): Promise<SuggestedPack[]> {
    const usageFile = path.join(this.packsDir, 'usage.json');
    
    let usageHistory: PackUsage[] = [];
    try {
      const content = await fs.readFile(usageFile, 'utf-8');
      usageHistory = JSON.parse(content);
    } catch {
      return []; // No usage data
    }
    
    // Group by category combination
    const comboCounts = new Map<string, { 
      categories: string[]; 
      patterns: string[];
      count: number; 
      lastUsed: string;
    }>();
    
    for (const usage of usageHistory) {
      const key = usage.categories.sort().join(',');
      const existing = comboCounts.get(key);
      
      if (existing) {
        existing.count++;
        existing.lastUsed = usage.timestamp;
        // Merge patterns
        if (usage.patterns) {
          for (const p of usage.patterns) {
            if (!existing.patterns.includes(p)) {
              existing.patterns.push(p);
            }
          }
        }
      } else {
        comboCounts.set(key, {
          categories: usage.categories,
          patterns: usage.patterns || [],
          count: 1,
          lastUsed: usage.timestamp,
        });
      }
    }
    
    // Filter out existing packs and sort by usage
    const existingPackKeys = new Set(
      this.getAllPacks().map(p => p.categories.sort().join(','))
    );
    
    const suggestions: SuggestedPack[] = [];
    for (const [key, data] of comboCounts) {
      // Skip if already a pack
      if (existingPackKeys.has(key)) {continue;}
      
      // Only suggest if used at least 3 times
      if (data.count < 3) {continue;}
      
      // Generate a name from categories
      const name = `custom_${data.categories.slice(0, 2).join('_')}`;
      
      suggestions.push({
        name,
        description: `Auto-suggested pack based on ${data.count} uses`,
        categories: data.categories,
        patterns: data.patterns.length > 0 ? data.patterns : undefined,
        usageCount: data.count,
        lastUsed: data.lastUsed,
      });
    }
    
    // Sort by usage count descending
    suggestions.sort((a, b) => b.usageCount - a.usageCount);
    
    return suggestions.slice(0, 5); // Top 5 suggestions
  }

  /**
   * Create a custom pack from suggestion or manual definition
   */
  async createCustomPack(pack: PackDefinition): Promise<void> {
    const customPacksPath = path.join(this.packsDir, 'packs.json');
    
    let customPacks: PackDefinition[] = [];
    try {
      const content = await fs.readFile(customPacksPath, 'utf-8');
      customPacks = JSON.parse(content);
    } catch {
      // No existing custom packs
    }
    
    // Check for duplicate name
    const existingIndex = customPacks.findIndex(p => p.name === pack.name);
    if (existingIndex >= 0) {
      // Update existing
      customPacks[existingIndex] = pack;
    } else {
      customPacks.push(pack);
    }
    
    await fs.writeFile(customPacksPath, JSON.stringify(customPacks, null, 2), 'utf-8');
    
    // Reload custom packs
    this.customPacks = customPacks;
  }

  /**
   * Delete a custom pack
   */
  async deleteCustomPack(name: string): Promise<boolean> {
    const customPacksPath = path.join(this.packsDir, 'packs.json');
    
    let customPacks: PackDefinition[] = [];
    try {
      const content = await fs.readFile(customPacksPath, 'utf-8');
      customPacks = JSON.parse(content);
    } catch {
      return false;
    }
    
    const initialLength = customPacks.length;
    customPacks = customPacks.filter(p => p.name !== name);
    
    if (customPacks.length === initialLength) {
      return false; // Not found
    }
    
    await fs.writeFile(customPacksPath, JSON.stringify(customPacks, null, 2), 'utf-8');
    this.customPacks = customPacks;
    
    // Also delete cache
    try {
      await fs.unlink(path.join(this.cacheDir, `${name}.md`));
      await fs.unlink(path.join(this.cacheDir, `${name}.meta.json`));
    } catch {
      // Cache files may not exist
    }
    
    return true;
  }

  /**
   * Infer packs from codebase structure (co-occurring patterns)
   */
  async inferPacksFromStructure(): Promise<SuggestedPack[]> {
    const patterns = this.store.getAll();
    
    // Track which categories appear together in files
    const fileCategories = new Map<string, Set<string>>();
    
    for (const p of patterns) {
      for (const loc of p.locations) {
        if (!fileCategories.has(loc.file)) {
          fileCategories.set(loc.file, new Set());
        }
        fileCategories.get(loc.file)!.add(p.category);
      }
    }
    
    // Count category co-occurrences
    const coOccurrence = new Map<string, number>();
    
    for (const categories of fileCategories.values()) {
      if (categories.size < 2) {continue;}
      
      const catArray = Array.from(categories).sort();
      // Generate pairs and triples
      for (let i = 0; i < catArray.length; i++) {
        for (let j = i + 1; j < catArray.length; j++) {
          const pair = `${catArray[i]},${catArray[j]}`;
          coOccurrence.set(pair, (coOccurrence.get(pair) || 0) + 1);
          
          // Triples
          for (let k = j + 1; k < catArray.length; k++) {
            const triple = `${catArray[i]},${catArray[j]},${catArray[k]}`;
            coOccurrence.set(triple, (coOccurrence.get(triple) || 0) + 1);
          }
        }
      }
    }
    
    // Filter to significant co-occurrences (at least 5 files)
    const suggestions: SuggestedPack[] = [];
    const existingPackKeys = new Set(
      this.getAllPacks().map(p => p.categories.sort().join(','))
    );
    
    for (const [key, count] of coOccurrence) {
      if (count < 5) {continue;}
      if (existingPackKeys.has(key)) {continue;}
      
      const categories = key.split(',');
      const name = `inferred_${categories.slice(0, 2).join('_')}`;
      
      suggestions.push({
        name,
        description: `Inferred from ${count} files with co-occurring patterns`,
        categories,
        usageCount: count,
        lastUsed: new Date().toISOString(),
      });
    }
    
    // Sort by count and return top suggestions
    suggestions.sort((a, b) => b.usageCount - a.usageCount);
    return suggestions.slice(0, 5);
  }
}
