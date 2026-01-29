/**
 * drift_similar - Find Semantically Similar Code
 * 
 * Layer: Surgical
 * Token Budget: 500 target, 1000 max
 * Cache TTL: 5 minutes
 * Invalidation Keys: patterns, callgraph
 * 
 * Finds code semantically similar to what the AI is about to write.
 * Solves: AI needs to see an example but there are 50 options. Which is most relevant?
 */

import { createResponseBuilder, Errors, metrics } from '../../infrastructure/index.js';

import type { CallGraphStore, FunctionNode, PatternStore } from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export interface SimilarArgs {
  /** What kind of code are you writing? */
  intent: 'api_endpoint' | 'service' | 'component' | 'hook' | 'utility' | 'test' | 'middleware';
  /** Natural language description */
  description: string;
  /** Optional: limit to specific directory */
  scope?: string;
  /** Max results (default: 3) */
  limit?: number;
}

export interface SimilarMatch {
  file: string;
  function?: string | undefined;
  class?: string | undefined;
  similarity: number;
  reason: string;
  preview: string;
  patterns: string[];
}

export interface SimilarConventions {
  naming: string;
  errorHandling: string;
  imports: string;
}

export interface SimilarData {
  matches: SimilarMatch[];
  conventions: SimilarConventions;
}

// ============================================================================
// Intent to Pattern Category Mapping
// ============================================================================

const INTENT_CATEGORIES: Record<string, string[]> = {
  api_endpoint: ['api', 'errors', 'auth'],
  service: ['data-access', 'errors', 'logging'],
  component: ['components', 'styling', 'accessibility'],
  hook: ['components', 'data-access'],
  utility: ['errors', 'logging'],
  test: ['testing'],
  middleware: ['api', 'auth', 'errors'],
};

const INTENT_DECORATORS: Record<string, string[]> = {
  api_endpoint: ['@app.route', '@router', 'HttpGet', 'HttpPost', '@Get', '@Post', 'Route'],
  middleware: ['@middleware', 'Middleware'],
  test: ['@test', 'describe', 'it', 'test'],
};

// ============================================================================
// Handler
// ============================================================================

