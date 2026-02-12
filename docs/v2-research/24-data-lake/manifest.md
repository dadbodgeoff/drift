# Data Lake Manifest Store

## Location
`packages/core/src/lake/manifest-store.ts`

## Purpose
Quick-load index of everything in the data lake. Reading this single file (`.drift/manifest.json`) gives you all stats needed for `drift_status` without loading any other data.

## Files
- `manifest-store.ts` — `ManifestStore` class (~420 lines)

---

## ManifestStore

### Lifecycle
- `initialize()` — Loads manifest from disk (or creates empty)
- `load()` — Force reload from disk
- `save()` — Write to disk
- `saveIfDirty()` — Only writes if changes were made

### Stat Accessors
- `getManifest()` — Full manifest
- `getStats()` — All stats
- `getPatternStats()` / `getSecurityStats()` / `getCallGraphStats()` / `getContractStats()` / `getDNAStats()`
- `getLastScan()` — Last scan info

### Stat Updaters
- `updatePatternStats(partial)` — Merge partial pattern stats
- `updateSecurityStats(partial)` — Merge partial security stats
- `updateCallGraphStats(partial)` — Merge partial call graph stats
- `updateContractStats(partial)` — Merge partial contract stats
- `updateDNAStats(partial)` — Merge partial DNA stats
- `updateLastScan(partial)` — Merge partial scan info

### File Hash Management
- `getFileHash(file)` — Get stored hash for a file
- `setFileHash(file, hash)` — Store hash
- `computeFileHash(filePath)` — Compute SHA-256 from file content
- `hasFileChanged(file, newHash)` — Compare stored vs new hash

### View Freshness
- `isViewStale(view)` — Check if a view needs rebuild
- `markViewFresh(view)` — Mark view as up-to-date
- `markViewStale(view, reason?)` — Mark view as needing rebuild
- `markAllViewsStale(reason?)` — Invalidate all views
- `getViewFreshness()` — Get freshness status for all views

### Dirty Tracking
- `isDirty()` — Whether unsaved changes exist
- Internal `_dirty` flag set on any mutation, cleared on save

## Rust Rebuild Considerations
- Manifest becomes a cached SQL query result, not a JSON file
- File hashing stays (for incremental scan support)
- View freshness replaced by SQLite view invalidation triggers
- The "single read for all stats" concept maps to a single SQL query joining multiple tables
