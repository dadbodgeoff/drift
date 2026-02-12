# Contract Tracker — Overview

## Location
- `packages/core/src/types/contracts.ts` — Type definitions
- `packages/core/src/storage/repositories/contract-repository.ts` — SQLite persistence
- `.drift/contracts/` — File-based storage (discovered, mismatch directories)

## What It Is
The Contract Tracker detects and monitors API contracts between backend endpoints and frontend TypeScript types. It answers: "Does the frontend expect the same fields the backend returns?" It's the "silent failure killer" — catching type mismatches that compile fine but break at runtime.

## Core Design Principles
1. Contracts are discovered automatically by matching backend endpoints to frontend API calls
2. Field-level mismatch detection catches type, optionality, and nullability differences
3. Confidence scoring reflects how certain we are about endpoint matching and field extraction
4. Contracts have lifecycle: discovered → verified → mismatch → ignored
5. Both file-based (JSON) and SQLite storage backends

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                  Contract Pipeline                       │
├──────────┬──────────┬──────────┬────────────────────────┤
│ Backend  │ Frontend │ Contract │   Mismatch             │
│ Endpoint │ API Call │ Matching │   Detection            │
│ Extract  │ Extract  │          │                        │
├──────────┴──────────┴──────────┴────────────────────────┤
│                  Storage Layer                           │
│  SQLite (contract-repository.ts) │ JSON (.drift/contracts/) │
└─────────────────────────────────────────────────────────┘
```

## Contract Model

```typescript
interface Contract {
  id: string;
  method: HttpMethod;           // GET, POST, PUT, PATCH, DELETE
  endpoint: string;             // Normalized endpoint path
  backend: BackendEndpoint;     // Backend definition
  frontend: FrontendApiCall[];  // Frontend calls (may be multiple)
  mismatches: FieldMismatch[];  // Detected mismatches
  status: ContractStatus;       // discovered, verified, mismatch, ignored
  confidence: ContractConfidence;
  metadata: ContractMetadata;
}
```

## Backend Endpoint Extraction
Extracts API endpoint definitions from backend code:
```typescript
interface BackendEndpoint {
  method: HttpMethod;
  path: string;                 // '/api/users/{id}'
  normalizedPath: string;       // '/api/users/:id'
  file: string;
  line: number;
  responseFields: ContractField[];
  requestFields?: ContractField[];
  responseTypeName?: string;
  framework: string;            // fastapi, express, flask, etc.
}
```

## Frontend API Call Extraction
Extracts API calls from frontend code:
```typescript
interface FrontendApiCall {
  method: HttpMethod;
  path: string;                 // '/api/users/${id}'
  normalizedPath: string;
  file: string;
  line: number;
  responseType?: string;        // TypeScript type name
  responseFields: ContractField[];
  requestType?: string;
  requestFields?: ContractField[];
  library: string;              // fetch, axios, react-query, etc.
}
```

## Mismatch Detection

### Mismatch Types
| Type | Description | Severity |
|------|-------------|----------|
| `missing_in_frontend` | Backend returns field, frontend doesn't expect it | warning |
| `missing_in_backend` | Frontend expects field, backend doesn't return it | error |
| `type_mismatch` | Field exists in both but types differ | error |
| `optionality_mismatch` | Required vs optional disagreement | warning |
| `nullability_mismatch` | Nullable vs non-nullable disagreement | warning |

### Field Comparison
```typescript
interface ContractField {
  name: string;
  type: string;                 // string, number, boolean, object, array
  optional: boolean;
  nullable: boolean;
  children?: ContractField[];   // Nested fields for objects
  arrayType?: string;           // Element type for arrays
  line?: number;
}
```

## Confidence Scoring
```typescript
interface ContractConfidence {
  score: number;                // 0.0-1.0 overall
  level: 'high' | 'medium' | 'low' | 'uncertain';
  matchConfidence: number;      // How sure we are about endpoint matching
  fieldExtractionConfidence: number;  // How sure we are about field extraction
}
```

## Storage

### SQLite (Primary)
`contract-repository.ts` — Full CRUD with:
- `contracts` table: endpoint, method, status, backend details, confidence, mismatches
- `contract_frontends` table: multiple frontend calls per contract
- Queries: by status, method, endpoint, mismatches, confidence
- State transitions: verify, markMismatch, ignore

### File-Based (Legacy)
`.drift/contracts/` directory:
- `discovered/` — Newly found contracts
- `mismatch/` — Contracts with field mismatches
- JSON format with schema version and checksums

## Query API
```typescript
interface ContractQueryOptions {
  filter?: {
    ids?: string[];
    status?: ContractStatus[];
    method?: HttpMethod[];
    endpoint?: string;
    hasMismatches?: boolean;
    minMismatches?: number;
    backendFile?: string;
    frontendFile?: string;
    minConfidence?: number;
    search?: string;
  };
  sort?: { field: string; direction: 'asc' | 'desc' };
  pagination?: { offset?: number; limit?: number };
}
```

## Statistics
```typescript
interface ContractStats {
  totalContracts: number;
  byStatus: Record<ContractStatus, number>;
  byMethod: Record<HttpMethod, number>;
  totalMismatches: number;
  mismatchesByType: Record<MismatchType, number>;
  lastUpdated: string;
}
```

## MCP Integration
Exposed via `drift_contracts_list` and related MCP tools for AI-assisted contract review.

## V2 Notes
- Backend endpoint extraction should use Rust parsers (framework-specific AST patterns)
- Frontend API call extraction is TS-specific — can stay TS
- Field comparison and mismatch detection is pure logic — ideal for Rust
- SQLite storage is already well-structured — keep as-is
- Path normalization (converting framework-specific route syntax) should be unified in Rust
