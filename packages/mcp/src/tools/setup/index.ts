/**
 * Setup Tools - Initialize and configure drift for a project
 * 
 * Enables AI agents to set up drift without CLI access:
 * - init: Initialize drift in a project
 * - scan: Run pattern detection scan
 * - callgraph: Build call graph for reachability analysis
 * - full: Run init + scan + callgraph in sequence
 * - status: Check initialization state
 * 
 * This is a 100% wrapper around the CLI functionality, providing
 * the same features as `drift init`, `drift scan`, and `drift callgraph build`.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const SETUP_TOOLS: Tool[] = [
  {
    name: 'drift_setup',
    description: `Initialize and configure drift for a project. Enables AI agents to set up drift without CLI access.

Actions:
- status: Check if drift is initialized and what's been run
- init: Initialize drift in a project (creates .drift/ directory)
- scan: Run pattern detection scan on the codebase (100+ detectors)
- callgraph: Build call graph for reachability analysis
- full: Run init + scan + callgraph in sequence

Features (matching CLI parity):
- Pattern detection with 100+ enterprise detectors
- Data boundary scanning (tables, access points, sensitive fields)
- Test topology building (test-to-code mappings)
- Constants extraction with secret detection
- History snapshots for trend tracking
- Data lake materialization for fast queries
- Native Rust acceleration when available

Use this when:
- Starting work on a new project that doesn't have drift set up
- The project has drift but needs a fresh scan
- You need call graph data for impact/reachability analysis

Note: Long-running operations (scan, callgraph) may take 30s-5min depending on codebase size.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['init', 'scan', 'callgraph', 'full', 'status'],
          description: 'Action to perform (default: status)',
        },
        project: {
          type: 'string',
          description: 'Project name or path. If not specified, uses active project.',
        },
        options: {
          type: 'object',
          description: 'Action-specific options',
          properties: {
            force: {
              type: 'boolean',
              description: 'For init: reinitialize even if already initialized',
            },
            incremental: {
              type: 'boolean',
              description: 'For scan: only scan changed files (faster)',
            },
            categories: {
              type: 'array',
              items: { type: 'string' },
              description: 'For scan: limit to specific pattern categories (api, auth, security, errors, etc.)',
            },
            boundaries: {
              type: 'boolean',
              description: 'For scan: include data boundary scanning (default: true)',
            },
            contracts: {
              type: 'boolean',
              description: 'For scan: include BE↔FE contract scanning (default: true)',
            },
            testTopology: {
              type: 'boolean',
              description: 'For scan: build test topology for test-to-code mappings (default: false)',
            },
            constants: {
              type: 'boolean',
              description: 'For scan: extract constants with secret detection (default: false)',
            },
            callgraph: {
              type: 'boolean',
              description: 'For scan: also build call graph during scan (default: false)',
            },
            timeout: {
              type: 'number',
              description: 'For scan: timeout in seconds (default: 300 = 5 minutes)',
            },
            security: {
              type: 'boolean',
              description: 'For callgraph: include security prioritization with P0-P4 tiers',
            },
          },
        },
      },
    },
  },
  {
    name: 'drift_telemetry',
    description: `Manage telemetry settings for Drift. Telemetry helps improve pattern detection by sharing anonymized data.

Actions:
- status: Check current telemetry settings
- enable: Enable telemetry (opt-in to help improve Drift)
- disable: Disable telemetry

Privacy Guarantees:
- No source code is ever sent
- Only pattern signatures (SHA-256 hashes), categories, and confidence scores
- Aggregate statistics (pattern counts, languages detected)
- Anonymous installation ID (UUID, not tied to identity)

Why enable telemetry?
- Helps improve pattern detection accuracy
- Identifies which detectors need tuning
- Enables ML-based confidence calibration
- Supports the open-source project`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'enable', 'disable'],
          description: 'Action to perform',
        },
      },
      required: ['action'],
    },
  },
];

export { handleSetup } from './handler.js';
export { handleTelemetry, telemetryToolDefinition } from './telemetry-handler.js';
