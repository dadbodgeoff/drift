# Framework-Specific Detectors

## Overview
Drift extends its base detectors with framework-specific implementations for 6 frameworks across multiple languages. These detectors understand framework idioms, decorators, conventions, and patterns.

---

## Spring Boot (Java) — `spring/`

Full-featured Spring Boot detector suite with learning + semantic variants for each category.

| Category | Learning | Semantic |
|----------|----------|----------|
| `api` | ✅ `api-learning.ts` | ✅ `api-semantic.ts` |
| `async` | ✅ `async-learning.ts` | ✅ `async-semantic.ts` |
| `auth` | ✅ `auth-learning.ts` | ✅ `auth-semantic.ts` |
| `config` | ✅ `config-learning.ts` | ✅ `config-semantic.ts` |
| `data` | ✅ `data-learning.ts` | ✅ `data-semantic.ts` |
| `di` | ✅ `di-learning.ts` | ✅ `di-semantic.ts` |
| `errors` | ✅ `errors-learning.ts` | ✅ `errors-semantic.ts` |
| `logging` | ✅ `logging-learning.ts` | ✅ `logging-semantic.ts` |
| `structural` | ✅ `structural-learning.ts` | ✅ `structural-semantic.ts` |
| `testing` | ✅ `testing-learning.ts` | ✅ `testing-semantic.ts` |
| `transaction` | ✅ `transaction-learning.ts` | ✅ `transaction-semantic.ts` |
| `validation` | ✅ `validation-learning.ts` | ✅ `validation-semantic.ts` |

Shared: `keywords.ts` — Spring-specific keyword definitions

Contracts: `contracts/spring/spring-endpoint-detector.ts`, `dto-extractor.ts`

---

## ASP.NET (C#) — distributed across categories

ASP.NET detectors are embedded within each category's `aspnet/` subdirectory.

### Auth (`auth/aspnet/`)
- `authorize-attribute-detector` + semantic
- `identity-patterns-detector` + semantic
- `jwt-patterns-detector` + semantic
- `policy-handlers-detector` + semantic
- `resource-authorization-detector` + semantic

### Other Categories with ASP.NET Extensions
- `config/aspnet/` — ASP.NET configuration patterns
- `contracts/aspnet/` — ASP.NET endpoint detection
- `data-access/aspnet/` — Entity Framework patterns
- `documentation/aspnet/` — XML documentation patterns
- `errors/aspnet/` — ASP.NET error handling
- `logging/aspnet/` — ILogger patterns
- `performance/aspnet/` — ASP.NET performance patterns
- `security/aspnet/` — ASP.NET security patterns
- `structural/aspnet/` — ASP.NET project structure
- `testing/aspnet/` — xUnit/NUnit patterns
- `types/aspnet/` — C# type patterns

---

## Laravel (PHP) — distributed across categories

Laravel detectors are embedded within each category's `laravel/` subdirectory.

### Auth (`auth/laravel/`)
- `auth-detector.ts` + `auth-semantic.ts`
- `extractors/` — Laravel-specific extraction utilities

### Other Categories with Laravel Extensions
- `api/laravel/` — `api-semantic.ts`
- `async/laravel/` — `async-semantic.ts`
- `config/laravel/` — Laravel config patterns
- `contracts/laravel/` — `laravel-endpoint-detector.ts` + extractors
- `data-access/laravel/` — Eloquent patterns
- `errors/laravel/` — Laravel error handling
- `logging/laravel/` — Laravel logging
- `performance/laravel/` — Laravel performance
- `security/laravel/` — Laravel security
- `structural/laravel/` — Laravel project structure
- `testing/laravel/` — PHPUnit/Pest patterns
- `validation/laravel/` — `validation-semantic.ts`

Aggregator: `laravel/index.ts` — Collects all Laravel detectors

---

## Django (Python) — `contracts/django/`

Django-specific contract detection:
- `django-endpoint-detector.ts` — Main endpoint detector
- `url-extractor.ts` — URL pattern extraction from `urls.py`
- `viewset-extractor.ts` — DRF ViewSet extraction
- `serializer-extractor.ts` — DRF Serializer field extraction
- `types.ts` — Django-specific types

---

## Go — distributed across categories

### API (`api/go/`)
Framework-specific route detectors:
- `gin-detector.ts` — Gin framework
- `echo-detector.ts` — Echo framework
- `fiber-detector.ts` — Fiber framework
- `chi-detector.ts` — Chi router
- `net-http-detector.ts` — Standard library `net/http`

### Auth (`auth/go/`)
- `middleware-detector.ts` — Go auth middleware patterns

### Errors (`errors/go/`)
- Go error handling patterns (error wrapping, sentinel errors)

---

## Rust — distributed across categories

### API (`api/rust/`)
Framework-specific route detectors:
- `actix-detector.ts` — Actix-web
- `axum-detector.ts` — Axum
- `rocket-detector.ts` — Rocket
- `warp-detector.ts` — Warp

### Auth (`auth/rust/`)
- `middleware-detector.ts` — Rust auth middleware patterns

### Errors (`errors/rust/`)
- Rust error handling patterns (Result, thiserror, anyhow)

---

## C++ — distributed across categories

### API (`api/cpp/`)
- `crow-detector.ts` — Crow framework
- `boost-beast-detector.ts` — Boost.Beast
- `qt-network-detector.ts` — Qt Network

### Auth (`auth/cpp/`)
- `middleware-detector.ts` — C++ auth middleware patterns

### Errors (`errors/cpp/`)
- C++ error handling patterns (exceptions, error codes)

---

## PHP Utilities (`php/`)

Shared extraction utilities used by Laravel and other PHP detectors:
- `class-extractor.ts` — PHP class parsing
- `method-extractor.ts` — PHP method parsing
- `attribute-extractor.ts` — PHP 8 attribute parsing
- `docblock-extractor.ts` — PHPDoc block parsing
- `types.ts` — Comprehensive PHP type definitions (classes, interfaces, traits, enums, methods, properties, attributes, docblocks, namespaces)
