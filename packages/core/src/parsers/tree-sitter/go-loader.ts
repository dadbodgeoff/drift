/**
 * Tree-sitter Go Loader
 *
 * Handles loading tree-sitter and tree-sitter-go with graceful fallback.
 * Provides functions to check availability and access the parser/language.
 *
 * @requirements Go Language Support
 */

import { createRequire } from 'node:module';

import type { TreeSitterParser, TreeSitterLanguage } from './types.js';

// Create require function for ESM compatibility
const require = createRequire(import.meta.url);

// ============================================
// Module State
// ============================================

/** Whether tree-sitter-go is available */
let goAvailable: boolean | null = null;

/** Cached tree-sitter module */
let cachedTreeSitter: (new () => TreeSitterParser) | null = null;

/** Cached Go language */
let cachedGoLanguage: TreeSitterLanguage | null = null;

/** Loading error message if any */
let loadingError: string | null = null;

// ============================================
// Public API
// ============================================

/**
 * Check if tree-sitter-go is available.
 *
 * This function attempts to load tree-sitter and tree-sitter-go
 * on first call and caches the result.
 *
 * @returns true if tree-sitter-go is available and working
 */
export function isGoTreeSitterAvailable(): boolean {
  if (goAvailable !== null) {
    return goAvailable;
  }

  try {
    loadGoTreeSitter();
    goAvailable = true;
  } catch (error) {
    goAvailable = false;
    loadingError = error instanceof Error ? error.message : 'Unknown error loading tree-sitter-go';
    logDebug(`tree-sitter-go not available: ${loadingError}`);
  }

  return goAvailable;
}

/**
 * Get the Go language for tree-sitter.
 *
 * @returns TreeSitter Go language
 * @throws Error if tree-sitter-go is not available
 */
export function getGoLanguage(): TreeSitterLanguage {
  if (!isGoTreeSitterAvailable()) {
    throw new Error(`tree-sitter-go is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedGoLanguage) {
    throw new Error('tree-sitter-go language not loaded');
  }

  return cachedGoLanguage;
}

/**
 * Get the tree-sitter Parser constructor for Go.
 *
 * @returns TreeSitter Parser constructor
 * @throws Error if tree-sitter is not available
 */
export function getGoTreeSitter(): new () => TreeSitterParser {
  if (!isGoTreeSitterAvailable()) {
    throw new Error(`tree-sitter-go is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedTreeSitter) {
    throw new Error('tree-sitter module not loaded');
  }

  return cachedTreeSitter;
}

/**
 * Create a new tree-sitter parser instance configured for Go.
 *
 * @returns Configured TreeSitter parser
 * @throws Error if tree-sitter-go is not available
 */
export function createGoParser(): TreeSitterParser {
  if (!isGoTreeSitterAvailable()) {
    throw new Error(`tree-sitter-go is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedTreeSitter) {
    throw new Error('tree-sitter module not loaded');
  }

  const Parser = cachedTreeSitter;
  const language = getGoLanguage();

  const parser = new Parser();
  parser.setLanguage(language);

  return parser;
}

/**
 * Get the loading error message if tree-sitter-go failed to load.
 *
 * @returns Error message or null if no error
 */
export function getGoLoadingError(): string | null {
  // Ensure we've attempted to load
  isGoTreeSitterAvailable();
  return loadingError;
}

/**
 * Reset the loader state (useful for testing).
 */
export function resetGoLoader(): void {
  goAvailable = null;
  cachedTreeSitter = null;
  cachedGoLanguage = null;
  loadingError = null;
}

// ============================================
// Internal Functions
// ============================================

/**
 * Attempt to load tree-sitter and tree-sitter-go.
 *
 * @throws Error if loading fails
 */
function loadGoTreeSitter(): void {
  // Skip if already loaded
  if (cachedTreeSitter && cachedGoLanguage) {
    return;
  }

  try {
    // Dynamic require for optional dependencies
     
    cachedTreeSitter = require('tree-sitter') as new () => TreeSitterParser;
  } catch (error) {
    throw new Error(
      `Failed to load tree-sitter: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter tree-sitter-go'
    );
  }

  try {
     
    cachedGoLanguage = require('tree-sitter-go') as TreeSitterLanguage;
  } catch (error) {
    // Clear tree-sitter cache since we can't use it without Go
    cachedTreeSitter = null;
    throw new Error(
      `Failed to load tree-sitter-go: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter-go'
    );
  }

  logDebug('tree-sitter and tree-sitter-go loaded successfully');
}

/**
 * Log debug message if debug mode is enabled.
 *
 * @param message - Message to log
 */
function logDebug(message: string): void {
  if (process.env['DRIFT_PARSER_DEBUG'] === 'true') {
    console.debug(`[go-loader] ${message}`);
  }
}
