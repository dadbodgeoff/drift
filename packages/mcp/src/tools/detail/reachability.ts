/**
 * drift_reachability - Data Reachability Analysis
 * 
 * Detail tool that answers "What data can this code access?" and
 * "Who can access this data?" using call graph traversal.
 * 
 * Now uses UnifiedCallGraphProvider which supports both legacy and sharded storage.
 */

import {
  createUnifiedCallGraphProvider,
  type ReachabilityResult,
  type InverseReachabilityResult,
  type UnifiedCallGraphProvider,
} from 'driftdetect-core';

import { createResponseBuilder, Errors } from '../../infrastructure/index.js';

export interface ReachableData {
  table: string;
  fields: string[];
  operation: string;
  depth: number;
  path: string[];
}

export interface SensitiveField {
  table: string;
  field: string;
  sensitivityType: string;
  accessCount: number;
  pathCount: number;
}

export interface ForwardReachabilityData {
  direction: 'forward';
  origin: string;
  tables: string[];
  sensitiveFields: SensitiveField[];
  reachableData: ReachableData[];
  functionsTraversed: number;
  maxDepth: number;
}

export interface AccessPath {
  entryPoint: string;
  entryPointFile: string;
  pathLength: number;
  path: string[];
}

export interface InverseReachabilityData {
  direction: 'inverse';
  target: {
    table: string;
    field?: string;
  };
  totalAccessors: number;
  entryPoints: string[];
  accessPaths: AccessPath[];
}

export type ReachabilityData = ForwardReachabilityData | InverseReachabilityData;

const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_LIMIT = 15;

export async function handleReachability(
  projectRoot: string,
  args: {
    direction?: 'forward' | 'inverse';
    location?: string;
    target?: string;
    maxDepth?: number;
    limit?: number;
    sensitiveOnly?: boolean;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ReachabilityData>();
  
  const direction = args.direction ?? 'forward';
  const maxDepth = args.maxDepth ?? DEFAULT_MAX_DEPTH;
  const limit = args.limit ?? DEFAULT_LIMIT;
  const sensitiveOnly = args.sensitiveOnly ?? false;
  
  // Initialize unified call graph provider (supports both legacy and sharded)
  const provider = createUnifiedCallGraphProvider({ rootDir: projectRoot });
  await provider.initialize();
  
  if (!provider.isAvailable()) {
    throw Errors.custom(
      'NO_CALL_GRAPH',
      'No call graph found. Run drift_callgraph action="build" first.',
      ['drift_callgraph action="build"']
    );
  }
  
  if (direction === 'forward') {
    return handleForwardReachability(provider, args.location, sensitiveOnly, builder, maxDepth, limit);
  } else {
    return handleInverseReachability(provider, args.target, builder, maxDepth, limit);
  }
}

async function handleForwardReachability(
  provider: UnifiedCallGraphProvider,
  location: string | undefined,
  sensitiveOnly: boolean,
  builder: ReturnType<typeof createResponseBuilder<ReachabilityData>>,
  maxDepth: number,
  limit: number
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!location) {
    throw Errors.missingParameter('location');
  }
  
  let result: ReachabilityResult;
  
  // Parse location (file:line or function_name)
  if (location.includes(':')) {
    const [file, lineStr] = location.split(':');
    const line = parseInt(lineStr ?? '0', 10);
    if (!file || isNaN(line)) {
      throw Errors.custom('INVALID_LOCATION', 'Location must be file:line (e.g., "src/api.ts:42") or function_name');
    }
    result = await provider.getReachableData(file, line, { maxDepth, sensitiveOnly });
  } else if (location.includes('/') || location.includes('.')) {
    // Looks like a file path without line number - provide helpful error
    throw Errors.custom(
      'INVALID_LOCATION', 
      `Location "${location}" looks like a file path. Please provide a line number (e.g., "${location}:1") or use a function name.`,
      [`Try: location="${location}:1"`]
    );
  } else {
    // Find function by name - search through entry points first
    const entryPoints = await provider.getEntryPoints();
    let funcId: string | undefined;
    
    for (const epId of entryPoints) {
      const func = await provider.getFunction(epId);
      if (func?.name === location) {
        funcId = epId;
        break;
      }
    }
    
    if (!funcId) {
      throw Errors.notFound('function', location);
    }
    
    // Get the function's file and line to use getReachableData
    const func = await provider.getFunction(funcId);
    if (!func) {
      throw Errors.notFound('function', location);
    }
    
    result = await provider.getReachableData(func.file, func.startLine, { maxDepth, sensitiveOnly });
  }
  
  // Map reachable data
  const reachableData: ReachableData[] = result.reachableAccess
    .slice(0, limit)
    .map(ra => ({
      table: ra.access.table,
      fields: ra.access.fields,
      operation: ra.access.operation,
      depth: ra.depth,
      path: ra.path.map(p => p.functionName),
    }));
  
  // Map sensitive fields
  const sensitiveFields: SensitiveField[] = result.sensitiveFields.map(sf => ({
    table: sf.field.table ?? 'unknown',
    field: sf.field.field,
    sensitivityType: sf.field.sensitivityType,
    accessCount: sf.accessCount,
    pathCount: sf.paths.length,
  }));
  
  const data: ForwardReachabilityData = {
    direction: 'forward',
    origin: location,
    tables: result.tables,
    sensitiveFields,
    reachableData,
    functionsTraversed: result.functionsTraversed,
    maxDepth: result.maxDepth,
  };
  
  // Build summary
  let summary = `From ${location}: ${result.tables.length} tables reachable`;
  if (sensitiveFields.length > 0) {
    summary += `, ${sensitiveFields.length} sensitive fields`;
  }
  summary += `. Traversed ${result.functionsTraversed} functions (max depth ${result.maxDepth}).`;
  
  const hints: { nextActions: string[]; warnings?: string[]; relatedTools: string[] } = {
    nextActions: [
      sensitiveFields.length > 0 
        ? 'Review sensitive field access for security implications'
        : 'Use drift_impact_analysis to see who calls this code',
    ],
    relatedTools: ['drift_impact_analysis', 'drift_callgraph'],
  };
  
  if (sensitiveFields.length > 0) {
    const credentialFields = sensitiveFields.filter(f => f.sensitivityType === 'credentials');
    if (credentialFields.length > 0) {
      hints.warnings = [`⚠️ ${credentialFields.length} credential field(s) accessible from this location`];
    }
  }
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints(hints)
    .buildContent();
}

