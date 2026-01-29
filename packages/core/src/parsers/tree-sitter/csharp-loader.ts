/**
 * Tree-sitter C# Loader
 *
 * Handles loading tree-sitter and tree-sitter-c-sharp with graceful fallback.
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

/** Whether tree-sitter-c-sharp is available */
let csharpAvailable: boolean | null = null;

/** Cached tree-sitter module */
let cachedTreeSitter: (new () => TreeSitterParser) | null = null;

/** Cached C# language */
let cachedCSharpLanguage: TreeSitterLanguage | null = null;

/** Loading error message if any */
let loadingError: string | null = null;

// ============================================
// Public API
// ============================================

/**
 * Check if tree-sitter-c-sharp is available.
 *
 * This function attempts to load tree-sitter and tree-sitter-c-sharp
 * on first call and caches the result.
 *
 * @returns true if tree-sitter-c-sharp is available and working
 */
export function isCSharpTreeSitterAvailable(): boolean {
  if (csharpAvailable !== null) {
    return csharpAvailable;
  }

  try {
    loadCSharpTreeSitter();
    csharpAvailable = true;
  } catch (error) {
    csharpAvailable = false;
    loadingError = error instanceof Error ? error.message : 'Unknown error loading tree-sitter-c-sharp';
    logDebug(`tree-sitter-c-sharp not available: ${loadingError}`);
  }

  return csharpAvailable;
}


/**
 * Get the C# language for tree-sitter.
 *
 * @returns TreeSitter C# language
 * @throws Error if tree-sitter-c-sharp is not available
 */
export function getCSharpLanguage(): TreeSitterLanguage {
  if (!isCSharpTreeSitterAvailable()) {
    throw new Error(`tree-sitter-c-sharp is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedCSharpLanguage) {
    throw new Error('tree-sitter-c-sharp language not loaded');
  }

  return cachedCSharpLanguage;
}

/**
 * Create a new tree-sitter parser instance configured for C#.
 *
 * @returns Configured TreeSitter parser
 * @throws Error if tree-sitter-c-sharp is not available
 */
export function createCSharpParser(): TreeSitterParser {
  if (!isCSharpTreeSitterAvailable()) {
    throw new Error(`tree-sitter-c-sharp is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedTreeSitter) {
    throw new Error('tree-sitter module not loaded');
  }

  const Parser = cachedTreeSitter;
  const language = getCSharpLanguage();

  const parser = new Parser();
  parser.setLanguage(language);

  return parser;
}

/**
 * Get the loading error message if tree-sitter-c-sharp failed to load.
 *
 * @returns Error message or null if no error
 */
export function getCSharpLoadingError(): string | null {
  // Ensure we've attempted to load
  isCSharpTreeSitterAvailable();
  return loadingError;
}

/**
 * Reset the loader state (useful for testing).
 */
export function resetCSharpLoader(): void {
  csharpAvailable = null;
  cachedTreeSitter = null;
  cachedCSharpLanguage = null;
  loadingError = null;
}

// ============================================
// Internal Functions
// ============================================

/**
 * Attempt to load tree-sitter and tree-sitter-c-sharp.
 *
 * @throws Error if loading fails
 */
function loadCSharpTreeSitter(): void {
  // Skip if already loaded
  if (cachedTreeSitter && cachedCSharpLanguage) {
    return;
  }

  try {
    // Dynamic require for optional dependencies
     
    cachedTreeSitter = require('tree-sitter') as new () => TreeSitterParser;
  } catch (error) {
    throw new Error(
      `Failed to load tree-sitter: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter tree-sitter-c-sharp'
    );
  }

  try {
     
    cachedCSharpLanguage = require('tree-sitter-c-sharp') as TreeSitterLanguage;
  } catch (error) {
    // Clear tree-sitter cache since we can't use it without C#
    cachedTreeSitter = null;
    throw new Error(
      `Failed to load tree-sitter-c-sharp: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter-c-sharp'
    );
  }

  logDebug('tree-sitter and tree-sitter-c-sharp loaded successfully');
}

/**
 * Log debug message if debug mode is enabled.
 *
 * @param message - Message to log
 */
function logDebug(message: string): void {
  if (process.env['DRIFT_PARSER_DEBUG'] === 'true') {
    console.debug(`[csharp-loader] ${message}`);
  }
}
