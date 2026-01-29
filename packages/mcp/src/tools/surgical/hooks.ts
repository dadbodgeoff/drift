/**
 * drift_hooks - React/Vue Hooks Lookup
 * 
 * Layer: Surgical
 * Token Budget: 300 target, 800 max
 * 
 * Returns custom hooks in the codebase.
 * Solves: AI needs to know existing hooks before creating new ones.
 */

import { createWrapperScanner, type WrapperFunction } from 'driftdetect-core/wrappers';

import { createResponseBuilder, metrics } from '../../infrastructure/index.js';

// ============================================================================
// Types
// ============================================================================

export interface HooksArgs {
  /** Filter by category: state, fetch, effect, form, auth, all */
  category?: 'state' | 'fetch' | 'effect' | 'form' | 'auth' | 'all';
  /** Search by name pattern */
  search?: string;
  /** Max results */
  limit?: number;
}

export interface HookInfo {
  name: string;
  file: string;
  line: number;
  category: string;
  usages: number;
  dependencies: string[];
  returnType?: string | undefined;
  isAsync: boolean;
}

export interface HooksData {
  hooks: HookInfo[];
  byCategory: Record<string, number>;
  stats: {
    total: number;
    customHooks: number;
    mostUsed: string;
    avgUsages: number;
  };
}

// ============================================================================
// Handler
// ============================================================================

export async function handleHooks(
  args: HooksArgs,
  rootDir: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const startTime = Date.now();
  const builder = createResponseBuilder<HooksData>();
  
  const categoryFilter = args.category ?? 'all';
  const searchPattern = args.search?.toLowerCase();
  const limit = args.limit ?? 20;
  
  // Scan for wrappers
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
  
  // Find hooks from wrappers
  const hooksList: HookInfo[] = [];
  
  // Check clusters for hook-related categories
  const hookClusters = result.analysis.clusters.filter(c =>
    c.category === 'state-management' ||
    c.category === 'data-fetching' ||
    c.category === 'side-effects' ||
    c.category === 'form-handling' ||
    c.category === 'authentication'
  );
  
  for (const cluster of hookClusters) {
    for (const wrapper of cluster.wrappers) {
      if (isHook(wrapper)) {
        const hookCategory = categorizeHook(wrapper, cluster.category);
        
        if (categoryFilter !== 'all' && hookCategory !== categoryFilter) {
          continue;
        }
        
        if (searchPattern && !wrapper.name.toLowerCase().includes(searchPattern)) {
          continue;
        }
        
        hooksList.push({
          name: wrapper.name,
          file: wrapper.file,
          line: wrapper.line,
          category: hookCategory,
          usages: wrapper.calledBy.length,
          dependencies: extractHookDependencies(wrapper),
          returnType: wrapper.returnType,
          isAsync: wrapper.isAsync,
        });
      }
    }
  }
  
  // Also scan all wrappers for hook patterns
  for (const wrapper of result.analysis.wrappers) {
    if (isHook(wrapper) && !hooksList.some(h => h.name === wrapper.name && h.file === wrapper.file)) {
      const hookCategory = inferHookCategory(wrapper);
      
      if (categoryFilter !== 'all' && hookCategory !== categoryFilter) {
        continue;
      }
      
      if (searchPattern && !wrapper.name.toLowerCase().includes(searchPattern)) {
        continue;
      }
      
      hooksList.push({
        name: wrapper.name,
        file: wrapper.file,
        line: wrapper.line,
        category: hookCategory,
        usages: wrapper.calledBy.length,
        dependencies: extractHookDependencies(wrapper),
        returnType: wrapper.returnType,
        isAsync: wrapper.isAsync,
      });
    }
  }
  
  // Sort by usages and limit
  hooksList.sort((a, b) => b.usages - a.usages);
  const limited = hooksList.slice(0, limit);
  
  // Calculate stats
  const byCategory: Record<string, number> = {};
  for (const hook of hooksList) {
    byCategory[hook.category] = (byCategory[hook.category] ?? 0) + 1;
  }
  
  const totalUsages = hooksList.reduce((sum, h) => sum + h.usages, 0);
  const mostUsed = hooksList[0]?.name ?? 'N/A';
  
  const data: HooksData = {
    hooks: limited,
    byCategory,
    stats: {
      total: hooksList.length,
      customHooks: hooksList.filter(h => h.name.startsWith('use')).length,
      mostUsed,
      avgUsages: hooksList.length > 0 ? Math.round(totalUsages / hooksList.length) : 0,
    },
  };
  
  // Build summary
  const summary = hooksList.length > 0
    ? `Found ${hooksList.length} custom hooks. Most used: "${mostUsed}" (${hooksList[0]?.usages ?? 0} usages)`
    : 'No custom hooks detected';
  
  // Record metrics
  metrics.recordRequest('drift_hooks', Date.now() - startTime, true, false);
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: hooksList.length > 0
        ? ['Check existing hooks before creating new ones', 'Consider composing existing hooks']
        : ['No custom hooks found - consider extracting reusable logic into hooks'],
      relatedTools: ['drift_wrappers', 'drift_signature', 'drift_imports'],
    })
    .buildContent();
}

