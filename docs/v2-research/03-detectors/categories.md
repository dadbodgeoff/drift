# Detector Categories — Complete Inventory

## Location
`packages/detectors/src/`

16 categories, ~100+ base detectors, each with learning + semantic variants.

---

## 1. Security (`security/`)
Detects security patterns and vulnerabilities.

| Detector | Base | Learning | Semantic | Tests |
|----------|------|----------|----------|-------|
| `csrf-protection` | ✅ | ✅ | ✅ | ✅ |
| `csp-headers` | ✅ | ✅ | ✅ | ✅ |
| `input-sanitization` | ✅ | ✅ | ✅ | ✅ |
| `rate-limiting` | ✅ | ✅ | ✅ | ✅ |
| `secret-management` | ✅ | ✅ | ✅ | ✅ |
| `sql-injection` | ✅ | ✅ | ✅ | ✅ |
| `xss-prevention` | ✅ | ✅ | ✅ | ✅ |

Framework extensions: Laravel (`laravel/`), ASP.NET (`aspnet/`)

---

## 2. Auth (`auth/`)
Authentication and authorization pattern detection.

| Detector | Base | Learning | Semantic |
|----------|------|----------|----------|
| `audit-logging` | ✅ | ✅ | ✅ |
| `middleware-usage` | ✅ | ✅ | ✅ |
| `permission-checks` | ✅ | ✅ | ✅ |
| `rbac-patterns` | ✅ | ✅ | ✅ |
| `resource-ownership` | ✅ | ✅ | ✅ |
| `token-handling` | ✅ | ✅ | ✅ |

Framework extensions:
- ASP.NET: `authorize-attribute`, `identity-patterns`, `jwt-patterns`, `policy-handlers`, `resource-authorization` (each with semantic variant)
- Laravel: `auth-detector` + `auth-semantic`
- Go: `middleware-detector`
- C++: `middleware-detector`
- Rust: `middleware-detector`

---

## 3. Errors (`errors/`)
Error handling pattern detection.

| Detector | Base | Learning | Semantic |
|----------|------|----------|----------|
| `async-errors` | ✅ | ✅ | ✅ |
| `circuit-breaker` | ✅ | ✅ | ✅ |
| `error-codes` | ✅ | ✅ | ✅ |
| `error-logging` | ✅ | ✅ | ✅ |
| `error-propagation` | ✅ | ✅ | ✅ |
| `exception-hierarchy` | ✅ | ✅ | ✅ |
| `try-catch-placement` | ✅ | ✅ | ✅ |

Framework extensions: Laravel, ASP.NET, C++ (`cpp/`), Go (`go/`), Rust (`rust/`)

---

## 4. API (`api/`)
API pattern detection across multiple languages and frameworks.

| Detector | Base | Learning | Semantic | Tests |
|----------|------|----------|----------|-------|
| `client-patterns` | ✅ | ✅ | — | ✅ |
| `error-format` | ✅ | ✅ | — | ✅ |
| `http-methods` | ✅ | ✅ | — | ✅ |
| `pagination` | ✅ | ✅ | — | ✅ |
| `response-envelope` | ✅ | ✅ | — | ✅ |
| `retry-patterns` | ✅ | ✅ | — | ✅ |
| `route-structure` | ✅ | ✅ | — | ✅ |

Language-specific API detectors:
- **Go**: `gin`, `echo`, `fiber`, `chi`, `net-http`
- **Rust**: `actix`, `axum`, `rocket`, `warp`
- **C++**: `crow`, `boost-beast`, `qt-network`
- **Laravel**: `api-semantic`

---

## 5. Components (`components/`)
UI component pattern detection (React/Vue/Svelte).

| Detector | Base | Learning | Semantic | Tests |
|----------|------|----------|----------|-------|
| `component-structure` | ✅ | ✅ | ✅ | ✅ |
| `composition` | ✅ | ✅ | ✅ | ✅ |
| `duplicate-detection` | ✅ | ✅ | ✅ | ✅ |
| `near-duplicate` | ✅ | ✅ | ✅ | ✅ |
| `props-patterns` | ✅ | ✅ | ✅ | ✅ |
| `ref-forwarding` | ✅ | ✅ | ✅ | ✅ |
| `state-patterns` | ✅ | ✅ | ✅ | ✅ |
| `modal-patterns` | — | — | ✅ | — |

