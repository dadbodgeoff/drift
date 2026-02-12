# Data Lake Types

## Location
`packages/core/src/lake/types.ts`

## Purpose
Type definitions for the unified data lake architecture. Covers manifest, views, indexes, shards, and configuration.

---

## Manifest Types

### DriftManifest
```typescript
interface DriftManifest {
  version: string;
  generatedAt: string;
  projectRoot: string;
  stats: ManifestStats;
  fileHashes: Record<string, string>;
  lastScan: LastScanInfo;
  views: ViewFreshness;
}
```

### ManifestStats
```typescript
interface ManifestStats {
  patterns: PatternStats;
  security: SecurityStats;
  callGraph: CallGraphStats;
  contracts: ContractStats;
  dna: DNAStats;
}
```

### PatternStats
```typescript
interface PatternStats {
  total: number;
  byCategory: Record<PatternCategory, number>;
  byStatus: Record<PatternStatus, number>;
  byConfidence: Record<ConfidenceLevel, number>;
  totalLocations: number;
  totalOutliers: number;
}
```

### SecurityStats
```typescript
interface SecurityStats {
  totalTables: number;
  totalAccessPoints: number;
  sensitiveFields: number;
  violations: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}
```

### CallGraphStats
```typescript
interface CallGraphStats {
  totalFunctions: number;
  totalCalls: number;
  entryPoints: number;
  dataAccessors: number;
  avgDepth: number;
}
```

### ContractStats / DNAStats
```typescript
interface ContractStats {
  verified: number;
  mismatch: number;
  discovered: number;
  ignored: number;
}

interface DNAStats {
  healthScore: number;
  geneticDiversity: number;
  mutations: number;
  dominantGenes: string[];
}
```

### LastScanInfo
```typescript
interface LastScanInfo {
  timestamp: string;
  duration: number;
  filesScanned: number;
  patternsFound: number;
  errors: number;
}
```

### ViewFreshness
```typescript
interface ViewFreshness {
  status: ViewMeta;
  patternIndex: ViewMeta;
  securitySummary: ViewMeta;
  trends: ViewMeta;
  examples: ViewMeta;
}

interface ViewMeta {
  generatedAt: string;
  stale: boolean;
  invalidatedBy?: string[];
}
```

---

## View Types

### StatusView
```typescript
interface StatusView {
  generatedAt: string;
  health: {
    score: number;
    trend: 'improving' | 'stable' | 'declining';
    factors: HealthFactor[];
  };
  patterns: {
    total: number;
    approved: number;
    discovered: number;
    ignored: number;
    byCategory: Record<string, number>;
  };
  issues: {
    critical: number;
    warnings: number;
    topIssues: TopIssue[];
  };
  security: {
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    violations: number;
    sensitiveExposures: number;
  };
  lastScan: LastScanInfo;
}
```

### PatternIndexView
```typescript
interface PatternIndexView {
  generatedAt: string;
  total: number;
  patterns: PatternSummary[];
}

interface PatternSummary {
  id: string;
  name: string;
  category: PatternCategory;
  subcategory: string;
  status: PatternStatus;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  locationCount: number;
  outlierCount: number;
  severity: string;
  locationsHash: string;  // change detection
}
```

### SecuritySummaryView / TrendsView
Pre-computed security posture and health trends over time. Include risk levels, top violations, sensitive tables, trend items with timestamps.

---

## Index Types
```typescript
interface FileIndex {
  generatedAt: string;
  checksum: string;
  total: number;
  files: Record<string, string[]>;  // file -> patternIds
}

interface CategoryIndex {
  generatedAt: string;
  checksum: string;
  total: number;
  categories: Record<PatternCategory, string[]>;  // category -> patternIds
}

interface TableIndex { /* table -> accessPointIds, accessorIds */ }
interface EntryPointIndex { /* entryPoint -> reachableFunctions, tables, sensitiveData */ }
```

---

## Shard Types
```typescript
interface Shard<T> {
  version: string;
  generatedAt: string;
  checksum: string;
  data: T;
}

interface PatternShard extends Shard<PatternShardEntry[]> {
  category: PatternCategory;
}

interface PatternShardEntry {
  id: string;
  name: string;
  category: PatternCategory;
  subcategory: string;
  status: PatternStatus;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  severity: string;
  locations: PatternLocation[];
  outliers: PatternLocation[];
  metadata: PatternMetadata;
}
```

---

## Configuration
```typescript
interface DataLakeConfig {
  rootDir: string;
  enableSharding: boolean;
  shardThreshold: number;
  enableViews: boolean;
  enableIndexes: boolean;
  autoRebuild: boolean;
  viewTtlMs: number;
}

const DEFAULT_DATA_LAKE_CONFIG: DataLakeConfig;
const LAKE_VERSION = '1.0';
const LAKE_DIRS: Record<string, string>;
const VIEW_FILES: Record<ViewType, string>;
const INDEX_FILES: Record<IndexType, string>;
```

## Rust Rebuild Considerations
- All types map to Rust structs with `serde::Serialize`/`Deserialize`
- View types become SQL view result types
- Index types become SQL index query result types
- Shard types are eliminated (SQLite replaces JSON shards)
- `DataLakeConfig` becomes database pragma configuration
