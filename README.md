# 🔍 Drift

**AI-augmented architectural drift detection for modern codebases**

Drift learns your codebase patterns and catches inconsistencies before they become technical debt. It's like ESLint, but for architectural decisions.

[![npm version](https://img.shields.io/npm/v/driftdetect.svg)](https://www.npmjs.com/package/driftdetect)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

## Why Drift?

Every codebase develops conventions over time:
- How API routes are structured
- How errors are handled
- How components are organized
- How authentication flows work

But these patterns aren't documented anywhere. New team members don't know them. Even experienced devs forget. Code reviews catch some issues, but not all.

**Drift solves this by:**
1. 🔍 **Learning** your existing patterns automatically
2. ✅ **Approving** patterns you want to enforce
3. ⚠️ **Flagging** code that deviates from established patterns
4. 📊 **Visualizing** architectural health in a dashboard

---

## Quick Start

```bash
# Install globally
npm install -g driftdetect

# Or use npx
npx driftdetect init
```

### Initialize in your project

```bash
cd your-project
drift init
```

This creates a `.drift/` folder to store patterns and configuration.

### Scan your codebase

```bash
drift scan
```

Drift analyzes your code and discovers patterns across 15+ categories:
- API routes & responses
- Authentication flows
- Error handling
- Component structure
- Styling conventions
- And more...

### Review patterns

```bash
drift status
```

See discovered patterns and their confidence scores. High-confidence patterns (≥85%) are likely real conventions worth enforcing.

### Approve patterns

```bash
# Approve a specific pattern
drift approve <pattern-id>

# Or use the interactive dashboard
drift dashboard
```

Once approved, Drift will flag any code that deviates from the pattern.

---

## Commands

| Command | Description |
|---------|-------------|
| `drift init` | Initialize Drift in your project |
| `drift scan` | Scan codebase for patterns |
| `drift scan --contracts` | Also detect BE↔FE contract mismatches |
| `drift status` | Show pattern summary |
| `drift check` | Check for violations (CI-friendly) |
| `drift dashboard` | Open web dashboard |
| `drift approve <id>` | Approve a pattern |
| `drift ignore <id>` | Ignore a pattern |
| `drift where <pattern>` | Find where a pattern is used |
| `drift files <path>` | Show patterns in a file |
| `drift export` | Export patterns for AI context |

---

## Dashboard

The dashboard provides a visual interface for managing patterns:

```bash
drift dashboard
```

Opens at `http://localhost:3847` with:
- **Overview**: Health score and violation summary
- **Patterns**: Browse by category, approve/ignore patterns
- **Violations**: See all deviations with code context
- **Files**: Explore patterns by file
- **Contracts**: View BE↔FE API contract mismatches

### Quick Review

For high-confidence patterns (≥95%), use Quick Review to bulk-approve:

1. Click "⚡ Quick Review" in the Patterns tab
2. Review patterns one by one
3. Exclude any you're unsure about
4. Click "Approve All" to approve the rest

---

## Pattern Categories

Drift detects patterns across these categories:

| Category | What it detects |
|----------|-----------------|
| **api** | Route structure, HTTP methods, response formats |
| **auth** | Authentication flows, session handling, permissions |
| **security** | Input validation, sanitization, security headers |
| **errors** | Error handling, try/catch patterns, error boundaries |
| **logging** | Console usage, logging conventions, debug statements |
| **data-access** | Database queries, ORM patterns, data fetching |
| **config** | Environment variables, configuration management |
| **testing** | Test structure, mocking patterns, assertions |
| **performance** | Caching, memoization, lazy loading |
| **components** | React/Vue component structure, hooks, state |
| **styling** | CSS conventions, design tokens, Tailwind usage |
| **structural** | File naming, imports, exports, organization |
| **types** | TypeScript types, interfaces, generics |
| **accessibility** | ARIA labels, keyboard navigation, a11y |
| **documentation** | Comments, JSDoc, README patterns |

---

## CI Integration

Add Drift to your CI pipeline to catch violations before merge:

```yaml
# GitHub Actions
- name: Check for drift
  run: npx driftdetect check --ci
```

The `check` command exits with code 1 if there are error-level violations.

### Options

```bash
drift check --ci              # CI mode (non-interactive)
drift check --fail-on warning # Fail on warnings too
drift check --format json     # JSON output for parsing
```

---

## Configuration

Configuration lives in `.drift/config.json`:

```json
{
  "version": "1.0.0",
  "detectors": [
    { "id": "api", "enabled": true },
    { "id": "styling", "enabled": true }
  ],
  "severityOverrides": {
    "styling/design-tokens": "warning"
  },
  "ignorePatterns": [
    "node_modules/**",
    "dist/**",
    "**/*.test.ts"
  ]
}
```

### .driftignore

Create a `.driftignore` file to exclude paths:

```
# Dependencies
node_modules/
.pnpm/

# Build output
dist/
build/
.next/

# Tests (optional)
**/*.test.ts
**/*.spec.ts
```

---

## BE↔FE Contract Detection

Drift can detect mismatches between your backend API and frontend code:

```bash
drift scan --contracts
```

This finds:
- **Missing fields**: Frontend expects fields the backend doesn't return
- **Type mismatches**: Backend returns `string`, frontend expects `number`
- **Optional vs required**: Backend field is optional but frontend assumes it exists
- **Extra fields**: Backend returns fields the frontend doesn't use

Works with:
- **Backend**: Python/FastAPI, Node/Express
- **Frontend**: TypeScript/React with fetch/axios

---

## VS Code Extension

Install the VS Code extension for inline pattern highlighting:

1. Open VS Code
2. Go to Extensions (Cmd+Shift+X)
3. Search for "Drift"
4. Install

Features:
- Inline violation highlighting
- Quick fixes for common issues
- Pattern info on hover
- Jump to pattern definition

---

## How It Works

### 1. Detection

Drift runs 50+ detectors that analyze your code using:
- AST parsing for structural patterns
- Regex matching for naming conventions
- Semantic analysis for behavioral patterns

### 2. Confidence Scoring

Each pattern gets a confidence score based on:
- **Frequency**: How often the pattern appears
- **Consistency**: How uniform the implementations are
- **Spread**: How many files use the pattern
- **Age**: How long the pattern has existed

### 3. Outlier Detection

Once a pattern is established, Drift identifies outliers:
- Code that almost matches but deviates slightly
- Files that should follow the pattern but don't
- Inconsistent implementations

### 4. Violation Reporting

Violations are categorized by severity:
- **Error**: Clear deviation from approved pattern
- **Warning**: Potential issue worth reviewing
- **Info**: Informational, might be intentional
- **Hint**: Suggestion for improvement

---

## Programmatic API

Use Drift programmatically in your tools:

```typescript
import { PatternStore, FileWalker } from 'driftdetect-core';
import { createScannerService } from 'driftdetect';

// Initialize
const store = new PatternStore({ rootDir: process.cwd() });
await store.initialize();

// Scan files
const scanner = createScannerService({ rootDir: process.cwd() });
await scanner.initialize();
const results = await scanner.scanFiles(files, context);

// Access patterns
const patterns = store.getAll();
const approved = store.getApproved();
const violations = store.getViolations();
```

---

## Packages

Drift is a monorepo with these packages:

| Package | Description |
|---------|-------------|
| `driftdetect` | CLI and main entry point |
| `driftdetect-core` | Core pattern matching engine |
| `driftdetect-detectors` | Pattern detectors |
| `driftdetect-dashboard` | Web dashboard |
| `driftdetect-ai` | AI-powered explanations (optional) |
| `driftdetect-lsp` | Language Server Protocol |
| `driftdetect-vscode` | VS Code extension |

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Clone the repo
git clone https://github.com/dadbodgeoff/drift.git
cd drift

# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Run tests
pnpm run test
```

---

## License

MIT © Geoffrey Fernald

---

## Support

- 📖 [Documentation](https://github.com/dadbodgeoff/drift/wiki)
- 🐛 [Report a bug](https://github.com/dadbodgeoff/drift/issues)
- 💬 [Discussions](https://github.com/dadbodgeoff/drift/discussions)
- 🔒 [Security Policy](SECURITY.md)
- ⭐ Star the repo if you find it useful!
