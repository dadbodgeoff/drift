/**
 * Surgical Tools
 * 
 * Ultra-focused, minimal-token tools for AI coding assistants.
 * These tools provide surgical access to codebase intelligence,
 * returning exactly what's needed for code generation.
 * 
 * Layer: Surgical (between Orchestration and Detail)
 * Token Budget: 200-500 target, 1000 max
 * 
 * Tools:
 * - drift_signature: Get function signatures without reading files
 * - drift_callers: Lightweight "who calls this" lookup
 * - drift_imports: Resolve correct import statements
 * - drift_prevalidate: Validate code before writing
 * - drift_similar: Find semantically similar code
 * - drift_type: Expand type definitions
 * - drift_recent: Show recent changes in area
 * - drift_test_template: Generate test scaffolding
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export * from './signature.js';
export * from './callers.js';
export * from './imports.js';
export * from './prevalidate.js';
export * from './similar.js';
export * from './type.js';
export * from './recent.js';
export * from './test-template.js';

import { signatureToolDefinition } from './signature.js';
import { callersToolDefinition } from './callers.js';
import { importsToolDefinition } from './imports.js';
import { prevalidateToolDefinition } from './prevalidate.js';
import { similarToolDefinition } from './similar.js';
import { typeToolDefinition } from './type.js';
import { recentToolDefinition } from './recent.js';
import { testTemplateToolDefinition } from './test-template.js';

/**
 * All surgical tools
 */
export const SURGICAL_TOOLS: Tool[] = [
  signatureToolDefinition,
  callersToolDefinition,
  importsToolDefinition,
  prevalidateToolDefinition,
  similarToolDefinition,
  typeToolDefinition,
  recentToolDefinition,
  testTemplateToolDefinition,
];
