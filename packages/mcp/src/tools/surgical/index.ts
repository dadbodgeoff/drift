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
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export * from './signature.js';
export * from './callers.js';
export * from './imports.js';
export * from './prevalidate.js';

import { signatureToolDefinition } from './signature.js';
import { callersToolDefinition } from './callers.js';
import { importsToolDefinition } from './imports.js';
import { prevalidateToolDefinition } from './prevalidate.js';

/**
 * All surgical tools
 */
export const SURGICAL_TOOLS: Tool[] = [
  signatureToolDefinition,
  callersToolDefinition,
  importsToolDefinition,
  prevalidateToolDefinition,
];
