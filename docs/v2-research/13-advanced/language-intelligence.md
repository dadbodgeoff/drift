# Language Intelligence

## Location
`packages/core/src/language-intelligence/`

## What It Does
Cross-language semantic normalization. Makes patterns from different languages comparable by normalizing decorators, functions, and framework constructs to a common semantic model.

## Architecture
- `language-intelligence.ts` — Main intelligence engine
- `base-normalizer.ts` — Abstract normalizer base
- `framework-registry.ts` — Framework pattern registry
- `types.ts` — Semantic categories, normalized types

### Normalizers (`normalizers/`)
Per-language normalization:
- `typescript-normalizer.ts`
- `python-normalizer.ts`
- `java-normalizer.ts`
- `csharp-normalizer.ts`
- `php-normalizer.ts`

### Framework Patterns (`frameworks/`)
Framework-specific pattern definitions:
- `spring.ts` — Spring Boot patterns
- `fastapi.ts` — FastAPI patterns
- `nestjs.ts` — NestJS patterns
- `laravel.ts` — Laravel patterns
- `aspnet.ts` — ASP.NET patterns

## v2 Notes
- Normalization logic is pure data transformation — excellent Rust candidate.
- Framework patterns are configuration data — can be Rust structs or config files.
- This is critical for cross-language pattern detection in v2.
