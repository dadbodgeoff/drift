# Security Threat Model

Date: 2026-05-21

## Purpose

Drift scans arbitrary local repositories. Treat every repo as hostile input.

The scanner, adapters, CLI, MCP server, backup/restore flow, and future graph/OCR surfaces must be designed so a malicious repo cannot execute code, escape its root, leak secrets, corrupt Drift state, or crash the product into unsafe partial output.

## Trust Boundaries

```text
User repo files
  -> scan/adapter input boundary
  -> Rust engine / TS fallback parser
  -> SQLite local state
  -> CLI/MCP/export output
  -> human or agent consumer
```

Primary trust boundaries:

- repo file contents entering parser/adapters
- repo paths entering filesystem operations
- adapter output entering SQLite
- SQLite backup/restore entering local state
- CLI/MCP JSON leaving Drift
- future third-party adapters entering the engine

## Core Rule

Scanning must not execute repo code.

Allowed:

- read files
- parse syntax
- hash content
- inspect static package metadata
- run built-in Drift engine logic

Not allowed by default:

- running package scripts
- importing repo modules
- executing tests
- loading repo config as executable code
- executing JavaScript/TypeScript config files for import resolution
- running postinstall-like hooks
- invoking third-party tools without explicit adapter policy

## Threats And Controls

| Threat | Risk | Control |
| --- | --- | --- |
| Path traversal | Read/write outside repo or state root | Canonicalize paths; require repo-relative paths for policy/finding inputs; reject `..` escapes |
| Symlink escape | Follow link outside repo | Default `follow_symlinks=false`; record skipped symlink count |
| Hardlink/device/FIFO/socket | Unexpected filesystem behavior or blocking reads | Only scan regular files by default; skip and count special files |
| Malicious package scripts | Code execution during scan | Never run package scripts during scan; `checks run` must be explicit future command |
| Huge files | OOM or slow scan | Max file size; skip with diagnostic |
| Zip/binary blobs | Parser crash or memory pressure | Binary detection; skip with diagnostic/count |
| Secret leakage | CLI/MCP/export returns secrets | Central policy authorization; denied globs; snippet caps; no full file content by default |
| Prompt injection in repo text | Agent follows malicious repo instructions | Mark repo text as untrusted; MCP/CLI preflight must frame snippets as evidence, not instructions |
| Parser crash | Scan failure or partial silent output | Catch adapter failures; emit diagnostics; mark scan failed/truncated explicitly |
| Malicious adapter output | Corrupt graph/storage | Validate all adapter output against schemas before persistence |
| Backup restore mismatch | Wrong repo state restored | Validate repo id/fingerprint/schema/checksum; dry-run by default option |
| MCP overexposure | Agent receives more context than allowed | MCP read-only; all context surfaces call policy authorization |
| SQLite tampering | Governance state changed outside Drift | Audit hash chain verification; doctor/audit verify warnings |

## Repo Path Policy

All user-supplied repo paths must be:

- normalized
- repo-relative where applicable
- non-empty
- not absolute unless explicitly a repo root or database path
- free of `..` traversal after normalization
- checked against denied globs before outward context export

Path matching must use normalized forward-slash paths in stored state.

## Hostile Filesystem Matrix

Default scan behavior:

| File object | Behavior |
| --- | --- |
| regular file | eligible if allowed by ignore, size, binary, and policy rules |
| directory | traverse only inside repo root and allowed paths |
| symlink | skip by default; never follow outside repo |
| hardlink | treat as regular file only after canonical root check |
| socket | skip |
| FIFO | skip |
| block/character device | skip |
| unreadable file | skip with diagnostic |
| path with invalid encoding | skip or losslessly encode; never panic |

This matrix belongs in fixture/scale tests before broader adapter work.

## Adapter Security Tiers

| Tier | Description | Default |
| --- | --- | --- |
| `builtin_trusted` | Built and shipped with Drift | Enabled |
| `local_external_binary` | Installed local parser/tool invoked by Drift | Disabled until explicitly enabled |
| `third_party_adapter` | Community adapter package/binary | Disabled |
| `model_assisted` | Adapter calls a model or remote API | Disabled and policy-gated |
| `experimental` | Built-in but not blocking-safe | Enabled only for briefing/diagnostics |

Only `builtin_trusted` deterministic adapters can feed blocking checks by default.

## Context Egress Rule

