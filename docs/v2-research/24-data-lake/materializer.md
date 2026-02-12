# Data Lake View Materializer

## Location
`packages/core/src/lake/view-materializer.ts`

## Purpose
Rebuilds views and indexes after scans. Determines which views are stale, rebuilds them selectively, updates manifest stats, and syncs cross-domain statistics (call graph, contracts).

## Files
- `view-materializer.ts` — `ViewMaterializer` class (~590 lines)

---

## ViewMaterializer

### Initialization
- `initialize()` — Initializes all sub-stores

### Main Entry Point
```typescript
async materialize(
  patterns: Pattern[],
  securityData: Record<string, unknown>,
  options: MaterializeOptions
): Promise<MaterializeResult>;
```

### MaterializeOptions
```typescript
interface MaterializeOptions {
  lastScan?: LastScanInfo;
  force?: boolean;           // rebuild all, ignore staleness
  views?: ViewType[];        // specific views to rebuild
  trendSummary?: TrendSummary;
}
```

### MaterializeResult
```typescript
interface MaterializeResult {
  duration: number;
  viewsRebuilt: ViewType[];
  indexesRebuilt: string[];
  errors: string[];
}
```

---

## Rebuild Pipeline

1. Determine which views need rebuild (stale markers or explicit list)
2. Rebuild StatusView from patterns + security + callgraph + contract stats
3. Rebuild PatternIndexView from patterns
4. Rebuild SecuritySummaryView from security shard index
5. Rebuild TrendsView from trend summary data
6. Rebuild all indexes (file, category, table, entry point)
7. Update ManifestStore stats (pattern, security, callgraph, contract, DNA)
8. Sync callgraph stats from `CallGraphShardStore`
9. Sync contract stats from contract data
10. Mark all rebuilt views as fresh in manifest

---

## View Rebuild Methods
- `rebuildStatusView(patterns, securityData, options)` — Builds StatusView with health scoring
- `rebuildPatternIndexView(patterns)` — Builds lightweight pattern listing
- `rebuildSecuritySummaryView(securityData)` — Builds security posture from shard index
- `rebuildTrendsView(trendSummary)` — Builds health trends
- `rebuildIndexes(patterns, securityData)` — Rebuilds all four index types

## Cross-Domain Sync
- `syncCallGraphStats()` — Reads CallGraphShardStore index, updates manifest
- `syncContractStats()` — Reads contract data, updates manifest

## Risk Calculation
- `calculateRiskLevel(violations, sensitiveExposures)` — Overall risk from counts
- `calculateTableRiskScore(tableInfo)` — Per-table risk from sensitivity + access patterns

---

## Dependencies
Composes:
- `ManifestStore` — Stats updates + view freshness
- `ViewStore` — View persistence
- `IndexStore` — Index persistence
- `PatternShardStore` — Pattern data for index building
- `CallGraphShardStore` — Call graph stats sync
- `SecurityShardStore` — Security data for view building

## Rust Rebuild Considerations
- Materialization becomes SQLite trigger-based or explicit `REFRESH` calls
- The selective rebuild logic maps to checking view staleness via timestamps
- Cross-domain stat sync becomes SQL joins across tables
- Risk calculation is pure math — trivial to port
- The pipeline pattern maps well to Rust's sequential async operations
