# AI Surgical Tools Design

## Overview

Eight new MCP tools that give AI coding assistants surgical access to codebase intelligence. These tools solve the fundamental problem: **AI writes code that doesn't fit because it can't efficiently find the right context.**

All tools leverage existing Drift data stores - no new scanning or storage required.

## The Problem

When users say "AI wrote bad code," what actually happened:

1. AI couldn't see the existing pattern (wrote raw fetch when `useApiClient` exists)
2. AI didn't know naming conventions (PascalCase vs kebab-case)
3. AI missed error handling style (exceptions vs Result<T>)
4. AI used wrong imports (deep paths vs barrel files)
5. AI didn't match test patterns (wrong mocking style)

The context window isn't the problem. **The problem is not knowing what to PUT in the context window.** Reading 200k tokens of the wrong files still produces wrong code.

## Design Principles

1. **Zero new data** - Query existing `.drift/` stores only
2. **Surgical responses** - Return exactly what's needed, nothing more
3. **Token efficient** - Minimize response size for AI context windows
4. **Fast** - Sub-100ms responses from indexed data
5. **Composable** - Tools work together in AI workflows

---

## Enterprise Infrastructure Integration

All surgical tools MUST use the enterprise infrastructure patterns established in `packages/mcp/src/infrastructure/`. This ensures consistency, observability, and production-grade reliability.

### Required Infrastructure Components

| Component | Import | Purpose |
|-----------|--------|---------|
| `ResponseBuilder` | `infrastructure/response-builder.ts` | Consistent response envelope with token budgets |
| `ResponseCache` | `infrastructure/cache.ts` | Multi-level caching with invalidation |
| `DriftError`, `Errors` | `infrastructure/error-handler.ts` | Structured errors with recovery hints |
| `RateLimiter` | `infrastructure/rate-limiter.ts` | Sliding window rate limiting |
| `MetricsCollector` | `infrastructure/metrics.ts` | Prometheus-compatible metrics |
| `CursorManager` | `infrastructure/cursor-manager.ts` | Stable cursor-based pagination |

### Response Envelope Format

Every surgical tool response MUST follow this envelope:

```typescript
interface MCPResponse<T> {
  summary: string;           // 1-2 sentence human-readable summary
  data: T;                   // The actual payload
  pagination?: {
    cursor?: string;         // Opaque cursor for next page
    hasMore: boolean;
    totalCount?: number;
    pageSize: number;
  };
  hints?: {
    nextActions?: string[];  // Suggested follow-up tools
    relatedTools?: string[];
    warnings?: string[];
  };
  meta: {
    requestId: string;
    durationMs: number;
    cached: boolean;
    tokenEstimate: number;
  };
}
```

### Token Budget Guidelines

| Tool Type | Target Tokens | Max Tokens |
|-----------|---------------|------------|
| Surgical (single lookup) | 200-500 | 1000 |
| Surgical (list) | 500-1000 | 2000 |
| Surgical (template) | 800-1500 | 3000 |

### Error Response Format

All errors use `DriftError` with recovery hints:

```typescript
{
  error: {
    code: "PATTERN_NOT_FOUND",
    message: "Pattern not found: auth-middleware",
    details: { patternId: "auth-middleware" },
    recovery: {
      suggestion: "Use drift_patterns_list to find valid pattern IDs",
      alternativeTools: ["drift_patterns_list", "drift_similar"]
    }
  },
  meta: { requestId: "req_abc123", timestamp: "..." }
}
```

### Cache Invalidation Keys

Each tool must specify invalidation keys for proper cache management:

| Tool | Invalidation Keys |
|------|-------------------|
| `drift_similar` | `patterns`, `callgraph` |
| `drift_signature` | `callgraph`, `file:{path}` |
| `drift_imports` | `callgraph`, `file:{targetFile}` |
| `drift_prevalidate` | `patterns`, `category:{cat}` |
| `drift_recent` | `git`, `decisions` |
| `drift_test_template` | `test-topology`, `file:{targetFile}` |
| `drift_type` | `callgraph`, `types` |
| `drift_callers` | `callgraph`|

