# Security Infrastructure — Overview

## Location
- `packages/core/src/boundaries/` — TypeScript (~12 files): data access detection, boundary enforcement
- `crates/drift-core/src/boundaries/` — Rust (4 files): data access detection, sensitive field detection
- `packages/core/src/call-graph/analysis/reachability.ts` — Reachability analysis
- `packages/core/src/call-graph/enrichment/sensitivity-classifier.ts` — Sensitivity classification

## What It Is
Drift's security infrastructure answers the fundamental question: "What sensitive data can this code reach?" It combines data access detection (boundaries), sensitive field identification, reachability analysis through the call graph, and security prioritization to build a complete picture of data flow and access patterns.

## Core Design Principles
1. Learn-then-detect: first discover YOUR data access patterns, then use them for detection
2. Reachability-first: security analysis follows actual code paths, not static assumptions
3. Sensitivity classification: PII, credentials, financial, health data are automatically detected
4. Confidence-scored: every detection includes a confidence breakdown explaining WHY
5. Multi-ORM: supports 28+ ORM frameworks across 8 languages

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│              Security Analysis Pipeline                   │
├──────────┬──────────┬──────────┬────────────────────────┤
│ Boundary │ Sensitive│ Reachab. │   Security             │
│ Scanner  │ Field    │ Engine   │   Prioritizer          │
│          │ Detector │          │                        │
├──────────┴──────────┴──────────┴────────────────────────┤
│              Data Access Learning                        │
│  DataAccessLearner │ Field Extractors (7 ORM-specific)  │
├─────────────────────────────────────────────────────────┤
│              Storage & Enforcement                       │
│  BoundaryStore │ BoundaryRules │ Violation Detection    │
├─────────────────────────────────────────────────────────┤
│              Rust Core (crates/drift-core)               │
│  DataAccessDetector │ SensitiveFieldDetector             │
└─────────────────────────────────────────────────────────┘
```

## Subsystem Directory Map

| File | Purpose | Doc |
|------|---------|-----|
| `boundary-scanner.ts` | Two-phase data access detection (learn + detect) | [boundary-scanner.md](./boundary-scanner.md) |
| `data-access-learner.ts` | Learns data access conventions from your codebase | [learning.md](./learning.md) |
| `boundary-store.ts` | Persistence, access maps, boundary rules, violation checking | [store.md](./store.md) |
| `security-prioritizer.ts` | Classifies and prioritizes security findings | [prioritization.md](./prioritization.md) |
| `table-name-validator.ts` | Validates detected table names (filters noise) | [boundary-scanner.md](./boundary-scanner.md) |
| `field-extractors/` | ORM-specific field extraction (7 extractors) | [field-extractors.md](./field-extractors.md) |
| `types.ts` | All boundary/security types | [types.md](./types.md) |

## The Security Analysis Flow

```
1. LEARN Phase
   DataAccessLearner scans codebase → learns frameworks, table names, naming conventions
   
2. DETECT Phase
   BoundaryScanner uses learned patterns + regex fallback → DataAccessPoint[]
   Field extractors extract ORM-specific fields → ORMModel[]
   SensitiveFieldDetector identifies PII/credentials/financial/health → SensitiveField[]
   
3. STORE Phase
   BoundaryStore persists access map, models, sensitive fields
   
4. ANALYZE Phase
   ReachabilityEngine traces data flow through call graph
   SecurityPrioritizer classifies and ranks findings
   
5. ENFORCE Phase
   BoundaryRules define allowed access patterns
   Violation detection flags unauthorized access
```

## Supported ORM Frameworks (28+)

| Language | Frameworks |
|----------|-----------|
| C# | EF Core, Dapper |
| Python | Django, SQLAlchemy, Tortoise, Peewee |
| TypeScript/JS | Prisma, TypeORM, Sequelize, Drizzle, Knex, Mongoose, Supabase |
| Java | Spring Data, Hibernate, jOOQ, MyBatis |
| PHP | Eloquent, Doctrine |
| Go | GORM, sqlx, Ent, Bun |
| Rust | Diesel, SeaORM, tokio-postgres, rusqlite |
| Generic | Raw SQL |

## Dedicated Field Extractors

| Extractor | ORM | What It Extracts |
|-----------|-----|-----------------|
| `prisma-extractor.ts` | Prisma | Models, fields, relations from schema.prisma |
| `django-extractor.ts` | Django | Models, CharField, ForeignKey, etc. |
| `sqlalchemy-extractor.ts` | SQLAlchemy | Declarative models, Column types |
| `supabase-extractor.ts` | Supabase | Table references, RPC calls |
| `gorm-extractor.ts` | GORM | Go struct tags, table names |
| `diesel-extractor.ts` | Diesel | Rust schema macros, table! declarations |
| `raw-sql-extractor.ts` | Raw SQL | SELECT/INSERT/UPDATE/DELETE parsing |

## Sensitive Data Detection

### Rust Implementation (`crates/drift-core/src/boundaries/sensitive.rs`)
Pattern-based detection with specificity scoring and false positive filtering:

| Category | Example Patterns | Specificity |
|----------|-----------------|-------------|
| **PII** | ssn (0.95), social_security (0.95), date_of_birth (0.9), email (0.65) | 0.5-0.95 |
| **Credentials** | password_hash (0.95), api_key (0.9), access_token (0.85), password (0.75) | 0.7-0.95 |
| **Financial** | credit_card (0.95), cvv (0.95), bank_account (0.9), salary (0.85) | 0.8-0.95 |
| **Health** | medical_record (0.95), diagnosis (0.9), prescription (0.9) | 0.9-0.95 |

### False Positive Filtering
Reduces confidence for:
- Function names containing sensitive words (validatePassword, checkEmail)
- Import statements
- Comments
- Mock/test/dummy prefixed names
- health_check / health_endpoint (not health data)

## Confidence Breakdown
Every data access detection includes a transparent confidence breakdown:
```typescript
interface ConfidenceBreakdown {
  tableNameFound: boolean;      // 0.3 weight
  fieldsFound: boolean;         // 0.2 weight
  operationClear: boolean;      // 0.2 weight
  frameworkMatched: boolean;     // 0.2 weight
  fromLiteral: boolean;         // 0.1 weight
  factors: { tableName, fields, operation, framework, literal };
  explanation: string;
}
```

## Security Prioritization
`SecurityPrioritizer` classifies findings into tiers:
- **Tier 1 (Critical)**: Direct access to credentials, financial data
- **Tier 2 (High)**: PII access, health data
- **Tier 3 (Medium)**: General data access with sensitive fields
- **Tier 4 (Low)**: Standard data access

Produces a `SecuritySummary` with counts by tier, top risks, and actionable recommendations.

## Boundary Rules & Enforcement
```typescript
interface BoundaryRules {
  rules: BoundaryRule[];
}

interface BoundaryRule {
  table: string;
  allowedFiles: string[];       // Glob patterns
  deniedFiles?: string[];
  allowedOperations?: DataOperation[];
  requireAuth?: boolean;
}
```

Violations are detected when code accesses data outside its allowed boundary.

## MCP Integration
- `drift_security_summary` — Security posture overview
- `drift_reachability` — Forward/inverse data reachability
- `drift_boundaries` — Data access map and boundary rules

## V2 Notes
- Boundary scanning is I/O + regex heavy — Rust gives 10-50x speedup
- Sensitive field detection already in Rust — expand pattern coverage
- Reachability analysis is graph traversal — Rust with SQLite CTEs
- Field extractors are ORM-specific parsing — move to Rust tree-sitter
- Security prioritization is pure logic — can go either way
- Boundary store is file I/O — stays TS
