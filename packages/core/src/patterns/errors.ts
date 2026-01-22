/**
 * Pattern System Errors
 *
 * Shared error classes for the pattern system.
 *
 * @module patterns/errors
 */

import type { PatternStatus } from './types.js';

/**
 * Error thrown when a pattern is not found
 */
export class PatternNotFoundError extends Error {
  constructor(public readonly patternId: string) {
    super(`Pattern not found: ${patternId}`);
    this.name = 'PatternNotFoundError';
  }
}

/**
 * Error thrown when an invalid state transition is attempted
 */
export class InvalidStatusTransitionError extends Error {
  constructor(
    public readonly patternId: string,
    public readonly fromStatus: PatternStatus,
    public readonly toStatus: PatternStatus
  ) {
    super(`Invalid status transition for pattern ${patternId}: ${fromStatus} → ${toStatus}`);
    this.name = 'InvalidStatusTransitionError';
  }
}

/**
 * Error thrown when trying to add a pattern that already exists
 */
export class PatternAlreadyExistsError extends Error {
  constructor(public readonly patternId: string) {
    super(`Pattern already exists: ${patternId}`);
    this.name = 'PatternAlreadyExistsError';
  }
}
