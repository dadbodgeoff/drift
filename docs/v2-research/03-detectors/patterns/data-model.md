# Pattern Data Model

## Location
`packages/core/src/matcher/types.ts` — Core type definitions
`.drift/patterns/*.json` — Persisted pattern files (one per category)

## Purpose
Defines the canonical data structures for patterns, matches, locations, and confidence scores. Every pattern Drift discovers is represented by these types.

## Pattern File Structure (per category)

Each category gets its own JSON shard:

```typescript
interface PatternFile {
  version: "2.0.0";
  category: string;                    // e.g., "security", "structural"
  patterns: Pattern[];
  lastUpdated: string;                 // ISO-8601
  checksum: string;                    // 16-char hex integrity hash
  patternCount: number;
  statusCounts: {
    discovered: number;
    approved: number;
    ignored: number;
  };
}
```

Files: `security.json`, `auth.json`, `errors.json`, `components.json`, `config.json`, `data-access.json`, `documentation.json`, `logging.json`, `performance.json`, `structural.json`, `styling.json`, `testing.json`, `types.json`, `accessibility.json`

---

## Pattern

The core entity. One pattern = one detected convention in the codebase.

```typescript
interface Pattern {
  // Identity
  id: string;                          // 16-char hex hash
  subcategory: string;                 // e.g., "sql-injection", "file-naming"
  name: string;                        // Human-readable detector name
  description: string;                 // What this pattern learns

  // State
  status: "discovered" | "approved" | "ignored";
  detectionMethod: DetectionMethod;    // "ast" | "regex" | "semantic" | "structural" | "custom"

  // Detector reference
  detector: {
    type: DetectionMethod;
    config: {
      detectorId: string;              // e.g., "security/sql-injection"
      patternId: string;               // e.g., "security/sql-injection/property_access"
    };
  };

  // Scoring
  confidence: ConfidenceScore;
  confidenceLevel: ConfidenceLevel;

  // Locations
  locations: PatternLocation[];
  outliers: PatternLocation[];

  // Classification
  severity: "error" | "warning" | "info" | "hint";
  autoFixable: boolean;

  // Tracking
  metadata: {
    firstSeen: string;                 // ISO-8601
    lastSeen: string;                  // ISO-8601
    source: "auto-detected" | "user-defined" | "learned";
    tags: string[];                    // e.g., ["security", "sql-injection"]
  };
}
```

## Pattern ID Generation

Pattern IDs are 16-character hex strings derived from hashing:
- `detectorId` (e.g., "security/sql-injection")
- `patternId` (e.g., "security/sql-injection/property_access")

The `patternId` suffix indicates the match context type:
- `/unknown` — Generic match, context not classified
- `/assignment` — Found in assignment expressions (`const x = ...`)
- `/conditional` — Found in conditional expressions (`if (...)`)
- `/property_access` — Found in property access (`obj.prop`)
- `/import` — Found in import statements
- `/call` — Found in function calls

A single detector can produce multiple patterns with different context suffixes.

---

## ConfidenceScore

```typescript
interface ConfidenceScore {
  frequency: number;       // 0.0-1.0 — occurrences / totalLocations
  consistency: number;     // 0.0-1.0 — 1 - variance
  age: number;             // Days since firstSeen (0 = brand new)
  spread: number;          // Number of distinct files containing the pattern
  score: number;           // 0.0-1.0 — weighted composite
  level: ConfidenceLevel;  // Classification based on score thresholds
}

type ConfidenceLevel = "high" | "medium" | "low" | "uncertain";
```

### Thresholds
- `high`: score >= 0.85
- `medium`: score >= 0.70 and < 0.85
- `low`: score >= 0.50 and < 0.70
- `uncertain`: score < 0.50

---

## PatternLocation

```typescript
interface PatternLocation {
  file: string;            // Relative file path
  line: number;            // 1-indexed line number
  column: number;          // 1-indexed column number
  isOutlier: boolean;      // Whether this location deviates from the pattern
  confidence: number;      // 0.0-1.0 — per-location confidence
  outlierReason?: string;  // e.g., "Low confidence outlier", "Value below IQR lower bound"
}
```

---

## PatternMatch (detection output)

```typescript
interface PatternMatch {
  patternId: string;
  location: Location;
  confidence: number;
  isOutlier: boolean;
}
```

## PatternMatchResult (extended)

```typescript
interface PatternMatchResult extends PatternMatch {
  matchType: "ast" | "regex" | "structural";
  matchedNode?: ASTNode;
  matchedText?: string;
  captures?: Record<string, string>;
  outlierReason?: string;
  similarity?: number;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}
```

## AggregatedMatchResult (cross-file)

```typescript
interface AggregatedMatchResult {
  patternId: string;
  matches: PatternMatchResult[];
  confidence: ConfidenceScore;
  matchCount: number;
  outlierCount: number;
  files: string[];
}
```

---

## PatternDefinition (matching config)

Defines what to match against code:

```typescript
interface PatternDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategory?: string;
  matchType: "ast" | "regex" | "structural" | "semantic" | "custom";
  astConfig?: ASTMatchConfig;
  regexConfig?: RegexMatchConfig;
  structuralConfig?: StructuralMatchConfig;
  languages?: string[];
  includePatterns?: string[];      // File globs to include
  excludePatterns?: string[];      // File globs to exclude
  enabled: boolean;
  metadata?: PatternMetadata;
}
```

### ASTMatchConfig
```typescript
interface ASTMatchConfig {
  nodeType: string;
  query?: string;                  // Tree-sitter query syntax
  properties?: Record<string, unknown>;
  children?: ASTMatchConfig[];
  matchDescendants?: boolean;
  minDepth?: number;
  maxDepth?: number;
}
```

### RegexMatchConfig
```typescript
interface RegexMatchConfig {
  pattern: string;
  flags?: string;
  captureGroups?: string[];
  multiline?: boolean;
  contextLines?: number;
}
```

### StructuralMatchConfig
```typescript
interface StructuralMatchConfig {
  pathPattern?: string;
  directoryPattern?: string;
  namingPattern?: string;          // camelCase, PascalCase, kebab-case, etc.
  requiredSiblings?: string[];
  parentStructure?: string[];
  extension?: string;
}
```

---

## DetectionContext (input to detectors)

```typescript
interface DetectionContext {
  file: string;
  content: string;
  ast: AST | null;
  imports: ImportInfo[];
  exports: ExportInfo[];
  projectContext: {
    rootDir: string;
    files: string[];
    config: Record<string, unknown>;
  };
  language: Language;
  extension: string;
  isTestFile: boolean;
  isTypeDefinition: boolean;
}
```

## DetectionResult (output from detectors)

```typescript
interface DetectionResult {
  patterns: PatternMatch[];
  violations: Violation[];
  confidence: number;
  metadata?: {
    duration?: number;
    nodesAnalyzed?: number;
    warnings?: string[];
    custom?: Record<string, unknown>;
  };
}
```

---

## Rust Rebuild Considerations
- All types map cleanly to Rust structs with `serde` for JSON serialization
- `ConfidenceScore` is a simple struct — zero-cost in Rust
- `PatternLocation` arrays can be large (1000+ entries) — Rust's `Vec` handles this efficiently
- Pattern IDs use hex hashing — Rust's `xxhash` or `siphasher` are ideal
- The `PatternDefinition` enum variants map to Rust's `enum` with associated data
- JSON shard files can be replaced by SQLite reads in v2