async function handleInverseReachability(
  provider: UnifiedCallGraphProvider,
  target: string | undefined,
  builder: ReturnType<typeof createResponseBuilder<ReachabilityData>>,
  maxDepth: number,
  limit: number
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!target) {
    throw Errors.missingParameter('target');
  }
  
  // Parse target (table or table.field)
  const parts = target.split('.');
  const table = parts[0] ?? '';
  const field = parts.length > 1 ? parts.slice(1).join('.') : undefined;
  
  const result: InverseReachabilityResult = await provider.getCodePathsToData(
    field ? { table, field, maxDepth } : { table, maxDepth }
  );
  
  // Map access paths
  const accessPaths: AccessPath[] = [];
  for (const ap of result.accessPaths.slice(0, limit)) {
    const entryFunc = await provider.getFunction(ap.entryPoint);
    accessPaths.push({
      entryPoint: entryFunc?.name ?? ap.entryPoint,
      entryPointFile: entryFunc?.file ?? '',
      pathLength: ap.path.length,
      path: ap.path.map(p => p.functionName),
    });
  }
  
  // Get entry point names
  const entryPointNames: string[] = [];
  for (const epId of result.entryPoints.slice(0, limit)) {
    const func = await provider.getFunction(epId);
    entryPointNames.push(func?.name ?? epId);
  }
  
  const targetData: InverseReachabilityData['target'] = { table };
  if (field) {
    targetData.field = field;
  }
  
  const data: InverseReachabilityData = {
    direction: 'inverse',
    target: targetData,
    totalAccessors: result.totalAccessors,
    entryPoints: entryPointNames,
    accessPaths,
  };
  
  // Build summary
  let summary = `${target}: ${result.totalAccessors} direct accessor(s), `;
  summary += `${result.entryPoints.length} entry point(s) can reach this data.`;
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: result.entryPoints.length > 0
        ? [
            'Review entry points for proper authorization',
            'Use drift_impact_analysis to understand change impact',
          ]
        : ['No entry points can reach this data - may be dead code'],
      relatedTools: ['drift_impact_analysis', 'drift_callgraph'],
    })
    .buildContent();
}
