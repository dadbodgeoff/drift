# Hook latency profile, round 13 (2026-11-09)

This profile involves no model calls and no product change. It reproduces the PostToolUse
latency recorded in the v2 pilot (eval/agent-ab/v2/results/pilot-haiku-2026-11-05.md:
"median of run medians 1082 ms") on three build-set TS clones (dub, infisical, midday). It
breaks one hook into phases and names the cause.

**Cause, in one line.** The pilot binary predates #6, so every edit paid for a full scan.
#6 (1bd8f446, 2026-11-05 19:14 UTC) made PostToolUse check one file. The pilot's binary
(`bin/drift-main` in the pilot scratch) was built at 16:03 UTC that day, and the pilot started
at 16:37 UTC. So in the pilot, every PostToolUse ran a warm full scan.

## 1. What the record says, corrected

- Over the pilot's 47 PostToolUse calls (raw `hooklog.jsonl`, all four drift runs), the
  median is **465 ms** (p90 1,165 ms, max 2,268 ms).
- The report's 1,082 ms is the upper median (`s[floor(n/2)]`) of four per-run medians:
  256 ms on immich (n=3), 438 ms on midday (n=37), 1,082 ms on dub (n=1) and 1,567 ms on
  infisical (n=6).
- PreToolUse in the same sessions: median 9 ms. The wrapper and process start are not the
  cost.
- The four per-run medians match each repo's warm full-scan time (perf record of 2026-11-07:
  warm census 0.36 / 0.56 / 1.23 / 2.54 s on immich / midday / dub / infisical).

## 2. Reproduction: pilot binary against main

[`scripts/latbench.py`](scripts/latbench.py) mirrors the pilot setup:

- a private work copy of each clone (hardlinked tree and a fresh `.git`, `mkwork.sh`);
- the reviewed policy committed (the pilot's own policy for the pilot binary; `init` plus
  every proposal accepted for main, the strict case);
- the fact cache in the default `.drift/cache`, warmed by `drift scan` as `run.mjs` does;
- the hook fed the pilot agent's own files: for every file the pilot's drift-arm agent
  changed in that repo, PreToolUse, then the edit (existing files: a comment line appended;
  new files: the content the agent wrote), then PostToolUse, then a restore;
- 5 repeats, with the two binaries interleaved.

The main binary is the release build of main as of #167 (`drift-bin/sec167`). Product code is
unchanged up to b126bdb8.

The machine was shared, with load average 8–20, so CPU time is given next to wall time. Raw
rows are in `hooks.jsonl` (579) and the table is in `summary.md`.

| repo | warm full scan, main (s) | PostToolUse, pilot binary p50 (s) | PostToolUse, main p50 / p90 (s) | PreToolUse p50, both (s) | process start (`--version`) (s) |
| --- | --- | --- | --- | --- | --- |
| dub (5 hooks/rep) | 0.85 | **1.049** | **0.085** / 0.109 | 0.004–0.010 | 0.003 |
| infisical (15) | 1.73 | **1.582** | **0.155** / 0.203 | 0.004–0.005 | 0.003 |
| midday (100) | 0.27 | **0.289** | **0.038** / 0.054 | 0.003–0.004 | 0.003 |

- **Pilot binary, pooled 120 edit hooks:** p50 0.299 s, p90 1.415 s. The pilot's 1,082 ms
  (dub) and 1,567 ms (infisical) are reproduced within 3%.
- **Main, pooled 120 edit hooks:** p50 0.040 s, p90 0.151 s.
- **Full scans per edit (strace):** a pilot-binary PostToolUse on infisical opens 13,765
  directories and **9,014** cached fact files, the whole cache. Main opens 2,715 directories
  and **333** fact files: the edited file's link closure and the index.
- **Fallbacks on main:** none of the 120 edit hooks fell back to a full scan. Their CPU time
  is at most 20% of the repo's warm-scan CPU. The trace build records the path directly (§7: 0 of 504).

## 3. Where the time goes on main (one PostToolUse, after an edit)

Instructions from `valgrind --tool=callgrind`, inclusive cost of each phase's root function,
summed over threads ([`scripts/cgphase.py`](scripts/cgphase.py)). Process start (3 ms),
stdin and output are under 1%. The `git ls-files` probe in `cache_dir` is a subprocess of
about 5 ms wall (strace timeline).

