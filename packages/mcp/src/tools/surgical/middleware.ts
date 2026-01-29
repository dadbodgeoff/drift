/**
 * drift_middleware - Middleware Pattern Lookup
 * 
 * Layer: Surgical
 * Token Budget: 300 target, 800 max
 * 
 * Returns middleware patterns in the codebase.
 * Solves: AI needs to know existing middleware when adding auth/logging/etc.
 */

import {
  createWrapperScanner,
  type WrapperCluster,
  type WrapperFunction,
} from 'driftdetect-core/wrappers';

import { createResponseBuilder, metrics } from '../../infrastructure/index.js';

// ============================================================================
// Types
// ============================================================================

export interface MiddlewareArgs {
  /** Filter by type: auth, logging, validation, error, all */
  type?: 'auth' | 'logging' | 'validation' | 'error' | 'all';
  /** Framework filter: express, koa, fastify, nestjs, laravel, spring */
  framework?: string;
  /** Max results */
  limit?: number;
}

export interface MiddlewareInfo {
  name: string;
  file: string;
  line: number;
  type: string;
  framework?: string | undefined;
  usages: number;
  parameters?: string[] | undefined;
}

export interface MiddlewareData {
  middleware: MiddlewareInfo[];
  byType: Record<string, number>;
  stats: {
    total: number;
    authCount: number;
    loggingCount: number;
    validationCount: number;
    errorCount: number;
  };
}

// ============================================================================
// Handler
// ============================================================================

export async function handleMiddleware(
  args: MiddlewareArgs,
  rootDir: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const startTime = Date.now();
  const builder = createResponseBuilder<MiddlewareData>();
  
  const typeFilter = args.type ?? 'all';
  const frameworkFilter = args.framework?.toLowerCase();
  const limit = args.limit ?? 20;
  
  // Scan for wrappers with middleware category
  const scanner = createWrapperScanner({
    rootDir,
    includeTestFiles: false,
    verbose: false,
  });
  
  const result = await scanner.scan({
    minConfidence: 0.3,
    minClusterSize: 1,
    maxDepth: 5,
    includeTestFiles: false,
  });
  
  // Filter to middleware-related clusters
  const middlewareClusters = result.analysis.clusters.filter(c => 
    c.category === 'middleware' ||
    c.category === 'authentication' ||
    c.category === 'authorization' ||
    c.category === 'validation' ||
    c.category === 'logging' ||
    c.category === 'error-handling'
  );
  
  // Extract middleware functions
  const middlewareList: MiddlewareInfo[] = [];
  
  for (const cluster of middlewareClusters) {
    const middlewareType = categorizeMiddleware(cluster);
    
    // Apply type filter
    if (typeFilter !== 'all' && middlewareType !== typeFilter) {
      continue;
    }
    
    for (const wrapper of cluster.wrappers) {
      // Apply framework filter
      const detectedFramework = detectFramework(wrapper);
      if (frameworkFilter && detectedFramework?.toLowerCase() !== frameworkFilter) {
        continue;
      }
      
      middlewareList.push({
        name: wrapper.name,
        file: wrapper.file,
        line: wrapper.line,
        type: middlewareType,
        framework: detectedFramework,
        usages: wrapper.calledBy.length,
        parameters: wrapper.parameterSignature,
      });
    }
  }
  
  // Also check for common middleware patterns in wrappers
  for (const wrapper of result.analysis.wrappers) {
    if (isMiddlewarePattern(wrapper) && !middlewareList.some(m => m.name === wrapper.name)) {
      const middlewareType = inferMiddlewareType(wrapper);
      
      if (typeFilter !== 'all' && middlewareType !== typeFilter) {
        continue;
      }
      
      const detectedFramework = detectFramework(wrapper);
      if (frameworkFilter && detectedFramework?.toLowerCase() !== frameworkFilter) {
        continue;
      }
      
      middlewareList.push({
        name: wrapper.name,
        file: wrapper.file,
        line: wrapper.line,
        type: middlewareType,
        framework: detectedFramework,
        usages: wrapper.calledBy.length,
        parameters: wrapper.parameterSignature,
      });
    }
  }
  
  // Sort by usages and limit
  middlewareList.sort((a, b) => b.usages - a.usages);
  const limited = middlewareList.slice(0, limit);
  
  // Calculate stats
  const byType: Record<string, number> = {};
  let authCount = 0;
  let loggingCount = 0;
  let validationCount = 0;
  let errorCount = 0;
  
  for (const mw of middlewareList) {
    byType[mw.type] = (byType[mw.type] ?? 0) + 1;
    if (mw.type === 'auth') {authCount++;}
    if (mw.type === 'logging') {loggingCount++;}
    if (mw.type === 'validation') {validationCount++;}
    if (mw.type === 'error') {errorCount++;}
  }
  
  const data: MiddlewareData = {
    middleware: limited,
    byType,
    stats: {
      total: middlewareList.length,
      authCount,
      loggingCount,
      validationCount,
      errorCount,
    },
  };
  
  // Build summary
  const summary = middlewareList.length > 0
    ? `Found ${middlewareList.length} middleware: ${authCount} auth, ${loggingCount} logging, ${validationCount} validation, ${errorCount} error handling`
    : 'No middleware patterns detected';
  
  // Record metrics
  metrics.recordRequest('drift_middleware', Date.now() - startTime, true, false);
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: middlewareList.length > 0
        ? ['Review existing middleware before adding new ones', 'Check middleware order in routes']
        : ['Consider adding middleware for cross-cutting concerns'],
      relatedTools: ['drift_wrappers', 'drift_signature', 'drift_imports'],
    })
    .buildContent();
}

