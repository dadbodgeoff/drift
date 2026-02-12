# Enterprise Server

## Location
`packages/mcp/src/enterprise-server.ts` (~914 lines)

## Purpose
The main MCP server implementation. Creates the server, initializes all stores, registers tools, handles request routing with caching/rate-limiting/metrics, and supports dynamic multi-project switching.

## Server Creation (`createEnterpriseMCPServer`)

### Config
```typescript
interface EnterpriseMCPConfig {
  projectRoot: string;
  enableCache?: boolean;          // Default: true
  enableRateLimiting?: boolean;   // Default: true
  enableMetrics?: boolean;        // Default: true
  maxRequestsPerMinute?: number;
  usePatternService?: boolean;    // Default: true (new IPatternService)
  verbose?: boolean;
  skipWarmup?: boolean;           // Default: false
}
```

### Initialization Sequence
```
1. Check storage backend (SQLite vs JSON)
2. Create PatternStore (async factory, auto-detects SQLite)
3. Create UnifiedStore (SQLite-backed, Phase 4)
4. Create legacy stores (DNA, Boundary, Contract, CallGraph, Env)
5. Create IPatternService wrapper (if usePatternService enabled)
6. Create DataLake for optimized queries
7. Create ResponseCache (if caching enabled)
8. Initialize Cortex (if .drift/memory/cortex.db exists)
9. Warm up stores (async, non-blocking — loads all .drift data)
10. Build missing data in background (e.g., call graph)
11. Filter tools by detected project languages
12. Register ListTools handler (returns filtered tools)
13. Register CallTool handler (routing + infrastructure)
```

### Store Architecture
```typescript
const stores = {
  pattern: PatternStore,        // Auto-detects SQLite vs JSON
  manifest: ManifestStore,      // Project metadata
  history: HistoryStore,        // Pattern history snapshots
  dna: DNAStore,                // Styling DNA (legacy JSON)
  boundary: BoundaryStore,      // Data access boundaries (legacy JSON)
  contract: ContractStore,      // API contracts (legacy JSON)
  callGraph: CallGraphStore,    // Call graph (legacy JSON)
  env: EnvStore,                // Environment variables (legacy JSON)
  unified: UnifiedStore,        // SQLite-backed (preferred for new code)
};
```

## Request Routing (`routeToolCall`)

The routing function is a cascade of `switch` statements organized by category:

```
Orchestration → Discovery → Setup → Curation → Exploration →
Detail → Surgical → Analysis → Generation → Memory → Unknown
```

Each category's switch block routes tool names to their handler functions. Unknown tools return an error with `hint: 'Use drift_capabilities to see available tools'`.

### Dual-Path Pattern
Many tools have two implementations — legacy (JSON store) and new (SQLite):

```typescript
// Example: drift_patterns_list
if (patternService) {
  return handlePatternsListWithService(patternService, args, dataLake);
}
return handlePatternsList(stores.pattern, args, dataLake);
```

Tools with dual paths:
- `drift_status` — PatternService vs PatternStore
- `drift_patterns_list` — PatternService vs PatternStore
- `drift_pattern_get` — PatternService vs PatternStore
- `drift_code_examples` — PatternService vs PatternStore
- `drift_prevalidate` — PatternService vs PatternStore
- `drift_security_summary` — UnifiedStore vs BoundaryStore
- `drift_contracts_list` — UnifiedStore vs ContractStore
- `drift_env` — UnifiedStore vs EnvStore
- `drift_dna_profile` — UnifiedStore vs DNAStore
- `drift_constraints` — UnifiedStore vs file-based

### Memory Tool Routing
Memory tools use a shared `executeMemoryTool()` wrapper:

```typescript
async function executeMemoryTool(
  tool: { execute: (args: any) => Promise<any> },
  args: Record<string, unknown>
): Promise<MCPResponse>
```

Each memory tool is an object with an `execute` method, imported from `tools/memory/`.

## Dynamic Project Resolution

The server supports switching between registered projects mid-session:

1. Check `args.project` parameter
2. Special cases:
   - `drift_setup`: project param is a PATH (resolve relative to projectRoot, security check for path traversal)
   - `drift_projects action="register"`: project param is a NAME, use `args.path` for actual path
3. For other tools: registry lookup via `resolveProject()`
4. If different project resolved:
   - Create temporary stores for that project
   - Create temporary DataLake and PatternService
   - Initialize stores
5. Cache invalidation on `drift_projects action="switch"`

### Security
Path traversal prevention for `drift_setup`:
```typescript
const normalizedRoot = path.normalize(config.projectRoot);
if (!resolvedPath.startsWith(normalizedRoot)) {
  throw new Error(`Path traversal detected: ${requestedProject} is outside project root`);
}
```

## Startup Warmup (`startup-warmer.ts`)

Pre-loads all `.drift` data on server initialization so tools work immediately:

```typescript
interface WarmupResult {
  success: boolean;
  duration: number;
  loaded: {
    patterns: number;
    callGraph: boolean;
    boundaries: boolean;
    env: number;
    dna: boolean;
    contracts: number;
    history: number;
    coupling: boolean;
    errorHandling: boolean;
    testTopology: boolean;
  };
  errors: string[];
}
```

Data loaded: patterns (all statuses), call graph, boundaries, environment variables, DNA profile, contracts, history snapshots, module coupling, error handling analysis, test topology.

If call graph is missing after warmup, `buildMissingData()` runs in background.

## Rust Rebuild Considerations
- The server stays in TypeScript — it's orchestration
- `routeToolCall()` becomes simpler as dual-path collapses to SQLite-only
- Store initialization simplifies: one Rust NAPI call instead of 9 store constructors
- Warmup may become unnecessary if Rust manages the database lifecycle
- Dynamic project resolution stays in TS (registry is a JSON file)
