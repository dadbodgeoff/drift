# Approach Generator

## Location
`packages/core/src/simulation/approach-generator.ts`

## Purpose
Generates candidate implementation approaches for a given task. Detects the task category, target language, and framework, then produces language-specific strategy templates as concrete approaches.

## Configuration

```typescript
interface ApproachGeneratorConfig {
  projectRoot: string;
  patternService?: IPatternService;
  callGraph?: CallGraph;
}
```

## Pipeline: `generate(task) → GeneratedApproaches`

### Step 1: Detect Task Category
Uses keyword matching against the task description. 12 category keyword sets with weights:

```typescript
// Example: "add rate limiting to the API"
// Matches: 'rate limit' (weight 1.0) → category: 'rate-limiting'
```

Categories: `rate-limiting`, `authentication`, `authorization`, `api-endpoint`, `data-access`, `error-handling`, `caching`, `logging`, `testing`, `validation`, `middleware`, `refactoring`, `generic`

### Step 2: Detect Language and Framework
1. Scan project files to determine primary language
2. Read file contents to detect framework (import patterns, decorators)
3. Falls back to TypeScript if detection fails

### Step 3: Find Relevant Files
Searches the project for files matching the task category's keywords. Uses file path matching and content scanning.

### Step 4: Find Relevant Patterns
If `PatternService` is available, queries for patterns matching the task category.

### Step 5: Generate Approaches
For each `StrategyTemplate` from the language strategy provider:
1. Create a `SimulationApproach` with:
   - Strategy name and description
   - Target files (from step 3)
   - Target functions (if call graph available)
   - New files to create
   - Patterns to follow
   - Estimated lines added/modified
   - Framework-specific notes

2. Add a custom approach (user-defined strategy)
3. Add a fallback approach (generic implementation)

### Output
```typescript
interface GeneratedApproaches {
  task: SimulationTask;
  approaches: SimulationApproach[];
  detectedLanguage: CallGraphLanguage;
  detectedFramework?: string;
  relevantPatterns: string[];
}
```

## Rust Rebuild Considerations
- Task category detection is keyword matching — trivial in Rust
- Language/framework detection could leverage Rust parsers for speed
- File scanning is I/O-bound — Rust's parallel walker would help
- The template instantiation is data transformation — straightforward
