/**
 * Framework Patterns Index
 *
 * Exports all built-in framework patterns and provides
 * a convenience function to register all of them.
 */

import type { FrameworkPattern } from '../types.js';

import { registerFrameworks } from '../framework-registry.js';

// Export individual framework patterns
export { SPRING_PATTERNS } from './spring.js';
export { FASTAPI_PATTERNS } from './fastapi.js';
export { NESTJS_PATTERNS } from './nestjs.js';
export { LARAVEL_PATTERNS } from './laravel.js';
export { ASPNET_PATTERNS } from './aspnet.js';

// Import for aggregation
import { ASPNET_PATTERNS } from './aspnet.js';
import { FASTAPI_PATTERNS } from './fastapi.js';
import { LARAVEL_PATTERNS } from './laravel.js';
import { NESTJS_PATTERNS } from './nestjs.js';
import { SPRING_PATTERNS } from './spring.js';

/**
 * All built-in framework patterns
 */
export const ALL_FRAMEWORK_PATTERNS: FrameworkPattern[] = [
  SPRING_PATTERNS,
  FASTAPI_PATTERNS,
  NESTJS_PATTERNS,
  LARAVEL_PATTERNS,
  ASPNET_PATTERNS,
];

/**
 * Register all built-in framework patterns
 *
 * Call this at startup to enable semantic normalization
 * for all supported frameworks.
 */
export function registerAllFrameworks(): void {
  registerFrameworks(ALL_FRAMEWORK_PATTERNS);
}

/**
 * Get framework pattern by name
 */
export function getFrameworkPattern(name: string): FrameworkPattern | undefined {
  return ALL_FRAMEWORK_PATTERNS.find(f => f.framework === name);
}

/**
 * Get all framework patterns for a language
 */
export function getFrameworksForLanguage(
  language: 'typescript' | 'python' | 'java' | 'csharp' | 'php'
): FrameworkPattern[] {
  return ALL_FRAMEWORK_PATTERNS.filter(f => f.languages.includes(language));
}
