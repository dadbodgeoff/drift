# 🔍 Drift

**AI-augmented architectural drift detection for modern codebases**

Drift learns your codebase patterns and catches inconsistencies before they become technical debt. It's like ESLint, but for architectural decisions.

[![npm version](https://img.shields.io/npm/v/driftdetect.svg)](https://www.npmjs.com/package/driftdetect)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

## 🚀 What's New in v0.4.0

> **Major Release**: Call Graph Analysis, Galaxy Visualization & Enterprise Architecture

### ⭐ Headline Features

| Feature | Description |
|---------|-------------|
| 🌌 **Galaxy Visualization** | 3D visualization of database access patterns - tables as planets, APIs as space stations, data flows as hyperspace lanes |
| 📊 **Call Graph Analysis** | Static analysis engine answering "What data can this code access?" across Python, TypeScript, C#, Java, PHP |
| 🔒 **Security Enrichment** | Connect vulnerabilities to actual data exposure with P0-P4 priority tiers and remediation guidance |
| 🏢 **Enterprise MCP v2** | Layered tool architecture with rate limiting, caching, and token-budget awareness |
| 🗄️ **Data Lake** | Optimized storage with materialized views for instant queries |

### New Commands

```bash
# Call graph analysis
drift callgraph build              # Build call graph
drift callgraph reach src/api.ts:42  # What data can line 42 access?
drift callgraph inverse users.password_hash  # Who can access passwords?
drift callgraph impact src/auth/   # What breaks if auth changes?
drift callgraph dead               # Find dead code
drift callgraph coverage           # Sensitive data test coverage

# Multi-project support
drift projects list                # List registered projects
drift projects add ./backend       # Register a project
drift projects switch backend      # Switch active project
```

### Galaxy Visualization

Launch the dashboard and click the **Galaxy** tab to explore your data access patterns in 3D:

```bash
drift dashboard
```

- 🪐 **Tables** = Planets (sized by importance, colored by sensitivity)
- 🌙 **Fields** = Moons orbiting tables
- 🛸 **API Endpoints** = Space stations
- ✨ **Data Paths** = Animated hyperspace lanes
- 🔴 **P0-P4 Tiers** = Security priority indicators

[See full changelog →](CHANGELOG.md)

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
| `drift trends` | View pattern regressions over time |
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
- **Overview**: Health score, violation summary, and pattern trends
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

## Pattern Regression Detection

Drift tracks pattern health over time and alerts you when patterns regress:

```bash
# View trends from the CLI
drift trends

# View trends for the last 30 days
drift trends --period 30d
```

After each scan, Drift creates a snapshot of your pattern state. It then compares snapshots to detect:

- **Confidence drops**: Pattern confidence fell below threshold
- **Compliance drops**: More outliers appeared, reducing compliance rate
- **New outliers**: Significant increase in code deviating from patterns

### Example Output

```
📊 Pattern Trends

Overall: 📉 DECLINING
Period: 2026-01-13 → 2026-01-20

──────────────────────────────────────────────────
  Regressions:   3
  Improvements:  1
  Stable:        42
──────────────────────────────────────────────────

📉 Regressions (3):

  Critical:
    • api/response-envelope (api)
      Compliance dropped from 95% to 78% (-18%)

  Warning:
    • auth/middleware-usage (auth)
      Confidence dropped from 92% to 85% (-8%)
```

The dashboard also shows trends in the Overview tab with visual indicators.

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

## Call Graph Analysis

Drift builds a complete call graph of your codebase to answer security-critical questions:

### What data can this code access?

```bash
drift callgraph reach src/api/users.ts:42
```

```
📍 Starting from: src/api/users.ts:42 (getUserProfile)

🗄️ Reachable Tables:
  • users (via UserService.findById)
  • sessions (via SessionManager.validate)
  • audit_logs (via AuditService.log)

🔐 Sensitive Fields Reachable:
  • users.password_hash (credentials) - depth 2
  • users.email (pii) - depth 2
  • users.ssn (financial) - depth 3

📊 Attack Surface: 12 functions, max depth 4
```

### Who can access this sensitive data?

```bash
drift callgraph inverse users.password_hash
```

```
🎯 Target: users.password_hash

🚪 Entry Points That Can Reach This Data:
  • POST /api/auth/login (public)
  • POST /api/auth/register (public)
  • PUT /api/users/:id/password (authenticated)

⚠️ Security Concern: 2 public endpoints can reach credential data
```

### Sensitive Data Test Coverage

```bash
drift callgraph coverage
```

```
📊 Sensitive Data Coverage Analysis

Summary:
  Total Sensitive Fields: 24
  Total Access Paths: 156
  Tested Paths: 89 (57%)

By Sensitivity:
  credentials: 8 fields, 23% coverage ⚠️
  financial: 6 fields, 45% coverage
  pii: 10 fields, 72% coverage

🔴 Uncovered Critical Paths:
  1. POST /api/auth/reset → users.password_hash
  2. GET /api/admin/export → users.ssn
```

---

## Galaxy Visualization

The Galaxy view transforms your database access patterns into an interactive 3D space visualization:

```bash
drift dashboard
# Click "Galaxy" tab
```

### Visual Elements

| Element | Represents | Visual Cues |
|---------|------------|-------------|
| 🪐 Planets | Database tables | Size = row count, Color = sensitivity |
| 🌙 Moons | Table fields | Orbit sensitive tables, glow if untested |
| 🛸 Stations | API endpoints | Shape indicates auth level |
| ✨ Lanes | Data access paths | Animated particles show data flow |
| 🔴 Rings | Security tiers | P0 (red) → P4 (green) |

### View Modes

- **Overview**: Full galaxy view
- **Security**: Highlight sensitive data paths
- **Coverage**: Show tested vs untested paths
- **Blast Radius**: Impact analysis for selected item

### Controls

- **Click** planet/station to inspect
- **Scroll** to zoom
- **Drag** to rotate
- **Search** to find tables/endpoints
- **Filter** by sensitivity level

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
| `driftdetect-core` | Core pattern matching engine, call graph, data lake |
| `driftdetect-detectors` | Pattern detectors (150+) |
| `driftdetect-dashboard` | Web dashboard with Galaxy visualization |
| `driftdetect-galaxy` | 3D database access visualization (React Three Fiber) |
| `driftdetect-mcp` | MCP server for AI agent integration |
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

## Supported Languages

Drift supports pattern detection across these languages and frameworks:

| Language | Frameworks | File Extensions |
|----------|------------|-----------------|
| **TypeScript/JavaScript** | React, Next.js, Express, Node.js | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` |
| **Python** | FastAPI, Django, Flask | `.py`, `.pyw` |
| **C#** | ASP.NET Core, Entity Framework | `.cs` |
| **Java** | Spring Boot, JPA | `.java` |
| **PHP** | Laravel, Eloquent | `.php` |
| **CSS** | Tailwind, SCSS, Sass | `.css`, `.scss`, `.sass`, `.less` |
| **Config** | JSON, YAML | `.json`, `.yaml`, `.yml` |
| **Docs** | Markdown | `.md`, `.mdx` |

---

## Troubleshooting

### Scan takes too long or hangs

**Expected performance**: Most codebases scan in under 30 seconds. If your scan takes more than a minute, something may be wrong.

**Common causes:**
1. **Large directories not ignored** - Check your `.driftignore` file:
   ```
   node_modules/
   dist/
   build/
   .git/
   vendor/
   __pycache__/
   .venv/
   ```

2. **Very large codebase** - Try scanning a subdirectory first:
   ```bash
   drift scan src/
   ```

3. **Increase timeout** if you have a legitimately large codebase:
   ```bash
   drift scan --timeout 600  # 10 minutes
   ```

4. **Run verbose mode** to see what's happening:
   ```bash
   drift scan --verbose
   ```

### Scan fails with errors

If you encounter errors during scanning:

1. Make sure you've run `drift init` first
2. Check that your code files are valid (no syntax errors)
3. Try scanning with `--verbose` to see detailed output
4. Report persistent issues at [GitHub Issues](https://github.com/dadbodgeoff/drift/issues)

When reporting issues, please include:
- Language/framework you're scanning
- Approximate number of files
- Any error messages
- Your OS and Node.js version (`node --version`)

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