| phase | dub (189 M instr.) | infisical (795 M) | midday (216 M) |
| --- | --- | --- | --- |
| policy load (`Project::open_for_agents`) | 1.3% | 0.4% | 0.8% |
| file discovery: walk of the whole repo (`ingest::walk`, ignore files per directory) | **46.2%** | **41.8%** | **23.9%** |
| facts load: index (`Index::load`, JSON) | 12.1% | 7.2% | 5.4% |
| facts load: cached facts of linked files (`FactCache::get<RawFile>`, JSON) | 9.2% | **28.7%** | **31.6%** |
| scan of the edited file (parse + lower) | 0.1% | 0.8% | 0.4% |
| index write-back (whole index re-serialised) | 7.8% | 4.0% | 3.5% |
| check (`needs_full_scan` + check) | 4.9% | 1.9% | 6.0% |
| other: link, resolver setup, thread pools, runtime | 18.4% | 15.2% | 28.4% |

Main's one-file hook still walks the whole repository, and reads and rewrites the whole JSON
index, on every edit. Walk plus facts load plus index write is **64–82%** of the work.

## 4. The other hook paths

Wall time p50 and max over 5 repeats, with p50 CPU time
([`scripts/latitems.py`](scripts/latitems.py); raw rows in `items.jsonl`). The run had load
average 13–20, so wall times are inflated about 2× against §2, and CPU is the steadier
column. "block" is the same policy with every accepted convention switched to block mode.

| hook path (candidate in the coordinator's list) | dub | midday | infisical |
| --- | --- | --- | --- |
| (6) PreToolUse, Edit of an existing file | 8 ms (CPU 3 ms) | 18 ms (4 ms) | 4 ms (3 ms) |
| PostToolUse, source edit | 0.21–0.26 s (CPU 0.07) | 0.11–0.15 s (0.05) | 0.25 s (0.19–0.20) |
| (3) PostToolUse, README.md edit (non-source) | 0.14–0.17 s (CPU 0.05) | 0.07–0.11 s (0.03) | 0.12–0.14 s (0.11–0.12) |
| (1) Stop, nothing edited, advise-only policy | 16 ms | 7 ms | 7 ms |
| (1) **Stop, nothing edited, a convention in block mode** | **1.96 s (CPU 0.94)** | **0.88 s (0.46)** | **3.26 s (2.34)** |
| SessionStart (baseline scan) | 2.2 s (CPU 0.94) | 1.2 s (0.46) | 3.1–4.1 s (2.3) |

What each candidate comes to:

1. **Stop full-scans on every turn when any convention blocks**, even with nothing edited:
   **confirmed**. It costs as much as a full warm scan, 0.9–3.3 s on each turn. The pilot
   policy was mostly in block mode, so this hit the pilot's every turn too: its Stop median
   was 877 ms. I's D3 (skip when the tree stamp matches) removes it.
2. **PostToolUse walks the whole repo on every edit:** **confirmed**, at 24–46% of
   instructions. Reading and rewriting the whole index adds 9–20% more.
3. **Non-source edits pay for the walk:** **confirmed**. A README edit costs 55–65% of a
   source edit's CPU. D2 (test the extension before the walk) brings it to about process start.
4. **The full-scan fallback is all-or-nothing:** none of the 120 edit hooks fell back on main
   (§2). `needs_full_scan` itself costs under 1% of instructions on these repos. This is not
   where the time goes here. The trace shows whether it matters on other repos and policies.
5. **`git ls-files` and the cache-dir walk on every process:** about 5 ms wall, from the
   strace timeline. That is real but small.
6. **PreToolUse loads policy, lock and verify state first:** 3–4 ms CPU, so it is small.
   I's early exit makes it smaller still.
7. **Repeats** (`DriftConfig::load` several times, state loaded twice, a full-width thread
   pool for one file): inside the "other" share, 15–28% in total. The trace counts them
   (`counts.drift_config_loads`, `counts.state_loads`, `ms.pool`).

## 5. Fix, and the daemon question

- **Already fixed:** #6, the one-file check. It is a 10× gain on these repos (1.05 → 0.085 s
  on dub, 1.58 → 0.155 s on infisical, 0.29 → 0.038 s on midday).
- **In-process fixes still open** (PLAN-R14 WS-D2–D6, plus one not in that list):
  - D3 (Stop without a change): 0.9–3.3 s → about 10 ms on every turn of a block-mode
    session. This is the largest remaining gain per session.
  - D2 (extension before the walk): non-source edits → about 5 ms.
  - D5 (binary index, rewritten only when it changed): saves the 9–20% spent on the index.
  - D6 (memoised `git ls-files`): about 5 ms.
  - A binary encoding for the cached facts would cut the 9–32% spent deserialising JSON
    facts. Not in PLAN-R14.
  - Expected PostToolUse after D5 + D6 plus a binary facts cache: roughly −35 to −45% of
    CPU, which puts infisical's quiet-machine p50 at 0.06–0.08 s.
