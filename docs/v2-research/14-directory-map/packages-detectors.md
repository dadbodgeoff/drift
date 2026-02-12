# Complete Directory Map: packages/detectors

Every source file in the detectors package.

```
packages/detectors/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts                                    # Main exports (~1700 lines)
    │
    ├── base/                                       # Base detector classes
    │   ├── index.ts
    │   ├── types.ts
    │   ├── base-detector.ts                        # Core detector interface
    │   ├── regex-detector.ts                       # Regex-based detection
    │   ├── ast-detector.ts                         # AST-based detection
    │   ├── structural-detector.ts                  # Structural pattern detection
    │   ├── learning-detector.ts                    # Learning-capable detection
    │   ├── semantic-detector.ts                    # Semantic analysis detection
    │   ├── semantic-learning-detector.ts           # Combined semantic + learning
    │   └── unified-detector.ts                     # Unified detection pipeline
    │
    ├── registry/                                   # Detector registry
    │   ├── index.ts
    │   ├── types.ts
    │   ├── detector-registry.ts
    │   └── loader.ts
    │
    ├── accessibility/                              # Accessibility patterns
    │
    ├── api/                                        # API patterns
    │
    ├── async/                                      # Async patterns
    │
    ├── auth/
    │   └── token-handling.ts
    │
    ├── components/
    │   ├── index.ts
    │   ├── component-structure.ts / -learning.ts / -semantic.ts
    │   ├── composition.ts / -learning.ts / -semantic.ts
    │   ├── duplicate-detection.ts / -learning.ts / -semantic.ts
    │   ├── near-duplicate.ts / -learning.ts / -semantic.ts
    │   ├── props-patterns.ts / -learning.ts / -semantic.ts
    │   ├── ref-forwarding.ts / -learning.ts / -semantic.ts
    │   ├── state-patterns.ts / -learning.ts / -semantic.ts
    │   └── modal-patterns-semantic.ts
    │
    ├── config/
    │   ├── index.ts
    │   ├── config-validation.ts / -learning.ts / -semantic.ts
    │   ├── constants-detector.ts
    │   ├── default-values.ts / -learning.ts / -semantic.ts
    │   ├── env-naming.ts / -learning.ts
    │   ├── env-config-semantic.ts
    │   ├── environment-detection.ts / -learning.ts / -semantic.ts
    │   ├── feature-flags.ts / -learning.ts / -semantic.ts
    │   ├── required-optional.ts / -learning.ts / -semantic.ts
    │   ├── aspnet/
    │   │   ├── index.ts
    │   │   ├── options-pattern-detector.ts
    │   │   └── options-pattern-semantic.ts
    │   └── laravel/
    │       ├── index.ts
    │       ├── types.ts
    │       ├── config-detector.ts
    │       ├── config-semantic.ts
    │       └── extractors/ (env-extractor.ts)
    │
    ├── contracts/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── backend-endpoint-detector.ts
    │   ├── frontend-type-detector.ts
    │   ├── contract-matcher.ts
    │   ├── schema-parser.ts
    │   ├── spring/ (spring-endpoint-detector.ts, dto-extractor.ts)
    │   ├── laravel/ (laravel-endpoint-detector.ts, extractors/)
    │   ├── django/ (django-endpoint-detector.ts, serializer-extractor.ts, url-extractor.ts, viewset-extractor.ts)
    │   └── aspnet/ (aspnet-endpoint-detector.ts)
    │
    ├── data-access/
    │   ├── index.ts
    │   ├── connection-pooling.ts / -learning.ts / -semantic.ts
    │   ├── dto-patterns.ts / -learning.ts / -semantic.ts
    │   ├── n-plus-one.ts / -learning.ts / -semantic.ts
    │   ├── query-patterns.ts / -learning.ts / -semantic.ts
    │   ├── repository-pattern.ts / -learning.ts / -semantic.ts
    │   ├── transaction-patterns.ts / -learning.ts / -semantic.ts
    │   ├── validation-patterns.ts / -learning.ts / -semantic.ts
    │   ├── boundaries/ (orm-model-detector.ts, query-access-detector.ts, sensitive-field-detector.ts)
    │   ├── aspnet/ (efcore-patterns-detector.ts, repository-pattern-detector.ts, + semantics)
    │   └── laravel/ (eloquent-detector.ts, transaction-semantic.ts, extractors/)
    │
    ├── documentation/
    │   ├── index.ts
    │   ├── deprecation.ts / -learning.ts / -semantic.ts
    │   ├── example-code.ts / -learning.ts / -semantic.ts
    │   ├── jsdoc-patterns.ts / -learning.ts / -semantic.ts
    │   ├── readme-structure.ts / -learning.ts / -semantic.ts
    │   ├── todo-patterns.ts / -learning.ts / -semantic.ts
    │   └── aspnet/ (xml-documentation-detector.ts, xml-documentation-semantic.ts)
    │
    ├── errors/
    │   ├── index.ts
    │   ├── async-errors.ts / -learning.ts / -semantic.ts
    │   ├── circuit-breaker.ts / -learning.ts / -semantic.ts
    │   ├── error-codes.ts / -learning.ts / -semantic.ts
    │   ├── error-logging.ts / -learning.ts / -semantic.ts
    │   ├── error-propagation.ts / -learning.ts / -semantic.ts
    │   ├── exception-hierarchy.ts / -learning.ts / -semantic.ts
    │   ├── try-catch-placement.ts / -learning.ts / -semantic.ts
    │   ├── aspnet/ (exception-patterns-detector.ts, result-pattern-detector.ts, + semantics)
    │   ├── cpp/ (error-handling-detector.ts)
    │   ├── go/ (error-handling-detector.ts)
    │   ├── rust/ (error-handling-detector.ts)
    │   └── laravel/ (exception-detector.ts, errors-semantic.ts, extractors/)
    │
    ├── laravel/
    │   └── index.ts                                # Aggregates all Laravel detectors
    │
    ├── logging/
    │   ├── index.ts
    │   ├── context-fields.ts / -learning.ts / -semantic.ts
    │   ├── correlation-ids.ts / -learning.ts / -semantic.ts
    │   ├── health-checks.ts / -learning.ts / -semantic.ts
    │   ├── log-levels.ts / -learning.ts / -semantic.ts
    │   ├── metric-naming.ts / -learning.ts
    │   ├── metrics-semantic.ts
    │   ├── pii-redaction.ts / -learning.ts / -semantic.ts
    │   ├── structured-format.ts / -learning.ts
    │   ├── structured-logging-semantic.ts
    │   ├── aspnet/ (ilogger-patterns-detector.ts, ilogger-patterns-semantic.ts)
    │   └── laravel/ (logging-detector.ts, logging-semantic.ts, extractors/)
    │
    ├── performance/
    │   ├── index.ts
    │   ├── bundle-size.ts / -learning.ts / -semantic.ts
    │   ├── caching-patterns.ts / -learning.ts / -semantic.ts
    │   ├── code-splitting.ts / -learning.ts / -semantic.ts
    │   ├── debounce-throttle.ts / -learning.ts / -semantic.ts
    │   ├── lazy-loading.ts / -learning.ts / -semantic.ts
    │   ├── memoization.ts / -learning.ts / -semantic.ts
    │   ├── aspnet/ (async-patterns-detector.ts, async-patterns-semantic.ts)
    │   └── laravel/ (performance-detector.ts, performance-semantic.ts, extractors/)
    │
    ├── php/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── attribute-extractor.ts
    │   ├── class-extractor.ts
    │   ├── docblock-extractor.ts
    │   └── method-extractor.ts
    │
    ├── security/
    │   ├── index.ts
    │   ├── csrf-protection.ts / -learning.ts / -semantic.ts
    │   ├── csp-headers.ts / -learning.ts / -semantic.ts
    │   ├── input-sanitization.ts / -learning.ts / -semantic.ts
    │   ├── rate-limiting.ts / -learning.ts / -semantic.ts
    │   ├── secret-management.ts / -learning.ts / -semantic.ts
    │   ├── sql-injection.ts / -learning.ts / -semantic.ts
    │   ├── xss-prevention.ts / -learning.ts / -semantic.ts
    │   ├── aspnet/ (input-validation-detector.ts, input-validation-semantic.ts)
    │   └── laravel/ (security-detector.ts, security-semantic.ts, extractors/)
    │
    ├── spring/
    │   ├── index.ts
    │   ├── keywords.ts
    │   ├── api-learning.ts / api-semantic.ts
    │   ├── async-learning.ts / async-semantic.ts
    │   ├── auth-learning.ts / auth-semantic.ts
    │   ├── config-learning.ts / config-semantic.ts
    │   ├── data-learning.ts / data-semantic.ts
    │   ├── di-learning.ts / di-semantic.ts
    │   ├── errors-learning.ts / errors-semantic.ts
    │   ├── logging-learning.ts / logging-semantic.ts
    │   ├── structural-learning.ts / structural-semantic.ts
    │   ├── testing-learning.ts / testing-semantic.ts
    │   ├── transaction-learning.ts / transaction-semantic.ts
    │   └── validation-learning.ts / validation-semantic.ts
    │
    ├── structural/
    │   ├── index.ts
    │   ├── barrel-exports.ts / -learning.ts / -semantic.ts
    │   ├── circular-deps.ts / -learning.ts / -semantic.ts
    │   ├── co-location.ts / -learning.ts / -semantic.ts
    │   ├── directory-structure.ts / -learning.ts / -semantic.ts
    │   ├── file-naming.ts / -learning.ts / -semantic.ts / -unified.ts
    │   ├── import-ordering.ts / -learning.ts / -semantic.ts
    │   ├── module-boundaries.ts / -learning.ts / -semantic.ts
    │   ├── package-boundaries.ts / -learning.ts / -semantic.ts
    │   ├── aspnet/ (di-registration-detector.ts, di-registration-semantic.ts)
    │   └── laravel/ (di-detector.ts, structural-semantic.ts, extractors/)
    │
    ├── styling/
    │   ├── index.ts
    │   ├── class-naming.ts / -learning.ts / -semantic.ts
    │   ├── color-usage.ts / -learning.ts / -semantic.ts
    │   ├── design-tokens.ts / -learning.ts / -semantic.ts
    │   ├── responsive.ts / -learning.ts / -semantic.ts
    │   ├── spacing-scale.ts / -learning.ts / -semantic.ts
    │   ├── tailwind-patterns.ts / -learning.ts / -semantic.ts
    │   ├── typography.ts / -learning.ts / -semantic.ts
    │   └── z-index-scale.ts / -learning.ts / -semantic.ts
    │
    ├── testing/
    │   ├── index.ts
    │   ├── co-location.ts / -learning.ts
    │   ├── describe-naming.ts / -learning.ts / -semantic.ts
    │   ├── file-naming.ts / -learning.ts
    │   ├── fixture-patterns.ts / -learning.ts / -semantic.ts
    │   ├── mock-patterns.ts / -learning.ts / -semantic.ts
    │   ├── setup-teardown.ts / -learning.ts / -semantic.ts
    │   ├── test-structure.ts / -learning.ts / -semantic.ts
    │   ├── test-co-location-semantic.ts
    │   ├── test-file-naming-semantic.ts
    │   ├── aspnet/ (xunit-patterns-detector.ts, xunit-patterns-semantic.ts)
    │   └── laravel/ (testing-detector.ts, testing-semantic.ts, extractors/)
    │
    ├── types/
    │   ├── index.ts
    │   ├── any-usage.ts / -learning.ts / -semantic.ts
    │   ├── file-location.ts / -learning.ts / -semantic.ts
    │   ├── generic-patterns.ts / -learning.ts / -semantic.ts
    │   ├── interface-vs-type.ts / -learning.ts / -semantic.ts
    │   ├── naming-conventions.ts / -learning.ts / -semantic.ts
    │   ├── type-assertions.ts / -learning.ts / -semantic.ts
    │   ├── utility-types.ts / -learning.ts / -semantic.ts
    │   └── aspnet/ (record-patterns-detector.ts, record-patterns-semantic.ts)
    │
    └── validation/
        └── laravel/ (validation-semantic.ts)
```
