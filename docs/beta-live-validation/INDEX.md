# Drift beta live-validation program

Every charter in this directory is a self-contained brief for **one agent**. The agent picks it
up, runs it against a live build of Drift, writes one results file, and stops. Charters do not
talk to each other at runtime; they only depend on each other through the ordering below.

Derived from `DRIFT-ARCHITECTURE-FORENSICS-REPORT.md` (commit `5e86e89a`) and re-grounded against
`main` at `3b5349ea`. Section references of the form **§N** point into that report.

## The rule that defines this program

> **Nothing here is a test suite. It is a measurement program.**
> A charter does not stop when something breaks. It records what broke, what caused it, what
> evidence proves the cause, and moves to the next probe. A charter that ends early because
> "the first thing failed" is a failed charter, not a failed product.

## Charters

| # | Charter | Depends on | Wall clock | What it settles |
|---|---|---|---|---|
| 00 | [Preflight](00-PREFLIGHT.md) | — | 30 m | Build, environment, evidence rules. Run once, by hand, before anything else. |
| 01 | [Install and packaging](01-install-and-packaging.md) | 00 | 2 h | Does the thing a beta user downloads actually run, on a machine that has never seen it. |
| 02 | [Cold first run across repo shapes](02-cold-first-run-shapes.md) | 01 | 3 h | Five repo shapes from `drift init` to a first verdict. Where does a new user dead-end. |
| 03 | [CLI command surface](03-cli-command-surface.md) | 00 | 4 h | All 54 command paths: exit code, JSON/text parity, `--db` resolution, `next_commands` validity. |
| 04 | [Help and docs consistency](04-help-and-docs-consistency.md) | 03 | 2 h | Every documented command and flag, executed as written. |
| 05 | [Scan and incremental reuse](05-scan-and-incremental-reuse.md) | 00 | 3 h | Content-hash reuse, engine-version fail-closed, `scan status` honesty. |
| 06 | [Parsing and fact extraction](06-parsing-and-fact-extraction.md) | 05 | 4 h | What the parser sees and what it silently misses; `parser_gaps` honesty. |
| 07 | [Identity resolution](07-identity-resolution.md) | 06 | 3 h | The three-tier symbol/module ladder, decoy modules, barrel/alias fixpoint. |
| 08 | [Route discovery and convention scope](08-route-discovery-and-convention-scope.md) | 06 | 3 h | Next.js-only route recognition, route groups, glob scope, non-Next repos. |
| 09 | [Convention lifecycle](09-convention-lifecycle.md) | 05 | 4 h | Candidate → accept → contract → export/import, all 23 kinds, the 4 with no evaluator. |
| 10 | [Enforcement cell matrix](10-enforcement-cell-matrix.md) | 09 | 6 h | All 18 ledger cells against real fixtures. Precision, recall, evasion. |
| 11 | [Security proof machinery](11-security-proof-machinery.md) | 10 | 4 h | The six proof files, the `session_not_trusted` schema mismatch, substring-detection limits. |
| 12 | [Diff and scope semantics](12-diff-and-scope-semantics.md) | 09 | 3 h | Pure renames, `--scope`, empty/stale diffs, partial coverage. |
| 13 | [Exit-code and refusal contract](13-exit-code-and-refusal-contract.md) | 12 | 3 h | Every code in `FAILURE_CONTRACT` reached live. Text-vs-exit-code disagreement. |
| 14 | [Baseline and suppression](14-baseline-and-suppression.md) | 10 | 3 h | Status precedence, orphaned baselines, missing audit events. |
| 15 | [Determinism](15-determinism.md) | 10 | 4 h | Reconcile the audit's measured evidence flicker against a mechanism that reads deterministic. |
| 16 | [Performance benchmarks](16-performance-benchmarks.md) | 05 | 5 h | scan / repo map / prepare / check at 500 → 20,000 files. Where each one bends. |
| 17 | [Storage and state lifecycle](17-storage-and-state-lifecycle.md) | 05 | 3 h | 34 migrations, corruption, concurrency, disk exhaustion. |
| 18 | [Backup, restore, audit chain](18-backup-restore-and-audit-chain.md) | 17 | 2 h | Round trip fidelity and the append-only hash chain under tampering. |
| 19 | [MCP agent surface](19-mcp-agent-surface.md) | 09 | 3 h | Hand-rolled JSON-RPC 2.0 conformance, 12 tools, malformed input. |
| 20 | [Doctor and readiness](20-doctor-and-readiness.md) | 01 | 2 h | Every check driven to `ok`, `warn`, and `fail`. |
| 21 | [Privacy and egress](21-privacy-and-egress.md) | 09 | 2 h | No source content leaves the machine. Support bundle redaction. Policy commands. |
| 22 | [CI and verify gates](22-ci-and-verify-gates.md) | 00 | 3 h | Does the gate that claims to gate actually gate. |

## Ordering

Charters 03, 05, 16, 17, 22 depend only on 00 and can start in parallel immediately.
01 → 02 → 20 is the new-user path. 05 → 06 → {07, 08} is the parsing path.
09 → {10, 12, 19, 21} is the contract path. 10 → {11, 14, 15} is the enforcement path.

## Results

One file per charter at `results/NN-<slug>.md`, built from [RESULTS-TEMPLATE.md](RESULTS-TEMPLATE.md).
No charter writes into another charter's results file. No charter edits product source.

## Beta gate

The program does not itself declare beta readiness. It produces 23 results files. The gate is a
separate judgment made after reading them, against criteria stated in
[00-PREFLIGHT.md §6](00-PREFLIGHT.md).
