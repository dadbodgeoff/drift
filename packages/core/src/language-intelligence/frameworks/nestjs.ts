/**
 * NestJS Framework Patterns
 *
 * Semantic mappings for NestJS decorators.
 */

import type { FrameworkPattern, DecoratorArguments, HttpMethod } from '../types.js';

/**
 * Extract HTTP method from NestJS decorator
 * Note: NestJS @All() decorator matches all methods - we return undefined to indicate "any method"
 * The decorator string may or may not have the @ prefix depending on the extractor
 */
function extractHttpMethod(raw: string): HttpMethod | undefined {
  const match = raw.match(/^@?(Get|Post|Put|Delete|Patch|Head|Options|All)\s*\(/i);
  if (match?.[1]) {
    const method = match[1].toUpperCase();
    // 'ALL', 'HEAD', 'OPTIONS' are not in our HttpMethod type - return undefined
    if (method === 'ALL' || method === 'HEAD' || method === 'OPTIONS') {
      return undefined;
    }
    return method as HttpMethod;
  }
  return undefined;
}

/**
 * Extract path from NestJS decorator
 */
function extractPath(raw: string): string | undefined {
  const match = raw.match(/\(\s*["']([^"']+)["']/);
  return match?.[1];
}

/**
 * NestJS framework patterns
 */
export const NESTJS_PATTERNS: FrameworkPattern = {
  framework: 'nestjs',
  displayName: 'NestJS',
  languages: ['typescript'],

  decoratorMappings: [
    // HTTP Endpoint decorators
    {
      pattern: /^(Get|Post|Put|Delete|Patch|Head|Options|All)\s*\(/i,
      semantic: {
        category: 'routing',
        intent: 'HTTP endpoint handler',
        isEntryPoint: true,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (raw): DecoratorArguments => {
        const method = extractHttpMethod(raw);
        const path = extractPath(raw);
        return {
          ...(path !== undefined && { path }),
          ...(method !== undefined && { methods: [method] }),
        };
      },
    },

    // Controller
    {
      pattern: /^Controller\s*\(/,
      semantic: {
        category: 'routing',
        intent: 'HTTP controller class',
        isEntryPoint: true,
        isInjectable: true,
        requiresAuth: false,
      },
      extractArgs: (raw): DecoratorArguments => {
        const path = extractPath(raw);
        return path !== undefined ? { path } : {};
      },
    },

    // Dependency Injection
    {
      pattern: /^Injectable\s*\(/,
      semantic: {
        category: 'di',
        intent: 'Injectable service',
        isEntryPoint: false,
        isInjectable: true,
        requiresAuth: false,
      },
      extractArgs: (raw): DecoratorArguments => {
        const scopeMatch = raw.match(/scope:\s*Scope\.(\w+)/);
        const scope = scopeMatch?.[1]?.toLowerCase();
        if (scope === 'default' || scope === 'singleton') {return { scope: 'singleton' };}
        if (scope === 'request') {return { scope: 'scoped' };}
        if (scope === 'transient') {return { scope: 'transient' };}
        return { scope: 'singleton' };
      },
    },
    {
      pattern: /^Inject\s*\(/,
      semantic: {
        category: 'di',
        intent: 'Dependency injection token',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Module
    {
      pattern: /^Module\s*\(/,
      semantic: {
        category: 'di',
        intent: 'NestJS module definition',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Guards (Auth)
    {
      pattern: /^UseGuards\s*\(/,
      semantic: {
        category: 'auth',
        intent: 'Route guard (authentication/authorization)',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: true,
      },
      extractArgs: (raw): DecoratorArguments => {
        const guardMatch = raw.match(/UseGuards\s*\(\s*(\w+)/);
        return guardMatch?.[1] !== undefined ? { guard: guardMatch[1] } : {};
      },
    },

    // Pipes (Validation)
    {
      pattern: /^UsePipes\s*\(/,
      semantic: {
        category: 'validation',
        intent: 'Validation pipe',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Interceptors
    {
      pattern: /^UseInterceptors\s*\(/,
      semantic: {
        category: 'middleware',
        intent: 'Request/response interceptor',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Parameter decorators
    {
      pattern: /^Body\s*\(/,
      semantic: {
        category: 'routing',
        intent: 'Request body parameter',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
    {
      pattern: /^Param\s*\(/,
      semantic: {
        category: 'routing',
        intent: 'Route parameter',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
    {
      pattern: /^Query\s*\(/,
      semantic: {
        category: 'routing',
        intent: 'Query parameter',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // WebSocket
    {
      pattern: /^WebSocketGateway\s*\(/,
      semantic: {
        category: 'routing',
        intent: 'WebSocket gateway',
        isEntryPoint: true,
        isInjectable: true,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
    {
      pattern: /^SubscribeMessage\s*\(/,
      semantic: {
        category: 'routing',
        intent: 'WebSocket message handler',
        isEntryPoint: true,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (raw): DecoratorArguments => {
        const eventMatch = raw.match(/["']([^"']+)["']/);
        return eventMatch?.[1] !== undefined ? { event: eventMatch[1] } : {};
      },
    },

    // Scheduling
    {
      pattern: /^Cron\s*\(/,
      semantic: {
        category: 'scheduling',
        intent: 'Cron job',
        isEntryPoint: true,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (raw): DecoratorArguments => {
        const cronMatch = raw.match(/["']([^"']+)["']/);
        return cronMatch?.[1] !== undefined ? { cron: cronMatch[1] } : {};
      },
    },
    {
      pattern: /^Interval\s*\(/,
      semantic: {
        category: 'scheduling',
        intent: 'Interval task',
        isEntryPoint: true,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Testing
    {
      pattern: /^Test\s*\(/,
      semantic: {
        category: 'test',
        intent: 'Test method',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
  ],

  // Detection patterns
  detectionPatterns: {
    imports: [
      /from\s+['"]@nestjs\//,
      /import.*from\s+['"]@nestjs\//,
    ],
    decorators: [
      /@Controller\s*\(/,
      /@Injectable\s*\(/,
      /@Module\s*\(/,
    ],
    filePatterns: [
      /\.controller\.ts$/,
      /\.service\.ts$/,
      /\.module\.ts$/,
      /\.guard\.ts$/,
      /\.pipe\.ts$/,
    ],
  },

  // Entry point patterns
  entryPointPatterns: [
    /@Controller\s*\(/,
    /@Get\s*\(/,
    /@Post\s*\(/,
    /@Put\s*\(/,
    /@Delete\s*\(/,
    /@Patch\s*\(/,
    /@WebSocketGateway\s*\(/,
    /@SubscribeMessage\s*\(/,
    /@Cron\s*\(/,
    /@Interval\s*\(/,
  ],

  // DI patterns
  diPatterns: [
    /@Injectable\s*\(/,
    /@Inject\s*\(/,
    /@Module\s*\(/,
  ],

  // ORM patterns (TypeORM typically used with NestJS)
  ormPatterns: [
    /@Entity\s*\(/,
    /@Column\s*\(/,
    /@Repository\s*\(/,
    /InjectRepository\s*\(/,
  ],

  // Auth patterns
  authPatterns: [
    /@UseGuards\s*\(/,
    /AuthGuard/,
    /JwtAuthGuard/,
  ],
};