### Layered Tool Classification

Following the enterprise layered pattern:

| Layer | Tools | Characteristics |
|-------|-------|-----------------|
| **Surgical** (New) | All 8 tools | Ultra-focused, single-purpose, minimal tokens |

These sit alongside existing layers:
- **Discovery**: `drift_status`, `drift_capabilities`
- **Exploration**: `drift_patterns_list`, `drift_files_list`
- **Detail**: `drift_pattern_get`, `drift_code_examples`
- **Orchestration**: `drift_context`

---

## Tool 1: `drift_similar`

**Purpose:** Find code semantically similar to what the AI is about to write.

**Problem Solved:** AI needs to see an example endpoint but there are 50 endpoints. Which one is most relevant?

### Input Schema

```typescript
interface DriftSimilarInput {
  // What kind of code are you writing?
  intent: 'api_endpoint' | 'service' | 'component' | 'hook' | 'utility' | 'test' | 'middleware';
  
  // Natural language description
  description: string;
  
  // Optional: limit to specific directory
  scope?: string;
  
  // Max results (default: 3)
  limit?: number;
}
```

### Output Schema

```typescript
interface DriftSimilarOutput {
  matches: Array<{
    file: string;
    function?: string;
    class?: string;
    similarity: number;  // 0-1
    reason: string;      // Why this matched
    preview: string;     // First 10 lines of the match
    patterns: string[];  // Patterns this code follows
  }>;
  
  // Conventions learned from matches
  conventions: {
    naming: string;           // "kebab-case files, PascalCase exports"
    errorHandling: string;    // "Uses Result<T> pattern"
    imports: string;          // "Barrel files with @/ alias"
  };
}
```

### Example

```
Input: { intent: "api_endpoint", description: "user preferences CRUD" }

Output: {
  matches: [
    {
      file: "src/api/users.ts",
      function: "updateProfile",
      similarity: 0.92,
      reason: "Similar CRUD operation on user data",
      preview: "export async function updateProfile(userId: string, data: UpdateProfileDTO)...",
      patterns: ["api/rest-controller", "errors/result-pattern"]
    }
  ],
  conventions: {
    naming: "camelCase functions, PascalCase DTOs",
    errorHandling: "Wrap in Result.ok() / Result.err()",
    imports: "Use @/types for DTOs, @/services for business logic"
  }
}
```

### Data Source

- `CallGraphStore` - Function signatures and relationships
- `PatternStore` - Pattern tags per file
- `IndexStore.byCategory` - Category-based lookups

### Implementation Notes

Similarity scoring based on:
1. Pattern overlap (same patterns = higher score)
2. Directory proximity (same folder = higher score)
3. Function signature similarity (same param types = higher score)
4. Name similarity (fuzzy match on description keywords)

---

## Tool 2: `drift_signature`

**Purpose:** Get just the function/class signature without reading the entire file.

**Problem Solved:** AI reads 500-line files just to see a 1-line function signature.

### Input Schema

```typescript
interface DriftSignatureInput {
  // Symbol to look up
  symbol: string;
  
  // Optional: specific file (otherwise searches all)
  file?: string;
  
  // Include JSDoc/docstring? (default: true)
  includeDocs?: boolean;
}
```

### Output Schema

```typescript
interface DriftSignatureOutput {
  found: boolean;
  
  signatures: Array<{
    file: string;
    line: number;
    kind: 'function' | 'method' | 'class' | 'interface' | 'type';
    signature: string;        // The actual signature
    parameters?: Array<{
      name: string;
      type: string;
      required: boolean;
      default?: string;
    }>;
    returnType?: string;
    docs?: string;            // JSDoc/docstring
    exported: boolean;
  }>;
}
```

### Example

