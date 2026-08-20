# CHARTER 16 — Performance benchmarks

**Depends on:** 05 · **Est. 5 h** · **Output:** `results/16-performance-benchmarks.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 16 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 16 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 16` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Find where each command's cost curve bends, and why. The prior audit measured `repo map` growing
**×24.75 in time for ×5 in files** (1,000 → 5,000). The forensics pass found a structural
explanation — `repoMap()` does a full linear scan of **all** graph edges and **all** graph nodes
**once per file** — but explicitly could not confirm that loop is the dominant cost, because no
profiling was run (§19b, §21). This charter profiles.

## 2. Mechanism under test

- `drift scan` — sequential walk → parse → graph build → SQLite write (`main.rs:207-260`,
  `:683-720`). Single-threaded by construction.
- `drift repo map` — `packages/query/src/index.ts:392-465`. Inside `snapshots.map(...)` over every
  file it runs `for (const edge of edges)` (`:409`) and `for (const node of nodes)` (`:428`) over
  the **full** lists. `O(files × (edges + nodes))`. The storage read itself is cached once per
  `(repoId, scanId)` via `graphFor()` (`:369-386`) — that fixes an older
  eighteen-call-sites-reload defect but does **not** change the loop's shape.
- `drift prepare` — `graphPreflightContext()` (`domain/graph-preflight.ts:20-95`): one
  `GraphQueryService`, five query functions, ≤ 10 paths → up to ~50 graph queries, one storage
  load, but a full in-memory traversal **per query**.
- `drift check` — evaluator dispatch per accepted convention over the scoped file set.

## 3. Procedure

### The scaling grid

Synthetic repos at **500 / 1,000 / 2,000 / 5,000 / 10,000 / 20,000** files, generated
deterministically by the generator committed in charter 00. Hold per-file characteristics constant
across sizes — same average imports per file, same route density — so the only variable is count.
Also run the seven `$DRIFT_EVAL_REPOS` corpus repos as realistic points.

For each (command × size), **n = 5 trials**, report median / p95 / min / max, plus peak RSS.

| Command | Configurations |
|---|---|
| `drift scan` | cold; warm (full reuse); one-file-changed |
| `drift scan status` | warm |
| `drift repo map` | text; `--json` |
| `drift prepare "<task>"` | 1 path touched; 10 paths touched (the `.slice(0, 10)` ceiling) |
| `drift check` | `--scope full`; `changed-files`; `changed-hunks`; at 1 / 5 / 18 accepted conventions |
| `drift ask` | one representative query |
| `drift start` | cold, end to end |
| `drift doctor` | warm |

### Profiling — the part that closes §21

| Probe | What to do |
|---|---|
| P-16-01 | Profile `repo map` at 5,000 and 20,000 files. Attribute time across: `graphFor()` storage load, the per-file edge loop (`index.ts:409`), the per-file node loop (`:428`), `snapshots` construction, `buildRepoMapReadModel`, and **Zod schema validation on the way out**. §21 names all of these as candidates and rules out none. Report the actual split. |
| P-16-02 | Confirm or refute the `O(files × edges)` shape empirically: hold file count fixed and vary edge density (imports per file). If time grows with edges at fixed file count, the shape is confirmed. |
| P-16-03 | Reproduce the ×24.75-for-×5 measurement at 1,000 → 5,000 and extend the curve to 20,000 (or record where it becomes unusable). |
| P-16-04 | Profile `prepare` at 10 paths on a 20,000-file repo. §19c predicts near-linear scaling contrary to the product's own documentation of a whole-graph blowup — confirm which is true, and feed the answer to charter 04 (S-04-4). |
| P-16-05 | Profile `scan`: split time between file I/O, parsing (`scan_file_with_reuse`), graph construction (`graph_for_file`), and the SQLite write. |
| P-16-06 | Memory: peak RSS for each command at each size. The scan loop is sequential — confirm memory is flat in repo size, or find what accumulates. |
| P-16-07 | SQLite: database size vs. repo size; time in write transactions; whether any query is unindexed. Dump `EXPLAIN QUERY PLAN` for the hot reads. |
| P-16-08 | Concurrency headroom: the engine scan is single-threaded. Measure single-core saturation and estimate the ceiling a parallel walk would lift. **Measure, do not propose.** |

### Real-world latency

| Probe | What to do |
|---|---|
| P-16-09 | The pre-commit-hook question: `drift check --diff` on a 1-file change, in a 20,000-file repo, warm. This is the number that decides whether Drift is usable in an interactive loop. n = 20. |
| P-16-10 | The CI question: full `drift scan` + `drift check` cold, on the largest corpus repo. n = 3. |
| P-16-11 | The agent question: `drift prepare` latency at p95 — charter 19's MCP consumers pay this. |

## 4. Reporting

Every number carries: command, repo, file count, trial count, median, p95, and the exact
invocation. A curve is reported as a table of points plus the observed growth exponent between
consecutive points, not as a single adjective.

Headline numbers for §1 of the results file:

- `repo map` growth exponent, 1,000 → 20,000 files
- `check --diff` p95 on a 1-file change in a 20,000-file repo
- cold `scan` throughput (files/s) at 20,000 files
- warm/cold scan ratio

## 5. Oracles

There is no pass/fail here. The oracle is **explanation**: every bend in every curve is attributed
to a specific mechanism, cited to `file:line`, and confirmed by profiling rather than inferred.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-16-1 | `repoMap()`'s per-file loop over all edges and all nodes is the dominant cost at 5,000+ files. **Explicitly CANNOT DETERMINE without profiling.** | §19b, §21 | P-16-01, P-16-02 |
| S-16-2 | `repo map` grew ×24.75 in time for ×5 in files. | audit §4.3 | P-16-03 |
| S-16-3 | `graphFor()`'s cache fixed an eighteen-call-site reload but did not change the loop's shape. | §19b, `index.ts:357-386` | P-16-01 attribution |
| S-16-4 | `prepare` scales near-linearly, contradicting the product's own documented whole-graph blowup at 20,000 files. | §19c, §3.2 | P-16-04 |
| S-16-5 | The scan loop is sequential and non-parallel. | §3.1, `main.rs:690` | P-16-08 |
| S-16-6 | Warm scans reuse nearly everything, making the warm/cold ratio the reuse mechanism's whole value. | §3.1, charter 05 | The grid's cold vs warm rows |

## 7. Failure protocol

Per [00-PREFLIGHT §5.7](00-PREFLIGHT.md). If a command does not complete at a size, record the
size, the time waited, and the state at the timeout — that is a data point, not a gap. **Confirm
the machine's power and thermal state from charter 00 before reporting any timing**; a throttled
run invalidates the whole grid.

## 8. Deliverables

`results/16-performance-benchmarks.md` with the full command × size grid, growth exponents, and
profile attributions; raw timing data as CSV and profiler output under `results/artifacts/16/`.