Every outward context surface must pass through one policy authorization path.

Outward surfaces include:

- CLI JSON
- CLI human output
- MCP responses
- contract export
- backup metadata output
- preflight packets
- repo map output
- diagnostic artifacts
- future UI views

No surface should bypass policy because it is "local." Local agents can still leak data.

Required service shape:

```ts
type AuthorizeContextInput = {
  repo_id: string;
  actor: "human" | "agent" | "system";
  surface:
    | "cli-human"
    | "cli-json"
    | "mcp"
    | "contract-export"
    | "backup-metadata"
    | "preflight"
    | "repo-map"
    | "diagnostic-artifact"
    | "ui";
  purpose: string;
  paths: string[];
  requested_fields: string[];
  snippet_budget_bytes?: number;
};

type AuthorizeContextDecision = {
  allowed: boolean;
  denied_paths: string[];
  redactions: Array<{
    path: string;
    field: string;
    reason: string;
  }>;
  max_snippet_bytes: number;
  decision_id: string;
  audit_required: boolean;
};
```

All CLI, MCP, export, repo-map, prepare, ask, and future UI paths should consume this decision instead of open-coding path filters.

## Secret And Sensitive Content Handling

Secret-like content is broader than `.env` and key files.

Minimum denied or redacted inputs:

- `.env`, `.env.*`
- private keys, certs, SSH keys, PGP keys
- cloud credential files
- npm, PyPI, GitHub, OpenAI, Anthropic, Azure, AWS, and GCP token patterns
- JWT-like values
- long high-entropy strings
- connection strings and database URLs
- files matched by user policy denied globs

The graph may store that a secret-like artifact was skipped. It should not store the raw secret by default.

## Import Resolution Safety

Import resolution must be static.

Allowed:

- parse `tsconfig.json` as JSON or JSONC
- parse `package.json`
- inspect workspace manifests
- resolve common extension/index/package export patterns

Not allowed by default:

- require/import repo config
- execute bundler config
- run TypeScript compiler plugins from the repo
- invoke package-manager scripts
- install dependencies
- resolve through network or registry calls

Unresolved imports should produce graph diagnostics, not executable fallback behavior.

## Restore Safety

Restore is a governance mutation and must be explicit.

Requirements:

- validate backup checksum before writing state
- validate schema and compatibility before writing state
- validate repo fingerprint or require explicit override
- write restore into a temporary state location first
- atomically swap only after validation succeeds
- emit audit events before and after restore
- mark graph/index stale when source files differ
- never restore source code

Failed restore must leave the previous Drift state usable.

## MCP Prompt-Injection Boundary

MCP responses are read-only, but they still carry untrusted repo text to an agent.

Every MCP response that includes repo-derived text should:

- include policy metadata
- identify text as untrusted evidence
- avoid imperative phrasing that could be mistaken for user instructions
- cap snippets
- include refusal/recovery commands when context is denied

The MCP server should never expose mutation tools in V1.

## Failure Semantics

Drift must prefer explicit degraded output over silent partial intelligence.

If a scan cannot fully complete:

- record scan status as failed or truncated
- persist diagnostics
- expose `truncated=true` where applicable
- avoid blocking on heuristic/incomplete facts
- tell the user what command or setting can recover

## Security Tests

Required tests:

- path traversal rejected for repo-relative inputs
- symlink outside repo skipped
- sockets, FIFOs, device files, unreadable files, and invalid encodings do not crash scan
- `.env`, `.pem`, `.key`, `.crt` denied in policy checks
- token-like strings are redacted or denied across CLI JSON and MCP
- oversized file skipped with diagnostic
- binary file skipped
- malformed TypeScript does not crash scan
- repo text prompt injection is treated as evidence, not instruction text
- adapter output schema validation rejects invalid graph nodes/edges
- MCP context respects policy denied globs
- backup restore refuses repo fingerprint mismatch
- failed restore leaves previous state intact
- audit verification detects tampering

## Non-Goals

- no sandboxed third-party adapter runtime in V1
- no cloud secrets scanning product in V1
- no automatic test/script execution
- no remote model-assisted extraction by default

## Acceptance Criteria

- Security rules are referenced by adapter certification and scale-gate docs.
- Built-in scans never execute repo code.
- All outward context surfaces are policy-gated.
- Large, binary, secret-like, and symlink inputs are handled explicitly.
- Future third-party adapters cannot be enabled silently.
