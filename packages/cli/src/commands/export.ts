/**
 * Export Command - Export manifest in various formats
 *
 * Exports the pattern manifest for AI consumption or reporting.
 * Also supports database export for backup and migration.
 *
 * MIGRATION: Now uses IPatternService for pattern operations.
 * Phase 3: Added database export/import for SQLite migration.
 *
 * Usage:
 *   drift export                    # Export as JSON to stdout
 *   drift export --format ai-context # Export optimized for LLMs
 *   drift export --format summary   # Human-readable summary
 *   drift export -o report.md       # Write to file
 *   drift export db --format json   # Export database as JSON
 *   drift export db --format sqlite # Export database as SQLite file
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  exportManifest,
  estimateTokens,
  type ExportFormat,
  type ExportOptions,
  type PatternCategory,
  type ManifestPattern,
  type Manifest,
} from 'driftdetect-core';
import {
  UnifiedStore,
  hasSqliteDatabase,
} from 'driftdetect-core/storage';

import { createCLIPatternService } from '../services/pattern-service-factory.js';

const VALID_FORMATS: ExportFormat[] = ['json', 'ai-context', 'summary', 'markdown'];
const VALID_CATEGORIES: PatternCategory[] = [
  'api', 'auth', 'security', 'errors', 'logging', 'testing',
  'data-access', 'config', 'types', 'structural', 'components',
  'styling', 'accessibility', 'documentation', 'performance',
];

export const exportCommand = new Command('export')
  .description('Export manifest in various formats')
  .option('-f, --format <format>', `Output format: ${VALID_FORMATS.join(', ')}`, 'json')
  .option('-o, --output <file>', 'Output file (stdout if not specified)')
  .option('-c, --categories <categories>', 'Categories to include (comma-separated)')
  .option('--status <status>', 'Filter by status: discovered, approved, ignored')
  .option('--min-confidence <number>', 'Minimum confidence threshold (0.0-1.0)')
  .option('--compact', 'Compact output (fewer details)')
  .option('--max-tokens <number>', 'Maximum tokens for AI context format')
  .option('--snippets', 'Include code snippets')
  .action(async (options) => {
    const cwd = process.cwd();

    // Validate format
    if (!VALID_FORMATS.includes(options.format)) {
      console.error(chalk.red(`Invalid format: ${options.format}`));
      console.error(`Valid formats: ${VALID_FORMATS.join(', ')}`);
      process.exit(1);
    }

    // Initialize pattern service
    const service = createCLIPatternService(cwd);

    // Get all patterns (service auto-initializes)
    const allPatternsResult = await service.listPatterns({ limit: 10000 });
    
    // Fetch full pattern details
    const allPatterns = await Promise.all(
      allPatternsResult.items.map(async (summary) => {
        const pattern = await service.getPattern(summary.id);
        return pattern;
      })
    );
    
    // Filter out nulls
    const validPatterns = allPatterns.filter((p): p is NonNullable<typeof p> => p !== null);

    if (validPatterns.length === 0) {
      console.error(chalk.red('No patterns found. Run `drift scan` first.'));
      process.exit(1);
    }

    // Build manifest from patterns
    const manifest: Manifest = {
      version: '2.0.0',
      generated: new Date().toISOString(),
      codebaseHash: '',
      projectRoot: cwd,
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

    // Convert patterns to manifest format
    for (const pattern of validPatterns) {
      const manifestKey = `${pattern.category}/${pattern.subcategory}/${pattern.id}`;

      // Convert Pattern to ManifestPattern format
      const manifestPattern: ManifestPattern = {
        id: manifestKey,
        name: pattern.name,
        category: pattern.category,
        subcategory: pattern.subcategory,
        status: pattern.status,
        confidence: pattern.confidence,
        locations: pattern.locations.map(loc => ({
          file: loc.file,
          hash: '',
          range: { start: loc.line, end: loc.endLine ?? loc.line },
          type: 'block' as const,
          name: `line-${loc.line}`,
          confidence: pattern.confidence,
          snippet: loc.snippet ?? '',
          language: getLanguageFromFile(loc.file),
        })),
        outliers: pattern.outliers.map(outlier => ({
          file: outlier.file,
          hash: '',
          range: { start: outlier.line, end: outlier.endLine ?? outlier.line },
          type: 'block' as const,
          name: outlier.reason ?? `line-${outlier.line}`,
          confidence: 0.5,
          snippet: outlier.snippet ?? '',
          language: getLanguageFromFile(outlier.file),
        })),
        description: pattern.description,
        firstSeen: pattern.firstSeen,
        lastSeen: pattern.lastSeen,
      };

      manifest.patterns[manifestKey] = manifestPattern;
    }

    // Calculate summary
    const patterns = Object.values(manifest.patterns);
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

    manifest.summary = {
      totalPatterns: patterns.length,
      patternsByStatus,
      patternsByCategory,
      totalFiles: new Set(patterns.flatMap(p => p.locations.map(l => l.file))).size,
      totalLocations,
      totalOutliers,
    };

    // Parse categories
    let categories: PatternCategory[] | undefined;
    if (options.categories) {
      categories = options.categories.split(',').map((c: string) => c.trim()) as PatternCategory[];
      const invalid = categories.filter(c => !VALID_CATEGORIES.includes(c));
      if (invalid.length > 0) {
        console.error(chalk.red(`Invalid categories: ${invalid.join(', ')}`));
        console.error(`Valid categories: ${VALID_CATEGORIES.join(', ')}`);
        process.exit(1);
      }
    }

    // Parse status
    let statuses: Array<'discovered' | 'approved' | 'ignored'> | undefined;
    if (options.status) {
      statuses = options.status.split(',').map((s: string) => s.trim()) as typeof statuses;
    }

    // Build export options
    const exportOptions: ExportOptions = {
      format: options.format as ExportFormat,
    };
    
    if (options.output) {
      exportOptions.output = options.output;
    }
    if (categories) {
      exportOptions.categories = categories;
    }
    if (statuses) {
      exportOptions.statuses = statuses;
    }
    if (options.minConfidence) {
      exportOptions.minConfidence = parseFloat(options.minConfidence);
    }
    if (options.compact) {
      exportOptions.compact = options.compact;
    }
    if (options.maxTokens) {
      exportOptions.maxTokens = parseInt(options.maxTokens, 10);
    }
    if (options.snippets) {
      exportOptions.includeSnippets = options.snippets;
    }

    // Export
    const output = exportManifest(manifest, exportOptions);

    // Estimate tokens for AI context
    if (options.format === 'ai-context') {
      const estimate = estimateTokens(output);
      if (estimate.warning) {
        console.error(chalk.yellow(`⚠️  ${estimate.warning}`));
      }
      console.error(chalk.dim(`Estimated tokens: ~${estimate.tokens}`));
    }

    // Write output
    if (options.output) {
      const outputPath = path.resolve(cwd, options.output);
      await fs.writeFile(outputPath, output, 'utf-8');
      console.error(chalk.green(`✔ Exported to ${options.output}`));
    } else {
      console.log(output);
    }
  });

/**
 * Get language from file extension
 */
