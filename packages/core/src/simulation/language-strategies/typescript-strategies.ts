/**
 * TypeScript Language Strategies
 *
 * Strategies for Express, NestJS, Next.js, and Fastify frameworks.
 *
 * @module simulation/language-strategies/typescript-strategies
 */

import type { TaskCategory } from '../types.js';
import type { FrameworkDefinition, LanguageStrategyProvider, StrategyTemplate } from './types.js';

// ============================================================================
// Express Strategies
// ============================================================================

const EXPRESS_STRATEGIES: StrategyTemplate[] = [
  {
    strategy: 'middleware',
    name: 'Express Middleware',
    description: 'Implement as Express middleware that intercepts requests',
    applicableCategories: ['rate-limiting', 'authentication', 'authorization', 'logging', 'validation', 'error-handling'],
    filePatterns: ['middleware', 'middlewares'],
    pros: ['Centralized logic', 'Easy to enable/disable', 'Reusable across routes', 'Standard Express pattern'],
    cons: ['Applies to all matched routes', 'Order-dependent', 'Can add latency'],
    estimatedLines: 40,
    template: `export const {{name}}Middleware = (req, res, next) => {\n  // Implementation\n  next();\n};`,
  },
  {
    strategy: 'wrapper',
    name: 'Route Handler Wrapper',
    description: 'Create a wrapper function that adds behavior around route handlers',
    applicableCategories: ['error-handling', 'logging', 'caching', 'rate-limiting'],
    filePatterns: ['utils', 'helpers', 'wrappers'],
    pros: ['Explicit and traceable', 'Works with any handler', 'Easy to test'],
    cons: ['Requires manual wrapping', 'Can lead to deep nesting'],
    estimatedLines: 30,
  },
  {
    strategy: 'per-route',
    name: 'Per-Route Implementation',
    description: 'Implement directly in each route handler',
    applicableCategories: ['api-endpoint', 'validation', 'data-access'],
    filePatterns: ['routes', 'controllers', 'handlers'],
    pros: ['Maximum flexibility', 'No abstraction overhead', 'Easy to understand'],
    cons: ['Code duplication', 'Inconsistent implementations'],
    estimatedLines: 20,
  },
  {
    strategy: 'centralized',
    name: 'Centralized Service',
    description: 'Create a dedicated service module',
    applicableCategories: ['authentication', 'authorization', 'caching', 'data-access', 'logging'],
    filePatterns: ['services', 'providers'],
    pros: ['Single source of truth', 'Easy to modify globally', 'Clear ownership'],
    cons: ['Can become a bottleneck', 'Tight coupling risk'],
    estimatedLines: 80,
  },
];

const EXPRESS_FRAMEWORK: FrameworkDefinition = {
  name: 'express',
  language: 'typescript',
  detectPatterns: ['app.use', 'app.get', 'app.post', 'express.Router', 'req, res, next'],
  importPatterns: ['express', 'from \'express\'', 'from "express"'],
  strategies: EXPRESS_STRATEGIES,
};


// ============================================================================
// NestJS Strategies
// ============================================================================

const NESTJS_STRATEGIES: StrategyTemplate[] = [
  {
    strategy: 'guard',
    name: 'NestJS Guard',
    description: 'Implement as a NestJS Guard for route protection',
    applicableCategories: ['authentication', 'authorization', 'rate-limiting'],
    filePatterns: ['guards', 'guard'],
    pros: ['Built-in NestJS pattern', 'Declarative with decorators', 'Reusable'],
    cons: ['NestJS-specific', 'Learning curve'],
    estimatedLines: 35,
    template: `@Injectable()\nexport class {{Name}}Guard implements CanActivate {\n  canActivate(context: ExecutionContext): boolean {\n    return true;\n  }\n}`,
  },
  {
    strategy: 'interceptor',
    name: 'NestJS Interceptor',
    description: 'Implement as a NestJS Interceptor for request/response transformation',
    applicableCategories: ['logging', 'caching', 'error-handling'],
    filePatterns: ['interceptors', 'interceptor'],
    pros: ['Access to both request and response', 'Can transform data', 'Composable'],
    cons: ['More complex than middleware', 'NestJS-specific'],
    estimatedLines: 45,
  },
  {
    strategy: 'decorator',
    name: 'Custom Decorator',
    description: 'Create a custom decorator for declarative behavior',
    applicableCategories: ['rate-limiting', 'caching', 'logging', 'authorization', 'validation'],
    filePatterns: ['decorators', 'decorator'],
    pros: ['Clean syntax', 'Self-documenting', 'Reusable'],
    cons: ['Requires decorator support', 'Can be magical'],
    estimatedLines: 25,
    template: `export const {{Name}} = () => SetMetadata('{{name}}', true);`,
  },
  {
    strategy: 'filter',
    name: 'NestJS Exception Filter',
    description: 'Implement as an exception filter for error handling',
    applicableCategories: ['error-handling'],
    filePatterns: ['filters', 'filter', 'exceptions'],
    pros: ['Centralized error handling', 'Type-safe', 'Customizable responses'],
    cons: ['Only for errors', 'NestJS-specific'],
    estimatedLines: 40,
  },
  {
    strategy: 'middleware',
    name: 'NestJS Middleware',
    description: 'Implement as NestJS middleware',
    applicableCategories: ['logging', 'authentication', 'rate-limiting'],
    filePatterns: ['middleware', 'middlewares'],
    pros: ['Similar to Express', 'Early in request lifecycle'],
    cons: ['Less powerful than guards/interceptors'],
    estimatedLines: 35,
  },
];

