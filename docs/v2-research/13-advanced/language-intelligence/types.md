# Language Intelligence Types

## Location
`packages/core/src/language-intelligence/types.ts`

## Semantic Categories

```typescript
type SemanticCategory =
  | 'routing' | 'di' | 'orm' | 'auth' | 'validation'
  | 'test' | 'logging' | 'caching' | 'scheduling'
  | 'messaging' | 'middleware' | 'unknown';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
type DataAccessMode = 'read' | 'write' | 'both';
```

## Decorator Types

### DecoratorSemantics
```typescript
interface DecoratorSemantics {
  category: SemanticCategory;
  intent: string;              // Human-readable description
  isEntryPoint: boolean;
  isInjectable: boolean;
  requiresAuth: boolean;
  dataAccess?: DataAccessMode;
  confidence: number;          // 0–1
}
```

### NormalizedDecorator
```typescript
interface NormalizedDecorator {
  raw: string;                 // Original string from tree-sitter
  name: string;                // Normalized (no @, [], etc.)
  language: CallGraphLanguage;
  framework?: string;
  semantic: DecoratorSemantics;
  arguments: DecoratorArguments;
}
```

### DecoratorArguments
```typescript
interface DecoratorArguments {
  path?: string;               // Route path
  methods?: HttpMethod[];      // HTTP methods
  roles?: string[];            // Auth roles
  [key: string]: unknown;      // Framework-specific args
}
```

## Function Types

### FunctionSemantics
```typescript
interface FunctionSemantics {
  isEntryPoint: boolean;
  isDataAccessor: boolean;
  isAuthHandler: boolean;
  isTestCase: boolean;
  isInjectable: boolean;
  entryPoint?: {
    type: 'http' | 'event' | 'cli';
    path?: string;
    methods?: HttpMethod[];
  };
  dependencies: string[];
  dataAccess: DataAccessPoint[];
  auth?: {
    required: boolean;
    roles?: string[];
  };
}
```

### NormalizedFunction
Extends `FunctionExtraction` (from call graph) with:
```typescript
interface NormalizedFunction extends FunctionExtraction {
  normalizedDecorators: NormalizedDecorator[];
  semantics: FunctionSemantics;
}
```

## File Types

### NormalizedExtractionResult
Extends `FileExtractionResult` (from call graph) with:
```typescript
interface NormalizedExtractionResult extends FileExtractionResult {
  functions: NormalizedFunction[];
  detectedFrameworks: string[];
  fileSemantics: {
    isController: boolean;
    isService: boolean;
    isModel: boolean;
    isTestFile: boolean;
    primaryFramework?: string;
  };
}
```

## Framework Types

### FrameworkPattern
```typescript
interface FrameworkPattern {
  framework: string;
  languages: CallGraphLanguage[];
  detectionPatterns: {
    imports?: RegExp[];
    decorators?: RegExp[];
  };
  decoratorMappings: DecoratorMapping[];
}
```

### DecoratorMapping
```typescript
interface DecoratorMapping {
  pattern: RegExp;
  semantic: Omit<DecoratorSemantics, 'confidence'>;
  confidence?: number;
  extractArgs: (raw: string) => DecoratorArguments;
}
```

## Query Types

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

interface QueryResult {
  function: NormalizedFunction;
  file: string;
  framework?: string;
  matchedDecorators: NormalizedDecorator[];
}
```

## Config Types

```typescript
interface LanguageIntelligenceConfig {
  rootDir: string;
}

interface LanguageNormalizer {
  readonly language: CallGraphLanguage;
  readonly extensions: string[];
  normalize(source: string, filePath: string): NormalizedExtractionResult;
  normalizeDecorator(raw: string, frameworks: FrameworkPattern[]): NormalizedDecorator;
  detectFrameworks(source: string): FrameworkPattern[];
  canHandle(filePath: string): boolean;
}
```
