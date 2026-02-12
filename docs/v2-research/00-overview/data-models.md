# Core Data Models

## Pattern (the central entity)
```typescript
{
  id: string;
  category: PatternCategory;     // api|auth|components|config|data-access|documentation|errors|logging|performance|security|structural|styling|testing|types|validation
  subcategory: string;
  name: string;
  description: string;
  status: 'discovered' | 'approved' | 'ignored';
  detector: DetectorConfig;       // { type, config, ... }
  confidence: ConfidenceScore;    // { score, level, frequency, consistency, age, spread }
  severity: 'error' | 'warning' | 'info' | 'hint';
  locations: PatternLocation[];   // { file, line, column, endLine, endColumn, snippet, confidence }
  outliers: OutlierLocation[];    // { file, line, column, reason, deviationScore }
  metadata: { firstSeen, lastSeen, approvedAt, approvedBy, tags }
}
```

## Violation
```typescript
{
  id: string;
  patternId: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  file: string;
  range: { start: {line, character}, end: {line, character} };
  expected: string;
  actual: string;
  quickFixes: QuickFix[];         // { title, edits: WorkspaceEdit[] }
}
```

## Contract (BE↔FE)
```typescript
{
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  backend: BackendEndpoint;       // { method, path, file, line, responseFields, framework }
  frontend: FrontendApiCall[];    // { method, path, file, line, responseFields, library }
  mismatches: FieldMismatch[];    // { fieldPath, mismatchType, description, severity }
  status: 'discovered' | 'verified' | 'mismatch' | 'ignored';
  confidence: ContractConfidence; // { score, level, matchConfidence, fieldExtractionConfidence }
}
```

## Memory (Cortex)
```typescript
{
  id: string;
  type: MemoryType;               // 25 types: core|tribal|procedural|semantic|episodic|...
  summary: string;                // ~20 token summary
  confidence: number;             // 0.0-1.0
  importance: 'low' | 'normal' | 'high' | 'critical';
  transactionTime: { recordedAt };
  validTime: { validFrom, validUntil? };
  accessCount: number;
  linkedPatterns?: string[];
  linkedConstraints?: string[];
  linkedFiles?: string[];
  linkedFunctions?: string[];
  tags?: string[];
  archived?: boolean;
  supersededBy?: string;
}
```

## Rust ParseResult
```rust
{
  language: Language,             // 10 languages
  tree: Option<tree_sitter::Tree>,
  functions: Vec<FunctionInfo>,   // { name, qualified_name, parameters, return_type, is_exported, is_async, range, decorators, doc_comment }
  classes: Vec<ClassInfo>,        // { name, extends, implements, is_exported, is_abstract, methods, properties, range, decorators }
  imports: Vec<ImportInfo>,       // { source, named, default, namespace, is_type_only, range }
  exports: Vec<ExportInfo>,       // { name, original_name, from_source, is_type_only, is_default, range }
  calls: Vec<CallSite>,          // { callee, receiver, arg_count, range }
  errors: Vec<ParseError>,
}
```

## DriftConfig
```typescript
{
  severity?: Record<string, Severity>;  // Pattern severity overrides
  ignore?: string[];                     // Files/folders to ignore
  ai?: { provider, model };             // AI provider config
  ci?: { failOn, reportFormat };         // CI mode settings
  learning?: { autoApproveThreshold, minOccurrences };
  performance?: { maxWorkers, cacheEnabled, incrementalAnalysis };
}
```

Config file: `drift.config.json` in project root.
Environment overrides: `DRIFT_AI_PROVIDER`, `DRIFT_AI_MODEL`, `DRIFT_CI_FAIL_ON`, etc.