```
Input: { symbol: "createUser", file: "src/services/user-service.ts" }

Output: {
  found: true,
  signatures: [{
    file: "src/services/user-service.ts",
    line: 45,
    kind: "function",
    signature: "export async function createUser(data: CreateUserDTO): Promise<Result<User, ApiError>>",
    parameters: [
      { name: "data", type: "CreateUserDTO", required: true }
    ],
    returnType: "Promise<Result<User, ApiError>>",
    docs: "Creates a new user in the database. Validates email uniqueness.",
    exported: true
  }]
}
```

### Data Source

- `CallGraphStore` - Already has all function extractions with signatures

### Implementation Notes

Direct lookup in call graph. If symbol not found in specified file, search all files. Return multiple if symbol exists in multiple places (overloads, same name different files).

---

## Tool 3: `drift_imports`

**Purpose:** Resolve correct imports for symbols based on codebase conventions.

**Problem Solved:** Every codebase has different import conventions. AI guesses wrong constantly.

### Input Schema

```typescript
interface DriftImportsInput {
  // Symbols that need to be imported
  symbols: string[];
  
  // File where imports will be added
  targetFile: string;
}
```

### Output Schema

```typescript
interface DriftImportsOutput {
  imports: string[];  // Ready-to-use import statements
  
  // Symbols that couldn't be resolved
  unresolved: string[];
  
  // Learned conventions
  conventions: {
    style: 'barrel' | 'deep' | 'mixed';
    pathStyle: 'relative' | 'alias' | 'absolute';
    alias?: string;  // e.g., "@/" or "~/"
    preferNamed: boolean;
    preferType: boolean;  // Uses "import type" when possible
  };
}
```

### Example

```
Input: { 
  symbols: ["User", "createUser", "ApiError"], 
  targetFile: "src/api/new-endpoint.ts" 
}

Output: {
  imports: [
    "import type { User } from '@/types'",
    "import { createUser } from '@/services/user-service'",
    "import { ApiError } from '@/utils/errors'"
  ],
  unresolved: [],
  conventions: {
    style: "barrel",
    pathStyle: "alias",
    alias: "@/",
    preferNamed: true,
    preferType: true
  }
}
```

### Data Source

- `CallGraphStore.imports` - All imports per file
- `CallGraphStore.exports` - All exports per file
- Learn conventions by analyzing existing import patterns

### Implementation Notes

1. Find where each symbol is exported
2. Look at how OTHER files import from that location
3. Use the most common import style for that export
4. Apply path alias conventions based on target file location

---

## Tool 4: `drift_prevalidate`

**Purpose:** Validate proposed code BEFORE writing it.

**Problem Solved:** AI writes code, saves it, THEN finds out it violates patterns. Damage done.

### Input Schema

```typescript
interface DriftPrevalidateInput {
  // The code to validate
  code: string;
  
  // Where it will be written
  targetFile: string;
  
  // What kind of code is this?
  kind?: 'function' | 'class' | 'component' | 'test' | 'full-file';
}
```

### Output Schema

```typescript
interface DriftPrevalidateOutput {
  valid: boolean;
  score: number;  // 0-100
  
  violations: Array<{
    rule: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
    suggestion?: string;
    line?: number;  // Line in proposed code
  }>;
  
  // What patterns this code SHOULD follow based on location
  expectedPatterns: string[];
  
  // Quick fixes
  suggestions: string[];
}
```

### Example

```
Input: { 
  code: "export async function getUser(id: string) { return db.query('SELECT * FROM users WHERE id = ?', [id]); }",
  targetFile: "src/api/users.ts"
}

Output: {
  valid: false,
  score: 45,
  violations: [
    {
      rule: "error-handling",
      severity: "error",
      message: "Missing try/catch - this codebase wraps all async in Result<T>",
      suggestion: "Wrap return in Result.ok() and catch in Result.err()"
    },
    {
      rule: "data-access",
      severity: "warning",
      message: "Raw SQL detected - this codebase uses Prisma ORM",
      suggestion: "Use prisma.user.findUnique({ where: { id } })"
    },
    {
      rule: "naming",
      severity: "info",
      message: "Consider getUserById to match existing pattern",
      suggestion: "Rename to getUserById"
    }
  ],
  expectedPatterns: ["api/rest-controller", "errors/result-pattern", "data-access/prisma"],
  suggestions: [
    "Add Result<T> wrapper",
    "Replace raw SQL with Prisma",
    "Add input validation"
  ]
}
```

