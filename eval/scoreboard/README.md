# The scoreboard as a command

`scoreboard.py` turns the roadmap's scoreboard (`docs/v2/ROADMAP-MAP-TO-ENFORCEMENT.md` §3) and
the audit counts each stream claims to move into numbers. Anyone can recompute them from saved
outputs. It uses only the Python 3 standard library and runs with `python3 -I`.

## The three commands after a build

```
B=<the new drift binary>
R=/tmp/claude-0/-home-user/3c181215-935f-5929-ad2f-066cd082e027/scratchpad/firstrun
O=/tmp/claude-0/-home-user-drift/3c181215-935f-5929-ad2f-066cd082e027/scratchpad/scoreboard/after

python3 -I eval/scoreboard/scoreboard.py collect --bin $B --repos $R --out $O
python3 -I eval/scoreboard/scoreboard.py score --data $O --out $O/score.json
python3 -I eval/scoreboard/scoreboard.py diff eval/scoreboard/baseline/score.json $O/score.json
```

`diff` exits 1 only when a guard regressed. Add `--changed` to print only the numbers that moved,
and `--json` for machine output. Either side of `diff` may be a `score.json` or a data directory,
which is then scored on the fly.

## collect

`collect` runs these commands on each repository in turn. It never runs two processes at once.
Each process runs under `nice 19`, with a timeout per command (`--timeout`, default 1,800 s), and
the global `--root <repo>` comes first.

| file | command | note |
|---|---|---|
| `census.txt` | `census` | the first census, run with an empty cache; its wall time is scoreboard 7 |
| `coverage.json` | `census --coverage --json` | `loc` |
| `scan.txt` | `scan` | |
| `census.json`, `funnel.json` | `census --json` with `DRIFT_FUNNEL=<repo>/funnel.json` | |
| `census-why.json` | `census --why --json` | optional |
| `census-from-map.json` | `census --from-map --json` | optional |
| `practices-units.json` | `practices --json --units` | |
| `promote-list.json` | `practices promote --list --json` | |
| `security.json` | `security --json` | |
| `map.json` | `map --json` | |

Optional commands are detected by trying them. When the build rejects one (exit 2 with
"unexpected argument" or a similar message), `run.json` records `available: false` and "not
available in this build", and `score` prints `n/a` for its numbers.

Before a repository runs, every file a step writes in `<out>/<repo>/` (outputs, `.gz`, `.err`,
`funnel.json`, `run.json`) is removed, so a step that fails, times out or is skipped leaves nothing
from an earlier collect for `score` to read. `funnel.json` is kept only when `census --json` exited
0 in time.

Plain `drift census` never lists the proposals from the map (only `census --from-map` does), so
its hash is the census without them. `--no-from-map` is a flag of `drift init` only; `census`
does not take it.

Each `<repo>/run.json` records the argv, exit code, wall time, user and system time, and peak
memory. Peak memory is `ru_maxrss` from `os.wait4`, the same figure `resource` reports. It also
records the sha256 and size of the raw output and the end of stderr. Outputs larger than 1 MiB
are stored gzipped; the hash is of the raw bytes. `collect.json` records the binary, its sha256,
its `--version` and the start date.

Nothing is written inside a sample repository:
- The fact cache goes to `<out>/.cache/<repo>` through `DRIFT_CACHE_DIR`. That directory is
  emptied before each repository, which makes the first census cold, and deleted afterwards.
  `--cache none` passes `--no-cache` instead.
- After every command, `collect` compares the mtimes of the repository's top-level entries and
  `.drift/` tree. If anything changed, it stops.
- Repository names containing heldout or holdout are refused.

Time and space: with the audit binary, NodeGoat took 1.0 s for all 11 commands, with a first
census of 0.25 s and a peak of 58 MiB. pygoat took 2.4 s, with a first census of 0.36 s and a
peak of 69 MiB. The two repositories' outputs total 0.9 MB. The audit outputs of all seven total
11 MB unzipped. The fact cache for cal.com or plane is about 50 MB while that repository runs.

## score

`score` computes every number from saved outputs alone, per repository and in total. A number
that cannot be computed is `None` (`n/a`).

### The roadmap's eight scoreboard numbers

