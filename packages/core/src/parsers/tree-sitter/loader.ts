/**
 * Tree-sitter Loader
 *
 * Handles loading tree-sitter and tree-sitter-python with graceful fallback.
 * Provides functions to check availability and access the parser/language.
 *
 * @requirements 3.5 - Unified AST query interface
 */

import { createRequire } from 'node:module';

import type { TreeSitterParser, TreeSitterLanguage } from './types.js';

// Create require function for ESM compatibility
const require = createRequire(import.meta.url);

// ============================================
// Module State
// ============================================

/** Whether tree-sitter is available */
let treeSitterAvailable: boolean | null = null;

/** Cached tree-sitter Parser constructor */
let cachedTreeSitter: (new () => TreeSitterParser) | null = null;

/** Cached Python language */
let cachedPythonLanguage: TreeSitterLanguage | null = null;

/** Loading error message if any */
let loadingError: string | null = null;

// ============================================
// Public API
// ============================================

/**
 * Check if tree-sitter is available.
 *
 * This function attempts to load tree-sitter and tree-sitter-python
 * on first call and caches the result.
 *
 * @returns true if tree-sitter is available and working
 */
export function isTreeSitterAvailable(): boolean {
  if (treeSitterAvailable !== null) {
    return treeSitterAvailable;
  }

  try {
    loadTreeSitter();
    treeSitterAvailable = true;
  } catch (error) {
    treeSitterAvailable = false;
    loadingError = error instanceof Error ? error.message : 'Unknown error loading tree-sitter';
    logDebug(`tree-sitter not available: ${loadingError}`);
  }

  return treeSitterAvailable;
}

/**
 * Get the tree-sitter Parser constructor.
 *
 * @returns TreeSitter Parser constructor
 * @throws Error if tree-sitter is not available
 */
export function getTreeSitter(): new () => TreeSitterParser {
  if (!isTreeSitterAvailable()) {
    throw new Error(`tree-sitter is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedTreeSitter) {
    throw new Error('tree-sitter module not loaded');
  }

  return cachedTreeSitter;
}

/**
 * Get the Python language for tree-sitter.
 *
 * @returns TreeSitter Python language
 * @throws Error if tree-sitter-python is not available
 */
export function getPythonLanguage(): TreeSitterLanguage {
  if (!isTreeSitterAvailable()) {
    throw new Error(`tree-sitter-python is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedPythonLanguage) {
    throw new Error('tree-sitter-python language not loaded');
  }

  return cachedPythonLanguage;
}

/**
 * Create a new tree-sitter parser instance configured for Python.
 *
 * @returns Configured TreeSitter parser
 * @throws Error if tree-sitter is not available
 */
export function createPythonParser(): TreeSitterParser {
  const Parser = getTreeSitter();
  const language = getPythonLanguage();

  const parser = new Parser();
  parser.setLanguage(language);

  return parser;
}

/**
 * Get the loading error message if tree-sitter failed to load.
 *
 * @returns Error message or null if no error
 */
export function getLoadingError(): string | null {
  // Ensure we've attempted to load
  isTreeSitterAvailable();
  return loadingError;
}

/**
 * Reset the loader state (useful for testing).
 */
export function resetLoader(): void {
  treeSitterAvailable = null;
  cachedTreeSitter = null;
  cachedPythonLanguage = null;
  loadingError = null;
}

// ============================================
// Internal Functions
// ============================================

/**
 * Attempt to load tree-sitter and tree-sitter-python.
 *
 * @throws Error if loading fails
 */
function loadTreeSitter(): void {
  // Skip if already loaded
  if (cachedTreeSitter && cachedPythonLanguage) {
    return;
  }

  try {
    // Dynamic require for optional dependencies
    // tree-sitter exports the Parser constructor directly
     
    cachedTreeSitter = require('tree-sitter') as new () => TreeSitterParser;
  } catch (error) {
    throw new Error(
      `Failed to load tree-sitter: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter tree-sitter-python'
    );
  }

  try {
     
    cachedPythonLanguage = require('tree-sitter-python') as TreeSitterLanguage;
  } catch (error) {
    // Clear tree-sitter cache since we can't use it without Python
    cachedTreeSitter = null;
    throw new Error(
      `Failed to load tree-sitter-python: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter-python'
    );
  }

  logDebug('tree-sitter and tree-sitter-python loaded successfully');
}

/**
 * Log debug message if debug mode is enabled.
 *
 * @param message - Message to log
 */
function logDebug(message: string): void {
  if (process.env['DRIFT_PARSER_DEBUG'] === 'true') {
    console.debug(`[tree-sitter-loader] ${message}`);
  }
}
