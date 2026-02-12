# MCP Infrastructure Layer

## Location
`packages/mcp/src/infrastructure/` — 11 modules

## Purpose
Enterprise-grade infrastructure wrapping every tool call: caching, rate limiting, metrics, pagination, error handling, token estimation, project resolution, and intelligent tool filtering.

## Files

| File | Class/Export | Purpose |
|------|-------------|---------|
| `cache.ts` | `ResponseCache` | Multi-level LRU + file cache with invalidation |
| `rate-limiter.ts` | `RateLimiter` | Sliding window rate limiting (global + per-tool + expensive) |
| `metrics.ts` | `MetricsCollector` | Prometheus-style counters, gauges, histograms |
| `token-estimator.ts` | `TokenEstimator` | Heuristic token count estimation |
| `cursor-manager.ts` | `CursorManager` | Opaque, versioned, time-limited pagination cursors |
| `response-builder.ts` | `ResponseBuilder` | Summary-first response formatting with token budgets |
| `error-handler.ts` | `DriftError`, `Errors` | Structured errors with recovery hints |
| `project-resolver.ts` | `resolveProject()` | Multi-project resolution from registry |
| `startup-warmer.ts` | `warmupStores()` | Pre-loads all .drift data on init |
| `tool-filter.ts` | `getFilteredTools()` | Language detection + tool filtering |
| `index.ts` | Barrel exports | Re-exports all infrastructure |

---

## Response Cache (`cache.ts`)

Multi-level caching with automatic invalidation.

### Levels
- L1: In-memory LRU (100 entries, 5-minute TTL)
- L2: File-based (optional, 1-hour TTL, persistent across restarts)

### Config
```typescript
interface CacheConfig {
  l1MaxSize: number;      // Default: 100
  l1TtlMs: number;        // Default: 300000 (5 min)
  l2Enabled: boolean;     // Default: false
  l2TtlMs: number;        // Default: 3600000 (1 hour)
  l2CacheDir?: string;
}
```

### Key Generation
Cache keys include project root for isolation:
```
SHA-256(projectRoot + ":" + toolName + ":" + JSON.stringify(sortedArgs))
```

### Invalidation
- By invalidation key (e.g., `category:auth`)
- By category (`invalidateCategories(['auth', 'security'])`)
- All patterns (`invalidatePatterns()`)
- Full clear (`clear()`)
- Automatic on project switch

---

## Rate Limiter (`rate-limiter.ts`)

Sliding window rate limiting with 3 tiers.

### Limits
| Tier | Max Requests | Window |
|------|-------------|--------|
| Global | 100 | 60 seconds |
| Expensive tools | 10 | 60 seconds |
| Per-tool (custom) | Configurable | Configurable |

### Expensive Tools
```typescript
['drift_callgraph', 'drift_code_examples', 'drift_impact_analysis', 'drift_security_summary']
```

---

## Metrics Collector (`metrics.ts`)

Prometheus-compatible metrics with counters, gauges, and histograms.

### Key Metrics
| Metric | Type | Labels |
|--------|------|--------|
| `drift_mcp_requests_total` | counter | tool, success, cached |
| `drift_mcp_request_duration_ms` | histogram | tool |
| `drift_mcp_cache_hits_total` | counter | tool |
| `drift_mcp_cache_misses_total` | counter | tool |
| `drift_mcp_errors_total` | counter | tool, errorCode |
| `drift_mcp_response_tokens` | histogram | tool |

### Histogram Buckets
`le_10, le_50, le_100, le_250, le_500, le_1000, le_2500, le_5000, le_inf`

---

## Token Estimator (`token-estimator.ts`)

Heuristic-based token counting for response budgeting. Approximates token count from string length (no tiktoken dependency).

---

## Cursor Manager (`cursor-manager.ts`)

Opaque, versioned, time-limited pagination cursors.

### Cursor Data
```typescript
interface CursorData {
  lastId?: string;
  lastScore?: number;
  lastTimestamp?: string;
  offset?: number;
  queryHash: string;      // Prevents cursor reuse across different queries
  createdAt: number;
  version: number;
}
```

