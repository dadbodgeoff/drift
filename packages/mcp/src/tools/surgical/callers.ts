/**
 * drift_callers - Lightweight Caller Lookup
 * 
 * Layer: Surgical
 * Token Budget: 300 target, 800 max
 * Cache TTL: 5 minutes
 * Invalidation Keys: callgraph
 * 
 * Returns who calls a function without full impact analysis.
 * Solves: AI needs to know impact of changing a function quickly.
 */

import { createResponseBuilder, Errors, metrics } from '../../infrastructure/index.js';

import type { CallGraphStore, FunctionNode } from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export interface CallersArgs {
  /** Function name to look up */
  function: string;
  /** Optional: specific file containing the function */
  file?: string;
  /** Include indirect callers? (default: false) */
  transitive?: boolean;
  /** Max depth for transitive (default: 2) */
  maxDepth?: number;
}

export interface CallerInfo {
  function: string;
  file: string;
  line: number;
  callSite: number;
}

export interface TransitiveCaller {
  function: string;
  file: string;
  depth: number;
  path: string[];
}

export interface CallersData {
  target: {
    function: string;
    file: string;
    line: number;
  };
  directCallers: CallerInfo[];
  transitiveCallers?: TransitiveCaller[] | undefined;
  stats: {
    directCount: number;
    transitiveCount?: number | undefined;
    isPublicApi: boolean;
    isWidelyUsed: boolean;
  };
}

// ============================================================================
// Handler
// ============================================================================

