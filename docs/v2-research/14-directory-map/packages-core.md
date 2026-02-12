# Complete Directory Map: packages/core

Every source file in the core package (excluding tests).

```
packages/core/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── drift-napi.darwin-arm64.node        # Pre-built NAPI binary
├── drift-native.darwin-arm64.node      # Pre-built native binary
└── src/
    ├── index.ts                        # Main exports (~2000 lines)
    │
    ├── analyzers/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── ast-analyzer.ts             # AST-level analysis
    │   ├── type-analyzer.ts            # Type system analysis
    │   ├── semantic-analyzer.ts        # Semantic analysis
    │   └── flow-analyzer.ts            # Control/data flow analysis
    │
    ├── audit/                          # Audit system
    │
    ├── boundaries/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── boundary-scanner.ts         # Boundary scanning
    │   ├── boundary-store.ts           # Boundary persistence
    │   ├── data-access-learner.ts      # Learning from data access patterns
    │   ├── security-prioritizer.ts     # Risk scoring
    │   ├── table-name-validator.ts     # Table name validation
    │   └── field-extractors/
    │       ├── index.ts
    │       ├── types.ts
    │       ├── prisma-extractor.ts     # Prisma ORM
    │       ├── django-extractor.ts     # Django ORM
    │       ├── sqlalchemy-extractor.ts # SQLAlchemy
    │       ├── supabase-extractor.ts   # Supabase
    │       ├── gorm-extractor.ts       # GORM (Go)
    │       ├── diesel-extractor.ts     # Diesel (Rust)
    │       └── raw-sql-extractor.ts    # Raw SQL
    │
    ├── call-graph/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── streaming-builder.ts        # Streaming construction
    │   ├── unified-provider.ts         # Unified storage access
    │   ├── demo.ts
    │   ├── analysis/
    │   │   ├── index.ts
    │   │   ├── graph-builder.ts        # Graph construction
    │   │   ├── reachability.ts         # Reachability analysis
    │   │   ├── path-finder.ts          # Path finding
    │   │   ├── impact-analyzer.ts      # Impact analysis
    │   │   ├── dead-code-detector.ts   # Dead code detection
    │   │   └── coverage-analyzer.ts    # Coverage analysis
    │   ├── enrichment/
    │   │   ├── index.ts
    │   │   ├── types.ts
    │   │   ├── enrichment-engine.ts    # Enrichment pipeline
    │   │   ├── sensitivity-classifier.ts
    │   │   ├── impact-scorer.ts
    │   │   └── remediation-generator.ts
    │   ├── extractors/
    │   │   ├── index.ts
    │   │   ├── types.ts
    │   │   ├── base-extractor.ts
    │   │   ├── hybrid-extractor-base.ts
    │   │   ├── data-access-extractor.ts
    │   │   ├── semantic-data-access-scanner.ts
    │   │   ├── typescript-extractor.ts
    │   │   ├── typescript-hybrid-extractor.ts
    │   │   ├── typescript-data-access-extractor.ts
    │   │   ├── python-extractor.ts
    │   │   ├── python-hybrid-extractor.ts
    │   │   ├── python-data-access-extractor.ts
    │   │   ├── java-extractor.ts
    │   │   ├── java-hybrid-extractor.ts
    │   │   ├── java-data-access-extractor.ts
    │   │   ├── csharp-extractor.ts
    │   │   ├── csharp-hybrid-extractor.ts
    │   │   ├── csharp-data-access-extractor.ts
    │   │   ├── php-extractor.ts
    │   │   ├── php-hybrid-extractor.ts
    │   │   ├── php-data-access-extractor.ts
    │   │   ├── go-extractor.ts
    │   │   ├── go-hybrid-extractor.ts
    │   │   ├── go-data-access-extractor.ts
    │   │   ├── rust-extractor.ts
    │   │   ├── rust-hybrid-extractor.ts
    │   │   ├── rust-data-access-extractor.ts
    │   │   ├── cpp-hybrid-extractor.ts
    │   │   ├── cpp-data-access-extractor.ts
    │   │   └── regex/                  # Regex fallback extractors
    │   └── store/
    │       ├── index.ts
    │       └── call-graph-store.ts
    │
    ├── config/                         # Configuration loading/validation
    │   └── index.ts
    │
    ├── constants/
    │   ├── analysis/
    │   ├── extractors/
    │   │   └── regex/
    │   ├── integration/
    │   └── store/
    │
    ├── constraints/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── extraction/
    │   │   ├── index.ts
    │   │   ├── invariant-detector.ts
    │   │   └── constraint-synthesizer.ts
    │   ├── store/
    │   │   └── constraint-store.ts
    │   └── verification/
    │       ├── index.ts
    │       └── constraint-verifier.ts
    │
    ├── context/                        # Context building
    │
    ├── cpp/
    │   └── index.ts                    # CppAnalyzer
    │
    ├── decisions/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── analyzer/
    │   │   ├── index.ts
    │   │   └── decision-mining-analyzer.ts
    │   ├── extractors/
    │   │   ├── index.ts
    │   │   ├── base-commit-extractor.ts
    │   │   ├── typescript-commit-extractor.ts
    │   │   ├── python-commit-extractor.ts
    │   │   ├── java-commit-extractor.ts
    │   │   ├── csharp-commit-extractor.ts
    │   │   └── php-commit-extractor.ts
    │   └── git/
    │       ├── index.ts
    │       ├── types.ts
    │       ├── git-walker.ts
    │       ├── commit-parser.ts
    │       └── diff-analyzer.ts
    │
    ├── dna/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── dna-analyzer.ts
    │   ├── dna-store.ts
    │   ├── health-calculator.ts
    │   ├── mutation-detector.ts
    │   ├── playbook-generator.ts
    │   ├── ai-context.ts
    │   └── gene-extractors/
    │       ├── index.ts
    │       ├── base-extractor.ts
    │       ├── api-response-format.ts
    │       ├── error-response-format.ts
    │       ├── logging-format.ts
    │       ├── config-pattern.ts
    │       ├── spacing-philosophy.ts
    │       ├── theming.ts
    │       ├── variant-handling.ts
    │       ├── responsive-approach.ts
    │       ├── animation-approach.ts
    │       └── state-styling.ts
    │
    ├── environment/
    │   └── extractors/
    │
    ├── error-handling/
    │   └── index.ts                    # ErrorHandlingAnalyzer
    │
    ├── go/
    │   └── index.ts                    # GoAnalyzer
    │
    ├── java/                           # Java-specific analysis
    │
    ├── lake/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── index-store.ts
    │   ├── query-engine.ts
    │   ├── view-materializer.ts
    │   ├── view-store.ts
    │   ├── pattern-shard-store.ts
    │   ├── callgraph-shard-store.ts
    │   ├── security-shard-store.ts
    │   ├── examples-store.ts
    │   └── manifest-store.ts
    │
    ├── language-intelligence/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── language-intelligence.ts
    │   ├── base-normalizer.ts
    │   ├── framework-registry.ts
    │   ├── normalizers/
    │   │   ├── index.ts
    │   │   ├── typescript-normalizer.ts
    │   │   ├── python-normalizer.ts
    │   │   ├── java-normalizer.ts
    │   │   ├── csharp-normalizer.ts
    │   │   └── php-normalizer.ts
    │   └── frameworks/
    │       ├── index.ts
    │       ├── spring.ts
    │       ├── fastapi.ts
    │       ├── nestjs.ts
    │       ├── laravel.ts
    │       └── aspnet.ts
    │
    ├── learning/
    │   ├── index.ts
    │   ├── types.ts
    │   └── learning-store.ts
    │
    ├── licensing/                      # License detection
    │
    ├── manifest/                       # Pattern location discovery
    │   └── index.ts
    │
    ├── matcher/
    │   ├── types.ts                    # PatternMatch, ConfidenceScore, etc.
    │   └── outlier-detector.ts         # Statistical outlier detection
    │
    ├── module-coupling/
    │   └── index.ts                    # ModuleCouplingAnalyzer
    │
    ├── native/
    │   ├── index.ts
    │   └── native-adapters.ts          # Adapters wrapping NAPI calls
    │
    ├── parsers/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── base-parser.ts
    │   ├── parser-manager.ts
    │   ├── typescript-parser.ts
    │   ├── python-parser.ts
    │   ├── css-parser.ts
    │   ├── json-parser.ts
    │   ├── markdown-parser.ts
    │   └── tree-sitter/
    │       ├── index.ts
    │       ├── types.ts
    │       ├── config.ts
    │       ├── loader.ts
    │       ├── typescript-loader.ts
    │       ├── csharp-loader.ts
    │       ├── java-loader.ts
    │       ├── php-loader.ts
    │       ├── go-loader.ts
    │       ├── cpp-loader.ts
    │       ├── rust-loader.ts
    │       ├── tree-sitter-python-parser.ts
    │       ├── python-ast-converter.ts
    │       ├── tree-sitter-csharp-parser.ts
    │       ├── csharp-ast-converter.ts
    │       ├── tree-sitter-java-parser.ts
    │       ├── tree-sitter-php-parser.ts
    │       ├── tree-sitter-go-parser.ts
    │       ├── tree-sitter-cpp-parser.ts
    │       ├── tree-sitter-rust-parser.ts
    │       ├── java/                   # Java-specific parsing
    │       └── pydantic/               # Pydantic model parsing
    │
    ├── patterns/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── errors.ts
    │   ├── repository.ts
    │   ├── service.ts
    │   ├── adapters/
    │   │   ├── index.ts
    │   │   ├── pattern-store-adapter.ts
    │   │   └── service-factory.ts
    │   └── impl/
    │       ├── index.ts
    │       ├── file-repository.ts
    │       ├── memory-repository.ts
    │       ├── cached-repository.ts
    │       ├── unified-file-repository.ts
    │       ├── pattern-service.ts
    │       └── repository-factory.ts
    │
    ├── php/                            # PHP-specific analysis
    │
    ├── python/
    │   └── index.ts                    # PythonAnalyzer
    │
    ├── quality-gates/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── orchestrator/
    │   │   ├── index.ts
    │   │   ├── gate-orchestrator.ts
    │   │   ├── gate-registry.ts
    │   │   ├── parallel-executor.ts
    │   │   └── result-aggregator.ts
    │   ├── gates/
    │   │   ├── index.ts
    │   │   ├── base-gate.ts
    │   │   ├── pattern-compliance/
    │   │   ├── security-boundary/
    │   │   ├── regression-detection/
    │   │   ├── constraint-verification/
    │   │   ├── impact-simulation/
    │   │   └── custom-rules/
    │   ├── policy/
    │   │   ├── index.ts
    │   │   ├── policy-loader.ts
    │   │   ├── policy-evaluator.ts
    │   │   └── default-policies.ts
    │   ├── reporters/
    │   │   ├── index.ts
    │   │   ├── reporter-interface.ts
    │   │   ├── github-reporter.ts
    │   │   ├── gitlab-reporter.ts
    │   │   ├── sarif-reporter.ts
    │   │   ├── json-reporter.ts
    │   │   └── text-reporter.ts
    │   └── store/
    │       ├── index.ts
    │       ├── gate-run-store.ts
    │       └── snapshot-store.ts
    │
    ├── rules/
    │   ├── types.ts
    │   ├── evaluator.ts
    │   ├── rule-engine.ts
    │   └── variant-manager.ts
    │
    ├── rust/
    │   └── index.ts                    # RustAnalyzer
    │
    ├── scanner/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── file-walker.ts
    │   ├── native-scanner.ts           # Wraps Rust NAPI scanner
    │   ├── dependency-graph.ts
    │   ├── change-detector.ts
    │   ├── default-ignores.ts
    │   ├── worker-pool.ts
    │   ├── threaded-worker-pool.ts
    │   └── file-processor-worker.ts
    │
    ├── services/                       # Service layer
    │
    ├── simulation/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── simulation-engine.ts
    │   ├── approach-generator.ts
    │   ├── scorers/
    │   │   ├── index.ts
    │   │   ├── friction-scorer.ts
    │   │   ├── impact-scorer.ts
    │   │   ├── pattern-alignment-scorer.ts
    │   │   └── security-scorer.ts
    │   └── language-strategies/
    │       ├── index.ts
    │       ├── types.ts
    │       ├── typescript-strategies.ts
    │       ├── python-strategies.ts
    │       ├── java-strategies.ts
    │       ├── csharp-strategies.ts
    │       └── php-strategies.ts
    │
    ├── speculative/
    │   └── templates/
    │
    ├── storage/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── schema.sql
    │   ├── migration.ts
    │   ├── unified-store.ts
    │   ├── store-factory.ts
    │   ├── sync-service.ts
    │   ├── hybrid-pattern-store.ts
    │   ├── hybrid-contract-store.ts
    │   └── repositories/
    │       ├── index.ts
    │       ├── pattern-repository.ts
    │       ├── contract-repository.ts
    │       ├── audit-repository.ts
    │       ├── boundary-repository.ts
    │       ├── callgraph-repository.ts
    │       ├── constraint-repository.ts
    │       ├── dna-repository.ts
    │       ├── environment-repository.ts
    │       └── test-topology-repository.ts
    │
    ├── store/
    │   ├── types.ts
    │   ├── pattern-store.ts            # JSON-based pattern store
    │   ├── contract-store.ts           # JSON-based contract store
    │   ├── history-store.ts            # Pattern history
    │   ├── cache-manager.ts            # In-memory cache
    │   ├── project-registry.ts         # Multi-project management
    │   └── project-config.ts           # Project configuration
    │
    ├── telemetry/                      # Telemetry collection
    │
    ├── test-topology/
    │   ├── index.ts
    │   └── extractors/
    │       └── regex/
    │
    ├── typescript/
    │   └── index.ts                    # TypeScriptAnalyzer
    │
    ├── types/
    │   ├── index.ts                    # Main type exports
    │   ├── contracts.ts                # Contract types
    │   └── java-type-mapping.ts        # Java type mapping
    │
    ├── unified-provider/
    │   ├── compat/
    │   ├── docs/
    │   ├── integration/
    │   ├── matching/
    │   ├── normalization/
    │   ├── parsing/
    │   └── provider/
    │
    ├── workspace/                      # Workspace management
    │
    ├── wpf/
    │   ├── index.ts
    │   ├── extractors/
    │   │   └── regex/
    │   ├── integration/
    │   └── linkers/
    │
    └── wrappers/
        ├── clustering/
        ├── detection/
        ├── export/
        ├── integration/
        └── primitives/
```
