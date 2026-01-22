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
];

// Handler exports
export { handleStatus, handleStatusWithService } from './status.js';
export { handleCapabilities } from './capabilities.js';

// Re-export types
export type { StatusData } from './status.js';
export type { CapabilitiesData } from './capabilities.js';
