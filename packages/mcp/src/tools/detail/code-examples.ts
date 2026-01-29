/**
 * drift_code_examples - Real Code Examples
 * 
 * Detail tool that returns actual code snippets demonstrating patterns.
 * Essential before generating new code to match codebase conventions.
 * 
 * MIGRATION: Now supports both legacy PatternStore and new IPatternService.
 * The service-based approach is preferred for new code.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import { createResponseBuilder, Errors } from '../../infrastructure/index.js';

import type { PatternStore, PatternCategory, IPatternService } from 'driftdetect-core';

export interface CodeExample {
  patternId: string;
  patternName: string;
  category: string;
  file: string;
  line: number;
  code: string;
  explanation?: string;
}

export interface CodeExamplesData {
  examples: CodeExample[];
  patternsFound: number;
  examplesReturned: number;
}

export interface CodeExamplesArgs {
  categories?: string[];
  pattern?: string;
  maxExamples?: number;
  contextLines?: number;
}

const VALID_CATEGORIES: PatternCategory[] = [
  'api', 'auth', 'security', 'errors', 'logging',
  'data-access', 'config', 'testing', 'performance',
  'components', 'styling', 'structural', 'types',
  'accessibility', 'documentation',
];

const DEFAULT_MAX_EXAMPLES = 3;
const DEFAULT_CONTEXT_LINES = 10;

/**
 * Handle code examples using IPatternService (preferred)
 */
export async function handleCodeExamplesWithService(
  service: IPatternService,
  projectRoot: string,
  args: CodeExamplesArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<CodeExamplesData>();
  
  // Validate categories
  if (args.categories) {
    for (const cat of args.categories) {
      if (!VALID_CATEGORIES.includes(cat as PatternCategory)) {
        throw Errors.invalidCategory(cat, VALID_CATEGORIES);
      }
    }
  }
  
  const maxExamples = args.maxExamples ?? DEFAULT_MAX_EXAMPLES;
  const contextLines = args.contextLines ?? DEFAULT_CONTEXT_LINES;
  
  // Get patterns to show examples for
  const result = await service.query({
    filter: {
      categories: args.categories as PatternCategory[] | undefined,
      search: args.pattern,
    },
    sort: {
      field: 'confidence',
      direction: 'desc',
    },
    pagination: {
      offset: 0,
      limit: 10, // Limit patterns to process
    },
  });
  
  let patterns = result.patterns;
  
  // If searching by specific pattern ID, also check exact match
  if (args.pattern && !patterns.some(p => p.id === args.pattern)) {
    const exactMatch = await service.getPattern(args.pattern);
    if (exactMatch) {
      patterns = [exactMatch, ...patterns];
    }
  }
  
  const examples: CodeExample[] = [];
  
  for (const pattern of patterns) {
    // Get best locations (highest confidence, not outliers)
    const outlierFiles = new Set(pattern.outliers.map(o => `${o.file}:${o.line}`));
    const goodLocations = pattern.locations
      .filter(loc => !outlierFiles.has(`${loc.file}:${loc.line}`))
      .slice(0, maxExamples);
    
    for (const loc of goodLocations) {
      try {
        const code = await extractCodeSnippet(
          path.join(projectRoot, loc.file),
          loc.line,
          contextLines
        );
        
        if (code) {
          examples.push({
            patternId: pattern.id,
            patternName: pattern.name,
            category: pattern.category,
            file: loc.file,
            line: loc.line,
            code,
            explanation: pattern.description,
          });
        }
      } catch {
        // Skip files that can't be read
        continue;
      }
      
      // Limit total examples
      if (examples.length >= maxExamples * 5) {break;}
    }
    
    if (examples.length >= maxExamples * 5) {break;}
  }
  
  const data: CodeExamplesData = {
    examples,
    patternsFound: patterns.length,
    examplesReturned: examples.length,
  };
  
  // Build summary
  let summary = `${examples.length} code examples from ${patterns.length} patterns.`;
  if (args.categories?.length) {
    summary = `${args.categories.join(', ')}: ${summary}`;
  }
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: examples.length > 0
        ? [
            'Use these examples as templates for new code',
            'Use drift_pattern_get for more details on specific patterns',
          ]
        : [
            'Try different categories or run drift scan',
          ],
      relatedTools: ['drift_pattern_get', 'drift_patterns_list'],
    })
    .buildContent();
}

