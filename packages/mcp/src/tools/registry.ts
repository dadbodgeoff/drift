/**
 * Tool Registry
 * 
 * Central registry for all MCP tools with:
 * - Tool definitions (schemas)
 * - Handler routing
 * - Middleware support
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { DISCOVERY_TOOLS } from './discovery/index.js';
import { EXPLORATION_TOOLS } from './exploration/index.js';
import { DETAIL_TOOLS } from './detail/index.js';
import { SURGICAL_TOOLS } from './surgical/index.js';
import { ORCHESTRATION_TOOLS } from './orchestration/index.js';
import { ANALYSIS_TOOLS } from './analysis/index.js';
import { GENERATION_TOOLS } from './generation/index.js';

/**
 * All registered tools
 * 
 * Order matters for AI discovery:
 * 1. Orchestration (recommended starting point)
 * 2. Discovery (quick health checks)
 * 3. Surgical (ultra-focused lookups for code generation)
 * 4. Exploration (browsing/listing)
 * 5. Detail (deep inspection)
 * 6. Analysis (deeper analysis)
 * 7. Generation (AI-powered code intelligence)
 */
export const ALL_TOOLS: Tool[] = [
  ...ORCHESTRATION_TOOLS,  // Start here
  ...DISCOVERY_TOOLS,
  ...SURGICAL_TOOLS,       // Quick lookups for AI
  ...EXPLORATION_TOOLS,
  ...DETAIL_TOOLS,
  ...ANALYSIS_TOOLS,
  ...GENERATION_TOOLS,     // AI-powered tools
];

/**
 * Tool categories for documentation
 */
export const TOOL_CATEGORIES = {
  orchestration: ORCHESTRATION_TOOLS.map(t => t.name),
  discovery: DISCOVERY_TOOLS.map(t => t.name),
  surgical: SURGICAL_TOOLS.map(t => t.name),
  exploration: EXPLORATION_TOOLS.map(t => t.name),
  detail: DETAIL_TOOLS.map(t => t.name),
  analysis: ANALYSIS_TOOLS.map(t => t.name),
  generation: GENERATION_TOOLS.map(t => t.name),
};

/**
 * Get tool by name
 */
export function getTool(name: string): Tool | undefined {
  return ALL_TOOLS.find(t => t.name === name);
}

/**
 * Check if tool exists
 */
export function hasTool(name: string): boolean {
  return ALL_TOOLS.some(t => t.name === name);
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: 'orchestration' | 'discovery' | 'surgical' | 'exploration' | 'detail' | 'analysis' | 'generation'): Tool[] {
  switch (category) {
    case 'orchestration':
      return ORCHESTRATION_TOOLS;
    case 'discovery':
      return DISCOVERY_TOOLS;
    case 'surgical':
      return SURGICAL_TOOLS;
    case 'exploration':
      return EXPLORATION_TOOLS;
    case 'detail':
      return DETAIL_TOOLS;
    case 'analysis':
      return ANALYSIS_TOOLS;
    case 'generation':
      return GENERATION_TOOLS;
  }
}
