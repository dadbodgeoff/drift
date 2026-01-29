/**
 * ASP.NET Core Framework Patterns
 *
 * Semantic mappings for ASP.NET Core attributes.
 */

import type { FrameworkPattern, DecoratorArguments, HttpMethod } from '../types.js';

/**
 * Extract HTTP method from ASP.NET attribute
 */
function extractHttpMethod(raw: string): HttpMethod | undefined {
  const match = raw.match(/\[Http(Get|Post|Put|Delete|Patch|Head|Options)/i);
  if (match?.[1]) {
    return match[1].toUpperCase() as HttpMethod;
  }
  return undefined;
}

/**
 * Extract path from ASP.NET attribute
 */
function extractPath(raw: string): string | undefined {
  const match = raw.match(/\(\s*["']([^"']+)["']/);
  return match?.[1];
}

/**
 * Extract roles from ASP.NET authorize attribute
 */
function extractRoles(raw: string): string[] | undefined {
  const rolesMatch = raw.match(/Roles\s*=\s*["']([^"']+)["']/);
  if (rolesMatch?.[1]) {
    return rolesMatch[1].split(',').map(r => r.trim());
  }
  return undefined;
}

/**
 * ASP.NET Core framework patterns
 */
export const ASPNET_PATTERNS: FrameworkPattern = {
  framework: 'aspnet',
  displayName: 'ASP.NET Core',
  languages: ['csharp'],

  decoratorMappings: [
    // HTTP Endpoint attributes
    {
      pattern: /\[Http(Get|Post|Put|Delete|Patch|Head|Options)/i,
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

    // Route attribute
    {
      pattern: /\[Route\s*\(/,
      semantic: {
        category: 'routing',
        intent: 'Route template',
        isEntryPoint: true,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (raw): DecoratorArguments => {
        const path = extractPath(raw);
        return path !== undefined ? { path } : {};
      },
    },

    // Controller attributes
    {
      pattern: /\[ApiController\]/,
      semantic: {
        category: 'routing',
        intent: 'API controller class',
        isEntryPoint: true,
        isInjectable: true,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
    {
      pattern: /\[Controller\]/,
      semantic: {
        category: 'routing',
        intent: 'MVC controller class',
        isEntryPoint: true,
        isInjectable: true,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Authorization
    {
      pattern: /\[Authorize/,
      semantic: {
        category: 'auth',
        intent: 'Authorization required',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: true,
      },
      extractArgs: (raw): DecoratorArguments => {
        const roles = extractRoles(raw);
        const policyMatch = raw.match(/Policy\s*=\s*["']([^"']+)["']/);
        return {
          ...(roles !== undefined && { roles }),
          ...(policyMatch?.[1] !== undefined && { policy: policyMatch[1] }),
        };
      },
    },
    {
      pattern: /\[AllowAnonymous\]/,
      semantic: {
        category: 'auth',
        intent: 'Allow anonymous access',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Validation
    {
      pattern: /\[Required\]/,
      semantic: {
        category: 'validation',
        intent: 'Required field validation',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
    {
      pattern: /\[FromBody\]/,
      semantic: {
        category: 'routing',
        intent: 'Request body binding',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
    {
      pattern: /\[FromQuery\]/,
      semantic: {
        category: 'routing',
        intent: 'Query parameter binding',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Dependency Injection
    {
      pattern: /\[Inject\]/,
      semantic: {
        category: 'di',
        intent: 'Dependency injection',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Middleware/Filters
    {
      pattern: /\[ServiceFilter\s*\(/,
      semantic: {
        category: 'middleware',
        intent: 'Service filter',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
    {
      pattern: /\[TypeFilter\s*\(/,
      semantic: {
        category: 'middleware',
        intent: 'Type filter',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Caching
    {
      pattern: /\[ResponseCache/,
      semantic: {
        category: 'caching',
        intent: 'Response caching',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Testing
    {
      pattern: /\[Fact\]/,
      semantic: {
        category: 'test',
        intent: 'xUnit test method',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
    {
      pattern: /\[Theory\]/,
      semantic: {
        category: 'test',
        intent: 'xUnit parameterized test',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
    {
      pattern: /\[TestMethod\]/,
      semantic: {
        category: 'test',
        intent: 'MSTest test method',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Entity Framework
    {
      pattern: /\[Table\s*\(/,
      semantic: {
        category: 'orm',
        intent: 'Database table mapping',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
        dataAccess: 'both',
      },
      extractArgs: (raw): DecoratorArguments => {
        const nameMatch = raw.match(/["']([^"']+)["']/);
        return nameMatch?.[1] !== undefined ? { name: nameMatch[1] } : {};
      },
    },
    {
      pattern: /\[Key\]/,
      semantic: {
        category: 'orm',
        intent: 'Primary key',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
        dataAccess: 'both',
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
  ],

  // Detection patterns
  detectionPatterns: {
    imports: [
      /using\s+Microsoft\.AspNetCore/,
      /using\s+System\.ComponentModel\.DataAnnotations/,
      /using\s+Microsoft\.EntityFrameworkCore/,
    ],
    decorators: [
      /\[ApiController\]/,
      /\[Controller\]/,
      /\[HttpGet/,
      /\[HttpPost/,
      /\[Route\s*\(/,
    ],
    filePatterns: [
      /Controller\.cs$/,
      /Service\.cs$/,
    ],
  },

  // Entry point patterns
  entryPointPatterns: [
    /\[ApiController\]/,
    /\[Controller\]/,
    /\[HttpGet/,
    /\[HttpPost/,
    /\[HttpPut/,
    /\[HttpDelete/,
    /\[HttpPatch/,
    /\[Route\s*\(/,
  ],

  // DI patterns
  diPatterns: [
    /\[Inject\]/,
    /services\.Add(Scoped|Singleton|Transient)/,
    /IServiceCollection/,
  ],

  // ORM patterns (Entity Framework)
  ormPatterns: [
    /DbContext/,
    /DbSet</,
    /\[Table\s*\(/,
    /\[Key\]/,
    /\.ToListAsync\s*\(/,
    /\.FirstOrDefaultAsync\s*\(/,
    /\.SaveChangesAsync\s*\(/,
  ],

  // Auth patterns
  authPatterns: [
    /\[Authorize/,
    /\[AllowAnonymous\]/,
    /IAuthorizationService/,
  ],
};
