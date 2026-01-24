/**
 * Detail Tools
 * 
 * Layer 3: Focused single-item tools for deep inspection.
 * These return complete information for a specific pattern, file, or analysis.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const PATTERN_CATEGORIES = [
  'api', 'auth', 'security', 'errors', 'logging',
  'data-access', 'config', 'testing', 'performance',
  'components', 'styling', 'structural', 'types',
  'accessibility', 'documentation',
];

const GENE_IDS = [
  'variant-handling', 'responsive-approach', 'state-styling',
  'theming', 'spacing-philosophy', 'animation-approach',
];

const WRAPPER_CATEGORIES = [
  'state-management', 'data-fetching', 'side-effects', 'authentication',
  'authorization', 'validation', 'dependency-injection', 'middleware',
  'testing', 'logging', 'caching', 'error-handling', 'async-utilities',
  'form-handling', 'routing', 'factory', 'decorator', 'utility', 'other',
];

export const DETAIL_TOOLS: Tool[] = [
  // Pattern Tools
  {
    name: 'drift_pattern_get',
    description: 'Get complete details for a specific pattern. Includes all locations, outliers, confidence breakdown, and examples. Use pattern ID from drift_patterns_list.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Pattern ID (from drift_patterns_list)',
        },
        includeLocations: {
          type: 'boolean',
          description: 'Include all location details (default: true)',
        },
        includeOutliers: {
          type: 'boolean',
          description: 'Include outlier details (default: true)',
        },
        maxLocations: {
          type: 'number',
          description: 'Max locations to return (default: 20)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'drift_code_examples',
    description: 'Get real code examples for patterns. Shows how patterns are implemented in this codebase. Essential before generating new code.',
    inputSchema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: `Categories to get examples for: ${PATTERN_CATEGORIES.join(', ')}`,
        },
        pattern: {
          type: 'string',
          description: 'Specific pattern name or ID',
        },
        maxExamples: {
          type: 'number',
          description: 'Max examples per pattern (default: 3)',
        },
        contextLines: {
          type: 'number',
          description: 'Lines of context around each match (default: 10)',
        },
      },
    },
  },
  
  // File Tools
  {
    name: 'drift_files_list',
    description: 'List files with patterns matching a glob pattern. Shows pattern counts and categories per file. Supports pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Glob pattern to match files (default: **/*)',
        },
        category: {
          type: 'string',
          description: 'Filter to files with patterns in this category',
        },
        limit: {
          type: 'number',
          description: 'Max files to return (default: 20)',
        },
        cursor: {
          type: 'string',
          description: 'Pagination cursor from previous response',
        },
      },
    },
  },
  {
    name: 'drift_file_patterns',
    description: 'Get all patterns found in a specific file. Shows pattern details, locations within the file, and outliers.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File path (relative to project root)',
        },
        category: {
          type: 'string',
          description: 'Filter to patterns in this category',
        },
      },
      required: ['file'],
    },
  },
  
  // Call Graph Analysis Tools
  {
    name: 'drift_impact_analysis',
    description: 'Analyze the impact of changing a file or function. Shows affected callers, entry points, and sensitive data paths. Use before making changes to understand blast radius.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'File path or function name to analyze',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum call depth to traverse (default: 10)',
        },
        limit: {
          type: 'number',
          description: 'Max items per section (default: 10)',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'drift_reachability',
    description: 'Analyze data reachability. Forward: "What data can this code access?" Inverse: "Who can access this data?" Essential for security analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['forward', 'inverse'],
          description: 'forward: what data can location access. inverse: who can access target data (default: forward)',
        },
        location: {
          type: 'string',
          description: 'For forward: file:line or function_name',
        },
        target: {
          type: 'string',
          description: 'For inverse: table or table.field',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum traversal depth (default: 10)',
        },
        limit: {
          type: 'number',
          description: 'Max items to return (default: 15)',
        },
        sensitiveOnly: {
          type: 'boolean',
          description: 'Only show sensitive data access (default: false)',
        },
      },
    },
  },
  
  // DNA Tools
  {
    name: 'drift_dna_profile',
    description: 'Get the complete styling DNA profile. Shows how components are styled (variants, responsive, states, theming, spacing, animation) with confidence scores.',
    inputSchema: {
      type: 'object',
      properties: {
        gene: {
          type: 'string',
          enum: GENE_IDS,
          description: 'Specific gene to query (optional)',
        },
      },
    },
  },
  
  // Wrapper Detection Tools
  {
    name: 'drift_wrappers',
    description: 'Detect framework wrapper patterns. Identifies custom abstractions built on top of framework primitives (React hooks, Express middleware, etc.). Shows clusters of similar wrappers with confidence scores.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: WRAPPER_CATEGORIES,
          description: 'Filter by wrapper category',
        },
        minConfidence: {
          type: 'number',
          description: 'Minimum cluster confidence 0-1 (default: 0.5)',
        },
        minClusterSize: {
          type: 'number',
          description: 'Minimum wrappers per cluster (default: 2)',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum wrapper depth to traverse (default: 10)',
        },
        includeTests: {
          type: 'boolean',
          description: 'Include test files in analysis (default: false)',
        },
        limit: {
          type: 'number',
          description: 'Maximum clusters to return (default: 20)',
        },
      },
    },
  },
];

// Handler exports
export { handlePatternGet, handlePatternGetWithService } from './pattern-get.js';
export { handleCodeExamples, handleCodeExamplesWithService } from './code-examples.js';
export { handleFilesList } from './files-list.js';
export { handleFilePatterns } from './file-patterns.js';
export { handleImpactAnalysis } from './impact-analysis.js';
export { handleReachability } from './reachability.js';
export { handleDNAProfile } from './dna-profile.js';
export { handleWrappers, handleWrappersWithConfig } from './wrappers.js';

// Re-export types
export type { PatternGetData, PatternLocation, PatternOutlier, PatternGetArgs } from './pattern-get.js';
export type { CodeExamplesData, CodeExample, CodeExamplesArgs } from './code-examples.js';
export type { FilesListData, FileEntry } from './files-list.js';
export type { FilePatternData, FilePattern, FilePatternLocation } from './file-patterns.js';
export type { ImpactData, AffectedCaller, SensitivePath } from './impact-analysis.js';
export type { ReachabilityData, ForwardReachabilityData, InverseReachabilityData, ReachableData, SensitiveField, AccessPath } from './reachability.js';
export type { DNAProfileData, GeneProfile } from './dna-profile.js';
export type { WrappersData, WrappersArgs, ClusterSummary, WrapperSummary } from './wrappers.js';
