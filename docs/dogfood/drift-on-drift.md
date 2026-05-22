# Dogfood Transcript: Drift On Drift

Date: 2026-05-22
Repo: `/Users/geoffreyfernald/Downloads/driftv3`
Commit: `32d1373baff3a3bf0d41a66565da39d90b6e562b`
Branch: `codex/drift-v1-core`
Drift version: `0.1.0`
State root: `output/dogfood/drift-state`
Artifacts: `output/dogfood/artifacts`

## Purpose

This run checks whether Drift is useful on its own repo without teaching itself from fixture code. The important result is not that every product surface succeeds. The important result is whether the behavior is honest, local-only, and actionable when the repo has no accepted conventions.

## Commands Run

```bash
DRIFT_ENGINE_BIN=target/debug/drift-engine node packages/cli/dist/main.js doctor --repo-root . --state-root output/dogfood/drift-state --json
DRIFT_ENGINE_BIN=target/debug/drift-engine node packages/cli/dist/main.js start --repo-root . --state-root output/dogfood/drift-state --accept-defaults --json
DRIFT_ENGINE_BIN=target/debug/drift-engine node packages/cli/dist/main.js scan status --repo-root . --state-root output/dogfood/drift-state --json
DRIFT_ENGINE_BIN=target/debug/drift-engine node packages/cli/dist/main.js --db <db> repo map --repo <repo> --limit 10 --json
DRIFT_ENGINE_BIN=target/debug/drift-engine node packages/cli/dist/main.js --db <db> audit verify --repo <repo> --json
DRIFT_ENGINE_BIN=target/debug/drift-engine node packages/cli/dist/main.js --db <db> backup create --repo <repo> --confirm --json
DRIFT_ENGINE_BIN=target/debug/drift-engine node packages/cli/dist/main.js --db <db> prepare "Add engine-owned direct data-access checks" --repo <repo> --json
DRIFT_ENGINE_BIN=target/debug/drift-engine node packages/cli/dist/main.js --db <db> ask "what should I know before changing the checker or engine?" --repo <repo> --json
```

## Doctor

Status: `warn`

Reason: local state did not exist yet.

Database path:

```text
output/dogfood/drift-state/repo_90c827dbe9584f56/drift.sqlite
```

The next command was clear and preserved the selected state root:

```bash
drift start --repo-root /Users/geoffreyfernald/Downloads/driftv3 --state-root /Users/geoffreyfernald/Downloads/driftv3/output/dogfood/drift-state --accept-defaults
```

## Start / Onboarding

Repo: `repo_90c827dbe9584f56`
Scan: `scan_ac291618e800b610`
Files indexed: `122`
Facts emitted: `14518`
Diagnostics emitted: `651`
Candidates emitted: `0`
Engine source: `rust`

Onboarding result:

```json
{
  "status": "needs_more_signal",
  "accepted_default": false,
  "baselined_count": 0,
  "candidate_count": 0
}
```

This is the right behavior. Drift has API-route fixtures under `test/fixtures`, but those should not teach conventions for the Drift repo itself. The Rust-owned candidate inference path now excludes fixture routes from accepted onboarding signal.

## Scan Status

Latest scan: `scan_ac291618e800b610`
Indexed files: `122`
Facts: `14518`
Stale: `false`
Audit valid: `true`

Scan status works without a contract and reports governance correctly as read-only.

## Repo Map

Repo map now works before a contract exists, using a default local-only egress policy.

Summary:

```json
{
  "indexed_file_count": 122,
  "filtered_file_count": 122,
  "listed_file_count": 10,
  "role_counts": {},
  "import_count": 40,
  "export_count": 47,
  "call_count": 143
}
```

First mapped files included CLI modules such as:

```text
packages/cli/scripts/check-boundaries.mjs
packages/cli/src/app/command-types.ts
packages/cli/src/app/output.ts
packages/cli/src/app/router.ts
packages/cli/src/app/run-cli.ts
```

No source snippets were emitted. Default denied globs were active:

```text
.env*
**/*.pem
**/*.key
**/*.crt
```

Current limitation: role counts are empty for this repo because the V1 role detector is focused on TypeScript API/server layering, and Drift itself is mostly CLI/package code.

## Audit

Audit verification works before a contract exists.

```json
{
  "valid": true,
  "event_count": 2,
  "verified_count": 2,
  "broken_at_event_id": null,
  "reason_count": 0
}
```

This matters because audit is Drift state integrity, not convention context export. It should not be blocked by missing conventions.

## Backup

Backup creation works before a contract exists, with explicit `--confirm`.

Backup: `backup_5186dea643a4fad6`
Schema version: `7`
Size: `60768256` bytes
Checksum prefix: `fa877a35926b`

This is the correct product behavior. Backup is governance-state protection and should be available immediately after first scan.

## Prepare / Ask

Both commands refused to run:

```text
No repo contract exists for repo_90c827dbe9584f56.
```

This is acceptable for V1 because `prepare` and `ask` are contract-backed briefing surfaces. They should not invent conventions when no human-approved contract exists.

Future improvement: add a separate no-contract mode that says "scan exists, no approved conventions yet" and returns repo-map style metadata without pretending it is a convention briefing.

## Product Notes

What worked:

- First scan is local-only and deterministic.
- Fixture routes no longer pollute onboarding.
- Engine-owned inference is the authority for candidates on Rust-backed scans.
- Read-only scan status, repo map, and audit now work before a contract exists.
- Backup works immediately after first scan with explicit confirmation.
- Output contains metadata and graph facts, not source snippets.

What was confusing:

- `start --accept-defaults` still suggests `drift check` even when no contract was accepted. That command will not be useful until a convention exists.
- `prepare` and `ask` fail correctly, but they should return a more helpful no-contract explanation and next command list.
- Repo map has useful file-level facts, but not enough higher-level package/module narrative yet.

What should change before beta:

- Add a no-contract prepare/ask response that points users to scan status, repo map, and convention review.
- Add richer non-API repo roles for CLI/package code.
- Add dogfood fixture coverage where Drift analyzes a small internal API-style package so the full candidate, accept, baseline, prepare, check loop runs against non-fixture code.
- Keep fixture exclusion as a hard rule for candidate inference.
