# Language Normalizers

## Location
- `packages/core/src/language-intelligence/base-normalizer.ts`
- `packages/core/src/language-intelligence/normalizers/`

## Purpose
Per-language normalizers that transform raw call graph extractions into semantically annotated results. Each normalizer wraps an existing language extractor and adds decorator normalization + semantic classification.

---

## BaseLanguageNormalizer

Abstract base class implementing the `LanguageNormalizer` interface.

### Abstract Members
```typescript
abstract readonly language: CallGraphLanguage;
abstract readonly extensions: string[];
abstract extractRaw(source: string, filePath: string): FileExtractionResult;
```

### Normalization Pipeline: `normalize(source, filePath) → NormalizedExtractionResult`

1. **`extractRaw(source, filePath)`** — calls the existing language-specific call graph extractor (abstract, implemented per language)
2. **`detectFrameworks(source)`** — queries `FrameworkRegistry` for matching frameworks
3. **For each function**: `normalizeFunction(fn, frameworks)`:
   a. Normalize each decorator via `normalizeDecorator(raw, frameworks)`
   b. Derive function semantics from all normalized decorators
4. **`deriveFileSemantics(functions, frameworks)`** — classify file

### Decorator Normalization: `normalizeDecorator(raw, frameworks) → NormalizedDecorator`

1. Try `FrameworkRegistry.findDecoratorMapping(raw, frameworks)` for known decorators
2. If match found: use mapping's semantic info + confidence + argument extraction
3. If no match: return with `category: 'unknown'`, `confidence: 0`, generic argument extraction

### Function Semantics Derivation

Aggregates across all decorators on a function:
- `isEntryPoint` — any decorator marks it as entry point
- `isInjectable` — any decorator marks it as DI service
- `isAuthHandler` — any decorator is auth-related
- `isTestCase` — any decorator is test-related
- `isDataAccessor` — any decorator has data access mode
- `requiresAuth` — any decorator requires authentication
- `entryPoint` — HTTP path + methods from routing decorators
- `dependencies` — injected dependencies (language-specific)
- `auth` — required roles from auth decorators

### File Semantics Derivation

Classifies the file based on function-level semantics:
```typescript
{
  isController: boolean;    // Has entry points
  isService: boolean;       // Has injectables, no entry points
  isModel: boolean;         // Has data accessors, no entry points or injectables
  isTestFile: boolean;      // Has test cases
  primaryFramework?: string; // Most-used framework in the file
}
```

### Helper Methods
- `canHandle(filePath)` — checks file extension against `this.extensions`
- `extractDecoratorName(raw)` — strips `@`, `#`, `[`, `]`, `(...)` prefixes/suffixes
- `extractGenericArguments(raw)` — extracts path-like arguments from decorator strings
- `extractDependencies(fn, decorators)` — override in subclasses for language-specific DI

---

## Language Normalizers

| Normalizer | Language | Extensions | Notes |
|------------|----------|------------|-------|
| `TypeScriptNormalizer` | TypeScript/JS | `.ts`, `.tsx`, `.js`, `.jsx` | NestJS, Express |
| `PythonNormalizer` | Python | `.py` | FastAPI, Flask, Django |
| `JavaNormalizer` | Java | `.java` | Spring Boot |
| `CSharpNormalizer` | C# | `.cs` | ASP.NET Core |
| `PhpNormalizer` | PHP | `.php` | Laravel, Symfony |

Each implements `extractRaw()` by calling the existing call graph extractor for that language.

## Factory Functions

```typescript
createNormalizer(language: CallGraphLanguage) → LanguageNormalizer | null
createAllNormalizers()                        → LanguageNormalizer[]  // 5 normalizers
getNormalizerForFile(filePath: string)        → LanguageNormalizer | null
```

## Rust Rebuild Considerations
- Normalization is pure data transformation — excellent Rust candidate
- The decorator name extraction is string manipulation — trivial in Rust
- Semantic derivation is boolean aggregation — trivial in Rust
- File classification is lightweight — either side