### Data Source

- `PatternStore` - Patterns for target file's directory
- `IndexStore.byFile` - What patterns exist in similar files
- Reuse logic from `drift_validate_change`

### Implementation Notes

This is essentially `drift_validate_change` but for proposed code that doesn't exist yet. Parse the proposed code, match against expected patterns for the target location, report violations.

---

## Tool 5: `drift_recent`

**Purpose:** Show what changed recently in a specific area.

**Problem Solved:** AI writes code using OLD patterns because it read an old file. Someone refactored last week.

### Input Schema

```typescript
interface DriftRecentInput {
  // Directory or file to check
  area: string;
  
  // How far back to look (default: 7)
  days?: number;
  
  // Filter by change type
  type?: 'feat' | 'fix' | 'refactor' | 'all';
}
```

### Output Schema

```typescript
interface DriftRecentOutput {
  changes: Array<{
    file: string;
    type: 'added' | 'modified' | 'deleted';
    commitType: string;  // feat, fix, refactor
    summary: string;
    date: string;
    author: string;
  }>;
  
  // Patterns that changed
  patternsChanged: string[];
  
  // New conventions introduced
  newConventions: string[];
  
  // Files to prefer (recently updated = more current)
  preferFiles: string[];
}
```

### Example

```
Input: { area: "src/api/", days: 7 }

Output: {
  changes: [
    {
      file: "src/api/middleware.ts",
      type: "modified",
      commitType: "refactor",
      summary: "Migrated to new error handling with Result<T>",
      date: "2024-01-20",
      author: "jane"
    },
    {
      file: "src/api/users.ts",
      type: "modified",
      commitType: "feat",
      summary: "Added rate limiting decorator",
      date: "2024-01-22",
      author: "bob"
    }
  ],
  patternsChanged: ["errors/result-pattern"],
  newConventions: [
    "All endpoints now use @RateLimit() decorator",
    "Error handling migrated from try/catch to Result<T>"
  ],
  preferFiles: ["src/api/users.ts", "src/api/middleware.ts"]
}
```

### Data Source

- `DecisionMiningAnalyzer` - Git history analysis
- `GitWalker` - Commit traversal
- `DiffAnalyzer` - Change extraction

### Implementation Notes

Use existing decision mining infrastructure. Filter commits by path, extract conventional commit types, summarize changes. Flag pattern-related changes prominently.

---

## Tool 6: `drift_test_template`

**Purpose:** Generate test scaffolding based on existing test patterns.

**Problem Solved:** Tests are the most convention-heavy code. Every codebase has different mocking, assertion, and structure patterns.

### Input Schema

```typescript
interface DriftTestTemplateInput {
  // File being tested
  targetFile: string;
  
  // Specific function to test (optional)
  function?: string;
  
  // Test type
  type?: 'unit' | 'integration' | 'e2e';
}
```

### Output Schema

```typescript
interface DriftTestTemplateOutput {
  // Suggested test file path
  testFile: string;
  
  // Ready-to-use template
  template: string;
  
  // Conventions detected
  conventions: {
    framework: string;      // vitest, jest, mocha
    style: string;          // describe/it, test()
    mockStyle: string;      // vi.mock, jest.mock, manual
    assertionStyle: string; // expect, assert, chai
    filePattern: string;    // *.test.ts, *.spec.ts, __tests__/
  };
  
  // Example test from codebase for reference
  exampleTest?: {
    file: string;
    preview: string;
  };
}
```

### Example

```
Input: { targetFile: "src/services/user-service.ts", function: "createUser" }

Output: {
  testFile: "src/services/__tests__/user-service.test.ts",
  template: `import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createUser } from '../user-service'
import { mockDb } from '@/test/mocks'

