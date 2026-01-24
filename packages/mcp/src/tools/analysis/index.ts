/**
 * Analysis Tools Index
 * 
 * Tools for deeper analysis of codebase patterns and quality.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const TEST_TOPOLOGY_ACTIONS = ['status', 'coverage', 'uncovered', 'mocks', 'affected', 'quality'];
const COUPLING_ACTIONS = ['status', 'cycles', 'hotspots', 'analyze', 'refactor-impact', 'unused-exports'];
const ERROR_HANDLING_ACTIONS = ['status', 'gaps', 'boundaries', 'unhandled', 'analyze'];

export const ANALYSIS_TOOLS: Tool[] = [
  {
    name: 'drift_test_topology',
    description: 'Analyze test-to-code mappings, mock patterns, and test quality. Actions: status (overview), coverage (file coverage), uncovered (find gaps), mocks (mock analysis), affected (minimum test set), quality (test quality metrics).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: TEST_TOPOLOGY_ACTIONS,
          description: 'Action to perform: status, coverage, uncovered, mocks, affected, quality',
        },
        file: {
          type: 'string',
          description: 'File path for coverage/quality actions',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Changed files for affected action',
        },
        limit: {
          type: 'number',
          description: 'Max results for uncovered action (default: 20)',
        },
        minRisk: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Minimum risk level for uncovered action (default: medium)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_coupling',
    description: 'Analyze module dependencies, detect cycles, and calculate coupling metrics (Robert C. Martin metrics). Actions: status (overview), cycles (dependency cycles), hotspots (highly coupled modules), analyze (specific module), refactor-impact (change impact), unused-exports (dead exports).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: COUPLING_ACTIONS,
          description: 'Action to perform: status, cycles, hotspots, analyze, refactor-impact, unused-exports',
        },
        module: {
          type: 'string',
          description: 'Module path for analyze/refactor-impact actions',
        },
        limit: {
          type: 'number',
          description: 'Max results for hotspots/unused-exports (default: 15/20)',
        },
        minCoupling: {
          type: 'number',
          description: 'Minimum coupling threshold for hotspots (default: 3)',
        },
        maxCycleLength: {
          type: 'number',
          description: 'Maximum cycle length to report (default: 10)',
        },
        minSeverity: {
          type: 'string',
          enum: ['info', 'warning', 'critical'],
          description: 'Minimum severity for cycles (default: info)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_error_handling',
    description: 'Analyze error handling patterns, boundaries, and gaps. Detects unhandled error paths and swallowed exceptions. Actions: status (overview), gaps (find issues), boundaries (error boundaries), unhandled (unhandled paths), analyze (specific function).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ERROR_HANDLING_ACTIONS,
          description: 'Action to perform: status, gaps, boundaries, unhandled, analyze',
        },
        function: {
          type: 'string',
          description: 'Function path for analyze action',
        },
        limit: {
          type: 'number',
          description: 'Max results for gaps action (default: 20)',
        },
        minSeverity: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Minimum severity for gaps/unhandled (default: medium)',
        },
      },
      required: ['action'],
    },
  },
];

export { handleTestTopology, type TestTopologyArgs, type TestTopologyAction } from './test-topology.js';
export { handleCoupling, type CouplingArgs, type CouplingAction } from './coupling.js';
export { handleErrorHandling, type ErrorHandlingArgs, type ErrorHandlingAction } from './error-handling.js';
