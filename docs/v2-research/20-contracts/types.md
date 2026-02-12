# Contract Types

## Location
`packages/core/src/types/contracts.ts` (~400 lines)

## Status & Lifecycle

```typescript
type ContractStatus = 'discovered' | 'verified' | 'mismatch' | 'ignored';
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
```

Lifecycle: `discovered → verified | mismatch | ignored`

---

## Field Types

### ContractField (recursive)
```typescript
interface ContractField {
  name: string;
  type: string;                 // 'string', 'number', 'boolean', 'object', 'array'
  optional: boolean;
  nullable: boolean;
  children?: ContractField[];   // Nested fields for objects
  arrayType?: string;           // Element type for arrays
  line?: number;
}
```

### FieldMismatch
```typescript
interface FieldMismatch {
  fieldPath: string;            // 'user.email' for nested
  mismatchType: 'missing_in_frontend' | 'missing_in_backend' | 'type_mismatch' | 'optionality_mismatch' | 'nullability_mismatch';
  backendField?: ContractField;
  frontendField?: ContractField;
  description: string;
  severity: 'error' | 'warning' | 'info';
}
```

### Mismatch Severity Rules
| Type | Severity | Meaning |
|------|----------|---------|
| `missing_in_frontend` | warning | Backend returns field, frontend ignores it (safe but wasteful) |
| `missing_in_backend` | error | Frontend expects field that backend doesn't return (runtime crash) |
| `type_mismatch` | error | Same field, different types (runtime type error) |
| `optionality_mismatch` | warning | Required vs optional disagreement |
| `nullability_mismatch` | warning | Nullable vs non-nullable disagreement |

---

## Endpoint Types

### BackendEndpoint
```typescript
interface BackendEndpoint {
  method: HttpMethod;
  path: string;                 // '/api/users/{id}' (framework syntax)
  normalizedPath: string;       // '/api/users/:id' (unified syntax)
  file: string;
  line: number;
  responseFields: ContractField[];
  requestFields?: ContractField[];
  responseTypeName?: string;    // Schema/model name if available
  framework: string;            // 'fastapi', 'express', 'flask', 'django', 'spring'
}
```

### FrontendApiCall
```typescript
interface FrontendApiCall {
  method: HttpMethod;
  path: string;                 // '/api/users/${id}' (template literal)
  normalizedPath: string;
  file: string;
  line: number;
  responseType?: string;        // TypeScript type name
  responseFields: ContractField[];
  requestType?: string;
  requestFields?: ContractField[];
  library: string;              // 'fetch', 'axios', 'react-query', 'angular-http'
}
```

---

## Contract Types

### ContractConfidence
```typescript
interface ContractConfidence {
  score: number;                // 0.0-1.0 overall
  level: 'high' | 'medium' | 'low' | 'uncertain';
  matchConfidence: number;      // Endpoint matching certainty
  fieldExtractionConfidence: number; // Field extraction certainty
}
```

### ContractMetadata
```typescript
interface ContractMetadata {
  firstSeen: string;            // ISO timestamp
  lastSeen: string;
  verifiedAt?: string;
  verifiedBy?: string;
  tags?: string[];
  custom?: Record<string, unknown>;
}
```

### Contract (primary entity)
```typescript
interface Contract {
  id: string;
  method: HttpMethod;
  endpoint: string;             // Normalized endpoint path
  backend: BackendEndpoint;
  frontend: FrontendApiCall[];  // Multiple calls to same endpoint
  mismatches: FieldMismatch[];
  status: ContractStatus;
  confidence: ContractConfidence;
  metadata: ContractMetadata;
}
```

### StoredContract (JSON file format)
Same as Contract but without `status` at top level (status is in the file name/directory).

### ContractFile (file wrapper)
```typescript
interface ContractFile {
  version: string;              // '1.0.0'
  status: ContractStatus;
  contracts: StoredContract[];
  lastUpdated: string;
  checksum?: string;
}
```

---

## Query Types

### ContractQuery
```typescript
interface ContractQuery {
  ids?: string[];
  status?: ContractStatus | ContractStatus[];
  method?: HttpMethod | HttpMethod[];
  endpoint?: string;            // Partial match
  hasMismatches?: boolean;
  minMismatches?: number;
  backendFile?: string;
  frontendFile?: string;
  minConfidence?: number;
  search?: string;
}
```

### ContractSortOptions
```typescript
interface ContractSortOptions {
  field: 'endpoint' | 'method' | 'mismatchCount' | 'confidence' | 'firstSeen' | 'lastSeen';
  direction: 'asc' | 'desc';
}
```

### ContractQueryOptions
```typescript
interface ContractQueryOptions {
  filter?: ContractQuery;
  sort?: ContractSortOptions;
  pagination?: { offset?: number; limit?: number };
}
```

### ContractQueryResult
```typescript
interface ContractQueryResult {
  contracts: Contract[];
  total: number;
  hasMore: boolean;
  executionTime: number;
}
```

---

## Statistics

### ContractStats
```typescript
interface ContractStats {
  totalContracts: number;
  byStatus: Record<ContractStatus, number>;
  byMethod: Record<HttpMethod, number>;
  totalMismatches: number;
  mismatchesByType: Record<FieldMismatch['mismatchType'], number>;
  lastUpdated: string;
}
```
