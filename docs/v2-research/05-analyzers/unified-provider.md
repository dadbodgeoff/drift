# Unified Language Provider

## Location
`packages/core/src/unified-provider/`

## What It Is
A composable extraction pipeline that normalizes AST differences across languages into a universal representation, enabling language-agnostic pattern matching. This is the most sophisticated extraction system in Drift — it's the bridge between raw parsing and pattern detection.

## Architecture
```
UnifiedLanguageProvider
├── Parser Registry      → tree-sitter parsers per language
├── Normalizer Registry  → Convert language AST → UnifiedCallChain
└── Matcher Registry     → Detect ORM/framework patterns from chains
```

## Normalizers (9 languages)
Convert language-specific AST into universal `UnifiedCallChain` format:
- `typescript-normalizer.ts` — TypeScript/JavaScript
- `python-normalizer.ts` — Python
- `java-normalizer.ts` — Java
- `csharp-normalizer.ts` — C#
- `php-normalizer.ts` — PHP
- `go-normalizer.ts` — Go
- `rust-normalizer.ts` — Rust
- `cpp-normalizer.ts` — C++
- `base-normalizer.ts` — Abstract base

## ORM/Framework Matchers (20 matchers)
Detect data access patterns from normalized call chains:

| Matcher | ORM/Framework | Languages |
|---------|---------------|-----------|
| `supabase-matcher.ts` | Supabase | TS/JS |
| `prisma-matcher.ts` | Prisma | TS/JS |
| `typeorm-matcher.ts` | TypeORM | TS/JS |
| `sequelize-matcher.ts` | Sequelize | TS/JS |
| `drizzle-matcher.ts` | Drizzle | TS/JS |
| `knex-matcher.ts` | Knex | TS/JS |
| `mongoose-matcher.ts` | Mongoose | TS/JS |
| `django-matcher.ts` | Django ORM | Python |
| `sqlalchemy-matcher.ts` | SQLAlchemy | Python |
| `efcore-matcher.ts` | Entity Framework Core | C# |
| `eloquent-matcher.ts` | Laravel Eloquent | PHP |
| `spring-data-matcher.ts` | Spring Data JPA | Java |
| `gorm-matcher.ts` | GORM | Go |
| `diesel-matcher.ts` | Diesel | Rust |
| `seaorm-matcher.ts` | SeaORM | Rust |
| `sqlx-matcher.ts` | SQLx | Rust |
| `raw-sql-matcher.ts` | Raw SQL | All |
| `database-sql-matcher.ts` | database/sql | Go |
| `base-matcher.ts` | Abstract base | — |
| `matcher-registry.ts` | Registry | — |

## Integration Layer
- `unified-scanner.ts` — Drop-in replacement for `SemanticDataAccessScanner`
- `unified-data-access-adapter.ts` — Bridge to existing `DataAccessPoint` format
- `unified-language-provider.ts` — Main provider class

## Compatibility Layer
- `legacy-extractors.ts` — Backward-compatible extractor aliases
- `legacy-scanner.ts` — Backward-compatible scanner wrapper

## Key Concept: UnifiedCallChain
The universal representation that all normalizers produce. A call chain represents a sequence of method calls (e.g., `supabase.from('users').select('*').eq('id', userId)`). Matchers then analyze these chains to detect ORM patterns and extract table names, operations, and fields.

## v2 Notes
- This entire system is a prime Rust candidate. It's the core extraction pipeline.
- The normalizer pattern (language AST → universal representation) maps perfectly to Rust traits.
- The matcher pattern (universal chain → detected pattern) is pure data transformation.
- 20 ORM matchers is impressive coverage — must be preserved in v2.
- Single parse pass (extract call graph + data access simultaneously) is the right architecture.
