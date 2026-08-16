# Failure reference

Drift runs entirely on your machine, so there is no server-side log to consult when something
goes wrong. The error message is the support channel, and every failure has to carry three
things: a **code** a script can branch on, a **cause** a person can read, and a **next action**.

Every failure appears in `--json` output as:

```json
{
  "error":   { "message": "...", "type": "refusal", "code": "stale_scan" },
  "failure": {
    "code": "stale_scan",
    "safe_to_retry": true,
    "user_action": "Refresh the scan or rerun without --require-fresh ...",
    "recovery_commands": ["drift scan status --json"],
    "diagnostics": ["..."]
  }
}
```

## Codes

| Code | Cause | Retry helps | What to do |
|---|---|---|---|
| `stale_scan` | The stored scan is older than the working tree, so enforcing against it would judge code that is no longer there. | yes | `drift scan --repo-root .` then retry. |
| `missing_contract` | No accepted contract exists for this repo, so there is nothing to enforce. | yes | `drift conventions list --status candidate --json`, accept one, or import a contract. |
| `missing_engine` | The Rust engine binary could not be found or is not trusted. Drift refuses rather than silently using the weaker TypeScript fallback. | yes | `drift doctor --json`; set `DRIFT_ENGINE_BIN`. |
| `unsupported_database` | The local database was written by a **newer** Drift and contains migrations this build does not know. | no | Upgrade Drift, or point `--db` elsewhere. |
| `missing_database` | No database path was given. | yes | Pass `--db <path>` or set `DRIFT_DB`. |
| `insufficient_disk` | Not enough space for local state, detected **before** scanning. | yes | Free space; `drift doctor` reports the estimate. |
| `disk_full` | Space ran out **during** an operation. State may be incomplete. | yes | Free space and rerun. Was previously a raw SQLite string. |
| `corrupt_database` | The local database is unreadable. | **no** | Restore a backup (`drift backup list`), or delete the repo's state directory to rebuild from a scan. |
| `permission_denied` | A required path cannot be read or written. | no | Check ownership of the repo and of the state directory. |
| `empty_contract` | The repo has a contract but it accepts no conventions and carries no other enforceable rules, so a check would evaluate the diff against an empty ruleset. Refuses rather than reporting a pass. | yes | Accept a convention, or declare your data layer with `--data-modules` at onboarding. |
| `engine_payload_too_large` | The repo produced more scan data than onboarding can re-serialize to infer conventions. Measured before anything is written, and **no database is left behind**. | **no** | Onboard a smaller subtree with `--repo-root`. The limit is a current-release constraint, not a property of the repo. |
| `insufficient_memory` | Not enough memory to hold the scan for this repo. | yes | Close other processes, or onboard a smaller subtree with `--repo-root`. |
| `disk_io_error` | The filesystem rejected a read or write. | yes | Check the device and the permissions on the state directory. |
| `shallow_clone` | The checkout has no history to compare against, so repo identity and diffs cannot be established. | yes | `git fetch --unshallow`. |
| `empty_diff_scope` | The diff range resolved to zero examinable files, so there is no verdict to give. Distinct from a clean pass, which is a verdict. | yes | Widen `--scope`, or check the `--diff` range. |
| `stale_diff_scope` | The diff named files the working tree does not have, and every one was missing — the diff and the checkout disagree about what exists. | yes | Rebase, or re-resolve the diff range against this checkout. |
| `unindexed_contract_target` | A contract rule's `path_globs` name files the scan does not index, so a finding about them would carry no content hash. | no | Narrow the globs to files Drift indexes. |
| `engine_vocabulary_mismatch` | The engine advertises fact kinds this CLI does not understand, so pairing them would fail partway through the scan. Detected at the handshake, before anything is ingested. | no | Match the engine and CLI versions; `drift doctor --json`. |
| `cli_error` | Anything not matched above — usually bad arguments. | no | Read the diagnostic; `drift --help`. |

## Refusals are not errors

Several of these are **refusals**: Drift declines to answer rather than answering wrongly. They
mean "no enforcement claim is being made", and Drift exits **3** for them — distinct from **1**
(Drift itself failed) and **2** (the diff violates the contract). See
[enforcement.md](./enforcement.md).

The refusals are `stale_scan`, `missing_contract`, `missing_engine`, `insufficient_disk`,
`insufficient_memory`, `shallow_clone`, `empty_diff_scope`, `stale_diff_scope`, `empty_contract`,
`engine_payload_too_large`, `unindexed_contract_target` and `engine_vocabulary_mismatch`.
Everything else exits 1.

This page is not the source of truth, deliberately: it used to be, and it drifted. The exit code
and `error.type` for every code live in `FAILURE_CONTRACT` in
`packages/cli/src/app/drift-error.ts`, and `scripts/error-contract.mjs` fails CI when this document
and that table disagree, in either direction. Before that gate existed, three codes documented here
as exit-3 refusals exited 1, and the repo's own tests had frozen the wrong behaviour.

A refusal is never a pass. That distinction is the point: a guardrail that returns success when it
could not inspect anything is worse than one that stops.

## `safe_to_retry`

Set honestly rather than optimistically. `corrupt_database` and `permission_denied` are `false`
because rerunning the same command cannot fix either, and inviting a retry loop wastes the
operator's time. `disk_full` is `true` — the operation can succeed once space exists.

## Adding a code

1. Extend `DriftFailureCode` in `packages/cli/src/app/drift-error.ts`.
2. Throw a `DriftError` carrying it, rather than relying on message text. The classifier reads
   `error.code` first and only falls back to matching prose, which is how rewording an error
   message used to change exit-code behaviour.
3. Add a row above, and a case to `packages/cli/test/failure-codes.test.ts` — which asserts that
   no failure is ever reported without an action and a recovery command.
