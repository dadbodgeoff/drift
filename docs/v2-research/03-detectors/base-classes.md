# Detector Base Classes

## Location
`packages/detectors/src/base/`

## Hierarchy
```
BaseDetector (abstract)
├── RegexDetector          — Fast regex-based pattern matching
├── ASTDetector            — AST node traversal and pattern matching
├── StructuralDetector     — File/directory structure analysis
├── LearningDetector       — Learns conventions via ValueDistribution
├── SemanticDetector       — Keyword-based semantic analysis
├── SemanticLearningDetector — Combined semantic + learning
└── UnifiedDetector        — Multi-strategy with result merging
```

---

## BaseDetector (`base-detector.ts`)

Abstract base that all detectors extend.

### Required Properties
```typescript
abstract readonly id: string;           // e.g. 'security/sql-injection'
abstract readonly category: PatternCategory;
abstract readonly subcategory: string;
abstract readonly name: string;
abstract readonly description: string;
abstract readonly supportedLanguages: Language[];
abstract readonly detectionMethod: DetectionMethod;
```

### Required Method
```typescript
abstract detect(context: DetectionContext): Promise<DetectionResult>;
```

### Lifecycle Hooks
- `onRegister?()` — Called when registered in the registry
- `onFileChange?(file)` — Called when a file changes
- `onUnload?()` — Called when unloaded

### Helper Methods
- `supportsLanguage(language)` — Check language support
- `getInfo()` → `DetectorInfo` — Get metadata
- `createEmptyResult(confidence)` — Empty result factory
- `createPatternResult(patterns, confidence)` — Pattern-only result
- `createViolationResult(violations, confidence)` — Violation-only result
- `createResult(patterns, violations, confidence)` — Full result

---

## RegexDetector (`regex-detector.ts`)

For fast text-based pattern matching.

### Key Methods
- `matchAll(content, pattern, options?)` → `RegexMatch[]` — All matches with positions
- `matchLines(content, pattern)` → `LineMatch[]` — Line-by-line matching
- `extractCaptures(content, pattern)` → `CaptureResult[]` — Named/indexed captures
- `findPatternLocations(content, patterns[])` → `PatternLocation[]` — Multi-pattern search
- `hasMatch(content, pattern)` → `boolean` — Quick existence check
- `countMatches(content, pattern)` → `number` — Count occurrences
- `findFirst/findLast(content, pattern)` → `LineMatch | null`
- `matchInRange(content, pattern, startLine, endLine)` → `LineMatch[]`
- `getMatchingLines/getNonMatchingLines(content, pattern)` → `LineMatch[]`
- `createAlternationPattern(strings)` → `RegExp` — Build `(a|b|c)` pattern
- `createWordBoundaryPattern(strings)` → `RegExp` — Build `\b(a|b|c)\b` pattern

---

## ASTDetector (`ast-detector.ts`)

For AST-based detection using parsed syntax trees.

### Node Finding
- `findNodes(ast, nodeType)` → `ASTNode[]`
- `findNodesByTypes(ast, nodeTypes[])` → `ASTNode[]`
- `findFirstNode(ast, nodeType)` → `ASTNode | null`
- `findNodesWhere(ast, nodeType, predicate)` → `ASTNode[]`

### Tree Traversal
- `traverse(ast, visitor, options?)` — Walk the tree with enter/leave callbacks
- `traverseNode(node, visitor, options?)` — Walk from a specific node
- `findAncestor(node, ast, predicate)` → `ASTNode | null`
- `findAllAncestors(node, ast)` → `ASTNode[]`
- `findDescendants(node)` → `ASTNode[]`
- `findDescendantsByType(node, type)` → `ASTNode[]`

### Pattern Matching
- `matchPattern(ast, pattern)` → `ASTMatchResult[]` — Match structural AST patterns
  - Supports: nodeType, text (string/regex), exact matching, child patterns, min/max children

### Node Relationships
- `getParent(ast, node)`, `getParentChain(ast, node)`
- `getSiblings(ast, node)`, `getNextSibling`, `getPreviousSibling`
- `getChildrenByType`, `getFirstChildByType`, `hasChildOfType`, `hasDescendantOfType`
- `getNodeDepth(ast, node)`, `isLeafNode(node)`

### Node Content
- `getNodeText(node, content?)` — Extract text
- `getLineNumber(node)`, `getColumnNumber(node)`

---

## StructuralDetector (`structural-detector.ts`)

For file/directory structure analysis.