### Features
- Base64url encoded (URL-safe)
- Versioned (forward compatibility)
- Time-limited (1 hour default, prevents stale pagination)
- Query-bound (hash prevents misuse across different queries)
- Optional HMAC signing for tamper detection

---

## Response Builder (`response-builder.ts`)

Consistent response formatting with summary-first design.

### Response Structure
```typescript
interface MCPResponse<T> {
  summary: string;           // 1-2 sentence description
  data: T;                   // Main payload
  pagination?: PaginationInfo;
  hints?: ResponseHints;     // nextActions, relatedTools, warnings
  meta: MCPResponseMeta;     // requestId, durationMs, cached, tokenEstimate
}
```

### Config
```typescript
interface ResponseBuilderConfig {
  maxResponseTokens: number;   // Default: 4000
  maxSectionTokens: number;    // Default: 1000
  preferSummary: boolean;      // Default: true
}
```

Fluent API: `builder.withSummary(...).withData(...).withPagination(...).build()`

---

## Error Handler (`error-handler.ts`)

Structured errors with recovery hints for AI agents.

### Error Codes
| Code | Category | Example |
|------|----------|---------|
| `INVALID_ARGUMENT` | Client | Bad parameter value |
| `PATTERN_NOT_FOUND` | Client | Invalid pattern ID |
| `FILE_NOT_FOUND` | Client | File doesn't exist |
| `INVALID_CURSOR` | Client | Expired/invalid pagination cursor |
| `MISSING_REQUIRED_PARAM` | Client | Required parameter missing |
| `SCAN_REQUIRED` | Server | No scan data, run `drift scan` |
| `STORE_UNAVAILABLE` | Server | Store not initialized |
| `CALLGRAPH_NOT_BUILT` | Resource | Run `drift callgraph build` |
| `DNA_NOT_ANALYZED` | Resource | Run `drift dna scan` |
| `RATE_LIMITED` | Rate limit | Wait and retry |

### Recovery Hints
```typescript
interface RecoveryHint {
  suggestion: string;           // "Use drift_patterns_list to find valid pattern IDs"
  alternativeTools?: string[];  // ["drift_patterns_list", "drift_status"]
  retryAfterMs?: number;
  command?: string;             // "drift scan"
}
```

---

## Project Resolver (`project-resolver.ts`)

Resolves project names/IDs to filesystem paths using the global registry.

### Resolution Strategy
1. Try exact name match
2. Try ID match
3. Try path match
4. Try partial/fuzzy match (if exactly 1 result)
5. Throw `ProjectNotFoundError` with suggestions

### Active Project
`getActiveProjectRoot()` checks `~/.drift/projects.json` for the active project, falls back to most recently accessed.

---

## Tool Filter (`tool-filter.ts`)

Auto-detects project languages and filters tools to only expose relevant ones.

### Language Detection
Scans project root for config files and file extensions:

| Language | Config Files | Extensions |
|----------|-------------|------------|
| TypeScript | `tsconfig.json` | `.ts`, `.tsx` |
| Python | `pyproject.toml`, `setup.py`, `requirements.txt` | `.py` |
| Java | `pom.xml`, `build.gradle` | `.java` |
| Go | `go.mod` | `.go` |
| Rust | `Cargo.toml` | `.rs` |
| PHP | `composer.json` | `.php` |
| C++ | `CMakeLists.txt`, `Makefile` | `.cpp`, `.h` |
| C# | `*.csproj`, `*.sln` | `.cs` |
| WPF | — | `.xaml` |

### Filtering Rules
- Core tools always available (status, context, patterns, callers, etc.)
- Language-specific tools only shown if language detected
- Configurable override via `.drift/config.json`

---

## Rust Rebuild Considerations
- All infrastructure stays in TypeScript — it's MCP protocol plumbing
- Cache could optionally use Rust for faster LRU operations on high-traffic servers
- Token estimation could use `tiktoken-rs` for accuracy (currently heuristic)
- Metrics collection is in-memory — no migration needed
- Project resolver reads JSON files — stays in TS
