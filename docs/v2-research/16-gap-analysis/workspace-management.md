# Workspace Management System

## Location
`packages/core/src/workspace/`

## What It Does
Top-level orchestrator for project lifecycle: initialization, multi-project switching, backup/restore, schema migration, and context pre-loading. This is the glue that ties all subsystems together.

## Architecture

### WorkspaceManager (`workspace-manager.ts`)
Main entry point. Singleton orchestrator that composes all workspace components.

**Lifecycle:**
1. `initialize(options)` — Auto-migrates schema if needed, sets up registry
2. `getStatus()` — Returns full workspace status (initialized, active project, context loaded, migration needed, schema version, backup count)
3. `getContext(forceRefresh?)` — Pre-loaded workspace context for fast CLI/MCP access
4. `getAgentContext()` — Agent-friendly project context for MCP tools

**Project management:**
- `getActiveProject()` — Current project indicator
- `switchProject(request)` — Switch with cache invalidation
- `formatProjectIndicator()` / `formatProjectHeader()` — CLI output formatting

**Backup/restore:**
- `createBackup(reason)` — Manual or automatic backup
- `restore(backupId)` — Restore with cache invalidation
- `listBackups()` / `deleteBackup(id, "DELETE")` — Management

**Destructive operations:**
- `performDestructiveOperation(request, fn)` — Auto-backup before destructive ops
- `deleteDriftFolder("DELETE")` — Requires explicit confirmation token
- `reset("DELETE")` — Delete everything except backups

**Schema migration:**
- `needsMigration()` / `migrate()` / `getSchemaVersion()` — Version management

### BackupManager (`backup-manager.ts`)
Enterprise-grade backup with checksums and retention.

**Features:**
- Automatic backup before destructive operations
- SHA-256 checksum integrity verification
- Gzip compression for JSON files
- Retention policy enforcement (default: 10 backups max)
- Version-aware backup naming: `backup-{timestamp}-{reason}`

**Backup reasons:** `version_upgrade`, `schema_migration`, `user_requested`, `pre_destructive_operation`, `scheduled`, `auto_save`

**Storage:** `.drift-backups/backup-{timestamp}-{reason}/`
- Each backup contains: all `.drift/` files (excluding cache, history/snapshots, .backups)
- `backup-manifest.json` with metadata (id, version, checksum, files list)
- Index file at `.drift-backups/index.json`

### ContextLoader (`context-loader.ts`)
Pre-loads workspace data for fast CLI/MCP access.

**Caching strategy:**
- L1: In-memory cache with TTL (default: 5 minutes)
- L2: Disk cache at `.drift/.context-cache.json`
- Force refresh available

**Context structure (`WorkspaceContext`):**
```typescript
{
  project: { id, name, rootPath, driftPath, schemaVersion, driftVersion, lastScanAt, healthScore, languages, frameworks },
  lake: { available, patternSummary, callGraphSummary, boundarySummary, lastUpdatedAt },
  analysis: { callGraphBuilt, testTopologyBuilt, couplingBuilt, dnaProfileExists, memoryInitialized, constantsExtracted },
  loadedAt, validUntil
}
```

**Auto-detection:**
- Languages: checks for tsconfig.json, requirements.txt, pom.xml, *.csproj, composer.json, go.mod, Cargo.toml
- Frameworks: checks package.json deps for next, react, vue, angular, express, fastify, nestjs

### ProjectSwitcher (`project-switcher.ts`)
Multi-project management with clear indicators.

**Project resolution (in order):**
1. Explicit registry lookup by name
2. Registry lookup by path
3. Registry lookup by ID
4. Partial match search
5. Auto-detect from cwd (checks for `.drift/` directory)

**Agent context:** Provides MCP-friendly project context with summary, available commands, warnings, and readiness state.

**Health indicators:** 🟢 healthy, 🟡 warning, 🔴 critical, ⚪ unknown

### SchemaMigrator (`schema-migrator.ts`)
Version upgrades with automatic backup and rollback.

**Built-in migrations:**
- `1.0.0 → 1.1.0`: Add pattern confidence breakdown
- `1.1.0 → 2.0.0`: Restructure lake directory, add memory system support

**Migration flow:**
1. Detect current version from `.drift/config.json`
2. Find migration path (sequential chain)
3. Create backup before migration
4. Apply migrations sequentially
5. On failure: rollback in reverse order, restore from backup
6. Record migration history in `.drift/migration-history.json`

## Configuration

```typescript
{
  autoBackup: true,              // Auto-backup before destructive ops
  backupRetentionDays: 30,       // Retention period
  maxBackups: 10,                // Maximum backups to keep
  enableContextCache: true,      // Enable disk caching
  contextCacheTTL: 300,          // Cache TTL in seconds (5 min)
  showProjectIndicator: true,    // Show project in CLI output
  autoDetectProject: true,       // Auto-detect from cwd
}
```

## v2 Notes
- This entire system should be preserved in v2. It's the project lifecycle.
- The backup system with checksums is critical for data safety during upgrades.
- Context pre-loading is what makes MCP tools fast — must be replicated.
- Schema migration with rollback is essential for version upgrades.
- Consider: Should v2 workspace management be in Rust for faster startup?