- **Is a daemon needed for p50 < 100 ms?** **No, not on these repos or on most of the dev
  set.**
  - Main already meets it on dub and midday. Infisical gets there with the in-process fixes.
    The perf record of 2026-11-07 (quiet minimum of 5) puts 10 of the 15 TS dev clones that
    have a policy at 0.07 s or less, and infisical at 0.10 s.
  - The repo walk stays in every in-process design, since Bash edits are not seen otherwise.
    So the largest repos stay above 100 ms: twenty at 0.49–0.55 s, novu and supabase at
    0.17–0.21 s, and cal.com at 0.11–0.13 s.
  - A long-lived process would keep the walk result and the deserialised facts in memory:
    the hook as a thin client of the running `drift mcp` over a local socket. It is the only
    route under 100 ms for those four repos, and for p95 < 300 ms during SessionStart-sized
    work.
  - So: in-process first (D2, D3, D5, D6), then decide on the daemon from the trace numbers
    for twenty, novu, supabase and cal.com.

## 6. Trace instrumentation (for verifying the fixes)

[`trace.patch`](trace.patch) is local measurement instrumentation (opt-in, never on main). It
applies to main 0ee8808e and b126bdb8. With `DRIFT_HOOK_TRACE=<file>`, each hook appends one
JSON line:

- `path`: fast, fallback, full or none, and `path_r14` in the PLAN-R14 WS-D1 naming;
- `reason`: no_policy, no_accepted, not_source, cache_refused, manifest, config_path, no_index,
  ts_unlowered, max_base_files, no_stack_barrel, py_declined, py_lint_config, needs_full_scan,
  scan_file_error, or hook_error;
- `out`: none, context, deny, allow, block or message;
- `ms` per phase: stdin, policy_root, policy, cache_dir, walk, index_read, pool, classify,
  index_write, link, needs_full_scan, full_scan, check, state, output, total;
- `counts`: state_loads, state_saves, config_loads, drift_config_loads.

The format was agreed with workstream I, which applies the patch locally to verify D2, D3 and
the PreToolUse early exit.

## 7. Trace-binary measurements (CGU 118, main 0ee8808e + trace.patch)

**Build.** sha256 e58d946f…, commit `cgu118-0ee8808e-1794256685`.
- Behaviour probe: with `DRIFT_HOOK_TRACE` set, the trace binary writes a line
  (`skipped:no_policy`) and main175 writes none.
- Overhead: the PostToolUse p50 on the same files is 85 / 260 / 75 ms (trace) against
  76 / 261 / 75 ms (main175) on dub / infisical / midday, which is within noise.

**Workload** ([`scripts/tracebench.py`](scripts/tracebench.py), 3 repeats, load average
16–21). The repos are dub, midday and infisical.
- Files: the pilot agent's existing files plus 15 seeded entry-point files per repo.
- Each file gets PreToolUse, an edit, PostToolUse and a restore. Each repeat also has a
  README edit and two Stops with nothing changed.
- Three policies:
  - **all:** every proposal accepted, advise mode;
  - **all-block:** the same, in block mode;
  - **accept-only:** the pilot's rule rebuilt on this binary. Proposals labelled ACCEPT in
    the v3 labels go to block mode, and every other proposal is rejected (dub 5, midday 3,
    infisical 4). The pilot's own policy files were removed with its scratch before this
    run.
- Raw lines are in `trace/*.jsonl`, and all tables are in `trace/summary.md`.

**Paths.** **0 of 504** source-file PostToolUse hooks took a full scan, under all three
policies. That includes the accept-only policy, which is mostly call-wrapper rules (the family
`needs_full_scan` examines).
- Stop under a block-mode policy: **36 of 36** ran a full scan and a full check, with nothing
  edited.
- Stop under the advise policy: 18 of 18 skipped.
- SessionStart: always a full scan, for the baseline.

**Phase p50 / p95 in ms**, from main entry to exit (`total`). Process start adds about 3 ms.
Pooled over the three policies; "–" means the phase did not run.