export async function handleSimilar(
  callGraphStore: CallGraphStore,
  patternStore: PatternStore,
  args: SimilarArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const startTime = Date.now();
  const builder = createResponseBuilder<SimilarData>();
  
  // Validate input
  if (!args.intent) {
    throw Errors.missingParameter('intent');
  }
  if (!args.description || args.description.trim() === '') {
    throw Errors.missingParameter('description');
  }
  
  const intent = args.intent;
  const description = args.description.toLowerCase();
  const scope = args.scope;
  const limit = Math.min(args.limit ?? 3, 10);
  
  // Load stores
  await callGraphStore.initialize();
  await patternStore.initialize();
  
  const graph = callGraphStore.getGraph();
  if (!graph) {
    throw Errors.custom(
      'CALLGRAPH_NOT_BUILT',
      'Call graph has not been built. Run "drift callgraph build" first.',
      ['drift_status']
    );
  }
  
  // Get patterns for scoring
  const allPatterns = patternStore.getAll();
  const patternsByFile = new Map<string, string[]>();
  
  for (const pattern of allPatterns) {
    for (const loc of pattern.locations) {
      const existing = patternsByFile.get(loc.file) ?? [];
      existing.push(pattern.name);
      patternsByFile.set(loc.file, existing);
    }
  }
  
  // Score all functions
  const scored: Array<{ func: FunctionNode; score: number; reasons: string[] }> = [];
  const targetCategories = INTENT_CATEGORIES[intent] ?? [];
  const targetDecorators = INTENT_DECORATORS[intent] ?? [];
  
  for (const [, func] of graph.functions) {
    // Skip module-level pseudo-functions - they're not useful examples
    if (func.name === '__module__') {
      continue;
    }
    
    // Skip if scope specified and doesn't match
    if (scope && !func.file.includes(scope)) {
      continue;
    }
    
    const reasons: string[] = [];
    let score = 0;
    
    // 1. Decorator match (strong signal)
    for (const dec of func.decorators) {
      if (targetDecorators.some(td => dec.includes(td))) {
        score += 0.3;
        reasons.push(`Has ${intent} decorator`);
        break;
      }
    }
    
    // 2. Pattern category match
    const filePatterns = patternsByFile.get(func.file) ?? [];
    const categoryMatches = filePatterns.filter(p => 
      targetCategories.some(cat => p.toLowerCase().includes(cat))
    );
    if (categoryMatches.length > 0) {
      score += 0.2 * Math.min(categoryMatches.length, 3);
      reasons.push(`Matches ${categoryMatches.length} ${intent} patterns`);
    }
    
    // 3. Name similarity (fuzzy match on description keywords)
    const keywords = description.split(/\s+/).filter(w => w.length > 2);
    const nameWords = func.name.toLowerCase().split(/(?=[A-Z])|_|-/).map(w => w.toLowerCase());
    const qualifiedWords = func.qualifiedName.toLowerCase().split(/[._-]/);
    
    let keywordMatches = 0;
    for (const kw of keywords) {
      if (nameWords.some(nw => nw.includes(kw) || kw.includes(nw))) {
        keywordMatches++;
      } else if (qualifiedWords.some(qw => qw.includes(kw) || kw.includes(qw))) {
        keywordMatches += 0.5;
      }
    }
    if (keywordMatches > 0 && keywords.length > 0) {
      const keywordScore = (keywordMatches / keywords.length) * 0.3;
      score += keywordScore;
      reasons.push(`Name matches ${Math.round(keywordMatches)} keywords`);
    }
    
    // 4. Exported functions are more likely to be good examples
    if (func.isExported) {
      score += 0.1;
    }
    
    // 5. Has parameters (more complete example)
    if (func.parameters.length > 0) {
      score += 0.05;
    }
    
    // 6. Has return type (better documented)
    if (func.returnType) {
      score += 0.05;
    }
    
    if (score > 0.1) {
      scored.push({ func, score, reasons });
    }
  }
  
  // Sort by score and take top N
  scored.sort((a, b) => b.score - a.score);
  const topMatches = scored.slice(0, limit);
  
  // Build matches
  const matches: SimilarMatch[] = topMatches.map(({ func, score, reasons }) => ({
    file: func.file,
    function: func.name,
    class: func.className,
    similarity: Math.round(score * 100) / 100,
    reason: reasons.slice(0, 2).join('. '),
    preview: buildPreview(func),
    patterns: patternsByFile.get(func.file)?.slice(0, 3) ?? [],
  }));
  
  // Analyze conventions from matches
  const conventions = analyzeConventions(topMatches.map(m => m.func));
  
  const data: SimilarData = {
    matches,
    conventions,
  };
  
  // Build summary
  let summary: string;
  if (matches.length === 0) {
    summary = `No similar ${intent} found matching "${args.description}"`;
  } else {
    summary = `Found ${matches.length} similar ${intent} example${matches.length !== 1 ? 's' : ''}. Top: ${matches[0]!.file}`;
  }
  
  // Build hints
  const hints: { nextActions: string[]; relatedTools: string[]; warnings?: string[] } = {
    nextActions: matches.length > 0
      ? [
          `Use drift_signature to get full signature for "${matches[0]!.function}"`,
          `Use drift_imports to get correct imports for your new file`,
        ]
      : [
          'Try a different intent or broader description',
          'Use drift_patterns_list to see available patterns',
        ],
    relatedTools: ['drift_signature', 'drift_imports', 'drift_code_examples'],
  };
  
  if (matches.some(m => m.similarity < 0.3)) {
    hints.warnings = ['Some matches have low similarity - review carefully'];
  }
  
  // Record metrics
  metrics.recordRequest('drift_similar', Date.now() - startTime, true, false);
  
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
 * Build a preview of the function signature
 */
function buildPreview(func: FunctionNode): string {
  const parts: string[] = [];
  
  // Decorators (first one)
  if (func.decorators.length > 0) {
    parts.push(`@${func.decorators[0]}`);
  }
  
  // Export + async
  if (func.isExported) {parts.push('export');}
  if (func.isAsync) {parts.push('async');}
  parts.push('function');
  parts.push(func.name);
  
  // Parameters (abbreviated)
  const params = func.parameters.slice(0, 3).map(p => {
    if (p.type) {return `${p.name}: ${p.type}`;}
    return p.name;
  });
  if (func.parameters.length > 3) {
    params.push('...');
  }
  
  let preview = parts.join(' ') + `(${params.join(', ')})`;
  
  if (func.returnType) {
    preview += `: ${func.returnType}`;
  }
  
  return preview;
}

/**
 * Analyze conventions from matched functions
 */
function analyzeConventions(funcs: FunctionNode[]): SimilarConventions {
  if (funcs.length === 0) {
    return {
      naming: 'Unknown',
      errorHandling: 'Unknown',
      imports: 'Unknown',
    };
  }
  
  // Naming convention
  const names = funcs.map(f => f.name);
  const hasCamelCase = names.some(n => /^[a-z][a-zA-Z]*$/.test(n));
  const hasSnakeCase = names.some(n => /^[a-z][a-z_]*$/.test(n));
  const hasPascalCase = names.some(n => /^[A-Z][a-zA-Z]*$/.test(n));
  
  let naming = 'mixed';
  if (hasCamelCase && !hasSnakeCase) {naming = 'camelCase';}
  else if (hasSnakeCase && !hasCamelCase) {naming = 'snake_case';}
  else if (hasPascalCase) {naming = 'PascalCase';}
  
  // Error handling (check return types)
  const returnTypes = funcs.map(f => f.returnType).filter(Boolean);
  let errorHandling = 'Unknown';
  if (returnTypes.some(rt => rt?.includes('Result'))) {
    errorHandling = 'Result<T> pattern';
  } else if (returnTypes.some(rt => rt?.includes('Promise'))) {
    errorHandling = 'Async with try/catch';
  } else if (funcs.some(f => f.isAsync)) {
    errorHandling = 'Async functions';
  }
  
  // Import style (inferred from file paths)
  const files = funcs.map(f => f.file);
  let imports = 'relative paths';
  if (files.some(f => f.includes('@/'))) {
    imports = 'Path alias (@/)';
  } else if (files.some(f => f.includes('~/'))) {
    imports = 'Path alias (~/)';
  }
  
  return { naming, errorHandling, imports };
}

/**
 * Tool definition for MCP registration
 */
export const similarToolDefinition = {
  name: 'drift_similar',
  description: 'Find code semantically similar to what you\'re about to write. Returns relevant examples with patterns and conventions. Use before writing new code to find the right template.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      intent: {
        type: 'string',
        enum: ['api_endpoint', 'service', 'component', 'hook', 'utility', 'test', 'middleware'],
        description: 'What kind of code are you writing?',
      },
      description: {
        type: 'string',
        description: 'Natural language description (e.g., "user preferences CRUD")',
      },
      scope: {
        type: 'string',
        description: 'Optional: limit to specific directory',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 3, max: 10)',
      },
    },
    required: ['intent', 'description'],
  },
};