describe('createUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.reset()
  })

  it('should create user with valid data', async () => {
    // Arrange
    const input = { email: 'test@example.com', name: 'Test User' }
    
    // Act
    const result = await createUser(input)
    
    // Assert
    expect(result.isOk()).toBe(true)
    expect(result.value).toMatchObject({ email: input.email })
  })

  it('should return error for duplicate email', async () => {
    // Your test here
  })
})`,
  conventions: {
    framework: "vitest",
    style: "describe/it",
    mockStyle: "vi.mock with manual mocks",
    assertionStyle: "expect",
    filePattern: "__tests__/*.test.ts"
  },
  exampleTest: {
    file: "src/services/__tests__/order-service.test.ts",
    preview: "// Similar test for reference..."
  }
}
```

### Data Source

- `TestTopologyAnalyzer` - Test file mappings
- `CallGraphStore` - Function signatures for test targets
- Pattern detection on existing test files

### Implementation Notes

1. Find existing tests in same directory
2. Analyze their structure (framework, mocking, assertions)
3. Generate template matching those conventions
4. Include function signature info for accurate test setup

---

## Tool 7: `drift_type`

**Purpose:** Expand type definitions to see full structure.

**Problem Solved:** AI sees `user: User` but doesn't know User has 20 fields.

### Input Schema

```typescript
interface DriftTypeInput {
  // Type name to expand
  type: string;
  
  // How deep to expand nested types (default: 2)
  depth?: number;
  
  // Specific file to look in (optional)
  file?: string;
}
```

### Output Schema

```typescript
interface DriftTypeOutput {
  found: boolean;
  
  definition: {
    name: string;
    kind: 'interface' | 'type' | 'class' | 'enum';
    source: string;  // file:line
    
    // Expanded structure
    shape: Record<string, any>;
    
    // Raw definition
    raw: string;
  };
  
  // Related types that might be useful
  relatedTypes: Array<{
    name: string;
    relationship: 'extends' | 'contains' | 'parameter' | 'return';
    source: string;
  }>;
}
```

### Example

```
Input: { type: "User", depth: 2 }

Output: {
  found: true,
  definition: {
    name: "User",
    kind: "interface",
    source: "src/types/user.ts:15",
    shape: {
      id: "string",
      email: "string",
      profile: {
        name: "string",
        avatar: "string | null",
        bio: "string | undefined"
      },
      settings: "UserSettings",  // Not expanded (depth limit)
      createdAt: "Date",
      updatedAt: "Date"
    },
    raw: "interface User {\n  id: string;\n  email: string;\n  profile: UserProfile;\n  settings: UserSettings;\n  createdAt: Date;\n  updatedAt: Date;\n}"
  },
  relatedTypes: [
    { name: "UserProfile", relationship: "contains", source: "src/types/user.ts:5" },
    { name: "UserSettings", relationship: "contains", source: "src/types/user.ts:25" },
    { name: "CreateUserDTO", relationship: "parameter", source: "src/types/user.ts:40" },
    { name: "UpdateUserDTO", relationship: "parameter", source: "src/types/user.ts:50" }
  ]
}
```

### Data Source

- Tree-sitter parsers - Type extraction
- `CallGraphStore.classes` - Class/interface definitions

### Implementation Notes

Parse type definitions with tree-sitter. Recursively expand nested types up to depth limit. Track relationships through extends, property types, and function signatures.

---

## Tool 8: `drift_callers`

**Purpose:** Lightweight "who calls this function" lookup.

**Problem Solved:** AI needs to know impact of changing a function without full impact analysis.

### Input Schema

```typescript
interface DriftCallersInput {
  // Function to look up
  function: string;
  
  // Specific file (optional)
  file?: string;
  
  // Include indirect callers? (default: false)
  transitive?: boolean;
  
  // Max depth for transitive (default: 2)
  maxDepth?: number;
}
```

### Output Schema

