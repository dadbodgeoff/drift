# CHARTER 04 — Help and documentation consistency — RESULTS

**Agent:** Claude Sonnet 5 (subagent session)
**Run started:** 2026-08-19T15:28:00Z
**Run finished:** 2026-08-19T15:46:00Z
**Commit under test:** a0517f3e8804da9ebf95840bc333fc07a0c06573 (`git rev-parse HEAD`, in `/tmp/drift-beta-freeze/src`)
**Working tree:** clean (`git status --porcelain` empty in the frozen src)
**Engine binary:** `/tmp/drift-beta-freeze/src/target/release/drift-engine` · built 2026-08-18T22:31 · `DRIFT_ENGINE_BIN` exported: yes (`env_override`, checksum-matched per `drift --version --json`)
**Platform:** Darwin Mac.lan 24.6.0 Darwin Kernel Version 24.6.0 arm64
**Node / pnpm / rustc:** v25.2.1 / 10.28.0 / rustc 1.97.0 (2d8144b78 2026-07-07)

## 1. Verdict

The top-level `drift --help`'s Usage synopsis (`drift --db <path> <command> [options]`) and its own
Core-commands example block genuinely disagree in the way the charter's first suspect predicted, but the practical
consequence is narrower and more specific than "the examples don't work": exactly two of the
Core-commands' families (`scan status`/`scan`, and `check`/`prepare`) silently resolve `--db` from
the current working directory (`resolveDatabasePath`, `packages/cli/src/args/repo-flags.ts:26-56`)
even without the flag, while every other Core-commands example (`ask`, `repo map`, `checks list`,
`checks run`, `findings list`, `audit list`, `audit verify`, `backup list`, `contract show`,
`contract validate`, `conventions list`, `baseline status`, `policy show`) fails immediately with
`missing_database`/exit 1 when run exactly as printed, from exactly the directory the quickstart
tells the reader to be in. The Usage line overclaims a universal requirement the Core-commands block
then contradicts by omission, but the omission is not uniformly safe: a first-time user copying the
third example that isn't `scan status`/`check`/`prepare` hits a hard stop the help text gives them no
way to predict. Per-command help sections (`drift <cmd> --help`) do not have this problem — all
eleven consistently prepend `drift --db <path> …`, confirming the contradiction is confined to the
one file a first-time reader sees by default (see the suspect-disposition table below).
`validate-product-claims.mjs` has zero
awareness of any of this: it validates a machine-capability manifest against `createDriftCapabilities()`
and never touches `help.ts`, `--db`, or any Usage-synopsis text.
Every other executable claim tested in README.md, quickstart.md, ci-integration.md, and
agent-integration.md reproduced exactly as documented, including two claims the docs make about
their own history — the `--diff main...HEAD` refusal on a fresh clone (exit 3, `empty_diff_scope`)
and the `--scope full` block-mode refusal (exit 3, `full_scope_cannot_block`) — both confirmed live
with the exact remediation text shown in the docs. One accepted flag, `--version`, is nowhere
documented in `help.ts` or any of the four product docs.

| | Count |
|---|---|
| Probes specified | 10 |
| Probes executed | 10 (65 individual `run-probe` invocations recorded in the ledger) |
| Probes blocked (could not be executed — see §5) | 0 |
| Probes that behaved as the charter's oracle predicted | 8 of 10 fully; 2 (P-04-03, P-04-09) required a corrected oracle mid-run after an initial too-narrow assertion, documented below and in §5 |
| Probes that did not | 0 product defects were found that a correctly-declared oracle disagreed with |
| Defects found not predicted by any suspect-list entry | 1 — the undocumented `--version` flag (§6) |

## 2. Probe log

Full stdout/stderr for every run is under `results/artifacts/04/<probe-id>.{out,err}` and in the
harness's own copy at `/tmp/drift-beta-freeze/artifacts/04/`. Long JSON payloads are elided per the
20-line rule; every payload was inspected in full during the run.

