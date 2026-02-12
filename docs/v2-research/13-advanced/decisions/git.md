# Git Integration

## Location
`packages/core/src/decisions/git/`

## Purpose
Provides git history traversal, commit message parsing, and diff analysis for the decision mining pipeline.

## Files
- `git-walker.ts` — `GitWalker`: traverse git history
- `commit-parser.ts` — `CommitParser`: parse conventional commits
- `diff-analyzer.ts` — Diff analysis utilities
- `types.ts` — Git-specific type definitions
- `index.ts` — Public exports

---

## GitWalker

### Purpose
Traverses git history using `simple-git`, returning structured commit data with file changes.

### Configuration
```typescript
interface GitWalkerOptions {
  rootDir: string;
  since?: Date;
  until?: Date;
  maxCommits?: number;          // Default: 1000
  includeMergeCommits?: boolean; // Default: false
  excludePaths?: string[];
}
```

### Methods
- `walk() → GitWalkResult` — main traversal, returns commits + metadata
- `detectLanguage(filePath) → LanguageDetection` — language + confidence from file extension
- `classifyFile(filePath) → FileClassification` — source, test, config, docs, etc.

### GitCommit
```typescript
interface GitCommit {
  sha: string;
  shortSha: string;           // 7 chars
  subject: string;            // First line
  body: string;               // Full message body
  authorName: string;
  authorEmail: string;
  date: Date;
  files: GitFileChange[];
  parents: string[];
  branch?: string;
  pullRequest?: PullRequestInfo;
  isMerge: boolean;
}
```

### GitFileChange
```typescript
interface GitFileChange {
  path: string;
  previousPath?: string;      // For renames
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  additions: number;
  deletions: number;
}
```

---

## CommitParser

### Purpose
Parses conventional commit messages and extracts semantic signals.

### Methods
- `parseCommitMessage(message) → ParsedCommitMessage` — type, scope, subject, body, footers, breaking changes
- `extractMessageSignals(message) → MessageSignal[]` — keywords like "breaking", "deprecate", "migrate", "security"

### Conventional Commit Types
`feat`, `fix`, `refactor`, `perf`, `chore`, `docs`, `test`, `ci`, `build`, `style`

### ParsedCommitMessage
```typescript
interface ParsedCommitMessage {
  type: ConventionalCommitType;
  scope?: string;
  subject: string;
  body?: string;
  footers: FooterToken[];
  references: MessageReference[];
  isBreaking: boolean;
}
```

---

## DiffAnalyzer

### Purpose
Analyzes file diffs for architectural signals and dependency changes.

### Functions
- `parseDiff(diffText) → ParsedDiff` — hunks and line-level changes
- `analyzeArchitecturalSignals(diff, files) → ArchitecturalSignal[]` — structural changes (new modules, moved files, API changes)
- `analyzeDependencyChanges(files) → DependencyDelta[]` — parses package.json / requirements.txt / pom.xml changes
- `analyzeDependencyChangesSync(files)` — synchronous variant
- `compareManifests(before, after) → ManifestDiff` — added/removed/changed dependencies

### ParsedDiff
```typescript
interface ParsedDiff {
  hunks: DiffHunk[];
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}
```

## Rust Rebuild Considerations
- Git operations use `simple-git` (Node.js) — would need `git2` crate in Rust
- Commit parsing is string manipulation — straightforward in Rust
- Diff analysis is text processing — Rust's `similar` crate handles this well
- The main benefit would be speed on repos with 10k+ commits
