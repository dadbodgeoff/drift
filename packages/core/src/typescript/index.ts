/**
 * TypeScript/JavaScript Language Support
 *
 * Provides comprehensive analysis for TypeScript and JavaScript projects:
 * - HTTP routes (Express, NestJS, Next.js, Fastify)
 * - React components and hooks
 * - Error handling patterns
 * - Data access patterns (Prisma, TypeORM, Drizzle, Sequelize, Mongoose)
 * - Decorator usage (NestJS, TypeORM)
 */

export {
  TypeScriptAnalyzer,
  createTypeScriptAnalyzer,
} from './typescript-analyzer.js';

export type {
  TypeScriptAnalyzerConfig,
  TypeScriptAnalysisResult,
  TypeScriptAnalysisStats,
  TSRoute,
  TSRoutesResult,
  TSComponent,
  TSComponentsResult,
  TSHook,
  TSHooksResult,
  TSErrorPattern,
  TSErrorIssue,
  TSErrorHandlingResult,
  TSDataAccessPoint,
  TSDataAccessResult,
  TSDecorator,
  TSDecoratorsResult,
} from './typescript-analyzer.js';
