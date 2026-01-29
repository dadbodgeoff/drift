/**
 * Orchestration Tools
 * 
 * Meta-layer tools that understand intent and synthesize context from multiple sources.
 * These are the "smart" tools that reduce cognitive load on the AI.
 */

import { packageContextToolDefinition } from './package-context.js';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const ORCHESTRATION_TOOLS: Tool[] = [
  {
    name: 'drift_context',
    description: `Get curated context for a specific task. This is the RECOMMENDED STARTING POINT for any code generation task.

Instead of calling multiple tools and synthesizing results yourself, tell drift_context what you're trying to do and it will return everything you need:
- Relevant patterns with examples
- Files you'll likely need to modify  
- Guidance on how to approach the task
- Warnings about potential issues
- Confidence signals so you know when to verify

WHEN TO USE:
- Starting any code generation task
- Before making changes to unfamiliar code
- When you need to understand how something is done in this codebase

MULTI-PROJECT SUPPORT:
- Use the optional "project" parameter to target a specific registered project
- Projects are registered via "drift projects add <path>"
- Use drift_projects action="list" to see available projects

EXAMPLE:
  intent: "add_feature", focus: "user authentication"
  → Returns auth patterns, example code, files to modify, security warnings
  
  intent: "fix_bug", focus: "payment", project: "backend"
  → Returns context from the "backend" project specifically`,
    inputSchema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: ['add_feature', 'fix_bug', 'refactor', 'security_audit', 'understand_code', 'add_test'],
          description: `What are you trying to accomplish?
- add_feature: Adding new functionality
- fix_bug: Fixing a bug or issue
- refactor: Improving code structure without changing behavior
- security_audit: Reviewing code for security issues
- understand_code: Learning how something works
- add_test: Adding test coverage`,
        },
        focus: {
          type: 'string',
          description: 'The specific area, feature, or file you\'re working with. Examples: "user authentication", "payment processing", "src/api/users.ts"',
        },
        question: {
          type: 'string',
          description: 'Optional: A specific question you need answered. This helps tailor the guidance.',
        },
        project: {
          type: 'string',
          description: 'Optional: Target a specific registered project by name. Use drift_projects action="list" to see available projects.',
        },
      },
      required: ['intent', 'focus'],
    },
  },
  packageContextToolDefinition as Tool,
];

// Handler export
export { handleContext } from './context.js';
export { handlePackageContext } from './package-context.js';

// Type exports
export type {
  TaskIntent,
  ContextPackage,
  RelevantPattern,
  SuggestedFile,
  Guidance,
  Warning,
  Confidence,
  DeeperDive,
} from './context.js';

export type {
  PackageContextInput,
  PackageContextOutput,
  PackageListResult,
} from './package-context.js';
