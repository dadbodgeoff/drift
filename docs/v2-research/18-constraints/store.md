# Constraints — Store

## Location
`packages/core/src/constraints/store/constraint-store.ts`

## Purpose
File-based persistence for constraints. Stores constraints as JSON files in `.drift/constraints/`, organized by category (discovered vs user-defined). Provides CRUD operations, querying, lifecycle management (approve/ignore), and index maintenance.

## Class: ConstraintStore

### Storage Layout
```
.drift/constraints/
├── discovered/
│   ├── api.json
│   ├── auth.json
│   ├── security.json
│   └── structural.json
├── index.json              # Category index for fast lookups
└── (custom constraints stored alongside)
```

### Key Methods

| Method | Purpose |
|--------|---------|
| `initialize()` | Load all constraints from disk, rebuild index if needed |
| `add(constraint)` | Add a single constraint |
| `addMany(constraints)` | Batch add constraints |
| `get(id)` | Get constraint by ID |
| `getAll()` | Get all constraints |
| `update(id, updates)` | Partial update |
| `delete(id)` | Remove constraint |
| `approve(id, approvedBy?)` | Transition to approved status |
| `ignore(id, reason?)` | Transition to ignored status |
| `query(options)` | Filtered, sorted, paginated query |
| `getForFile(filePath)` | Get constraints applicable to a file |
| `getByCategory(category)` | Filter by category |
| `getByStatus(status)` | Filter by status |
| `getActive(minConfidence)` | Get approved constraints above confidence threshold |
| `getCounts()` | Summary counts by category and status |
| `getSummaries()` | Lightweight summaries for listing |

### File Applicability
`getForFile()` checks constraint scope against file path:
- Glob pattern matching on `scope.files`
- Directory matching on `scope.directories`
- Language matching based on file extension

### Index
`index.json` maintains a category-based index for fast lookups without loading all constraint files. Rebuilt automatically when constraints change.

## V2 Notes
- File-based storage works for small-medium constraint sets
- For large codebases with thousands of constraints, consider SQLite migration
- Index rebuild is O(n) — acceptable for current scale
- Store is not performance-critical — stays TS
