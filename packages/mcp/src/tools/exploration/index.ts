/**
 * Exploration Tools
 * 
 * Layer 2: Paginated listing tools for exploring patterns, files, and analysis.
 * These return summaries with IDs for use with detail tools.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const PATTERN_CATEGORIES = [
  'api', 'auth', 'security', 'errors', 'logging',
  'data-access', 'config', 'testing', 'performance',
  'components', 'styling', 'structural', 'types',
  'accessibility', 'documentation',
];

export const EXPLORATION_TOOLS: Tool[] = [
  {
    name: 'drift_patterns_list',
    description: 'List patterns with summaries. Returns pattern IDs for use with drift_pattern_get. Supports filtering by category, status, and confidence.',
    inputSchema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: `Filter by categories: ${PATTERN_CATEGORIES.join(', ')}`,
        },
        status: {
          type: 'string',
          enum: ['all', 'approved', 'discovered', 'ignored'],
          description: 'Filter by approval status (default: all)',
        },
        minConfidence: {
          type: 'number',
          description: 'Minimum confidence 0.0-1.0 (default: 0)',
        },
        search: {
          type: 'string',
          description: 'Search pattern names and descriptions',
        },
        limit: {
          type: 'number',
          description: 'Max patterns to return (default: 20, max: 50)',
        },
        cursor: {
          type: 'string',
          description: 'Pagination cursor from previous response',
        },
      },
    },
  },
  {
    name: 'drift_security_summary',
    description: 'Get security posture overview. Shows sensitive data access patterns, security issues, and data flow summary. Use before working on security-sensitive code.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          enum: ['all', 'critical', 'data-access', 'auth'],
          description: 'Focus area (default: all)',
        },
        limit: {
          type: 'number',
          description: 'Max items per section (default: 10)',
        },
      },
    },
  },
  {
    name: 'drift_contracts_list',
    description: 'List API contracts between frontend and backend. Shows verified contracts, mismatches, and discovered endpoints.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['all', 'verified', 'mismatch', 'discovered'],
          description: 'Filter by contract status (default: all)',
        },
        limit: {
          type: 'number',
          description: 'Max contracts to return (default: 20)',
        },
        cursor: {
          type: 'string',
          description: 'Pagination cursor',
        },
      },
    },
  },
  {
    name: 'drift_trends',
    description: 'Get pattern trend analysis. Shows how patterns have changed over time, regressions, and improvements.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['7d', '30d', '90d'],
          description: 'Time period to analyze (default: 7d)',
        },
        category: {
          type: 'string',
          description: 'Filter trends by category',
        },
        severity: {
          type: 'string',
          enum: ['all', 'critical', 'warning'],
          description: 'Filter by severity (default: all)',
        },
        limit: {
          type: 'number',
          description: 'Max trends to return (default: 20)',
        },
      },
    },
  },
  {
    name: 'drift_env',
    description: 'Analyze environment variable access patterns. Shows which code accesses which env vars, sensitivity classification (secrets, credentials, config), and required variables.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['overview', 'list', 'secrets', 'required', 'variable', 'file'],
          description: 'Action to perform: overview (default), list (all vars), secrets (sensitive vars), required (vars without defaults), variable (specific var details), file (vars accessed by file)',
        },
        variable: {
          type: 'string',
          description: 'Variable name for action="variable"',
        },
        file: {
          type: 'string',
          description: 'File pattern for action="file"',
        },
        sensitivity: {
          type: 'string',
          enum: ['secret', 'credential', 'config'],
          description: 'Filter by sensitivity for action="list"',
        },
        limit: {
          type: 'number',
          description: 'Max items to return (default: 10)',
        },
      },
    },
  },
];

// Handler exports
export { handlePatternsList, handlePatternsListWithService } from './patterns-list.js';
export { handleSecuritySummary } from './security-summary.js';
export { handleContractsList } from './contracts-list.js';
export { handleTrends } from './trends.js';
export { handleEnv } from './env.js';

// Re-export types
export type { PatternSummary, PatternsListData, PatternsListArgs } from './patterns-list.js';
export type { SecuritySummaryData } from './security-summary.js';
export type { ContractSummary, ContractsListData } from './contracts-list.js';
export type { TrendItem, TrendsData } from './trends.js';
export type { EnvData } from './env.js';
