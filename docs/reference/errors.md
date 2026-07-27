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
| `cli_error` | Anything not matched above — usually bad arguments. | no | Read the diagnostic; `drift --help`. |

## Refusals are not errors

Three of these are **refusals**: Drift declines to answer rather than answering wrongly.
`stale_scan`, `missing_contract`, `missing_engine` and `insufficient_disk` all mean "no
enforcement claim is being made", and `drift check` exits **3** for them — distinct from **1**
(Drift itself failed) and **2** (the diff violates the contract). See
[enforcement.md](./enforcement.md).

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
