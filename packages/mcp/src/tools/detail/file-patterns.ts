/**
 * drift_file_patterns - Patterns in a Specific File
 * 
 * Detail tool that returns all patterns found in a specific file.
 * Shows pattern details, locations within the file, and outliers.
 * 
 * Uses IndexStore (by-file.json) for file-to-pattern mapping.
 * Phase 3: Uses async factory for automatic SQLite support.
 */

import { IndexStore } from 'driftdetect-core';
import { createPatternStore } from 'driftdetect-core/storage';

import { createResponseBuilder, Errors } from '../../infrastructure/index.js';

export interface FilePatternLocation {
  line: number;
  column?: number;
  snippet?: string;
}

export interface FilePattern {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  confidence: number;
  locations: FilePatternLocation[];
  isOutlier: boolean;
  outlierReason?: string;
}

export interface FilePatternData {
  file: string;
  patterns: FilePattern[];
  patternCount: number;
  outlierCount: number;
  categories: string[];
}

export async function handleFilePatterns(
  projectRoot: string,
  args: {
    file: string;
    category?: string;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<FilePatternData>();
  
  if (!args.file) {
    throw Errors.missingParameter('file');
  }
  
  // Use IndexStore for file-to-pattern mapping
  const indexStore = new IndexStore({ rootDir: projectRoot });
  await indexStore.initialize();
  
  const fileIndex = await indexStore.getFileIndex();
  
  // Normalize file path
  const filePath = args.file.replace(/^\.\//, '');
  
  // Check if file exists in index
  const patternIds = fileIndex?.patterns[filePath];
  if (!patternIds || patternIds.length === 0) {
    throw Errors.notFound('file', filePath);
  }
  
  // Load pattern store to get full pattern details (Phase 3: auto-detects SQLite)
  const patternStore = await createPatternStore({ rootDir: projectRoot });
  
  // Get patterns for this file
  const patterns: FilePattern[] = [];
  const categories = new Set<string>();
  let outlierCount = 0;
  
  for (const patternId of patternIds) {
    const pattern = patternStore.get(patternId);
    if (!pattern) {continue;}
    
    // Filter by category if specified
    if (args.category && pattern.category !== args.category) {
      continue;
    }
    
    categories.add(pattern.category);
    
    // Get locations in this file
    const fileLocations: FilePatternLocation[] = pattern.locations
      .filter(loc => loc.file === filePath)
      .map(loc => {
        const result: FilePatternLocation = {
          line: loc.line,
        };
        if (loc.column) {
          result.column = loc.column;
        }
        return result;
      });
    
    // Check if this file is an outlier for this pattern
    const outlier = pattern.outliers.find(o => o.file === filePath);
    if (outlier) {
      outlierCount++;
    }
    
    const patternEntry: FilePattern = {
      id: pattern.id,
      name: pattern.name,
      category: pattern.category,
      subcategory: pattern.subcategory ?? '',
      confidence: Math.round(pattern.confidence.score * 100) / 100,
      locations: fileLocations,
      isOutlier: !!outlier,
    };
    
    if (outlier) {
      patternEntry.outlierReason = 'Deviates from pattern';
    }
    
    patterns.push(patternEntry);
  }
  
  // Sort by category, then by name
  patterns.sort((a, b) => {
    if (a.category !== b.category) {return a.category.localeCompare(b.category);}
    return a.name.localeCompare(b.name);
  });
  
  const data: FilePatternData = {
    file: filePath,
    patterns,
    patternCount: patterns.length,
    outlierCount,
    categories: Array.from(categories).sort(),
  };
  
  // Build summary
  let summary = `${filePath}: ${patterns.length} patterns`;
  if (outlierCount > 0) {
    summary += ` (${outlierCount} outliers)`;
  }
  summary += `. Categories: ${Array.from(categories).join(', ') || 'none'}.`;
  
  const hints: { nextActions: string[]; warnings?: string[]; relatedTools: string[] } = {
    nextActions: [
      'Use drift_pattern_get for full pattern details',
      'Use drift_code_examples to see implementations',
    ],
    relatedTools: ['drift_pattern_get', 'drift_code_examples', 'drift_files_list'],
  };
  
  if (outlierCount > 0) {
    hints.warnings = [
      `${outlierCount} pattern(s) deviate from codebase conventions in this file`,
    ];
  }
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints(hints)
    .buildContent();
}
