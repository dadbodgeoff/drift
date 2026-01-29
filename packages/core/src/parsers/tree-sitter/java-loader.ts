/**
 * Tree-sitter Java Loader
 *
 * Handles loading tree-sitter and tree-sitter-java with graceful fallback.
 * Provides functions to check availability and access the parser/language.
 *
 * @requirements Java/Spring Boot Language Support
 */

import { createRequire } from 'node:module';

import type { TreeSitterParser, TreeSitterLanguage } from './types.js';

// Create require function for ESM compatibility
const require = createRequire(import.meta.url);

// ============================================
// Module State
// ============================================

/** Whether tree-sitter-java is available */
let javaAvailable: boolean | null = null;

/** Cached tree-sitter module */
let cachedTreeSitter: (new () => TreeSitterParser) | null = null;

/** Cached Java language */
let cachedJavaLanguage: TreeSitterLanguage | null = null;

/** Loading error message if any */
let loadingError: string | null = null;

// ============================================
// Public API
// ============================================

/**
 * Check if tree-sitter-java is available.
 *
 * This function attempts to load tree-sitter and tree-sitter-java
 * on first call and caches the result.
 *
 * @returns true if tree-sitter-java is available and working
 */
export function isJavaTreeSitterAvailable(): boolean {
  if (javaAvailable !== null) {
    return javaAvailable;
  }

  try {
    loadJavaTreeSitter();
    javaAvailable = true;
  } catch (error) {
    javaAvailable = false;
    loadingError = error instanceof Error ? error.message : 'Unknown error loading tree-sitter-java';
    logDebug(`tree-sitter-java not available: ${loadingError}`);
  }

  return javaAvailable;
}

/**
 * Get the Java language for tree-sitter.
 *
 * @returns TreeSitter Java language
 * @throws Error if tree-sitter-java is not available
 */
export function getJavaLanguage(): TreeSitterLanguage {
  if (!isJavaTreeSitterAvailable()) {
    throw new Error(`tree-sitter-java is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedJavaLanguage) {
    throw new Error('tree-sitter-java language not loaded');
  }

  return cachedJavaLanguage;
}

/**
 * Get the tree-sitter Parser constructor for Java.
 *
 * @returns TreeSitter Parser constructor
 * @throws Error if tree-sitter is not available
 */
export function getJavaTreeSitter(): new () => TreeSitterParser {
  if (!isJavaTreeSitterAvailable()) {
    throw new Error(`tree-sitter-java is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedTreeSitter) {
    throw new Error('tree-sitter module not loaded');
  }

  return cachedTreeSitter;
}

/**
 * Create a new tree-sitter parser instance configured for Java.
 *
 * @returns Configured TreeSitter parser
 * @throws Error if tree-sitter-java is not available
 */
export function createJavaParser(): TreeSitterParser {
  if (!isJavaTreeSitterAvailable()) {
    throw new Error(`tree-sitter-java is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedTreeSitter) {
    throw new Error('tree-sitter module not loaded');
  }

  const Parser = cachedTreeSitter;
  const language = getJavaLanguage();

  const parser = new Parser();
  parser.setLanguage(language);

  return parser;
}

/**
 * Get the loading error message if tree-sitter-java failed to load.
 *
 * @returns Error message or null if no error
 */
export function getJavaLoadingError(): string | null {
  // Ensure we've attempted to load
  isJavaTreeSitterAvailable();
  return loadingError;
}

/**
 * Reset the loader state (useful for testing).
 */
export function resetJavaLoader(): void {
  javaAvailable = null;
  cachedTreeSitter = null;
  cachedJavaLanguage = null;
  loadingError = null;
}

// ============================================
// Internal Functions
// ============================================

/**
 * Attempt to load tree-sitter and tree-sitter-java.
 *
 * @throws Error if loading fails
 */
function loadJavaTreeSitter(): void {
  // Skip if already loaded
  if (cachedTreeSitter && cachedJavaLanguage) {
    return;
  }

  try {
    // Dynamic require for optional dependencies
     
    cachedTreeSitter = require('tree-sitter') as new () => TreeSitterParser;
  } catch (error) {
    throw new Error(
      `Failed to load tree-sitter: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter tree-sitter-java'
    );
  }

  try {
     
    cachedJavaLanguage = require('tree-sitter-java') as TreeSitterLanguage;
  } catch (error) {
    // Clear tree-sitter cache since we can't use it without Java
    cachedTreeSitter = null;
    throw new Error(
      `Failed to load tree-sitter-java: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter-java'
    );
  }

  logDebug('tree-sitter and tree-sitter-java loaded successfully');
}

/**
 * Log debug message if debug mode is enabled.
 *
 * @param message - Message to log
 */
function logDebug(message: string): void {
  if (process.env['DRIFT_PARSER_DEBUG'] === 'true') {
    console.debug(`[java-loader] ${message}`);
  }
}
