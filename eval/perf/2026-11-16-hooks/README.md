# Hook timing on a release build, 2026-11-16

What each agent hook costs on two large real repositories (plane, about 3,900
TypeScript and Python files; cal.com, about 5,000), on a release build of the
branch `map-to-enforcement` at `30ec50d8`, before and after the change that came
out of it (the practice map and the search-hint index kept between hook
processes). The target the audit set is a p95 under 300 ms for every hook.

## How it was measured

- **Binary.** `cargo build --release --locked -p drift-cli` (thin LTO, one
  codegen unit, as the workspace sets), once at `30ec50d8` ("before") and once
  with the change ("after").
- **Machine.** 4 cores, nothing else building or testing during a run (load
  average 1.6 to 1.9, the driver itself included).
- **Repository state.** A private copy of each repository, a fresh `drift init`,
  then every proposal accepted (`drift review --accept`): 20 on plane, 28 on
  cal.com. In the "block" runs each convention that may block was then set to
  block, one at a time (5 of 20 on plane).
- **Sessions.** `scripts/drive.py` plays 20 sessions per repository. Each is
  SessionStart, then five times (PreToolUse of an Edit, the edit itself: a comment
  line appended, PostToolUse), then Stop. The five files are sampled with a fixed
  seed from the tracked source files. Each edit is undone after its PostToolUse.
- **Times.** Each hook is one process. `wall` is spawn to exit; the hook's own
  time and the path it took come from its trace line (`DRIFT_HOOK_TRACE`).
  The first SessionStart of a run is left out of the table: `drift init` has just
  warmed the fact cache, but nothing derived is kept yet.

Raw rows: `before-advise.jsonl`, `before-block.jsonl`, `after-advise.jsonl`,
`after-block.jsonl` (480 hook runs each; no hook exited non-zero).
`scripts/summ.py <file>` prints the table of one file.

## Result

p50 and p95 of wall time, 19 warm SessionStarts, 100 PreToolUse, 100 PostToolUse
and 20 Stops per row.

| repo | rules | hook | before p50 | before p95 | after p50 | after p95 |
|---|---|---|---|---|---|---|
| cal.com | advise | SessionStart | 3.1 s | 3.4 s | 1.6 s | 1.7 s |
| cal.com | advise | PreToolUse | 83 ms | 107 ms | 77 ms | 98 ms |
| cal.com | advise | PostToolUse | 101 ms | 2.7 s | 85 ms | 2.4 s |
| cal.com | advise | Stop | 7 ms | 9 ms | 6 ms | 7 ms |
| cal.com | block | SessionStart | 3.4 s | 3.7 s | 1.7 s | 1.9 s |
| cal.com | block | Stop | 3.2 s | 3.6 s | 1.5 s | 1.7 s |
| plane | advise | SessionStart | 6.9 s | 7.6 s | 1.5 s | 1.6 s |
| plane | advise | PreToolUse | 6 ms | 592 ms | 5 ms | 507 ms |
| plane | advise | PostToolUse | 63 ms | 5.2 s | 58 ms | 4.7 s |
| plane | advise | Stop | 5 ms | 6 ms | 4 ms | 6 ms |
| plane | block | SessionStart | 7.2 s | 8.2 s | 1.5 s | 1.7 s |
| plane | block | Stop | 5.4 s | 6.0 s | 1.1 s | 1.2 s |

**The target is not met.** Only Stop without a blocking rule, and PreToolUse on
cal.com, are under 300 ms at p95.

## What the time was, and what is left

Sampled with `scripts/sample.sh` (backtraces of every thread, taken with gdb
through one hook run; a release build has no line tables, so the unit is the
function).

Before, on plane, a warm SessionStart parsed nothing (`parses: 0` in its trace
line) and still took 7 seconds:

- about 45% building the practice map again. It was never kept: a unit Drift
  could not read holds the instrument its reason is about, a field left out of
  every output, so the map written to `.drift/cache/derived-v1/` did not read back
  equal to the one computed and was dropped. No `practices-*.json` was ever
  written on either repository.
- about 12% in the security inventory, which SessionStart read twice: once for
  its keys (kept), once whole for the search-hint index (never kept). With the
  map kept, that second reading was a quarter of what remained.
- about 20% loading the cached facts of every file and linking them.

After, a warm SessionStart is the last of the three plus the digest of the facts
and the conventions check: about 1.5 s on both repositories.

What is left, in the order it costs:

1. **PostToolUse and Stop after an edit that changes what the repository lists.**
   5% (cal.com) to 12% (plane) of the edits took the whole-repository path
   (`full_scan:entry_points`); each is a new state of the code, so nothing kept
   answers for it, and the practice map and the inventory are built: 2.4 to 4.8 s.
   Most of that is `security::built_on` and the readers that call it
   (`practices::authn::read`, `authz::read_unit`), with a linear search over a
   file's symbols under them.
2. **The scan itself on an unchanged tree**: about 1.5 s to load and link 4,000 to
   5,000 files' cached facts. SessionStart and a blocking Stop pay it every time.
   Answering from the kept results without loading the facts needs a key that does
   not come from the facts (the file stamps), which is a change of design, not a
   fix.
3. **PreToolUse on plane**: 37% of them read one file, and the slowest take 0.5 s.
