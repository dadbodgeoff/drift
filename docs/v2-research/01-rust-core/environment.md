# Rust Environment Analyzer

## Location
`crates/drift-core/src/environment/`

## Files
- `analyzer.rs` — `EnvironmentAnalyzer`: orchestrates env var extraction and analysis
- `extractor.rs` — `EnvExtractor`: extracts environment variable access from ASTs and source
- `types.rs` — `EnvAccess`, `EnvVariable`, `EnvAccessLocation`, `EnvSensitivity`, `EnvironmentResult`, `EnvironmentStats`
- `mod.rs` — Module exports

## NAPI Exposure
- `analyze_environment(files: Vec<String>) -> JsEnvironmentResult`

## What It Does
- Extracts environment variable access patterns from source code
- Detects access methods: `process.env.X`, `os.environ["X"]`, `getenv("X")`, `env("X")`, `${X}`, `%X%`
- Classifies sensitivity: public, internal, secret, critical
- Tracks where each variable is accessed (file, line, method)
- Identifies variables with default values vs required variables

## Types

```rust
EnvAccess {
    variable_name: String,
    file: String,
    line: u32,
    access_method: String,       // "process.env", "os.environ", "getenv", etc.
    has_default: bool,
    default_value: Option<String>,
    sensitivity: EnvSensitivity,
}

EnvVariable {
    name: String,
    accesses: Vec<EnvAccessLocation>,
    sensitivity: EnvSensitivity,
    has_default_anywhere: bool,
    access_count: usize,
}

EnvAccessLocation {
    file: String,
    line: u32,
    access_method: String,
}

EnvSensitivity { Public, Internal, Secret, Critical }

EnvironmentResult {
    accesses: Vec<EnvAccess>,
    variables: Vec<EnvVariable>,
    stats: EnvironmentStats,
}

EnvironmentStats {
    total_accesses: usize,
    unique_variables: usize,
    by_sensitivity: HashMap<String, usize>,
    by_language: Vec<LanguageCount>,
    files_analyzed: usize,
    duration_ms: u64,
}
```

## Sensitivity Classification
- Critical: `*_SECRET`, `*_PRIVATE_KEY`, `DATABASE_URL`, `*_PASSWORD`
- Secret: `*_KEY`, `*_TOKEN`, `*_AUTH`, `*_CREDENTIAL`
- Internal: `*_HOST`, `*_PORT`, `*_URL`, `*_ENDPOINT`
- Public: everything else

## TS Counterpart
`packages/core/src/environment/` — Additional features:
- `.env` file parsing
- Missing variable detection (used in code but not in .env)
- Environment consistency checking across environments

## v2 Notes
- Rust version handles extraction. TS adds cross-referencing with .env files.
- Could be enhanced with framework-specific detection (Next.js NEXT_PUBLIC_*, Vite VITE_*).
