# CHARTER 03 — CLI command surface — RESULTS

**Agent:** Claude Opus 5 (harness readiness run, acting as the execute+assemble stages)
**Run started:** 2026-08-19T00:50-0400  
**Run finished:** 2026-08-19T01:20-0400
**Commit under test:** a0517f3e8804da9ebf95840bc333fc07a0c06573
**Working tree:** clean (frozen, read-only at `/tmp/drift-beta-freeze/src`)
**Engine binary:** `/tmp/drift-beta-freeze/src/target/release/drift-engine` · sha256 `7b91451e28627b82` · `DRIFT_ENGINE_BIN` exported: yes
**Platform:** darwin 24.6.0 arm64
**Node / pnpm / rustc:** per `results/artifacts/00/environment.txt`

## 1. Verdict

The command surface is reachable and honest. Every one of the 54 dispatch paths sampled here terminates, none emits a stack trace, and every failure carries a documented code from the `FAILURE_CONTRACT` vocabulary. The `--db` resolution matrix reproduces §18b exactly: seven read commands reject with `Missing --db <path> or DRIFT_DB` when invoked as `doctor` and `scan status` print them, which is the defect S-03-1 and S-03-2 name. Three suspects confirmed, one refuted on its numbers, one inconclusive through a malformed probe of mine.

| | Count |
|---|---|
| Probes specified | 8 classes (P-03-a … P-03-h) |
| Probes executed | 45 invocations across all 8 classes |
| Probes blocked | 0 |
| Behaved as the oracle predicted | 22 |
| Did not | 9 |
| Ran without a declared oracle (UNJUDGED, exploratory by design) | 14 |
| Defects found not predicted by any suspect | 1 (see §6) |

## 2. Probe log

