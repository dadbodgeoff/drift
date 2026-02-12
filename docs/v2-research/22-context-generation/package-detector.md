# Context Generation — Package Detector

> `packages/core/src/context/package-detector.ts` — ~530 lines
> Detects packages across 11 package managers in monorepos.

## Purpose

The PackageDetector is responsible for discovering all packages in a project, whether it's a single-package repo or a complex monorepo with dozens of packages across multiple languages. It provides the foundation for package-scoped context generation.

## Class: PackageDetector

Extends `EventEmitter`. Caches detection results after first run.

### Constructor

```typescript
constructor(rootDir: string)
```

### Public API

| Method | Returns | Description |
|--------|---------|-------------|
| `detect()` | `Promise<MonorepoStructure>` | Full monorepo detection (cached after first call) |
| `getPackage(nameOrPath)` | `Promise<DetectedPackage \| null>` | Find package by name, path, or partial match |
| `clearCache()` | `void` | Invalidate cached detection results |

### Package Lookup Strategy

`getPackage()` resolves packages in this order:
1. Exact name match
2. Exact path match (normalized)
3. Path suffix/prefix match
4. Partial name match (substring)

## Supported Package Managers

| Manager | Detection File | Language | Workspace Support |
|---------|---------------|----------|-------------------|
| npm | `package.json` → `workspaces` | TypeScript/JavaScript | Glob patterns |
| pnpm | `pnpm-workspace.yaml` | TypeScript/JavaScript | YAML packages list |
| yarn | `package.json` + `yarn.lock` | TypeScript/JavaScript | Same as npm |
| pip | `requirements.txt` / `setup.py` | Python | `src/*/` directories |
| poetry | `pyproject.toml` | Python | `[tool.poetry]` section |
| cargo | `Cargo.toml` → `[workspace]` | Rust | `members` array |
| go | `go.mod` | Go | `internal/`, `pkg/`, `cmd/` dirs |
| maven | `pom.xml` → `<modules>` | Java | `<module>` elements |
| gradle | `settings.gradle` / `.kts` | Java | `include` statements |
| composer | `composer.json` | PHP | Single package |
| nuget | `*.sln` → Project references | C# | `.csproj` references |

### Detection Order

Detectors run sequentially. First one that finds packages wins:

```
npm → pnpm → yarn → Python → Go → Maven → Gradle → Composer → .NET → Cargo
```

If no detector finds packages, falls back to root package detection (checks for any manifest file).

## Detection Details

### JavaScript/TypeScript (npm/pnpm/yarn)

**npm:** Reads `package.json` → `workspaces` field (supports both array and `{ packages: [...] }` format). Resolves workspace globs by reading directories.

**pnpm:** Parses `pnpm-workspace.yaml` with regex to extract `packages:` list. Resolves same glob patterns.

**yarn:** Reuses npm detection, then checks for `yarn.lock` to confirm yarn.

**Workspace glob resolution:** For each glob pattern, strips the wildcard suffix, reads the base directory, and checks each subdirectory for a `package.json`.

**Language detection from package.json:**
- Has `typescript` or `@types/node` in deps → `typescript`
- Has `react`, `vue`, or `@angular/core` → `typescript`
- Otherwise → `javascript`

**Dependency extraction:**
- Internal deps: Cross-referenced against known workspace package names
- External deps: First 20 from `dependencies` field

### Python

**Poetry:** Parses `pyproject.toml` for `[tool.poetry]` section. Extracts name, version, and dependencies.

**pip/src layout:** Scans `src/` directory for subdirectories containing `__init__.py`.

### Go

Reads `go.mod` for module name. Scans `internal/`, `pkg/`, `cmd/` directories for sub-packages.

### Java (Maven/Gradle)

**Maven:** Parses `pom.xml` for `<artifactId>`, `<groupId>`, `<version>`. Extracts `<module>` elements from `<modules>` section.

**Gradle:** Reads `settings.gradle` or `settings.gradle.kts`. Extracts `rootProject.name` and `include` statements. Converts colon-separated paths (`:app:core`) to filesystem paths (`app/core`).

### PHP (Composer)

Reads `composer.json` for name, version, description, and `require` dependencies.

### C# (.NET)

Finds `.sln` files, parses `Project(...)` references to extract `.csproj` project paths.

### Rust (Cargo)

Reads `Cargo.toml` for package name/version. Parses `[workspace]` section for `members` array.

## Events

| Event | When | Details |
|-------|------|---------|
| `monorepo:detected` | After detection completes | `{ isMonorepo, packageCount, packageManager }` |
| `package:detected` | Each package found | Package name |

## Root Package Fallback

If no workspace/monorepo is detected, checks for manifest files in this order:

```
package.json → pyproject.toml → setup.py → Cargo.toml → go.mod → pom.xml → build.gradle → composer.json
```

Creates a single root package from the first manifest found.

## v2 Notes

- The 11-language detection is a significant differentiator — must be preserved
- Consider adding: Bun (`bun.lockb`), Deno (`deno.json`), Swift (Package.swift), Kotlin Multiplatform
- Caching is simple (single `MonorepoStructure | null`) — could benefit from file-watcher invalidation
- Workspace glob resolution is manual (no `glob` library) — works but limited to single-level wildcards
