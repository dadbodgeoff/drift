# Commit Extractors

## Location
`packages/core/src/decisions/extractors/`

## Purpose
Language-specific extractors that analyze commits for semantic signals. Each extractor understands the conventions of its target language — import patterns, framework constructs, dependency manifests, etc.

## Files
- `base-commit-extractor.ts` — `BaseCommitExtractor`: abstract base class
- `typescript-commit-extractor.ts` — `TypeScriptCommitExtractor`
- `python-commit-extractor.ts` — `PythonCommitExtractor`
- `java-commit-extractor.ts` — `JavaCommitExtractor`
- `csharp-commit-extractor.ts` — `CSharpCommitExtractor`
- `php-commit-extractor.ts` — `PhpCommitExtractor`
- `index.ts` — Factory functions

## BaseCommitExtractor

### Abstract Methods
```typescript
abstract canHandle(filePath: string): boolean;
abstract extract(commit: GitCommit, context: ExtractionContext): CommitSemanticExtraction;
```

### ExtractionContext
```typescript
interface ExtractionContext {
  rootDir: string;
  includeFunctions?: boolean;
  includePatterns?: boolean;
  verbose?: boolean;
}
```

### CommitSemanticExtraction (output per commit)
```typescript
interface CommitSemanticExtraction {
  patterns: PatternDelta[];           // Patterns added/removed/modified
  functions: FunctionDelta[];         // Functions added/removed/modified/renamed
  dependencies: DependencyDelta[];    // Packages added/removed/version changes
  messageSignals: MessageSignal[];    // Keywords from commit message
  architecturalSignals: ArchitecturalSignal[];  // Structural changes from diffs
  significance: number;               // Overall significance score (0–1)
}
```

## Language Extractors

| Extractor | Languages | Extensions | Dependency Manifest |
|-----------|-----------|------------|---------------------|
| `TypeScriptCommitExtractor` | TS, JS | `.ts`, `.tsx`, `.js`, `.jsx` | `package.json` |
| `PythonCommitExtractor` | Python | `.py` | `requirements.txt`, `pyproject.toml` |
| `JavaCommitExtractor` | Java | `.java` | `pom.xml`, `build.gradle` |
| `CSharpCommitExtractor` | C# | `.cs` | `.csproj` |
| `PhpCommitExtractor` | PHP | `.php` | `composer.json` |

Each extractor detects language-specific patterns:
- **TypeScript**: ES imports/exports, decorators, React patterns, Express/NestJS constructs
- **Python**: pip imports, decorators, FastAPI/Flask/Django patterns
- **Java**: Maven/Gradle deps, annotations, Spring patterns
- **C#**: NuGet packages, attributes, ASP.NET patterns
- **PHP**: Composer deps, Laravel/Symfony patterns

## Factory Functions

```typescript
// Single extractor by language
createCommitExtractor(language: DecisionLanguage, options: CommitExtractorOptions)

// All extractors (6 entries — JS shares TS)
createAllCommitExtractors(options: CommitExtractorOptions)
  → Map<DecisionLanguage, Extractor>

// Find extractor for a file
getExtractorForFile(filePath: string, extractors: Map)
  → Extractor | null
```

## Rust Rebuild Considerations
- All extraction is pattern matching on source text — excellent Rust candidate
- The `regex` crate would handle the detection patterns efficiently
- Dependency manifest parsing (JSON, TOML, XML) has mature Rust crates
- Main benefit: speed on large commits with many file changes
