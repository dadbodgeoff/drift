/**
 * Tree-sitter TypeScript/JavaScript Loader
 *
 * Handles loading tree-sitter and tree-sitter-typescript/javascript with graceful fallback.
 * Provides functions to check availability and access the parser/language.
 *
 * @requirements Unified AST query interface for TypeScript/JavaScript
 */

import { createRequire } from 'node:module';

import type { TreeSitterParser, TreeSitterLanguage } from './types.js';

// Create require function for ESM compatibility
const require = createRequire(import.meta.url);

// ============================================
// Module State
// ============================================

/** Whether tree-sitter-typescript is available */
let typescriptAvailable: boolean | null = null;

/** Whether tree-sitter-javascript is available */
let javascriptAvailable: boolean | null = null;

/** Cached tree-sitter module */
let cachedTreeSitter: (new () => TreeSitterParser) | null = null;

/** Cached TypeScript language */
let cachedTypeScriptLanguage: TreeSitterLanguage | null = null;

/** Cached TSX language */
let cachedTsxLanguage: TreeSitterLanguage | null = null;

/** Cached JavaScript language */
let cachedJavaScriptLanguage: TreeSitterLanguage | null = null;

/** Loading error message if any */
let loadingError: string | null = null;

// ============================================
// Public API
// ============================================

/**
 * Check if tree-sitter-typescript is available.
 */
export function isTypeScriptTreeSitterAvailable(): boolean {
  if (typescriptAvailable !== null) {
    return typescriptAvailable;
  }

  try {
    loadTypeScriptTreeSitter();
    typescriptAvailable = true;
  } catch (error) {
    typescriptAvailable = false;
    loadingError = error instanceof Error ? error.message : 'Unknown error loading tree-sitter-typescript';
    logDebug(`tree-sitter-typescript not available: ${loadingError}`);
  }

  return typescriptAvailable;
}

/**
 * Check if tree-sitter-javascript is available.
 */
export function isJavaScriptTreeSitterAvailable(): boolean {
  if (javascriptAvailable !== null) {
    return javascriptAvailable;
  }

  try {
    loadJavaScriptTreeSitter();
    javascriptAvailable = true;
  } catch (error) {
    javascriptAvailable = false;
    loadingError = error instanceof Error ? error.message : 'Unknown error loading tree-sitter-javascript';
    logDebug(`tree-sitter-javascript not available: ${loadingError}`);
  }

  return javascriptAvailable;
}

/**
 * Get the TypeScript language for tree-sitter.
 */
