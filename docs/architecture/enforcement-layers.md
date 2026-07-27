# Where enforcement happens

Drift splits enforcement between the Rust engine and the TypeScript CLI, and the split is not
obvious from either side. This exists because an audit read one half of it and concluded the
other half was missing.

## The split

| Concern | Enforced by | Why there |
|---|---|---|
| Which files are in scope for a convention | CLI | Needs the diff, and the engine's route detection as the authority on what is a route |
| Whether an import is forbidden | Engine | Operates on facts it extracted; one parser, one answer |
| Exceptions (`convention.exceptions`) | **CLI** | Time-bounded and path/symbol-scoped; the engine has no clock |
| Contract waivers (`contract.waivers`) | **CLI** | Same, plus content-hash reapproval against the working tree |
| Governance (`convention.governance`) | **CLI** | Human-approval policy, not a property of the code |
| Diff status and blocking | CLI | Only the CLI sees the diff and the baseline |

The engine deliberately binds waivers, exceptions, scope and governance to `_` in
`check_command.rs`. That is **not** a fail-open: the CLI has already filtered the file set and
applies exceptions and waivers to every finding the engine returns, before persistence.

## Why this is written down

The four-subsystem audit flagged those discarded fields as an overclaim — "accepting and ignoring
governance input" — and proposed rejecting any contract containing them. Checking first showed
the premise was false, and implementing that rejection would have broken every working contract
that uses an exception or a waiver.

The real risk was different and quieter: the layering was undocumented and unpinned. Nothing
prevented someone deleting the CLI-side checks on the reasonable-looking grounds that the engine
should own enforcement, at which point contracts would silently stop being honoured — exceptions
would stop excluding, waivers would stop waiving, and every check would still report success.

`packages/cli/test/contract-field-enforcement.test.ts` is the guard. One test per field the
engine drops, including the cases that matter most:

- an exception stops applying once it expires, rather than becoming a permanent hole
- an import-level exception is scoped to the named symbol and source, not the whole file
- a waiver stops applying once it expires
- a waiver requiring reapproval stops applying when the file's content hash changes, and is not
  kept alive by a different file in the same waiver

## Rule

If the engine ignores a contract field, the CLI must enforce it **and** a test must prove it.
A field enforced by neither is an overclaim and should be rejected at import — that is T28, which
maps every schema field to its enforcement site.