// ============================================================================
// Helpers
// ============================================================================

function isHook(wrapper: WrapperFunction): boolean {
  // React/Vue hook naming convention
  if (wrapper.name.startsWith('use') && wrapper.name.length > 3) {
    const charAfterUse = wrapper.name[3];
    // Must be followed by uppercase letter (useEffect, useState, etc.)
    if (charAfterUse === charAfterUse?.toUpperCase()) {
      return true;
    }
  }
  
  // Check if it uses React hooks
  const primitives = wrapper.primitiveSignature.join(' ').toLowerCase();
  if (primitives.includes('usestate') || 
      primitives.includes('useeffect') ||
      primitives.includes('usecontext') ||
      primitives.includes('usememo') ||
      primitives.includes('usecallback') ||
      primitives.includes('useref') ||
      primitives.includes('usereducer')) {
    return true;
  }
  
  // Vue composables
  if (primitives.includes('ref(') || 
      primitives.includes('reactive(') ||
      primitives.includes('computed(') ||
      primitives.includes('watch(') ||
      primitives.includes('onmounted')) {
    return true;
  }
  
  return false;
}

function categorizeHook(wrapper: WrapperFunction, clusterCategory: string): string {
  // Map cluster category to hook category
  switch (clusterCategory) {
    case 'state-management':
      return 'state';
    case 'data-fetching':
      return 'fetch';
    case 'side-effects':
      return 'effect';
    case 'form-handling':
      return 'form';
    case 'authentication':
      return 'auth';
    default:
      return inferHookCategory(wrapper);
  }
}

function inferHookCategory(wrapper: WrapperFunction): string {
  const name = wrapper.name.toLowerCase();
  const primitives = wrapper.primitiveSignature.join(' ').toLowerCase();
  
  // State management
  if (name.includes('state') || name.includes('store') || name.includes('reducer') ||
      primitives.includes('usestate') || primitives.includes('usereducer') ||
      primitives.includes('zustand') || primitives.includes('redux') || primitives.includes('recoil')) {
    return 'state';
  }
  
  // Data fetching
  if (name.includes('fetch') || name.includes('query') || name.includes('data') ||
      name.includes('api') || name.includes('request') ||
      primitives.includes('fetch') || primitives.includes('axios') ||
      primitives.includes('swr') || primitives.includes('react-query') || primitives.includes('tanstack')) {
    return 'fetch';
  }
  
  // Side effects
  if (name.includes('effect') || name.includes('subscription') || name.includes('listener') ||
      primitives.includes('useeffect') || primitives.includes('uselayouteffect')) {
    return 'effect';
  }
  
  // Form handling
  if (name.includes('form') || name.includes('input') || name.includes('field') ||
      primitives.includes('useform') || primitives.includes('formik') || primitives.includes('react-hook-form')) {
    return 'form';
  }
  
  // Auth
  if (name.includes('auth') || name.includes('user') || name.includes('session') ||
      name.includes('login') || name.includes('permission')) {
    return 'auth';
  }
  
  return 'other';
}

function extractHookDependencies(wrapper: WrapperFunction): string[] {
  const deps: string[] = [];
  
  // Extract React hooks from primitives
  for (const prim of wrapper.primitiveSignature) {
    if (prim.startsWith('use') || prim.includes('use')) {
      deps.push(prim);
    }
  }
  
  // Also check direct primitives
  for (const prim of wrapper.directPrimitives) {
    if (prim.startsWith('use') && !deps.includes(prim)) {
      deps.push(prim);
    }
  }
  
  return deps.slice(0, 5); // Limit to 5 dependencies
}

/**
 * Tool definition for MCP registration
 */
export const hooksToolDefinition = {
  name: 'drift_hooks',
  description: 'Find custom React/Vue hooks in the codebase. Returns hook names, categories, usage counts, and dependencies.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      category: {
        type: 'string',
        enum: ['state', 'fetch', 'effect', 'form', 'auth', 'all'],
        description: 'Filter by hook category (default: all)',
      },
      search: {
        type: 'string',
        description: 'Search hooks by name pattern',
      },
      limit: {
        type: 'number',
        description: 'Max results to return (default: 20)',
      },
    },
  },
};
