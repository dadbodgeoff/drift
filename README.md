# 🔍 Drift

**The most comprehensive MCP server for codebase intelligence**

Drift scans your codebase, learns YOUR patterns, and gives AI agents deep understanding of your conventions. 27 CLI commands. 23 MCP tools. 6 languages. Your AI finally writes code that fits.

[![npm version](https://img.shields.io/npm/v/driftdetect.svg)](https://www.npmjs.com/package/driftdetect)
[![npm downloads](https://img.shields.io/npm/dm/driftdetect.svg)](https://www.npmjs.com/package/driftdetect)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

<!-- Add a demo GIF here showing the MCP in action or Galaxy visualization -->
<!-- ![Drift Demo](./docs/demo.gif) -->

---

## Why Drift?

| Problem | Drift's Solution |
|---------|------------------|
| AI generates generic code that doesn't match your style | Learns patterns from YOUR codebase, not hardcoded rules |
| "What data can this code access?" | Call graph reachability analysis across 6 languages |
| "What breaks if I change this?" | Impact analysis with blast radius calculation |
| "Which tests should I run?" | Test topology with minimum test set calculation |
| Security review is manual | Automatic sensitive data tracking (PII, credentials, financial) |

---

## Quick Start

```bash
# Install
npm install -g driftdetect

# Initialize and scan
cd your-project
drift init
drift scan

# See what Drift learned
drift status
```

---

## Use with AI Agents (MCP)

Add to your MCP config (Claude Desktop, Cursor, Windsurf, etc.):

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

Then ask your AI: *"Add a new API endpoint for user preferences"*

Drift tells it: your routes use `@Controller` with `/api/v1` prefix, errors follow `{ error, code }` format, user endpoints need `@RequireAuth()`, and here are 3 similar endpoints to reference.

---

## Supported Languages

| Language | Parsing | Call Graph | Data Access | Frameworks |
|----------|---------|------------|-------------|------------|
| TypeScript/JS | ✅ Tree-sitter | ✅ | ✅ | React, Next.js, Express, Prisma, TypeORM |
| Python | ✅ Tree-sitter | ✅ | ✅ | Django, FastAPI, Flask, SQLAlchemy |
| Java | ✅ Tree-sitter | ✅ | ✅ | Spring Boot, JPA/Hibernate |
| C# | ✅ Tree-sitter | ✅ | ✅ | ASP.NET Core, Entity Framework |
| PHP | ✅ Tree-sitter | ✅ | ✅ | Laravel, Eloquent |

---

## What Makes Drift Different

### 🧠 Learning-Based Detection
Most linters use hardcoded rules. Drift learns from YOUR code:
- Scans your codebase to discover patterns
- You approve/ignore what matters
- Detects violations against YOUR conventions

### 📊 Call Graph Analysis
Static analysis that answers real questions:
```bash
drift callgraph reach src/api/users.ts:42    # What data can line 42 access?
drift callgraph inverse users.password_hash  # Who can access passwords?
```

### 🔒 Security Boundaries
Track sensitive data across your codebase:
- Automatic PII, credential, and financial data detection
- GDPR/HIPAA/PCI-DSS implications flagged
- Know which endpoints touch what data

### 🧪 Test Topology
Smart test analysis:
```bash
drift test-topology affected src/auth/login.ts  # Minimum tests to run
drift test-topology uncovered --min-risk high   # High-risk untested code
```

### 🔗 Module Coupling
Dependency health metrics:
```bash
drift coupling cycles      # Find dependency cycles
drift coupling hotspots    # High-coupling modules
drift coupling unused-exports  # Dead exports
```

### ⚠️ Error Handling Analysis
Find gaps in error handling:
```bash
drift error-handling gaps       # Unhandled errors
drift error-handling unhandled  # Swallowed exceptions
```

---

## MCP Tools (23 Total)

Drift's MCP server is organized in layers for efficient token usage:

| Layer | Tools | Purpose |
|-------|-------|---------|
| **Orchestration** | `drift_context` | Intent-aware context (start here) |
| **Discovery** | `drift_status`, `drift_capabilities`, `drift_projects` | Quick overview |
| **Exploration** | `drift_patterns_list`, `drift_security_summary`, `drift_contracts_list`, `drift_trends` | Browse patterns |
| **Detail** | `drift_pattern_get`, `drift_code_examples`, `drift_file_patterns`, `drift_impact_analysis`, `drift_reachability`, `drift_wrappers`, `drift_dna_profile` | Deep dives |
| **Analysis** | `drift_test_topology`, `drift_coupling`, `drift_error_handling` | Code health |
| **Generation** | `drift_suggest_changes`, `drift_validate_change`, `drift_explain` | AI assistance |

---

## CLI Commands (27 Total)

**Core**: `init`, `scan`, `check`, `status`, `approve`, `ignore`, `report`

**Navigation**: `where`, `files`, `export`

**Monitoring**: `watch`, `dashboard`, `trends`

**Analysis**: `boundaries`, `callgraph`, `test-topology`, `coupling`, `error-handling`, `wrappers`, `dna`

**Management**: `projects`, `skills`, `parser`, `migrate-storage`

---

## Pattern Categories (14)

`api` · `auth` · `security` · `errors` · `logging` · `data-access` · `config` · `testing` · `performance` · `components` · `styling` · `structural` · `types` · `accessibility`

---

## Galaxy Visualization

3D visualization of your data access patterns. Tables as planets, APIs as space stations, data flows as hyperspace lanes.

```bash
drift dashboard  # Click Galaxy tab
```

---

## CI Integration

```bash
# Fail on violations
drift check --ci --fail-on warning

# GitHub Actions annotations
drift check --format github

# GitLab CI format  
drift check --format gitlab
```

---

## Export Formats

```bash
drift export --format json        # Full manifest
drift export --format ai-context  # Optimized for LLMs
drift export --format markdown    # Documentation
drift export --format summary     # Human-readable
```

---

## Links

- [Documentation](https://github.com/dadbodgeoff/drift/wiki)
- [MCP Setup Guide](./docs/mcp-setup.md)
- [Pattern Categories](./docs/pattern-categories.md)
- [Report a Bug](https://github.com/dadbodgeoff/drift/issues)
- [Discussions](https://github.com/dadbodgeoff/drift/discussions)

---

## License

MIT © Geoffrey Fernald