---

## 6. Config (`config/`)
Configuration pattern detection.

| Detector | Base | Learning | Semantic | Tests |
|----------|------|----------|----------|-------|
| `config-validation` | ✅ | ✅ | ✅ | — |
| `constants-detector` | ✅ | — | — | — |
| `default-values` | ✅ | ✅ | ✅ | ✅ |
| `env-naming` | ✅ | ✅ | ✅ | ✅ |
| `environment-detection` | ✅ | ✅ | ✅ | — |
| `feature-flags` | ✅ | ✅ | ✅ | ✅ |
| `required-optional` | ✅ | ✅ | ✅ | ✅ |

Framework extensions: Laravel (`laravel/`), ASP.NET (`aspnet/`)

---

## 7. Contracts (`contracts/`)
Backend↔Frontend API contract detection and matching.

| Detector | Purpose |
|----------|---------|
| `backend-endpoint-detector` | Extracts API endpoints from backend code |
| `frontend-type-detector` | Extracts API calls from frontend code |
| `contract-matcher` | Matches BE endpoints to FE calls, finds mismatches |
| `schema-parser` | Parses API schemas (OpenAPI, etc.) |

Framework-specific endpoint detectors:
- **Spring**: `spring-endpoint-detector`, `dto-extractor`
- **Laravel**: `laravel-endpoint-detector` + extractors
- **Django**: `django-endpoint-detector`, `url-extractor`, `viewset-extractor`, `serializer-extractor`
- **ASP.NET**: `aspnet-endpoint-detector`

See [contracts-system.md](./contracts-system.md) for details.

---

## 8. Data Access (`data-access/`)
Database and data layer pattern detection.

| Detector | Base | Learning | Semantic | Tests |
|----------|------|----------|----------|-------|
| `connection-pooling` | ✅ | ✅ | ✅ | ✅ |
| `dto-patterns` | ✅ | ✅ | ✅ | ✅ |
| `n-plus-one` | ✅ | ✅ | ✅ | ✅ |
| `query-patterns` | ✅ | ✅ | ✅ | ✅ |
| `repository-pattern` | ✅ | ✅ | ✅ | ✅ |
| `transaction-patterns` | ✅ | ✅ | ✅ | ✅ |
| `validation-patterns` | ✅ | ✅ | ✅ | ✅ |

Boundary detectors (`boundaries/`):
- `orm-model-detector` — ORM model usage patterns
- `query-access-detector` — Direct query access patterns
- `sensitive-field-detector` — Sensitive data field detection

Framework extensions: Laravel, ASP.NET

---

## 9. Documentation (`documentation/`)
Documentation pattern detection.

| Detector | Base | Learning | Semantic |
|----------|------|----------|----------|
| `deprecation` | ✅ | ✅ | ✅ |
| `example-code` | ✅ | ✅ | ✅ |
| `jsdoc-patterns` | ✅ | ✅ | ✅ |
| `readme-structure` | ✅ | ✅ | ✅ |
| `todo-patterns` | ✅ | ✅ | ✅ |

Framework extensions: ASP.NET (XML documentation)

---

## 10. Logging (`logging/`)
Logging and observability pattern detection.

| Detector | Base | Learning | Semantic | Tests |
|----------|------|----------|----------|-------|
| `context-fields` | ✅ | ✅ | ✅ | ✅ |
| `correlation-ids` | ✅ | ✅ | ✅ | ✅ |
| `health-checks` | ✅ | ✅ | ✅ | ✅ |
| `log-levels` | ✅ | ✅ | ✅ | ✅ |
| `metric-naming` | ✅ | ✅ | ✅ | ✅ |
| `pii-redaction` | ✅ | ✅ | ✅ | ✅ |
| `structured-format` | ✅ | ✅ | ✅ | ✅ |

Framework extensions: Laravel, ASP.NET

---

## 11. Performance (`performance/`)
Performance pattern detection.

