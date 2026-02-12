# Telemetry Worker

## Location
`infrastructure/telemetry-worker/` — TypeScript, Cloudflare Worker

## What It Is
A serverless Cloudflare Worker that collects anonymized telemetry from Drift installations. Stores events in D1 (SQLite), aggregates stats, and collects pattern signatures for ML training.

## Architecture

```
┌─────────────────────────────────────┐
│        Cloudflare Worker             │
│  POST /v1/events                     │
│  GET  /v1/health                     │
│  GET  /v1/stats                      │
├─────────────────────────────────────┤
│        D1 Database (SQLite)          │
│  events │ daily_stats                │
│  pattern_signatures                  │
│  action_aggregates                   │
└─────────────────────────────────────┘
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/events` | Submit telemetry events (max 100/batch) |
| GET | `/v1/health` | Health check |
| GET | `/v1/stats` | Public aggregate stats (last 30 days) |

## Database Schema

### `events` — Raw telemetry
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
type TEXT NOT NULL
timestamp TEXT NOT NULL
installation_id TEXT NOT NULL
drift_version TEXT NOT NULL
payload TEXT              -- JSON blob
created_at TEXT DEFAULT datetime('now')
```
Indexes: type, installation_id, created_at, timestamp

### `daily_stats` — Aggregated metrics
```sql
date TEXT NOT NULL
metric TEXT NOT NULL
value INTEGER DEFAULT 0
UNIQUE(date, metric)
```

### `pattern_signatures` — Deduplicated patterns for ML
```sql
signature_hash TEXT UNIQUE
category TEXT NOT NULL
detection_method TEXT
language TEXT
first_seen TEXT, last_seen TEXT
occurrence_count INTEGER DEFAULT 1
avg_confidence REAL
avg_location_count REAL
avg_outlier_count REAL
```

### `action_aggregates` — User action stats
```sql
category TEXT NOT NULL
action TEXT NOT NULL
confidence_bucket TEXT    -- 'low', 'medium', 'high'
count INTEGER DEFAULT 0
avg_hours_to_decision REAL
UNIQUE(category, action, confidence_bucket)
```

## Event Processing
1. Validate batch (array required, max 100 events)
2. Batch insert into `events` table
3. Update aggregate stats:
   - Event type counts (`events:<type>`)
   - Language counts (`language:<lang>`)
   - Category counts (`category:<cat>`)
   - Unique installations per day

## Configuration (`wrangler.toml`)
```toml
name = "drift-telemetry"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "drift-telemetry"
database_id = "<your-id>"

[env.production]
name = "drift-telemetry-prod"

[env.staging]
name = "drift-telemetry-staging"
```

## Privacy
- No source code stored
- Installation IDs are anonymous UUIDs
- Pattern signatures are SHA-256 hashes (irreversible)
- All data aggregated for ML training
- Raw events retained 90 days

## Cost
Cloudflare free tier covers ~1000 active users × 50 events/day.

## Scripts
| Script | Purpose |
|--------|---------|
| `dev` | Local development (`wrangler dev`) |
| `deploy` | Deploy to default env |
| `deploy:staging` | Deploy to staging |
| `deploy:production` | Deploy to production |
| `db:create` | Create D1 database |
| `db:migrate` | Run schema migrations |
| `db:migrate:local` | Run migrations locally |
| `tail` | Stream live logs |

## v2 Considerations
- Independent of Drift core — no changes needed for v2
- Consider adding Rust-specific telemetry events (parse times, NAPI call counts)
- Pattern signature schema may need updating for v2 pattern format
- Could add a `/v1/feedback` endpoint for benchmark result collection
