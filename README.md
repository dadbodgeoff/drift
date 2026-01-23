# 🔍 Drift

**Codebase pattern detection for AI agents and developers**

Drift scans your codebase, learns your patterns, and feeds that context to AI agents via MCP. Your AI finally understands *your* conventions.

[![npm version](https://img.shields.io/npm/v/driftdetect.svg)](https://www.npmjs.com/package/driftdetect)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
npm install -g driftdetect
```

## Supported Languages

| Language | Frameworks |
|----------|------------|
| TypeScript/JavaScript | React, Next.js, Express, Node.js |
| Python | FastAPI, Django, Flask |
| C# | ASP.NET Core, Entity Framework |
| Java | Spring Boot, JPA |
| PHP | Laravel, Eloquent |

---

## Option 1: CLI Usage

### Quick Start

```bash
cd your-project
drift init
drift scan
drift status
```

That's it. Drift discovers patterns across 15 categories (auth, api, errors, components, etc.) and stores them in `.drift/`.

### Key Commands

```bash
drift scan                    # Scan for patterns
drift status                  # View pattern summary
drift dashboard               # Open web UI
drift approve <pattern-id>    # Approve a pattern
drift check                   # CI-friendly violation check
```

### What You Get

- **Pattern Detection**: 150+ detectors find how your code handles auth, errors, APIs, etc.
- **Violation Alerts**: Flag code that deviates from established patterns
- **Sensitive Data Tracking**: Know which endpoints touch PII, credentials, financial data
- **Contract Detection**: Find mismatches between your backend API and frontend calls

---

## Option 2: MCP Server (AI Agent Integration)

The real power is connecting Drift to your AI agent. Your agent can query your codebase patterns in real-time.

### Setup

Add to your MCP config (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "drift": {
      "command": "npx",
      "args": ["-y", "driftdetect-mcp"]
    }
  }
}
```

Then initialize your project:

```bash
cd your-project
drift init
drift scan
```

### What Your AI Can Do

Once connected, your AI agent has access to these tools:

| Tool | What It Does |
|------|--------------|
| `drift_status` | Get codebase health snapshot |
| `drift_context` | Get curated context for a task (recommended starting point) |
| `drift_patterns_list` | List detected patterns with filters |
| `drift_pattern_get` | Get full details on a specific pattern |
| `drift_code_examples` | Get real code examples from your codebase |
| `drift_security_summary` | Security posture and sensitive data access |
| `drift_impact_analysis` | What breaks if I change this file? |
| `drift_reachability` | What data can this code access? |

### Example Conversation

**You**: "Add a new API endpoint for user preferences"

**AI (via Drift MCP)**:
> Based on your codebase patterns:
> - Your API routes use the `@Controller` decorator with `/api/v1` prefix
> - Error responses follow `{ error: string, code: number }` format
> - All user endpoints require `@RequireAuth()` middleware
> - Similar endpoints: `src/controllers/user.controller.ts`
>
> Here's the implementation following your conventions...

The AI generates code that actually fits your codebase because it queried your real patterns.

---

## Highlights

### 🔍 Pattern Detection
150+ detectors across auth, API, errors, components, data-access, security, and more. Learns your conventions automatically.

### 📊 Call Graph Analysis
Static analysis answering "What data can this code access?" and "Who can reach this sensitive field?"

```bash
drift callgraph reach src/api/users.ts:42    # What data can line 42 access?
drift callgraph inverse users.password_hash  # Who can access passwords?
```

### 🌌 Galaxy Visualization
3D visualization of your database access patterns. Tables as planets, APIs as space stations, data flows as hyperspace lanes.

```bash
drift dashboard  # Click Galaxy tab
```

### 🔒 Security Boundaries
Track sensitive data access across your codebase. Know which endpoints touch PII, credentials, or financial data.

```bash
drift boundaries                    # Overview
drift boundaries table users        # Who accesses the users table?
```

### 📈 Trend Detection
Track pattern health over time. Get alerts when patterns regress.

```bash
drift trends
```

---

## Troubleshooting

**Scan takes too long?**
- Check `.driftignore` excludes `node_modules/`, `dist/`, `.git/`
- Try `drift scan src/` to scan a subdirectory
- Use `drift scan --timeout 600` for large codebases

**Scan fails?**
- Run `drift init` first
- Try `drift scan --verbose` for details
- Report issues: [GitHub Issues](https://github.com/dadbodgeoff/drift/issues)

---

## Links

- [Full Documentation](https://github.com/dadbodgeoff/drift/wiki)
- [Report a Bug](https://github.com/dadbodgeoff/drift/issues)
- [Discussions](https://github.com/dadbodgeoff/drift/discussions)

## License

MIT © Geoffrey Fernald