// ============================================================================
// Helpers
// ============================================================================

function categorizeMiddleware(cluster: WrapperCluster): string {
  switch (cluster.category) {
    case 'authentication':
    case 'authorization':
      return 'auth';
    case 'logging':
      return 'logging';
    case 'validation':
      return 'validation';
    case 'error-handling':
      return 'error';
    default:
      return 'other';
  }
}

function detectFramework(wrapper: WrapperFunction): string | undefined {
  const primitives = wrapper.primitiveSignature.join(' ').toLowerCase();
  const name = wrapper.name.toLowerCase();
  
  if (primitives.includes('express') || name.includes('express')) {return 'express';}
  if (primitives.includes('koa')) {return 'koa';}
  if (primitives.includes('fastify')) {return 'fastify';}
  if (primitives.includes('nestjs') || primitives.includes('@nestjs')) {return 'nestjs';}
  if (primitives.includes('laravel') || primitives.includes('illuminate')) {return 'laravel';}
  if (primitives.includes('spring') || primitives.includes('@controller')) {return 'spring';}
  if (primitives.includes('gin') || primitives.includes('echo') || primitives.includes('fiber')) {return 'go';}
  
  return undefined;
}

function isMiddlewarePattern(wrapper: WrapperFunction): boolean {
  const name = wrapper.name.toLowerCase();
  const params = wrapper.parameterSignature?.join(' ').toLowerCase() ?? '';
  
  // Common middleware naming patterns
  if (name.includes('middleware')) {return true;}
  if (name.includes('interceptor')) {return true;}
  if (name.includes('guard')) {return true;}
  if (name.includes('filter')) {return true;}
  
  // Express-style (req, res, next)
  if (params.includes('req') && params.includes('res') && params.includes('next')) {return true;}
  
  // Koa-style (ctx, next)
  if (params.includes('ctx') && params.includes('next')) {return true;}
  
  return false;
}

function inferMiddlewareType(wrapper: WrapperFunction): string {
  const name = wrapper.name.toLowerCase();
  const primitives = wrapper.primitiveSignature.join(' ').toLowerCase();
  
  if (name.includes('auth') || name.includes('jwt') || name.includes('session') ||
      primitives.includes('auth') || primitives.includes('jwt')) {
    return 'auth';
  }
  
  if (name.includes('log') || name.includes('morgan') || name.includes('winston') ||
      primitives.includes('log')) {
    return 'logging';
  }
  
  if (name.includes('valid') || name.includes('sanitize') || name.includes('schema') ||
      primitives.includes('joi') || primitives.includes('zod') || primitives.includes('yup')) {
    return 'validation';
  }
  
  if (name.includes('error') || name.includes('exception') || name.includes('catch')) {
    return 'error';
  }
  
  return 'other';
}

/**
 * Tool definition for MCP registration
 */
export const middlewareToolDefinition = {
  name: 'drift_middleware',
  description: 'Find middleware patterns in the codebase. Returns auth, logging, validation, and error handling middleware with their locations and usage counts.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        enum: ['auth', 'logging', 'validation', 'error', 'all'],
        description: 'Filter by middleware type (default: all)',
      },
      framework: {
        type: 'string',
        description: 'Filter by framework: express, koa, fastify, nestjs, laravel, spring',
      },
      limit: {
        type: 'number',
        description: 'Max results to return (default: 20)',
      },
    },
  },
};