export function getTypeScriptLanguage(): TreeSitterLanguage {
  if (!isTypeScriptTreeSitterAvailable()) {
    throw new Error(`tree-sitter-typescript is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedTypeScriptLanguage) {
    throw new Error('tree-sitter-typescript language not loaded');
  }

  return cachedTypeScriptLanguage;
}

/**
 * Get the TSX language for tree-sitter.
 */
export function getTsxLanguage(): TreeSitterLanguage {
  if (!isTypeScriptTreeSitterAvailable()) {
    throw new Error(`tree-sitter-typescript is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedTsxLanguage) {
    throw new Error('tree-sitter-tsx language not loaded');
  }

  return cachedTsxLanguage;
}

/**
 * Get the JavaScript language for tree-sitter.
 */
export function getJavaScriptLanguage(): TreeSitterLanguage {
  if (!isJavaScriptTreeSitterAvailable()) {
    throw new Error(`tree-sitter-javascript is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedJavaScriptLanguage) {
    throw new Error('tree-sitter-javascript language not loaded');
  }

  return cachedJavaScriptLanguage;
}

/**
 * Get the tree-sitter Parser constructor.
 */
export function getTypeScriptTreeSitter(): new () => TreeSitterParser {
  if (!isTypeScriptTreeSitterAvailable() && !isJavaScriptTreeSitterAvailable()) {
    throw new Error(`tree-sitter is not available: ${loadingError ?? 'unknown error'}`);
  }

  if (!cachedTreeSitter) {
    throw new Error('tree-sitter module not loaded');
  }

  return cachedTreeSitter;
}

/**
 * Create a new tree-sitter parser instance configured for TypeScript.
 */
export function createTypeScriptParser(): TreeSitterParser {
  const Parser = getTypeScriptTreeSitter();
  const language = getTypeScriptLanguage();

  const parser = new Parser();
  parser.setLanguage(language);

  return parser;
}

/**
 * Create a new tree-sitter parser instance configured for TSX.
 */
export function createTsxParser(): TreeSitterParser {
  const Parser = getTypeScriptTreeSitter();
  const language = getTsxLanguage();

  const parser = new Parser();
  parser.setLanguage(language);

  return parser;
}

/**
 * Create a new tree-sitter parser instance configured for JavaScript.
 */
export function createJavaScriptParser(): TreeSitterParser {
  const Parser = getTypeScriptTreeSitter();
  const language = getJavaScriptLanguage();

  const parser = new Parser();
  parser.setLanguage(language);

  return parser;
}

/**
 * Create a parser for the given file extension.
 */
export function createParserForFile(filePath: string): TreeSitterParser | null {
  const ext = filePath.toLowerCase();

  if (ext.endsWith('.tsx')) {
    return isTypeScriptTreeSitterAvailable() ? createTsxParser() : null;
  }
  if (ext.endsWith('.ts') || ext.endsWith('.mts') || ext.endsWith('.cts')) {
    return isTypeScriptTreeSitterAvailable() ? createTypeScriptParser() : null;
  }
  if (ext.endsWith('.jsx')) {
    // JSX uses JavaScript parser with JSX support
    return isJavaScriptTreeSitterAvailable() ? createJavaScriptParser() : null;
  }
  if (ext.endsWith('.js') || ext.endsWith('.mjs') || ext.endsWith('.cjs')) {
    return isJavaScriptTreeSitterAvailable() ? createJavaScriptParser() : null;
  }

  return null;
}

/**
 * Get the loading error message if tree-sitter failed to load.
 */
export function getTypeScriptLoadingError(): string | null {
  isTypeScriptTreeSitterAvailable();
  return loadingError;
}

/**
 * Reset the loader state (useful for testing).
 */
export function resetTypeScriptLoader(): void {
  typescriptAvailable = null;
  javascriptAvailable = null;
  cachedTreeSitter = null;
  cachedTypeScriptLanguage = null;
  cachedTsxLanguage = null;
  cachedJavaScriptLanguage = null;
  loadingError = null;
}

// ============================================
// Internal Functions
// ============================================

/**
 * Load tree-sitter core module.
 */
function loadTreeSitterCore(): void {
  if (cachedTreeSitter) {return;}

  try {
     
    cachedTreeSitter = require('tree-sitter') as new () => TreeSitterParser;
  } catch (error) {
    throw new Error(
      `Failed to load tree-sitter: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter'
    );
  }
}

/**
 * Attempt to load tree-sitter and tree-sitter-typescript.
 */
function loadTypeScriptTreeSitter(): void {
  if (cachedTypeScriptLanguage && cachedTsxLanguage) {
    return;
  }

  loadTreeSitterCore();

  try {
    // tree-sitter-typescript exports an object with typescript and tsx languages
     
    const tsModule = require('tree-sitter-typescript') as {
      typescript: TreeSitterLanguage;
      tsx: TreeSitterLanguage;
    };

    cachedTypeScriptLanguage = tsModule.typescript;
    cachedTsxLanguage = tsModule.tsx;
  } catch (error) {
    throw new Error(
      `Failed to load tree-sitter-typescript: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter-typescript'
    );
  }

  logDebug('tree-sitter-typescript loaded successfully');
}

/**
 * Attempt to load tree-sitter and tree-sitter-javascript.
 */
function loadJavaScriptTreeSitter(): void {
  if (cachedJavaScriptLanguage) {
    return;
  }

  loadTreeSitterCore();

  try {
     
    cachedJavaScriptLanguage = require('tree-sitter-javascript') as TreeSitterLanguage;
  } catch (error) {
    throw new Error(
      `Failed to load tree-sitter-javascript: ${error instanceof Error ? error.message : 'unknown error'}. ` +
        'Install with: pnpm add tree-sitter-javascript'
    );
  }

  logDebug('tree-sitter-javascript loaded successfully');
}

/**
 * Log debug message if debug mode is enabled.
 */
function logDebug(message: string): void {
  if (process.env['DRIFT_PARSER_DEBUG'] === 'true') {
    console.debug(`[typescript-loader] ${message}`);
  }
}
