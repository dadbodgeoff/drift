# Frequently Asked Questions

## General

### What is Drift?

Drift is a **codebase intelligence platform** that learns patterns from your code and provides that knowledge to AI agents. It scans your codebase, detects patterns, builds a call graph, and exposes this information via CLI and MCP tools.

### How is Drift different from linters?

| Linters | Drift |
|---------|-------|
| Hardcoded rules | Learns from YOUR code |
| Style enforcement | Pattern detection |
| Single-file analysis | Full call graph |
| No AI integration | 40+ MCP tools |

Drift doesn't replace linters — it complements them by understanding your codebase at a deeper level.

### What languages does Drift support?

8 languages with full feature parity:
- TypeScript/JavaScript
- Python
- Java
- C#
- PHP
- Go
- Rust
- C++

### Is Drift free?

Drift is open source under BSL-1.1 license. Free for most uses, with some restrictions for competing products.

---

## Installation & Setup

### How do I install Drift?

```bash
npm install -g driftdetect
```

Or use without installing:

```bash
npx driftdetect init
```

### How do I connect Drift to Claude/Cursor?

Add to your MCP config:

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

See [MCP Setup](MCP-Setup) for detailed instructions.

### Where is Drift data stored?

All data is stored in `.drift/` at your project root. This includes:
- Patterns (discovered, approved, ignored)
- Call graph data
- Security boundaries
- Configuration

### Should I commit `.drift/` to git?

**Short answer:** Use this simple `.gitignore` pattern:

```gitignore
# Drift: ignore caches and temporary data
.drift/lake/
.drift/cache/
.drift/history/
.drift/call-graph/
.drift/patterns/discovered/
.drift/patterns/ignored/
.drift/patterns/variants/
.drift/constraints/discovered/
.drift/constraints/ignored/
.drift/contracts/discovered/
.drift/contracts/ignored/
.drift/contracts/mismatch/

# Always ignore backup files (created during updates)
.drift/**/.backups/
```

**What gets committed (good for teams):**
- `.drift/config.json` - Project configuration
- `.drift/patterns/approved/` - Your approved conventions
- `.drift/boundaries/` - Security boundary rules
- `.drift/indexes/` - Small lookup indexes
- `.drift/views/` - Status cache
- `.drift/constraints/approved/` - Architectural constraints
- `.drift/contracts/verified/` - Verified API contracts

**What gets ignored (rebuild on scan):**
- All `/lake/`, `/cache/`, `/history/`, `/call-graph/` directories
- All `/discovered/`, `/ignored/`, `/variants/`, `/mismatch/` directories
- All `/.backups/` directories (internal backup files)

This approach explicitly lists what to ignore rather than using complex negation patterns.

---

## Scanning

### How long does a scan take?

| Codebase Size | First Scan | Incremental |
|---------------|------------|-------------|
| <10K LOC | <5s | <1s |
| 10-100K LOC | 10-60s | 1-5s |
| 100K-1M LOC | 1-10min | 5-30s |
| >1M LOC | 10-30min | 30s-2min |

### How do I speed up scans?

1. **Use incremental scans** (default):
   ```bash
   drift scan --incremental
   ```

2. **Exclude unnecessary files** in `.driftignore`:
   ```
   node_modules/
   dist/
   build/
   *.generated.ts
   ```

3. **Scan specific directories**:
   ```bash
   drift scan src/
   ```

### What files should I exclude?

**Good news:** Drift automatically respects your `.gitignore`, so `node_modules/`, `dist/`, etc. are already excluded if they're in your `.gitignore`.

Use `.driftignore` only for additional exclusions specific to Drift:

```gitignore
# .driftignore - Additional exclusions
# (Your .gitignore patterns are already respected automatically)

# Test files (if you don't want test patterns)
*.test.ts
*.spec.ts
__tests__/

# Generated code
*.generated.ts
*.g.cs

# Large data files
*.log
*.sql
fixtures/
```

### Why are some patterns not detected?

Possible reasons:
1. **File excluded** — Check `.driftignore`
2. **Language not supported** — Check `drift parser`
3. **Pattern too rare** — Drift needs multiple occurrences
4. **Dynamic code** — `eval()`, reflection can't be analyzed

---

## Patterns

### What are patterns?

Patterns are recurring code structures Drift detects in your codebase:
- API endpoint patterns
- Error handling patterns
- Authentication patterns
- Data access patterns
- etc.

### How do I approve patterns?

```bash
# See discovered patterns
drift status

# Approve a pattern
drift approve <pattern-id>

# Approve all in a category
drift approve --category api
```

### How do I auto-approve patterns?

Set `learning.autoApproveThreshold` in `.drift/config.json`:

```json
{
  "learning": {
    "autoApproveThreshold": 0.9,
    "minOccurrences": 3
  }
}
```

