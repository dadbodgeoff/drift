/**
 * Laravel Framework Patterns
 *
 * Semantic mappings for Laravel patterns.
 * Note: Laravel uses less decorators and more conventions/method calls.
 */

import type { FrameworkPattern, DecoratorArguments } from '../types.js';

/**
 * Laravel framework patterns
 */
export const LARAVEL_PATTERNS: FrameworkPattern = {
  framework: 'laravel',
  displayName: 'Laravel',
  languages: ['php'],

  decoratorMappings: [
    // Route attributes (PHP 8+)
    {
      pattern: /#\[Route\s*\(/,
      semantic: {
        category: 'routing',
        intent: 'HTTP route definition',
        isEntryPoint: true,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (raw): DecoratorArguments => {
        const pathMatch = raw.match(/["']([^"']+)["']/);
        const methodMatch = raw.match(/methods?:\s*\[?["'](\w+)["']/i);
        return {
          ...(pathMatch?.[1] !== undefined && { path: pathMatch[1] }),
          ...(methodMatch?.[1] !== undefined && { methods: [methodMatch[1].toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'] }),
        };
      },
    },

    // Middleware attribute
    {
      pattern: /#\[Middleware\s*\(/,
      semantic: {
        category: 'middleware',
        intent: 'Route middleware',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (raw): DecoratorArguments => {
        const middlewareMatch = raw.match(/["']([^"']+)["']/);
        return middlewareMatch?.[1] !== undefined ? { middleware: [middlewareMatch[1]] } : {};
      },
    },

    // Auth middleware
    {
      pattern: /#\[Middleware\s*\(\s*["']auth/,
      semantic: {
        category: 'auth',
        intent: 'Authentication required',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: true,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Validation
    {
      pattern: /#\[Validate\s*\(/,
      semantic: {
        category: 'validation',
        intent: 'Request validation',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Testing
    {
      pattern: /#\[Test\]/,
      semantic: {
        category: 'test',
        intent: 'Test method',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
    {
      pattern: /#\[DataProvider\s*\(/,
      semantic: {
        category: 'test',
        intent: 'Test data provider',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Caching
    {
      pattern: /#\[Cache\s*\(/,
      semantic: {
        category: 'caching',
        intent: 'Cache result',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Queue/Jobs
    {
      pattern: /#\[Queue\s*\(/,
      semantic: {
        category: 'messaging',
        intent: 'Queue job',
        isEntryPoint: true,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Events
    {
      pattern: /#\[Listener\s*\(/,
      semantic: {
        category: 'messaging',
        intent: 'Event listener',
        isEntryPoint: true,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Scheduling
    {
      pattern: /#\[Schedule\s*\(/,
      semantic: {
        category: 'scheduling',
        intent: 'Scheduled task',
        isEntryPoint: true,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
  ],

  // Detection patterns
  detectionPatterns: {
    imports: [
      /use\s+Illuminate\\/,
      /use\s+Laravel\\/,
      /use\s+App\\Http\\Controllers/,
    ],
    decorators: [
      /#\[Route\s*\(/,
      /#\[Middleware\s*\(/,
    ],
    filePatterns: [
      /Controller\.php$/,
      /Request\.php$/,
      /Model\.php$/,
    ],
  },

  // Entry point patterns
  entryPointPatterns: [
    /#\[Route\s*\(/,
    /Route::(get|post|put|delete|patch|any)\s*\(/,
    /#\[Queue\s*\(/,
    /#\[Listener\s*\(/,
    /#\[Schedule\s*\(/,
  ],

  // DI patterns (Laravel uses constructor injection by convention)
  diPatterns: [
    /app\s*\(\s*['"][^'"]+['"]\s*\)/,
    /resolve\s*\(/,
  ],

  // ORM patterns (Eloquent)
  ormPatterns: [
    /extends\s+Model/,
    /::where\s*\(/,
    /::find\s*\(/,
    /::create\s*\(/,
    /->save\s*\(/,
    /DB::table\s*\(/,
    /DB::select\s*\(/,
  ],

  // Auth patterns
  authPatterns: [
    /middleware\s*\(\s*['"]auth/,
    /#\[Middleware\s*\(\s*["']auth/,
    /Gate::allows\s*\(/,
    /->authorize\s*\(/,
    /Policy/,
  ],
};
