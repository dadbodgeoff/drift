# Security Policy

Drift is designed as a local-first repo intelligence tool. V1 scans local source, stores Drift state in local SQLite, and does not require cloud sync.

## Reporting

Report security issues privately through GitHub Security Advisories when available. If that is not available, open a minimal issue asking for a private contact path.

Do not include private source code, secrets, tokens, customer data, `.env` contents, certificates, private keys, or proprietary repo dumps in public issues.

## Current Boundaries

- Drift backs up Drift state, not source code.
- Agent-facing CLI and MCP surfaces should emit metadata, graph facts, evidence locations, policy decisions, and redaction metadata, not source snippets.
- MCP tools are read-only in V1.
- Governance mutations require explicit human confirmation in CLI.
- The Rust engine owns deterministic parser, graph, candidate, and check authority.

## Supported Versions

Pre-1.0 releases receive best-effort security fixes on `main`. Public beta users should stay on the latest published version.