### Path Operations
- `matchPath(path, pattern, options?)` → `PathMatchResult`
- `matchFileName(path, pattern)` → `boolean`
- `getFileExtension`, `getFileName`, `getDirectoryPath`
- `getPathInfo(path)` → `PathInfo` (name, ext, dir, segments, depth)
- `isInDirectory(path, directory)` → `boolean`
- `getRelativePath`, `getCommonBasePath`, `getSiblingFiles`

### Naming Convention Detection
- `matchNamingConvention(name, convention)` → `NamingConventionResult`
- `detectNamingConvention(name)` → `NamingConvention | null`
  - Supports: camelCase, PascalCase, snake_case, kebab-case, SCREAMING_SNAKE_CASE
- `convertToConvention(name, convention)` → `string`

### File Classification
- `isTestFile(path)` — Detects `.test.`, `.spec.`, `__tests__/`
- `isTypeDefinitionFile(path)` — Detects `.d.ts`, `types.ts`
- `isIndexFile(path)` — Detects `index.*`
- `isConfigFile(path)` — Detects config files by name patterns

---

## LearningDetector (`learning-detector.ts`)

Learns conventions from the codebase using statistical analysis.

### ValueDistribution (core algorithm)
Tracks value frequency across files:
```typescript
class ValueDistribution<T> {
  add(value: T, file: string): void;
  getDominant(config): LearnedConvention<T> | null;
  getAll(): Array<{ value: T; count: number; files: string[] }>;
  getTotal(): number;
}
```

A value becomes "dominant" when it appears in ≥60% of files (configurable) with ≥3 occurrences.

### LearnedConvention
```typescript
interface LearnedConvention<T> {
  value: T;
  confidence: number;
  occurrences: number;
  files: string[];
}
```

### Abstract Methods (subclasses implement)
```typescript
abstract getConventionKeys(): Array<keyof TConventions>;
abstract extractConventions(context, distributions): void;
abstract detectWithConventions(context, conventions): Promise<DetectionResult>;
```

### Learning Flow
1. `learnFromProject(contexts[])` — Scans all files, builds distributions
2. `setLearnedConventions(result)` — Stores learned conventions
3. `detect(context)` — Uses learned conventions to find violations

### Helper Methods
- `matchesConvention(key, value)` → `boolean`
- `getLearnedValue(key)` → `T | undefined`
- `createConventionViolation(file, line, col, what, actual, expected, message)` → `Violation`

---

## SemanticDetector (`semantic-detector.ts`)

Keyword-based semantic analysis that learns usage patterns.

### Abstract Methods
```typescript
abstract getSemanticKeywords(): string[];
abstract getSemanticCategory(): string;
abstract createPatternViolation(match, dominantPattern): Violation;
```

### How It Works
1. Scans files for keyword occurrences
2. Classifies each occurrence by context type (function_call, import, assignment, etc.)
3. Learns dominant usage patterns across the project
4. Flags deviations from dominant patterns

### SemanticMatch
```typescript
interface SemanticMatch {
  keyword: string;
  matchedText: string;
  line: number;
  column: number;
  file: string;
  contextType: string;
  surroundingContext: string;
  confidence: number;
}
```

### UsagePattern
```typescript
interface UsagePattern {
  contextType: string;
  count: number;
  percentage: number;
  files: string[];
  examples: string[];
}
```

### Confidence Scoring
```
base = keyword match strength
+ boost for surrounding context relevance
+ boost for import/export alignment
- penalty for generic/ambiguous matches
```

---

## UnifiedDetector (`unified-detector.ts`)

Runs multiple detection strategies and merges results.

### Strategies
`'ast' | 'regex' | 'semantic' | 'structural' | 'custom'`

### Abstract Methods
```typescript
abstract getStrategies(): DetectionStrategy[];
abstract runStrategy(strategy, context, options?): Promise<StrategyResult>;
```

### Merge Algorithm
1. Run all supported strategies
2. Deduplicate patterns by location (keep highest confidence)
3. Deduplicate violations by file+line
4. Calculate combined confidence as weighted average
5. Return merged result

### MergeConfig
```typescript
interface MergeConfig {
  deduplicatePatterns: boolean;    // Default: true
  deduplicateViolations: boolean;  // Default: true
  confidenceStrategy: 'max' | 'average' | 'weighted';  // Default: 'weighted'
  weights: Record<DetectionStrategy, number>;
}
```

---

## SemanticLearningDetector (`semantic-learning-detector.ts`)
Combined semantic + learning capabilities. Currently a stub/placeholder for future implementation.
