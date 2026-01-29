/**
 * Spring Boot Framework Patterns
 *
 * Semantic mappings for Spring Boot annotations.
 */

import type { FrameworkPattern, DecoratorArguments, HttpMethod } from '../types.js';

/**
 * Extract HTTP method from Spring mapping annotation
 */
function extractHttpMethod(raw: string): HttpMethod | undefined {
  const match = raw.match(/@(Get|Post|Put|Delete|Patch)Mapping/i);
  if (match?.[1]) {
    return match[1].toUpperCase() as HttpMethod;
  }
  return undefined;
}

/**
 * Extract path from Spring annotation
 */
function extractPath(raw: string): string | undefined {
  // Match: @GetMapping("/path") or @GetMapping(value = "/path") or @GetMapping(path = "/path")
  const patterns = [
    /["']([^"']+)["']/,                           // Simple string
    /value\s*=\s*["']([^"']+)["']/,               // value = "..."
    /path\s*=\s*["']([^"']+)["']/,                // path = "..."
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Extract roles from Spring security annotations
 */
function extractRoles(raw: string): string[] | undefined {
  // Match: @PreAuthorize("hasRole('ADMIN')") or @Secured({"ROLE_ADMIN", "ROLE_USER"})
  const roleMatches = raw.match(/['"](?:ROLE_)?([^'"]+)['"]/g);
  if (roleMatches && roleMatches.length > 0) {
    return roleMatches.map(r => r.replace(/['"]/g, '').replace(/^ROLE_/, ''));
  }
  return undefined;
}

/**
 * Spring Boot framework patterns
 */
export const SPRING_PATTERNS: FrameworkPattern = {
  framework: 'spring',
  displayName: 'Spring Boot',
  languages: ['java'],
  
  decoratorMappings: [
    // HTTP Endpoint Mappings
    {
      pattern: /@(Get|Post|Put|Delete|Patch)Mapping/i,
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
    {
      pattern: /@RequestMapping/i,
      semantic: {
        category: 'routing',
        intent: 'HTTP endpoint or controller base path',
        isEntryPoint: true,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (raw): DecoratorArguments => {
        const path = extractPath(raw);
        // Extract method if specified
        const methodMatch = raw.match(/method\s*=\s*RequestMethod\.(\w+)/i);
        const method = methodMatch?.[1]?.toUpperCase() as HttpMethod | undefined;
        return {
          ...(path !== undefined && { path }),
          ...(method !== undefined && { methods: [method] }),
        };
      },
    },

    // Controller annotations
    {
      pattern: /@RestController/,
      semantic: {
        category: 'routing',
        intent: 'REST API controller class',
        isEntryPoint: true,
        isInjectable: true,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
    {
      pattern: /@Controller(?!Advice)/,
      semantic: {
        category: 'routing',
        intent: 'MVC controller class',
        isEntryPoint: true,
        isInjectable: true,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Dependency Injection
    {
      pattern: /@Service/,
      semantic: {
        category: 'di',
        intent: 'Business logic service',
        isEntryPoint: false,
        isInjectable: true,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({ scope: 'singleton' }),
    },
    {
      pattern: /@Component/,
      semantic: {
        category: 'di',
        intent: 'Generic Spring-managed component',
        isEntryPoint: false,
        isInjectable: true,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({ scope: 'singleton' }),
    },
    {
      pattern: /@Repository/,
      semantic: {
        category: 'di',
        intent: 'Data access repository',
        isEntryPoint: false,
        isInjectable: true,
        requiresAuth: false,
        dataAccess: 'both',
      },
      extractArgs: (): DecoratorArguments => ({ scope: 'singleton' }),
    },
    {
      pattern: /@Autowired/,
      semantic: {
        category: 'di',
        intent: 'Dependency injection point',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // ORM/Data Access
    {
      pattern: /@Entity/,
      semantic: {
        category: 'orm',
        intent: 'JPA entity class',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
        dataAccess: 'both',
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
    {
      pattern: /@Table/,
      semantic: {
        category: 'orm',
        intent: 'Database table mapping',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
        dataAccess: 'both',
      },
      extractArgs: (raw): DecoratorArguments => {
        const nameMatch = raw.match(/name\s*=\s*["']([^"']+)["']/);
        return nameMatch?.[1] !== undefined ? { name: nameMatch[1] } : {};
      },
    },
    {
      pattern: /@Query/,
      semantic: {
        category: 'orm',
        intent: 'Custom database query',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
        dataAccess: 'read',
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Security/Auth
    {
      pattern: /@PreAuthorize/,
      semantic: {
        category: 'auth',
        intent: 'Method-level authorization check',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: true,
      },
      extractArgs: (raw): DecoratorArguments => {
        const roles = extractRoles(raw);
        return roles !== undefined ? { roles } : {};
      },
    },
    {
      pattern: /@Secured/,
      semantic: {
        category: 'auth',
        intent: 'Role-based security',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: true,
      },
      extractArgs: (raw): DecoratorArguments => {
        const roles = extractRoles(raw);
        return roles !== undefined ? { roles } : {};
      },
    },

    // Validation
    {
      pattern: /@Valid/,
      semantic: {
        category: 'validation',
        intent: 'Input validation trigger',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },
    {
      pattern: /@Validated/,
      semantic: {
        category: 'validation',
        intent: 'Validation group trigger',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Testing
    {
      pattern: /@Test/,
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
      pattern: /@SpringBootTest/,
      semantic: {
        category: 'test',
        intent: 'Integration test class',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Scheduling
    {
      pattern: /@Scheduled/,
      semantic: {
        category: 'scheduling',
        intent: 'Scheduled task',
        isEntryPoint: true,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (raw): DecoratorArguments => {
        const cronMatch = raw.match(/cron\s*=\s*["']([^"']+)["']/);
        return cronMatch?.[1] !== undefined ? { cron: cronMatch[1] } : {};
      },
    },

    // Caching
    {
      pattern: /@Cacheable/,
      semantic: {
        category: 'caching',
        intent: 'Cache method result',
        isEntryPoint: false,
        isInjectable: false,
        requiresAuth: false,
      },
      extractArgs: (): DecoratorArguments => ({}),
    },

    // Transactional
    {
      pattern: /@Transactional/,
      semantic: {
        category: 'orm',
        intent: 'Database transaction boundary',
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
      /import\s+org\.springframework/,
      /import\s+javax\.persistence/,
      /import\s+jakarta\.persistence/,
    ],
    decorators: [
      /@SpringBootApplication/,
      /@RestController/,
      /@Controller/,
      /@Service/,
      /@Repository/,
      /@Entity/,
    ],
  },

  // Entry point patterns
  entryPointPatterns: [
    /@RestController/,
    /@Controller/,
    /@RequestMapping/,
    /@GetMapping/,
    /@PostMapping/,
    /@PutMapping/,
    /@DeleteMapping/,
    /@PatchMapping/,
    /@Scheduled/,
  ],

  // DI patterns
  diPatterns: [
    /@Service/,
    /@Component/,
    /@Repository/,
    /@Autowired/,
    /@Inject/,
  ],

  // ORM patterns
  ormPatterns: [
    /@Entity/,
    /@Table/,
    /@Query/,
    /@Transactional/,
    /JpaRepository/,
    /CrudRepository/,
  ],

  // Auth patterns
  authPatterns: [
    /@PreAuthorize/,
    /@Secured/,
    /@RolesAllowed/,
  ],
};
