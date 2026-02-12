# Per-Language Analyzers

## Location
`packages/core/src/{language}/` — One directory per language

## What They Are
Language-specific analyzers that extract framework-aware patterns from source code. Each analyzer understands the idioms, frameworks, and conventions of its target language. They produce language-specific types that feed into the universal pattern detection pipeline.

## Directory Map

| Language | Directory | Files | Key Frameworks |
|----------|-----------|-------|----------------|
| TypeScript/JS | `typescript/` | ~8 files | Express, React, Next.js, NestJS, Fastify |
| Python | `python/` | ~4 files | Django, Flask, FastAPI, SQLAlchemy |
| Java | `java/` | ~3 files | Spring Boot, JPA, Hibernate |
| C# | (via unified-provider) | — | ASP.NET, Entity Framework |
| PHP | `php/` | ~4 files | Laravel, Symfony |
| Go | `go/` | 2 files | Gin, Echo, GORM, standard library |
| Rust | `rust/` | 2 files + test | Actix, Axum, Diesel, SeaORM |
| C++ | `cpp/` | 2 files | STL, Qt, Boost |
| WPF/XAML | `wpf/` | ~8 files | WPF, MVVM, XAML bindings |

---

## TypeScript/JavaScript Analyzer
`packages/core/src/typescript/`

### What It Extracts
- **Routes** — Express/Fastify/NestJS route definitions with method, path, middleware
- **Components** — React/Vue/Svelte component definitions with props, hooks, state
- **Hooks** — Custom React hooks with dependencies and wrapped primitives
- **Error patterns** — try/catch, error boundaries, error middleware
- **Data access** — Prisma, TypeORM, Sequelize, Drizzle, Knex, Mongoose, Supabase calls
- **Decorators** — NestJS/TypeORM decorators with metadata

### Types
```typescript
TSRoute { method, path, handler, middleware[], file, line }
TSComponent { name, props[], hooks[], state[], file, line, isExported }
TSHook { name, dependencies[], wraps[], file, line }
TSErrorPattern { type, handler, catches[], file, line }
TSDataAccessPoint { table, operation, orm, file, line }
TSDecorator { name, args[], target, file, line }
```

---

## Python Analyzer
`packages/core/src/python/`

### What It Extracts
- **Routes** — Django URL patterns, Flask/FastAPI route decorators
- **Error handling** — try/except patterns, custom exception classes
- **Data access** — Django ORM, SQLAlchemy, raw SQL
- **Decorators** — @app.route, @login_required, @pytest.fixture
- **Async patterns** — async def, await, asyncio usage

### Types
```typescript
PyRoute { method, path, view_function, decorators[], file, line }
PyErrorPattern { exception_types[], handler, file, line }
PyDataAccessPoint { model, operation, orm, file, line }
PyDecorator { name, args[], file, line }
```

---

## Go Analyzer
`packages/core/src/go/`

### What It Extracts
- **Routes** — Gin/Echo/Chi/standard http handler registrations
- **Error handling** — `if err != nil` patterns, error wrapping, sentinel errors
- **Interfaces** — Interface definitions with method sets
- **Data access** — GORM, sqlx, database/sql calls
- **Goroutines** — go statements, channel operations, sync primitives

### Types
```typescript
GoRoute { method, path, handler, middleware[], file, line }
GoErrorPattern { check_type, wraps, file, line }
GoInterface { name, methods[], file, line, is_exported }
GoGoroutine { function, has_waitgroup, has_channel, file, line }
```

---

## Rust Analyzer
`packages/core/src/rust/`

### What It Extracts
- **Routes** — Actix/Axum route macros and handler functions
- **Error patterns** — Result<T,E> usage, ? operator, custom error types
- **Traits** — Trait definitions and implementations
- **Async functions** — async fn, .await usage, tokio/async-std
- **Crates** — External crate usage and feature flags

### Types
```typescript
RustRoute { method, path, handler, guards[], file, line }
RustErrorPattern { error_type, uses_question_mark, file, line }
RustTrait { name, methods[], implementations[], file, line }
RustAsyncFunction { name, runtime, file, line }
```

---

## C++ Analyzer
`packages/core/src/cpp/`

### What It Extracts
- **Classes** — Class hierarchies, virtual methods, constructors/destructors
- **Memory patterns** — new/delete, smart pointers, RAII patterns
- **Templates** — Template definitions, specializations
- **Virtual methods** — Virtual/override/final methods, vtable patterns

### Types
```typescript
CppClass { name, bases[], virtual_methods[], file, line }
CppMemoryPattern { type, pointer_kind, file, line }
CppTemplate { name, parameters[], specializations[], file, line }
CppVirtualMethod { name, class_name, is_pure, is_override, file, line }
```

---

## WPF/XAML Analyzer
`packages/core/src/wpf/` — The most complex language analyzer (~8 files)

### Architecture
```
wpf/
├── wpf-analyzer.ts              # Main analyzer
├── types.ts                     # WPF-specific types
├── extractors/
│   ├── XamlHybridExtractor      # XAML parsing (tree-sitter + regex)
│   ├── ViewModelHybridExtractor # ViewModel extraction
│   └── CodeBehindLinker         # Links .xaml to .xaml.cs
├── linkers/
│   ├── DataContextResolver      # Resolves DataContext bindings
│   └── ViewModelLinker          # Links Views to ViewModels
└── integration/
    └── Call graph integration    # WPF-aware call graph
```

### What It Extracts
- **XAML parsing** — Controls, bindings, resources, styles, templates
- **ViewModel linking** — Maps Views to ViewModels via DataContext
- **MVVM analysis** — Command bindings, INotifyPropertyChanged, RelayCommand
- **Binding errors** — Detects broken bindings (property doesn't exist on ViewModel)
- **Resource dictionaries** — Shared styles, templates, converters
- **Dependency properties** — Custom dependency property declarations
- **Data flow** — Traces data flow through XAML bindings to ViewModel properties

### Unique Capabilities
- Parses XAML as a tree-sitter grammar (with regex fallback)
- Resolves `{Binding Path}` expressions to ViewModel properties
- Detects MVVM violations (code-behind with business logic)
- Integrates with call graph for WPF-specific call chains

---

## How Language Analyzers Integrate

```
Source File
  │
  ├─ Parser (tree-sitter) → ParseResult
  │
  ├─ Language Analyzer → Language-specific types (routes, components, etc.)
  │
  ├─ Unified Provider → UnifiedCallChain (normalized)
  │
  └─ Detectors → Patterns (with confidence)
```

Language analyzers run AFTER parsing but BEFORE pattern detection. They provide the semantic understanding that makes pattern detection framework-aware.

## v2 Notes
- Each language analyzer should become a Rust module with tree-sitter queries
- WPF is the most complex — XAML parsing needs dedicated tree-sitter grammar
- Framework detection (Spring, Laravel, Django, etc.) should be configurable plugins
- The analyzer → unified provider → detector pipeline should be a single Rust pass
- C# analyzer is currently handled entirely through unified-provider (no dedicated directory)