Patterns with confidence ≥ 0.9 and at least 3 occurrences will be auto-approved. Set to `1.0` to disable.

### What happens when I approve a pattern?

1. Pattern moves from "discovered" to "approved"
2. Drift uses it as a reference for your conventions
3. AI agents see it as YOUR preferred approach
4. Outliers (code that doesn't match) are flagged

### How do I ignore patterns?

```bash
drift ignore <pattern-id> --reason "Legacy code"
```

Ignored patterns won't be suggested to AI agents.

### What are outliers?

Outliers are code that doesn't match approved patterns. They might be:
- Bugs or mistakes
- Legacy code
- Intentional exceptions
- New patterns not yet approved

---

## MCP & AI Integration

### Which AI tools work with Drift?

Any tool supporting MCP:
- Claude Desktop
- Cursor
- Windsurf
- Kiro
- VS Code (with MCP extension)
- Any MCP-compatible client

### How do AI agents use Drift?

1. You ask: "Add a user endpoint"
2. AI calls `drift_context` with your intent
3. Drift returns your patterns, examples, conventions
4. AI generates code matching YOUR style

### What MCP tools should I use?

Start with `drift_context` — it returns curated context for any task:

```json
{
  "intent": "add_feature",
  "focus": "user authentication"
}
```

See [MCP Tools Reference](MCP-Tools-Reference) for all 45+ tools.

### Why isn't the AI using Drift?

1. **MCP not configured** — Check your MCP config
2. **Project not scanned** — Run `drift scan`
3. **AI not calling tools** — Ask explicitly: "Use Drift to..."

---

## Analysis Features

### How do I use the call graph?

```bash
# What data can this code access?
drift callgraph reach src/api/users.ts:42

# Who can access this data?
drift callgraph inverse users.password_hash
```

See [Call Graph Analysis](Call-Graph-Analysis).

### How do I find security issues?

```bash
# Security overview
drift boundaries overview

# Find sensitive data access
drift boundaries sensitive

# Check for violations
drift boundaries check
```

See [Security Analysis](Security-Analysis).

### How do I find which tests to run?

```bash
# Build test topology
drift test-topology build

# Find affected tests
drift test-topology affected src/auth/login.ts
```

See [Test Topology](Test-Topology).

### How do I find dependency cycles?

```bash
# Build coupling analysis
drift coupling build

# Find cycles
drift coupling cycles
```

See [Coupling Analysis](Coupling-Analysis).

---

## CI/CD Integration

### How do I add Drift to CI?

```yaml
# GitHub Actions
- name: Install Drift
  run: npm install -g driftdetect
  
- name: Scan
  run: drift scan
  
- name: Check
  run: drift check --ci
```

See [CI Integration](CI-Integration).

### How do I enforce patterns in PRs?

```bash
drift gate --policy strict --format github
```

This outputs GitHub annotations for violations.

### How do I run only affected tests?

```bash
TESTS=$(drift test-topology affected --staged --format list)
npm test -- $TESTS
```

---

## Troubleshooting

### "No patterns found"

1. Check you're scanning source files:
   ```bash
   drift scan src/
   ```

2. Check language is supported:
   ```bash
   drift parser
   ```

3. Check files aren't excluded:
   ```bash
   cat .driftignore
   ```

### "Scan is slow"

1. Check `.driftignore` excludes `node_modules/`, `dist/`
2. Use incremental scans: `drift scan --incremental`
3. Scan specific directories: `drift scan src/`

### "MCP not connecting"

1. Restart your AI client after config changes
2. Check config file path is correct
3. Test manually: `npx driftdetect-mcp --help`

### "Analysis tools return empty"

Some tools require pre-built data:

```bash
drift test-topology build
drift coupling build
drift error-handling build
```

### "Parser errors"

1. Check parser status: `drift parser --test`
2. Check for syntax errors in your code
3. Try regex fallback: `drift scan --fallback`

---

## Data & Privacy

### Does Drift send my code anywhere?

**No.** All analysis happens locally. Your code never leaves your machine.

### What telemetry does Drift collect?

Anonymous usage data (opt-out available):
- Commands run
- Languages scanned
- Error rates
- Performance metrics

**Never collected:**
- Source code
- File contents
- Pattern details
- Personal information

Disable with: `drift telemetry disable`

### Is my data secure?

- All data stored locally in `.drift/`
- No cloud services required
- No external API calls for analysis
- You control what's committed to git

---

## Contributing

### How can I help Drift learn?

1. **Approve patterns** that represent your conventions
2. **Report false positives** when Drift gets it wrong
3. **Suggest patterns** Drift should detect
4. **Contribute code** to the open source project

See [Contributing](Contributing).

### How do I report bugs?

[GitHub Issues](https://github.com/dadbodgeoff/drift/issues)

### How do I ask questions?

[GitHub Discussions](https://github.com/dadbodgeoff/drift/discussions)