```typescript
interface DriftCallersOutput {
  target: {
    function: string;
    file: string;
    line: number;
  };
  
  directCallers: Array<{
    function: string;
    file: string;
    line: number;
    callSite: number;  // Line where call happens
  }>;
  
  // Only if transitive: true
  transitiveCallers?: Array<{
    function: string;
    file: string;
    depth: number;
    path: string[];  // Call chain
  }>;
  
  // Quick stats
  stats: {
    directCount: number;
    transitiveCount?: number;
    isPublicApi: boolean;      // Called from entry points
    isWidelyUsed: boolean;     // > 5 callers
  };
}
```

### Example

```
Input: { function: "validateUser", file: "src/utils/validation.ts" }

Output: {
  target: {
    function: "validateUser",
    file: "src/utils/validation.ts",
    line: 23
  },
  directCallers: [
    { function: "login", file: "src/api/auth.ts", line: 45, callSite: 52 },
    { function: "createUser", file: "src/api/users.ts", line: 23, callSite: 31 },
    { function: "updateUser", file: "src/api/users.ts", line: 67, callSite: 75 }
  ],
  stats: {
    directCount: 3,
    isPublicApi: true,
    isWidelyUsed: false
  }
}
```

### Data Source

- `CallGraphStore` - Already has all caller/callee relationships

### Implementation Notes

Direct lookup in call graph. For transitive, BFS up the call tree. Much lighter than full `drift_impact_analysis` - just returns callers, not full blast radius.

---

## Implementation Priority

Based on impact and implementation effort:

| Priority | Tool | Impact | Effort | Rationale |
|----------|------|--------|--------|-----------|
| P0 | `drift_similar` | Very High | Medium | Finding right examples is the #1 gap |
| P0 | `drift_signature` | High | Low | Direct call graph query, huge context savings |
| P1 | `drift_imports` | High | Medium | Import errors are top complaint |
| P1 | `drift_prevalidate` | High | Low | Reuses existing validation logic |
| P2 | `drift_callers` | Medium | Low | Direct call graph query |
| P2 | `drift_recent` | Medium | Medium | Uses existing git infrastructure |
| P3 | `drift_test_template` | Medium | Medium | Uses test topology |
| P3 | `drift_type` | Medium | Medium | Needs type expansion logic |

## File Structure

```
packages/mcp/src/tools/
├── surgical/
│   ├── index.ts
│   ├── similar.ts          # drift_similar
│   ├── signature.ts        # drift_signature
│   ├── imports.ts          # drift_imports
│   ├── prevalidate.ts      # drift_prevalidate
│   ├── recent.ts           # drift_recent
│   ├── test-template.ts    # drift_test_template
│   ├── type.ts             # drift_type
│   └── callers.ts          # drift_callers

packages/core/src/surgical/
├── index.ts
├── similarity-engine.ts    # Semantic similarity scoring
├── import-resolver.ts      # Import convention learning
├── type-expander.ts        # Type definition expansion
└── test-template-generator.ts
```

---

## Enterprise Implementation Template

Every surgical tool MUST follow this implementation pattern:

```typescript
/**
 * drift_similar - Find semantically similar code
 * 
 * Layer: Surgical
 * Token Budget: 500 target, 1000 max
 * Cache TTL: 5 minutes
 * Invalidation Keys: patterns, callgraph
 */

import { createResponseBuilder, ResponseBuilder } from '../../infrastructure/response-builder.js';
import { ResponseCache } from '../../infrastructure/cache.js';
import { DriftError, Errors, handleError } from '../../infrastructure/error-handler.js';
import { RateLimiter } from '../../infrastructure/rate-limiter.js';
import { MetricsCollector, metrics } from '../../infrastructure/metrics.js';
import { CursorManager, cursorManager } from '../../infrastructure/cursor-manager.js';
import { z } from 'zod';

// Input validation schema
const DriftSimilarInputSchema = z.object({
  intent: z.enum(['api_endpoint', 'service', 'component', 'hook', 'utility', 'test', 'middleware']),
  description: z.string().min(3).max(500),
  scope: z.string().optional(),
  limit: z.number().int().min(1).max(10).default(3),
});

type DriftSimilarInput = z.infer<typeof DriftSimilarInputSchema>;

// Output type
interface DriftSimilarOutput {
  matches: Array<{
    file: string;
    function?: string;
    class?: string;
    similarity: number;
    reason: string;
    preview: string;
    patterns: string[];
  }>;
  conventions: {
    naming: string;
    errorHandling: string;
    imports: string;
  };
}

export async function handleDriftSimilar(
  args: unknown,
  context: { 
    projectRoot: string;
    cache: ResponseCache;
    rateLimiter: RateLimiter;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();
  
  try {
    // 1. Rate limiting
    context.rateLimiter.checkLimit('drift_similar');
    
    // 2. Input validation
    const parseResult = DriftSimilarInputSchema.safeParse(args);
    if (!parseResult.success) {
      throw Errors.invalidArgument(
        'input',
        parseResult.error.flatten().fieldErrors.toString(),
        'Check parameter types match the schema'
      );
    }
    const input = parseResult.data;
    
    // 3. Cache check
    const cacheKey = context.cache.generateKey('drift_similar', input);
    const cached = await context.cache.get<DriftSimilarOutput>(cacheKey);
    if (cached) {
      metrics.recordRequest('drift_similar', Date.now() - startTime, true, true);
      return createResponseBuilder<DriftSimilarOutput>(requestId)
        .withSummary(`Found ${cached.data.matches.length} similar code examples (cached)`)
        .withData(cached.data)
        .markCached()
        .withHints({
          nextActions: cached.data.matches.length > 0 
            ? [`Use drift_signature to get full signatures for ${cached.data.matches[0]?.function || 'matched functions'}`]
            : ['Try broadening your search with a different intent'],
          relatedTools: ['drift_signature', 'drift_imports', 'drift_code_examples'],
        })
        .buildContent();
    }
    
    // 4. Core logic (query existing stores)
    const result = await findSimilarCode(input, context.projectRoot);
    
    // 5. Cache result
    await context.cache.set(cacheKey, result, {
      ttlMs: 300000, // 5 minutes
      invalidationKeys: ['patterns', 'callgraph'],
    });
    
    // 6. Build response with enterprise envelope
    const response = createResponseBuilder<DriftSimilarOutput>(requestId)
      .withSummary(
        result.matches.length > 0
          ? `Found ${result.matches.length} similar ${input.intent} examples. Top match: ${result.matches[0]?.file}`
          : `No similar ${input.intent} found matching "${input.description}"`
      )
      .withData(result)
      .withHints({
        nextActions: result.matches.length > 0
          ? [
              `Use drift_signature with symbol="${result.matches[0]?.function}" for full signature`,
              `Use drift_imports with symbols=[...] targetFile="your-new-file.ts" for correct imports`,
            ]
          : ['Try drift_patterns_list to see available patterns', 'Broaden search scope'],
        relatedTools: ['drift_signature', 'drift_imports', 'drift_prevalidate'],
        warnings: result.matches.some(m => m.similarity < 0.7)
          ? ['Some matches have low similarity - review carefully']
          : undefined,
      })
      .buildContent();
    
    // 7. Record metrics
    metrics.recordRequest('drift_similar', Date.now() - startTime, true, false);
    metrics.recordTokens('drift_similar', response.content[0]?.text.length ?? 0 / 4);
    
    return response;
    
  } catch (error) {
    metrics.recordRequest('drift_similar', Date.now() - startTime, false, false);
    if (error instanceof DriftError) {
      metrics.recordError('drift_similar', error.code);
    }
    return handleError(error, requestId);
  }
}

// Core logic function (queries existing stores)
async function findSimilarCode(
  input: DriftSimilarInput,
  projectRoot: string
): Promise<DriftSimilarOutput> {
  // Implementation queries:
  // - CallGraphStore for function signatures
  // - PatternStore for pattern tags
  // - IndexStore.byCategory for category lookups
  // 
  // Returns matches sorted by similarity score
  
  // ... implementation details ...
  
  return {
    matches: [],
    conventions: {
      naming: '',
      errorHandling: '',
      imports: '',
    },
  };
}
```

### Key Implementation Requirements

