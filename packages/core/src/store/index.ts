/**
 * Store module exports
 *
 * Provides pattern persistence, history tracking, and caching.
 *
 * @requirements 4.1 - Patterns stored in .drift/patterns/ directory
 * @requirements 4.2 - Pattern files use JSON format with defined schema
 * @requirements 4.3 - Patterns organized by category subdirectories
 * @requirements 4.4 - Pattern history tracked in .drift/history/
 * @requirements 4.5 - Pattern schema validated on load/save
 * @requirements 4.6 - Patterns support querying by category, confidence, status
 * @requirements 4.7 - drift.lock snapshots approved patterns
 */

// Type exports
export * from './types.js';

// Cache manager
export * from './cache-manager.js';

// Schema validator
export * from './schema-validator.js';

// Pattern store
export * from './pattern-store.js';

// History store
export * from './history-store.js';

// Lock file manager
export * from './lock-file-manager.js';
