# Quality Gates — Persistence

## Location
`packages/core/src/quality-gates/store/`

## Components

### SnapshotStore (`snapshot-store.ts`)
Stores health snapshots for regression detection. Snapshots capture the state of patterns, constraints, and security at a point in time.

**Storage layout:**
```
.drift/quality-gates/snapshots/
├── main/
│   ├── {snapshot-id}.json
│   └── ...
├── feature-auth-refactor/
│   └── {snapshot-id}.json
└── ...
```

Branch names are sanitized for filesystem safety (slashes → dashes).

**Retention:** Max 50 snapshots per branch (configurable). Oldest snapshots are deleted when limit is exceeded.

**Key Methods:**
| Method | Purpose |
|--------|---------|
| `save(snapshot)` | Save snapshot, enforce retention |
| `getLatest(branch)` | Get most recent snapshot for a branch |
| `getByCommit(branch, sha)` | Find snapshot by commit SHA |
| `getByBranch(branch, limit)` | Get recent snapshots for a branch |

**HealthSnapshot structure:**
```typescript
interface HealthSnapshot {
  id: string;
  timestamp: string;
  branch: string;
  commitSha?: string;
  patterns: PatternHealthSnapshot;     // Per-pattern confidence, compliance, outlier counts
  constraints: ConstraintHealthSnapshot; // Per-constraint pass/fail status
  security: SecurityHealthSnapshot;     // Data access points, sensitive fields
}
```

### GateRunStore (`gate-run-store.ts`)
Stores quality gate run history for trend analysis and auditing.

**Storage layout:**
```
.drift/quality-gates/history/runs/
├── run-{timestamp}.json
└── ...
```

**Retention:** Max 100 runs (configurable). Oldest runs deleted when limit exceeded.

**Key Methods:**
| Method | Purpose |
|--------|---------|
| `save(result)` | Save run result, return run ID |
| `getRecent(limit)` | Get recent runs |
| `get(runId)` | Get specific run |
| `getByBranch(branch, limit)` | Get runs for a branch |

**GateRunRecord structure:**
```typescript
interface GateRunRecord {
  id: string;                          // "run-{timestamp}"
  timestamp: string;
  branch: string;
  commitSha?: string;
  policyId: string;
  passed: boolean;
  score: number;
  gates: Record<GateId, { passed: boolean; score: number }>;
  violationCount: number;
  executionTimeMs: number;
  ci: boolean;
}
```

Run records are lightweight summaries (not full results) — suitable for trend charts and dashboards.

## V2 Notes
- File-based storage works for current scale
- For enterprise with thousands of runs, consider SQLite migration
- Snapshot comparison is the foundation of regression detection — must be fast
- Branch-based organization is good for multi-branch workflows
- Consider: snapshot diffing utility for debugging regressions
