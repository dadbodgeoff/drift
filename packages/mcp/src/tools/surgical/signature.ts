/**
 * drift_signature - Get Function/Class Signatures
 * 
 * Layer: Surgical
 * Token Budget: 200 target, 500 max
 * Cache TTL: 5 minutes
 * Invalidation Keys: callgraph, file:{path}
 * 
 * Returns just the signature without reading entire files.
 * Solves: AI reads 500-line files just to see a 1-line signature.
 */

import { createResponseBuilder, Errors, metrics } from '../../infrastructure/index.js';

import type { CallGraphStore, FunctionNode } from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export interface SignatureArgs {
  /** Symbol to look up (function, method, class name) */
  symbol: string;
  /** Optional: specific file to search in */
  file?: string;
  /** Include JSDoc/docstring? (default: true) */
  includeDocs?: boolean;
}

export interface SignatureInfo {
  file: string;
  line: number;
  kind: 'function' | 'method' | 'class' | 'interface' | 'type';
  signature: string;
  parameters?: Array<{
    name: string;
    type: string;
    required: boolean;
    default?: string | undefined;
  }>;
  returnType?: string | undefined;
  docs?: string | undefined;
  exported: boolean;
  className?: string | undefined;
  decorators?: string[] | undefined;
}

export interface SignatureData {
  found: boolean;
  signatures: SignatureInfo[];
}

// ============================================================================
// Handler
// ============================================================================

export async function handleSignature(
  store: CallGraphStore,
  args: SignatureArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const startTime = Date.now();
  const builder = createResponseBuilder<SignatureData>();
  
  // Validate input
  if (!args.symbol || args.symbol.trim() === '') {
    throw Errors.missingParameter('symbol');
  }
  
  const symbol = args.symbol.trim();
  // includeDocs reserved for future use
  // const includeDocs = args.includeDocs !== false;
  
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
  
  // Find matching functions
  const matches: FunctionNode[] = [];
  
  for (const [, func] of graph.functions) {
    // Match by name or qualified name
    const nameMatch = func.name === symbol || 
                      func.qualifiedName === symbol ||
                      func.qualifiedName.endsWith(`.${symbol}`);
    
    // If file specified, filter by file
    const fileMatch = !args.file || 
                      func.file === args.file ||
                      func.file.endsWith(args.file);
    
    if (nameMatch && fileMatch) {
      matches.push(func);
    }
  }
  
  // Build signatures
  const signatures: SignatureInfo[] = matches.map(func => {
    const sig = buildSignature(func);
    return {
      file: func.file,
      line: func.startLine,
      kind: func.className ? 'method' as const : 'function' as const,
      signature: sig,
      parameters: func.parameters.map(p => ({
        name: p.name,
        type: p.type || 'unknown',
        required: !p.hasDefault,
        default: p.hasDefault ? '...' : undefined,
      })),
      returnType: func.returnType,
      exported: func.isExported,
      className: func.className,
      decorators: func.decorators.length > 0 ? func.decorators : undefined,
    };
  });
  
  // Sort by relevance: exact name match first, then exported, then by file
  signatures.sort((a, b) => {
    // Exact name match
    const aExact = a.signature.includes(` ${symbol}(`) ? 0 : 1;
    const bExact = b.signature.includes(` ${symbol}(`) ? 0 : 1;
    if (aExact !== bExact) {return aExact - bExact;}
    
    // Exported first
    if (a.exported !== b.exported) {return a.exported ? -1 : 1;}
    
    // Alphabetical by file
    return a.file.localeCompare(b.file);
  });
  
  // Limit results
  const limitedSignatures = signatures.slice(0, 5);
  
  const data: SignatureData = {
    found: limitedSignatures.length > 0,
    signatures: limitedSignatures,
  };
  
  // Build summary
  let summary: string;
  if (limitedSignatures.length === 0) {
    summary = `No signature found for "${symbol}"`;
  } else if (limitedSignatures.length === 1) {
    const sig = limitedSignatures[0]!;
    summary = `Found ${sig.kind} "${symbol}" in ${sig.file}:${sig.line}`;
  } else {
    summary = `Found ${limitedSignatures.length} matches for "${symbol}"`;
  }
  
  // Build hints
  const hints: { nextActions: string[]; relatedTools: string[]; warnings?: string[] } = {
    nextActions: limitedSignatures.length > 0
      ? [
          `Use drift_callers to see who calls "${symbol}"`,
          `Use drift_imports to get correct import statement`,
        ]
      : [
          'Check spelling or try a partial name',
          'Use drift_files_list to find relevant files',
        ],
    relatedTools: ['drift_callers', 'drift_imports', 'drift_type'],
  };
  
  if (signatures.length > 5) {
    hints.warnings = [`${signatures.length - 5} additional matches not shown. Specify file to narrow results.`];
  }
  
  // Record metrics
  metrics.recordRequest('drift_signature', Date.now() - startTime, true, false);
  
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
 * Build a human-readable signature string
 */
function buildSignature(func: FunctionNode): string {
  const parts: string[] = [];
  
  // Decorators (first one only for brevity)
  if (func.decorators.length > 0) {
    parts.push(`@${func.decorators[0]}`);
  }
  
  // Export keyword
  if (func.isExported) {
    parts.push('export');
  }
  
  // Async keyword
  if (func.isAsync) {
    parts.push('async');
  }
  
  // Function keyword
  parts.push('function');
  
  // Name
  parts.push(func.name);
  
  // Parameters
  const params = func.parameters.map(p => {
    let param = p.name;
    if (p.type) {
      param += `: ${p.type}`;
    }
    if (p.hasDefault) {
      param += ' = ...';
    }
    return param;
  }).join(', ');
  
  // Build signature
  let sig = parts.join(' ') + `(${params})`;
  
  // Return type
  if (func.returnType) {
    sig += `: ${func.returnType}`;
  }
  
  return sig;
}

/**
 * Tool definition for MCP registration
 */
export const signatureToolDefinition = {
  name: 'drift_signature',
  description: 'Get function/class signature without reading entire files. Returns signature, parameters, return type, and location. Use when you need to know a function\'s interface.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      symbol: {
        type: 'string',
        description: 'Function, method, or class name to look up',
      },
      file: {
        type: 'string',
        description: 'Optional: specific file to search in (relative path)',
      },
      includeDocs: {
        type: 'boolean',
        description: 'Include JSDoc/docstring (default: true)',
      },
    },
    required: ['symbol'],
  },
};
