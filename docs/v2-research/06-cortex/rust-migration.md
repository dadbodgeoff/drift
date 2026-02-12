# Cortex Rust Migration Analysis

## Current State
Cortex is 100% TypeScript (~150 source files). The codebase is well-structured with clean interfaces (`IMemoryStorage`, `IEmbeddingProvider`, `ICausalStorage`) that map naturally to Rust traits.

## Should Cortex Be Rebuilt in Rust?

**Yes, with a phased approach.** Here's why:

### Arguments FOR Rust

1. **Performance-critical paths exist**: Embedding generation, vector similarity search, graph traversal, batch decay calculation, and consolidation all benefit from Rust's speed. These are called frequently and at scale.

2. **Memory complexity is growing**: With 23 memory types, causal graphs, contradiction propagation, and prediction systems, the data structures are getting complex. Rust's type system (enums, pattern matching, ownership) handles this better than TypeScript.

3. **SQLite is already C**: The storage layer wraps a C library (`better-sqlite3`). Rust's `rusqlite` is a more natural fit with better error handling and no Node.js overhead.

4. **Concurrency**: Consolidation, validation, and prediction can run in parallel. Rust's `rayon` and `tokio` handle this safely without the GIL-like constraints of Node.js.

5. **Embedding inference**: If you're running local models (Transformers.js), Rust + `candle` or `ort` (ONNX Runtime) gives 2-10x speedup.

6. **The rest of the codebase is going Rust**: Consistency matters. Having Cortex in Rust means one build system, one deployment, one language to maintain.

### Arguments AGAINST (or for caution)

1. **LLM integration**: Some features (principle extraction, narrative generation) may need LLM calls. These are inherently async and language-agnostic — the bottleneck is the API, not the language.

2. **Rapid iteration**: TypeScript is faster to prototype in. If Cortex features are still evolving rapidly, premature Rust migration could slow development.

3. **MCP tool layer**: The 33 MCP tools are thin JSON-RPC wrappers. They can stay in TypeScript and call Rust via FFI/NAPI.

---

## Recommended Migration Strategy

### Phase 1: Core Storage + Embeddings (Highest ROI)
Port the hot path first:
- `storage/` → `rusqlite` + `sqlite-vec` (or `faiss-rs`)
- `embeddings/` → `candle` or `ort` for model inference
- `cache/` → `moka` + `mmap`
- `decay/` → Pure math, trivial port
- `utils/` → Standard Rust crates

**Expose via NAPI** so existing TypeScript orchestrators can call Rust.

### Phase 2: Graph + Analysis
- `causal/` → `petgraph` for graph operations
- `contradiction/` → Rust pattern matching
- `compression/` → String manipulation + token counting
- `validation/` → Filesystem + hashing

### Phase 3: Orchestration
- `retrieval/` → Full retrieval pipeline in Rust
- `consolidation/` → 5-phase pipeline
- `prediction/` → Signal gathering + prediction
- `learning/` → Correction analysis (except LLM parts)

### Phase 4: Full Migration
- `orchestrators/` → CortexV2 as Rust public API
- `session/` → Session management
- `generation/` → Context building
- `privacy/` → Regex sanitization
- `why/` → Why synthesis
- `linking/` → Entity linking

---

## Rust Crate Structure

```
crates/cortex/
├── cortex-core/        # Types, traits, base memory
├── cortex-storage/     # SQLite storage + migrations
├── cortex-embeddings/  # Embedding providers + cache
├── cortex-retrieval/   # Retrieval engine + scoring
├── cortex-causal/      # Causal graph + inference + narrative
├── cortex-learning/    # Correction analysis + calibration
├── cortex-decay/       # Decay calculation + half-lives
├── cortex-validation/  # 4-dimension validation
├── cortex-compression/ # Hierarchical compression
├── cortex-prediction/  # Predictive preloading
├── cortex-session/     # Session management
├── cortex-privacy/     # PII/secret sanitization
└── cortex-napi/        # NAPI bindings for TypeScript interop
```

## Key Rust Crate Mappings

| TypeScript | Rust Crate |
|-----------|------------|
| `better-sqlite3` | `rusqlite` |
| `sqlite-vec` | `sqlite-vec` (C ext) or `faiss-rs` |
| `@xenova/transformers` | `candle` or `ort` |
| UUID generation | `uuid` |
| Content hashing | `blake3` or `sha2` |
| Regex (privacy) | `regex` |
| Graph operations | `petgraph` |
| LRU cache | `moka` |
| Async runtime | `tokio` |
| Parallel iteration | `rayon` |
| Serialization | `serde` + `serde_json` |
| Time handling | `chrono` |
| Token counting | `tiktoken-rs` |

## Interface Boundaries

The cleanest migration boundary is at the `IMemoryStorage`, `IEmbeddingProvider`, and `ICausalStorage` interfaces. These become Rust traits:

```rust
#[async_trait]
pub trait MemoryStorage: Send + Sync {
    async fn create(&self, memory: Memory) -> Result<String>;
    async fn read(&self, id: &str) -> Result<Option<Memory>>;
    async fn update(&self, id: &str, updates: MemoryUpdate) -> Result<()>;
    async fn delete(&self, id: &str) -> Result<()>;
    async fn similarity_search(&self, embedding: &[f32], limit: usize) -> Result<Vec<Memory>>;
    // ...
}
```

## Performance Expectations

| Operation | TypeScript | Rust (estimated) |
|-----------|-----------|-----------------|
| Embedding (local) | 50-200ms | 10-50ms |
| Vector search (1000 memories) | 20-50ms | 2-10ms |
| Batch decay (500 memories) | 10-30ms | 1-5ms |
| Graph traversal (depth 5) | 30-100ms | 5-20ms |
| Consolidation (100 episodes) | 1-5s | 200ms-1s |
| Privacy sanitization | 5-20ms | 1-5ms |

## Migration Risks

1. **NAPI complexity**: FFI boundaries add complexity. Use `napi-rs` for ergonomic bindings.
2. **Async mismatch**: Rust's async (tokio) and Node.js's event loop need careful bridging.
3. **Testing**: Need to maintain test parity during migration. Run both implementations in parallel.
4. **Schema compatibility**: SQLite schema must remain compatible during transition.
5. **LLM integration**: Keep LLM-dependent features (principle extraction, some narrative generation) behind a service boundary that works in both languages.

## Recommendation

Start Phase 1 now. The storage + embeddings layer is the highest-ROI target with the cleanest interface boundary. Use NAPI bindings so the existing TypeScript orchestrators continue working unchanged. This gives you immediate performance gains while the rest of the migration proceeds incrementally.
