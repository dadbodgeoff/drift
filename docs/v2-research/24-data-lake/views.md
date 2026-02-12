# Data Lake View Store

## Location
`packages/core/src/lake/view-store.ts`

## Purpose
Pre-computed views stored as JSON files for instant query responses. Four view types cover the most common queries: status, pattern listing, security summary, and trends.

## Files
- `view-store.ts` — `ViewStore` class (~430 lines)

---

## ViewStore

### View CRUD
- `getStatusView()` / `saveStatusView(view)` — Status view
- `getPatternIndexView()` / `savePatternIndexView(view)` — Pattern index
- `getSecuritySummaryView()` / `saveSecuritySummaryView(view)` — Security summary
- `getTrendsView()` / `saveTrendsView(view)` — Trends

### View Builders
- `buildStatusView(patterns)` — Computes StatusView from raw patterns
- `buildPatternIndexView(patterns)` — Computes PatternIndexView from raw patterns

### Cache Management
- `invalidateCache(view?)` — Clear in-memory cache (specific or all)
- `hasView(view)` — Check if view file exists on disk
- `deleteView(view)` — Remove view file

---

## View Types

### StatusView
Instant `drift_status` response. Contains:
- Health score with trend (`improving` / `stable` / `declining`) and factors
- Pattern counts by status and category
- Issue counts with top issues (regressions, violations, outliers)
- Security risk level with violation and exposure counts
- Last scan info

### PatternIndexView
Lightweight pattern listing. Each entry is a `PatternSummary` with:
- id, name, category, subcategory, status
- confidence, confidenceLevel, severity
- locationCount, outlierCount
- `locationsHash` — SHA-256 of locations for change detection

### SecuritySummaryView
Security posture overview:
- Overall risk level
- Table/access-point/violation counts
- Top sensitive tables with risk scores
- Top violations with severity
- Recent security changes

### TrendsView
Health trends over time:
- Trend items with timestamps, health scores, pattern/violation counts
- Category-level trends
- Regressions and improvements lists

---

## Caching
In-memory cache per view type. Populated on first read, invalidated on save or explicit `invalidateCache()`. Each cache entry stores the parsed JSON to avoid repeated disk reads.

## Rust Rebuild Considerations
- All four views become SQL views in `schema.sql`
- `v_status`, `v_pattern_index`, `v_category_counts`, `v_file_patterns`, `v_security_summary` already exist in the schema
- View builders become SQL `CREATE VIEW` definitions
- In-memory caching replaced by SQLite's page cache
- No JSON serialization/deserialization overhead