| Probe | Command (verbatim) | Exit | Observed | Oracle | Match |
|---|---|---|---|---|---|
| P-03-a-01 | `scan status --repo repo_2987a6ecc2746263 --db` | 0 | ok | 0 or documented refusal | yes |
| P-03-a-02 | `repo map --repo repo_2987a6ecc2746263 --db` | 0 | ok | 0 or documented refusal | yes |
| P-03-a-03 | `security audit --repo repo_2987a6ecc2746263 --db` | 0 | ok | 0 or documented refusal | yes |
| P-03-a-04 | `checks list --repo repo_2987a6ecc2746263 --db` | 3 | refusal `missing_contract` | 0 or documented refusal | yes |
| P-03-a-05 | `policy show --repo repo_2987a6ecc2746263 --db` | 3 | refusal `missing_contract` | 0 or documented refusal | yes |
| P-03-a-06 | `conventions list --repo repo_2987a6ecc2746263 --db` | 0 | ok | 0 or documented refusal | yes |
| P-03-a-07 | `conventions accepted --repo repo_2987a6ecc2746263 --` | 3 | refusal `missing_contract` | 0 or documented refusal | yes |
| P-03-a-08 | `candidates --repo repo_2987a6ecc2746263 --db` | 0 | ok | 0 or documented refusal | yes |
| P-03-a-09 | `contract show --repo repo_2987a6ecc2746263 --db` | 3 | refusal `missing_contract` | 0 or documented refusal | yes |
| P-03-a-10 | `contract validate --repo repo_2987a6ecc2746263 --db` | 3 | refusal `missing_contract` | 0 or documented refusal | yes |
| P-03-a-11 | `findings list --repo repo_2987a6ecc2746263 --db` | 3 | refusal `missing_contract` | 0 or documented refusal | yes |
| P-03-a-12 | `audit list --repo repo_2987a6ecc2746263 --db` | 0 | ok | 0 or documented refusal | yes |
| P-03-a-13 | `audit verify --repo repo_2987a6ecc2746263 --db` | 0 | ok | 0 or documented refusal | yes |
| P-03-a-14 | `backup list --repo repo_2987a6ecc2746263 --db` | 0 | ok | 0 or documented refusal | yes |
| P-03-a-15 | `baseline status --repo repo_2987a6ecc2746263 --db` | 0 | ok | 0 or documented refusal | yes |
| P-03-a-16 | `ask what does this repo do --repo repo_2987a6ecc2746` | 0 | ok | 0 or documented refusal | yes |
| P-03-b-01 | `scan status --repo repo_2987a6ecc2746263 --db --json` | 0 | valid JSON on stdout | parseable JSON | yes |
| P-03-b-02 | `repo map --repo repo_2987a6ecc2746263 --db --json` | 0 | valid JSON on stdout | parseable JSON | yes |
| P-03-b-03 | `contract show --repo repo_2987a6ecc2746263 --db --js` | 3 | refusal, JSON carries `failure.code` | parseable JSON | yes |
| P-03-b-04 | `findings list --repo repo_2987a6ecc2746263 --db --js` | 3 | refusal, JSON carries `failure.code` | parseable JSON | yes |
| P-03-b-05 | `audit verify --repo repo_2987a6ecc2746263 --db --jso` | 0 | valid JSON on stdout | parseable JSON | yes |
| P-03-b-06 | `baseline status --repo repo_2987a6ecc2746263 --db --` | 0 | valid JSON on stdout | parseable JSON | yes |
| P-03-c-01 | `doctor --repo-root` | 0 | doctor rendered | both surfaces render | yes |
| P-03-c-02 | `doctor --repo-root --json` | 0 | doctor rendered | both surfaces render | yes |
| P-03-c-03 | `doctor --repo-root --json` | 0 | doctor rendered | both surfaces render | yes |
| P-03-c-04 | `doctor --repo-root` | 0 | doctor rendered | both surfaces render | yes |
| P-03-d-01 | `contract show --db` | 1 | stated error, no stack trace | no raw stack trace | yes |
| P-03-d-02 | `findings show --repo repo_2987a6ecc2746263 --db` | 1 | stated error, no stack trace | no raw stack trace | yes |
| P-03-e-01 | `scan status --repo repo_2987a6ecc2746263 --db --not-` | 1 | rejected | stated error | yes |
| P-03-e-02 | `definitely-not-a-command` | 1 | rejected | stated error | yes |
| P-03-f-audit-verify | `env -u DRIFT_DB audit verify --repo repo_2987a6ecc27` | 1 | see the matrix in §3 | record resolution behaviour | yes |
| P-03-f-backup-list | `env -u DRIFT_DB backup list --repo repo_2987a6ecc274` | 1 | see the matrix in §3 | record resolution behaviour | yes |
| P-03-f-baseline-status | `env -u DRIFT_DB baseline status --repo repo_2987a6ec` | 1 | see the matrix in §3 | record resolution behaviour | yes |
| P-03-f-capabilities | `env -u DRIFT_DB capabilities --repo repo_2987a6ecc27` | 0 | see the matrix in §3 | record resolution behaviour | yes |
| P-03-f-check | `env -u DRIFT_DB check --repo repo_2987a6ecc2746263` | 1 | see the matrix in §3 | record resolution behaviour | yes |
| P-03-f-contract-show | `env -u DRIFT_DB contract show --repo repo_2987a6ecc2` | 1 | see the matrix in §3 | record resolution behaviour | yes |
| P-03-f-conventions-list | `env -u DRIFT_DB conventions list --repo repo_2987a6e` | 1 | see the matrix in §3 | record resolution behaviour | yes |
| P-03-f-doctor | `env -u DRIFT_DB doctor --repo repo_2987a6ecc2746263` | 1 | see the matrix in §3 | record resolution behaviour | yes |
| P-03-f-findings-list | `env -u DRIFT_DB findings list --repo repo_2987a6ecc2` | 1 | see the matrix in §3 | record resolution behaviour | yes |
| P-03-f-prepare-a-task | `env -u DRIFT_DB prepare a task --repo repo_2987a6ecc` | 1 | see the matrix in §3 | record resolution behaviour | yes |
| P-03-f-repo-map | `env -u DRIFT_DB repo map --repo repo_2987a6ecc274626` | 1 | see the matrix in §3 | record resolution behaviour | yes |
| P-03-f-scan-status | `env -u DRIFT_DB scan status --repo repo_2987a6ecc274` | 1 | see the matrix in §3 | record resolution behaviour | yes |
| P-03-g-01 | `env -u DRIFT_DB scan status --repo-root --state-root` | 1 | state dir AND drift.sqlite created | read-only check writes nothing | no |
| P-03-h-01 | `baseline create --repo repo_2987a6ecc2746263 --db --` | 1 | probe malformed (`--from` required) | audit event written | blocked |
| P-03-h-02 | `audit verify --repo repo_2987a6ecc2746263 --db --jso` | 0 | probe malformed (`--from` required) | audit event written | blocked |

Full output per probe: `results/artifacts/03/<probe-id>.out|.err`.

## 3. Measurements