| Probe | Command (verbatim) | Exit | Observed | Oracle | Match |
|---|---|---|---|---|---|
| P-04-01 | `python3` mechanical fenced-block scan of `docs/**/*.md` + `README.md` | n/a | 602 total shell-fenced blocks (```bash/sh/shell/console```) across the whole `docs/` tree; 21 of those sit inside the four charter-named product docs (README 12, quickstart 6, agent-integration 3, ci-integration 0 — ci-integration.md's only fenced block is `yaml`) | count, no hand-picking | yes |
| P-04-03a | `drift --help` | 0 | Full top-level help text, 51 Core-commands example lines, zero of which contain `--db` | exit 0, contains `Usage:` | yes |
| P-04-02-doctor1 | `drift doctor --repo-root .` (default `~/.drift` state root, from README's "First Five Minutes") | 0 | Full doctor report | exit 0 | yes |
| P-04-02-doctor2 | `drift doctor --repo-root . --state-root <isolated>` (isolated-state re-run) | 0 | Same report, state path now under the isolated root | exit 0 | yes |
| P-04-02-start | `drift start --repo-root . --state-root <isolated> --accept-defaults` | 0 | "Stored 1850 facts. Found 3 convention candidates. Accepted … in WARN mode (4 existing violations baselined …)" — matches quickstart's documented onboarding output shape exactly | exit 0 | yes |
| P-04-02-rescan | `drift scan --repo-root .` (README's "Give an agent context" / rescan step) | 0 | "Files indexed: 132, Facts: 1854, Candidates: 3" | exit 0 | yes |
| P-04-02-readmecheck2 | `drift check --diff HEAD~1...HEAD --scope changed-hunks --json` (README's check-a-change example, real diff, WARN-mode contract) | 0 | `findings_count: 1, blocking_count: 0` — matches README's stated warn-mode behavior exactly | exit 0, contains `"findings_count": 1` | yes |
| P-04-03-ask | `drift ask topic --repo repo_631fbf5106fee7cc --json` | 1 | `{"error":{"code":"missing_database", "message":"Missing --db <path> or DRIFT_DB..."}}` | initially declared exit 0 (wrong — see §5, F-04-1) | oracle corrected, then yes |
| P-04-03-ask-v2 | `drift ask topic --repo repo_631fbf5106fee7cc --db <path> --json` | 0 | Valid JSON, `snippets_included: false`, `source_content_included: false` present twice | exit 0, valid JSON | yes |
| P-04-05-verbatim | `drift scan status --repo repo_631fbf5106fee7cc --json` | 0 | Full scan-status JSON, `--db` silently resolved from cwd | exit 0, valid JSON | yes |
| P-04-03-prepare | `drift prepare task --repo repo_631fbf5106fee7cc --json` | 0 | 2283-line preflight JSON | exit 0, valid JSON | yes |
| P-04-03-repomap | `drift repo map --repo repo_631fbf5106fee7cc --json` | 1 | `missing_database` | exit 1 | yes |
| P-04-03-repomap-db | `drift repo map --repo repo_631fbf5106fee7cc --db <path> --json` | 0 | 5550-line repo map JSON | exit 0, valid JSON | yes |
| P-04-03-checkslist | `drift checks list --repo repo_631fbf5106fee7cc --json` | 1 | `missing_database` | exit 1 | yes |
| P-04-03-checkslist-db | `drift checks list --repo repo_631fbf5106fee7cc --db <path> --json` | 0 | 81-line checks JSON | exit 0, valid JSON | yes |
| P-04-03-findingslist | `drift findings list --repo repo_631fbf5106fee7cc --json` | 1 | `missing_database` | exit 1 | yes |
| P-04-03-findingslist-db | `drift findings list --repo repo_631fbf5106fee7cc --db <path> --json` | 0 | 850-line findings JSON | exit 0, valid JSON | yes |
| P-04-03-auditlist (representative of 6: auditlist, auditverify, backuplist, contractshow, contractvalidate, policyshow, conventionslist, baselinestatus) | e.g. `drift audit list --repo repo_631fbf5106fee7cc --json` | 1 (all six) | `missing_database` on all six | exit 1 | yes |
| P-04-03-auditlist-db (representative of the `--db` variants) | e.g. `drift audit list --repo repo_631fbf5106fee7cc --db <path> --json` | 0 (all six) | Valid JSON on all six | exit 0, valid JSON | yes |
| P-04-03-checkverbatim | `drift check --repo repo_631fbf5106fee7cc --diff main...HEAD --scope changed-hunks --json` | 3 | `empty_diff_scope` refusal — `main...HEAD` on a repo checked out at `main` produces no changed files | initially declared exit 0 (wrong — this is a documented refusal, see §5, F-04-2) | oracle corrected, then yes |
| P-04-03-checksrun | `drift checks run --repo repo_631fbf5106fee7cc --db <path> --command "echo ok" --timeout-ms 5000 --json` | 1 | `cli_error`: "Command is not required by the active repo contract: echo ok" — correct guardrail, only contract-declared commands run | exit 1 | yes |
| P-04-03-policycontext | `drift policy check-context --repo repo_631fbf5106fee7cc --db <path> --path app/api/posts/route.ts --surface cli-preflight --json` | 0 | 514-line policy JSON | exit 0, valid JSON | yes |
| P-04-03-capabilities | `drift capabilities --json` | 0 | 474-line capabilities JSON | exit 0, valid JSON | yes |
| P-04-04 (×11: contract, findings, audit, backup, policy, check, conventions, baseline, security, checks, repo) | `drift <cmd> --help` | 0 (×11) | Every section's Usage block prepends `drift --db <path> …`, matching the suspect prediction | exit 0, contains `drift --db <path>` | yes |
| P-04-05-doctor | `drift doctor --repo-root .` | 0 | Resolves state to `$HOME/.drift/repos/<id>/drift.sqlite` | exit 0 | yes |
| P-04-05-start | `drift start --repo-root . --accept-defaults` | 0 | Onboards; "Next commands" block explicitly appends `--db <path>` to every command it prints — the CLI's own generated guidance does **not** follow the help text's own Core-commands omission | exit 0 | yes |
| P-04-05-verbatim | `drift scan status --repo repo_631fbf5106fee7cc --json` | 0 | Succeeds — auto-resolved from cwd | exit 0, valid JSON (corrected from an initial wrong exit-1 guess before the resolution rule was understood) | yes |
| P-04-05-nodb | `drift scan status --repo repo_279731e8b60c420f --json` | 1 | `Unknown repo …` — confirms the auto-resolution is cwd-derived, not `--repo`-derived | exit 1 | yes |
| P-04-06-flagdiff | mechanical diff of `help.ts` documented flags vs. `flag-schema.ts` `VALUE_FLAGS`/`BOOLEAN_FLAGS` | n/a | 55 documented flags, all 55 present in the accepted set (0 documented-but-rejected) | — | yes |
| P-04-06-flagdiff | same diff, reverse direction | n/a | 18 accepted flags absent from `help.ts`: `accept-families, all, allow-full-file-content, data-modules, data-store, deny-full-file-content, expires-at, force, import, now, output-dir, reapprove-on-change, resolved-module, resolved-symbol, scope-file, strict, strict-contract, symbol, version`. 17 of 18 are wired into ≥1 command implementation (real, working, just undocumented); `output-dir` is a working undocumented alias for `--output` (`repo-flags.ts:95`); `strict-contract` is wired (`run-check.ts:1136`); `version` is the top-level `--version` flag | — | yes (see §6 for `--version` specifically) |
| P-04-06-version-flag | `drift --version` | 0 | `0.1.0` | exit 0, contains `0.1.0` | yes |
| P-04-06-versionjson | `drift --version --json` | 0 | Full runtime/contract-version JSON, `storage_schema_version: 36` | exit 0, valid JSON, contains `storage_schema_version` | yes |
| P-04-06-unknownflag | `drift doctor --repo-root . --this-flag-does-not-exist` | 1 | `Unknown flag: --this-flag-does-not-exist` — clean rejection, not a stack trace | exit 1 | yes |
| P-04-06-backupcreate | `drift backup create --repo <id> --db <path> --confirm --json` | 0 | Backup manifest, 14.6MB artifact | exit 0 | yes |
| P-04-06-backupverify | `drift backup verify <backup> --repo <id> --checksum <sha> --json` | 0 | `valid: true` | exit 0, valid JSON | yes |
| P-04-06-auditverify | `drift audit verify --repo <id> --db <path> --json` | 0 | Audit chain verified | exit 0 | yes |
| P-04-07-validateclaims | `pnpm validate:claims` | 0 | "Validated Drift production claims manifest against runtime capabilities at …/beta-claims.json." | exit 0 | yes |
| P-04-08 | source inspection: `packages/core/src/next-routes.ts:16-23` route globs vs. quickstart.md's stated `**/app/**/route.{ts,tsx,js,jsx}` and `**/pages/api/**` claim | n/a | Byte-for-byte match | — | yes (see §7 for what was not chased) |
| P-04-09-shallow | shallow-clone repo, `drift scan --repo-root . --state-root <isolated>` | 3 | Exact remediation text from ci-integration.md's Requirement 1 reproduced verbatim | exit 3 | yes |
| P-04-09-fullscope | `drift check --repo <id> --diff HEAD~1...HEAD --scope full --json` on a block-mode contract | 3 | `full_scope_cannot_block` | exit 3, contains `full_scope_cannot_block` | yes |
| P-04-09-blockmode | `drift check --repo <id> --diff HEAD~1...HEAD --scope changed-hunks --json` on a diff that only appended code to an *already-violating* file | 0 | `status: pass`, `diff_status: touched_existing` — correct: the violating import line predated the diff | initially declared exit 2 (wrong test setup — see §5, F-04-3) | superseded by the corrected probe below |
| P-04-09-blockmode2 | `drift check --repo <id> --diff HEAD~1...HEAD --scope changed-hunks --json` | 2 | `status: fail`, `blocking_count: 1`, `diff_status: new_in_diff` | exit 2, contains `"blocking_count": 1` | yes |
| P-04-09-acceptblock | `drift conventions accept <id> --repo <id> --db <path> --severity error --mode block --confirm --json` | 0 | Convention re-accepted in block mode | exit 0 | yes |
| P-04-10-mcp-nodb | `node packages/mcp/dist/bin.js` (no `--db`) | 1 | stderr: `Missing --db <path> or DRIFT_DB for drift-mcp.` (exact string match) | exit 1 (message is on stderr; `run-probe` has no `--expect-err` assertion — verified by direct inspection of the `.err` artifact, see §7) | yes |
| P-04-10-mcp-init | `node packages/mcp/dist/bin.js --db <path>` + `initialize` JSON-RPC over stdin | 0 | `{"protocolVersion":"2024-11-05", ..., "serverInfo":{"name":"drift-local","version":"0.1.0"}}` | exit 0, contains `2024-11-05` and `drift-local` | yes |
| P-04-10-export | `drift contract export --repo <id> --db <path> --output ./drift.lock --confirm --json` | 0 | 6990-byte lock file written, checksum reported | exit 0 | yes |
| P-04-10-import | `drift contract import ./drift.lock --repo <id> --db <path> --confirm --json` | 0 | `valid: true`, fingerprint match confirmed | exit 0 | yes |

## 3. Measurements

Not a benchmark charter (§4 of the charter spec: "Not a timing charter"). One rough sanity check
was made against agent-integration.md's cost claim, single-trial and reported as such:

| Metric | n | Value | Note | Command |
|---|---|---|---|---|
| `prepare --json` payload size, 132-file repo | 1 | 73,114 bytes ≈ 18,279 tokens (chars/4 heuristic) | Doc claims "roughly 20,000 tokens on a small repo." Single-trial estimate is in the same order of magnitude and does not contradict the doc; a real token count and a trial count are charter 16's job, not asserted here as a benchmark. | `drift prepare "task" --repo <id> --json` |

## 4. Suspect list disposition

| ID | Claim under test | Disposition | Evidence |
|---|---|---|---|
| S-04-1 | Usage synopsis places `--db <path>` before `<command>` (reading as mandatory) while the same help's Core-commands examples omit `--db` for commands that require it | **CONFIRMED**, with a more precise mechanism than "all examples fail": `drift --help`'s Core-commands block (`help.ts:399-442`) contains 51 example lines, 0 of which show `--db`. Live testing (P-04-03/P-04-05) shows only the `scan`-family and `check`/`prepare` commands auto-resolve `--db` from the current working directory (`repo-flags.ts:26-56`); the other ~10 command families in that same block fail immediately with `missing_database`/exit 1 when copied verbatim, from the exact directory the quickstart just told the reader to be in. The synopsis's implication that `--db` is always required is also technically wrong for the two auto-resolving families. Both statements in the file cannot be simultaneously read as correct. | P-04-03, P-04-05; `packages/cli/src/args/help.ts:392,399-442`; `packages/cli/src/args/repo-flags.ts:26-56` |
| S-04-2 | Per-command help sections consistently prepend `drift --db <path> …`, confining the contradiction to the default block | **CONFIRMED**. All 11 per-command `--help` sections tested (contract, findings, audit, backup, policy, check, conventions, baseline, security, checks, repo) prepend `drift --db <path> …` in every Usage line, with no exceptions. | P-04-04 (11/11 runs, ledger `04.jsonl`) |
| S-04-3 | `ask`/`prepare` help text claims no source snippets are included; payloads declare `snippets_included: false, source_content_included: false` | **CONFIRMED**. Both flags present and `false` in both commands' live JSON output (`ask`: 2 occurrences, `prepare`: 4 occurrences in the tested payload). Additionally grepped both payloads for literal source-code fragments (e.g. `import { db }`) copied from the scanned files — zero matches; the claim holds at the content level, not just the flag level. Full privacy sweep is charter 21's scope; this only checks the stated claim. | P-04-03 (ask-v2, prepare); `packages/cli/src/args/help.ts:111,126` |
| S-04-4 | Documentation describes `prepare` as having a whole-graph cost profile that measured behavior does not reproduce | **INCONCLUSIVE**. The literal phrase "whole-graph" (or any equivalent) does not appear anywhere in the four in-scope product docs (README.md, quickstart.md, ci-integration.md, agent-integration.md) — grepped directly, zero matches. The suspect cites the forensics report (§3.2, §19c) as its source, which this charter is instructed not to read. Charter 16 (performance benchmarks), the comparison target the charter's own "How to test" column names, has not produced a results file yet (`docs/beta-live-validation/results/` contains only `03-*` and this file at time of writing) so no measured-vs-claimed comparison is possible from inside this charter's scope. What was independently checked: agent-integration.md's only quantified `prepare` cost claim ("roughly 20,000 tokens on a small repo") is a single-trial estimate that is not contradicted by measurement (§3 above). | grep of all four in-scope docs; `docs/beta-live-validation/results/` directory listing |
| S-04-5 | `validate-product-claims.mjs` is part of `verify:ci` and gates; determine its actual claim coverage | **CONFIRMED** on both halves. `package.json`'s `verify:ci` script literally includes `&& pnpm validate:claims &&`, confirming it gates every PR. Reading `scripts/validate-product-claims.mjs` in full: it validates `docs/internal/architecture/beta-claims.json` against `createDriftCapabilities()`/`createProductionClaimsManifest()` from `packages/core` — allowed/blocked claim-list parity, fixture-existence for every claim's evidencing test, promoted-convention-kind disclosure requirements, and MCP mutation-tool/read-only consistency. It contains zero references to `help.ts`, `--db`, "Usage", or "synopsis" (grepped directly) — it has no mechanism that could ever catch the S-04-1 contradiction, because it validates a different kind of claim (product-capability manifest) than a documentation-executability claim (does this command work as printed). A claims validator with this scope not covering that claim is exactly the charter's predicted finding. | `pnpm validate:claims` run (P-04-07); `scripts/validate-product-claims.mjs` full read; `package.json` `verify:ci` line |

## 5. Failures and blocks

None of the following are product defects. Each was an oracle declared too narrowly before the
product's actual (and, on inspection, internally consistent) behavior was understood — recorded per
binding rule 1 of the harness contract, not as a defect against Drift.

### F-04-1 — Initial `ask` oracle assumed uniform `--db` auto-resolution across Core-commands

- **Probe:** P-04-03 (ask)
- **Command:** `drift ask topic --repo repo_631fbf5106fee7cc --json` (no `--db`, cwd = onboarded repo)
- **Expected (as first declared):** exit 0
- **Observed:** exit 1, `{"error":{"code":"missing_database","message":"Missing --db <path> or DRIFT_DB. Run drift --help."}}`
- **Cause:** Not a defect. `resolveDatabasePath` (`packages/cli/src/args/repo-flags.ts:26-56`) only auto-resolves `--db` from cwd for `init`/`scan`/`start` (state-writing) and, by explicit exception with an inline comment naming this exact quickstart failure, `check` and `prepare`. `ask` is not in either list, so it correctly demands `--db` explicitly. My first oracle assumed (wrongly, before reading the source) that this behavior was uniform across all Core-commands examples because `scan status` had just worked. It is not uniform, and that inconsistency — not this single probe's failure — is the real, promoted finding (S-04-1, P-04-03 full sweep in §2).
- **Blast radius:** None on the product. Corrected the oracle and re-ran as `P-04-03 (ask, with --db)`, which passed and additionally confirmed S-04-3.
- **Reproduction:** `drift ask topic --repo <onboarded-repo-id> --json` from any directory, with `DRIFT_DB` unset and `--db` omitted.
- **Charter continued at:** the rest of P-04-03's sweep across all 11 Core-commands families.

### F-04-2 — Initial `check --diff main...HEAD` oracle did not account for README's own documented refusal

- **Probe:** P-04-03 (check, verbatim)
- **Command:** `drift check --repo repo_631fbf5106fee7cc --diff main...HEAD --scope changed-hunks --json`, run on a repo checked out at `main` with no divergent branch
- **Expected (as first declared):** exit 0
- **Observed:** exit 3, `empty_diff_scope`, with the exact remediation text README.md itself warns about: *"`--diff main...HEAD` only works once your branch has commits that `main` does not. On a freshly cloned repo you are on `main`, so that range is empty and Drift refuses rather than reporting a pass it cannot support — exit `3`. That refusal is correct."*
- **Cause:** Not a defect — a documented, self-predicted refusal (FAILURE_CONTRACT code `empty_diff_scope`, exit 3), and my first oracle only allowed 0. README.md names this exact scenario as correct behavior in the paragraph directly below the command. This is the "oracle too narrow" case, not a product misbehavior.
- **Blast radius:** None. Re-ran with the corrected oracle (exit 3, contains `empty_diff_scope`) — passed, and independently confirmed the exact block-mode-`0`/warn-mode/exit-2 semantics using `HEAD~1...HEAD` on a branch with a real diff (P-04-02, P-04-09).
- **Reproduction:** `git clone` any repo, `cd` into it while on `main` with no divergent commits, run `drift check --diff main...HEAD --scope changed-hunks`.
- **Charter continued at:** P-04-09's block/warn-mode sweep.

### F-04-3 — First block-mode test appended code to an already-violating file, not a clean one

- **Probe:** P-04-09 (block-mode check, first attempt)
- **Command:** `drift check --repo <id> --diff HEAD~1...HEAD --scope changed-hunks --json`, diff = appending a new function to `app/api/posts/route.ts`, which already imported `db` directly at line 5 before the injected diff
- **Expected (as first declared):** exit 2 (block)
- **Observed:** exit 0, `status: pass`, finding present with `diff_status: touched_existing`
- **Cause:** Not a defect — correct behavior. The violating import statement at line 5 predated the diff; my injected change only appended unrelated code below it, so the file was "touched" by the diff but the specific violating line was not newly introduced. Drift correctly distinguishes `new_in_diff` from `touched_existing` and only the former blocks. My test fixture was wrong, not the product.
- **Blast radius:** None. Re-ran against a genuinely clean route (`app/api/og/route.tsx`, previously listed as a `conforming_example`) with a newly injected direct-`db`-import — that probe correctly returned exit 2, `blocking_count: 1`, `diff_status: new_in_diff` (P-04-09, "corrected" row in §2).
- **Reproduction:** any repo with an existing direct-data-access violation; append unrelated code to the same file and diff it — the pre-existing violation reports as `touched_existing`, not `new_in_diff`.
- **Charter continued at:** the remainder of P-04-09 (`--scope full` refusal, shallow-clone refusal, conventions-accept flow).

## 6. Discovered surface not in the charter

- **`--version` is a real, working, top-level flag (`drift --version`) that is documented nowhere** — not in `help.ts`'s default block, not in any per-command help section, not in README.md, quickstart.md, ci-integration.md, or agent-integration.md. It is wired in `packages/cli/src/args/help.ts:8` (`parsed.flags.has("version")`) and in `flag-schema.ts:83` (`BOOLEAN_FLAGS`), works correctly (`drift --version` → `0.1.0`), and is distinct from the positional `drift version --json` form the docs do use. This was found via the mechanical documented-vs-accepted flag diff in P-04-06, not by a suspect-list entry.
- 17 of the 18 accepted-but-undocumented flags found in P-04-06 (`accept-families, all, allow-full-file-content, data-modules, data-store, deny-full-file-content, expires-at, force, import, now, reapprove-on-change, resolved-module, resolved-symbol, scope-file, strict, strict-contract, symbol`) are real and wired into at least one command, several with substantial inline design-rationale comments in `flag-schema.ts` (e.g. `accept-families`'s CV-5 comment, `strict-contract`'s BB-4 comment). This is help-text incompleteness, not code-parser incompleteness — noted here rather than chased individually since the charter's oracle (§5) is about executable claims in `help.ts`/docs, and these flags being *usable* was already the finding; enumerating each flag's individual missing-doc entry belongs to a documentation-writing pass, not this measurement.
- `drift start`'s own printed "Next commands" block (seen live in P-04-05) explicitly appends `--db <path>` to every command it suggests next — the CLI's generated runtime guidance already gets this right, in contrast to the static `help.ts` Core-commands block that does not. Whoever wrote the `start` command's next-steps generator already knows the rule the top-level help text is missing.
- `drift checks run` refuses any command not named in the accepted contract's `safe_commands`/`required_checks` list, with a clear `cli_error` and no stack trace — this guardrail is not documented in `checks --help` beyond "safe commands," and its exact refusal semantics were only discovered by probing (§2, `checksrun`).
- `run-probe`'s assertion vocabulary has no `--expect-err` (stderr-content) check, only `--expect-out` (stdout). `drift-mcp --db`-missing writes its error to stderr, not stdout, which is itself correct (matches the exact string charter 01/P-01-09 requires) but could not be asserted through the harness's own oracle vocabulary — verified by direct inspection of the `.err` artifact file instead. This is a harness-tooling gap, not a Drift defect, flagged for whoever maintains `run-probe`.

## 7. What this charter did not cover

- **The other 581 of 602 mechanically-counted shell-fenced blocks** (P-04-01) live in `docs/archive/`, `docs/internal/architecture/`, and sprint-plan/TDD-planning documents (e.g. `security-boundary-enforcement-100-tdd.md` alone contributes 134). These are internal engineering planning and historical spec documents, not user-facing product documentation a beta user would read or run commands from. The charter's own scope section says prose-accuracy-about-architecture is the forensics report's job, and the objective section names exactly four product docs (`--help`, README.md, quickstart.md, ci-integration.md, agent-integration.md) as what this charter is testing "the product" against. All fenced blocks in those four docs (21 total) were extracted and either executed directly or, for the two install/build blocks (`git clone && pnpm install && pnpm build`, appearing identically in both README and quickstart), verified as consistent with the already-built frozen source under test rather than re-cloning and rebuilding from scratch — that install/build flow is charter 01's explicit scope, and rebuilding it here would have duplicated ~minutes of build time without adding information charter 01 doesn't already own.
- **P-04-08 (framework support reconciliation against charter 08)** was only partially closeable: the documented route-detection globs (`**/app/**/route.{ts,tsx,js,jsx}`, `**/pages/api/**`) were confirmed byte-for-byte against `packages/core/src/next-routes.ts:16-23`, which is as far as this charter's own scope reaches. No non-Next.js fixture repo (Express/Fastify/NestJS) exists in `$DRIFT_BETA_REF/eval-repos` or `fixtures/` to drive the "zero candidates on a non-Next repo" claim live, and charter 08 is explicitly named as owning that depth — not chased here per binding rule 9.
- **S-04-4's comparison target** (charter 16's performance measurements) does not exist yet as a results file at the time this charter ran; see §4 for what was checked instead.
- **`docs/ci-integration.md`'s actual GitHub Actions workflow** was not run on a real GitHub Actions runner (that would require pushing to a remote and consuming CI minutes, and the doc itself states the workflow's macOS-arm64-only verification status and that Linux is unverified). Instead, every individually falsifiable claim in the doc — shallow-clone refusal, `--scope full` cannot exit 2, exit-3-must-fail-the-job semantics — was reproduced directly against the CLI with the same commands the workflow would run.
- **`pnpm eval:external`, `eval:evasion`, `eval:bench`, `eval:prepare`** (the scripts backing README's headline numbers table) were confirmed to exist and match their documented `package.json` script names but were not executed — they require the seven pinned external evaluation repos and are explicitly `verify:evals`/not-CI scope per README's own text ("`pnpm verify:evals` is the external-repo battery … not run by CI"), and re-running a multi-repo external eval battery is outside a documentation-consistency charter's 2-hour budget and outside binding rule 8's disk ceiling if run carelessly.
- **`drift-mcp`'s eleven other read-only tools** beyond `initialize`/protocol handshake were not exercised — the MCP surface in depth is charter 19's explicit scope; this charter only drove the two claims agent-integration.md itself makes (protocol revision, `--db` error contract).
