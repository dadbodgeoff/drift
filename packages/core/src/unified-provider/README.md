# Unified Language Provider

A composable extraction pipeline that normalizes AST differences into a universal representation, enabling language-agnostic pattern matching.

## Features

- **Multi-language support**: TypeScript, JavaScript, Python, Java, C#, PHP
- **14 ORM matchers**: Supabase, Prisma, TypeORM, Sequelize, Drizzle, Knex, Mongoose, Django, SQLAlchemy, EF Core, Eloquent, Spring Data JPA, and raw SQL
- **Single parse pass**: Extract call graph and data access simultaneously
- **Composable architecture**: Easy to add new languages and ORMs
- **Backward compatible**: Drop-in replacement for legacy extractors

## Quick Start

```typescript
import { createUnifiedProvider } from 'driftdetect-core';

const provider = createUnifiedProvider({
  projectRoot: '/path/to/project',
});

const result = await provider.extract(sourceCode, 'src/api/users.ts');

// Extracted data
console.log(result.functions);    // Functions and methods
console.log(result.classes);      // Class definitions
console.log(result.imports);      // Import statements
console.log(result.callChains);   // Normalized call chains
console.log(result.dataAccess);   // Data access points
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  UnifiedLanguageProvider                     │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Parser    │  │ Normalizer  │  │   Matcher   │         │
│  │  Registry   │  │  Registry   │  │  Registry   │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐         │
│  │ tree-sitter │  │ TypeScript  │  │  Supabase   │         │
│  │   parsers   │  │   Python    │  │   Prisma    │         │
│  │             │  │    Java     │  │   Django    │         │
│  │             │  │     C#      │  │  EF Core    │         │
│  │             │  │    PHP      │  │    ...      │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

## Components

### Normalizers

Convert language-specific AST into universal `UnifiedCallChain` format:

| Normalizer | Languages | Lines |
|------------|-----------|-------|
| `TypeScriptNormalizer` | TypeScript, JavaScript | ~400 |
| `PythonNormalizer` | Python | ~400 |
| `JavaNormalizer` | Java | ~350 |
| `CSharpNormalizer` | C# | ~350 |
| `PhpNormalizer` | PHP | ~350 |

### Matchers

Detect ORM patterns from normalized call chains:

| Matcher | ORM/Framework | Languages |
|---------|---------------|-----------|
| `SupabaseMatcher` | Supabase | TS/JS |
| `PrismaMatcher` | Prisma | TS/JS |
| `TypeORMMatcher` | TypeORM | TS/JS |
| `SequelizeMatcher` | Sequelize | TS/JS |
| `DrizzleMatcher` | Drizzle | TS/JS |
| `KnexMatcher` | Knex | TS/JS |
| `MongooseMatcher` | Mongoose | TS/JS |
| `RawSqlMatcher` | Raw SQL | All |
| `DjangoMatcher` | Django ORM | Python |
| `SQLAlchemyMatcher` | SQLAlchemy | Python |
| `EFCoreMatcher` | Entity Framework Core | C# |
| `EloquentMatcher` | Laravel Eloquent | PHP |
| `SpringDataMatcher` | Spring Data JPA | Java |

## Integration

### UnifiedScanner

Drop-in replacement for `SemanticDataAccessScanner`:

```typescript
import { createUnifiedScanner } from 'driftdetect-core';

const scanner = createUnifiedScanner({
  rootDir: '/path/to/project',
  autoDetect: true,  // Auto-detect project stack
});

const result = await scanner.scanDirectory({
  patterns: ['**/*.ts', '**/*.py'],
});

console.log(result.accessPoints);  // Map<string, DataAccessPoint[]>
console.log(result.stats);         // Scan statistics
console.log(result.detectedStack); // Detected languages/ORMs
```

### UnifiedDataAccessAdapter

Bridge to existing `DataAccessPoint` format:

```typescript
import { createUnifiedDataAccessAdapter } from 'driftdetect-core';

const adapter = createUnifiedDataAccessAdapter();

// Extract data access points
const { accessPoints, language, errors } = await adapter.extract(source, file);

// Extract full file information (compatible with CallGraphExtractor)
const fileResult = await adapter.extractFull(source, file);
```

## Migration

See [MIGRATION.md](./MIGRATION.md) for migrating from legacy extractors.

## Adding New Languages

1. Create a normalizer extending `BaseNormalizer`
2. Implement `normalizeCallChains()` method
3. Register in `normalization/index.ts`

```typescript
export class RubyNormalizer extends BaseNormalizer {
  readonly language = 'ruby';
  readonly extensions = ['.rb'];

  normalizeCallChains(tree: Tree, source: string): UnifiedCallChain[] {
    // Parse Ruby AST and extract call chains
  }
}
```

## Adding New ORMs

1. Create a matcher extending `BaseMatcher`
2. Implement `match()` method
3. Register in `matching/index.ts`

```typescript
export class ActiveRecordMatcher extends BaseMatcher {
  readonly name = 'active-record';
  readonly supportedLanguages = ['ruby'];

  match(chain: UnifiedCallChain): PatternMatchResult | null {
    // Detect ActiveRecord patterns
  }
}
```

## Testing

```bash
# Run all unified provider tests
pnpm vitest run packages/core/src/unified-provider

# Run specific test file
pnpm vitest run packages/core/src/unified-provider/__tests__/pattern-matchers.test.ts
```

## License

Apache-2.0