export async function handleCallers(
  store: CallGraphStore,
  args: CallersArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const startTime = Date.now();
  const builder = createResponseBuilder<CallersData>();
  
  // Validate input
  if (!args.function || args.function.trim() === '') {
    throw Errors.missingParameter('function');
  }
  
  const funcName = args.function.trim();
  const includeTransitive = args.transitive === true;
  const maxDepth = args.maxDepth ?? 2;
  
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
  
  // Check if we're in SQLite mode - if so, use native callers query
  const isSqliteMode = (graph as { _sqliteAvailable?: boolean })._sqliteAvailable === true;
  const projectRoot = graph.projectRoot;
  
  if (isSqliteMode && projectRoot) {
    try {
      // Use native SQLite queries for accurate caller information
      const { getCallGraphCallers, isCallGraphAvailable } = await import('driftdetect-core');
      
      if (isCallGraphAvailable(projectRoot)) {
        // Query callers directly from SQLite
        const nativeCallers = getCallGraphCallers(projectRoot, funcName);
        
        // Build direct callers from native results
        const directCallers: CallerInfo[] = nativeCallers.map(c => ({
          function: c.callerName,
          file: c.callerFile,
          line: c.line,
          callSite: c.line,
        }));
        
        // Sort by file then line
        directCallers.sort((a, b) => {
          const fileCompare = a.file.localeCompare(b.file);
          if (fileCompare !== 0) {return fileCompare;}
          return a.callSite - b.callSite;
        });
        
        // Limit direct callers
        const limitedDirectCallers = directCallers.slice(0, 10);
        
        // Check if this is a public API
        const isPublicApi = nativeCallers.some(c => graph.entryPoints.includes(c.callerId));
        
        const data: CallersData = {
          target: {
            function: funcName,
            file: args.file ?? nativeCallers[0]?.callerFile ?? 'unknown',
            line: 0,
          },
          directCallers: limitedDirectCallers,
          transitiveCallers: undefined, // Would need recursive native query
          stats: {
            directCount: directCallers.length,
            isPublicApi,
            isWidelyUsed: directCallers.length > 5,
          },
        };
        
        // Build summary
        let summary = `"${funcName}" has ${directCallers.length} direct caller${directCallers.length !== 1 ? 's' : ''}`;
        if (isPublicApi) {
          summary += ' (public API)';
        }
        
        // Build hints
        const hints: { nextActions: string[]; relatedTools: string[]; warnings?: string[] } = {
          nextActions: [
            directCallers.length > 0
              ? `Review callers before modifying "${funcName}"`
              : `"${funcName}" appears unused - safe to modify`,
            'Use drift_impact_analysis for full blast radius',
          ],
          relatedTools: ['drift_impact_analysis', 'drift_signature', 'drift_reachability'],
        };
        
        if (data.stats.isWidelyUsed) {
          hints.warnings = ['Widely used function - changes may have broad impact'];
        }
        
        if (directCallers.length > 10) {
          hints.warnings = hints.warnings ?? [];
          hints.warnings.push(`${directCallers.length - 10} additional callers not shown`);
        }
        
        // Record metrics
        metrics.recordRequest('drift_callers', Date.now() - startTime, true, false);
        
        return builder
          .withSummary(summary)
          .withData(data)
          .withHints(hints)
          .buildContent();
      }
    } catch {
      // Fall through to in-memory analysis
    }
  }
  
  // Fall back to in-memory graph analysis
  // Find the target function
  let targetFunc: FunctionNode | null = null;
  
  for (const [, func] of graph.functions) {
    const nameMatch = func.name === funcName || 
                      func.qualifiedName === funcName ||
                      func.qualifiedName.endsWith(`.${funcName}`);
    
    const fileMatch = !args.file || 
                      func.file === args.file ||
                      func.file.endsWith(args.file);
    
    if (nameMatch && fileMatch) {
      targetFunc = func;
      break;
    }
  }
  
  if (!targetFunc) {
    throw Errors.notFound('function', funcName);
  }
  
  // Get direct callers
  const directCallers: CallerInfo[] = targetFunc.calledBy.map(call => {
    const callerFunc = graph.functions.get(call.callerId);
    // For __module__ (top-level code), show a more descriptive name
    // and use the actual call site line instead of line 1
    const isModuleLevel = callerFunc?.name === '__module__';
    return {
      function: isModuleLevel ? '<module-level>' : (callerFunc?.name ?? call.callerId),
      file: call.file,
      line: isModuleLevel ? call.line : (callerFunc?.startLine ?? call.line),
      callSite: call.line,
    };
  });
  
  // Sort by file then line
  directCallers.sort((a, b) => {
    const fileCompare = a.file.localeCompare(b.file);
    if (fileCompare !== 0) {return fileCompare;}
    return a.callSite - b.callSite;
  });
  
  // Limit direct callers
  const limitedDirectCallers = directCallers.slice(0, 10);
  
  // Get transitive callers if requested
  let transitiveCallers: TransitiveCaller[] | undefined;
  if (includeTransitive) {
    transitiveCallers = findTransitiveCallers(graph, targetFunc.id, maxDepth);
  }
  
  // Check if this is a public API (called from entry points)
  const isPublicApi = graph.entryPoints.some(ep => {
    const entryFunc = graph.functions.get(ep);
    if (!entryFunc) {return false;}
    return canReach(graph, ep, targetFunc.id, 5);
  });
  
  const data: CallersData = {
    target: {
      function: targetFunc.name,
      file: targetFunc.file,
      line: targetFunc.startLine,
    },
    directCallers: limitedDirectCallers,
    transitiveCallers,
    stats: {
      directCount: directCallers.length,
      ...(transitiveCallers ? { transitiveCount: transitiveCallers.length } : {}),
      isPublicApi,
      isWidelyUsed: directCallers.length > 5,
    },
  };
  
  // Build summary
  let summary = `"${targetFunc.name}" has ${directCallers.length} direct caller${directCallers.length !== 1 ? 's' : ''}`;
  if (transitiveCallers) {
    summary += `, ${transitiveCallers.length} transitive`;
  }
  if (isPublicApi) {
    summary += ' (public API)';
  }
  
  // Build hints
  const hints: { nextActions: string[]; relatedTools: string[]; warnings?: string[] } = {
    nextActions: [
      directCallers.length > 0
        ? `Review callers before modifying "${targetFunc.name}"`
        : `"${targetFunc.name}" appears unused - safe to modify`,
      'Use drift_impact_analysis for full blast radius',
    ],
    relatedTools: ['drift_impact_analysis', 'drift_signature', 'drift_reachability'],
  };
  
  if (data.stats.isWidelyUsed) {
    hints.warnings = ['Widely used function - changes may have broad impact'];
  }
  
  if (directCallers.length > 10) {
    hints.warnings = hints.warnings ?? [];
    hints.warnings.push(`${directCallers.length - 10} additional callers not shown`);
  }
  
  // Record metrics
  metrics.recordRequest('drift_callers', Date.now() - startTime, true, false);
  
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
 * Find transitive callers using BFS
 */
function findTransitiveCallers(
  graph: { functions: Map<string, FunctionNode> },
  targetId: string,
  maxDepth: number
): TransitiveCaller[] {
  const result: TransitiveCaller[] = [];
  const visited = new Set<string>([targetId]);
  const queue: Array<{ id: string; depth: number; path: string[] }> = [];
  
  // Start with direct callers
  const targetFunc = graph.functions.get(targetId);
  if (!targetFunc) {return result;}
  
  for (const call of targetFunc.calledBy) {
    if (!visited.has(call.callerId)) {
      visited.add(call.callerId);
      queue.push({
        id: call.callerId,
        depth: 1,
        path: [targetFunc.name],
      });
    }
  }
  
  // BFS up the call tree
  while (queue.length > 0) {
    const current = queue.shift()!;
    const func = graph.functions.get(current.id);
    
    if (!func) {continue;}
    
    // Add to result if depth > 1 (direct callers handled separately)
    if (current.depth > 1) {
      result.push({
        function: func.name,
        file: func.file,
        depth: current.depth,
        path: [...current.path, func.name],
      });
    }
    
    // Continue BFS if not at max depth
    if (current.depth < maxDepth) {
      for (const call of func.calledBy) {
        if (!visited.has(call.callerId)) {
          visited.add(call.callerId);
          queue.push({
            id: call.callerId,
            depth: current.depth + 1,
            path: [...current.path, func.name],
          });
        }
      }
    }
  }
  
  // Limit results
  return result.slice(0, 20);
}

/**
 * Check if one function can reach another (simple DFS)
 */
function canReach(
  graph: { functions: Map<string, FunctionNode> },
  fromId: string,
  toId: string,
  maxDepth: number
): boolean {
  const visited = new Set<string>();
  const stack: Array<{ id: string; depth: number }> = [{ id: fromId, depth: 0 }];
  
  while (stack.length > 0) {
    const current = stack.pop()!;
    
    if (current.id === toId) {return true;}
    if (current.depth >= maxDepth) {continue;}
    if (visited.has(current.id)) {continue;}
    
    visited.add(current.id);
    
    const func = graph.functions.get(current.id);
    if (!func) {continue;}
    
    for (const call of func.calls) {
      if (call.calleeId && !visited.has(call.calleeId)) {
        stack.push({ id: call.calleeId, depth: current.depth + 1 });
      }
    }
  }
  
  return false;
}

/**
 * Tool definition for MCP registration
 */
export const callersToolDefinition = {
  name: 'drift_callers',
  description: 'Lightweight "who calls this function" lookup. Returns direct callers and optionally transitive callers. Much faster than full impact analysis.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      function: {
        type: 'string',
        description: 'Function name to look up',
      },
      file: {
        type: 'string',
        description: 'Optional: specific file containing the function',
      },
      transitive: {
        type: 'boolean',
        description: 'Include indirect callers (default: false)',
      },
      maxDepth: {
        type: 'number',
        description: 'Max depth for transitive callers (default: 2)',
      },
    },
    required: ['function'],
  },
};
