# DNA Store

## Location
`packages/core/src/dna/dna-store.ts`

## Purpose
Persistence layer for DNA profiles. Reads/writes `StylingDNAProfile` to `.drift/dna/styling.json`. Tracks evolution over time by appending snapshot entries on each save.

## Storage Path
```
{rootDir}/.drift/dna/styling.json
```

## Configuration
```typescript
interface DNAStoreConfig {
  rootDir: string;
  componentPaths: string[];
  backendPaths?: string[];
  excludePaths: string[];
  thresholds: DNAThresholds;
}
```

## Methods

### `initialize()`
Creates `.drift/dna/` directory if it doesn't exist, then calls `load()`.

### `load() → StylingDNAProfile | null`
Reads and parses `styling.json`. Returns `null` if file doesn't exist.

### `save(profile)`
1. Creates `.drift/dna/` directory if needed
2. If a previous profile exists, appends an `EvolutionEntry`:
   ```typescript
   {
     timestamp: string;       // ISO date
     healthScore: number;     // Current health
     geneticDiversity: number; // Current diversity
     changes: [];             // Placeholder for change tracking
   }
   ```
3. Caps evolution array at 50 entries (sliding window)
4. Writes JSON to disk

### `getProfile() → StylingDNAProfile | null`
Returns the in-memory profile (no disk read).

### `getConfig() → DNAStoreConfig`
Returns the store configuration.

## Evolution Tracking
Each save appends a snapshot to `profile.evolution[]`. This enables:
- Health score trend analysis over time
- Genetic diversity tracking
- Detecting degradation patterns

The 50-entry cap prevents unbounded growth while keeping ~50 analysis runs of history.

## Rust Rebuild Considerations
- Simple JSON I/O — trivial in either language
- Could be replaced by SQLite storage for better querying
- Evolution tracking is append-only — fits well with Rust's ownership model
