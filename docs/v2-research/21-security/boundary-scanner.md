# Security — Boundary Scanner

## Location
`packages/core/src/boundaries/boundary-scanner.ts`

## Purpose
The BoundaryScanner is the primary entry point for data access detection. It uses a two-phase approach: first LEARN from your codebase, then DETECT using learned patterns with regex as fallback.

## Class: BoundaryScanner

### Configuration
```typescript
interface BoundaryScannerConfig {
  rootDir: string;
  verbose?: boolean;
  skipLearning?: boolean;      // Use regex only (not recommended)
}
```

### Two-Phase Approach

#### Phase 1: LEARN
The `DataAccessLearner` scans the codebase to discover:
- Which ORM frameworks are used
- What table names exist
- Naming conventions (snake_case, camelCase, PascalCase)
- Variable-to-table mappings
- Framework-specific access patterns

This ensures detection is based on YOUR code, not hardcoded assumptions.

#### Phase 2: DETECT
Using learned patterns + regex fallback:
1. For each source file:
   a. Check if it's a data access file (skip test files, check for ORM patterns)
   b. Run ORM-specific field extractors
   c. Extract data access points (table, fields, operation, confidence)
   d. Extract ORM models
   e. Detect sensitive fields
2. Aggregate into `BoundaryScanResult`

### Language Support
Detects data access files for: Python, TypeScript, JavaScript, C#, PHP, Java, Go, Rust, C++

### Data Access File Detection
A file is considered a data access file if it contains ORM patterns:
- C#: DbSet, DbContext, Entity, Table, Column
- Python: models.Model, CharField, ForeignKey, declarative_base
- TypeScript: @Entity, @Column, prisma, model, schema
- Java: @Entity, @Table, @Repository, JpaRepository
- PHP: Eloquent, Model, belongsTo, hasMany
- Go: gorm.Model, db.Where, db.Find
- Rust: diesel::table, #[derive(Queryable)]
- And many more...

### Output
```typescript
interface BoundaryScanResult {
  accessPoints: DataAccessPoint[];
  models: ORMModel[];
  sensitiveFields: SensitiveField[];
  stats: {
    filesScanned: number;
    dataAccessFiles: number;
    totalAccessPoints: number;
    totalModels: number;
    totalSensitiveFields: number;
  };
}
```

## Rust Implementation
`crates/drift-core/src/boundaries/detector.rs` — `DataAccessDetector`:
- Detects data access from AST (tree-sitter parse results)
- Detects SQL in source code (raw SQL pattern matching)
- Detects from call sites (function calls that access data)
- Significantly faster than TS implementation for large codebases

## V2 Notes
- The learn-then-detect pattern is excellent — preserve in Rust
- ORM pattern detection should use tree-sitter AST in Rust
- Table name validation should move to Rust
- The two-phase approach reduces false positives significantly
