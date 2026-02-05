/**
 * ID Generator Utility
 * 
 * Generates unique IDs for IEC 61131-3 entities.
 */

import { randomBytes } from 'crypto';

let counter = 0;

/**
 * Generate a unique ID
 * Format: st_<timestamp>_<counter>_<random>
 */
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const count = (counter++).toString(36).padStart(4, '0');
  const random = randomBytes(4).toString('hex');
  return `st_${timestamp}_${count}_${random}`;
}

/**
 * Generate a deterministic ID from content
 * Useful for deduplication
 */
export function generateContentId(content: string): string {
  const { createHash } = require('crypto');
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  return `st_${hash}`;
}

/**
 * Reset counter (for testing)
 */
export function resetIdCounter(): void {
  counter = 0;
}
