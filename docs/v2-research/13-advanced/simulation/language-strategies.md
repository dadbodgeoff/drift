# Language Strategies

## Location
`packages/core/src/simulation/language-strategies/`

## Purpose
Per-language/framework strategy templates that define how specific task categories should be implemented. Each language provider knows its frameworks and offers tailored approach templates.

## Files
- `typescript-strategies.ts` — Express, NestJS, Fastify strategies
- `python-strategies.ts` — FastAPI, Flask, Django strategies
- `java-strategies.ts` — Spring Boot, Quarkus strategies
- `csharp-strategies.ts` — ASP.NET Core strategies
- `php-strategies.ts` — Laravel, Symfony strategies
- `types.ts` — Strategy types + category keywords
- `index.ts` — Provider registry + utilities

## LanguageStrategyProvider Interface

```typescript
interface LanguageStrategyProvider {
  language: CallGraphLanguage;
  frameworks: FrameworkDefinition[];
  getStrategies(category: TaskCategory, framework?: string): StrategyTemplate[];
  detectFramework(content: string, filePath: string): string | null;
}
```

## StrategyTemplate

```typescript
interface StrategyTemplate {
  strategy: ApproachStrategy;       // e.g., 'middleware', 'decorator'
  name: string;                     // Human-readable
  description: string;
  applicableCategories: TaskCategory[];
  filePatterns: string[];           // Files to look for
  pros: string[];
  cons: string[];
  estimatedLines: number;
  frameworkNotes?: string;
  template?: string;                // Example code
  newFiles?: string[];              // Files to create
}
```

## FrameworkDefinition

```typescript
interface FrameworkDefinition {
  name: string;
  language: CallGraphLanguage;
  detectPatterns: string[];         // File patterns
  importPatterns: string[];         // Import patterns
  strategies: StrategyTemplate[];
}
```

## Language Coverage

| Language | Frameworks | Strategy Count |
|----------|-----------|----------------|
| TypeScript | Express, NestJS, Fastify | ~15 strategies |
| Python | FastAPI, Flask, Django | ~12 strategies |
| Java | Spring Boot, Quarkus | ~10 strategies |
| C# | ASP.NET Core | ~8 strategies |
| PHP | Laravel, Symfony | ~8 strategies |

JavaScript shares the TypeScript provider.

## Task Category Keywords

Auto-detection uses weighted keyword matching:

| Category | Keywords (sample) | Weight |
|----------|-------------------|--------|
| `rate-limiting` | rate limit, throttle, quota | 1.0 |
| `authentication` | auth, login, jwt, token, oauth | 1.0 |
| `authorization` | permission, role, rbac, acl | 1.0 |
| `caching` | cache, redis, memcache, ttl | 1.0 |
| `data-access` | database, query, orm, crud | 0.9 |
| `error-handling` | error, exception, catch, retry | 0.9 |
| `validation` | validate, schema, sanitize, dto | 0.9 |
| `middleware` | middleware, interceptor, filter, guard | 0.9 |
| `testing` | test, mock, stub, fixture, assert | 0.9 |
| `api-endpoint` | endpoint, route, api, rest | 0.8 |
| `logging` | log, trace, audit, telemetry | 0.8 |
| `refactoring` | refactor, restructure, simplify | 0.7 |

## Utility Functions

```typescript
getStrategyProvider(language)                    → LanguageStrategyProvider | null
getStrategiesForTask(language, category, framework?) → StrategyTemplate[]
detectTaskCategory(description)                  → TaskCategory
detectFramework(content, filePath, language)      → string | null
getSupportedLanguages()                          → CallGraphLanguage[]
getFrameworksForLanguage(language)               → string[]
```

## Rust Rebuild Considerations
- Strategy templates are static configuration data — zero-cost Rust structs
- Keyword matching for category detection is trivial in Rust
- Framework detection is string matching — straightforward
- The main value of porting would be consistency with a Rust pipeline, not performance