/**
 * Handle code examples using legacy PatternStore (backward compatibility)
 * @deprecated Use handleCodeExamplesWithService instead
 */
export async function handleCodeExamples(
  store: PatternStore,
  projectRoot: string,
  args: CodeExamplesArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<CodeExamplesData>();
  
  // Validate categories
  if (args.categories) {
    for (const cat of args.categories) {
      if (!VALID_CATEGORIES.includes(cat as PatternCategory)) {
        throw Errors.invalidCategory(cat, VALID_CATEGORIES);
      }
    }
  }
  
  await store.initialize();
  
  const maxExamples = args.maxExamples ?? DEFAULT_MAX_EXAMPLES;
  const contextLines = args.contextLines ?? DEFAULT_CONTEXT_LINES;
  
  // Get patterns to show examples for
  let patterns = store.getAll();
  
  // Filter by categories
  if (args.categories && args.categories.length > 0) {
    const cats = new Set(args.categories);
    patterns = patterns.filter(p => cats.has(p.category));
  }
  
  // Filter by specific pattern
  if (args.pattern) {
    const searchLower = args.pattern.toLowerCase();
    patterns = patterns.filter(p => 
      p.id === args.pattern ||
      p.name.toLowerCase().includes(searchLower)
    );
  }
  
  // Sort by confidence (highest first) and take top patterns
  patterns.sort((a, b) => b.confidence.score - a.confidence.score);
  patterns = patterns.slice(0, 10); // Limit patterns to process
  
  const examples: CodeExample[] = [];
  
  for (const pattern of patterns) {
    // Get best locations (highest confidence, not outliers)
    const outlierFiles = new Set(pattern.outliers.map(o => `${o.file}:${o.line}`));
    const goodLocations = pattern.locations
      .filter(loc => !outlierFiles.has(`${loc.file}:${loc.line}`))
      .slice(0, maxExamples);
    
    for (const loc of goodLocations) {
      try {
        const code = await extractCodeSnippet(
          path.join(projectRoot, loc.file),
          loc.line,
          contextLines
        );
        
        if (code) {
          examples.push({
            patternId: pattern.id,
            patternName: pattern.name,
            category: pattern.category,
            file: loc.file,
            line: loc.line,
            code,
            explanation: pattern.description,
          });
        }
      } catch {
        // Skip files that can't be read
        continue;
      }
      
      // Limit total examples
      if (examples.length >= maxExamples * 5) {break;}
    }
    
    if (examples.length >= maxExamples * 5) {break;}
  }
  
  const data: CodeExamplesData = {
    examples,
    patternsFound: patterns.length,
    examplesReturned: examples.length,
  };
  
  // Build summary
  let summary = `${examples.length} code examples from ${patterns.length} patterns.`;
  if (args.categories?.length) {
    summary = `${args.categories.join(', ')}: ${summary}`;
  }
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: examples.length > 0
        ? [
            'Use these examples as templates for new code',
            'Use drift_pattern_get for more details on specific patterns',
          ]
        : [
            'Try different categories or run drift scan',
          ],
      relatedTools: ['drift_pattern_get', 'drift_patterns_list'],
    })
    .buildContent();
}

async function extractCodeSnippet(
  filePath: string,
  targetLine: number,
  contextLines: number
): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    
    const startLine = Math.max(0, targetLine - contextLines - 1);
    const endLine = Math.min(lines.length, targetLine + contextLines);
    
    const snippet = lines.slice(startLine, endLine);
    
    // Add line numbers
    return snippet
      .map((line, i) => {
        const lineNum = startLine + i + 1;
        const marker = lineNum === targetLine ? '>' : ' ';
        return `${marker}${lineNum.toString().padStart(4)} | ${line}`;
      })
      .join('\n');
  } catch {
    return null;
  }
}
