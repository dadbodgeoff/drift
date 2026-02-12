# Rust Boundaries

## Location
`crates/drift-core/src/boundaries/`

## Files
- `detector.rs` — Data access point detection (DB queries, API calls, file I/O)
- `sensitive.rs` — Sensitive field detection (PII, credentials, financial data)
- `types.rs` — `DataAccessPoint`, `DataOperation`, `SensitiveField`, `ORMModel`, `BoundaryScanResult`
- `mod.rs` — Module exports

## What It Does
- Scans source code for data access patterns (database queries, API calls, file operations)
- Detects ORM model definitions (Prisma, Django, SQLAlchemy, Entity Framework, etc.)
- Identifies sensitive fields (passwords, emails, SSNs, credit cards, API keys)
- Classifies data operations (read, write, delete, update)

## NAPI Exposure
- `scan_boundaries(files) -> JsBoundaryScanResult` — Scan files for boundaries
- `scan_boundaries_source(source, file_path) -> JsBoundaryScanResult` — Scan single source

## TS Counterpart
`packages/core/src/boundaries/` — Additional features:
- `boundary-store.ts` — Persistence
- `data-access-learner.ts` — Learning from patterns
- `security-prioritizer.ts` — Risk scoring
- `table-name-validator.ts` — Table name validation
- `field-extractors/` — ORM-specific extractors:
  - Prisma, Django, SQLAlchemy, Supabase, GORM, Diesel, Raw SQL

## v2 Notes
- Rust boundary detection is solid for basic detection.
- Needs: ORM-specific field extractors, learning capability, risk scoring.
