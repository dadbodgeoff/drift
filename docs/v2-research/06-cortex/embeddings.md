# Cortex Embedding System

## Location
`packages/cortex/src/embeddings/`

## Purpose
Converts memory text into 384-dimensional vectors for semantic similarity search. Multi-strategy approach with automatic provider detection and 3-tier caching.

## IEmbeddingProvider Interface
```typescript
interface IEmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;    // 384
  readonly maxTokens: number;
  initialize(): Promise<void>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  isAvailable(): Promise<boolean>;
}
```

## Providers

### Local (`local.ts`)
- Uses `@xenova/transformers` (Transformers.js)
- Runs entirely in-process, no external API
- Good for offline/air-gapped environments

### OpenAI (`openai.ts`)
- Uses OpenAI Embeddings API
- Requires `OPENAI_API_KEY` env var
- Highest quality, but requires network + API key

### Ollama (`ollama.ts`)
- Uses local Ollama instance
- Configurable base URL and model
- Good balance of quality and privacy

### Hybrid (`hybrid/`)
The most sophisticated option — fuses 3 embedding strategies:

#### Lexical (`lexical/`)
- `tokenizer.ts` — Text tokenization
- `tfidf.ts` — TF-IDF scoring
- `embedder.ts` — TF-IDF based embeddings
- Good for exact keyword matching

#### Semantic (`semantic/`)
- `codebert.ts` — CodeBERT model integration
- `model-loader.ts` — Model loading/caching
- `embedder.ts` — Semantic embedding generation
- Understands code semantics (variable names, function purposes)

#### Structural (`structural/`)
- `ast-analyzer.ts` — AST parsing
- `feature-extractor.ts` — Structural feature extraction
- `pattern-classifier.ts` — Pattern classification from structure
- `embedder.ts` — Structure-based embeddings
- Captures code structure (nesting, complexity, patterns)

#### Fusion (`hybrid/`)
- `embedder.ts` — Orchestrates all 3 strategies
- `fusion.ts` — Combines embeddings with weighted fusion
- `weights.ts` — Strategy weight configuration

## Auto-Detection Priority
`autoDetectEmbeddingProvider()` tries in order:
1. OpenAI (if `OPENAI_API_KEY` set)
2. Ollama (if running locally)
3. Local (Transformers.js fallback)

## Caching System (`cache/`)

### L1: Memory Cache (`l1-memory.ts`)
- In-process Map
- Fastest, but lost on restart
- LRU eviction

### L2: SQLite Cache (`l2-sqlite.ts`)
- Persisted in SQLite
- Survives restarts
- Indexed for fast lookup

### L3: Precomputed Cache (`l3-precomputed.ts`)
- Pre-generated embeddings for known content
- Loaded at startup
- Zero-latency for cached content

### Cache Manager (`manager.ts`)
- Coordinates L1 → L2 → L3 lookup chain
- Write-through: new embeddings written to all levels
- Invalidation on content change (via content hash)

## Rust Rebuild Considerations
- Embedding generation is the most compute-intensive part of Cortex
- Rust + `candle` or `ort` (ONNX Runtime) would give significant speedup
- The hybrid fusion math is pure linear algebra — ideal for Rust SIMD
- Cache layers map to Rust's `HashMap` (L1) + `rusqlite` (L2) + memory-mapped files (L3)
- The `IEmbeddingProvider` trait is a clean Rust trait boundary
- Consider `rayon` for parallel batch embedding
