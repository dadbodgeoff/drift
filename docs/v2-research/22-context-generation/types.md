# Context Generation — Types

> `packages/core/src/context/types.ts` — ~230 lines
> All type definitions for the context generation system.

## Package Detection Types

### PackageManager

```typescript
type PackageManager =
  | 'npm' | 'pnpm' | 'yarn'     // JavaScript/TypeScript
  | 'pip' | 'poetry'             // Python
  | 'cargo'                       // Rust
  | 'go'                          // Go
  | 'maven' | 'gradle'           // Java
  | 'composer'                    // PHP
  | 'nuget'                       // C#
  | 'unknown';
```

### DetectedPackage

Represents a single package discovered in a monorepo.

```typescript
interface DetectedPackage {
  name: string;                    // Package name from manifest
  path: string;                    // Relative path from project root
  absolutePath: string;            // Absolute filesystem path
  packageManager: PackageManager;  // Which package manager owns it
  language: string;                // Primary language (typescript, python, rust, etc.)
  internalDependencies: string[];  // Cross-references to other workspace packages
  externalDependencies: string[];  // External deps (first 20)
  isRoot: boolean;                 // Whether this is the root/top-level package
  version?: string;                // Package version if available
  description?: string;            // Package description if available
}
```

### MonorepoStructure

Top-level detection result.

```typescript
interface MonorepoStructure {
  rootDir: string;                 // Project root directory
  isMonorepo: boolean;             // True if multiple packages detected
  packages: DetectedPackage[];     // All detected packages
  packageManager: PackageManager;  // Primary package manager
  workspaceConfig?: string;        // Source file (e.g., "pnpm-workspace.yaml")
}
```

## Context Generation Types

### PackageContextOptions

Input options for context generation.

```typescript
interface PackageContextOptions {
  package: string;                 // Package name or path
  maxTokens?: number;              // Token budget (default: 8000)
  includeSnippets?: boolean;       // Include code snippets in patterns
  includeDependencies?: boolean;   // Include dependency patterns
  categories?: string[];           // Filter to specific categories (empty = all)
  minConfidence?: number;          // Minimum confidence threshold
  format?: 'json' | 'markdown' | 'ai-context';
  includeInternalDeps?: boolean;   // Include internal dependency patterns
}
```

### PackageContext

The main output — a structured, scoped context for a single package.

```typescript
interface PackageContext {
  package: {
    name: string;
    path: string;
    language: string;
    description?: string;
  };
  summary: {
    totalPatterns: number;
    totalConstraints: number;
    totalFiles: number;
    totalEntryPoints: number;
    totalDataAccessors: number;
    estimatedTokens: number;
  };
  patterns: ContextPattern[];           // Sorted by occurrences desc
  constraints: ContextConstraint[];
  entryPoints: ContextEntryPoint[];     // Max 50
  dataAccessors: ContextDataAccessor[]; // Max 30
  keyFiles: Array<{
    file: string;
    reason: string;
    patterns: string[];
  }>;                                   // Max 10, scored by pattern density
  guidance: {
    keyInsights: string[];
    commonPatterns: string[];
    warnings: string[];
  };
  dependencies?: Array<{
    name: string;
    patterns: ContextPattern[];
  }>;
  metadata: {
    generatedAt: string;
    driftVersion: string;
    contextVersion: string;
  };
}
```

### ContextPattern

Lightweight pattern representation for context output.

```typescript
interface ContextPattern {
  id: string;
  name: string;
  category: string;
  confidence: number;
  occurrences: number;          // Count within this package
  example?: string;             // Code snippet if includeSnippets=true
  files: string[];              // Up to 5 file paths
  fromDependency?: string;      // Set if pattern comes from a dependency
}
```

### ContextConstraint

```typescript
interface ContextConstraint {
  id: string;
  name: string;
  category: string;
  enforcement: 'error' | 'warning' | 'info';
  condition: string;            // Human-readable condition
  guidance: string;             // How to follow this constraint
}
```

### ContextEntryPoint

```typescript
interface ContextEntryPoint {
  name: string;
  file: string;
  type: string;                 // 'api', 'event', 'cli', 'function', etc.
  method?: string;              // HTTP method if API
  path?: string;                // Route path if API
}
```

### ContextDataAccessor

```typescript
interface ContextDataAccessor {
  name: string;
  file: string;
  tables: string[];
  accessesSensitive: boolean;
}
```

## AI Context Format

### AIContextFormat

Structured output optimized for AI agent consumption.

```typescript
interface AIContextFormat {
  systemPrompt: string;         // Package overview + summary stats
  conventions: string;          // Top 10 patterns with confidence/occurrences
  examples: string;             // Up to 5 code examples
  constraints: string;          // All applicable constraints
  combined: string;             // All sections joined with separators
  tokens: {
    systemPrompt: number;
    conventions: number;
    examples: number;
    constraints: number;
    total: number;
  };
}
```

## Cache & Events

### ContextCacheEntry

```typescript
interface ContextCacheEntry {
  packageName: string;
  cacheKey: string;             // Hash of inputs
  context: PackageContext;
  cachedAt: string;
  ttlMs: number;
}
```

### ContextEventType

```typescript
type ContextEventType =
  | 'context:generating'
  | 'context:generated'
  | 'context:cached'
  | 'context:error'
  | 'package:detected'
  | 'monorepo:detected';
```