| # | number | automatic? | input | before |
|---|---|---|---|---|
| 1 | Real team rules enforceable (of 96) | labels | `truth/rules.json`: a person sets `state_after` (E/M/P/N) and `after_note` (the census id or promote command) per rule | 23 (audits 8 and 9; copied) |
| 2 | Share of proposals a team would keep | labels | `truth/proposals.json`: a verdict per candidate `key` and per census `repository:id`; from-map proposals go in `from_map` | TS 9 yes + 4 qualified of 45; Python 4 yes + 7 qualified of 32; census 6 yes, 2 probably, 4 plausibly, 1 wrong of 13 |
| 3 | True reports on new code, per rule kind | no | needs a history replay (sprint 2 step 6) and a verdict per report | n/a |
| 4 | Recorded exceptions that are real departures | denominator automatic; numerator labels | `truth/exceptions.json`: `real` true/false per (repository, concern, path, symbol, line) | 7 of 58 |
| 5 | Known holes in juice-shop, NodeGoat and pygoat that check reports as new | no | needs `drift check` on a diff adding each hole, and a list of the holes | n/a (proxy: 455 inventory findings) |
| 6 | Units a check fails on although unread | 3 of 4 paths | automatic: mined outliers whose sign-in row is unknown; promoted-candidate exceptions whose row is unknown; guard-gap exceptions whose guard is unknown. The diff path (`added_without_guard`) needs a diff. | 15 / 0 / 0 |
| 7 | First census per 100,000 lines | yes | `collect` timing ÷ (`census --coverage` loc / 100,000) | 5.15 s (NodeGoat 8.17, pygoat 4.09; the five larger repositories were not timed) |
| 8 | Check after one edited file, p95 | no | needs timed `drift check` runs on a copy | n/a |

A candidate or proposal that the truth files do not name counts as `unlabelled`. A new build
changes keys (a new `mechanisms` field, or a file or route place), so a person adds a row for
each new one. `keep` values are `yes`, `yes_qualified` (yes, but in a narrow, wrong or misstated
place, or "yes-ish"), `trivial`, `trivial_or_wrong` and `wrong`; census proposals can also be
`yes_probably` or `yes_plausibly`. `audit_verdict` keeps the audit's own words.

### Audit counts (key: what it reproduces)

| key | meaning | audit line | before |
|---|---|---|---|
| `entry.read` | entry points in `security.json` | audit 4 §2 | 1,914 |
| `entry.guard_known` | guarded + no guard | audit 4 §2 | 1,737 |
| `entry.guarded` / `no_guard` / `guard_unknown` / `local` | classified in order: local, then non-empty `guards`, then `opaque`, otherwise no guard | audit 4 §2 | 1,290 / 447 / 172 / 5 |
| `entry.reaching_sink` (`_no_guard`) | entries with a reach | audit 4 §2 | 153 (62) |
| `entry.in_map` | entry points counted by `map --json` | audit 5 §2.5 | 952 |
| `sec.findings` and `sec.findings.<kind>` | baseline findings, as `audit/4-count.py` counts them | audit 4 §2 | 892 |
| `sec.sinks` / `sinks_fed` | risky operations | audit 4 §2 | 419 / 229 |
| `sec.unlisted` | handlers Drift did not list | audit 4 §2 | 207 |
| `sec.guard_gaps` / `guard_gap_exceptions` | | audit 4 §2 | 5 / 8 |
| `sec.reach.*` | reach kinds; `via_webhook_notify` is the juice-shop false SSRF | audit 4 §2 and unit 6 | 23 |
| `sec.unlisted_snippets` / `sinks_snippets` | rows in juice-shop `data/static/codefixes` | audit 4 §2 | 18 / 8 |
| `units.<concern>.{rows,known,identified,none,unknown}` | unit rows by assignment | audit 1 §2.2 | all: 12,677 / 9,022 / 0 / 2,267 / 1,388 |
| `units.<concern>.distinct*` | deduplicated by (path, symbol, line) | audit 6 §2.2 (`6-units.py`) | 10,533: 7,548 variant, 1,705 none, 1,280 unknown |
| `units.<concern>.in_candidate_place` | distinct units in a promotable place | audit 6 §2.2; audit 3 §2.1 | 3,352; api 241; errors 1,154 |
| `units.authn/authz.unique_symbol(_known)` | by path#symbol | audit 2 §2.1 | 1,441 (957) / 917 (507) |
| `units.authn.none_job` | sign-in `none` rows that are jobs | audit 2 §2.3 | 52 (plane 47) |
| `units.unknown_reason.*` | unknown rows by reason | audit 1 §2.2 | |
| `cand.count`, `cand.<concern>`, `.exceptions`, `.covered` | promote candidates | audits 3 and 6 | 77; exceptions: errors 168, config 33, logging 31, data_access 22, api 14 |
| `cand.preview` / `small` / `zero_exceptions` / `python` / `bubble` | | audit 3 §0; audit 6 §2.2 | 42 / 30 / 32 / 26 / 10 |
| `cand.passive` / `mechanism` / `any_enforcing` | new build only. `promote --list --json` lists passive candidates apart (`passive`); every `cand.*` number, `units.*.in_candidate_place` and the truth keys count them too, and `cand.passive` counts them alone (`None` for a list with no `passive` key) | S1 | n/a |
| `cand.signin_covered` | units under a promotable sign-in or permission candidate (sum of totals) | audit 2 §2.2 | 645 |
| `cand.py_signin_exceptions` | scoreboard 4's denominator | audit 9 §3 | 58 |
| `census.conventions` / `default` / `suggestion` / `withheld` | from `census.txt` | audit 6 §2.1 | 13 / 7 / 6 / 25 |
| `census.outliers_unknown` | outliers whose sign-in row is unknown | audit 6 §2.4 | 15 |
| `map.proposed`, `map.proposed.kind.<kind>` | `census --from-map --json` entries with `proposed: true` | S10/S11 (new build) | n/a |
| `funnel.<stage>` | `DRIFT_FUNNEL` rows summed per stage | audit 7 §2.2 | observed 78,631; shown 13 |
| `funnel.why.gate.<gate>` | dropped per gate, `census --why --json` | S12 (new build) | n/a |
| `time.census_first_s`, `time.census_per_100k_s`, `time.peak_rss_mib` | | scoreboard 7 | |

