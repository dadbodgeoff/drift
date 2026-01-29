/**
 * Matcher Registry
 *
 * Manages pattern matchers and runs them against call chains.
 */

import { DatabaseSqlMatcher } from './database-sql-matcher.js';
import { DieselMatcher } from './diesel-matcher.js';
import { DjangoMatcher } from './django-matcher.js';
import { DrizzleMatcher } from './drizzle-matcher.js';
import { RawSqlMatcher } from './raw-sql-matcher.js';
import { SequelizeMatcher } from './sequelize-matcher.js';
import { KnexMatcher } from './knex-matcher.js';
import { MongooseMatcher } from './mongoose-matcher.js';
import { SQLAlchemyMatcher } from './sqlalchemy-matcher.js';
import { EFCoreMatcher } from './efcore-matcher.js';
import { EloquentMatcher } from './eloquent-matcher.js';
import { SpringDataMatcher } from './spring-data-matcher.js';
import { GORMMatcher } from './gorm-matcher.js';
import { PrismaMatcher } from './prisma-matcher.js';
import { SQLxMatcher } from './sqlx-matcher.js';
import { SeaORMMatcher } from './seaorm-matcher.js';
import { SupabaseMatcher } from './supabase-matcher.js';
import { TypeORMMatcher } from './typeorm-matcher.js';
import type { UnifiedCallChain, PatternMatchResult, PatternMatcher, UnifiedLanguage } from '../types.js';

/**
 * Matcher registry - manages all pattern matchers
 */
export class MatcherRegistry {
  private matchers: PatternMatcher[] = [];

  constructor() {
    // Register default matchers
    this.registerDefaults();
  }

  /**
   * Register default matchers
   */
  private registerDefaults(): void {
    // JavaScript/TypeScript ORMs
    this.register(new SupabaseMatcher());
    this.register(new PrismaMatcher());
    this.register(new DrizzleMatcher());
    this.register(new TypeORMMatcher());
    this.register(new SequelizeMatcher());
    this.register(new MongooseMatcher());
    this.register(new KnexMatcher());
    this.register(new RawSqlMatcher());

    // Python ORMs
    this.register(new DjangoMatcher());
    this.register(new SQLAlchemyMatcher());

    // C# ORMs
    this.register(new EFCoreMatcher());

    // PHP ORMs
    this.register(new EloquentMatcher());

    // Java ORMs
    this.register(new SpringDataMatcher());

    // Go ORMs
    this.register(new GORMMatcher());
    this.register(new DatabaseSqlMatcher());

    // Rust ORMs
    this.register(new SQLxMatcher());
    this.register(new DieselMatcher());
    this.register(new SeaORMMatcher());
  }

  /**
   * Register a matcher
   */
  register(matcher: PatternMatcher): void {
    this.matchers.push(matcher);
    // Sort by priority (higher first)
    this.matchers.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Unregister a matcher by ID
   */
  unregister(id: string): void {
    this.matchers = this.matchers.filter(m => m.id !== id);
  }

  /**
   * Get all registered matchers
   */
  getMatchers(): PatternMatcher[] {
    return [...this.matchers];
  }

  /**
   * Get matchers for a specific language
   */
  getMatchersForLanguage(language: UnifiedLanguage): PatternMatcher[] {
    return this.matchers.filter(m => m.languages.includes(language));
  }

  /**
   * Match a call chain against all registered matchers
   * Returns the first match (highest priority)
   */
  match(chain: UnifiedCallChain): PatternMatchResult | null {
    const languageMatchers = this.getMatchersForLanguage(chain.language);

    for (const matcher of languageMatchers) {
      const result = matcher.match(chain);
      if (result) {
        return result;
      }
    }

    return null;
  }

  /**
   * Match a call chain against all matchers and return all matches
   */
  matchAll(chain: UnifiedCallChain): PatternMatchResult[] {
    const results: PatternMatchResult[] = [];
    const languageMatchers = this.getMatchersForLanguage(chain.language);

    for (const matcher of languageMatchers) {
      const result = matcher.match(chain);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Reset to default matchers
   */
  reset(): void {
    this.matchers = [];
    this.registerDefaults();
  }
}

// Singleton instance
let registryInstance: MatcherRegistry | null = null;

/**
 * Get the matcher registry singleton
 */
export function getMatcherRegistry(): MatcherRegistry {
  if (!registryInstance) {
    registryInstance = new MatcherRegistry();
  }
  return registryInstance;
}

/**
 * Reset the matcher registry (for testing)
 */
export function resetMatcherRegistry(): void {
  registryInstance = null;
}
