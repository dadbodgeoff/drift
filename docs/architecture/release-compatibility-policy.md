# Release And Compatibility Policy

Date: 2026-05-21

## Purpose

Drift needs stable contracts before it is widely adopted. Users and agents will script CLI JSON, store local SQLite state, rely on graph artifacts, and expect upgrades not to corrupt governance history.

This policy defines what must remain stable and how breaking changes are handled.

## Compatibility Surfaces

| Surface | Compatibility expectation |
| --- | --- |
| CLI command names | Stable after public beta |
| CLI JSON output | Versioned and additive where possible |
| MCP tool names/input/output | Stable after public beta |
| SQLite migrations | Forward-only, tested |
| Repo contract schema | Versioned import/export compatibility |
| FactGraph schema | Versioned; old graph artifacts detectable |
| Engine check result schema | Versioned |
| Adapter manifests | Versioned |
| Policy decision schema | Versioned; egress behavior changes are compatibility changes |
| Adapter sandbox profile | Versioned; permission broadening is breaking unless explicitly opted in |
| Finding fingerprints | Stable unless rule/id version changes |
| Audit log | Append-only; never rewritten |
| Backup artifacts | Verifiable across supported schema versions |

## Version Fields

Every machine contract should include version metadata:

- `cli_version`
- `core_version`
- `storage_schema_version`
- `contract_schema_version`
- `factgraph_schema_version`
- `engine_version`
- `rule_engine_version`
- `adapter_versions`
- `mcp_protocol_version` when needed
- `adapter_protocol_version`
- `policy_schema_version`
- `sandbox_profile_version`

## JSON Change Policy

Allowed without major bump:

- add optional fields
- add new enum values only when consumers are expected to ignore unknown values
- add diagnostics
- add summary counts

Requires contract/schema bump:

- remove fields
- rename fields
- change field type
- change meaning of status/severity/enforcement enums
- change finding fingerprint algorithm
- change graph ID format
- change default policy behavior

## SQLite Migration Policy

Rules:

- migrations are forward-only
- every migration has an id
- migration ids are ordered
- unknown future migrations cause safe refusal
- non-prefix histories cause safe refusal
- migration tests cover old database shapes
- migrations should be idempotent when practical for recoverable local states

Never silently downgrade a database.

## Repo Contract Compatibility

Contract import must validate:

- schema version supported
- repo id matches or explicit override is valid
- repo fingerprint matches when required
- convention ids unique
- waiver selectors unique
- required checks unique
- denied globs valid
- checksum when required

Confirmed imports require explicit `--confirm`; dry-runs should explain compatibility failures.

## FactGraph Compatibility

Graph artifacts are immutable records of an engine run.

If graph schema changes:

- keep old artifact readable enough for diagnostics
- mark projection stale if projection schema changed
- require rescan or projection rebuild before fresh preflight/checks
- expose schema mismatch in `doctor` and `scan status`

## Deprecation Policy

Before public beta:

- breaking changes allowed but must be documented in release notes
- tests must be updated intentionally

After public beta:

- keep old command aliases for at least one minor release when practical
- emit deprecation warnings in human output
- keep JSON fields for one minor release when possible
- document migration path

## Release Gate

No release candidate without:

```bash
pnpm verify:ci
```

And explicit confirmation that:

- package packing tests pass
- installed-flow smoke passes
- CLI binary smoke passes
- MCP binary smoke passes
- migration tests pass
- backup/restore tests pass
- audit verification tests pass
- git diff check passes

## Runtime Support Matrix

Before public beta, publish and test a concrete support matrix:

| Runtime | Policy |
| --- | --- |
| Node.js | choose one active LTS minimum and test it in CI |
| pnpm | pin via package manager metadata or document supported range |
| Rust | document minimum supported Rust version for engine crates |
| macOS | test current development target |
| Linux | test at least one CI target before claiming support |
| Windows | unsupported until explicitly tested, or mark experimental |

Do not leave package metadata claiming a runtime that CI does not exercise.

## Public API Definition

For SemVer, Drift's public API is:

- CLI command names and documented flags
- CLI JSON output fields documented as stable
- MCP tool names, input schemas, and output schemas
- repo contract import/export schema
- adapter manifest and adapter SDK protocol
- FactGraph artifact schema
- engine scan/check result schemas
- backup manifest schema
- policy decision schema
- finding fingerprint semantics

Internal TypeScript module paths are not public API unless explicitly documented.

## OSS Publishing Checklist

Before first serious public release:

- root README current
- package READMEs useful
- architecture docs linked
- license chosen
- package metadata includes license, repository, bugs, homepage, keywords, bin, files, and engines
- security policy added
- contributing guide added
- changelog added
- release notes template added
- issue templates added
- minimal examples included
- dogfood transcript completed

## Acceptance Criteria

- Every durable machine surface has a version field or a documented version owner.
- JSON changes follow additive-first policy.
- SQLite migration compatibility is tested.
- Contract import/export compatibility is explicit.
- Runtime support matrix is tested or honestly marked experimental.
- OSS package metadata is release-ready before public publishing.
- Future graph/engine schema changes have a safe stale/rebuild path.