function getLanguageFromFile(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    css: 'css',
    scss: 'css',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
  };
  return langMap[ext] || 'unknown';
}

/**
 * Database export subcommand
 * 
 * Phase 3: Export the SQLite database for backup or migration
 */
const dbExportCommand = new Command('db')
  .description('Export database for backup or migration')
  .option('--db-format <format>', 'Export format: json, sqlite', 'json')
  .argument('<output>', 'Output file path')
  .action(async (output, options) => {
    const cwd = process.cwd();
    
    // Check if SQLite database exists
    if (!hasSqliteDatabase(cwd)) {
      console.error(chalk.red('No SQLite database found.'));
      console.error(chalk.gray('Run `drift migrate-storage sqlite` to create one.'));
      process.exit(1);
    }
    
    // Validate format
    const format = options.dbFormat || 'json';
    const validFormats = ['json', 'sqlite'];
    if (!validFormats.includes(format)) {
      console.error(chalk.red(`Invalid format: ${format}`));
      console.error(`Valid formats: ${validFormats.join(', ')}`);
      process.exit(1);
    }
    
    console.log();
    console.log(chalk.bold('📦 Drift Database Export'));
    console.log();
    
    try {
      const store = new UnifiedStore({ rootDir: cwd });
      await store.initialize();
      
      const exportFormat = format as 'json' | 'sqlite';
      const data = await store.export(exportFormat);
      
      const outputPath = path.resolve(cwd, output);
      await fs.writeFile(outputPath, data);
      
      await store.close();
      
      const stats = await fs.stat(outputPath);
      const sizeKB = Math.round(stats.size / 1024);
      
      console.log(chalk.green(`✔ Exported database to ${output}`));
      console.log(chalk.gray(`  Format: ${exportFormat}`));
      console.log(chalk.gray(`  Size: ${sizeKB} KB`));
      console.log();
      
      if (exportFormat === 'json') {
        console.log(chalk.gray('To import this backup:'));
        console.log(chalk.cyan(`  drift import db ${output}`));
      } else {
        console.log(chalk.gray('To use this database:'));
        console.log(chalk.cyan(`  cp ${output} .drift/drift.db`));
      }
      console.log();
      
    } catch (error) {
      console.error(chalk.red(`Export failed: ${(error as Error).message}`));
      process.exit(1);
    }
  });

exportCommand.addCommand(dbExportCommand);

