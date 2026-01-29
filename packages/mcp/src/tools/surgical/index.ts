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
 * - drift_dependencies: Package dependencies lookup (multi-language)
 * - drift_middleware: Middleware pattern lookup
 * - drift_hooks: React/Vue hooks lookup
 * - drift_errors: Error types and handling gaps
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
export * from './dependencies.js';
export * from './middleware.js';
export * from './hooks.js';
export * from './errors.js';

import { callersToolDefinition } from './callers.js';
import { dependenciesToolDefinition } from './dependencies.js';
import { errorsToolDefinition } from './errors.js';
import { hooksToolDefinition } from './hooks.js';
import { importsToolDefinition } from './imports.js';
import { middlewareToolDefinition } from './middleware.js';
import { prevalidateToolDefinition } from './prevalidate.js';
import { recentToolDefinition } from './recent.js';
import { signatureToolDefinition } from './signature.js';
import { similarToolDefinition } from './similar.js';
import { testTemplateToolDefinition } from './test-template.js';
import { typeToolDefinition } from './type.js';

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
  dependenciesToolDefinition,
  middlewareToolDefinition,
  hooksToolDefinition,
  errorsToolDefinition,
];
