# Complete Directory Map: Rust Crates

Every file in the Rust crates, listed for recreation reference.

## crates/

```
crates/
├── Cargo.toml                          # Workspace config (resolver=2, members: drift-core, drift-napi)
├── Cargo.lock                          # Dependency lock
├── README.md                           # Crates documentation
│
├── drift-core/
│   ├── Cargo.toml                      # Core crate config (tree-sitter, rayon, rusqlite, etc.)
│   ├── benches/
│   │   ├── full_pipeline.rs            # Full pipeline benchmark
│   │   └── parsing.rs                  # Parsing benchmark
│   └── src/
│       ├── lib.rs                      # Crate root (module declarations + re-exports)
│       ├── scanner/
│       │   ├── mod.rs                  # Scanner module
│       │   ├── walker.rs               # Parallel file walking (rayon + walkdir)
│       │   ├── ignores.rs              # Ignore pattern handling (.gitignore, .driftignore)
│       │   └── types.rs                # ScanConfig, ScanResult, FileInfo, ScanStats
│       ├── parsers/
│       │   ├── mod.rs                  # Parser module
│       │   ├── manager.rs              # Parser manager (language detection, selection)
│       │   ├── typescript.rs           # TypeScript/JavaScript parser
│       │   ├── python.rs               # Python parser
│       │   ├── java.rs                 # Java parser
│       │   ├── csharp.rs               # C# parser
│       │   ├── php.rs                  # PHP parser
│       │   ├── go.rs                   # Go parser
│       │   ├── rust_lang.rs            # Rust parser
│       │   ├── cpp.rs                  # C++ parser
│       │   ├── c.rs                    # C parser
│       │   └── types.rs                # ParseResult, FunctionInfo, ClassInfo, ImportInfo, etc.
│       ├── call_graph/
│       │   ├── mod.rs                  # Call graph module
│       │   ├── builder.rs              # Streaming call graph builder
│       │   ├── extractor.rs            # Function/call extraction from ASTs
│       │   ├── universal_extractor.rs  # Language-agnostic extraction
│       │   ├── storage.rs              # SQLite call graph storage
│       │   └── types.rs                # BuildResult, CallGraphShard, FunctionEntry, etc.
│       ├── boundaries/
│       │   ├── mod.rs                  # Boundaries module
│       │   ├── detector.rs             # Data access point detection
│       │   ├── sensitive.rs            # Sensitive field detection
│       │   └── types.rs                # DataAccessPoint, SensitiveField, ORMModel, etc.
│       ├── coupling/
│       │   ├── mod.rs                  # Coupling module
│       │   ├── analyzer.rs             # Module coupling analysis
│       │   └── types.rs                # ModuleMetrics, DependencyCycle, CouplingHotspot, etc.
│       ├── test_topology/
│       │   ├── mod.rs                  # Test topology module
│       │   ├── analyzer.rs             # Test-to-code mapping
│       │   └── types.rs                # TestFile, TestCoverage, TestTopologyResult
│       ├── error_handling/
│       │   ├── mod.rs                  # Error handling module
│       │   ├── analyzer.rs             # Error boundary/gap detection
│       │   └── types.rs                # ErrorBoundary, ErrorGap, ErrorHandlingResult
│       ├── reachability/
│       │   ├── mod.rs                  # Reachability module
│       │   ├── engine.rs               # In-memory reachability engine
│       │   ├── sqlite_engine.rs        # SQLite-backed reachability
│       │   └── types.rs                # ReachabilityResult, CodeLocation, CallPathNode, etc.
│       ├── unified/
│       │   ├── mod.rs                  # Unified analysis module
│       │   ├── analyzer.rs             # Combined pattern detection pipeline
│       │   ├── ast_patterns.rs         # AST-based pattern detection
│       │   ├── string_analyzer.rs      # String/regex pattern detection
│       │   ├── interner.rs             # String interning for memory efficiency
│       │   ├── index.rs                # Pattern indexing
│       │   └── types.rs                # UnifiedResult, DetectedPattern, PatternCategory, etc.
│       ├── constants/
│       │   ├── mod.rs                  # Constants module
│       │   ├── analyzer.rs             # Constants analysis
│       │   ├── extractor.rs            # Value extraction
│       │   ├── secrets.rs              # Secret detection
│       │   └── types.rs                # ConstantInfo, SecretCandidate, MagicNumber, etc.
│       ├── environment/
│       │   ├── mod.rs                  # Environment module
│       │   ├── analyzer.rs             # Environment variable analysis
│       │   ├── extractor.rs            # Env var extraction
│       │   └── types.rs                # EnvAccess, EnvVariable, EnvironmentResult
│       └── wrappers/
│           ├── mod.rs                  # Wrappers module
│           ├── analyzer.rs             # Wrapper analysis
│           ├── clusterer.rs            # Wrapper clustering
│           ├── detector.rs             # Wrapper detection
│           └── types.rs                # WrapperInfo, WrapperCluster, WrappersResult
│
└── drift-napi/
    ├── Cargo.toml                      # NAPI crate config
    ├── build.rs                        # NAPI build script
    ├── package.json                    # npm package config
    ├── package-lock.json               # npm lock
    ├── index.js                        # JS entry point (loads native binary)
    ├── index.d.ts                      # TypeScript type definitions
    ├── drift-native.darwin-arm64.node  # Pre-built macOS ARM binary
    ├── index.darwin-arm64.node         # Pre-built macOS ARM binary (alt)
    ├── benchmark.mjs                   # Benchmark script
    ├── benchmark-parser.mjs            # Parser benchmark
    ├── test.mjs                        # Test script
    ├── test-parser.mjs                 # Parser test
    ├── src/
    │   └── lib.rs                      # NAPI bindings (~2200 lines, 25+ exported functions)
    └── npm/                            # Platform-specific npm packages
        ├── darwin-arm64/package.json
        ├── darwin-x64/package.json
        ├── linux-arm64-gnu/package.json
        ├── linux-arm64-musl/package.json
        ├── linux-x64-gnu/package.json
        ├── linux-x64-musl/package.json
        └── win32-x64-msvc/package.json
```
