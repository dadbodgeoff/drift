# Contract Storage

## Dual Storage Architecture
Contracts use both SQLite (primary) and file-based JSON (legacy) storage.

---

## SQLite Schema (`packages/core/src/storage/schema.sql`)

### contracts table
```sql
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  method TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH')),
  endpoint TEXT NOT NULL,
  normalized_endpoint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered', 'verified', 'mismatch', 'ignored')),

  -- Backend info
  backend_method TEXT,
  backend_path TEXT,
  backend_normalized_path TEXT,
  backend_file TEXT,
  backend_line INTEGER,
  backend_framework TEXT,
  backend_response_fields TEXT,     -- JSON array of ContractField

  -- Confidence
  confidence_score REAL DEFAULT 0.0,
  confidence_level TEXT DEFAULT 'low',
  match_confidence REAL,
  field_extraction_confidence REAL,

  -- Mismatches
  mismatches TEXT,                  -- JSON array of FieldMismatch

  -- Metadata
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT,
  verified_by TEXT,

  UNIQUE(method, normalized_endpoint)
);
```

### contract_frontends table
```sql
CREATE TABLE IF NOT EXISTS contract_frontends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  library TEXT,
  response_fields TEXT             -- JSON array of ContractField
);
```

### Key Design Decisions
- One-to-many: one contract → many frontend calls (same endpoint called from multiple places)
- `UNIQUE(method, normalized_endpoint)` prevents duplicate contracts
- `CASCADE DELETE` on frontends when contract is deleted
- JSON columns for flexible nested data (response_fields, mismatches)
- Confidence stored as separate columns for efficient filtering

---

## ContractRepository (`packages/core/src/storage/repositories/contract-repository.ts`)

### Interface: IContractRepository

#### CRUD
```typescript
create(contract: DbContract): Promise<string>
read(id: string): Promise<DbContract | null>
update(id: string, updates: Partial<DbContract>): Promise<void>
delete(id: string): Promise<boolean>
exists(id: string): Promise<boolean>
count(filter?: Partial<DbContract>): Promise<number>
```

#### Queries
```typescript
findByStatus(status: DbContractStatus): Promise<DbContract[]>
findByMethod(method: DbHttpMethod): Promise<DbContract[]>
findByEndpoint(endpoint: string): Promise<DbContract[]>    // LIKE match
findWithMismatches(): Promise<DbContract[]>                 // status='mismatch' OR mismatches IS NOT NULL
```

#### State Transitions
```typescript
verify(id: string, verifiedBy?: string): Promise<void>     // → 'verified'
markMismatch(id: string): Promise<void>                     // → 'mismatch'
ignore(id: string): Promise<void>                           // → 'ignored'
```

All transitions update `last_seen` timestamp. `verify()` also sets `verified_at` and `verified_by`.

#### Frontend Management
```typescript
addFrontend(contractId: string, frontend: DbContractFrontend): Promise<void>
getFrontends(contractId: string): Promise<DbContractFrontend[]>
```

---

## File-Based Storage (Legacy)

### Directory Structure
```
.drift/contracts/
├── discovered/
│   ├── contracts.json
│   └── .backups/
└── mismatch/
    ├── contracts.json
    └── .backups/
```

### File Format
```json
{
  "version": "1.0.0",
  "status": "mismatch",
  "contracts": [
    {
      "id": "contract-post-cd4eea6286b8",
      "method": "POST",
      "endpoint": "/users",
      "backend": {
        "method": "POST",
        "path": "/users",
        "normalizedPath": "/users",
        "file": "demo/backend/src/routes/legacy.ts",
        "line": 55,
        "responseFields": [
          { "name": "ok", "type": "unknown", "optional": false, "nullable": false, "line": 81 }
        ],
        "framework": "express",
        "requestFields": [
          { "name": "name", "type": "unknown", "optional": false, "nullable": false, "line": 56 }
        ]
      },
      "frontend": [
        {
          "method": "POST",
          "path": "/api/users",
          "normalizedPath": "/api/users",
          "file": "demo/frontend/src/api/users.ts",
          "line": 19,
          "responseFields": [],
          "library": "axios",
          "requestFields": [
            { "name": "email", "type": "unknown", "optional": false, "nullable": false }
          ]
        }
      ],
      "mismatches": [
        {
          "fieldPath": "ok",
          "mismatchType": "missing_in_frontend",
          "backendField": { "name": "ok", "type": "unknown", "optional": false, "nullable": false },
          "description": "Field \"ok\" exists in backend but not in frontend type",
          "severity": "error"
        }
      ],
      "confidence": { "score": 0.6, "level": "medium", "matchConfidence": 0.7, "fieldExtractionConfidence": 0.5 },
      "metadata": { "firstSeen": "2026-01-15T...", "lastSeen": "2026-01-31T..." }
    }
  ],
  "lastUpdated": "2026-01-31T20:35:49.976Z"
}
```

### Migration Path
- `drift migrate-storage` converts JSON files to SQLite
- MCP tools support both backends (SQLite preferred)
- `_source` field in responses indicates which backend was used

---

## v2 Considerations
- SQLite schema is well-designed — keep as-is
- JSON storage can be deprecated once migration is complete
- Consider adding indexes on `backend_file` and `confidence_score` for common queries
- The `mismatches` JSON column could be normalized into a separate table for better querying
- `response_fields` JSON columns could benefit from JSON path queries (SQLite 3.38+)
