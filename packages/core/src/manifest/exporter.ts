/**
 * Manifest Exporter - Export manifest in various formats
 *
 * Supports:
 * - JSON: Full manifest as JSON
 * - AI Context: Optimized markdown for LLM consumption
 * - Summary: Human-readable summary
 * - Markdown: Detailed markdown report
 *
 * @requirements PATTERN-LOCATION-DISCOVERY.md
 */

import type {
  Manifest,
  ManifestPattern,
  SemanticLocation,
  ExportOptions,
  TokenEstimate,
} from './types.js';

/** Token thresholds for warnings */
const TOKEN_THRESHOLDS = {
  SMALL: 4000,
  MEDIUM: 8000,
  LARGE: 32000,
  XLARGE: 128000,
};

/**
 * Export manifest in the specified format
 */
export function exportManifest(manifest: Manifest, options: ExportOptions): string {
  // Filter patterns based on options
  const filteredPatterns = filterPatterns(manifest, options);

  switch (options.format) {
    case 'json':
      return exportJson(manifest, filteredPatterns, options);
    case 'ai-context':
      return exportAiContext(manifest, filteredPatterns, options);
    case 'summary':
      return exportSummary(manifest, filteredPatterns, options);
    case 'markdown':
      return exportMarkdown(manifest, filteredPatterns, options);
    default:
      throw new Error(`Unknown export format: ${options.format}`);
  }
}

/**
 * Estimate token count for content
 */
export function estimateTokens(content: string): TokenEstimate {
  // Rough estimate: ~4 characters per token for code/technical content
  const tokens = Math.ceil(content.length / 4);

  let category: TokenEstimate['category'];
  let warning: string | undefined;

  if (tokens < TOKEN_THRESHOLDS.SMALL) {
    category = 'small';
  } else if (tokens < TOKEN_THRESHOLDS.MEDIUM) {
    category = 'medium';
  } else if (tokens < TOKEN_THRESHOLDS.LARGE) {
    category = 'large';
    warning = `Output is ~${tokens} tokens. Consider using --compact or filtering categories.`;
  } else {
    category = 'xlarge';
    warning = `Output is ~${tokens} tokens (very large). Use --compact and filter categories.`;
  }

  const result: TokenEstimate = { tokens, category };
  if (warning) {
    result.warning = warning;
  }
  return result;
}

// ============================================================================
// Export Formats
// ============================================================================

function exportJson(
  manifest: Manifest,
  patterns: ManifestPattern[],
  options: ExportOptions
): string {
  const output = {
    version: manifest.version,
    generated: manifest.generated,
    codebaseHash: manifest.codebaseHash,
    summary: manifest.summary,
    patterns: options.compact
      ? patterns.map(p => ({
          id: p.id,
          name: p.name,
          category: p.category,
          status: p.status,
          confidence: p.confidence,
          locationCount: p.locations.length,
          outlierCount: p.outliers.length,
        }))
      : patterns,
  };

  return JSON.stringify(output, null, options.compact ? 0 : 2);
}

