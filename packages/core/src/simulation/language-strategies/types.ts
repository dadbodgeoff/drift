/**
 * Language Strategy Types
 *
 * Defines the structure for language-specific implementation strategies.
 *
 * @module simulation/language-strategies/types
 */

import type { CallGraphLanguage } from '../../call-graph/types.js';
import type { TaskCategory, ApproachStrategy } from '../types.js';

/** Strategy template for a specific language/framework */
export interface StrategyTemplate {
  /** Strategy identifier */
  strategy: ApproachStrategy;
  /** Human-readable name */
  name: string;
  /** Description of the approach */
  description: string;
  /** Task categories this strategy applies to */
  applicableCategories: TaskCategory[];
  /** File patterns to look for (e.g., 'middleware', 'controller') */
  filePatterns: string[];
  /** Pros of this approach */
  pros: string[];
  /** Cons of this approach */
  cons: string[];
  /** Estimated base lines of code */
  estimatedLines: number;
  /** Framework-specific notes */
  frameworkNotes?: string;
  /** Example code template */
  template?: string;
  /** New files that would be created */
  newFiles?: string[];
}

/** Framework definition */
export interface FrameworkDefinition {
  /** Framework name */
  name: string;
  /** Language this framework is for */
  language: CallGraphLanguage;
  /** File patterns that indicate this framework */
  detectPatterns: string[];
  /** Import patterns that indicate this framework */
  importPatterns: string[];
  /** Available strategies for this framework */
  strategies: StrategyTemplate[];
}

/** Language strategy provider */
export interface LanguageStrategyProvider {
  /** Language this provider handles */
  language: CallGraphLanguage;
  /** Supported frameworks */
  frameworks: FrameworkDefinition[];
  /** Get strategies for a task category */
  getStrategies(category: TaskCategory, framework?: string): StrategyTemplate[];
  /** Detect framework from file content */
  detectFramework(content: string, filePath: string): string | null;
}

/** Category keywords for auto-detection */
export interface CategoryKeywords {
  category: TaskCategory;
  keywords: string[];
  weight: number;
}

/** All category keywords for task detection */
export const CATEGORY_KEYWORDS: CategoryKeywords[] = [
  { category: 'rate-limiting', keywords: ['rate limit', 'throttle', 'throttling', 'requests per', 'api limit', 'quota'], weight: 1.0 },
  { category: 'authentication', keywords: ['auth', 'login', 'logout', 'session', 'jwt', 'token', 'oauth', 'sso', 'sign in', 'sign up', 'password'], weight: 1.0 },
  { category: 'authorization', keywords: ['permission', 'role', 'access control', 'rbac', 'acl', 'authorize', 'can access', 'allowed', 'forbidden'], weight: 1.0 },
  { category: 'api-endpoint', keywords: ['endpoint', 'route', 'api', 'rest', 'graphql', 'controller', 'handler'], weight: 0.8 },
  { category: 'data-access', keywords: ['database', 'query', 'repository', 'dao', 'orm', 'sql', 'crud', 'fetch', 'save', 'delete', 'model'], weight: 0.9 },
  { category: 'error-handling', keywords: ['error', 'exception', 'catch', 'try', 'throw', 'handle', 'fallback', 'retry', 'recover'], weight: 0.9 },
  { category: 'caching', keywords: ['cache', 'redis', 'memcache', 'memoize', 'invalidate', 'ttl', 'expire', 'store'], weight: 1.0 },
  { category: 'logging', keywords: ['log', 'logging', 'trace', 'debug', 'audit', 'monitor', 'observability', 'telemetry'], weight: 0.8 },
  { category: 'testing', keywords: ['test', 'spec', 'mock', 'stub', 'fixture', 'assert', 'expect', 'coverage', 'unit test'], weight: 0.9 },
  { category: 'validation', keywords: ['validate', 'validation', 'schema', 'sanitize', 'input', 'form', 'constraint', 'dto'], weight: 0.9 },
  { category: 'middleware', keywords: ['middleware', 'interceptor', 'filter', 'pipe', 'guard', 'before', 'after', 'hook'], weight: 0.9 },
  { category: 'refactoring', keywords: ['refactor', 'restructure', 'reorganize', 'clean up', 'simplify', 'extract', 'inline', 'rename'], weight: 0.7 },
];
