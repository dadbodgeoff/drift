/**
 * Tree-sitter Rust Loader
 *
 * Handles loading tree-sitter and tree-sitter-rust with graceful fallback.
 * Provides functions to check availability and access the parser/language.
 *
 * @requirements Rust Language Support
 */

import { createRequire } from 'node:module';

import type { TreeSitterParser, TreeSitterLanguage } from './types.js';

// Create require function for ESM compatibility
const require = createRequire(import.meta.url);

// ============================================
// Module State
// ============================================

/** Whether tree-sitter-rust is available */
let rustAvailable: boolean | null = null;

/** Cached tree-sitter module */
let cachedTreeSitter: (new () => TreeSitterParser) | null = null;

/** Cached Rust language */
let cachedRustLanguage: TreeSitterLanguage | null = null;

/** Loading error message if any */
let loadingError: string | null = null;

// ============================================
// Public API
// ============================================

/**
 * Check if tree-sitter-rust is available.
 *
 * This function attempts to load tree-sitter and tree-sitter-rust
 * on first call and caches the result.
 *
 * @returns true if tree-sitter-rust is available and working
 */
export function isRustTreeSitterAvailable(): boolean {
  if (rustAvailable !== null) {
    return rustAvailable;
  }

  try {
    loadRustTreeSitter();
    rustAvailable = true;
  } catch (error) {
    rustAvailable = false;
    loadingError = error instanceof Error ? error.message : 'Unknown error loading tree-sitter-rust';
    logDebug(`tree-sitter-rust not available: ${loadingError}`);
  }

  return rustAvailable;
}

/**
 * Get the Rust language for tree-sitter.
 *
 * @returns TreeSitter Rust language
 * @throws Error if tree-sitter-rust is not available
 */
export function getRustLanguage(): TreeSitterLanguage {
  if (!isRustTreeSitterAvailable()) {
    throw new Error(`tree-sitter-rust is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedRustLanguage) {
    throw new Error('tree-sitter-rust language not loaded');
  }

  return cachedRustLanguage;
}

/**
 * Get the tree-sitter Parser constructor for Rust.
 *
 * @returns TreeSitter Parser constructor
 * @throws Error if tree-sitter is not available
 */
export function getRustTreeSitter(): new () => TreeSitterParser {
  if (!isRustTreeSitterAvailable()) {
    throw new Error(`tree-sitter-rust is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedTreeSitter) {
    throw new Error('tree-sitter module not loaded');
  }

  return cachedTreeSitter;
}

/**
 * Create a new tree-sitter parser instance configured for Rust.
 *
 * @returns Configured TreeSitter parser
 * @throws Error if tree-sitter-rust is not available
 */
export function createRustParser(): TreeSitterParser {
  if (!isRustTreeSitterAvailable()) {
    throw new Error(`tree-sitter-rust is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedTreeSitter) {
    throw new Error('tree-sitter module not loaded');
  }

  const Parser = cachedTreeSitter;
  const language = getRustLanguage();

  const parser = new Parser();
  parser.setLanguage(language);

  return parser;
}

/**
 * Get the loading error message if tree-sitter-rust failed to load.
 *
 * @returns Error message or null if no error
 */
export function getRustLoadingError(): string | null {
  // Ensure we've attempted to load
  isRustTreeSitterAvailable();
  return loadingError;
}

/**
 * Reset the loader state (useful for testing).
 */
export function resetRustLoader(): void {
  rustAvailable = null;
  cachedTreeSitter = null;
  cachedRustLanguage = null;
  loadingError = null;
}

// ============================================
// Internal Functions
// ============================================

/**
 * Attempt to load tree-sitter and tree-sitter-rust.
 *
 * @throws Error if loading fails
 */
function loadRustTreeSitter(): void {
  // Skip if already loaded
  if (cachedTreeSitter && cachedRustLanguage) {
    return;
  }

  try {
    // Dynamic require for optional dependencies
     
    cachedTreeSitter = require('tree-sitter') as new () => TreeSitterParser;
  } catch (error) {
    throw new Error(
      `Failed to load tree-sitter: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter tree-sitter-rust'
    );
  }

  try {
     
    cachedRustLanguage = require('tree-sitter-rust') as TreeSitterLanguage;
  } catch (error) {
    // Clear tree-sitter cache since we can't use it without Rust
    cachedTreeSitter = null;
    throw new Error(
      `Failed to load tree-sitter-rust: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter-rust'
    );
  }

  logDebug('tree-sitter and tree-sitter-rust loaded successfully');
}

/**
 * Log debug message if debug mode is enabled.
 *
 * @param message - Message to log
 */
function logDebug(message: string): void {
  if (process.env['DRIFT_PARSER_DEBUG'] === 'true') {
    console.debug(`[rust-loader] ${message}`);
  }
}
