# Rust: Other Analyzers

## Test Topology
`crates/drift-core/src/test_topology/`
- `analyzer.rs`, `types.rs`
- Maps tests to source code, analyzes test coverage
- NAPI: `analyze_test_topology(files) -> JsTestTopologyResult`

## Error Handling
`crates/drift-core/src/error_handling/`
- `analyzer.rs`, `types.rs`
- Detects error boundaries, identifies error handling gaps
- NAPI: `analyze_error_handling(files) -> JsErrorHandlingResult`

## Constants
`crates/drift-core/src/constants/`
- `analyzer.rs`, `extractor.rs`, `secrets.rs`, `types.rs`
- Finds hardcoded values, magic numbers, potential secrets
- NAPI: `analyze_constants(files) -> JsConstantsResult`

## Environment
`crates/drift-core/src/environment/`
- `analyzer.rs`, `extractor.rs`, `types.rs`
- Analyzes environment variable usage patterns
- NAPI: `analyze_environment(files) -> JsEnvironmentResult`

## Wrappers
`crates/drift-core/src/wrappers/`
- `analyzer.rs`, `clusterer.rs`, `detector.rs`, `types.rs`
- Detects framework wrapper patterns, clusters related wrappers
- NAPI: `analyze_wrappers(files) -> JsWrappersResult`

## v2 Notes
All of these have TS counterparts with richer features. The Rust versions handle the heavy lifting; TS adds orchestration and presentation. For v2, enrich the Rust implementations and thin out the TS layer.
