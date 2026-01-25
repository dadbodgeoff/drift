/**
 * Matching Module Exports
 */

export { BaseMatcher } from './base-matcher.js';

// JavaScript/TypeScript ORMs
export { SupabaseMatcher } from './supabase-matcher.js';
export { PrismaMatcher } from './prisma-matcher.js';
export { DrizzleMatcher } from './drizzle-matcher.js';
export { TypeORMMatcher } from './typeorm-matcher.js';
export { SequelizeMatcher } from './sequelize-matcher.js';
export { MongooseMatcher } from './mongoose-matcher.js';
export { KnexMatcher } from './knex-matcher.js';
export { RawSqlMatcher } from './raw-sql-matcher.js';

// Python ORMs
export { DjangoMatcher } from './django-matcher.js';
export { SQLAlchemyMatcher } from './sqlalchemy-matcher.js';

// C# ORMs
export { EFCoreMatcher } from './efcore-matcher.js';

// PHP ORMs
export { EloquentMatcher } from './eloquent-matcher.js';

// Java ORMs
export { SpringDataMatcher } from './spring-data-matcher.js';

// Go ORMs
export { GORMMatcher } from './gorm-matcher.js';
export { DatabaseSqlMatcher } from './database-sql-matcher.js';

// Rust ORMs
export { SQLxMatcher } from './sqlx-matcher.js';
export { DieselMatcher } from './diesel-matcher.js';
export { SeaORMMatcher } from './seaorm-matcher.js';

export {
  MatcherRegistry,
  getMatcherRegistry,
  resetMatcherRegistry,
} from './matcher-registry.js';
