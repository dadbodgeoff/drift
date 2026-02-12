# Detector Learning System

## Location
`packages/detectors/src/base/learning-detector.ts` + `*-learning.ts` files in each category

## Core Concept
Learning detectors don't enforce arbitrary rules. They scan the codebase, discover what conventions the team actually uses, and flag deviations. If 90% of your files use camelCase, the learning detector will flag the 10% that don't — without you configuring anything.

## How It Works

### Phase 1: Learning (`learnFromProject`)
```
For each file in the project:
  1. Extract convention values (e.g., naming style, import order, etc.)
  2. Add each value to a ValueDistribution, tagged with the file
  
After all files:
  3. For each convention key, find the dominant value
  4. A value is "dominant" if it appears in ≥60% of files with ≥3 occurrences
  5. Store learned conventions with confidence scores
```

### Phase 2: Detection (`detect`)
```
For each file being analyzed:
  1. Extract the same convention values
  2. Compare against learned conventions
  3. If a value doesn't match the dominant convention → violation
  4. Violation includes: what was expected, what was found, confidence
```

## ValueDistribution Algorithm

The core data structure that tracks value frequency:

```typescript
class ValueDistribution<T> {
  // Track a value occurrence in a file
  add(value: T, file: string): void;
  
  // Find the dominant convention
  getDominant(config: PatternLearningConfig): LearnedConvention<T> | null;
  
  // Get all tracked values with counts
  getAll(): Array<{ value: T; count: number; files: string[] }>;
}
```

### Dominance Calculation
```
For each unique value:
  filePercentage = filesWithValue / totalFiles
  
  if filePercentage >= dominanceThreshold (default 0.6)
     AND occurrences >= minOccurrences (default 3):
    → This is the dominant convention
    → confidence = filePercentage
```

### Configuration
```typescript
interface PatternLearningConfig {
  minOccurrences: number;       // Default: 3
  dominanceThreshold: number;   // Default: 0.6 (60%)
  minFiles: number;             // Default: 2
}
```

## Example: SQL Injection Learning Detector

### Convention Keys
- `queryMethod`: orm | parameterized | tagged-template | escaped | raw
- `ormType`: prisma | drizzle | typeorm | sequelize | knex | none
- `usesEscaping`: boolean
- `usesValidation`: boolean

### Learning Phase
Scans all files for:
- ORM imports (Prisma, Drizzle, TypeORM, etc.)
- Parameterized query patterns (`?`, `$1`, `:name`)
- Tagged template literals (`sql\`...\``)
- Escape function calls
- Raw SQL string concatenation

### Detection Phase
If the project predominantly uses Prisma (ORM):
- Flags raw SQL queries as violations
- Flags use of a different ORM as inconsistency
- Reports confidence based on how dominant the convention is

## Convention Violation Output
```typescript
interface Violation {
  id: string;
  patternId: string;
  severity: 'info' | 'warning' | 'error';
  file: string;
  range: { start, end };
  message: string;
  expected: string;      // The dominant convention
  actual: string;        // What was found
  explanation: string;   // Why this is a violation
  aiExplainAvailable: boolean;
  aiFixAvailable: boolean;
}
```

## Learning Detectors by Category

Every category has learning variants. Some examples:

| Category | What It Learns |
|----------|---------------|
| `structural/file-naming-learning` | camelCase vs kebab-case vs PascalCase |
| `structural/import-ordering-learning` | Import group ordering conventions |
| `security/sql-injection-learning` | ORM vs parameterized vs raw queries |
| `auth/token-handling-learning` | JWT storage patterns (cookie vs localStorage) |
| `logging/log-levels-learning` | Which log levels are used where |
| `testing/describe-naming-learning` | Test describe block naming conventions |
| `styling/class-naming-learning` | BEM vs Tailwind vs CSS Modules |
| `config/env-naming-learning` | Environment variable naming (SCREAMING_SNAKE vs camelCase) |
| `components/state-patterns-learning` | useState vs useReducer vs Zustand |
| `types/interface-vs-type-learning` | Interface vs type alias preference |
