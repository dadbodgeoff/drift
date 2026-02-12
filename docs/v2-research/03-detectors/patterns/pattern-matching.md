# Pattern Matching Engine

## Location
`packages/core/src/matcher/pattern-matcher.ts`

## Purpose
Multi-strategy pattern matching engine that takes a file context and a pattern definition, then finds all occurrences using AST, regex, or structural matching. Includes an LRU cache for performance.

## Files
- `pattern-matcher.ts` — `PatternMatcher` class
- `types.ts` — `PatternDefinition`, `MatcherConfig`, `MatcherContext`, `MatchingResult`

---

## Match Flow

```
1. Receive MatcherContext (file, content, AST, language) + PatternDefinition
2. Check file filters (language, include/exclude globs)
3. Check cache (LRU, keyed by file:patternId, validated by content hash)
4. Route to strategy based on matchType:
   - "ast"        → matchAST()
   - "regex"      → matchRegex()
   - "structural" → matchStructural()
   - "semantic"   → falls back to matchAST()
   - "custom"     → not implemented
5. Filter results (min confidence, max matches)
6. Cache results
7. Return PatternMatchResult[]
```

---

## Strategy 1: AST Matching

Traverses the parsed AST depth-first, matching nodes against the pattern config.

### ASTMatchConfig
```typescript
interface ASTMatchConfig {
  nodeType: string;                    // Required: AST node type to match
  query?: string;                      // Tree-sitter query syntax
  properties?: Record<string, unknown>; // Properties to match on the node
  children?: ASTMatchConfig[];         // Child node patterns
  matchDescendants?: boolean;          // Search descendants, not just children
  minDepth?: number;                   // Minimum tree depth
  maxDepth?: number;                   // Maximum tree depth
}
```

### Matching Algorithm
```
For each node in AST (depth-first traversal):
  1. Check nodeType matches
  2. Check depth constraints (minDepth, maxDepth)
  3. Check property matches:
     - String values: exact match
     - Regex values (string starting with /): regex test
     - Other: deep equality
  4. Check child patterns (recursive):
     - If matchDescendants: search all descendants
     - Else: search direct children only
  5. Calculate confidence:
     confidence = matchedChecks / totalChecks × childConfidence
```

### Confidence Calculation
```
totalChecks = 1 (nodeType) + propertyCount + childPatternCount
matchedChecks = count of passing checks
childConfidence = average confidence of matched children (1.0 if no children)
confidence = (matchedChecks / totalChecks) × childConfidence
```

---

## Strategy 2: Regex Matching

Regular expression matching with capture group support.

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

### Matching Algorithm
```
1. Compile regex with global flag (always)
2. Apply multiline flag if configured
3. Execute regex.exec() in a loop for all matches
4. For each match:
   - Convert string index to line:column location
   - Extract named/indexed capture groups
   - Confidence is always 1.0 (binary match)
5. Return PatternMatchResult[] with matchedText and captures
```

### Index-to-Location Conversion
```
Iterate through content character by character:
  Track line number (increment on \n)
  Track column (reset on \n)
  When character index matches target → return {line, column}
```

---

## Strategy 3: Structural Matching

File path, directory, and naming convention matching.

### StructuralMatchConfig
```typescript
interface StructuralMatchConfig {
  pathPattern?: string;          // Glob pattern for file path
  directoryPattern?: string;     // Glob pattern for directory
  namingPattern?: string;        // Naming convention to match
  requiredSiblings?: string[];   // Files that must exist alongside
  parentStructure?: string[];    // Required parent directory structure
  extension?: string;            // File extension to match
}
```

### Matching Algorithm
```
All checks must pass (AND logic):

1. pathPattern → glob match against full file path
2. directoryPattern → glob match against directory portion
3. namingPattern → naming convention match against filename
   Supported: PascalCase, camelCase, kebab-case, snake_case, SCREAMING_SNAKE_CASE
4. extension → exact match against file extension
5. requiredSiblings → check sibling files exist
6. parentStructure → check parent directory names

Confidence = 1.0 if all checks pass, 0.0 otherwise
```

### Naming Convention Detection
```
PascalCase:        /^[A-Z][a-zA-Z0-9]*$/
camelCase:         /^[a-z][a-zA-Z0-9]*$/
kebab-case:        /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
snake_case:        /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/
SCREAMING_SNAKE:   /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/
```

---

## Caching

LRU cache with content-hash validation.

### Configuration
```typescript
interface MatcherCacheConfig {
  enabled: boolean;
  maxSize?: number;    // Default: 1000 entries
  ttl?: number;        // Default: 60000ms (60 seconds)
}
```

### Cache Key
```
key = `${file}:${patternId}`
```

### Cache Validation
Each entry stores a content hash. On cache hit:
1. Check TTL (reject if expired)
2. Compare content hash (reject if file changed)
3. Return cached results if valid

### Eviction
When cache exceeds `maxSize`, evict the oldest entry (by timestamp).

---

## File Filtering

Before matching, patterns are filtered by file applicability:

```
1. Language filter: pattern.languages includes file language
2. Include patterns: file matches at least one glob in includePatterns
3. Exclude patterns: file does NOT match any glob in excludePatterns
```

If no language/include/exclude filters are set, the pattern applies to all files.

---

## MatcherConfig

```typescript
interface MatcherConfig {
  confidenceWeights?: Partial<ConfidenceWeights>;
  minConfidence?: number;              // Filter results below this
  detectOutliers?: boolean;
  outlierSensitivity?: number;         // 0.0-1.0
  maxMatchesPerPattern?: number;       // Limit results
  includeAstNodes?: boolean;           // Include AST nodes in results
  includeMatchedText?: boolean;        // Include matched text in results
  timeout?: number;                    // Matching timeout (ms)
  cache?: MatcherCacheConfig;
}
```

---

## Batch Matching

```typescript
matchAll(
  context: MatcherContext,
  patterns: PatternDefinition[],
  options?: MatchOptions
): MatchingResult
```

Runs all patterns against a single file context. Returns combined `MatchingResult` with all matches, outliers, duration, and errors.

---

## Error Handling

Matching errors are non-fatal. Each error includes:
```typescript
interface MatchingError {
  message: string;
  code?: string;
  patternId?: string;
  recoverable: boolean;    // Whether matching can continue
}
```

Recoverable errors (e.g., invalid regex) skip the pattern. Non-recoverable errors abort the file.

---

## Rust Rebuild Considerations
- AST matching maps naturally to tree-sitter queries in Rust — significantly faster
- Regex matching can use Rust's `regex` crate (compiled, no backtracking)
- Structural matching is string operations — trivial in Rust
- The LRU cache can be replaced by Rust's built-in performance (or `lru` crate)
- Glob matching: use `globset` crate for compiled glob patterns
- Content hashing: use `xxhash` for fast non-cryptographic hashing
- The `matchAll` batch operation is a good parallelization target with `rayon`
