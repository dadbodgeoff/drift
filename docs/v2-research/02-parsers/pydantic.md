# Pydantic Model Extraction

## Location
`packages/core/src/parsers/tree-sitter/pydantic/` — 9 files

## Purpose
Extracts Pydantic v1 and v2 model definitions from Python source code. This is critical for API contract detection — Pydantic models define request/response shapes in FastAPI, which feed into the contract tracker.

## File Inventory

| File | Purpose |
|------|---------|
| `pydantic-extractor.ts` | Main orchestrator — coordinates all sub-extractors |
| `field-extractor.ts` | Extracts field definitions (name, type, default, alias) |
| `type-resolver.ts` | Resolves type annotations (Optional, List, Dict, Union, nested models) |
| `constraint-parser.ts` | Parses Field() constraints (ge, le, gt, lt, min_length, max_length, pattern, multiple_of) |
| `validator-extractor.ts` | Extracts @field_validator and @model_validator decorators |
| `config-extractor.ts` | Extracts model Config class / model_config dict |
| `inheritance-resolver.ts` | Resolves base class chains (Model → BaseModel hierarchy) |
| `types.ts` | All Pydantic-specific type definitions |
| `index.ts` | Public exports |

## Data Model

### PydanticModelInfo
```typescript
interface PydanticModelInfo {
  name: string;
  bases: string[];                    // Base classes
  fields: PydanticFieldInfo[];
  validators: PydanticValidatorInfo[];
  config: PydanticConfigInfo | null;
  startPosition: Position;
  endPosition: Position;
  isPydanticV2: boolean;              // v1 vs v2 detection
}
```

### PydanticFieldInfo
```typescript
interface PydanticFieldInfo {
  name: string;
  type: TypeInfo;
  default: string | null;
  defaultFactory: string | null;
  alias: string | null;
  description: string | null;
  constraints: FieldConstraints;
  isRequired: boolean;
  isOptional: boolean;
  startPosition: Position;
  endPosition: Position;
}
```

### TypeInfo
```typescript
interface TypeInfo {
  name: string;                       // e.g., "str", "List", "Optional"
  args: TypeInfo[];                   // Generic args: List[str] → args=[{name:"str"}]
  isOptional: boolean;
  unionMembers: TypeInfo[];           // Union[str, int] → members
  raw: string;                        // Original text
}
```

### FieldConstraints
```typescript
interface FieldConstraints {
  ge?: number;          // Greater than or equal
  le?: number;          // Less than or equal
  gt?: number;          // Greater than
  lt?: number;          // Less than
  minLength?: number;
  maxLength?: number;
  pattern?: string;     // Regex pattern
  multipleOf?: number;
}
```

### PydanticValidatorInfo
```typescript
interface PydanticValidatorInfo {
  name: string;
  fields: string[];                   // Fields this validator applies to
  mode: 'before' | 'after' | 'wrap'; // Validation mode
  isClassMethod: boolean;
  startPosition: Position;
  endPosition: Position;
}
```

### PydanticConfigInfo
```typescript
interface PydanticConfigInfo {
  extra: 'allow' | 'forbid' | 'ignore' | null;
  frozen: boolean | null;
  validateAssignment: boolean | null;
  populateByName: boolean | null;     // v2: alias population
  useEnumValues: boolean | null;
  strictMode: boolean | null;
  jsonSchemaExtra: string | null;
}
```

## Extraction Pipeline

```
1. PydanticExtractor.extract(tree, source)
2. Find all class definitions that extend BaseModel (or known Pydantic bases)
3. For each model:
   a. InheritanceResolver: resolve base class chain
   b. FieldExtractor: extract all field definitions
   c. For each field:
      - TypeResolver: resolve type annotation (handles Optional, Union, List, Dict, nested)
      - ConstraintParser: parse Field() arguments
   d. ValidatorExtractor: find @field_validator / @model_validator decorators
   e. ConfigExtractor: extract Config class or model_config dict
4. Return PydanticModelInfo[]
```

## Type Resolution

The `TypeResolver` handles complex Python type annotations:
- Simple: `str`, `int`, `float`, `bool`
- Optional: `Optional[str]` → `{name: "str", isOptional: true}`
- Generic: `List[str]`, `Dict[str, int]`, `Set[User]`
- Union: `Union[str, int]` or `str | int` (Python 3.10+)
- Nested: `List[Optional[Dict[str, List[int]]]]`
- Circular reference protection via `maxTypeDepth` (default: 10)

## Pydantic v1 vs v2 Detection

| Feature | v1 | v2 |
|---------|----|----|
| Base class | `BaseModel` | `BaseModel` |
| Config | `class Config:` | `model_config = ConfigDict(...)` |
| Validators | `@validator` | `@field_validator` |
| Root validators | `@root_validator` | `@model_validator` |
| Field alias | `Field(alias="x")` | `Field(alias="x")` |
| Frozen | `class Config: allow_mutation = False` | `model_config = ConfigDict(frozen=True)` |

## v2 Rust Port Considerations
- This is one of the most complex TS-only features to port
- Type resolution requires recursive AST traversal with cycle detection
- Constraint parsing requires understanding Python function call argument patterns
- Validator extraction requires decorator argument parsing
- Config extraction differs between Pydantic v1 and v2
- Consider using tree-sitter queries for the heavy lifting (already done in Rust for other languages)
- The inheritance resolver needs access to cross-file information (base classes may be in other files)
- Priority: P0 — FastAPI contract detection depends on this
