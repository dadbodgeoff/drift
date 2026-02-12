# TypeScript ParserManager

## Location
`packages/core/src/parsers/parser-manager.ts` (~900 lines)

## Purpose
Parser orchestration with LRU caching, incremental parsing, and language detection. This is the primary entry point for all TS-side parsing.

## Configuration

```typescript
interface ParserManagerOptions {
  cacheSize: number;           // Default: 100
  cacheTTL: number;            // Default: 0 (no expiry)
  enableStats: boolean;        // Default: true
  enableIncremental: boolean;  // Default: true
  incrementalThreshold: number;// Default: 10 (min chars for incremental)
}
```

## Core API

### Parser Registration
- `registerParser(parser: BaseParser)` — Register a language parser
- `getParser(filePath: string)` — Get parser by file path

### Language Detection
- `detectLanguage(filePath: string) -> Language | null` — From file extension
- Extension map: `.ts/.tsx` → typescript, `.js/.jsx` → javascript, `.py` → python, `.cs` → csharp, `.java` → java, `.php` → php, `.go` → go, `.rs` → rust, `.cpp/.cc/.cxx` → cpp, `.css` → css, `.scss` → scss, `.json` → json, `.yaml/.yml` → yaml, `.md` → markdown

### Parsing
- `parse(filePath, source) -> ParseResult` — Parse with caching
- `parseFile(filePath) -> Promise<ParseResult>` — Read file + parse
- `parseWithChanges(filePath, source, changes) -> IncrementalParseResult` — Incremental

### Cache Management
- `invalidateCache(filePath)` — Remove single entry
- `clearCache()` — Clear all entries
- `getCacheStats() -> ParserCacheStats` — Hit/miss/eviction stats

## LRU Cache Implementation

Custom doubly-linked list LRU (not using a library):

```typescript
interface LRUNode {
  key: string;
  entry: CachedAST;
  prev: LRUNode | null;
  next: LRUNode | null;
}

interface CachedAST {
  result: ParseResult;
  hash: string;          // SHA-256 of source content
  timestamp: number;
  hits: number;
  source: string;        // Kept for incremental parsing
}
```

### Cache Behavior
1. On `parse()`: compute hash of source
2. Check cache by `filePath` key
3. If hit and hash matches → return cached result, bump to front
4. If miss or hash mismatch → parse, insert at front, evict LRU if over capacity
5. TTL check on access (if configured)

### Cache Stats
```typescript
interface ParserCacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
  hitRatio: number;
}
```

## Incremental Parsing

### TextChange
```typescript
interface TextChange {
  startPosition: Position;
  oldEndPosition: Position;
  newEndPosition: Position;
  newText: string;
}
```

### IncrementalParseResult
```typescript
interface IncrementalParseResult extends ParseResult {
  wasIncremental: boolean;
  reparsedRegions?: Array<{ start: Position; end: Position }>;
}
```

### Flow
1. Check if previous AST exists in cache for this file
2. If yes and changes are above threshold → apply edits to tree, re-parse affected regions
3. If no → full parse

## v2 Considerations
- LRU caching should move to Rust (faster hash computation, no GC pressure)
- Incremental parsing is natively supported by tree-sitter — Rust can use `tree.edit()` directly
- Language detection is trivial — already exists in Rust's `Language::from_extension()`
- The TS ParserManager becomes unnecessary once Rust handles all parsing
- Consider keeping a thin TS wrapper that delegates to NAPI for backward compatibility
