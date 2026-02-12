# Context Generation System

## Location
`packages/core/src/context/`

## What It Does
Generates AI-optimized context for specific packages in a monorepo. Powers the `drift_context` and `drift_package_context` MCP tools — the most important tools in the MCP server.

## Architecture

### PackageContextGenerator (`context-generator.ts`)
Main generator that produces token-budgeted context.

**Pipeline:**
1. Detect package via PackageDetector
2. Load package-scoped patterns (approved + discovered, filtered by category/confidence)
3. Load applicable constraints
4. Extract entry points from call graph
5. Extract data accessors from security lake
6. Find key files (scored by pattern density × confidence)
7. Generate guidance (insights, common patterns, warnings)
8. Optionally load dependency patterns
9. Estimate tokens and trim to budget

**Token management:**
- Default budget: 8,000 tokens
- Estimation: `JSON.stringify(context).length × 0.25`
- Trimming priority (first to cut): dependencies → examples → patterns (cap at 20) → key files (cap at 5) → entry points (cap at 10) → data accessors (cap at 10)

**AI context format:**
Produces structured sections: system prompt, conventions, examples, constraints — each with token counts.

### PackageDetector (`package-detector.ts`)
Detects packages across 11 package managers in monorepos.

**Supported package managers:**
| Manager | Detection File | Language |
|---|---|---|
| npm | package.json (workspaces) | TypeScript/JavaScript |
| pnpm | pnpm-workspace.yaml | TypeScript/JavaScript |
| yarn | package.json + yarn.lock | TypeScript/JavaScript |
| pip | requirements.txt / setup.py | Python |
| poetry | pyproject.toml | Python |
| cargo | Cargo.toml (workspace) | Rust |
| go | go.mod | Go |
| maven | pom.xml (modules) | Java |
| gradle | settings.gradle (include) | Java |
| composer | composer.json | PHP |
| nuget | *.sln (Project references) | C# |

**Detection order:** npm → pnpm → yarn → Python → Go → Maven → Gradle → Composer → .NET → Cargo → root package fallback

**Package info extracted:**
- name, path, absolutePath, packageManager, language
- internalDependencies (cross-references between workspace packages)
- externalDependencies (first 20)
- version, description, isRoot

### Output Types

**PackageContext:**
```typescript
{
  package: { name, path, language, description? },
  summary: { totalPatterns, totalConstraints, totalFiles, totalEntryPoints, totalDataAccessors, estimatedTokens },
  patterns: ContextPattern[],      // sorted by occurrences desc
  constraints: ContextConstraint[],
  entryPoints: ContextEntryPoint[], // max 50
  dataAccessors: ContextDataAccessor[], // max 30
  keyFiles: Array<{ file, reason, patterns }>, // max 10, scored by pattern density
  guidance: { keyInsights, commonPatterns, warnings },
  dependencies?: Array<{ name, patterns }>,
  metadata: { generatedAt, driftVersion, contextVersion }
}
```

## v2 Notes
- This is the most important MCP feature — it's what makes `drift_context` work.
- The PackageDetector's 11-language support is impressive — must be preserved.
- Token budgeting and trimming logic is critical for AI agent efficiency.
- The guidance generation (insights, common patterns, warnings) adds significant value.
- Consider: Should context generation be partially in Rust for speed on large monorepos?
