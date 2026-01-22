/**
 * drift_capabilities - Tool Guide
 * 
 * Discovery tool that explains all available tools and when to use them.
 * Helps AI agents understand the tool landscape.
 */

import { createResponseBuilder } from '../../infrastructure/index.js';
import { TOOL_CATEGORIES } from '../registry.js';

export interface CapabilitiesData {
  layers: {
    discovery: ToolInfo[];
    exploration: ToolInfo[];
    detail: ToolInfo[];
  };
  categories: string[];
  quickStart: string[];
}

interface ToolInfo {
  name: string;
  purpose: string;
  whenToUse: string;
}

const TOOL_INFO: Record<string, ToolInfo> = {
  // Discovery
  drift_status: {
    name: 'drift_status',
    purpose: 'Get codebase health snapshot',
    whenToUse: 'First tool to call. Understand overall state before diving deeper.',
  },
  drift_capabilities: {
    name: 'drift_capabilities',
    purpose: 'List all tools and their purposes',
    whenToUse: 'When unsure which tool to use for a task.',
  },
  
  // Exploration
  drift_patterns_list: {
    name: 'drift_patterns_list',
    purpose: 'List patterns with summaries',
    whenToUse: 'To find patterns by category, status, or confidence. Returns IDs for detail tools.',
  },
  drift_files_list: {
    name: 'drift_files_list',
    purpose: 'List files with pattern counts',
    whenToUse: 'To find files relevant to a task or understand pattern distribution.',
  },
  drift_security_summary: {
    name: 'drift_security_summary',
    purpose: 'Security posture overview',
    whenToUse: 'Before working on security-sensitive code or reviewing data access.',
  },
  drift_contracts_list: {
    name: 'drift_contracts_list',
    purpose: 'List API contracts and mismatches',
    whenToUse: 'When working on API endpoints or debugging frontend/backend issues.',
  },
  drift_trends: {
    name: 'drift_trends',
    purpose: 'Pattern trend analysis',
    whenToUse: 'To check if code quality is improving or declining over time.',
  },
  
  // Detail
  drift_pattern_get: {
    name: 'drift_pattern_get',
    purpose: 'Full pattern details',
    whenToUse: 'After finding a pattern ID from drift_patterns_list. Get complete info.',
  },
  drift_file_patterns: {
    name: 'drift_file_patterns',
    purpose: 'All patterns in a file',
    whenToUse: 'Before modifying a file. Understand its patterns and conventions.',
  },
  drift_code_examples: {
    name: 'drift_code_examples',
    purpose: 'Real code snippets for patterns',
    whenToUse: 'Before generating code. See how patterns are implemented in this codebase.',
  },
  drift_impact_analysis: {
    name: 'drift_impact_analysis',
    purpose: 'What breaks if you change X',
    whenToUse: 'Before refactoring. Understand downstream effects of changes.',
  },
  drift_reachability: {
    name: 'drift_reachability',
    purpose: 'What data can code reach',
    whenToUse: 'Security review. Understand data access from an entry point.',
  },
};

export async function handleCapabilities(
  _args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<CapabilitiesData>();
  
  const data: CapabilitiesData = {
    layers: {
      discovery: TOOL_CATEGORIES.discovery
        .map(name => TOOL_INFO[name])
        .filter((t): t is ToolInfo => t !== undefined),
      exploration: TOOL_CATEGORIES.exploration
        .map(name => TOOL_INFO[name])
        .filter((t): t is ToolInfo => t !== undefined),
      detail: TOOL_CATEGORIES.detail
        .map(name => TOOL_INFO[name])
        .filter((t): t is ToolInfo => t !== undefined),
    },
    categories: [
      'api', 'auth', 'security', 'errors', 'logging',
      'data-access', 'config', 'testing', 'performance',
      'components', 'styling', 'structural', 'types',
      'accessibility', 'documentation',
    ],
    quickStart: [
      '1. drift_status → Get health overview',
      '2. drift_patterns_list → Find relevant patterns',
      '3. drift_code_examples → See implementations',
      '4. Generate code following the patterns',
    ],
  };
  
  return builder
    .withSummary('Drift provides codebase intelligence through 3 tool layers: Discovery (status), Exploration (lists), and Detail (specifics).')
    .withData(data)
    .withHints({
      nextActions: [
        'Start with drift_status to see codebase health',
        'Use drift_patterns_list to explore patterns by category',
      ],
    })
    .buildContent();
}
