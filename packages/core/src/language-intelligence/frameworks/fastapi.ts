/**
 * FastAPI Framework Patterns
 *
 * Semantic mappings for FastAPI decorators.
 */

import type { FrameworkPattern, DecoratorArguments, HttpMethod } from '../types.js';

/**
 * Extract HTTP method from FastAPI decorator
 */
function extractHttpMethod(raw: string): HttpMethod | undefined {
  const match = raw.match(/@(?:app|router)\.(get|post|put|delete|patch|head|options)/i);
  if (match?.[1]) {
    return match[1].toUpperCase() as HttpMethod;
  }
  return undefined;
}

/**
 * Extract path from FastAPI decorator
 */
function extractPath(raw: string): string | undefined {
  const match = raw.match(/\(\s*["']([^"']+)["']/);
  return match?.[1];
}

/**
 * FastAPI framework patterns
 */
export const FASTAPI_PATTERNS: FrameworkPattern = {
  framework: 'fastapi',
  displayName: 'FastAPI',
  languages: ['python'],

  decoratorMappings: [
    // HTTP Endpoint decorators
    {
      pattern: /@(?:app|router)\.(get|post|put|delete|patch|head|options)\s*\(/i,
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

    // Dependency Injection (Depends)
    {
      pattern: /Depends\s*\(/,
      semantic: {
        category: 'di',
        intent: 'Dependency injection',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (raw): DecoratorArguments => {
        // Extract the dependency function name
        const match = raw.match(/Depends\s*\(\s*(\w+)/);
        return match?.[1] !== undefined ? { dependency: match[1] } : {};
      },
    },

    // Background tasks
    {
      pattern: /@(?:app|router)\.on_event\s*\(\s*["']startup["']\s*\)/,
      semantic: {
        category: 'scheduling',
        intent: 'Application startup handler',
        isEntryPoint: true,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({ event: 'startup' }),
    },
    {
      pattern: /@(?:app|router)\.on_event\s*\(\s*["']shutdown["']\s*\)/,
      semantic: {
        category: 'scheduling',
        intent: 'Application shutdown handler',
        isEntryPoint: true,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({ event: 'shutdown' }),
    },

    // WebSocket
    {
      pattern: /@(?:app|router)\.websocket\s*\(/,
      semantic: {
        category: 'routing',
        intent: 'WebSocket endpoint',
        isEntryPoint: true,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (raw): DecoratorArguments => {
        const path = extractPath(raw);
        return path !== undefined ? { path } : {};
      },
    },

    // Middleware
    {
      pattern: /@(?:app|router)\.middleware\s*\(/,
      semantic: {
        category: 'middleware',
        intent: 'Request/response middleware',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Exception handlers
    {
      pattern: /@(?:app|router)\.exception_handler\s*\(/,
      semantic: {
        category: 'middleware',
        intent: 'Exception handler',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Testing
    {
      pattern: /@pytest\.fixture/,
      semantic: {
        category: 'test',
        intent: 'Test fixture',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
    {
      pattern: /@pytest\.mark/,
      semantic: {
        category: 'test',
        intent: 'Test marker',
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
      /from\s+fastapi\s+import/,
      /import\s+fastapi/,
    ],
    decorators: [
      /@app\.(get|post|put|delete|patch)/,
      /@router\.(get|post|put|delete|patch)/,
    ],
  },

  // Entry point patterns
  entryPointPatterns: [
    /@app\.(get|post|put|delete|patch|head|options)/,
    /@router\.(get|post|put|delete|patch|head|options)/,
    /@app\.websocket/,
    /@app\.on_event/,
  ],

  // DI patterns
  diPatterns: [
    /Depends\s*\(/,
  ],

  // ORM patterns (SQLAlchemy typically used with FastAPI)
  ormPatterns: [
    /Session\s*\(/,
    /\.query\s*\(/,
    /\.add\s*\(/,
    /\.commit\s*\(/,
  ],

  // Auth patterns
  authPatterns: [
    /OAuth2PasswordBearer/,
    /HTTPBearer/,
    /Security\s*\(/,
  ],
};
