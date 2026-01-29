/**
 * Tree-sitter C++ Loader
 *
 * Handles loading tree-sitter and tree-sitter-cpp with graceful fallback.
 * Provides functions to check availability and access the parser/language.
 *
 * @requirements C++ Language Support
 * @license Apache-2.0
 */

import { createRequire } from 'node:module';

import type { TreeSitterParser, TreeSitterLanguage } from './types.js';

// Create require function for ESM compatibility
const require = createRequire(import.meta.url);

// ============================================
// Module State
// ============================================

/** Whether tree-sitter-cpp is available */
let cppAvailable: boolean | null = null;

/** Cached tree-sitter module */
let cachedTreeSitter: (new () => TreeSitterParser) | null = null;

/** Cached C++ language */
let cachedCppLanguage: TreeSitterLanguage | null = null;

/** Loading error message if any */
let loadingError: string | null = null;

// ============================================
// Public API
// ============================================

/**
 * Check if tree-sitter-cpp is available.
 *
 * This function attempts to load tree-sitter and tree-sitter-cpp
 * on first call and caches the result.
 *
 * @returns true if tree-sitter-cpp is available and working
 */
export function isCppTreeSitterAvailable(): boolean {
  if (cppAvailable !== null) {
    return cppAvailable;
  }

  try {
    loadCppTreeSitter();
    cppAvailable = true;
  } catch (error) {
    cppAvailable = false;
    loadingError = error instanceof Error ? error.message : 'Unknown error loading tree-sitter-cpp';
    logDebug(`tree-sitter-cpp not available: ${loadingError}`);
  }

  return cppAvailable;
}

/**
 * Get the C++ language for tree-sitter.
 *
 * @returns TreeSitter C++ language
 * @throws Error if tree-sitter-cpp is not available
 */
export function getCppLanguage(): TreeSitterLanguage {
  if (!isCppTreeSitterAvailable()) {
    throw new Error(`tree-sitter-cpp is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedCppLanguage) {
    throw new Error('tree-sitter-cpp language not loaded');
  }

  return cachedCppLanguage;
}

/**
 * Get the tree-sitter Parser constructor for C++.
 *
 * @returns TreeSitter Parser constructor
 * @throws Error if tree-sitter is not available
 */
export function getCppTreeSitter(): new () => TreeSitterParser {
  if (!isCppTreeSitterAvailable()) {
    throw new Error(`tree-sitter-cpp is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedTreeSitter) {
    throw new Error('tree-sitter module not loaded');
  }

  return cachedTreeSitter;
}

/**
 * Create a new tree-sitter parser instance configured for C++.
 *
 * @returns Configured TreeSitter parser
 * @throws Error if tree-sitter-cpp is not available
 */
export function createCppParser(): TreeSitterParser {
  if (!isCppTreeSitterAvailable()) {
    throw new Error(`tree-sitter-cpp is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedTreeSitter) {
    throw new Error('tree-sitter module not loaded');
  }

  const Parser = cachedTreeSitter;
  const language = getCppLanguage();

  const parser = new Parser();
  parser.setLanguage(language);

  return parser;
}

/**
 * Get the loading error message if tree-sitter-cpp failed to load.
 *
 * @returns Error message or null if no error
 */
export function getCppLoadingError(): string | null {
  // Ensure we've attempted to load
  isCppTreeSitterAvailable();
  return loadingError;
}

/**
 * Reset the loader state (useful for testing).
 */
export function resetCppLoader(): void {
  cppAvailable = null;
  cachedTreeSitter = null;
  cachedCppLanguage = null;
  loadingError = null;
}

// ============================================
// Internal Functions
// ============================================

/**
 * Attempt to load tree-sitter and tree-sitter-cpp.
 *
 * @throws Error if loading fails
 */
function loadCppTreeSitter(): void {
  // Skip if already loaded
  if (cachedTreeSitter && cachedCppLanguage) {
    return;
  }

  try {
    // Dynamic require for optional dependencies
     
    cachedTreeSitter = require('tree-sitter') as new () => TreeSitterParser;
  } catch (error) {
    throw new Error(
      `Failed to load tree-sitter: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter tree-sitter-cpp'
    );
  }

  try {
     
    cachedCppLanguage = require('tree-sitter-cpp') as TreeSitterLanguage;
  } catch (error) {
    // Clear tree-sitter cache since we can't use it without C++
    cachedTreeSitter = null;
    throw new Error(
      `Failed to load tree-sitter-cpp: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter-cpp'
    );
  }

  logDebug('tree-sitter and tree-sitter-cpp loaded successfully');
}

/**
 * Log debug message if debug mode is enabled.
 *
 * @param message - Message to log
 */
function logDebug(message: string): void {
  if (process.env['DRIFT_PARSER_DEBUG'] === 'true') {
    console.debug(`[cpp-loader] ${message}`);
  }
}
