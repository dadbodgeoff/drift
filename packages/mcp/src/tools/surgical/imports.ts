/**
 * drift_imports - Resolve Correct Imports
 * 
 * Layer: Surgical
 * Token Budget: 300 target, 600 max
 * Cache TTL: 5 minutes
 * Invalidation Keys: callgraph, file:{targetFile}
 * 
 * Resolves correct import statements based on codebase conventions.
 * Solves: Every codebase has different import conventions. AI guesses wrong.
 */

import * as path from 'node:path';

import { createResponseBuilder, Errors, metrics } from '../../infrastructure/index.js';

import type { CallGraphStore, FunctionNode } from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export interface ImportsArgs {
  /** Symbols that need to be imported */
  symbols: string[];
  /** File where imports will be added */
  targetFile: string;
}

export interface ImportConventions {
  style: 'barrel' | 'deep' | 'mixed';
  pathStyle: 'relative' | 'alias' | 'absolute';
  alias?: string;
  preferNamed: boolean;
  preferType: boolean;
}

export interface ImportsData {
  imports: string[];
  unresolved: string[];
  conventions: ImportConventions;
}

// ============================================================================
// Handler
// ============================================================================

export async function handleImports(
  store: CallGraphStore,
  args: ImportsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const startTime = Date.now();
  const builder = createResponseBuilder<ImportsData>();
  
  // Validate input
  if (!args.symbols || args.symbols.length === 0) {
    throw Errors.missingParameter('symbols');
  }
  if (!args.targetFile) {
    throw Errors.missingParameter('targetFile');
  }
  
  const symbols = args.symbols.map(s => s.trim()).filter(s => s.length > 0);
  const targetFile = args.targetFile;
  
  // Load call graph
  await store.initialize();
  const graph = store.getGraph();
  
  if (!graph) {
    throw Errors.custom(
      'CALLGRAPH_NOT_BUILT',
      'Call graph has not been built. Run "drift callgraph build" first.',
      ['drift_status']
    );
  }
  
  // Analyze existing import conventions in the codebase
  const conventions = analyzeImportConventions(graph);
  
  // Find where each symbol is exported
  const symbolSources = new Map<string, { file: string; isDefault: boolean; isType: boolean }>();
  
  for (const [, func] of graph.functions) {
    if (func.isExported) {
      // Check if this function matches any requested symbol
      for (const symbol of symbols) {
        if (func.name === symbol || func.qualifiedName.endsWith(`.${symbol}`)) {
          symbolSources.set(symbol, {
            file: func.file,
            isDefault: false, // Functions are typically named exports
            isType: false,
          });
        }
      }
    }
  }
  
  // Build import statements
  const imports: string[] = [];
  const unresolved: string[] = [];
  
  // Group symbols by source file
  const bySource = new Map<string, string[]>();
  
  for (const symbol of symbols) {
    const source = symbolSources.get(symbol);
    if (source) {
      const existing = bySource.get(source.file) ?? [];
      existing.push(symbol);
      bySource.set(source.file, existing);
    } else {
      unresolved.push(symbol);
    }
  }
  
  // Generate import statements
  for (const [sourceFile, syms] of bySource) {
    const importPath = resolveImportPath(sourceFile, targetFile, conventions);
    const importStatement = buildImportStatement(syms, importPath, conventions);
    imports.push(importStatement);
  }
  
  const data: ImportsData = {
    imports,
    unresolved,
    conventions,
  };
  
  // Build summary
  let summary: string;
  if (imports.length === 0 && unresolved.length > 0) {
    summary = `Could not resolve imports for: ${unresolved.join(', ')}`;
  } else if (unresolved.length > 0) {
    summary = `Generated ${imports.length} import${imports.length !== 1 ? 's' : ''}, ${unresolved.length} unresolved`;
  } else {
    summary = `Generated ${imports.length} import${imports.length !== 1 ? 's' : ''} for ${symbols.length} symbol${symbols.length !== 1 ? 's' : ''}`;
  }
  
  // Build hints
  const hints: { nextActions: string[]; relatedTools: string[]; warnings?: string[] } = {
    nextActions: imports.length > 0
      ? ['Copy imports to your file', 'Use drift_prevalidate to check your code']
      : ['Use drift_signature to find the correct symbol name', 'Check if the symbol exists in the codebase'],
    relatedTools: ['drift_signature', 'drift_prevalidate', 'drift_similar'],
  };
  
  if (unresolved.length > 0) {
    hints.warnings = [`Could not find exports for: ${unresolved.join(', ')}`];
  }
  
  // Record metrics
  metrics.recordRequest('drift_imports', Date.now() - startTime, true, false);
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints(hints)
    .buildContent();
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Analyze import conventions from the codebase
 */
function analyzeImportConventions(
  graph: { functions: Map<string, FunctionNode> }
): ImportConventions {
  // Default conventions (TypeScript-style)
  const conventions: ImportConventions = {
    style: 'mixed',
    pathStyle: 'relative',
    preferNamed: true,
    preferType: true,
  };
  
  // Look for path alias patterns in file paths
  for (const [, func] of graph.functions) {
    // Check for common alias patterns
    if (func.file.includes('@/') || func.file.includes('~/')) {
      conventions.pathStyle = 'alias';
      conventions.alias = func.file.includes('@/') ? '@/' : '~/';
      break;
    }
  }
  
  // Check for barrel file patterns (index.ts exports)
  let barrelCount = 0;
  let deepCount = 0;
  
  for (const [, func] of graph.functions) {
    if (func.file.endsWith('index.ts') || func.file.endsWith('index.js')) {
      barrelCount++;
    } else {
      deepCount++;
    }
  }
  
  if (barrelCount > deepCount * 0.3) {
    conventions.style = 'barrel';
  } else if (barrelCount < deepCount * 0.1) {
    conventions.style = 'deep';
  }
  
  return conventions;
}

/**
 * Resolve the import path from target to source
 */
function resolveImportPath(
  sourceFile: string,
  targetFile: string,
  conventions: ImportConventions
): string {
  // If using alias, try to use it
  if (conventions.pathStyle === 'alias' && conventions.alias) {
    // Assume src/ is the alias root
    if (sourceFile.includes('/src/')) {
      const srcIndex = sourceFile.indexOf('/src/');
      return conventions.alias + sourceFile.slice(srcIndex + 5).replace(/\.(ts|js|tsx|jsx)$/, '');
    }
  }
  
  // Calculate relative path
  const targetDir = path.dirname(targetFile);
  let relativePath = path.relative(targetDir, sourceFile);
  
  // Ensure it starts with ./ or ../
  if (!relativePath.startsWith('.')) {
    relativePath = './' + relativePath;
  }
  
  // Remove extension
  relativePath = relativePath.replace(/\.(ts|js|tsx|jsx)$/, '');
  
  // If barrel style and path ends with /index, remove it
  if (conventions.style === 'barrel' && relativePath.endsWith('/index')) {
    relativePath = relativePath.slice(0, -6);
  }
  
  return relativePath;
}

/**
 * Build an import statement
 */
function buildImportStatement(
  symbols: string[],
  importPath: string,
  conventions: ImportConventions
): string {
  // For now, always use named imports
  const symbolList = symbols.join(', ');
  
  // Use type import if conventions prefer it and all symbols look like types
  const allTypes = symbols.every(s => /^[A-Z]/.test(s) && !s.includes('create') && !s.includes('use'));
  const typePrefix = conventions.preferType && allTypes ? 'type ' : '';
  
  return `import ${typePrefix}{ ${symbolList} } from '${importPath}';`;
}

/**
 * Tool definition for MCP registration
 */
export const importsToolDefinition = {
  name: 'drift_imports',
  description: 'Resolve correct import statements based on codebase conventions. Returns ready-to-use import statements and detected conventions (barrel vs deep, alias vs relative).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      symbols: {
        type: 'array',
        items: { type: 'string' },
        description: 'Symbols that need to be imported',
      },
      targetFile: {
        type: 'string',
        description: 'File where imports will be added (relative path)',
      },
    },
    required: ['symbols', 'targetFile'],
  },
};
