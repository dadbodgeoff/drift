/**
 * Files Command - Show patterns in a file
 *
 * Show what patterns are found in a specific file.
 * Now reads from BOTH ManifestStore and PatternStore to ensure
 * all 15 categories are available.
 *
 * Usage:
 *   drift files src/auth/middleware.py
 *   drift files 'src/api/*.ts'
 *   drift files --json src/api/
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  ManifestStore,
  PatternStore,
  type FileQuery,
  type PatternCategory,
} from 'driftdetect-core';

export const filesCommand = new Command('files')
  .description('Show patterns in a file')
  .argument('<path>', 'File path (supports glob patterns)')
  .option('-c, --category <category>', 'Filter by category')
  .option('--json', 'Output as JSON')
  .action(async (filePath, options) => {
    const cwd = process.cwd();

    // Load manifest
    const manifestStore = new ManifestStore(cwd);
    const manifest = await manifestStore.load();

    // Also load from PatternStore to get ALL 15 categories
    const patternStore = new PatternStore({ rootDir: cwd });
    await patternStore.initialize();
    const allPatterns = patternStore.getAll();

    if (!manifest && allPatterns.length === 0) {
      console.error(chalk.red('No patterns found. Run `drift scan` first.'));
      process.exit(1);
    }

    // Build query
    const query: FileQuery = {
      path: filePath,
    };
    if (options.category) {
      query.category = options.category as PatternCategory;
    }

    // Query file from manifest
    let result = manifest ? manifestStore.queryFile(query) : null;

    // Also search in PatternStore for patterns in this file
    // This ensures all 15 categories are searched
    const patternStoreResults: Array<{
      id: string;
      name: string;
      category: PatternCategory;
      locations: Array<{
        range: { start: number; end: number };
        type: string;
        name: string;
      }>;
    }> = [];

    // Match file path (supports glob-like patterns)
    const normalizedPath = filePath.replace(/\\/g, '/');
    const isGlob = normalizedPath.includes('*');
    
    for (const pattern of allPatterns) {
      // Filter by category if specified
      if (options.category && pattern.category !== options.category) {
        continue;
      }

      // Find locations in this file
      const matchingLocations = pattern.locations.filter(loc => {
        const locPath = loc.file.replace(/\\/g, '/');
        if (isGlob) {
          return matchGlob(locPath, normalizedPath);
        }
        return locPath === normalizedPath || locPath.endsWith(normalizedPath) || locPath.includes(normalizedPath);
      });

      if (matchingLocations.length > 0) {
        patternStoreResults.push({
          id: pattern.id,
          name: pattern.name,
          category: pattern.category,
          locations: matchingLocations.map(loc => ({
            range: { start: loc.line, end: loc.endLine || loc.line },
            type: 'block',
            name: `line-${loc.line}`,
          })),
        });
      }
    }

    // Merge results
    const mergedPatterns = new Map<string, {
      id: string;
      name: string;
      category: PatternCategory;
      locations: Array<{
        range: { start: number; end: number };
        type: string;
        name: string;
      }>;
    }>();

    // Add manifest results
    if (result) {
      for (const p of result.patterns) {
        mergedPatterns.set(p.id, p);
      }
    }

    // Add PatternStore results (may add new categories)
    for (const p of patternStoreResults) {
      if (!mergedPatterns.has(p.id)) {
        mergedPatterns.set(p.id, p);
      }
    }

    const finalPatterns = Array.from(mergedPatterns.values());

    if (finalPatterns.length === 0) {
      console.log(chalk.yellow(`No patterns found in "${filePath}"`));
      
      // Show available files from PatternStore
      const allFiles = new Set<string>();
      for (const pattern of allPatterns) {
        for (const loc of pattern.locations) {
          allFiles.add(loc.file);
        }
      }
      
      const fileList = Array.from(allFiles).slice(0, 10);
      if (fileList.length > 0) {
        console.log(chalk.dim('\nFiles with patterns:'));
        for (const f of fileList) {
          console.log(chalk.dim(`  ${f}`));
        }
        if (allFiles.size > 10) {
          console.log(chalk.dim(`  ... and ${allFiles.size - 10} more`));
        }
      }
      
      process.exit(0);
    }

    // Build final result
    const finalResult = {
      file: result?.file || filePath,
      patterns: finalPatterns,
      metadata: result?.metadata || {
        hash: '',
        patterns: finalPatterns.map(p => p.id),
        lastScanned: new Date().toISOString(),
      },
    };

    // Output
    if (options.json) {
      console.log(JSON.stringify(finalResult, null, 2));
    } else {
      console.log(chalk.bold(`\n📄 Patterns in ${finalResult.file}:\n`));
      if (finalResult.metadata.hash) {
        console.log(chalk.dim(`  Hash: ${finalResult.metadata.hash}`));
      }
      console.log(chalk.dim(`  Last scanned: ${finalResult.metadata.lastScanned}`));
      console.log('');

      if (finalResult.patterns.length === 0) {
        console.log(chalk.yellow('  No patterns found'));
      } else {
        // Group by category
        const byCategory = new Map<string, typeof finalResult.patterns>();
        for (const p of finalResult.patterns) {
          if (!byCategory.has(p.category)) {
            byCategory.set(p.category, []);
          }
          byCategory.get(p.category)!.push(p);
        }

        for (const [category, patterns] of byCategory) {
          console.log(chalk.cyan(`  ${category.toUpperCase()}`));
          
          for (const p of patterns) {
            console.log(`    • ${chalk.white(p.name)}`);
            
            for (const loc of p.locations) {
              const range = `${loc.range.start}-${loc.range.end}`;
              console.log(`      ${chalk.dim('lines')} ${chalk.yellow(range)}: ${loc.type} ${chalk.green(loc.name)}`);
            }
          }
          
          console.log('');
        }
      }

      console.log(chalk.dim(`Total: ${finalResult.patterns.length} patterns`));
    }
  });

/**
 * Simple glob matching
 */
function matchGlob(filePath: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}