| hook | repo | n | total | policy | cache_dir | walk | index_read | classify | index_write | link | check | full_scan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PreToolUse (Edit) | dub | 135 | 0.8 / 3.8 | 0.5 | – | – | – | – | – | – | – | – |
| PreToolUse (Edit) | midday | 225 | 0.7 / 3.5 | 0.4 | – | – | – | – | – | – | – | – |
| PreToolUse (Edit) | infisical | 144 | 0.9 / 4.2 | 0.5 | – | – | – | – | – | – | – | – |
| PostToolUse, source | dub | 135 | **74 / 148** | 0.4 | 4 / 12 | **33 / 79** | 2 / 11 | 4 / 18 | 4 / 17 | 6 / 22 | 0.3 | – |
| PostToolUse, source | midday | 225 | **69 / 167** | 0.3 | 3 / 11 | **17 / 52** | 1 / 2 | 5 / 30 | 3 / 14 | 15 / 50 | 0.4 | – |
| PostToolUse, source | infisical | 144 | **276 / 487** | 0.5 | 6 / 27 | **123 / 233** | 8 / 28 | 10 / 45 | 17 / 60 | 59 / 111 | 0.4 | – |
| PostToolUse, README.md | dub | 9 | 50 / 141 | 0.5 | 4 / 92 | 46 / 78 | – | – | – | – | 0.1 | – |
| PostToolUse, README.md | midday | 9 | 24 / 37 | 0.4 | 5 / 9 | 19 / 25 | – | – | – | – | 0.0 | – |
| PostToolUse, README.md | infisical | 9 | 143 / 365 | 0.5 | 8 / 17 | 118 / 349 | – | – | – | – | 0.2 | – |
| Stop, block policy, nothing edited | dub | 12 | **1,237 / 1,305** | 0.5 | 5 | – | – | – | – | – | 261 | 923 |
| Stop, block policy, nothing edited | midday | 12 | **558 / 822** | 0.4 | 2 | – | – | – | – | – | 108 | 430 |
| Stop, block policy, nothing edited | infisical | 12 | **3,928 / 4,669** | 0.6 | 7 | – | – | – | – | – | 651 | 3,118 |
| Stop, advise policy | all three | 18 | 0.7–0.8 / 1.7–6.0 | 0.4 | – | – | – | – | – | – | – | – |
| SessionStart | dub | 9 | 1,211 / 1,331 | 0.5 | 3 | – | – | – | – | – | 214 | 960 |
| SessionStart | midday | 9 | 596 / 819 | 0.4 | 3 | – | – | – | – | – | 98 | 455 |
| SessionStart | infisical | 9 | 3,448 / 4,292 | 1 | 7 | – | – | – | – | – | 579 | 2,652 |

Counts per source PostToolUse: `DriftConfig::load` 4 times, `apply_packages` once, session
state loaded once. The thread `pool` is 0.3 ms p50 and 5–8 ms p95.

**What this settles, by the coordinator's list:**

1. **Stop:** measured. With any block-mode convention, it costs 0.56–3.9 s on every turn,
   of which the whole-repo check is 0.1–0.65 s. D3 removes both.
2. **The walk:** measured as the largest phase of every edit hook. It is 33 / 17 / 123 ms
   p50, which is 45% / 25% / 45% of the hook. The index read plus classify plus write adds
   10 / 9 / 35 ms.
3. **Non-source edits:** measured. They pay the walk and `cache_dir` (24–143 ms) for nothing.
4. **The fallback:** 0% on all three policies, so not a cost here.
5. **`cache_dir`:** 3–8 ms p50, up to 92 ms p95 under load, on every hook that loads the
   project.
6. **PreToolUse:** under 1 ms inside the process (policy load 0.4–0.5 ms). It is already
   cheap; the early exit saves about 0.5 ms.
7. **Repeats:** `DriftConfig::load` runs 4 times per hook and the pool p95 is 5–8 ms. These
   are small.

**Daemon verdict, restated with the trace.** On a loaded machine, the source PostToolUse p50 is
already **69–74 ms** on dub and midday. On infisical it is 276 ms at load 20 (155 ms at load
about 10, §2). The walk alone is 123 ms there.
- D2, D3, D5 and D6 do not remove the walk. A walk-free path needs the file list kept between
  hooks: either an index trusted without re-walking (unsafe: Bash edits are not seen), or a
  long-lived process watching the tree.
- So: **the in-process fixes reach p50 < 100 ms on small and medium repos, but not on the
  largest** (infisical under load, twenty, novu, supabase). A daemon (the hook as a thin client
  of `drift mcp`) is needed for those, and for any p95 bar under about 250 ms.
- **SessionStart** (0.6–3.4 s) is a full scan by design. It runs once per session, but it
  misses a 500 ms bar on every repo here.
