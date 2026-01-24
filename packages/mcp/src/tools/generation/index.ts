/**
 * Generation Tools
 * 
 * AI-powered tools for code generation, validation, and explanation.
 * These tools close the loop between understanding and action.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const ISSUE_TYPES = ['outlier', 'security', 'coupling', 'error-handling', 'test-coverage', 'pattern-violation'];
const EXPLANATION_DEPTHS = ['summary', 'detailed', 'comprehensive'];

export const GENERATION_TOOLS: Tool[] = [
  {
    name: 'drift_suggest_changes',
    description: 'Get AI-guided suggestions for fixing pattern violations, security issues, or code quality problems. Returns specific code changes with before/after examples and rationale.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'File path or function name to analyze',
        },
        issue: {
          type: 'string',
          enum: ISSUE_TYPES,
          description: 'Type of issue to address: outlier (pattern violation), security, coupling, error-handling, test-coverage, pattern-violation',
        },
        patternId: {
          type: 'string',
          description: 'Specific pattern ID if addressing an outlier (from drift_patterns_list)',
        },
        maxSuggestions: {
          type: 'number',
          description: 'Maximum suggestions to return (default: 3)',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'drift_validate_change',
    description: 'Validate proposed code changes against codebase patterns. Returns compliance score, violations, and suggestions. Use before committing changes to ensure consistency.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File path where the change will be made',
        },
        content: {
          type: 'string',
          description: 'The proposed code content to validate',
        },
        diff: {
          type: 'string',
          description: 'Alternative: unified diff format of the change',
        },
        strictMode: {
          type: 'boolean',
          description: 'Fail on any pattern violation (default: false)',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'drift_explain',
    description: 'Get a comprehensive explanation of code in context of the codebase. Combines pattern analysis, call graph, security implications, and dependencies into a coherent narrative.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'File path, function name, or code symbol to explain',
        },
        depth: {
          type: 'string',
          enum: EXPLANATION_DEPTHS,
          description: 'Level of detail: summary (quick overview), detailed (patterns + dependencies), comprehensive (full analysis)',
        },
        focus: {
          type: 'string',
          description: 'Optional focus area: security, performance, architecture, testing',
        },
      },
      required: ['target'],
    },
  },
];

export { handleSuggestChanges } from './suggest-changes.js';
export { handleValidateChange } from './validate-change.js';
export { handleExplain } from './explain.js';