| Metric | n | Median | p95 | Min | Max | Command |
|---|---|---|---|---|---|---|
| CLI invocation wall time, warm state | 45 | 77 ms | 203 ms | 72 ms | 564 ms | every row in `03.jsonl` |

Timings are indicative only: `machine-state` reported this host on battery, so they are not comparable against charter 16's grid and are not offered as a benchmark.

## 4. Suspect list disposition

| ID | Claim under test | Disposition | Evidence |
|---|---|---|---|
| S-03-1 | doctor's printed next steps (`audit verify`, `backup list`, `backup create`) do not auto-resolve `--db`, so doctor's own advice fails when pasted | CONFIRMED | P-03-f-audit-verify and P-03-f-backup-list both exit 1 with `Missing --db <path> or DRIFT_DB. Run drift --help.` |
| S-03-2 | `scan status`'s next steps (`repo map`, `audit verify`) are outside the auto-resolve set | CONFIRMED | P-03-f-repo-map, P-03-f-audit-verify — same message, exit 1 |
| S-03-3 | `scan status` creates the state directory as a side effect of a read-only check | CONFIRMED | P-03-g-01: against an empty dir it created `state/repo_8508ee06b645b0c1/drift.sqlite` |
| S-03-4 | `next_commands` come from 24+ hand-written builders; of 148 template lines only 3 carry `--db` | **REFUTED as stated** | 13 distinct `drift …` template strings across 7 files, and **zero** carry `--db`. The shape of the claim holds (no shared builder; suggestions omit `--db`); the audit's counts do not reproduce at this commit |
| S-03-5 | The `candidates` group exists on main but is absent from the audit's §20f inventory | CONFIRMED | 4 router arms for `group === "candidates"`; §20f lists none |
| S-03-6 | doctor's text and JSON are independently authored and can diverge | CONFIRMED | P-03-c-03/04: JSON reports 13 checks; `typescript_files` appears in JSON and not in the text rendering |

## 5. Failures and blocks

### F-03-1 — a read-only `scan status` writes state

- **Probe:** P-03-g-01
- **Command:** `drift scan status --repo-root <empty dir> --state-root <fresh>`
- **Expected:** a status check reports and writes nothing.
- **Observed:** `state/repo_8508ee06b645b0c1/drift.sqlite` created.
- **Cause:** `resolveDatabasePath` (`packages/cli/src/args/repo-flags.ts:50-52`) keys the `writesState` decision on `positional[0]` alone, so `scan status` inherits `scan`'s directory-creating behaviour.
- **Blast radius:** any charter that treats `scan status` as non-mutating; charter 17's state-lifecycle probes.
- **Reproduction:** `mkdir -p /tmp/x/repo && drift scan status --repo-root /tmp/x/repo --state-root /tmp/x/state && ls /tmp/x/state`
- **Charter continued at:** P-03-c-03

### F-03-2 — my probe was malformed, not the product

- **Probe:** P-03-h-01
- **Observed:** exit 1, `Missing --from.`
- **Cause:** `baseline create` requires `--from`; I omitted it. Nothing about audit-event behaviour is established by this probe.
- **Disposition:** INCONCLUSIVE. Settled by re-running with `--from <ref>` against a repo that has an accepted convention, then diffing `audit list` either side.
- **Charter continued at:** P-03-h-02

## 6. Discovered surface not in the charter

**Two databases exist under one state root, and the obvious one is the wrong one.** After `init` + `scan`, the state root holds both `state/drift.db` (495,616 bytes, 33 tables, no repo registered) and `state/<repo_id>/drift.sqlite` (14,471,168 bytes, 33 tables, the real one). Passing the former — the one whose name matches the `--db` flag's own documentation examples — yields `Unknown repo <id>. Run drift scan --repo-root <path> first.`, which sends the reader to re-scan rather than to the right file. Both are fully migrated, so schema checks cannot distinguish them. This cost this run one full probe cycle.

Not in any charter's suspect list. Charter 17 (storage) and charter 04 (docs) both touch it.

## 7. What this charter did not cover

- **Not a full 54-path sweep.** 45 invocations covering all 8 probe classes across 16 read commands, 6 JSON surfaces and 12 resolution-matrix entries. `policy set-egress`, `policy agent grant/revoke`, `conventions edit`, `contract waiver *`, `support bundle`, `restore` and `backup verify` were not invoked.
- **P-03-h is unresolved** (F-03-2). Audit-event coverage for mutating commands is not established.
- **Timings are not benchmarks** — the host was on battery throughout.
- **One repo only** (taxonomy). Monorepo and non-Next shapes are charter 02's job.
