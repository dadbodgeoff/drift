/**
 * Curation Tools - Pattern approval/ignore with verification
 * 
 * @module tools/curation
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CURATION_TOOLS: Tool[] = [
  {
    name: 'drift_curate',
    description: `Curate patterns: approve, ignore, or review with mandatory verification.

ANTI-HALLUCINATION: This tool requires evidence verification before approving patterns.
AI agents must grep actual files and provide proof that patterns exist.

Actions:
- review: Get patterns pending review with evidence requirements
- verify: Verify a pattern exists (REQUIRED before approve for non-high-confidence)
- approve: Approve a verified pattern
- ignore: Ignore a pattern with reason
- bulk_approve: Auto-approve patterns with confidence >= 0.95
- audit: View curation decision history

Workflow:
1. Use action="review" to see pending patterns
2. For each pattern, grep the codebase to find evidence
3. Use action="verify" with evidence to validate
4. If verified, use action="approve" to approve

Evidence Requirements (by confidence level):
- High (>=0.85): 1 file, no snippet required
- Medium (>=0.65): 2 files, snippets required  
- Low (>=0.45): 3 files, snippets required
- Uncertain (<0.45): 5 files, snippets required`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['review', 'verify', 'approve', 'ignore', 'bulk_approve', 'audit'],
          description: 'Action to perform',
        },
        category: {
          type: 'string',
          description: 'Filter by pattern category (for review)',
        },
        minConfidence: {
          type: 'number',
          description: 'Minimum confidence filter (for review)',
        },
        maxConfidence: {
          type: 'number', 
          description: 'Maximum confidence filter (for review)',
        },
        limit: {
          type: 'number',
          description: 'Max patterns to return (for review, default 20)',
        },
        patternId: {
          type: 'string',
          description: 'Pattern ID (for verify/approve/ignore)',
        },
        evidence: {
          type: 'object',
          description: 'Evidence for verification (for verify/approve)',
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Files where pattern exists',
            },
            lines: {
              type: 'array',
              items: { type: 'number' },
              description: 'Line numbers where pattern found',
            },
            snippets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Code snippets as evidence',
            },
            reasoning: {
              type: 'string',
              description: 'Why this is a valid pattern',
            },
          },
          required: ['files', 'reasoning'],
        },
        approvedBy: {
          type: 'string',
          description: 'Who approved (for approve)',
        },
        ignoreReason: {
          type: 'string',
          description: 'Why ignoring (required for ignore)',
        },
        confidenceThreshold: {
          type: 'number',
          description: 'Min confidence for bulk_approve (default 0.95)',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview bulk_approve without changes',
        },
      },
      required: ['action'],
    },
  },
];

export { handleCurate } from './handler.js';
export * from './types.js';
