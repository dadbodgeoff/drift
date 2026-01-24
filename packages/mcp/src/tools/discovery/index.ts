/**
 * Discovery Tools
 * 
 * Layer 1: Lightweight tools for understanding capabilities and status.
 * These should always be fast and return minimal data.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const DISCOVERY_TOOLS: Tool[] = [
  {
    name: 'drift_status',
    description: 'Get codebase health snapshot. Call this first to understand the current state. Returns pattern counts, health score, and critical issues. Always fast, always lightweight.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'drift_capabilities',
    description: 'List all Drift capabilities and when to use each tool. Returns a guide to available tools organized by purpose. Use this when unsure which tool to use.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'drift_projects',
    description: 'List and manage registered drift projects. Enables working across multiple codebases. Actions: list (show all), info (project details), switch (change active), recent (recently used), register (add new).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'info', 'switch', 'recent', 'register'],
          description: 'Action to perform (default: list)',
        },
        project: {
          type: 'string',
          description: 'Project name or ID (for info/switch)',
        },
        path: {
          type: 'string',
          description: 'Project path (for register)',
        },
        language: {
          type: 'string',
          description: 'Filter by language (for list)',
        },
        framework: {
          type: 'string',
          description: 'Filter by framework (for list)',
        },
        limit: {
          type: 'number',
          description: 'Limit results (default: 10)',
        },
      },
    },
  },
];

// Handler exports
export { handleStatus, handleStatusWithService } from './status.js';
export { handleCapabilities } from './capabilities.js';
export { handleProjects } from './projects.js';

// Re-export types
export type { StatusData } from './status.js';
export type { CapabilitiesData } from './capabilities.js';
export type { ProjectsArgs } from './projects.js';
