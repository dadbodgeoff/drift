/**
 * drift_files_list - List Files with Patterns
 * 
 * Detail tool that lists files matching a glob pattern with their pattern counts.
 * Supports pagination for large codebases.
 * 
 * Uses IndexStore (by-file.json) for file-to-pattern mapping.
 * Phase 3: Uses async factory for automatic SQLite support.
 */

import { IndexStore } from 'driftdetect-core';
import { createPatternStore } from 'driftdetect-core/storage';

import { createResponseBuilder, createCursor, parseCursor } from '../../infrastructure/index.js';

export interface FileEntry {
  file: string;
  patternCount: number;
  categories: string[];
}

export interface FilesListData {
  files: FileEntry[];
  totalFiles: number;
  totalPatterns: number;
}

const DEFAULT_LIMIT = 20;

export async function handleFilesList(
  projectRoot: string,
  args: {
    path?: string;
    category?: string;
    limit?: number;
    cursor?: string;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<FilesListData>();
  
  // Use IndexStore for file-to-pattern mapping
  const indexStore = new IndexStore({ rootDir: projectRoot });
  await indexStore.initialize();
  
  const fileIndex = await indexStore.getFileIndex();
  
  if (!fileIndex || Object.keys(fileIndex.patterns).length === 0) {
    return builder
      .withSummary('0 files with 0 pattern instances.')
      .withData({ files: [], totalFiles: 0, totalPatterns: 0 })
      .withHints({
        nextActions: ['Run drift scan to discover patterns'],
        relatedTools: ['drift_file_patterns', 'drift_patterns_list'],
      })
      .buildContent();
  }

  const limit = args.limit ?? DEFAULT_LIMIT;
  const offset = args.cursor ? parseCursor(args.cursor).offset : 0;
  const pathPattern = args.path ?? '**/*';
  
  // Get all files from index
  const allFiles = Object.entries(fileIndex.patterns);
  
  // Filter by path pattern (simple glob matching)
  const filteredFiles = allFiles.filter(([filePath]) => 
    matchGlob(filePath, pathPattern)
  );
  
  // Load pattern store to get categories (Phase 3: auto-detects SQLite)
  const patternStore = await createPatternStore({ rootDir: projectRoot });
  
  // Build file entries with pattern info
  let fileEntries: FileEntry[] = filteredFiles.map(([filePath, patternIds]) => {
    const categories = new Set<string>();
    
    for (const patternId of patternIds) {
      const pattern = patternStore.get(patternId);
      if (pattern) {
        categories.add(pattern.category);
      }
    }
    
    return {
      file: filePath,
      patternCount: patternIds.length,
      categories: Array.from(categories).sort(),
    };
  });
  
  // Filter by category if specified
  if (args.category) {
    fileEntries = fileEntries.filter(f => f.categories.includes(args.category!));
  }
  
  // Sort by pattern count (most patterns first)
  fileEntries.sort((a, b) => b.patternCount - a.patternCount);
  
  const totalFiles = fileEntries.length;
  const totalPatterns = fileEntries.reduce((sum, f) => sum + f.patternCount, 0);
  
  // Apply pagination
  const paginatedFiles = fileEntries.slice(offset, offset + limit);
  const hasMore = offset + limit < totalFiles;
  
  const data: FilesListData = {
    files: paginatedFiles,
    totalFiles,
    totalPatterns,
  };

  // Build summary
  let summary = `${totalFiles} files with ${totalPatterns} pattern instances.`;
  if (args.path && args.path !== '**/*') {
    summary = `Matching "${args.path}": ${summary}`;
  }
  if (args.category) {
    summary += ` Filtered to ${args.category} category.`;
  }
  
  // Add pagination
  if (hasMore) {
    builder.withPagination({
      cursor: createCursor(offset + limit, limit),
      hasMore: true,
      totalCount: totalFiles,
      pageSize: limit,
    });
  }
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: paginatedFiles.length > 0
        ? [
            'Use drift_file_patterns with a specific file to see its patterns',
            hasMore ? `Use cursor="${createCursor(offset + limit, limit)}" to see more files` : '',
          ].filter(Boolean)
        : ['Run drift scan to discover patterns'],
      relatedTools: ['drift_file_patterns', 'drift_patterns_list'],
    })
    .buildContent();
}

/**
 * Simple glob matching (supports * and **)
 */
function matchGlob(filePath: string, pattern: string): boolean {
  if (pattern === '**/*' || pattern === '*') {return true;}
  
  // Escape special regex chars first, then handle glob patterns
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*')
    .replace(/\?/g, '.');
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}