`score --out` writes everything, including the label keys used for matching, as JSON. `meta`
gives each number's label, good direction (`up`, `down`, `same`, `info`), guard flag and source.

## Guards (diff exits 1)

1. `census.text_sha256` must stay the same in each repository: plain `drift census` is
   byte-identical between builds. When it moves, compare the two `census.txt` files with
   `diff -u`.
2. `cand.exceptions_unknown` and `census.outliers_unknown` must not rise. These count units
   reported as an exception, or as a mined outlier, whose assignment is unknown.
   `sec.guard_gap_exceptions_unknown` must not rise either.
3. A guard with no value after fails, in any repository both sides have: its command crashed, timed
   out or was not collected, so the run cannot say the guard held. `diff` prints `GUARD MISSING`
   with the repository and the command (from `score`'s `failed`, which reads `run.json`) and exits 1.
4. Unknown must not rise without a matching fall. Per repository and concern, the rise in
   `unknown` must be no more than the fall in `none` plus the fall in known (`known` plus
   `identified`).

When one side's promote list has a `passive` list and the other's has none (a build from before
the split), the candidate numbers of that repository (`cand.*`, `units.*.in_candidate_place`) are
marked `not comparable (older build)` (`?`), not judged better or worse, and a line names the
repositories.

## Tests

```
python3 -I -m unittest discover -s eval/scoreboard/tests
```

## Baseline

`baseline/score.json` is `score` run on the audit outputs. Its promote lists have no `passive`
list (`cand.passive: null`), so against a current build its candidate numbers are not comparable
until it is regenerated. These are `audit/data/<repo>/` plus
`audit/5-scratch/<repo>.census.json` and `<repo>.funnel.json`, all written by the audit binary.
Timing comes from `collect` on NodeGoat and pygoat only. A fresh `collect` with the same binary
on those two gives every number unchanged, including the census hash.

Where the baseline differs from an audit's text, the data supports these readings:
- **juice-shop `codefixes` sinks:** there are 8, not 9 as audit 4 §2 says. The 2
  `routes/vulnCodeFixes.ts` sinks are outside that directory.
- **juice-shop `dynamic_fetch` reaches:** 9 of the 23 are fed, not 14 as audit 4 unit 6 says. No
  count in `security.json` gives 14; 13 entries have any fed reach.
- **Mined outliers that are unknown:** the 15 are cal.com D-594d38, all sign-in unknown
  `not_followed`, as audit 6 says. A 16th, `apps/web/app/api/video/recording` GET, is known for
  sign-in and unknown only for permissions. It is kept apart as `census.outliers_unknown_any`.
- **TS proposals kept:** audit 8 says "about 11 of 45". Its own per-candidate verdicts give 9
  yes, 4 yes in a narrow or wrong place, 31 trivial and 1 wrong. The verdicts are what is stored.
- **Python proposals kept:** audit 9 tallies yes 8, trivial 17, wrong 7. Its per-candidate
  verdicts give yes 4, qualified yes 7, trivial 11, trivial or wrong 9, and wrong 1. The verdicts
  are what is stored.
- **Trivial enforceable TS rules:** audit 8 says 6 of its 15 enforceable rules are trivial, but
  it names 5 (E10, J7, J14, N7, N8), and its table marks N7 plain E. `rules.json` copies each
  table cell.
