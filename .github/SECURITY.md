# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please send an email to: **security@geoffreyfernald.com**

Include the following information:
- Type of vulnerability
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your report within 48 hours
- **Communication**: We will keep you informed of our progress
- **Resolution**: We aim to resolve critical issues within 7 days
- **Credit**: We will credit you in the release notes (unless you prefer to remain anonymous)

## Security Considerations

### What Drift Does

Drift is a **local-only** static analysis tool. It:

- ✅ Reads files from your local filesystem
- ✅ Analyzes code patterns using AST parsing
- ✅ Stores patterns locally in `.drift/` folder
- ✅ Runs a local dashboard server (localhost only)

### What Drift Does NOT Do

- ❌ Send any code or data to external servers
- ❌ Execute arbitrary code from your codebase
- ❌ Modify your source files (read-only analysis)
- ❌ Collect telemetry or usage data
- ❌ Require network access to function

### MCP Server Security

The MCP server (`driftdetect-mcp`) is designed for local AI agent integration:

- Runs locally, communicates via stdio
- Only exposes read-only pattern data
- Does not execute code or modify files
- Scoped to the project directory it's initialized in

### Dependencies

We regularly audit our dependencies for known vulnerabilities using:
- `npm audit`
- Dependabot alerts
- Snyk (periodic scans)

## Best Practices for Users

1. **Review before approving**: Always review patterns before approving them
2. **Use .driftignore**: Exclude sensitive files from scanning
3. **Keep updated**: Use the latest version for security fixes
4. **Audit the code**: This is open source — feel free to audit it yourself

## Scope

This security policy applies to:
- `driftdetect` (CLI)
- `driftdetect-core`
- `driftdetect-detectors`
- `driftdetect-dashboard`
- `driftdetect-mcp`
- `driftdetect-lsp`
- `driftdetect-vscode`

Thank you for helping keep Drift and its users safe!
