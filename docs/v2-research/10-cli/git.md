# CLI Git Integration

## Location
`packages/cli/src/git/`

## Purpose
Git integration layer providing staged file detection for `drift check --staged`, repository detection for project root resolution, and Git hook management for CI/CD integration. Supports both Husky-based and direct `.git/hooks` installation.

## Files
- `staged-files.ts` — File change detection: staged, changed, untracked files + repo detection
- `hooks.ts` — Git hook management: install, uninstall, status for pre-commit and pre-push
- `index.ts` — Barrel exports

## Staged Files (`staged-files.ts`)

All functions use `child_process.exec` with `promisify`. Error handling distinguishes between "git not installed" (`ENOENT`) and other failures.

### Functions

```typescript
// Staged files only (for --staged flag)
getStagedFiles(rootDir): Promise<string[]>
// git diff --cached --name-only --diff-filter=ACMR

// All changed files (staged + unstaged)
getChangedFiles(rootDir): Promise<string[]>
// git diff --name-only --diff-filter=ACMR HEAD

// Untracked files
getUntrackedFiles(rootDir): Promise<string[]>
// git ls-files --others --exclude-standard

// Repository detection
isGitRepository(dirPath): Promise<boolean>
// git rev-parse --git-dir

// Root directory resolution
getGitRoot(dirPath): Promise<string>
// git rev-parse --show-toplevel
```

### Diff Filter: `ACMR`
Only includes files that are Added, Copied, Modified, or Renamed. Excludes deleted files (which can't be scanned).

## Git Hooks (`hooks.ts`)

### Hook Types
Two hook types supported:
- `pre-commit` — Runs `drift check --staged` before commit
- `pre-push` — Runs `drift check` (full) before push

### Hook Scripts

Pre-commit:
```sh
#!/bin/sh
set -e
npx drift check --staged
exit $?
```

Pre-push:
```sh
#!/bin/sh
set -e
npx drift check
exit $?
```

### Installation Strategy
1. Check if Husky is installed (`.husky/` directory exists)
2. If Husky available and `preferHusky` not disabled → install in `.husky/<hookType>`
3. Otherwise → install in `.git/hooks/<hookType>` (resolved via `git rev-parse --git-path hooks`)
4. Hooks are written with `mode: 0o755` (executable)

### Conflict Handling
- If hook already exists and contains `drift check` → report already configured
- If hook exists without Drift → refuse unless `--force` flag
- Only Drift-owned hooks are uninstalled (checks for `drift check` or `Drift` in content)

### Key Types

```typescript
type HookType = 'pre-commit' | 'pre-push';

interface HookInstallResult {
  success: boolean;
  hookType: HookType;
  method: 'husky' | 'git';
  message: string;
  path?: string;
}

interface HookInstallOptions {
  force?: boolean;        // Overwrite existing hooks
  preferHusky?: boolean;  // Use Husky if available (default: true)
}
```

### Public API

```typescript
// Individual hook installation
installPreCommitHook(rootDir, options?): Promise<HookInstallResult>
installPrePushHook(rootDir, options?): Promise<HookInstallResult>

// Batch operations
installAllHooks(rootDir, options?): Promise<HookInstallResult[]>
uninstallHook(rootDir, hookType): Promise<boolean>
uninstallAllHooks(rootDir): Promise<Record<HookType, boolean>>

// Status
getHooksStatus(rootDir): Promise<Record<HookType, { installed, method?, path? }>>

// Detection
isHuskyInstalled(rootDir): Promise<boolean>
getGitHooksDir(rootDir): Promise<string>
```

## Usage in Commands
- `drift check --staged` → `getStagedFiles()` to get file list
- `drift check` → `getChangedFiles()` for incremental checking
- `drift init` → `isGitRepository()` for repo detection
- `drift setup` → Hook installation during onboarding (not yet wired)

## Rust Rebuild Considerations
- Git operations shell out to `git` CLI — this is the correct approach (no need for libgit2)
- Hook scripts are shell scripts — language-agnostic, no migration needed
- File change detection could be optimized with `git2` Rust crate for large repos
- The `ACMR` filter logic is simple string parsing — trivial in Rust
- Hook management is filesystem operations — `std::fs` handles this cleanly
- Consider: Rust binary could be called directly from hooks instead of `npx drift check`
