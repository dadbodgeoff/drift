# Language Intelligence Queries

## Location
`packages/core/src/language-intelligence/language-intelligence.ts`

## Purpose
Main orchestrator class providing cross-language semantic queries. Wraps the normalization layer with a high-level API for finding entry points, data accessors, auth handlers, etc. across all supported languages.

## Initialization

```typescript
const intelligence = new LanguageIntelligence({ rootDir: '/my/project' });
intelligence.initialize();
// Registers all built-in framework patterns
// Creates normalizers for all supported languages
```

### Config
```typescript
interface LanguageIntelligenceConfig {
  rootDir: string;
}
```

## Query Methods

### `normalizeFile(source, filePath) → NormalizedExtractionResult | null`
Normalize a single file. Selects the appropriate normalizer by file extension. Returns `null` if no normalizer handles the extension.

### `findEntryPoints(results) → QueryResult[]`
Find all functions marked as HTTP endpoints, event handlers, CLI commands, etc. across all normalized files.

### `findDataAccessors(results, table?) → QueryResult[]`
Find all functions that perform database read/write operations. Optionally filter by table/collection name.

### `findInjectables(results) → QueryResult[]`
Find all DI services (classes/functions marked as injectable).

### `findAuthHandlers(results) → QueryResult[]`
Find all auth-related functions (login, authorization checks, etc.).

### `findByCategory(results, category) → QueryResult[]`
Query by any of the 12 semantic categories (routing, di, orm, auth, validation, test, logging, caching, scheduling, messaging, middleware, unknown).

### `query(results, options) → QueryResult[]`
General cross-language query with flexible filters:

```typescript
interface QueryOptions {
  category?: SemanticCategory;
  isEntryPoint?: boolean;
  isDataAccessor?: boolean;
  isAuthHandler?: boolean;
  isInjectable?: boolean;
  framework?: string;
  language?: CallGraphLanguage;
}
```

### QueryResult
```typescript
interface QueryResult {
  function: NormalizedFunction;
  file: string;
  framework?: string;
  matchedDecorators: NormalizedDecorator[];
}
```

## Usage Examples

```typescript
// Normalize a Java file
const result = intelligence.normalizeFile(javaSource, 'UserController.java');
// result.detectedFrameworks → ['spring']
// result.fileSemantics → { isController: true, primaryFramework: 'spring' }

// Find all HTTP endpoints across languages
const entryPoints = intelligence.findEntryPoints(allResults);

// Find all functions accessing the 'users' table
const dataAccessors = intelligence.findDataAccessors(allResults, 'users');

// Find all auth handlers
const authHandlers = intelligence.findAuthHandlers(allResults);

// Custom query: find all Spring services
const springServices = intelligence.query(allResults, {
  framework: 'spring',
  isInjectable: true,
});
```

## Rust Rebuild Considerations
- The query methods are lightweight filtering — could stay in TypeScript
- The normalization (called internally) is the heavy part — benefits from Rust
- This class is primarily an API surface — thin orchestration layer
