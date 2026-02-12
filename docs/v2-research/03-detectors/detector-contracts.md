# Detector Behavioral Contracts

## Input/Output Types

### DetectionContext (input to every detector)
```typescript
interface DetectionContext {
  file: string;           // File path being analyzed
  content: string;        // Full file content
  ast: unknown | null;    // Parsed AST (if available)
  imports: ImportInfo[];   // Import statements
  exports: ExportInfo[];   // Export statements
  projectContext: ProjectContext;
}

interface ImportInfo {
  module: string;
  namedImports: string[];
  defaultImport?: string;
  isTypeOnly: boolean;
}

interface ExportInfo {
  name: string;
  isDefault: boolean;
  isTypeOnly: boolean;
}

interface ProjectContext {
  rootDir: string;
  files: string[];
  config: Record<string, unknown>;
}
```

### DetectionResult (output from every detector)
```typescript
interface DetectionResult {
  patterns: PatternMatch[];   // Patterns found
  violations: Violation[];    // Violations found
  confidence: number;         // Overall confidence 0.0-1.0
}
```

---

## Key Algorithms

### LearningDetector — ValueDistribution
Tracks value frequency across files. When a value appears in >60% of files (configurable), it becomes the "dominant convention." Deviations become violations.

```
add(value, file) → track occurrence
getDominant(config) → LearnedConvention | null
  - Requires minOccurrences (default: 3)
  - Requires dominanceThreshold (default: 0.6 = 60%)
  - Returns: { value, confidence, occurrences, files }
```

### SemanticDetector — Confidence Scoring
```
calculateConfidenceScore(match, context) → number
  - Base: keyword match strength
  - Boost: surrounding context relevance
  - Boost: import/export alignment
  - Penalty: generic/ambiguous matches
```

### UnifiedDetector — Strategy Merging
Runs multiple detection strategies, merges results:
- Deduplicates patterns by location
- Keeps highest confidence when duplicates found
- Calculates combined confidence as weighted average
- Merges violations, deduplicating by file+line

### ContractMatcher — Path Similarity
Multi-factor weighted path matching:
- Segment name Jaccard similarity
- Segment count similarity
- Suffix match scoring
- Resource name matching
- Parameter position alignment

### OutlierDetector — Statistical Detection
Two methods based on sample size:
- Z-Score (n >= 30): Standard deviation-based
- IQR (n < 30): Interquartile range-based

Significance classification:
- |z| > 3.0 → extreme
- |z| > 2.5 → high
- |z| > 2.0 → moderate
- |z| > 1.5 → low

---

## Detector Lifecycle

```
1. Registration: detector.onRegister() called
2. Learning: detector.learnFromProject(contexts[]) — scans all files
3. Detection: detector.detect(context) — analyzes single file
4. File Change: detector.onFileChange(file) — notified of changes
5. Unload: detector.onUnload() — cleanup
```

---

## Registry System
- `DetectorRegistry` — Central registry with enable/disable, query, events
- Supports lazy loading via factory functions
- Query by: category, language, enabled status, detection method
- Events: registered, unregistered, enabled, disabled
- Thread-safe file change notifications

---

## Quick Fix Support
Detectors can optionally provide auto-fix suggestions:
```typescript
generateQuickFix(violation: Violation): QuickFix | null
```

---

## Type Guards
Each base class provides a type guard function:
- `isBaseDetector(obj)` → `obj is BaseDetector`
- `isRegexDetector(detector)` → `detector is RegexDetector`
- `isASTDetector(detector)` → `detector is ASTDetector`
- `isStructuralDetector(detector)` → `detector is StructuralDetector`
- `isUnifiedDetector(detector)` → `detector is UnifiedDetector`
