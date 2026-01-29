/**
 * Files Command - Show patterns in a file
 *
 * Show what patterns are found in a specific file.
 *
 * MIGRATION: Now uses IPatternService for pattern operations.
 *
 * Usage:
 *   drift files src/auth/middleware.py
 *   drift files 'src/api/*.ts'
 *   drift files --json src/api/
 */

import chalk from 'chalk';
import { Command } from 'commander';

import { createCLIPatternService } from '../services/pattern-service-factory.js';

import type { PatternCategory } from 'driftdetect-core';


export const filesCommand = new Command('files')
  .description('Show patterns in a file')
  .argument('<path>', 'File path (supports glob patterns)')
  .option('-c, --category <category>', 'Filter by category')
  .option('--json', 'Output as JSON')
  .action(async (filePath, options) => {
    const cwd = process.cwd();

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

    // Search for patterns in this file
    const patternResults: Array<{
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
    
    for (const pattern of validPatterns) {
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
        patternResults.push({
          id: pattern.id,
          name: pattern.name,
          category: pattern.category,
          locations: matchingLocations.map(loc => ({
            range: { start: loc.line, end: loc.endLine ?? loc.line },
            type: 'block',
            name: `line-${loc.line}`,
          })),
        });
      }
    }

    if (patternResults.length === 0) {
      console.log(chalk.yellow(`No patterns found in "${filePath}"`));
      
      // Show available files from patterns
      const allFiles = new Set<string>();
      for (const pattern of validPatterns) {
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
      file: filePath,
      patterns: patternResults,
      metadata: {
        hash: '',
        patterns: patternResults.map(p => p.id),
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