1. **Always validate input** with Zod schemas
2. **Always check rate limits** before processing
3. **Always check cache** before expensive operations
4. **Always use ResponseBuilder** for consistent envelope
5. **Always include hints** for AI guidance
6. **Always record metrics** for observability
7. **Always handle errors** with DriftError and recovery hints
8. **Always specify cache invalidation keys**

## Success Metrics

After implementation, measure:

1. **Context efficiency** - Tokens used per successful code generation
2. **First-try success rate** - Code that passes validation on first write
3. **Pattern compliance** - % of generated code matching codebase patterns
4. **User complaints** - Reduction in "AI wrote bad code" feedback

### Enterprise Metrics (via MetricsCollector)

| Metric | Target | Prometheus Name |
|--------|--------|-----------------|
| P95 Response Time | < 100ms | `drift_mcp_request_duration_ms{tool="drift_similar"}` |
| Cache Hit Rate | > 70% | `drift_mcp_cache_hits_total / drift_mcp_requests_total` |
| Error Rate | < 0.5% | `drift_mcp_errors_total / drift_mcp_requests_total` |
| Avg Token Response | < 500 | `drift_mcp_response_tokens{tool="drift_*"}` |

### Observability Dashboard Queries

```promql
# Surgical tool latency P95
histogram_quantile(0.95, rate(drift_mcp_request_duration_ms_bucket{tool=~"drift_similar|drift_signature|drift_imports"}[5m]))

# Cache effectiveness
sum(rate(drift_mcp_cache_hits_total{tool=~"drift_.*"}[5m])) / sum(rate(drift_mcp_requests_total{tool=~"drift_.*"}[5m]))

# Error rate by tool
sum by (tool) (rate(drift_mcp_errors_total[5m])) / sum by (tool) (rate(drift_mcp_requests_total[5m]))
```

---

## Implementation Checklist

For each surgical tool, verify:

- [ ] Uses `ResponseBuilder` with proper envelope
- [ ] Validates input with Zod schema
- [ ] Checks `RateLimiter` before processing
- [ ] Checks `ResponseCache` before expensive operations
- [ ] Sets cache with proper invalidation keys
- [ ] Returns structured errors via `DriftError`
- [ ] Includes `hints.nextActions` for AI guidance
- [ ] Records metrics via `MetricsCollector`
- [ ] Respects token budget (target < 500, max < 1000)
- [ ] Has unit tests for happy path and error cases
- [ ] Documented in MCP-Tools-Reference.md

---

## Conclusion

These 8 tools transform AI coding assistants from "read everything and hope" to "surgical precision." By exposing Drift's existing intelligence through focused query interfaces, we enable AI to write code that fits the codebase on the first try.

No new data collection. No new scanning. Just smarter access to what Drift already knows.

### Enterprise-Grade Guarantees

By following the established infrastructure patterns:

1. **Consistent UX** - All tools return the same envelope format
2. **Observable** - Every request is metriced and traceable
3. **Resilient** - Rate limiting prevents abuse, caching improves performance
4. **Recoverable** - Errors include actionable recovery hints
5. **Maintainable** - Shared infrastructure reduces code duplication

### Integration with Existing Tools

The surgical tools complement the existing layered architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    drift_context                             │
│              (Orchestration - Intent-aware)                  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    SURGICAL TOOLS (NEW)                      │
│  drift_similar │ drift_signature │ drift_imports │ ...      │
│              (Ultra-focused, minimal tokens)                 │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    DETAIL TOOLS                              │
│  drift_pattern_get │ drift_code_examples │ drift_impact     │
│              (Complete information for specific items)       │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    EXPLORATION TOOLS                         │
│  drift_patterns_list │ drift_files_list │ drift_trends      │
│              (Paginated browsing, summaries)                 │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    DISCOVERY TOOLS                           │
│  drift_status │ drift_capabilities                           │
│              (Quick health checks, tool guidance)            │
└─────────────────────────────────────────────────────────────┘
```

The surgical layer sits between orchestration and detail - providing the precise, minimal-token lookups that AI needs for code generation without the overhead of full detail responses.
