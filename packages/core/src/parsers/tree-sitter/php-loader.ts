/**
 * Tree-sitter PHP Loader
 *
 * Handles loading tree-sitter and tree-sitter-php with graceful fallback.
 * Provides functions to check availability and access the parser/language.
 *
 * @requirements PHP/Laravel Language Support
 */

import { createRequire } from 'node:module';

import type { TreeSitterParser, TreeSitterLanguage } from './types.js';

// Create require function for ESM compatibility
const require = createRequire(import.meta.url);

// ============================================
// Module State
// ============================================

/** Whether tree-sitter-php is available */
let phpAvailable: boolean | null = null;

/** Cached tree-sitter module */
let cachedTreeSitter: (new () => TreeSitterParser) | null = null;

/** Cached PHP language */
let cachedPhpLanguage: TreeSitterLanguage | null = null;

/** Loading error message if any */
let loadingError: string | null = null;

// ============================================
// Public API
// ============================================

/**
 * Check if tree-sitter-php is available.
 *
 * This function attempts to load tree-sitter and tree-sitter-php
 * on first call and caches the result.
 *
 * @returns true if tree-sitter-php is available and working
 */
export function isPhpTreeSitterAvailable(): boolean {
  if (phpAvailable !== null) {
    return phpAvailable;
  }

  try {
    loadPhpTreeSitter();
    phpAvailable = true;
  } catch (error) {
    phpAvailable = false;
    loadingError = error instanceof Error ? error.message : 'Unknown error loading tree-sitter-php';
    logDebug(`tree-sitter-php not available: ${loadingError}`);
  }

  return phpAvailable;
}

/**
 * Get the PHP language for tree-sitter.
 *
 * @returns TreeSitter PHP language
 * @throws Error if tree-sitter-php is not available
 */
export function getPhpLanguage(): TreeSitterLanguage {
  if (!isPhpTreeSitterAvailable()) {
    throw new Error(`tree-sitter-php is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedPhpLanguage) {
    throw new Error('tree-sitter-php language not loaded');
  }

  return cachedPhpLanguage;
}

/**
 * Get the tree-sitter Parser constructor for PHP.
 *
 * @returns TreeSitter Parser constructor
 * @throws Error if tree-sitter is not available
 */
export function getPhpTreeSitter(): new () => TreeSitterParser {
  if (!isPhpTreeSitterAvailable()) {
    throw new Error(`tree-sitter-php is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedTreeSitter) {
    throw new Error('tree-sitter module not loaded');
  }

  return cachedTreeSitter;
}

/**
 * Create a new tree-sitter parser instance configured for PHP.
 *
 * @returns Configured TreeSitter parser
 * @throws Error if tree-sitter-php is not available
 */
export function createPhpParser(): TreeSitterParser {
  if (!isPhpTreeSitterAvailable()) {
    throw new Error(`tree-sitter-php is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedTreeSitter) {
    throw new Error('tree-sitter module not loaded');
  }

  const Parser = cachedTreeSitter;
  const language = getPhpLanguage();

  const parser = new Parser();
  parser.setLanguage(language);

  return parser;
}

/**
 * Get the loading error message if tree-sitter-php failed to load.
 *
 * @returns Error message or null if no error
 */
export function getPhpLoadingError(): string | null {
  // Ensure we've attempted to load
  isPhpTreeSitterAvailable();
  return loadingError;
}

/**
 * Reset the loader state (useful for testing).
 */
export function resetPhpLoader(): void {
  phpAvailable = null;
  cachedTreeSitter = null;
  cachedPhpLanguage = null;
  loadingError = null;
}

// ============================================
// Internal Functions
// ============================================

/**
 * Attempt to load tree-sitter and tree-sitter-php.
 *
 * @throws Error if loading fails
 */
function loadPhpTreeSitter(): void {
  // Skip if already loaded
  if (cachedTreeSitter && cachedPhpLanguage) {
    return;
  }

  try {
    // Dynamic require for optional dependencies
     
    cachedTreeSitter = require('tree-sitter') as new () => TreeSitterParser;
  } catch (error) {
    throw new Error(
      `Failed to load tree-sitter: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter tree-sitter-php'
    );
  }

  try {
    // tree-sitter-php exports an object with php and php_only languages
     
    const phpModule = require('tree-sitter-php') as { php: TreeSitterLanguage; php_only?: TreeSitterLanguage };
    // Use the 'php' language which includes HTML support
    cachedPhpLanguage = phpModule.php ?? phpModule as unknown as TreeSitterLanguage;
  } catch (error) {
    // Clear tree-sitter cache since we can't use it without PHP
    cachedTreeSitter = null;
    throw new Error(
      `Failed to load tree-sitter-php: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter-php'
    );
  }

  logDebug('tree-sitter and tree-sitter-php loaded successfully');
}

/**
 * Log debug message if debug mode is enabled.
 *
 * @param message - Message to log
 */
function logDebug(message: string): void {
  if (process.env['DRIFT_PARSER_DEBUG'] === 'true') {
    console.debug(`[php-loader] ${message}`);
  }
}
