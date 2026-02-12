# Framework Registry

## Location
`packages/core/src/language-intelligence/framework-registry.ts`

## Purpose
Singleton registry that holds all known framework patterns. Indexed by language for fast lookup. Provides decorator matching and framework detection from source code.

## Singleton Pattern

```typescript
class FrameworkRegistry {
  private static instance: FrameworkRegistry | null = null;
  private frameworks: Map<string, FrameworkPattern> = new Map();
  private byLanguage: Map<CallGraphLanguage, FrameworkPattern[]> = new Map();

  static getInstance(): FrameworkRegistry;
  static reset(): void;  // For testing
}
```

## Methods

### Registration
- `register(pattern: FrameworkPattern)` — add a single framework
- `registerAll(patterns: FrameworkPattern[])` — add multiple frameworks

### Lookup
- `get(framework: string) → FrameworkPattern | undefined` — by name
- `getForLanguage(language) → FrameworkPattern[]` — all frameworks for a language
- `getAll() → FrameworkPattern[]` — all registered frameworks
- `has(framework: string) → boolean` — existence check

### Detection
- `detectFrameworks(source, language) → FrameworkPattern[]` — checks import and decorator patterns against source code to determine which frameworks are in use

### Decorator Matching
- `findDecoratorMapping(raw, frameworks) → { mapping, framework } | null` — finds the matching `DecoratorMapping` for a raw decorator string across the given frameworks
- `getDefaultSemantics() → DecoratorSemantics` — returns `{ category: 'unknown', confidence: 0 }` for unrecognized decorators

### Framework Detection Algorithm
For each candidate framework (filtered by language):
1. Check `detectionPatterns.imports` — if any import regex matches, framework detected
2. Check `detectionPatterns.decorators` — if any decorator regex matches, framework detected
3. Return all detected frameworks

## Module-Level Convenience Functions

```typescript
getFrameworkRegistry()                    → FrameworkRegistry (singleton)
registerFramework(pattern)                → void
registerFrameworks(patterns: FrameworkPattern[]) → void
```

## Rust Rebuild Considerations
- The registry is a static data structure — maps directly to Rust `HashMap`
- Regex matching for detection is a hot path — Rust's `regex` crate is faster
- The singleton pattern maps to Rust's `lazy_static` or `once_cell`