function exportAiContext(
  manifest: Manifest,
  patterns: ManifestPattern[],
  options: ExportOptions
): string {
  const lines: string[] = [];

  // Header
  lines.push('# Architecture Manifest');
  lines.push('');
  lines.push(`Generated: ${manifest.generated.split('T')[0]} | Patterns: ${patterns.length} | Files: ${manifest.summary.totalFiles}`);
  lines.push('');

  // Group patterns by category
  const byCategory = groupByCategory(patterns);

  for (const [category, categoryPatterns] of Object.entries(byCategory)) {
    lines.push(`## ${formatCategory(category)} (${categoryPatterns.length} patterns)`);
    lines.push('');

    for (const pattern of categoryPatterns) {
      const locationSummary = summarizeLocations(pattern.locations, options.compact);
      lines.push(`- **${pattern.name}** [${pattern.status}] (${Math.round(pattern.confidence * 100)}% confidence)`);

      if (options.compact) {
        lines.push(`  ${pattern.locations.length} locations in ${countUniqueFiles(pattern.locations)} files`);
      } else {
        for (const loc of locationSummary) {
          lines.push(`  → \`${loc.file}:${loc.range.start}-${loc.range.end}\``);
          if (loc.type !== 'file') {
            lines.push(`    ${loc.type}: \`${loc.name}\`${loc.signature ? ` - ${loc.signature}` : ''}`);
          }
          if (loc.members && loc.members.length > 0) {
            const memberNames = loc.members.map(m => m.name).join(', ');
            lines.push(`    Members: ${memberNames}`);
          }
        }
      }

      if (pattern.outliers.length > 0) {
        lines.push(`  ⚠️ ${pattern.outliers.length} outliers`);
      }

      lines.push('');
    }
  }

  // File index (compact)
  if (!options.compact && Object.keys(manifest.files).length <= 50) {
    lines.push('## File Index');
    lines.push('');
    lines.push('| File | Patterns |');
    lines.push('|------|----------|');

    const sortedFiles = Object.entries(manifest.files)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 50);

    for (const [file, data] of sortedFiles) {
      const patternCount = data.patterns.length;
      lines.push(`| ${file} | ${patternCount} |`);
    }
  }

  let output = lines.join('\n');

  // Check token limit
  if (options.maxTokens) {
    const estimate = estimateTokens(output);
    if (estimate.tokens > options.maxTokens) {
      // Truncate and add warning
      const targetLength = options.maxTokens * 4; // Rough char estimate
      output = output.substring(0, targetLength);
      output += '\n\n---\n*[Truncated due to token limit]*';
    }
  }

  return output;
}

function exportSummary(
  manifest: Manifest,
  patterns: ManifestPattern[],
  _options: ExportOptions
): string {
  const lines: string[] = [];

  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║                    DRIFT ARCHITECTURE SUMMARY                 ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`Generated: ${manifest.generated}`);
  lines.push(`Codebase Hash: ${manifest.codebaseHash}`);
  lines.push('');

  // Summary stats
  lines.push('┌─────────────────────────────────────────────────────────────┐');
  lines.push('│ SUMMARY                                                      │');
  lines.push('├─────────────────────────────────────────────────────────────┤');
  lines.push(`│ Total Patterns:    ${String(patterns.length).padStart(6)}                                  │`);
  lines.push(`│ Total Files:       ${String(manifest.summary.totalFiles).padStart(6)}                                  │`);
  lines.push(`│ Total Locations:   ${String(manifest.summary.totalLocations).padStart(6)}                                  │`);
  lines.push(`│ Total Outliers:    ${String(manifest.summary.totalOutliers).padStart(6)}                                  │`);
  lines.push('└─────────────────────────────────────────────────────────────┘');
  lines.push('');

  // By status
  lines.push('BY STATUS:');
  lines.push(`  Discovered: ${manifest.summary.patternsByStatus.discovered}`);
  lines.push(`  Approved:   ${manifest.summary.patternsByStatus.approved}`);
  lines.push(`  Ignored:    ${manifest.summary.patternsByStatus.ignored}`);
  lines.push('');

  // By category
  lines.push('BY CATEGORY:');
  const byCategory = groupByCategory(patterns);
  for (const [category, categoryPatterns] of Object.entries(byCategory)) {
    const outlierCount = categoryPatterns.reduce((sum, p) => sum + p.outliers.length, 0);
    lines.push(`  ${formatCategory(category).padEnd(15)} ${String(categoryPatterns.length).padStart(3)} patterns, ${String(outlierCount).padStart(4)} outliers`);
  }
  lines.push('');

  // High confidence patterns
  const highConfidence = patterns.filter(p => p.confidence >= 0.85);
  if (highConfidence.length > 0) {
    lines.push('HIGH CONFIDENCE PATTERNS (ready for approval):');
    for (const p of highConfidence.slice(0, 10)) {
      lines.push(`  • ${p.name} (${Math.round(p.confidence * 100)}%)`);
    }
    if (highConfidence.length > 10) {
      lines.push(`  ... and ${highConfidence.length - 10} more`);
    }
  }

  return lines.join('\n');
}

