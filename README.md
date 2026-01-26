# 🔍 Drift

**The most comprehensive MCP server for codebase intelligence**

Drift scans your codebase, learns YOUR patterns, and gives AI agents deep understanding of your conventions. 35+ CLI commands. 45+ MCP tools. 8 languages. Your AI finally writes code that fits.

[![npm version](https://img.shields.io/npm/v/driftdetect.svg)](https://www.npmjs.com/package/driftdetect)
[![npm downloads](https://img.shields.io/npm/dm/driftdetect.svg)](https://www.npmjs.com/package/driftdetect)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

---

## The Problem

AI writes code that works but doesn't fit. It ignores your conventions, misses your patterns, and creates inconsistency. You spend more time fixing AI output than you saved.

**Drift fixes this.**

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              YOUR CODEBASE                                   │
│  src/api/users.ts    src/auth/login.ts    src/db/queries.ts                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           1. DRIFT SCAN                                      │
│                                                                              │
│   $ drift init && drift scan                                                │
│                                                                              │
│   Drift analyzes your code with Tree-sitter parsing:                        │
│   • Discovers patterns (how YOU write controllers, services, etc.)          │
│   • Builds call graph (who calls what, data flow)                           │
│   • Maps security boundaries (what touches sensitive data)                  │
│   • Tracks test coverage (which code is tested)                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          2. PATTERN LEARNING                                 │
│                                                                              │
│   Drift discovers YOUR conventions:                                          │
│                                                                              │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐            │
│   │ API Pattern     │  │ Error Pattern   │  │ Auth Pattern    │            │
│   │ @Controller     │  │ try/catch with  │  │ @RequireAuth()  │            │
│   │ /api/v1 prefix  │  │ AppError class  │  │ middleware      │            │
│   │ 47 locations    │  │ 23 locations    │  │ 12 locations    │            │
│   └─────────────────┘  └─────────────────┘  └─────────────────┘            │
│                                                                              │
│   You approve what matters: $ drift approve api-controller-pattern          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         3. AI GETS CONTEXT                                   │
│                                                                              │
│   When AI asks "Add a user preferences endpoint":                           │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  drift_context({ intent: "add_feature", focus: "user preferences" })│   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Returns:                                                            │   │
│   │  • Your API pattern: @Controller, /api/v1, response format          │   │
│   │  • Similar endpoints: getUserProfile, updateUserSettings            │   │
│   │  • Required middleware: @RequireAuth(), @ValidateBody()             │   │
│   │  • Error handling: Use AppError, wrap in try/catch                  │   │
│   │  • Files to modify: src/api/users.controller.ts                     │   │
│   │  • Security note: User data requires audit logging                  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        4. AI WRITES FITTING CODE                             │
│                                                                              │
│   // AI generates code that matches YOUR patterns:                          │
│                                                                              │
│   @Controller('/api/v1/users')           // ✓ Your prefix                   │
│   @RequireAuth()                          // ✓ Your auth pattern            │
│   export class UserPreferencesController {                                  │
│     @Post('/preferences')                                                   │
│     @ValidateBody(PreferencesSchema)      // ✓ Your validation              │
│     async updatePreferences(req, res) {                                     │
│       try {                                                                 │
│         // ... implementation                                               │
│       } catch (error) {                                                     │
│         throw new AppError(error);        // ✓ Your error pattern          │
│       }                                                                     │
│     }                                                                       │
│   }                                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

```bash
# Install globally
npm install -g driftdetect

# In your project
cd your-project
drift init
drift scan

# See what Drift learned
drift status
```

**That's it.** Drift now understands your codebase.

---

## Connect to Your AI

Add to your MCP config:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
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

**Cursor** (`.cursor/mcp.json`):
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

**Windsurf, Kiro, VS Code** — same format in their respective config files.

### Docker Deployment

Run Drift as a containerized HTTP service:

```bash
# Clone and start
git clone https://github.com/dadbodgeoff/drift.git
cd drift

# Start with your project mounted
PROJECT_PATH=/path/to/your/project docker compose up -d

# Check health
curl http://localhost:3000/health
```

Configure your MCP client to connect via HTTP/SSE:
- SSE endpoint: `http://localhost:3000/sse`
- Message endpoint: `http://localhost:3000/message`

See [docker-compose.yml](./docker-compose.yml) for configuration options.

---

## What Questions Can Drift Answer?

| Question | Drift Tool | What You Get |
|----------|------------|--------------|
| "How do I add a new endpoint?" | `drift_context` | Patterns, examples, files to modify |
| "What data can this function access?" | `drift_reachability` | Full data flow path |
| "What breaks if I change this?" | `drift_impact_analysis` | Blast radius, affected callers |
| "Which tests should I run?" | `drift_test_topology` | Minimum test set |
| "Who can access user passwords?" | `drift_reachability --inverse` | All code paths to sensitive data |
| "Are there dependency cycles?" | `drift_coupling` | Cycles, hotspots, metrics |
| "What errors aren't handled?" | `drift_error_handling` | Gaps, swallowed exceptions |

---

## Supported Languages

| Language | Parsing | Call Graph | Data Access | Frameworks |
|----------|---------|------------|-------------|------------|
| **TypeScript/JS** | ✅ Tree-sitter | ✅ | ✅ | React, Next.js, Express, Prisma, TypeORM |
| **Python** | ✅ Tree-sitter | ✅ | ✅ | Django, FastAPI, Flask, SQLAlchemy |
| **Java** | ✅ Tree-sitter | ✅ | ✅ | Spring Boot, JPA/Hibernate |
| **C#** | ✅ Tree-sitter | ✅ | ✅ | ASP.NET Core, EF Core, WPF |
| **PHP** | ✅ Tree-sitter | ✅ | ✅ | Laravel, Eloquent |
| **Go** | ✅ Tree-sitter | ✅ | ✅ | Gin, Echo, GORM |
| **Rust** | ✅ Tree-sitter | ✅ | ✅ | Actix, Axum, Diesel |
| **C++** | ✅ Tree-sitter | ✅ | ✅ | Qt, Boost, custom frameworks |

---

## The MCP Architecture

Drift's MCP server uses a **7-layer architecture** designed for efficient AI interaction:

```
┌────────────────────────────────────────────────────────────────┐
│  ORCHESTRATION    drift_context                                │
│  "Tell me what you want, I'll give you everything"             │
│  Token budget: 1000-2000                                       │
├────────────────────────────────────────────────────────────────┤
│  DISCOVERY        drift_status, drift_capabilities             │
│  "Quick health check"                                          │
│  Token budget: 200-500                                         │
├────────────────────────────────────────────────────────────────┤
│  SURGICAL         drift_signature, drift_callers, drift_type   │
│  "I need exactly this one thing"                               │
│  Token budget: 200-500 (12 tools)                              │
├────────────────────────────────────────────────────────────────┤
│  EXPLORATION      drift_patterns_list, drift_security_summary  │
│  "Let me browse and filter"                                    │
│  Token budget: 500-1000                                        │
├────────────────────────────────────────────────────────────────┤
│  DETAIL           drift_pattern_get, drift_impact_analysis     │
│  "Deep dive into this specific thing"                          │
│  Token budget: 500-1500                                        │
├────────────────────────────────────────────────────────────────┤
│  ANALYSIS         drift_coupling, drift_test_topology          │
│  "Run complex analysis"                                        │
│  Token budget: 1000-2000                                       │
├────────────────────────────────────────────────────────────────┤
│  GENERATION       drift_validate_change, drift_suggest_changes │
│  "Help me write code"                                          │
│  Token budget: 500-1500                                        │
└────────────────────────────────────────────────────────────────┘
```

**Why this matters:** Most MCP servers dump 50 flat tools. AI wastes tokens figuring out which to call. Drift's orchestration layer understands intent and returns curated context in one call.

---

## Key Features

### 🧠 Pattern Learning
```bash
drift scan                    # Discover patterns
drift status                  # See what was found
drift approve <pattern-id>    # Approve conventions
```

### 📊 Call Graph Analysis
```bash
drift callgraph reach src/api/users.ts:42    # What data can line 42 access?
drift callgraph inverse users.password_hash  # Who can access passwords?
```

### 🔒 Security Boundaries
```bash
drift boundaries              # See sensitive data access
drift security-summary        # Security posture overview
```

### 🧪 Test Topology
```bash
drift test-topology build                     # Build test mappings
drift test-topology affected src/auth/login.ts  # Minimum tests to run
```

### 🔗 Module Coupling
```bash
drift coupling build          # Build dependency graph
drift coupling cycles         # Find dependency cycles
drift coupling hotspots       # High-coupling modules
```

### ⚠️ Error Handling
```bash
drift error-handling build    # Analyze error handling
drift error-handling gaps     # Find unhandled errors
```

---

## CI Integration

```bash
# Fail on violations
drift check --ci --fail-on warning

# GitHub Actions format
drift check --format github

# GitLab CI format
drift check --format gitlab
```

---

## Documentation

- **[Wiki](https://github.com/dadbodgeoff/drift/wiki)** — Complete documentation
- **[MCP Tools Reference](https://github.com/dadbodgeoff/drift/wiki/MCP-Tools-Reference)** — All 45+ tools documented
- **[MCP Architecture](https://github.com/dadbodgeoff/drift/wiki/MCP-Architecture)** — The gold standard design
- **[Getting Started](https://github.com/dadbodgeoff/drift/wiki/Getting-Started)** — Detailed setup guide
- **[FAQ](https://github.com/dadbodgeoff/drift/wiki/FAQ)** — 50+ questions answered

---

## License

**Open Core** model:
- **Core packages**: Apache 2.0 (fully open source)
- **Enterprise features**: BSL 1.1 (converts to Apache 2.0 after 4 years)

Individual developers and small teams use Drift completely free.

See [licenses/LICENSING.md](./licenses/LICENSING.md) for details.

---

<p align="center">
  <b>Stop fixing AI output. Start shipping.</b>
</p>