| Detector | Base | Learning | Semantic |
|----------|------|----------|----------|
| `bundle-size` | ✅ | ✅ | ✅ |
| `caching-patterns` | ✅ | ✅ | ✅ |
| `code-splitting` | ✅ | ✅ | ✅ |
| `debounce-throttle` | ✅ | ✅ | ✅ |
| `lazy-loading` | ✅ | ✅ | ✅ |
| `memoization` | ✅ | ✅ | ✅ |

Framework extensions: Laravel, ASP.NET

---

## 12. Structural (`structural/`)
File and directory structure pattern detection.

| Detector | Base | Learning | Semantic | Tests |
|----------|------|----------|----------|-------|
| `barrel-exports` | ✅ | ✅ | ✅ | ✅ |
| `circular-deps` | ✅ | ✅ | ✅ | ✅ |
| `co-location` | ✅ | ✅ | ✅ | ✅ |
| `directory-structure` | ✅ | ✅ | ✅ | ✅ |
| `file-naming` | ✅ | ✅ | ✅ | ✅ |
| `file-naming-unified` | ✅ (unified) | — | — | ✅ |
| `import-ordering` | ✅ | ✅ | ✅ | ✅ |
| `module-boundaries` | ✅ | ✅ | ✅ | ✅ |
| `package-boundaries` | ✅ | ✅ | ✅ | ✅ |

Framework extensions: Laravel, ASP.NET

---

## 13. Styling (`styling/`)
CSS/styling pattern detection.

| Detector | Base | Learning | Semantic | Tests |
|----------|------|----------|----------|-------|
| `class-naming` | ✅ | ✅ | ✅ | ✅ |
| `color-usage` | ✅ | ✅ | ✅ | ✅ |
| `design-tokens` | ✅ | ✅ | ✅ | ✅ |
| `responsive` | ✅ | ✅ | ✅ | ✅ |
| `spacing-scale` | ✅ | ✅ | ✅ | ✅ |
| `tailwind-patterns` | ✅ | ✅ | ✅ | ✅ |
| `typography` | ✅ | ✅ | ✅ | ✅ |
| `z-index-scale` | ✅ | ✅ | ✅ | ✅ |

---

## 14. Testing (`testing/`)
Test pattern detection.

| Detector | Base | Learning | Semantic | Tests |
|----------|------|----------|----------|-------|
| `co-location` | ✅ | ✅ | ✅ | ✅ |
| `describe-naming` | ✅ | ✅ | ✅ | ✅ |
| `file-naming` | ✅ | ✅ | ✅ | ✅ |
| `fixture-patterns` | ✅ | ✅ | ✅ | ✅ |
| `mock-patterns` | ✅ | ✅ | ✅ | ✅ |
| `setup-teardown` | ✅ | ✅ | ✅ | ✅ |
| `test-structure` | ✅ | ✅ | ✅ | ✅ |

Framework extensions: Laravel, ASP.NET

---

## 15. Types (`types/`)
TypeScript type system pattern detection.

| Detector | Base | Learning | Semantic |
|----------|------|----------|----------|
| `any-usage` | ✅ | ✅ | ✅ |
| `file-location` | ✅ | ✅ | ✅ |
| `generic-patterns` | ✅ | ✅ | ✅ |
| `interface-vs-type` | ✅ | ✅ | ✅ |
| `naming-conventions` | ✅ | ✅ | ✅ |
| `type-assertions` | ✅ | ✅ | ✅ |
| `utility-types` | ✅ | ✅ | ✅ |

Framework extensions: ASP.NET

---

## 16. Accessibility (`accessibility/`)
Web accessibility pattern detection.

| Detector | Base | Learning | Semantic |
|----------|------|----------|----------|
| `alt-text` | ✅ | ✅ | ✅ |
| `aria-roles` | ✅ | ✅ | ✅ |
| `focus-management` | ✅ | ✅ | ✅ |
| `heading-hierarchy` | ✅ | ✅ | ✅ |
| `keyboard-nav` | ✅ | ✅ | ✅ |
| `semantic-html` | ✅ | ✅ | ✅ |
