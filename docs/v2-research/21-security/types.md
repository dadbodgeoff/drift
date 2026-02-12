# Security — Types

## Location
- `packages/core/src/boundaries/types.ts` — TypeScript types
- `crates/drift-core/src/boundaries/types.rs` — Rust types

## Core Types

### DataAccessPoint
```typescript
interface DataAccessPoint {
  id: string;
  table: string;
  fields: string[];
  operation: DataOperation;     // read, write, delete, unknown
  file: string;
  line: number;
  column: number;
  context: string;              // Surrounding code
  confidence: number;           // 0.0-1.0
  confidenceBreakdown?: ConfidenceBreakdown;
  framework: ORMFramework;
  language: string;
}
```

### ORMFramework (28+ supported)
```typescript
type ORMFramework =
  // C#
  | 'efcore' | 'dapper'
  // Python
  | 'django' | 'sqlalchemy' | 'tortoise' | 'peewee'
  // TypeScript/JS
  | 'prisma' | 'typeorm' | 'sequelize' | 'drizzle' | 'knex' | 'mongoose' | 'supabase'
  // Java
  | 'spring-data' | 'hibernate' | 'jooq' | 'mybatis'
  // PHP
  | 'eloquent' | 'doctrine'
  // Go
  | 'gorm' | 'sqlx' | 'ent' | 'bun'
  // Rust
  | 'diesel' | 'sea-orm' | 'tokio-postgres' | 'rusqlite'
  // Generic
  | 'raw-sql' | 'unknown';
```

### SensitiveField
```typescript
interface SensitiveField {
  field: string;
  table: string | null;
  sensitivityType: SensitivityType;  // pii, credentials, financial, health, unknown
  file: string;
  line: number;
  confidence: number;
}
```

### ORMModel
```typescript
interface ORMModel {
  name: string;
  tableName: string | null;
  fields: string[];
  file: string;
  line: number;
  framework: ORMFramework;
  confidence: number;
}
```

### DataAccessMap
The aggregate view of all data access in the codebase:
```typescript
interface DataAccessMap {
  projectRoot: string;
  tables: Map<string, TableAccessInfo>;
  files: Map<string, FileAccessInfo>;
  models: ORMModel[];
  sensitiveFields: SensitiveField[];
  stats: AccessMapStats;
}
```

### BoundaryRule
```typescript
interface BoundaryRule {
  table: string;
  allowedFiles: string[];
  deniedFiles?: string[];
  allowedOperations?: DataOperation[];
  requireAuth?: boolean;
}
```

### BoundaryViolation
```typescript
interface BoundaryViolation {
  rule: BoundaryRule;
  accessPoint: DataAccessPoint;
  violationType: 'unauthorized_file' | 'unauthorized_operation' | 'missing_auth';
  message: string;
  severity: 'error' | 'warning';
}
```

## Rust Types

### DataAccessPoint (Rust)
```rust
struct DataAccessPoint {
    table: String,
    operation: DataOperation,    // Read, Write, Delete
    fields: Vec<String>,
    file: String,
    line: u32,
    confidence: f32,
    framework: Option<String>,
}
```

### SensitiveField (Rust)
```rust
struct SensitiveField {
    field: String,
    table: Option<String>,
    sensitivity_type: SensitivityType,  // Pii, Credentials, Financial, Health
    file: String,
    line: u32,
    confidence: f32,
}
```

### ORMModel (Rust)
```rust
struct ORMModel {
    name: String,
    table_name: String,
    fields: Vec<String>,
    file: String,
    line: u32,
    framework: String,
    confidence: f32,
}
```

## Type Parity Notes
- Rust types lack confidence breakdown (simpler scoring)
- TypeScript types include full confidence breakdown with weighted factors
- V2 should unify: Rust handles detection with full confidence, TS handles presentation