const NESTJS_FRAMEWORK: FrameworkDefinition = {
  name: 'nestjs',
  language: 'typescript',
  detectPatterns: ['@Controller', '@Injectable', '@Module', '@Get', '@Post', 'NestFactory'],
  importPatterns: ['@nestjs/common', '@nestjs/core'],
  strategies: NESTJS_STRATEGIES,
};

// ============================================================================
// Next.js Strategies
// ============================================================================

const NEXTJS_STRATEGIES: StrategyTemplate[] = [
  {
    strategy: 'middleware',
    name: 'Next.js Middleware',
    description: 'Implement as Next.js edge middleware',
    applicableCategories: ['authentication', 'authorization', 'rate-limiting', 'logging'],
    filePatterns: ['middleware'],
    pros: ['Runs at edge', 'Intercepts all routes', 'Built-in pattern'],
    cons: ['Limited runtime', 'Edge constraints'],
    estimatedLines: 30,
    frameworkNotes: 'Runs in Edge Runtime with limited Node.js APIs',
  },
  {
    strategy: 'wrapper',
    name: 'API Route Wrapper (HOF)',
    description: 'Create a higher-order function to wrap API routes',
    applicableCategories: ['authentication', 'error-handling', 'logging', 'rate-limiting'],
    filePatterns: ['lib', 'utils', 'api'],
    pros: ['Full Node.js runtime', 'Composable', 'Type-safe'],
    cons: ['Manual wrapping required'],
    estimatedLines: 35,
    template: `export const with{{Name}} = (handler) => async (req, res) => {\n  // Pre-processing\n  return handler(req, res);\n};`,
  },
  {
    strategy: 'per-route',
    name: 'Per-Route Implementation',
    description: 'Implement directly in API route handlers',
    applicableCategories: ['api-endpoint', 'data-access', 'validation'],
    filePatterns: ['api', 'pages/api', 'app/api'],
    pros: ['Simple', 'No abstraction'],
    cons: ['Duplication across routes'],
    estimatedLines: 20,
  },
];

const NEXTJS_FRAMEWORK: FrameworkDefinition = {
  name: 'nextjs',
  language: 'typescript',
  detectPatterns: ['NextRequest', 'NextResponse', 'getServerSideProps', 'getStaticProps', 'NextApiRequest'],
  importPatterns: ['next', 'next/server', 'from \'next\''],
  strategies: NEXTJS_STRATEGIES,
};


// ============================================================================
// Fastify Strategies
// ============================================================================

const FASTIFY_STRATEGIES: StrategyTemplate[] = [
  {
    strategy: 'decorator',
    name: 'Fastify Decorator',
    description: 'Extend Fastify instance with custom functionality',
    applicableCategories: ['authentication', 'caching', 'data-access'],
    filePatterns: ['plugins', 'decorators'],
    pros: ['Fastify-native', 'Available on all requests', 'Type-safe'],
    cons: ['Fastify-specific pattern'],
    estimatedLines: 30,
  },
  {
    strategy: 'middleware',
    name: 'Fastify Hook',
    description: 'Use Fastify lifecycle hooks (onRequest, preHandler, etc.)',
    applicableCategories: ['authentication', 'authorization', 'logging', 'rate-limiting', 'validation'],
    filePatterns: ['hooks', 'plugins'],
    pros: ['Fine-grained control', 'Multiple hook points', 'Async-friendly'],
    cons: ['Different from Express middleware'],
    estimatedLines: 35,
    template: `fastify.addHook('preHandler', async (request, reply) => {\n  // Implementation\n});`,
  },
  {
    strategy: 'centralized',
    name: 'Fastify Plugin',
    description: 'Create a Fastify plugin for encapsulated functionality',
    applicableCategories: ['authentication', 'caching', 'logging', 'data-access'],
    filePatterns: ['plugins'],
    pros: ['Encapsulated', 'Reusable', 'Scoped'],
    cons: ['Plugin architecture learning curve'],
    estimatedLines: 50,
  },
];

const FASTIFY_FRAMEWORK: FrameworkDefinition = {
  name: 'fastify',
  language: 'typescript',
  detectPatterns: ['fastify.', 'FastifyInstance', 'FastifyRequest', 'FastifyReply', 'addHook'],
  importPatterns: ['fastify', 'from \'fastify\''],
  strategies: FASTIFY_STRATEGIES,
};

// ============================================================================
// TypeScript Strategy Provider
// ============================================================================

export class TypeScriptStrategyProvider implements LanguageStrategyProvider {
  readonly language = 'typescript' as const;
  readonly frameworks: FrameworkDefinition[] = [
    NESTJS_FRAMEWORK,  // Check NestJS first (more specific)
    NEXTJS_FRAMEWORK,
    FASTIFY_FRAMEWORK,
    EXPRESS_FRAMEWORK, // Express last (most generic)
  ];

  getStrategies(category: TaskCategory, framework?: string): StrategyTemplate[] {
    const fw = framework 
      ? this.frameworks.find(f => f.name === framework)
      : this.frameworks[0]; // Default to first (NestJS)
    
    if (!fw) {return [];}
    
    return fw.strategies.filter(s => 
      s.applicableCategories.includes(category) || 
      s.applicableCategories.includes('generic' as TaskCategory)
    );
  }

  detectFramework(content: string, _filePath: string): string | null {
    for (const fw of this.frameworks) {
      // Check import patterns first (more reliable)
      for (const pattern of fw.importPatterns) {
        if (content.includes(pattern)) {
          return fw.name;
        }
      }
      // Then check code patterns
      for (const pattern of fw.detectPatterns) {
        if (content.includes(pattern)) {
          return fw.name;
        }
      }
    }
    return null;
  }
}

export const typescriptStrategyProvider = new TypeScriptStrategyProvider();
