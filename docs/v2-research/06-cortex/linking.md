# Cortex Linking System

## Location
`packages/cortex/src/linking/`

## Purpose
Links memories to Drift entities (patterns, constraints, files, functions, decisions) for cross-referencing and retrieval.

## Files
- `pattern-linker.ts` — `PatternLinker`: links memories to patterns
- `constraint-linker.ts` — `ConstraintLinker`: links memories to constraints
- `file-linker.ts` — `FileLinker`: links memories to files (with citations)
- `function-linker.ts` — `FunctionLinker`: links memories to call graph functions
- `decision-linker.ts` — `DecisionLinker`: links memories to decisions/ADRs

## Link Types

### Pattern Links
- Stored in `memory_patterns` table
- Enables: "What do we know about this pattern?"
- Used by retrieval engine for pattern-based candidate gathering

### Constraint Links
- Stored in `memory_constraints` table
- Enables: "What memories relate to this constraint?"
- Used for constraint override tracking

### File Links (with Citations)
- Stored in `memory_files` table
- Includes: `line_start`, `line_end`, `content_hash`
- Content hash enables drift detection (file changed since memory was created)
- Used by validation engine for citation checking

### Function Links
- Stored in `memory_functions` table
- Links to call graph function IDs
- Enables: "What do we know about this function?"

### Decision Links
- Links memories to decision records / ADRs
- Enables tracing decisions back to their context

## Rust Rebuild Considerations
- Linking is pure database operations — straightforward in Rust
- Citation content hashing benefits from Rust's hashing speed
- Consider batch linking for bulk memory creation