function exportMarkdown(
  manifest: Manifest,
  patterns: ManifestPattern[],
  options: ExportOptions
): string {
  const lines: string[] = [];

  lines.push('# Drift Architecture Report');
  lines.push('');
  lines.push(`**Generated:** ${manifest.generated}`);
  lines.push(`**Codebase Hash:** \`${manifest.codebaseHash}\``);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Patterns | ${patterns.length} |`);
  lines.push(`| Total Files | ${manifest.summary.totalFiles} |`);
  lines.push(`| Total Locations | ${manifest.summary.totalLocations} |`);
  lines.push(`| Total Outliers | ${manifest.summary.totalOutliers} |`);
  lines.push('');

  // Patterns by category
  const byCategory = groupByCategory(patterns);

  for (const [category, categoryPatterns] of Object.entries(byCategory)) {
    lines.push(`## ${formatCategory(category)}`);
    lines.push('');

    for (const pattern of categoryPatterns) {
      lines.push(`### ${pattern.name}`);
      lines.push('');
      lines.push(`- **ID:** \`${pattern.id}\``);
      lines.push(`- **Status:** ${pattern.status}`);
      lines.push(`- **Confidence:** ${Math.round(pattern.confidence * 100)}%`);
      lines.push(`- **Locations:** ${pattern.locations.length}`);
      lines.push(`- **Outliers:** ${pattern.outliers.length}`);
      lines.push('');

      if (pattern.description) {
        lines.push(pattern.description);
        lines.push('');
      }

      // Location details
      if (!options.compact && pattern.locations.length > 0) {
        lines.push('**Locations:**');
        lines.push('');
        for (const loc of pattern.locations.slice(0, 10)) {
          lines.push(`- \`${loc.file}:${loc.range.start}-${loc.range.end}\` - ${loc.type} \`${loc.name}\``);
          if (options.includeSnippets && loc.snippet) {
            lines.push('  ```');
            lines.push(`  ${loc.snippet}`);
            lines.push('  ```');
          }
        }
        if (pattern.locations.length > 10) {
          lines.push(`- ... and ${pattern.locations.length - 10} more`);
        }
        lines.push('');
      }

      // Outlier details
      if (pattern.outliers.length > 0) {
        lines.push('**Outliers:**');
        lines.push('');
        for (const outlier of pattern.outliers.slice(0, 5)) {
          lines.push(`- ⚠️ \`${outlier.file}:${outlier.range.start}\` - ${outlier.name}`);
        }
        if (pattern.outliers.length > 5) {
          lines.push(`- ... and ${pattern.outliers.length - 5} more`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Helper Functions
// ============================================================================

function filterPatterns(manifest: Manifest, options: ExportOptions): ManifestPattern[] {
  let patterns = Object.values(manifest.patterns);

  // Filter by category
  if (options.categories && options.categories.length > 0) {
    patterns = patterns.filter(p => options.categories!.includes(p.category));
  }

  // Filter by status
  if (options.statuses && options.statuses.length > 0) {
    patterns = patterns.filter(p => options.statuses!.includes(p.status));
  }

  // Filter by confidence
  if (options.minConfidence !== undefined) {
    patterns = patterns.filter(p => p.confidence >= options.minConfidence!);
  }

  // Sort by category, then by name
  patterns.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.name.localeCompare(b.name);
  });

  return patterns;
}

function groupByCategory(patterns: ManifestPattern[]): Record<string, ManifestPattern[]> {
  const grouped: Record<string, ManifestPattern[]> = {};

  for (const pattern of patterns) {
    if (!grouped[pattern.category]) {
      grouped[pattern.category] = [];
    }
    grouped[pattern.category]!.push(pattern);
  }

  return grouped;
}

function formatCategory(category: string): string {
  return category
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function summarizeLocations(
  locations: SemanticLocation[],
  compact?: boolean
): SemanticLocation[] {
  if (compact) {
    // Return just first 3 locations
    return locations.slice(0, 3);
  }

  // Group by file and return representative locations
  const byFile = new Map<string, SemanticLocation[]>();
  for (const loc of locations) {
    if (!byFile.has(loc.file)) {
      byFile.set(loc.file, []);
    }
    byFile.get(loc.file)!.push(loc);
  }

  // Return first location from each file (up to 10 files)
  const result: SemanticLocation[] = [];
  let fileCount = 0;
  for (const [, fileLocs] of byFile) {
    if (fileCount >= 10) {break;}
    const firstLoc = fileLocs[0];
    if (firstLoc) {
      result.push(firstLoc);
    }
    fileCount++;
  }

  return result;
}

function countUniqueFiles(locations: SemanticLocation[]): number {
  const files = new Set(locations.map(l => l.file));
  return files.size;
}
